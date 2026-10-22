/**
 * liveView.js — Hàm thuần (không DB, không Express) cho phần xem trực tiếp.
 *
 * Hai lớp dữ liệu theo yêu cầu:
 * - L1 công khai: thế trận + nước đi do engine sinh ra (không có log bot, ghi chú,
 *   đường dẫn file hay thông tin tài khoản).
 * - L2 riêng tư: stdout/stderr của bot, chỉ đội sở hữu và admin đọc được.
 *
 * Tách hàm thuần để test bằng `node --test` mà không cần mở cổng mạng.
 */

export const LIVE_EVENT_KINDS = Object.freeze(['initial', 'move', 'terminal']);
export const BOT_SIDES = Object.freeze(['red', 'blue']);
export const BOT_STREAMS = Object.freeze(['stdout', 'stderr']);

/** Ký tự điều khiển bị loại khỏi log (giữ tab), tránh phá layout/terminal escape. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu;

/**
 * Chuẩn hoá một dòng log bot: bỏ ký tự điều khiển, cắt theo giới hạn ký tự.
 * Trả về chuỗi rỗng nếu dòng không còn nội dung (bị lọc bỏ).
 */
export function sanitizeOutputLine(raw, maxChars = 400) {
  if (typeof raw !== 'string') return '';
  const cleaned = raw.replace(/\r/gu, '').replace(CONTROL_CHARS, '').trim();
  if (!cleaned) return '';
  const limit = Number.isFinite(maxChars) && maxChars > 0 ? Math.floor(maxChars) : 400;
  return cleaned.length > limit ? `${cleaned.slice(0, limit - 1)}…` : cleaned;
}

/**
 * Tách một chunk stdout/stderr thành các dòng đã chuẩn hoá.
 * Chunk có thể chứa nhiều dòng hoặc dòng bị cắt giữa chừng; dòng rỗng bị bỏ.
 */
export function splitOutputChunk(chunk, maxChars = 400) {
  if (typeof chunk !== 'string' || !chunk) return [];
  return chunk
    .split('\n')
    .map((line) => sanitizeOutputLine(line, maxChars))
    .filter(Boolean);
}

/** `afterSeq` từ query string: số nguyên >= 0, mặc định 0. */
export function normalizeAfterSeq(raw) {
  const value = Number.parseInt(String(raw ?? ''), 10);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** `limit` từ query string, kẹp trong [1, max]; mặc định `fallback`. */
export function normalizeLimit(raw, { fallback = 100, max = 200 } = {}) {
  const value = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(value, max);
}

/** Đọc 1 row `match_events` thành payload public; payload hỏng bị bỏ qua an toàn. */
export function shapeEventRow(row) {
  if (!row || typeof row.seq !== 'number' || !LIVE_EVENT_KINDS.includes(row.kind)) return null;
  let payload = null;
  try {
    payload = JSON.parse(row.payload_json);
  } catch {
    return null;
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  return { seq: row.seq, kind: row.kind, payload };
}

/**
 * Trạng thái worker từ row `worker_state`: chỉ coi là "đang chấm" khi nhịp tim
 * còn mới. `label` là `hostname:pid`, không phải bí mật.
 */
export function computeWorkerState(row, { now = Date.now(), staleMs = 15000 } = {}) {
  if (!row || !row.heartbeat_at) return { alive: false, label: null, heartbeat_at: null, age_ms: null };
  const beat = Date.parse(row.heartbeat_at);
  if (!Number.isFinite(beat)) return { alive: false, label: row.worker_id || null, heartbeat_at: null, age_ms: null };
  const age = Math.max(0, now - beat);
  return {
    alive: age <= staleMs,
    label: row.worker_id || null,
    heartbeat_at: row.heartbeat_at,
    age_ms: age,
  };
}

/** Nhãn stage dùng cho JSON public (FE dịch tiếp sang tiếng Việt). */
export function stageOf(value) {
  return ['group', 'semifinal', 'final'].includes(value) ? value : 'group';
}
