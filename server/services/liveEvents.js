/**
 * liveEvents.js — Ghi/đọc dữ liệu xem trực tiếp từ SQLite.
 *
 * - Worker ghi: `startLiveMatch` (thế trận ban đầu), `recordLiveMove` (từng nước),
 *   `recordLiveTerminal` (kết thúc), `recordBotOutput` (log bot, L2).
 * - API đọc: `getLiveOverview`, `getLiveMatchSnapshot`, `listLiveEvents`,
 *   `listBotOutput` (chỉ gọi sau khi route đã kiểm tra quyền).
 *
 * Mọi ghi đều là "best effort": lỗi ghi live KHÔNG được làm hỏng kết quả ván đấu,
 * nên worker bọc các lời gọi này trong try/catch.
 */

import config from '../config.js';
import { getDb, nowIso } from '../db.js';
import {
  BOT_SIDES,
  BOT_STREAMS,
  computeWorkerState,
  normalizeLimit,
  shapeEventRow,
  splitOutputChunk,
} from './liveView.js';

const RUNNING_STATUSES = ['group_running', 'semifinal_running', 'final_running'];

/** Xoá dữ liệu live cũ rồi ghi mốc seq=0 (thế trận sau khi hai đội xếp quân). */
export function startLiveMatch(matchId, { initialPieces = [], seed = null } = {}) {
  const db = getDb();
  const write = db.transaction(() => {
    db.prepare('DELETE FROM match_events WHERE match_id = ?').run(matchId);
    db.prepare('DELETE FROM match_bot_output WHERE match_id = ?').run(matchId);
    db.prepare(
      `INSERT INTO match_events (match_id, seq, kind, payload_json, created_at)
       VALUES (?, 0, 'initial', ?, ?)`
    ).run(matchId, JSON.stringify({ seed, initial_pieces: initialPieces }), nowIso());
  });
  write();
}

