/**
 * loginThrottle.js — chặn brute-force đăng nhập mà không khoá cả một dải NAT.
 *
 * Hỗ trợ lưu phân tán qua Supabase RPC (`mvp_login_throttle_hit`, `mvp_login_throttle_reset`)
 * khi được truyền `rpcClient`. Nếu không có `rpcClient` hoặc DB lỗi, fallback đồng bộ về in-memory Map.
 *
 * Đếm hai tầng:
 * - `ip + username`: 10 lượt/phút — chặn dò mật khẩu một tài khoản từ một máy.
 * - `ip`: 60 lượt/phút — chặn dò nhiều username từ một máy, vẫn đủ rộng cho lớp sau NAT.
 *
 * Đăng nhập thành công chỉ xoá bộ đếm của cặp `ip + username` vừa dùng.
 */

export const LOGIN_WINDOW_MS = 60_000;
export const LOGIN_PER_ACCOUNT = 10;
export const LOGIN_PER_IP = 60;
export const LOGIN_MAX_KEYS = 10_000;

export const normalizeUser = (username) => String(username ?? '').trim().toLowerCase().slice(0, 64);
export const normalizeIp = (ip) => String(ip ?? '').trim() || 'unknown';
export const accountKey = (ip, username) => `id:${normalizeIp(ip)}|${normalizeUser(username)}`;
export const ipKey = (ip) => `ip:${normalizeIp(ip)}`;

/**
 * @param {{ windowMs?: number, perAccount?: number, perIp?: number, maxKeys?: number,
 *   now?: () => number, rpcClient?: Function|null }} [options]
 */
export function createLoginThrottle({
  windowMs = LOGIN_WINDOW_MS,
  perAccount = LOGIN_PER_ACCOUNT,
  perIp = LOGIN_PER_IP,
  maxKeys = LOGIN_MAX_KEYS,
  now = Date.now,
  rpcClient = null,
} = {}) {
  const hits = new Map();

  const bumpLocal = (key, max, at) => {
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= at) {
      entry = { count: 0, resetAt: at + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    return { allowed: entry.count <= max, retryAfter: Math.max(1, Math.ceil((entry.resetAt - at) / 1000)) };
  };

  const pruneLocal = (at) => {
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
      const aKey = accountKey(ip, username);
      const iKey = ipKey(ip);

      // Nếu có RPC Client (chế độ Supabase dùng chung phân tán)
      if (typeof rpcClient === 'function') {
        const asyncRun = (async () => {
          try {
            const accRes = await rpcClient('mvp_login_throttle_hit', {
              p_key: aKey,
              p_max: perAccount,
              p_window_ms: windowMs,
            });
            if (accRes && accRes.allowed === false) {
              return { allowed: false, retryAfter: accRes.retryAfter || 60 };
            }
            const ipRes = await rpcClient('mvp_login_throttle_hit', {
              p_key: iKey,
              p_max: perIp,
              p_window_ms: windowMs,
            });
            if (ipRes && ipRes.allowed === false) {
              return { allowed: false, retryAfter: ipRes.retryAfter || 60 };
            }
            if (accRes && ipRes) {
              return { allowed: true, retryAfter: Math.max(accRes.retryAfter || 0, ipRes.retryAfter || 0) };
            }
          } catch {
            // Fallback in-memory nếu DB/mạng lỗi
          }
          const byAccount = bumpLocal(aKey, perAccount, at);
          if (!byAccount.allowed) return byAccount;
          const result = bumpLocal(iKey, perIp, at);
          pruneLocal(at);
          return result;
        })();

        // Đính kèm kết quả sync tức thời lên promise để tương thích cả sync caller
        const syncFallback = bumpLocal(aKey, perAccount, at);
        const syncResult = syncFallback.allowed ? bumpLocal(iKey, perIp, at) : syncFallback;
        pruneLocal(at);
        asyncRun.allowed = syncResult.allowed;
        asyncRun.retryAfter = syncResult.retryAfter;
        return asyncRun;
      }

      // Chế độ sync in-memory thuần túy
      const byAccount = bumpLocal(aKey, perAccount, at);
      if (!byAccount.allowed) return byAccount;
      const result = bumpLocal(iKey, perIp, at);
      pruneLocal(at);
      return result;
    },

    /** Đăng nhập thành công: chỉ mở lại bộ đếm của đúng cặp `ip + username`. */
    reset({ ip, username } = {}) {
      const aKey = accountKey(ip, username);
      hits.delete(aKey);
      if (typeof rpcClient === 'function') {
        return rpcClient('mvp_login_throttle_reset', { p_key: aKey }).catch(() => {});
      }
    },

    /** Số key đang giữ trong bộ nhớ (dùng cho test/telemetry). */
    size: () => hits.size,
  };
}

export default createLoginThrottle;
