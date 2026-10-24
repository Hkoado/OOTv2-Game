import config from '../config.js';

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Guard CSRF dựa trên header `Origin` cho request thay đổi state.
 *
 * - Localhost (dev) chỉ được phép khi `allowLocal` (production tắt mặc định).
 * - Origin public phải là HTTPS và thuộc `OOTV2_PUBLIC_ORIGIN`,
 *   hoặc trùng `Host` của chính request (same-origin sau reverse proxy).
 *
 * Trả `false` cho origin rỗng/không parse được; caller tự quyết định chặn.
 */
export function originAllowed(req, origin, { publicOrigins = [], allowLocal = false } = {}) {
  let url;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (!['http:', 'https:'].includes(url.protocol)) return false;
  if (LOCAL_HOSTNAMES.has(url.hostname) && allowLocal) return true;
  if (url.protocol !== 'https:') return false;
  if (publicOrigins.includes(url.origin)) return true;
  // Same-origin sau reverse proxy: so hostname (đã tính `X-Forwarded-Host` khi trust proxy),
  // không so port vì proxy có thể đổi cổng nội bộ.
  return url.hostname === req?.hostname;
}

export function isAllowedOrigin(req, origin) {
  return originAllowed(req, origin, { publicOrigins: config.publicOrigins, allowLocal: config.allowLocalOrigins });
}

export default isAllowedOrigin;
