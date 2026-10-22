/**
 * judgeView.js — Hàm THUẦN dựng "mặt quan sát chấm bài" từ dữ liệu đã đọc.
 *
 * - Không truy cập DB, không đọc file, không gọi mạng → test bằng `node --test`.
 * - Dùng chung cho driver SQLite (`services/judgeMonitor.js`) và Supabase
 *   (`shared/judgeMonitor.js`) để hai đường chạy trả cùng một shape cho UI.
 * - Chỉ trả nhãn đội, kết quả, lý do và ghi chú đã lọc; KHÔNG trả source code,
 *   hash, storage path hay đường dẫn tuyệt đối của máy chấm.
 */

import { REASONS } from '../judge/gameAdapter.js';

export const STAGE_ORDER = Object.freeze(['group', 'semifinal', 'final']);

/** Lý do kết thúc trận được coi là "sự cố cần xem lại" (bot lỗi hoặc lỗi hạ tầng). */
export const FAILURE_REASONS = Object.freeze([
  REASONS.FORFEIT_SETUP,
  REASONS.FORFEIT_MOVE,
  REASONS.INTERNAL_ERROR,
]);

const FAILURE_SET = new Set(FAILURE_REASONS);

/** Giới hạn hiển thị để log không phình DB/HTTP response. */
export const MAX_NOTE_CHARS = 400;
export const MAX_NOTES = 20;
export const RECENT_LIMIT = 8;
export const ISSUE_LIMIT = 12;
/** Worker bị coi là "mất tín hiệu" sau ngưỡng này (tối thiểu 10 s). */
export const MIN_STALE_MS = 10000;

