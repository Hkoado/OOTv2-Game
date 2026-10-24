/**
 * names.js — Chuẩn hoá tên đội (hàm thuần, không DB).
 *
 * Tách khỏi `services/participants.js` (đã xoá cùng driver SQLite) để cả API
 * Supabase dùng lại đúng một quy tắc đặt tên.
 */

import { badRequest } from './httpError.js';

const NAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} _.\-]*$/u;

/** Chuẩn hoá + kiểm tra tên đội (trim 1–40 ký tự, không ký tự điều khiển). */
export function normalizeParticipantName(rawName) {
  if (typeof rawName !== 'string') {
    throw badRequest('bad_name', 'name phải là chuỗi');
  }
  const name = rawName.trim();
  if (name.length < 1 || name.length > 40) {
    throw badRequest('bad_name', 'Tên đội phải từ 1 đến 40 ký tự sau khi trim');
  }
  if (!NAME_PATTERN.test(name)) {
    throw badRequest('bad_name', 'Tên đội chỉ gồm chữ, số, khoảng trắng, _ . -');
  }
  return name;
}

export default { normalizeParticipantName };
