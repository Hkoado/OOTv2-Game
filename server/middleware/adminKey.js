import { createHash, timingSafeEqual } from 'node:crypto';

import config from '../config.js';
import { unauthorized } from '../lib/httpError.js';

function safeEqual(a, b) {
  const hashA = createHash('sha256').update(String(a)).digest();
  const hashB = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(hashA, hashB);
}

/**
 * Bảo vệ route admin bằng header `x-admin-key` (so sánh timing-safe).
 * MVP local-dev: không có tài khoản/role, chỉ 1 khoá trong .env.
 */
export function requireAdminKey(req, res, next) {
  const provided = req.get('x-admin-key');
  if (!provided || !safeEqual(provided, config.adminKey)) {
    next(unauthorized('admin_key_required', 'Cần header x-admin-key hợp lệ'));
    return;
  }
  next();
}

export default { requireAdminKey };
