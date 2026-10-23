/**
 * live.js — API xem trực tiếp (`/api/live`) trên Supabase.
 *
 * H3: **chấm trước — lưu kín — phát theo lịch**. Mọi endpoint ở đây cần phiên đăng nhập
 * (`requireSession`) và chỉ trả dữ liệu của ván đã được công bố qua `mvp_match_broadcasts`.
 * Không endpoint nào trả log bot, ghi chú chấm, đường dẫn file hay thông tin tài khoản.
 */

import { Router } from 'express';

import config from '../config.js';
import { HttpError, notFound } from '../lib/httpError.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { createRateLimiter } from '../lib/rateLimit.js';
import { getLiveMatchSnapshot, getLiveOverview, listLiveEvents } from '../shared/live.js';
import { requireSession } from '../shared/accounts.js';
import {
  assertEventMember,
  broadcastStateForMatch,
  broadcastView,
  isPublished,
  publishedMatchSets,
  viewerPackage,
} from '../shared/publication.js';
import { normalizeAfterSeq } from '../services/liveView.js';

/** Ẩn kết quả/lý do/ply_count của ván chưa mở (admin bỏ qua bước này). */
function sanitizeSnapshot(snapshot, info) {
  if (info.reveal_result) return snapshot;
  return {
    ...snapshot,
    match: { ...snapshot.match, result: null, reason: null, ply_count: null, finished_at: null },
    live: { ...snapshot.live, replay_available: false },
  };
}

export function liveRouter() {
  const router = Router();

  router.use((req, res, next) => {
    // Dữ liệu thay đổi từng nước + theo tài khoản: không cache ở proxy/CDN.
    res.set('Cache-Control', 'private, no-store');
    next();
  });

  // Chặn poll quá dày từ một IP (mở public qua tunnel nên cần giới hạn cơ bản).
  router.use(
    createRateLimiter({
      windowMs: 60_000,
      max: config.live.publicRequestsPerMinute,
      maxKeys: config.live.rateLimitKeys,
      message: 'Bạn tải dữ liệu trực tiếp quá nhanh. Vui lòng thử lại sau.',
    })
  );

  // H3: không còn xem ẩn danh. Phiên + membership giải được kiểm ở từng route.
  router.use(requireSession);

  router.get(
    '/overview',
    asyncHandler(async (req, res) => {
      const overview = await getLiveOverview();
      if (req.account.role === 'admin' || !overview.event) {
        res.json(overview);
        return;
      }
      const sets = await publishedMatchSets(overview.event.id);
      const visible = (entry) => sets.live.has(entry.id);
      const matches = overview.matches.filter(visible);
      const recent = overview.recent_finished.filter(visible).map((entry) => (
        sets.reveal.has(entry.id) ? entry : { ...entry, result: null, reason: null, ply_count: null }
      ));
      res.json({
        ...overview,
        matches,
        recent_finished: recent,
        counts: {
          total: matches.length + recent.length,
          running: matches.length,
          finished: recent.length,
          pending: 0,
        },
      });
    })
  );

  router.get(
    '/matches/:id',
    asyncHandler(async (req, res) => {
      const { match, info } = await broadcastStateForMatch(req.params.id);
      if (!match) throw notFound('match_not_found', 'Không tìm thấy ván đấu.');
      await assertEventMember(match.tournament_id, req.account);
      if (req.account.role !== 'admin' && !isPublished(info)) {
        throw notFound('broadcast_not_published', 'Ván chưa được công bố.');
      }
      const snapshot = await getLiveMatchSnapshot(req.params.id);
      if (!snapshot) throw notFound('match_not_found', 'Không tìm thấy ván đấu.');
      const publication = { ...broadcastView({ match_id: match.id, event_id: match.tournament_id, state: info.phase === 'hidden' ? 'canceled' : 'scheduled', starts_at: info.starts_at, ply_interval_ms: info.ply_interval_ms || 0, release_mode: info.release_mode || 'window' }, info) };
      res.json({
        ...(req.account.role === 'admin' ? snapshot : sanitizeSnapshot(snapshot, info)),
        publication,
      });
    })
  );

  router.get(
    '/matches/:id/events',
    asyncHandler(async (req, res) => {
      const afterSeq = normalizeAfterSeq(req.query.afterSeq);
      if (req.account.role === 'admin') {
        const { match, info } = await broadcastStateForMatch(req.params.id);
        if (!match) throw notFound('match_not_found', 'Không tìm thấy ván đấu.');
        res.json({
          match_id: req.params.id,
          phase: info.phase,
          server_time: info.server_time,
          visible_plies: info.visible_plies,
          total_plies: info.total_plies,
          next_poll_ms: info.next_poll_ms,
          ...(await listLiveEvents(req.params.id, { afterSeq })),
        });
        return;
      }
      // Viewer: chỉ event tới `visible_plies`, không kết quả khi chưa mở.
      res.json(await viewerPackage({ matchId: req.params.id, afterSeq, account: req.account }));
    })
  );

  // Bảng live chưa migrate → 503 kèm hướng dẫn, không để 500 mơ hồ.
  router.use((error, req, res, next) => {
    if (error?.code === 'shared_db_error') {
      next(
        new HttpError(
          503,
          'live_not_ready',
          'Bảng dữ liệu trực tiếp chưa sẵn sàng. Chạy migration 20261023120000_live_stream.sql.'
        )
      );
      return;
    }
    next(error);
  });

  return router;
}

export default liveRouter;
