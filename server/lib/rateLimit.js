/**
 * rateLimit.js — Rate limit trong bộ nhớ cho endpoint công khai (`/api/live`).
 *
 * MVP chạy 1 tiến trình API nên Map trong RAM là đủ; không thêm Redis. Bộ đếm
 * được dọn theo cửa sổ thời gian và giới hạn số key để IP lạ không làm phình RAM.
 *
 * `keyGenerator` cho phép đếm theo tài khoản thay vì IP: nhiều khán giả sau cùng một
 * NAT/proxy sẽ không dùng chung một quota. `max` có thể là hàm theo request để cho
 * request đã đăng nhập một trần IP rộng hơn (không bỏ đếm hoàn toàn, tránh bị lách
 * bằng cookie giả).
 */

const defaultKey = (req) => req.ip || req.socket?.remoteAddress || 'unknown';

/**
 * @param {{ windowMs?: number, max?: number | ((req: import('express').Request) => number),
 *   maxKeys?: number, message?: string,
 *   keyGenerator?: (req: import('express').Request) => string,
 *   skip?: (req: import('express').Request) => boolean,
 *   now?: () => number }} options
 * @returns {import('express').RequestHandler}
 */
export function createRateLimiter({ windowMs = 60000, max = 240, maxKeys = 5000, message,
  keyGenerator = defaultKey, skip, now = Date.now } = {}) {
  const hits = new Map();
  const text = message || 'Bạn thao tác quá nhanh. Vui lòng thử lại sau ít phút.';

  return function rateLimit(req, res, next) {
    if (typeof skip === 'function' && skip(req)) return next();
    const at = now();
    // Mặc định `req.ip` đã đi qua `trust proxy` nên là IP thật sau tunnel/proxy.
    const key = keyGenerator(req);
    let entry = hits.get(key);

    if (!entry || entry.resetAt <= at) {
      entry = { count: 0, resetAt: at + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;

    if (hits.size > maxKeys) {
      for (const [otherKey, other] of hits) {
        if (other.resetAt <= at) hits.delete(otherKey);
      }
      while (hits.size > maxKeys) {
        const oldest = hits.keys().next().value;
        if (oldest === undefined) break;
        hits.delete(oldest);
      }
    }

    if (entry.count > (typeof max === 'function' ? max(req) : max)) {
      res.set('Retry-After', String(Math.max(1, Math.ceil((entry.resetAt - at) / 1000))));
      res.status(429).json({ error: 'rate_limited', message: text });
      return;
    }
    next();
  };
}

export default createRateLimiter;
