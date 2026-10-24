/**
 * official.js (routes) — API vòng chính thức K3 (BTC/admin).
 *
 * Bọc service của Khoa (`officialOrchestration`, `officialKnockout`) thành route + DTO ổn định
 * cho UI Bảo. Nguyên tắc:
 * - Admin-only: kết quả/standings/bracket còn kín trước công bố, không mở cho đội/anonymous.
 * - Mỗi request chỉ resolve `group` round của đúng event; không nhận roundId tuỳ ý từ client.
 * - Không trả snapshot private, artifact key hay cấu trúc bracket nội bộ; chỉ DTO whitelist.
 * - Không tự tạo ván/kết quả: mọi thay đổi đi qua service + RPC có fence của Khoa.
 */

import { Router } from 'express';

import { HttpError } from '../lib/httpError.js';
import { requireLocalAdmin, requireSession } from '../shared/accounts.js';
import { findOfficialRound } from '../shared/officialSchedule.js';
import { setupFor } from '../shared/officialSetup.js';
import * as orchestration from '../services/officialOrchestration.js';
import * as knockout from '../services/officialKnockout.js';
import * as broadcasts from '../services/officialBroadcasts.js';

const LEVELS = Object.freeze(['weekly', 'monthly', 'semester']);
const fail = (status, code, message) => new HttpError(status, code, message);

/** API thật; test inject bản giả để không chạm DB. */
export const liveOfficialApi = Object.freeze({
  findRound: findOfficialRound,
  setup: setupFor,
  publishNextGame: orchestration.publishNextGame,
  roundProgress: orchestration.roundProgress,
  groupStandings: orchestration.groupStandings,
  freezeGroupRound: orchestration.freezeGroupRound,
  cancelGameJob: orchestration.cancelGameJob,
  requeueGameJob: orchestration.requeueGameJob,
  bracketProgress: knockout.bracketProgress,
  openNextKnockoutSeries: knockout.openNextKnockoutSeries,
  knockoutTickets: knockout.knockoutTickets,
  scheduleBroadcast: broadcasts.scheduleOfficialGameBroadcast,
  broadcastState: broadcasts.officialBroadcastState,
  broadcastViewer: broadcasts.officialGameViewerPackage,
});

export function requireReason(value) {
  if (typeof value !== 'string' || value.trim().length < 5 || value.trim().length > 400) {
    throw fail(400, 'reason_required', 'Lý do phải từ 5 đến 400 ký tự.');
  }
  return value.trim();
}

async function groupRoundId(eventId, api) {
  const roundId = await api.findRound({ eventId, roundId: 'group' });
  if (!roundId) throw fail(404, 'round_not_found', 'Chưa mở vòng bảng chính thức cho giải này.');
  return roundId;
}

async function eventLevel(eventId, api) {
  const config = await api.setup(eventId);
  return LEVELS.includes(config?.level) ? config.level : 'weekly';
}

export function matchOrder(bracket) {
  const list = [];
  for (const roundInfo of bracket?.rounds ?? []) {
    for (const match of roundInfo.matches ?? []) list.push({ stage: roundInfo.stage, match });
  }
  if (bracket?.thirdPlace) list.push({ stage: 'third_place', match: bracket.thirdPlace });
  return list;
}

/** DTO bracket: chỉ trạng thái series/kết quả accepted, không lộ snapshot hay plan nội bộ. */
export function bracketView({ eventId, groupRoundId: roundId, progress }) {
  const plan = progress.plan;
  return {
    event_id: eventId,
    round_id: roundId,
    schema_version: plan.schemaVersion,
    level: plan.level,
    seed: plan.seed,
    expected: progress.expected,
    resolved: progress.resolved,
    complete: progress.resolved === progress.expected && !progress.waiting,
    waiting: progress.waiting,
    next: progress.next
      ? { match_id: progress.next.matchId, stage: progress.next.stage,
        round_id: progress.next.roundId, opened: progress.next.opened === true }
      : null,
    qualifiers: plan.qualifiers.map((row) => ({
      participant_id: row.participantId, group_name: row.groupName,
      seed: row.seed, rank: row.rank,
    })),
    series: matchOrder(plan.bracket).map(({ stage, match }) => {
      const outcome = progress.outcomes[match.id] ?? null;
      return {
        match_id: match.id,
        stage,
        round_id: outcome?.roundId ?? null,
        complete: outcome?.complete === true,
        reason: outcome?.reason ?? null,
        winner_participant_id: outcome?.winnerParticipantId ?? null,
        loser_participant_id: outcome?.loserParticipantId ?? null,
        administrative: outcome?.administrative === true,
        games_played: Number(outcome?.gamesPlayed ?? 0),
      };
    }),
  };
}