/** Ghi một nước đi; `seq` = số thứ tự nước (1..MAX_PLIES), ghi lại được (idempotent). */
export function recordLiveMove(matchId, { ply, event }) {
  if (!Number.isInteger(ply) || ply < 1 || !event) return false;
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO match_events (match_id, seq, kind, payload_json, created_at)
       VALUES (?, ?, 'move', ?, ?)`
    )
    .run(matchId, ply, JSON.stringify({ ply, ...event }), nowIso());
  return true;
}

/** Ghi mốc kết thúc (một lần); gọi lại không tạo thêm event. */
export function recordLiveTerminal(matchId, { result = null, reason = null, ply_count = 0 } = {}) {
  const db = getDb();
  const last = db
    .prepare('SELECT seq, kind FROM match_events WHERE match_id = ? ORDER BY seq DESC LIMIT 1')
    .get(matchId);
  if (last?.kind === 'terminal') return false;
  const seq = (last?.seq ?? 0) + 1;
  db.prepare(
    `INSERT INTO match_events (match_id, seq, kind, payload_json, created_at)
     VALUES (?, ?, 'terminal', ?, ?)`
  ).run(matchId, seq, JSON.stringify({ result, reason, ply_count }), nowIso());
  return true;
}

/**
 * Ghi log bot (L2). Chỉ lưu dòng đã lọc, tối đa `botOutputLinesPerMatch` dòng/trận
 * để DB không phình khi bot in nhiều.
 */
export function recordBotOutput(matchId, side, stream, chunk) {
  if (!BOT_SIDES.includes(side) || !BOT_STREAMS.includes(stream)) return 0;
  const lines = splitOutputChunk(chunk, config.live.botOutputLineChars);
  if (!lines.length) return 0;

  const db = getDb();
  const used = db
    .prepare('SELECT COUNT(*) AS total FROM match_bot_output WHERE match_id = ?')
    .get(matchId).total;
  const remaining = Math.max(0, config.live.botOutputLinesPerMatch - used);
  if (remaining === 0) return 0;

  const insert = db.prepare(
    `INSERT INTO match_bot_output (match_id, side, stream, line, created_at)
     VALUES (?, ?, ?, ?, ?)`
  );
  const write = db.transaction(() => {
    const createdAt = nowIso();
    for (const line of lines.slice(0, remaining)) {
      insert.run(matchId, side, stream, line, createdAt);
    }
  });
  write();
  return Math.min(lines.length, remaining);
}


/** Ván có tồn tại không (dùng cho route events, tránh trả mảng rỗng cho id sai). */
export function liveMatchExists(matchId) {
  return Boolean(getDb().prepare('SELECT 1 FROM matches WHERE id = ?').get(matchId));
}

/** Event công khai của một ván sau `afterSeq` (dùng để poll). */
export function listLiveEvents(matchId, { afterSeq = 0, limit = config.live.eventsPerRequest } = {}) {
  const db = getDb();
  // `initial` nằm ở seq 0 nên lần poll đầu (afterSeq = 0) phải lấy cả seq 0.
  const minSeq = Number.isFinite(Number(afterSeq)) && Number(afterSeq) > 0 ? Math.floor(Number(afterSeq)) : -1;
  const rows = db
    .prepare(
      `SELECT seq, kind, payload_json FROM match_events
       WHERE match_id = ? AND seq > ? ORDER BY seq LIMIT ?`
    )
    .all(matchId, minSeq, normalizeLimit(limit, { fallback: config.live.eventsPerRequest }));

  const events = rows.map(shapeEventRow).filter(Boolean);
  const latest = db
    .prepare('SELECT MAX(seq) AS seq FROM match_events WHERE match_id = ?')
    .get(matchId);
  const latestSeq = Number.isFinite(latest?.seq) ? latest.seq : 0;

  return {
    events,
    latest_seq: latestSeq,
    // Client poll chậm hơn vòng đời ván (hoặc ván bị chạy lại) → cần tải lại snapshot.
    reset: afterSeq > latestSeq,
  };
}

/** Snapshot công khai của một ván: chỉ field whitelist, không lộ log/ghi chú/đường dẫn. */
export function getLiveMatchSnapshot(matchId) {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT m.id, m.stage, m.series_id, m.game_no, m.seed, m.status, m.result, m.reason,
              m.ply_count, m.started_at, m.finished_at, m.replay_json,
              rp.name AS red_name, bp.name AS blue_name,
              t.id AS tournament_id, t.name AS tournament_name, t.status AS tournament_status,
              t.map_json
       FROM matches m
       JOIN tournament_entries re ON re.id = m.red_entry_id
       JOIN participants rp ON rp.id = re.participant_id
       JOIN tournament_entries be ON be.id = m.blue_entry_id
       JOIN participants bp ON bp.id = be.participant_id
       JOIN tournaments t ON t.id = m.tournament_id
       WHERE m.id = ?`
    )
    .get(matchId);
  if (!row) return null;

  const initial = db
    .prepare(
      `SELECT payload_json FROM match_events WHERE match_id = ? AND kind = 'initial' ORDER BY seq LIMIT 1`
    )
    .get(matchId);
  let initialPayload = null;
  try {
    initialPayload = initial ? JSON.parse(initial.payload_json) : null;
  } catch {
    initialPayload = null;
  }

  const latest = db
    .prepare('SELECT MAX(seq) AS seq FROM match_events WHERE match_id = ?')
    .get(matchId);
  const latestSeq = Number.isFinite(latest?.seq) ? latest.seq : 0;

  let map = null;
  try {
    map = row.map_json ? JSON.parse(row.map_json) : null;
  } catch {
    map = null;
  }

  return {
    match: {
      id: row.id,
      stage: row.stage,
      series_id: row.series_id,
      game_no: row.game_no,
      seed: row.seed,
      status: row.status,
      result: row.result,
      reason: row.reason,
      ply_count: row.ply_count,
      started_at: row.started_at,
      finished_at: row.finished_at,
      red: { name: row.red_name },
      blue: { name: row.blue_name },
      tournament: { id: row.tournament_id, name: row.tournament_name, status: row.tournament_status },
    },
    map,
    live: {
      latest_seq: latestSeq,
      has_initial: Boolean(initialPayload),
      initial_pieces: Array.isArray(initialPayload?.initial_pieces) ? initialPayload.initial_pieces : [],
      // Replay chỉ dùng khi ván đã xong mà chưa kịp có event live (dữ liệu cũ).
      replay_available: row.status === 'finished' && Boolean(row.replay_json),
    },
  };
}

