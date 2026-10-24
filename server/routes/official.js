/**
 * official.js (routes) — API vòng chính thức K3 (BTC/admin & Đội thi).
 *
 * Bọc service của Khoa (`officialOrchestration`, `officialKnockout`) thành route + DTO ổn định
 * cho UI Bảo. Nguyên tắc:
 * - Admin-only cho các route điều hành/kết quả chưa công bố (`/events/:id/official/*`).
 * - Route công bố cho thành viên giải (`/events/:id/official/published/*`): yêu cầu phiên (`requireSession`)
 *   và membership giải (`assertMember`); chỉ trả standings/bracket/tickets khi giai đoạn tương ứng đã công bố/kết thúc.
 * - Mỗi request chỉ resolve `group` round của đúng event; không nhận roundId tuỳ ý từ client.
 * - Không trả snapshot private, artifact key hay cấu trúc bracket nội bộ; chỉ DTO whitelist.
 * - Không tự tạo ván/kết quả: mọi thay đổi đi qua service + RPC có fence của Khoa.
 */

import { Router } from 'express';

import { HttpError } from '../lib/httpError.js';
import { requireLocalAdmin, requireSession } from '../shared/accounts.js';
import { findOfficialRound } from '../shared/officialSchedule.js';
import { setupFor } from '../shared/officialSetup.js';
import { assertEventMember } from '../shared/publication.js';
import * as orchestration from '../services/officialOrchestration.js';
import * as knockout from '../services/officialKnockout.js';
import * as broadcasts from '../services/officialBroadcasts.js';

const LEVELS = Object.freeze(['weekly', 'monthly', 'semester']);
const fail = (status, code, message) => new HttpError(status, code, message);

/** API thật; test inject bản giả để không chạm DB. */
export const liveOfficialApi = Object.freeze({
  findRound: findOfficialRound,
  setup: setupFor,
  assertMember: assertEventMember,
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
  listPublishedGames: broadcasts.listPublishedOfficialGames,
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

  // ---- Vòng bảng (Admin-only): tiến độ, bảng xếp hạng kín, phát ván kế tiếp, khóa vòng ----
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

  // ---- Knockout (Admin-only): bracket, mở/tiến series, vé ----
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

  // ---- Kết quả ĐÃ CÔNG BỐ (Thành viên giải / Đội thi): standings, bracket, vé, danh sách ván ----
  router.get('/events/:id/official/published/standings', requireSession, async (req, res) => {
    await api.assertMember(req.params.id, req.account);
    const roundId = await groupRoundId(req.params.id, api);
    const progress = await api.roundProgress({ roundId });
    if (!progress?.frozen) {
      throw fail(409, 'round_not_published', 'Bảng xếp hạng chỉ được công bố khi vòng bảng đã kết thúc và được khóa.');
    }
    const standings = await api.groupStandings({ roundId });
    res.json({ published: true, event_id: req.params.id, round_id: roundId, ...standings });
  });

  router.get('/events/:id/official/published/bracket', requireSession, async (req, res) => {
    await api.assertMember(req.params.id, req.account);
    const roundId = await groupRoundId(req.params.id, api);
    const progress = await api.roundProgress({ roundId });
    if (!progress?.frozen) {
      throw fail(409, 'round_not_published', 'Nhánh đấu knockout chưa được công bố.');
    }
    const level = await eventLevel(req.params.id, api);
    const bracketProg = await api.bracketProgress({ groupRoundId: roundId, level });
    res.json({ published: true, ...bracketView({ eventId: req.params.id, groupRoundId: roundId, progress: bracketProg }) });
  });

  router.get('/events/:id/official/published/tickets', requireSession, async (req, res) => {
    await api.assertMember(req.params.id, req.account);
    const roundId = await groupRoundId(req.params.id, api);
    const level = await eventLevel(req.params.id, api);
    try {
      const result = await api.knockoutTickets({ groupRoundId: roundId, level });
      res.json({ published: true, event_id: req.params.id, round_id: roundId, ...result });
    } catch (error) {
      if (error?.code === 'bracket_incomplete' || error?.status === 409) {
        throw fail(409, 'tickets_not_published', 'Vé chung kết chỉ được công bố khi toàn bộ nhánh knockout đã hoàn tất.');
      }
      throw error;
    }
  });

  router.get('/events/:id/official/published/games', requireSession, async (req, res) => {
    await api.assertMember(req.params.id, req.account);
    const roundId = await groupRoundId(req.params.id, api);
    const result = await api.listPublishedGames({ roundPk: roundId, account: req.account });
    res.json({ published: true, ...result });
  });

  // ---- Publication ván official: chấm xong mới đặt lịch; viewer chỉ thấy ply đã phát ----
  router.put('/official/rounds/:roundPk/games/:gameKey/broadcast', requireLocalAdmin, async (req, res) => {
    const result = await api.scheduleBroadcast({ roundPk: req.params.roundPk,
      gameKey: req.params.gameKey, account: req.account, body: req.body ?? {} });
    res.json({ round_pk: req.params.roundPk, game_key: req.params.gameKey, ...result });
  });

  router.get('/official/rounds/:roundPk/games/:gameKey/broadcast', requireSession, async (req, res) => {
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
