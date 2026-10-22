/**
 * live.js — API công khai cho khán giả xem trực tiếp (`/api/live`).
 *
 * Chỉ đọc dữ liệu L1 (thế trận + nước đi). Không có endpoint nào ở đây trả log bot,
 * ghi chú chấm, đường dẫn file hay thông tin tài khoản.
 */

import { Router } from 'express';

import config from '../config.js';
import { HttpError } from '../lib/httpError.js';
import { createRateLimiter } from '../lib/rateLimit.js';
import {
  getLiveMatchSnapshot,
  getLiveOverview,
  listLiveEvents,
  liveMatchExists,
} from '../services/liveEvents.js';
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

  router.get('/overview', (req, res) => {
    res.json(getLiveOverview());
  });

  router.get('/matches/:id', (req, res, next) => {
    const snapshot = getLiveMatchSnapshot(req.params.id);
    if (!snapshot) return next(new HttpError(404, 'match_not_found', 'Không tìm thấy ván đấu.'));
    res.json(snapshot);
  });

  router.get('/matches/:id/events', (req, res, next) => {
    if (!liveMatchExists(req.params.id)) {
      return next(new HttpError(404, 'match_not_found', 'Không tìm thấy ván đấu.'));
    }
    res.json({
      match_id: req.params.id,
      ...listLiveEvents(req.params.id, { afterSeq: normalizeAfterSeq(req.query.afterSeq) }),
    });
  });

  return router;
}

export default liveRouter;
