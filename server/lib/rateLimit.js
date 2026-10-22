/**
 * rateLimit.js — Rate limit trong bộ nhớ cho endpoint công khai (`/api/live`).
 *
 * MVP chạy 1 tiến trình API nên Map trong RAM là đủ; không thêm Redis. Bộ đếm
 * được dọn theo cửa sổ thời gian và giới hạn số key để IP lạ không làm phình RAM.
 */

/**
 * @param {{ windowMs?: number, max?: number, maxKeys?: number, message?: string }} options
 * @returns {import('express').RequestHandler}
 */
export function createRateLimiter({ windowMs = 60000, max = 240, maxKeys = 5000, message } = {}) {
  const hits = new Map();
  const text = message || 'Bạn thao tác quá nhanh. Vui lòng thử lại sau ít phút.';

  return function rateLimit(req, res, next) {
    const now = Date.now();
    // `req.ip` đã đi qua `trust proxy` nên là IP thật khi chạy sau tunnel/proxy.
    const key = req.ip || req.socket?.remoteAddress || 'unknown';
    let entry = hits.get(key);

    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;

    if (hits.size > maxKeys) {
      for (const [otherKey, other] of hits) {
        if (other.resetAt <= now) hits.delete(otherKey);
      }
      while (hits.size > maxKeys) {
        const oldest = hits.keys().next().value;
        if (oldest === undefined) break;
        hits.delete(oldest);
      }
    }

    if (entry.count > max) {
      res.set('Retry-After', String(Math.max(1, Math.ceil((entry.resetAt - now) / 1000))));
      res.status(429).json({ error: 'rate_limited', message: text });
      return;
    }
    next();
  };
}

export default createRateLimiter;
