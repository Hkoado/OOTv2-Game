/**
 * loginThrottle.js — chặn brute-force đăng nhập mà không khoá cả một dải NAT.
 *
 * Hai tầng bảo vệ:
 * 1. Mỗi cặp `ip + username` được thử tối đa 10 lần / 60 giây. Thử sai liên tục tài khoản
 *    nào thì chỉ khoá tài khoản đó trên IP đó.
 * 2. Mỗi `ip` được thử tối đa 60 lần / 60 giây trên MỌI tài khoản. Cho phép cả lớp (~30 em)
 *    chung một IP trường học cùng đăng nhập vào đầu giờ mà không bị dính đòn quét dải.
 *
 * Hỗ trợ phân tán qua Supabase RPC (`mvp_login_throttle_hit`), fallback in-memory nếu RPC lỗi.
 * Không phụ thuộc thư viện ngoài; cấu hình qua tham số để test time-travel được.
 */

export const LOGIN_PER_ACCOUNT = 10;
export const LOGIN_PER_IP = 60;
export const LOGIN_WINDOW_MS = 60000;
export const MAX_TRACKED_KEYS = 5000;

function sanitize(value) {
  return String(value ?? '').trim().toLowerCase().slice(0, 80);
}

function accountKey(ip, username) {
  return `acc:${sanitize(ip)}:${sanitize(username)}`;
}

function ipKey(ip) {
  return `ip:${sanitize(ip)}`;
}

export function createLoginThrottle({
  perAccount = LOGIN_PER_ACCOUNT,
  perIp = LOGIN_PER_IP,
  windowMs = LOGIN_WINDOW_MS,
  maxKeys = MAX_TRACKED_KEYS,
  now = Date.now,
  rpcClient = null,
} = {}) {
  const hits = new Map();

  const bumpLocal = (key, limit, at) => {
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= at) {
      entry = { count: 0, resetAt: at + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > limit) {
      const retryAfter = Math.max(1, Math.ceil((entry.resetAt - at) / 1000));
      return { allowed: false, retryAfter };
    }
    return { allowed: true, retryAfter: 0 };
  };

  const pruneLocal = (at) => {
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
        return (async () => {
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
            // Fallback in-memory nếu RPC lỗi
          }
          // Chỉ bump in-memory ĐÚNG 1 LẦN khi RPC thất bại hoặc không trả kết quả (không đếm đôi)
          const byAccount = bumpLocal(aKey, perAccount, at);
          if (!byAccount.allowed) return byAccount;
          const result = bumpLocal(iKey, perIp, at);
          pruneLocal(at);
          return result;
        })();
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
        return (async () => {
          try {
            await rpcClient('mvp_login_throttle_reset', { p_key: aKey });
          } catch {
            // Bỏ qua lỗi reset RPC
          }
        })();
      }
    },
  };
}

export default createLoginThrottle;
