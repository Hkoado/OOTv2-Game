/**
 * liveView.js — Hàm thuần cho trang khán giả: đọc hash `#/live[/matchId]`, gộp event
 * poll về và chuyển event live sang dạng `buildReplayFrames` hiểu được.
 *
 * Không đọc DOM, không gọi API → test bằng `node --test`.
 */

const LIVE_HASH_PATTERN = /^#\/live(?:\/([A-Za-z0-9_-]{1,64}))?\/?$/u;

/** `#/live` hoặc `#/live/<matchId>`; mọi hash khác trả `{ live: false }`. */
export function parseLiveHash(hash) {
  const match = LIVE_HASH_PATTERN.exec(typeof hash === 'string' ? hash : '');
  return match ? { live: true, matchId: match[1] || null } : { live: false, matchId: null };
}

/** Gộp event mới vào danh sách cũ theo `seq` (chống trùng khi poll lặp). */
export function appendLiveEvents(current, incoming) {
  if (!Array.isArray(incoming) || incoming.length === 0) return Array.isArray(current) ? current : [];
  const bySeq = new Map();
  for (const event of Array.isArray(current) ? current : []) {
    if (Number.isInteger(event?.seq)) bySeq.set(event.seq, event);
  }
  for (const event of incoming) {
    if (Number.isInteger(event?.seq)) bySeq.set(event.seq, event);
  }
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

/** Chỉ lấy event nước đi, đổi payload live về đúng field engine/replay dùng. */
export function toReplayEvents(events) {
  return (Array.isArray(events) ? events : [])
    .filter((event) => event?.kind === 'move' && event.payload && Number.isInteger(event.seq))
    .sort((a, b) => a.seq - b.seq)
    .map((event) => ({
      player: event.payload.player,
      piece_id: event.payload.piece_id,
      from: event.payload.from,
      to: event.payload.to,
      captured_piece_id: event.payload.captured_piece_id || null,
    }));
}

/** Payload của event kết thúc (nếu worker đã ghi), dùng để hiện kết quả ngay. */
export function findTerminal(events) {
  const list = Array.isArray(events) ? events : [];
  for (let index = list.length - 1; index >= 0; index -= 1) {
    if (list[index]?.kind === 'terminal') return list[index].payload || null;
  }
  return null;
}

export function moveCount(events) {
  return (Array.isArray(events) ? events : []).filter((event) => event?.kind === 'move').length;
}

/** Nhãn trạng thái ngắn cho badge của trang live. */
export function liveStateLabel({ status, hasInitial } = {}) {
  if (status === 'finished') return 'Đã kết thúc';
  if (status === 'running') return hasInitial ? 'Đang thi đấu' : 'Đang xếp quân';
  return 'Sắp bắt đầu';
}

/** Đồng hồ từ lúc ván bắt đầu (mm:ss); trả '—' nếu thiếu dữ liệu. */
export function formatElapsed(startedAt, now = Date.now()) {
  const start = Date.parse(startedAt || '');
  if (!Number.isFinite(start)) return '—';
  const seconds = Math.max(0, Math.floor((now - start) / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export default { parseLiveHash, appendLiveEvents, toReplayEvents, findTerminal, moveCount, liveStateLabel, formatElapsed };
