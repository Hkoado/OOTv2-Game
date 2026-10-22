import config from '../config.js';

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Guard CSRF dựa trên header `Origin` cho request thay đổi state.
 *
 * - Localhost (dev) luôn được phép, kể cả http.
 * - Origin public phải là HTTPS và thuộc `OOTV2_PUBLIC_ORIGIN`,
 *   hoặc trùng `Host` của chính request (same-origin sau reverse proxy).
 *
 * Trả `false` cho origin rỗng/không parse được; caller tự quyết định chặn.
 */
export function isAllowedOrigin(req, origin) {
  let url;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (!['http:', 'https:'].includes(url.protocol)) return false;
  if (LOCAL_HOSTNAMES.has(url.hostname)) return true;
  if (url.protocol !== 'https:') return false;
  if (config.publicOrigins.includes(url.origin)) return true;
  // Same-origin sau reverse proxy: so hostname (đã tính `X-Forwarded-Host` khi trust proxy),
  // không so port vì proxy có thể đổi cổng nội bộ.
  return url.hostname === req.hostname;
}

export default isAllowedOrigin;
