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
  getRoundBroadcastStatuses: broadcasts.getRoundBroadcastStatuses,
});

export function requireReason(value) {
  if (typeof value !== 'string' || value.trim().length < 5 || value.trim().length > 400) {
    throw fail(400, 'reason_required', 'Lý do phải từ 5 đến 400 ký tự.');
  }
  return value.trim();
}

async function groupRoundId(eventId, api) {
  const roundId = await api.findRound({ eventId, roundId: 'group' });
  if (!roundId) throw fail(404, 'group_round_not_found', 'Giải chưa mở vòng bảng.');
  return roundId;
}

async function eventLevel(eventId, api) {
  const cfg = await api.setup(eventId);
  return LEVELS.includes(cfg?.level) ? cfg.level : 'weekly';
}

function bracketView({ eventId, groupRoundId: roundId, progress, outcomes = progress.outcomes || {} }) {
  const plan = progress.plan;
  const series = [];
  for (const [matchId, outcome] of Object.entries(outcomes)) {
    series.push({
      match_id: matchId,
      series_id: outcome.seriesId,
      round_id: outcome.roundId,
      complete: outcome.complete,
      winner_participant_id: outcome.winnerParticipantId || null,
      games_played: outcome.gamesPlayed,
    });
  }
  return {
    event_id: eventId,
    group_round_id: roundId,
    level: plan.level,
    seed: plan.seed,
    expected_matches: progress.expected,
    resolved_matches: Object.keys(outcomes).length,
    waiting: Object.keys(outcomes).length === progress.expected ? progress.waiting : null,
    next: Object.keys(outcomes).length === progress.expected && progress.next ? {
      match_id: progress.next.matchId,
      stage: progress.next.stage,
      series_id: progress.next.series?.id || null,
      opened: progress.next.opened,
      round_id: progress.next.roundId || null,
    } : null,
    qualifiers: plan.qualifiers.map((q) => ({
      participant_id: q.participantId,
      group_name: q.groupName,
      seed: q.seed,
      rank: q.rank,
    })),
    series,
  };
}