// Đường dẫn Windows (`C:\...`, `\\server\...`) và POSIX (`/home/...`, `/tmp/...`).
const ABSOLUTE_PATH = /(?:[A-Za-z]:\\|\\\\)[^\s"'<>|]+|\/(?:[\w.@-]+\/)+[\w.@-]+/g;

/** Bỏ đường dẫn tuyệt đối, gộp xuống dòng và cắt độ dài trước khi lưu hoặc trả về UI. */
export function sanitizeNote(value) {
  const text = typeof value === 'string' ? value : value == null ? '' : String(value);
  const cleaned = text
    .replace(ABSOLUTE_PATH, '[path]')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return cleaned.length > MAX_NOTE_CHARS ? `${cleaned.slice(0, MAX_NOTE_CHARS)}…` : cleaned;
}

/** Chuẩn hoá notes (mảng hoặc JSON string đã lưu) thành mảng chuỗi an toàn để hiển thị. */
export function decodeNotes(value) {
  let parsed = value;
  if (typeof value === 'string') {
    if (!value) return [];
    try {
      parsed = JSON.parse(value);
    } catch {
      return [sanitizeNote(value)].filter(Boolean);
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.map(sanitizeNote).filter(Boolean).slice(0, MAX_NOTES);
}

function timestamp(value) {
  const time = Date.parse(value || '');
  return Number.isFinite(time) ? time : null;
}

/** Thời gian chấm 1 ván (ms): đang chạy tính tới hiện tại, đã xong tính tới `finished_at`. */
export function elapsedMs(match, nowMs = Date.now()) {
  const start = timestamp(match?.started_at);
  if (start === null) return null;
  const end = timestamp(match?.finished_at) ?? (match?.status === 'running' ? nowMs : null);
  if (end === null) return null;
  return Math.max(0, end - start);
}

function viewLog(log) {
  if (!log) return null;
  const notes = decodeNotes(log.notes_json ?? log.notes);
  const error = log.error ? sanitizeNote(log.error) : null;
  return {
    notes,
    error: error || null,
    worker: typeof log.worker === 'string' && log.worker ? log.worker : null,
    elapsed_ms: Number.isFinite(log.elapsed_ms) ? Math.max(0, Math.round(log.elapsed_ms)) : null,
    created_at: log.created_at || null,
  };
}

/**
 * Chuẩn hoá 1 match (SQLite row có `red_name`/`blue_name`, Supabase view có `red.name`) về shape UI.
 * `log` là row của bảng `match_logs` (null với ván chấm trước khi bật nhật ký).
 */
export function matchView(match, { nowMs = Date.now(), log = null } = {}) {
  return {
    id: match.id,
    stage: match.stage,
    series_id: match.series_id,
    game_no: match.game_no,
    status: match.status,
    result: match.result ?? null,
    reason: match.reason ?? null,
    ply_count: match.ply_count ?? null,
    red: { name: match.red?.name ?? match.red_name ?? '—' },
    blue: { name: match.blue?.name ?? match.blue_name ?? '—' },
    started_at: match.started_at ?? null,
    finished_at: match.finished_at ?? null,
    elapsed_ms: elapsedMs(match, nowMs),
    failed: FAILURE_SET.has(match.reason),
    log: viewLog(log),
  };
}

/** Trạng thái worker: còn sống khi nhịp tim gần nhất nằm trong ngưỡng cho phép. */
export function workerView(worker, { nowMs = Date.now(), staleAfterMs = MIN_STALE_MS } = {}) {
  if (!worker) return null;
  const beat = timestamp(worker.heartbeat_at);
  return {
    id: typeof worker.id === 'string' && worker.id ? worker.id : null,
    heartbeat_at: worker.heartbeat_at || null,
    last_match_id: worker.last_match_id || null,
    alive: beat !== null ? nowMs - beat <= staleAfterMs : Boolean(worker.alive),
    stale_after_ms: staleAfterMs,
  };
}

function byStartAsc(a, b) {
  return (timestamp(a.started_at) ?? 0) - (timestamp(b.started_at) ?? 0);
}

function byFinishDesc(a, b) {
  return (timestamp(b.finished_at) ?? 0) - (timestamp(a.finished_at) ?? 0);
}

function emptyCounts() {
  return { total: 0, pending: 0, running: 0, finished: 0, failed: 0 };
}

function addCount(bucket, match) {
  bucket.total += 1;
  if (match.status === 'pending') bucket.pending += 1;
  if (match.status === 'running') bucket.running += 1;
  if (match.status === 'finished') {
    bucket.finished += 1;
    if (match.failed) bucket.failed += 1;
  }
}

/**
 * Dựng payload cho `GET /api/local/admin/judge`.
 * `matches` là mảng row thô, `logs` là Map(match_id → row `match_logs`).
 */
export function buildJudgeOverview({
  driver = 'sqlite',
  event = null,
  matches = [],
  logs = null,
  worker = null,
  nowMs = Date.now(),
  staleAfterMs = MIN_STALE_MS,
  limits = {},
  logsAvailable = true,
} = {}) {
  const views = matches.map((match) => matchView(match, { nowMs, log: logs?.get?.(match.id) || null }));

  const counts = emptyCounts();
  for (const match of views) addCount(counts, match);

  const stages = STAGE_ORDER.map((stage) => {
    const bucket = { stage, ...emptyCounts() };
    for (const match of views) if (match.stage === stage) addCount(bucket, match);
    return bucket;
  });

  const active = views.filter((match) => match.status === 'running').sort(byStartAsc);
  const finished = views.filter((match) => match.status === 'finished').sort(byFinishDesc);

  return {
    driver,
    generated_at: new Date(nowMs).toISOString(),
    event: event
      ? {
          id: event.id,
          name: event.name,
          status: event.status,
          started_at: event.started_at || null,
          finished_at: event.finished_at || null,
        }
      : null,
    counts,
    stages,
    active,
    recent: finished.slice(0, RECENT_LIMIT),
    issues: finished.filter((match) => match.failed).slice(0, ISSUE_LIMIT),
    worker: workerView(worker, { nowMs, staleAfterMs }),
    limits,
    logs_available: logsAvailable !== false,
  };
}

/** Dựng payload cho `GET /api/local/admin/judge/matches/:id`. */
export function buildMatchLog({ match, log = null, nowMs = Date.now() } = {}) {
  return {
    match: matchView(match, { nowMs, log }),
    replay_available: Boolean(match?.status === 'finished'),
  };
}

export default {
  buildJudgeOverview,
  buildMatchLog,
  matchView,
  workerView,
  sanitizeNote,
  decodeNotes,
  elapsedMs,
  FAILURE_REASONS,
  STAGE_ORDER,
};
