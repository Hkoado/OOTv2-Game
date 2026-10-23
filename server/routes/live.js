/**
 * live.js — API công khai cho khán giả xem trực tiếp (`/api/live`).
 *
 * Chỉ đọc dữ liệu L1 (thế trận + nước đi) từ Supabase. Không có endpoint nào ở
 * đây trả log bot, ghi chú chấm, đường dẫn file hay thông tin tài khoản.
 */

import { Router } from 'express';

import config from '../config.js';
import { HttpError, notFound } from '../lib/httpError.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { createRateLimiter } from '../lib/rateLimit.js';
import { getLiveMatchSnapshot, getLiveOverview, listLiveEvents, liveMatchExists } from '../shared/live.js';
import { normalizeAfterSeq } from '../services/liveView.js';

export function liveRouter() {
  const router = Router();

  router.use((req, res, next) => {
    // Dữ liệu thay đổi từng nước: mọi proxy/CDN không được cache.
    res.set('Cache-Control', 'no-store');
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

  router.get(
    '/overview',
    asyncHandler(async (req, res) => {
      res.json(await getLiveOverview());
    })
  );

  router.get(
    '/matches/:id',
    asyncHandler(async (req, res) => {
      const snapshot = await getLiveMatchSnapshot(req.params.id);
      if (!snapshot) throw notFound('match_not_found', 'Không tìm thấy ván đấu.');
      res.json(snapshot);
    })
  );

  router.get(
    '/matches/:id/events',
    asyncHandler(async (req, res) => {
      if (!(await liveMatchExists(req.params.id))) {
        throw notFound('match_not_found', 'Không tìm thấy ván đấu.');
      }
      res.json({
        match_id: req.params.id,
        ...(await listLiveEvents(req.params.id, { afterSeq: normalizeAfterSeq(req.query.afterSeq) })),
      });
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

