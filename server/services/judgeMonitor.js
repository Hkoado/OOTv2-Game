/**
 * judgeMonitor.js — Mặt quan sát chấm bài cho driver SQLite (local demo/offline).
 *
 * Ghi (worker): `recordMatchLog` lưu ghi chú/lỗi/thời gian chấm; `heartbeatWorker`
 * giữ nhịp tim để UI biết worker còn chạy.
 * Đọc (admin): `getJudgeOverview`, `getJudgeMatch` — chỉ đọc, không trả đường dẫn file.
 */

import config from '../config.js';
import { getDb, nowIso } from '../db.js';
import { notFound } from '../lib/httpError.js';
import { MIN_STALE_MS, buildJudgeOverview, buildMatchLog, sanitizeNote, decodeNotes, MAX_NOTES } from './judgeView.js';

/** Worker bị coi là mất tín hiệu sau 5 chu kỳ poll (tối thiểu 10 s). */
export const WORKER_STALE_MS = Math.max(MIN_STALE_MS, config.limits.workerPollMs * 5);

const LIMITS = Object.freeze({
  max_plies: config.limits.maxPlies,
  setup_timeout_ms: config.limits.setupTimeoutMs,
  move_timeout_ms: config.limits.moveTimeoutMs,
  max_source_bytes: config.limits.maxSourceBytes,
  worker_poll_ms: config.limits.workerPollMs,
});

const MONITOR_SELECT = `
  SELECT m.id, m.tournament_id, m.stage, m.series_id, m.game_no, m.status, m.result, m.reason,
         m.ply_count, m.started_at, m.finished_at,
         rp.name AS red_name, bp.name AS blue_name,
         l.notes_json, l.error, l.worker, l.elapsed_ms, l.created_at AS log_created_at
  FROM matches m
  JOIN tournament_entries re ON re.id = m.red_entry_id
  JOIN participants rp ON rp.id = re.participant_id
  JOIN tournament_entries be ON be.id = m.blue_entry_id
  JOIN participants bp ON bp.id = be.participant_id
  LEFT JOIN match_logs l ON l.match_id = m.id
`;

function toLog(row) {
  if (!row || (row.notes_json == null && row.log_created_at == null)) return null;
  return {
    notes_json: row.notes_json,
    error: row.error,
    worker: row.worker,
    elapsed_ms: row.elapsed_ms,
    created_at: row.log_created_at,
  };
}

function logsOf(rows) {
  const logs = new Map();
  for (const row of rows) {
    const log = toLog(row);
    if (log) logs.set(row.id, log);
  }
  return logs;
}

function selectEvent(eventId) {
  const db = getDb();
  if (eventId) {
    const event = db
      .prepare('SELECT id, name, status, started_at, finished_at FROM tournaments WHERE id = ?')
      .get(eventId);
    if (!event) throw notFound('tournament_not_found', 'Không tìm thấy giải.');
    return event;
  }
  return (
    db
      .prepare(
        `SELECT id, name, status, started_at, finished_at FROM tournaments
         WHERE status IN ('group_running','semifinal_running','final_running')
         ORDER BY started_at, id LIMIT 1`
      )
      .get() ||
    db
      .prepare(
        `SELECT id, name, status, started_at, finished_at FROM tournaments
         ORDER BY created_at DESC, id DESC LIMIT 1`
      )
      .get() ||
    null
  );
}

function latestWorker() {
  return (
    getDb()
      .prepare('SELECT worker_id AS id, heartbeat_at, last_match_id FROM worker_state ORDER BY heartbeat_at DESC LIMIT 1')
      .get() || null
  );
}

/** Cập nhật nhịp tim của worker hiện tại (gọi mỗi vòng poll, kể cả khi không có ván). */
export function heartbeatWorker({ workerId, lastMatchId = null }) {
  if (!workerId) return false;
  const now = nowIso();
  getDb()
    .prepare(
      `INSERT INTO worker_state (worker_id, started_at, heartbeat_at, last_match_id)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(worker_id) DO UPDATE SET
         heartbeat_at = excluded.heartbeat_at,
         last_match_id = COALESCE(excluded.last_match_id, worker_state.last_match_id)`
    )
    .run(workerId, now, now, lastMatchId);
  return true;
}

/**
 * Lưu nhật ký chấm của 1 ván. Gọi trong cùng transaction với `recordResult` để
 * kết quả và nhật ký không bao giờ lệch nhau. Ghi chú được lọc đường dẫn tuyệt đối.
 */
export function recordMatchLog({ matchId, notes = [], error = null, worker = null, elapsedMs = null }) {
  const payload = decodeNotes(notes).slice(0, MAX_NOTES);
  const firstError = typeof error === 'string' && error.trim() ? sanitizeNote(error) : null;
  const elapsed = Number.isFinite(elapsedMs) ? Math.max(0, Math.round(elapsedMs)) : null;
  getDb()
    .prepare(
      `INSERT INTO match_logs (match_id, notes_json, error, worker, elapsed_ms, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(match_id) DO UPDATE SET
         notes_json = excluded.notes_json,
         error = excluded.error,
         worker = excluded.worker,
         elapsed_ms = excluded.elapsed_ms`
    )
    .run(matchId, JSON.stringify(payload), firstError, worker || null, elapsed, nowIso());
  return payload;
}

/** Tổng hợp trạng thái chấm cho portal admin (1 giải đang chạy, hoặc giải gần nhất). */
export function getJudgeOverview({ eventId = null } = {}) {
  const event = selectEvent(eventId);
  if (!event) {
    return buildJudgeOverview({
      driver: 'sqlite',
      limits: LIMITS,
      staleAfterMs: WORKER_STALE_MS,
      worker: latestWorker(),
    });
  }
  const rows = getDb()
    .prepare(
      `${MONITOR_SELECT}
       WHERE m.tournament_id = ?
       ORDER BY CASE m.stage WHEN 'group' THEN 0 WHEN 'semifinal' THEN 1 ELSE 2 END,
                m.series_id, m.game_no`
    )
    .all(event.id);
  return buildJudgeOverview({
    driver: 'sqlite',
    event,
    matches: rows,
    logs: logsOf(rows),
    worker: latestWorker(),
    staleAfterMs: WORKER_STALE_MS,
    limits: LIMITS,
  });
}

/** Chi tiết nhật ký của 1 ván (admin). */
export function getJudgeMatch(matchId) {
  const row = getDb().prepare(`${MONITOR_SELECT} WHERE m.id = ?`).get(matchId);
  if (!row) throw notFound('match_not_found', 'Không tìm thấy ván đấu.');
  return buildMatchLog({ match: row, log: toLog(row) });
}

export { LIMITS as JUDGE_LIMITS };

export default { getJudgeOverview, getJudgeMatch, recordMatchLog, heartbeatWorker };
