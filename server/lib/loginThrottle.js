/**
 * loginThrottle.js — chặn brute-force đăng nhập mà không khoá cả một dải NAT.
 *
 * Bộ đếm cũ chỉ theo `req.ip`: một lớp học/trường dùng chung IP ra Internet sẽ bị 429
 * chỉ sau 16 lượt đăng nhập (kể cả khi mỗi em chỉ thử một lần). Ở đây đếm hai tầng:
 * - `ip + username`: 10 lượt/phút — chặn dò mật khẩu một tài khoản từ một máy.
 * - `ip`: 60 lượt/phút — chặn dò nhiều username từ một máy, vẫn đủ rộng cho lớp sau NAT.
 *
 * Đăng nhập thành công chỉ xoá bộ đếm của cặp `ip + username` vừa dùng.
 * Map nằm trong RAM (MVP một tiến trình, không thêm Redis) và được dọn theo cửa sổ +
 * giới hạn số key để IP lạ không làm phình bộ nhớ.
 */

export const LOGIN_WINDOW_MS = 60_000;
export const LOGIN_PER_ACCOUNT = 10;
export const LOGIN_PER_IP = 60;
export const LOGIN_MAX_KEYS = 10_000;

const normalizeUser = (username) => String(username ?? '').trim().toLowerCase().slice(0, 64);
const normalizeIp = (ip) => String(ip ?? '').trim() || 'unknown';
const accountKey = (ip, username) => `id:${normalizeIp(ip)}|${normalizeUser(username)}`;
const ipKey = (ip) => `ip:${normalizeIp(ip)}`;

/**
 * @param {{ windowMs?: number, perAccount?: number, perIp?: number, maxKeys?: number,
 *   now?: () => number }} [options]
 */
export function createLoginThrottle({
  windowMs = LOGIN_WINDOW_MS,
  perAccount = LOGIN_PER_ACCOUNT,
  perIp = LOGIN_PER_IP,
  maxKeys = LOGIN_MAX_KEYS,
  now = Date.now,
} = {}) {
  const hits = new Map();

  const bump = (key, max, at) => {
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= at) {
      entry = { count: 0, resetAt: at + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    return { allowed: entry.count <= max, retryAfter: Math.max(1, Math.ceil((entry.resetAt - at) / 1000)) };
  };

  const prune = (at) => {
    if (hits.size <= maxKeys) return;
    for (const [key, entry] of hits) if (entry.resetAt <= at) hits.delete(key);
    while (hits.size > maxKeys) {
      const oldest = hits.keys().next().value;
      if (oldest === undefined) break;
      hits.delete(oldest);
    }
  };

  return {
    /** Ghi nhận một lượt thử; trả `{ allowed:false, retryAfter }` khi vượt trần. */
    check({ ip, username, at = now() } = {}) {
      const byAccount = bump(accountKey(ip, username), perAccount, at);
      if (!byAccount.allowed) return byAccount;
      const result = bump(ipKey(ip), perIp, at);
      prune(at);
      return result;
    },
    /** Đăng nhập thành công: chỉ mở lại bộ đếm của đúng cặp `ip + username`. */
    reset({ ip, username } = {}) {
      hits.delete(accountKey(ip, username));
    },
    /** Số key đang giữ (dùng cho test/telemetry). */
    size: () => hits.size,
  };
}

export default createLoginThrottle;
