import { randomInt as cryptoRandomInt } from 'node:crypto';

/**
 * PRNG có seed (mulberry32) dùng cho các quyết định của judge cần tính "ngẫu nhiên"
 * nhưng phải tái lập được: seed của từng match, chia bảng...
 *
 * KHÔNG dùng cho luật chơi của engine. Mọi giá trị seed đều được lưu trong DB chung
 * (`mvp_matches.seed`, `mvp_tournaments.seed`) nên replay luôn tái lập được.
 */
export function createRng(seed) {
  let state = (Number(seed) >>> 0) || 1;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Số nguyên trong [minInclusive, maxInclusive] lấy từ PRNG có seed. */
export function randomInt(rng, minInclusive, maxInclusive) {
  return minInclusive + Math.floor(rng() * (maxInclusive - minInclusive + 1));
}

/**
 * Sinh seed mới cho một thao tác. Dùng crypto.randomInt thay vì Math.random(),
 * và giá trị trả về luôn được ghi lại vào DB trước khi dùng cho trận đấu.
 */
export function randomSeed() {
  return cryptoRandomInt(1, 0x7fffffff);
}

/**
 * Hash FNV-1a 32-bit của một chuỗi. Dùng để biến khoá tất định
 * (ví dụ `group:A:1-2:1`) thành số seed ổn định.
 */
export function hashStringToSeed(value) {
  let hash = 2166136261 >>> 0;
  const text = String(value);
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Sinh seed con tất định từ seed gốc + khoá. Cùng input luôn cho cùng output,
 * nên chạy lại một match sau crash vẫn dùng đúng seed cũ.
 */
export function deriveSeed(baseSeed, ...parts) {
  let mixed = ((Number(baseSeed) >>> 0) ^ hashStringToSeed(parts.join(':'))) >>> 0;
  mixed = Math.imul(mixed ^ (mixed >>> 16), 2246822507) >>> 0;
  mixed = Math.imul(mixed ^ (mixed >>> 13), 3266489909) >>> 0;
  mixed = (mixed ^ (mixed >>> 16)) >>> 0;
  return mixed % 0x7fffffff || 1;
}

