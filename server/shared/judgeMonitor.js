/**
 * judgeMonitor.js (shared/Supabase) — Mặt quan sát chấm bài cho portal admin.
 * Đọc bằng service role nhưng API vẫn gate `requireLocalAdmin`,
 * nên đội thi không bao giờ nhận được nhật ký chấm.
 *
 * Bảng `mvp_match_logs` do migration `20261022150000_judge_monitor.sql` tạo. Nếu
 * migration chưa chạy, phần đọc trả `logs_available: false` thay vì làm sập trang.
 */

import config from '../config.js';
import { HttpError } from '../lib/httpError.js';
import { insert, rows, uuid } from './client.js';
import { MIN_STALE_MS, buildJudgeOverview, buildMatchLog, decodeNotes, sanitizeNote } from '../services/judgeView.js';

const RUNNING = ['group_running', 'semifinal_running', 'final_running'];
/** Lease của `mvp_claim` là 60 s, heartbeat 10 s → 30 s không nhịp là mất tín hiệu. */
export const SHARED_WORKER_STALE_MS = Math.max(MIN_STALE_MS, 30000);

const LIMITS = Object.freeze({
  max_plies: config.limits.maxPlies,
  setup_timeout_ms: config.limits.setupTimeoutMs,
  move_timeout_ms: config.limits.moveTimeoutMs,
  max_source_bytes: config.limits.maxSourceBytes,
  worker_poll_ms: config.limits.workerPollMs,
});

const MATCH_FIELDS = 'id,tournament_id,stage,series_id,game_no,status,result,reason,ply_count,started_at,finished_at,red_entry_id,blue_entry_id,worker_id,lease_until';

async function namesByEntry(eventId) {
  const [entries, participants] = await Promise.all([
    rows('tournament_entries', `tournament_id=eq.${eventId}&select=id,participant_id`),
    rows('participants', 'select=id,name'),
  ]);
  const names = new Map(participants.map((row) => [row.id, row.name]));
  return new Map(entries.map((row) => [row.id, names.get(row.participant_id) || '—']));
}

function shapeMatch(match, entryNames) {
  return {
    ...match,
    red: { name: entryNames.get(match.red_entry_id) || '—' },
    blue: { name: entryNames.get(match.blue_entry_id) || '—' },
  };
}

/** Đọc nhật ký của danh sách ván; lỗi migration/chưa có bảng → coi như chưa có log. */
async function logsFor(matchIds) {
  const logs = new Map();
  if (!matchIds.length) return { logs, ok: true };
  try {
    const found = await rows('match_logs', `match_id=in.(${matchIds.join(',')})`);
    for (const row of found) logs.set(row.match_id, row);
    return { logs, ok: true };
  } catch {
    return { logs, ok: false };
  }
}

function workerInfo(matches, nowMs) {
  const running = matches.find((match) => match.status === 'running' && match.worker_id);
  if (running) {
    return {
      id: running.worker_id,
      heartbeat_at: running.lease_until,
      last_match_id: running.id,
      alive: Date.parse(running.lease_until || '') > nowMs,
    };
  }
  const last = [...matches]
    .filter((match) => match.worker_id)
    .sort((a, b) => (Date.parse(b.finished_at || 0) || 0) - (Date.parse(a.finished_at || 0) || 0))[0];
  if (!last) return null;
  return { id: last.worker_id, heartbeat_at: last.lease_until || last.finished_at, last_match_id: last.id, alive: false };
}

async function pickEvent(eventId) {
  const events = await rows('tournaments', 'select=id,name,status,started_at,finished_at,created_at&order=created_at.desc');
  if (eventId) {
    uuid(eventId);
    const found = events.find((event) => event.id === eventId);
    if (!found) throw new HttpError(404, 'tournament_not_found', 'Không tìm thấy giải.');
    return found;
  }
  return events.find((event) => RUNNING.includes(event.status)) || events[0] || null;
}

/** Tổng hợp trạng thái chấm cho portal admin (chế độ DB chung). */
export async function getSharedJudgeOverview({ eventId = null } = {}) {
  const event = await pickEvent(eventId);
  if (!event) {
    return buildJudgeOverview({
      driver: 'supabase',
      staleAfterMs: SHARED_WORKER_STALE_MS,
      limits: LIMITS,
    });
  }
  const matches = await rows('matches', `tournament_id=eq.${event.id}&select=${MATCH_FIELDS}&order=stage,series_id,game_no`);
  const entryNames = await namesByEntry(event.id);
  const shaped = matches.map((match) => shapeMatch(match, entryNames));
  const { logs, ok } = await logsFor(shaped.map((match) => match.id));
  return buildJudgeOverview({
    driver: 'supabase',
    event,
    matches: shaped,
    logs,
    worker: workerInfo(matches, Date.now()),
    staleAfterMs: SHARED_WORKER_STALE_MS,
    limits: LIMITS,
    logsAvailable: ok,
  });
}

/** Chi tiết nhật ký 1 ván (chế độ DB chung). */
export async function getSharedJudgeMatch(matchId) {
  uuid(matchId);
  const [match] = await rows('matches', `id=eq.${matchId}&select=${MATCH_FIELDS}`);
  if (!match) throw new HttpError(404, 'match_not_found', 'Không tìm thấy ván đấu.');
  const entryNames = await namesByEntry(match.tournament_id);
  const { logs } = await logsFor([match.id]);
  return buildMatchLog({ match: shapeMatch(match, entryNames), log: logs.get(match.id) || null });
}

/**
 * Worker ghi nhật ký sau khi `mvp_finish` nhận kết quả. Best-effort: lỗi log không
 * được biến thành lỗi trận (kết quả đã được ghi atomic trong DB).
 */
export async function recordSharedMatchLog({ matchId, notes = [], error = null, worker = null, elapsedMs = null }) {
  const payload = decodeNotes(notes);
  const firstError = typeof error === 'string' && error.trim() ? sanitizeNote(error) : null;
  await insert('match_logs', {
    match_id: matchId,
    notes_json: JSON.stringify(payload),
    error: firstError,
    worker: worker || null,
    elapsed_ms: Number.isFinite(elapsedMs) ? Math.max(0, Math.round(elapsedMs)) : null,
    created_at: new Date().toISOString(),
  });
  return payload;
}

export default { getSharedJudgeOverview, getSharedJudgeMatch, recordSharedMatchLog };