export function officialRouter({ api = liveOfficialApi } = {}) {
  const router = Router();

  // ---- Vòng bảng: tiến độ, bảng xếp hạng, phát ván kế tiếp, khóa vòng ----
  router.get('/events/:id/official/progress', requireLocalAdmin, async (req, res) => {
    const roundId = await groupRoundId(req.params.id, api);
    const progress = await api.roundProgress({ roundId });
    res.json({ round_id: roundId, ...progress });
  });

  router.get('/events/:id/official/standings', requireLocalAdmin, async (req, res) => {
    const roundId = await groupRoundId(req.params.id, api);
    const standings = await api.groupStandings({ roundId });
    res.json({ event_id: req.params.id, round_id: roundId, ...standings });
  });

  router.post('/events/:id/official/publish', requireLocalAdmin, async (req, res) => {
    const roundId = await groupRoundId(req.params.id, api);
    res.json({ round_id: roundId, ...await api.publishNextGame({ roundId }) });
  });

  router.post('/events/:id/official/freeze', requireLocalAdmin, async (req, res) => {
    const roundId = await groupRoundId(req.params.id, api);
    const expected = req.body?.expected_games;
    if (expected !== undefined && (!Number.isInteger(expected) || expected < 1 || expected > 100000)) {
      throw fail(400, 'bad_expected_games', 'expected_games phải là số nguyên dương.');
    }
    res.json({ round_id: roundId, ...await api.freezeGroupRound({ roundId, expectedGames: expected }) });
  });

  // ---- Knockout: bracket, mở/tiến series, vé ----
  router.get('/events/:id/official/bracket', requireLocalAdmin, async (req, res) => {
    const roundId = await groupRoundId(req.params.id, api);
    const level = await eventLevel(req.params.id, api);
    const progress = await api.bracketProgress({ groupRoundId: roundId, level });
    res.json(bracketView({ eventId: req.params.id, groupRoundId: roundId, progress }));
  });

  router.post('/events/:id/official/bracket/open', requireLocalAdmin, async (req, res) => {
    const roundId = await groupRoundId(req.params.id, api);
    const level = await eventLevel(req.params.id, api);
    const result = await api.openNextKnockoutSeries({ groupRoundId: roundId, level });
    res.status(['opened', 'advanced'].includes(result.status) ? 202 : 200).json(result);
  });

  router.get('/events/:id/official/tickets', requireLocalAdmin, async (req, res) => {
    const roundId = await groupRoundId(req.params.id, api);
    const level = await eventLevel(req.params.id, api);
    const result = await api.knockoutTickets({ groupRoundId: roundId, level });
    res.json({ event_id: req.params.id, round_id: roundId, ...result });
  });

  // ---- Publication ván official: chấm xong mới đặt lịch; viewer chỉ thấy ply đã phát ----
  router.put('/official/rounds/:roundPk/games/:gameKey/broadcast', requireLocalAdmin, async (req, res) => {
    const result = await api.scheduleBroadcast({ roundPk: req.params.roundPk,
      gameKey: req.params.gameKey, account: req.account, body: req.body ?? {} });
    res.json({ round_pk: req.params.roundPk, game_key: req.params.gameKey, ...result });
  });

  router.get('/official/rounds/:roundPk/games/:gameKey/broadcast', requireLocalAdmin, async (req, res) => {
    const result = await api.broadcastState({ roundPk: req.params.roundPk,
      gameKey: req.params.gameKey, account: req.account });
    res.json({ round_pk: req.params.roundPk, game_key: req.params.gameKey, ...result });
  });

  /** Viewer: cần phiên đăng nhập + thuộc giải; chỉ dữ liệu đã tới hạn phát. */
  router.get('/official/rounds/:roundPk/games/:gameKey/viewer', requireSession, async (req, res) => {
    const afterSeq = req.query?.after_seq ?? req.query?.afterSeq ?? 0;
    res.set('Cache-Control', 'private, no-store');
    res.json(await api.broadcastViewer({ roundPk: req.params.roundPk,
      gameKey: req.params.gameKey, account: req.account, afterSeq }));
  });

  // ---- Hủy / chấm lại job (bắt buộc lý do, giữ audit ở DB) ----
  router.post('/official/jobs/:jobId/cancel', requireLocalAdmin, async (req, res) => {
    const reason = requireReason(req.body?.reason);
    const result = await api.cancelGameJob({ jobId: req.params.jobId, actor: req.account.id, reason });
    res.json({ job_id: req.params.jobId, ...result, reason });
  });

  router.post('/official/jobs/:jobId/requeue', requireLocalAdmin, async (req, res) => {
    const reason = requireReason(req.body?.reason);
    const result = await api.requeueGameJob({ jobId: req.params.jobId, actor: req.account.id, reason });
    res.json({ job_id: req.params.jobId, ...result, reason });
  });

  return router;
}

export default officialRouter;

