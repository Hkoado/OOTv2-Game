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
import { rows, uuid } from '../shared/client.js';
import { requireSession, COOKIE_NAME } from '../shared/accounts.js';
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

  /**
   * Rate limit hai tầng (Map trong RAM, một tiến trình — không thêm Redis):
   * 1. Theo IP với trần rộng hơn cho request có cookie phiên: 100 khán giả sau cùng
   *    một NAT/proxy (hoặc cùng IP Vercel edge) không còn bị 429 hàng loạt, nhưng vẫn
   *    có trần để không bị lách bằng cookie giả.
   * 2. Theo **tài khoản** sau khi xác thực: mỗi người xem có quota riêng.
   * (Trên serverless nhiều instance, mỗi instance đếm riêng; đây là mức bảo vệ cơ bản,
   * cần đo tải thật trước khi mở công khai rộng.)
   */
  const clientIp = (req) => req.ip || req.socket?.remoteAddress || 'unknown';
  const hasSessionCookie = (req) => String(req.headers?.cookie || '')
    .split(';').some((part) => part.trim().startsWith(`${COOKIE_NAME}=`));
  const limitMessage = 'Bạn tải dữ liệu trực tiếp quá nhanh. Vui lòng thử lại sau.';
  const perAccount = config.live.publicRequestsPerMinute;

  router.use(
    createRateLimiter({
      windowMs: 60_000,
      // 100 viewer × 30 lượt/phút ≈ 3000; trần theo IP cho phiên là 20× mức cơ bản.
      max: (req) => (hasSessionCookie(req) ? perAccount * 20 : perAccount),
      maxKeys: config.live.rateLimitKeys,
      keyGenerator: (req) => `ip:${clientIp(req)}`,
      message: limitMessage,
    })
  );

  // H3: không còn xem ẩn danh. Phiên + membership giải được kiểm ở từng route.
  router.use(requireSession);

  router.use(
    createRateLimiter({
      windowMs: 60_000,
      max: perAccount,
      maxKeys: config.live.rateLimitKeys,
      keyGenerator: (req) => (req.account?.id ? `account:${req.account.id}` : `ip:${clientIp(req)}`),
      message: limitMessage,
    })
  );

  router.get(
    '/overview',
    asyncHandler(async (req, res) => {
      // H3: đội chỉ thấy giải mình tham gia (không lộ tên/đội của giải khác).
      const allowedEventIds = req.account.role === 'admin'
        ? null
        : (req.account.participant_id
          ? (await rows('tournament_entries', `participant_id=eq.${uuid(req.account.participant_id)}&select=tournament_id`))
            .map((entry) => entry.tournament_id)
          : []);
      const overview = await getLiveOverview({ eventIds: allowedEventIds });
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
