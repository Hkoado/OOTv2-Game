/**
 * mapSnapshot.js — Snapshot map theo từng ván (attempt) cho mọi nguồn dữ liệu.
 *
 * - Sinh snapshot MỘT lần khi lên lịch trận: JSON đã chuẩn hoá + hash canonical.
 * - Đọc lại snapshot khi chấm: tính lại hash từ nội dung để phát hiện sửa tay.
 * - Hàm thuần (không DB, không mạng) nên test được bằng `node --test`.
 */

import { normalizeMap, EMPTY_MAP } from '../../src/game/maps.js';
import { mapHash } from './canonical.js';

/**
 * Snapshot bất biến của map cho MỘT ván.
 * `id`/`revision` vẫn nằm trong JSON để truy vết, nhưng không tham gia hash.
 * @param {object} [map] MapV1; thiếu map => bàn mở MVP
 * @returns {{ json: string, hash: string }}
 */
export function matchMapSnapshot(map) {
  const snapshot = normalizeMap(map || EMPTY_MAP);
  return { json: JSON.stringify(snapshot), hash: mapHash(snapshot) };
}

/**
 * Map dùng cho MỘT ván: ưu tiên snapshot ghi trên match; dữ liệu tạo trước migration
 * (`map_json` NULL) dùng map hiện tại của giải.
 *
 * Hash luôn được tính lại từ nội dung, nên nếu `map_json`/`map_hash` bị sửa tay hoặc
 * JSON hỏng thì `error` khác null — nơi gọi PHẢI dừng, không được chạy bot với map khác.
 *
 * @param {{ map_json?: string|null, map_hash?: string|null, eventMapJson?: string|null }} input
 * @returns {{ map: object|null, hash: string|null, source: 'match'|'event'|'none'|'invalid',
 *            error: string|null }}
 */
export function resolveMatchMap({ map_json: snapshotJson, map_hash: snapshotHash, eventMapJson } = {}) {
  try {
    const raw = snapshotJson ?? eventMapJson;
    if (raw === null || raw === undefined || raw === '') {
      return { map: null, hash: null, source: 'none', error: null };
    }
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const map = normalizeMap(parsed);
    const hash = mapHash(map);
    const source = snapshotJson ? 'match' : 'event';
    if (snapshotHash && snapshotHash !== hash) {
      return {
        map,
        hash,
        source,
        error: `map_hash của ván (${snapshotHash}) không khớp snapshot (${hash})`,
      };
    }
    return { map, hash, source, error: null };
  } catch (error) {
    return { map: null, hash: null, source: 'invalid', error: `không đọc được snapshot map: ${error.message}` };
  }
}