export function officialRouter({ api = liveOfficialApi } = {}) {
  const router = Router();

  // ---- Vòng bảng (Admin-only): tiến độ, mở ván, bảng điểm, khóa ----
  router.get('/events/:id/official/progress', requireLocalAdmin, async (req, res) => {
    const roundId = await groupRoundId(req.params.id, api);
    const progress = await api.roundProgress({ roundId });
    res.json({ event_id: req.params.id, round_id: roundId, ...progress });
  });

  router.post('/events/:id/official/publish', requireLocalAdmin, async (req, res) => {
    const roundId = await groupRoundId(req.params.id, api);
    const result = await api.publishNextGame({ roundId });
    res.status(['published', 'advanced'].includes(result.status) ? 202 : 200).json(result);
  });

  router.get('/events/:id/official/standings', requireLocalAdmin, async (req, res) => {
    const roundId = await groupRoundId(req.params.id, api);
    const standings = await api.groupStandings({ roundId });
    res.json({ event_id: req.params.id, round_id: roundId, ...standings });
  });

  router.post('/events/:id/official/freeze', requireLocalAdmin, async (req, res) => {
    const roundId = await groupRoundId(req.params.id, api);
    const expected = req.body?.expected_games !== undefined ? Number(req.body.expected_games) : undefined;
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
    const statuses = await api.getRoundBroadcastStatuses(roundId);
    if (!statuses || statuses.length === 0 || !statuses.every((s) => s.isRevealed)) {
      throw fail(409, 'round_not_published', 'Bảng xếp hạng chỉ được công bố sau khi toàn bộ các ván đấu vòng bảng đã phát sóng hoàn tất.');
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
    const groupStatuses = await api.getRoundBroadcastStatuses(roundId);
    if (!groupStatuses || groupStatuses.length === 0 || !groupStatuses.every((s) => s.isRevealed)) {
      throw fail(409, 'round_not_published', 'Nhánh đấu knockout chỉ được công bố khi toàn bộ vòng bảng đã phát sóng hoàn tất.');
    }
    const level = await eventLevel(req.params.id, api);
    const bracketProg = await api.bracketProgress({ groupRoundId: roundId, level });

    // DTO Whitelist cho team/member: nếu một series knockout chưa phát sóng hoàn tất (chưa reveal),
    // giấu kết quả chi tiết của series đó để không lộ trước giờ phát
    let sanitizedProg = bracketProg;
    if (req.account?.role !== 'admin' && bracketProg?.outcomes) {
      const sanitizedOutcomes = { ...bracketProg.outcomes };
      for (const [matchId, outcome] of Object.entries(bracketProg.outcomes)) {
        if (outcome?.roundId) {
          const koStatuses = await api.getRoundBroadcastStatuses(outcome.roundId).catch(() => []);
          const allRevealed = koStatuses.length > 0 && koStatuses.every((s) => s.isRevealed);
          if (!allRevealed) {
            delete sanitizedOutcomes[matchId];
          }
        }
      }
      // Progress internals also reveal accepted but unrevealed games (resolved count,
      // next series and waiting reason). For members derive progress only from visible
      // outcomes; admin keeps the full operational DTO on the admin route.
      sanitizedProg = {
        ...bracketProg,
        outcomes: sanitizedOutcomes,
        resolved: Object.keys(sanitizedOutcomes).length,
        next: null,
        waiting: null,
      };
    }

    res.json({ published: true, ...bracketView({ eventId: req.params.id, groupRoundId: roundId,
      progress: sanitizedProg, outcomes: sanitizedProg.outcomes }) });
  });

  router.get('/events/:id/official/published/tickets', requireSession, async (req, res) => {
    await api.assertMember(req.params.id, req.account);
    const roundId = await groupRoundId(req.params.id, api);
    const groupStatuses = await api.getRoundBroadcastStatuses(roundId);
    if (!groupStatuses || groupStatuses.length === 0 || !groupStatuses.every((s) => s.isRevealed)) {
      throw fail(409, 'tickets_not_published', 'Vé chung kết chỉ được công bố khi toàn bộ vòng bảng đã phát sóng hoàn tất.');
    }
    const level = await eventLevel(req.params.id, api);
    const bracketProg = await api.bracketProgress({ groupRoundId: roundId, level });
    if (bracketProg.waiting || bracketProg.resolved !== bracketProg.expected) {
      throw fail(409, 'tickets_not_published', 'Vé chung kết chỉ được công bố khi toàn bộ nhánh knockout đã hoàn tất.');
    }
    if (bracketProg.outcomes) {
      for (const outcome of Object.values(bracketProg.outcomes)) {
        if (outcome?.roundId) {
          const koStatuses = await api.getRoundBroadcastStatuses(outcome.roundId).catch(() => []);
          const allRevealed = koStatuses.length > 0 && koStatuses.every((s) => s.isRevealed);
          if (!allRevealed) {
            throw fail(409, 'tickets_not_published', 'Vé chung kết chỉ được công bố khi toàn bộ các trận knockout đã phát sóng hoàn tất.');
          }
        }
      }
    }
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
    res.json(result);
  });

  router.get('/official/rounds/:roundPk/games/:gameKey/viewer', requireSession, async (req, res) => {
    const afterSeq = req.query.after_seq !== undefined ? Number(req.query.after_seq) : 0;
    const result = await api.broadcastViewer({ roundPk: req.params.roundPk,
      gameKey: req.params.gameKey, account: req.account, afterSeq });
    res.json(result);
  });

  // ---- Vận hành sự cố (Admin-only): hủy job đang treo, xếp lại job lỗi kèm lý do ----
  router.post('/official/jobs/:jobId/cancel', requireLocalAdmin, async (req, res) => {
    const reason = requireReason(req.body?.reason);
    const result = await api.cancelGameJob({ jobId: req.params.jobId, reason, actor: req.account });
    res.json(result);
  });

  router.post('/official/jobs/:jobId/requeue', requireLocalAdmin, async (req, res) => {
    const reason = requireReason(req.body?.reason);
    const result = await api.requeueGameJob({ jobId: req.params.jobId, reason, actor: req.account });
    res.json(result);
  });

  return router;
}

export default officialRouter;