/** Tổng quan công khai: giải đang chạy (hoặc giải gần nhất) + các ván đang đấu. */
export function getLiveOverview({ now = Date.now() } = {}) {
  const db = getDb();
  const placeholders = RUNNING_STATUSES.map(() => '?').join(', ');
  let tournament = db
    .prepare(
      `SELECT id, name, status, started_at, finished_at FROM tournaments
       WHERE status IN (${placeholders})
       ORDER BY started_at DESC, id LIMIT 1`
    )
    .get(...RUNNING_STATUSES);

  if (!tournament) {
    // Không có giải đang chạy: hiển thị giải gần nhất để khán giả xem lại kết quả.
    tournament = db
      .prepare(
        `SELECT id, name, status, started_at, finished_at FROM tournaments
         ORDER BY COALESCE(finished_at, started_at) DESC, id LIMIT 1`
      )
      .get();
  }

  const workerRow = db
    .prepare('SELECT worker_id, heartbeat_at, last_match_id FROM worker_state ORDER BY heartbeat_at DESC LIMIT 1')
    .get();

  if (!tournament) {
    return {
      server_time: nowIso(),
      event: null,
      matches: [],
      recent_finished: [],
      counts: { total: 0, finished: 0, running: 0, pending: 0 },
      worker: computeWorkerState(workerRow, { now }),
    };
  }

  const counts = { total: 0, finished: 0, running: 0, pending: 0 };
  for (const row of db
    .prepare('SELECT status, COUNT(*) AS total FROM matches WHERE tournament_id = ? GROUP BY status')
    .all(tournament.id)) {
    counts[row.status] = row.total;
    counts.total += row.total;
  }

  const matchSelect = `
    SELECT m.id, m.stage, m.series_id, m.game_no, m.seed, m.status, m.result, m.reason,
           m.ply_count, m.started_at, m.finished_at,
           rp.name AS red_name, bp.name AS blue_name,
           (SELECT COUNT(*) FROM match_events e WHERE e.match_id = m.id AND e.kind = 'move') AS live_ply
    FROM matches m
    JOIN tournament_entries re ON re.id = m.red_entry_id
    JOIN participants rp ON rp.id = re.participant_id
    JOIN tournament_entries be ON be.id = m.blue_entry_id
    JOIN participants bp ON bp.id = be.participant_id`;

  const running = db
    .prepare(`${matchSelect} WHERE m.tournament_id = ? AND m.status = 'running' ORDER BY m.started_at, m.id`)
    .all(tournament.id)
    .map((row) => ({
      id: row.id,
      stage: row.stage,
      series_id: row.series_id,
      game_no: row.game_no,
      seed: row.seed,
      started_at: row.started_at,
      ply: row.live_ply,
      red: { name: row.red_name },
      blue: { name: row.blue_name },
    }));

  const recentFinished = db
    .prepare(
      `${matchSelect} WHERE m.tournament_id = ? AND m.status = 'finished'
       ORDER BY COALESCE(m.finished_at, m.started_at) DESC, m.id LIMIT 8`
    )
    .all(tournament.id)
    .map((row) => ({
      id: row.id,
      stage: row.stage,
      series_id: row.series_id,
      game_no: row.game_no,
      status: row.status,
      result: row.result,
      reason: row.reason,
      ply_count: row.ply_count,
      finished_at: row.finished_at,
      red: { name: row.red_name },
      blue: { name: row.blue_name },
    }));

  return {
    server_time: nowIso(),
    event: {
      id: tournament.id,
      name: tournament.name,
      status: tournament.status,
      started_at: tournament.started_at,
      finished_at: tournament.finished_at,
    },
    matches: running,
    recent_finished: recentFinished,
    counts,
    worker: computeWorkerState(workerRow, { now }),
  };
}


/**
 * Log bot của một ván. `side = null` chỉ dành cho admin (xem cả hai bên).
 * Caller (route) chịu trách nhiệm kiểm tra quyền trước khi gọi.
 */
export function listBotOutput(matchId, { side = null, afterId = 0, limit = 200 } = {}) {
  const db = getDb();
  const safeSide = BOT_SIDES.includes(side) ? side : null;
  const safeAfter = Number.isFinite(Number(afterId)) && Number(afterId) > 0 ? Number(afterId) : 0;
  const safeLimit = normalizeLimit(limit, { fallback: 200, max: 500 });

  const rows = safeSide
    ? db
        .prepare(
          `SELECT id, side, stream, line, created_at FROM match_bot_output
           WHERE match_id = ? AND side = ? AND id > ? ORDER BY id LIMIT ?`
        )
        .all(matchId, safeSide, safeAfter, safeLimit)
    : db
        .prepare(
          `SELECT id, side, stream, line, created_at FROM match_bot_output
           WHERE match_id = ? AND id > ? ORDER BY id LIMIT ?`
        )
        .all(matchId, safeAfter, safeLimit);

  return {
    side: safeSide,
    lines: rows,
    next_after_id: rows.length ? rows[rows.length - 1].id : safeAfter,
  };
}

/** Dọn event/log của các giải đã kết thúc quá `keepDays` ngày (worker gọi khi boot). */
export function pruneLiveHistory({ keepDays = 2, now = Date.now() } = {}) {
  const cutoff = new Date(now - keepDays * 24 * 60 * 60 * 1000).toISOString();
  const db = getDb();
  const scope = `SELECT id FROM matches WHERE tournament_id IN (
      SELECT id FROM tournaments WHERE status = 'finished' AND finished_at IS NOT NULL AND finished_at < ?
    )`;
  const clean = db.transaction(() => {
    const events = db.prepare(`DELETE FROM match_events WHERE match_id IN (${scope})`).run(cutoff);
    const output = db.prepare(`DELETE FROM match_bot_output WHERE match_id IN (${scope})`).run(cutoff);
    return { events: events.changes, output: output.changes };
  });
  return clean();
}

export default {
  startLiveMatch,
  recordLiveMove,
  recordLiveTerminal,
  recordBotOutput,
  listLiveEvents,
  getLiveMatchSnapshot,
  getLiveOverview,
  listBotOutput,
  pruneLiveHistory,
};

