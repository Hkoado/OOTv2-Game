/**
 * live.js — Dữ liệu xem trực tiếp (`/api/live`) trên Supabase.
 *
 * Thay `services/liveEvents.js` (SQLite). Bảng `mvp_match_events`,
 * `mvp_match_bot_output`, `mvp_worker_state` do migration
 * `20261023120000_live_stream.sql` tạo; chỉ `service_role` đọc/ghi, API là cửa
 * duy nhất ra ngoài (L1 công khai, L2 gate theo phiên).
 *
 * Mọi ghi là "best effort": lỗi ghi live KHÔNG được làm hỏng kết quả ván đấu,
 * nên worker bọc các lời gọi này trong try/catch.
 */

import config from '../config.js';
import { insert, remove, request, rows } from './client.js';
import { RUNNING_STATUSES } from '../lib/tournamentFormat.js';
import {
  BOT_SIDES,
  BOT_STREAMS,
  computeWorkerState,
  normalizeLimit,
  shapeEventRow,
  splitOutputChunk,
} from '../services/liveView.js';

const nowIso = () => new Date().toISOString();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (value) => typeof value === 'string' && UUID_RE.test(value);

/** Xoá dữ liệu live cũ rồi ghi mốc seq=0 (thế trận sau khi hai đội xếp quân). */
export async function startLiveMatch(matchId, { initialPieces = [], seed = null } = {}) {
  await remove('match_events', `match_id=eq.${matchId}`);
  await remove('match_bot_output', `match_id=eq.${matchId}`);
  await insert('match_events', {
    match_id: matchId,
    seq: 0,
    kind: 'initial',
    payload_json: JSON.stringify({ seed, initial_pieces: initialPieces }),
    created_at: nowIso(),
  });
}

/** Ghi một nước đi; `seq` = số thứ tự nước (1..MAX_PLIES), ghi lại được (upsert). */
export async function recordLiveMove(matchId, { ply, event }) {
  if (!Number.isInteger(ply) || ply < 1 || !event) return false;
  await request('/rest/v1/mvp_match_events', {
    method: 'POST',
    body: {
      match_id: matchId,
      seq: ply,
      kind: 'move',
      payload_json: JSON.stringify({ ply, ...event }),
      created_at: nowIso(),
    },
    // Ván bị chạy lại ghi đè đúng nước cũ thay vì nhân đôi event.
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
  });
  return true;
}

async function lastEvent(matchId) {
  const [last] = await rows('match_events', `match_id=eq.${matchId}&select=seq,kind&order=seq.desc&limit=1`);
  return last || null;
}

/** Ghi mốc kết thúc (một lần); gọi lại không tạo thêm event. */
export async function recordLiveTerminal(matchId, { result = null, reason = null, ply_count = 0 } = {}) {
  const last = await lastEvent(matchId);
  if (last?.kind === 'terminal') return false;
  await insert('match_events', {
    match_id: matchId,
    seq: (last?.seq ?? 0) + 1,
    kind: 'terminal',
    payload_json: JSON.stringify({ result, reason, ply_count }),
    created_at: nowIso(),
  });
  return true;
}

/**
 * Ghi log bot (L2). Chỉ lưu dòng đã lọc, tối đa `botOutputLinesPerMatch` dòng/trận
 * để DB không phình khi bot in nhiều. Worker gọi tuần tự nên đếm là đủ tin cậy.
 */
export async function recordBotOutput(matchId, side, stream, chunk) {
  if (!BOT_SIDES.includes(side) || !BOT_STREAMS.includes(stream)) return 0;
  if (!config.live.botOutput) return 0;
  const lines = splitOutputChunk(chunk, config.live.botOutputLineChars);
  if (!lines.length) return 0;

  const used = (
    await rows('match_bot_output', `match_id=eq.${matchId}&select=id&limit=${config.live.botOutputLinesPerMatch}`)
  ).length;
  const remaining = Math.max(0, config.live.botOutputLinesPerMatch - used);
  if (remaining === 0) return 0;

  const createdAt = nowIso();
  await insert(
    'match_bot_output',
    lines.slice(0, remaining).map((line) => ({ match_id: matchId, side, stream, line, created_at: createdAt }))
  );
  return Math.min(lines.length, remaining);
}

/** Ván có tồn tại không (dùng cho route events, tránh trả mảng rỗng cho id sai). */
export async function liveMatchExists(matchId) {
  if (!isUuid(matchId)) return false;
  return (await rows('matches', `id=eq.${matchId}&select=id`)).length > 0;
}

/** Event công khai của một ván sau `afterSeq` (dùng để poll). */
export async function listLiveEvents(matchId, { afterSeq = 0, limit = config.live.eventsPerRequest } = {}) {
  if (!isUuid(matchId)) return { events: [], latest_seq: 0, reset: false };
  const minSeq = Number.isFinite(Number(afterSeq)) && Number(afterSeq) > 0 ? Math.floor(Number(afterSeq)) : -1;
  const safeLimit = normalizeLimit(limit, { fallback: config.live.eventsPerRequest });
  const found = await rows(
    'match_events',
    `match_id=eq.${matchId}&seq=gt.${minSeq}&select=seq,kind,payload_json&order=seq.asc&limit=${safeLimit}`
  );
  const events = found.map(shapeEventRow).filter(Boolean);
  const latest = await lastEvent(matchId);
  const latestSeq = Number.isFinite(Number(latest?.seq)) ? Number(latest.seq) : 0;

  return {
    events,
    latest_seq: latestSeq,
    // Client poll chậm hơn vòng đời ván (hoặc ván bị chạy lại) → cần tải lại snapshot.
    reset: afterSeq > latestSeq,
  };
}

async function namesByEntry(entries) {
  if (!entries.length) return new Map();
  const ids = [...new Set(entries.map((entry) => entry.participant_id))];
  const teams = await rows('participants', `id=in.(${ids.join(',')})&select=id,name`);
  const names = new Map(teams.map((team) => [team.id, team.name]));
  return new Map(entries.map((entry) => [entry.id, names.get(entry.participant_id) || '—']));
}


/** Snapshot công khai của một ván: chỉ field whitelist, không lộ log/ghi chú/đường dẫn. */
export async function getLiveMatchSnapshot(matchId) {
  if (!isUuid(matchId)) return null;
  const [match] = await rows('matches', `id=eq.${matchId}&select=*`);
  if (!match) return null;

  const entries = await rows(
    'tournament_entries',
    `id=in.(${match.red_entry_id},${match.blue_entry_id})&select=id,participant_id`
  );
  const names = await namesByEntry(entries);
  const [tournament] = await rows('tournaments', `id=eq.${match.tournament_id}&select=id,name,status,map_json`);
  const [initial] = await rows(
    'match_events',
    `match_id=eq.${match.id}&kind=eq.initial&select=payload_json&order=seq.asc&limit=1`
  );
  let initialPayload = null;
  try {
    initialPayload = initial ? JSON.parse(initial.payload_json) : null;
  } catch {
    initialPayload = null;
  }
  const last = await lastEvent(match.id);
  let map = null;
  try {
    map = tournament?.map_json ? JSON.parse(tournament.map_json) : null;
  } catch {
    map = null;
  }

  return {
    match: {
      id: match.id,
      stage: match.stage,
      series_id: match.series_id,
      game_no: match.game_no,
      seed: Number(match.seed),
      status: match.status,
      result: match.result,
      reason: match.reason,
      ply_count: match.ply_count,
      started_at: match.started_at,
      finished_at: match.finished_at,
      red: { name: names.get(match.red_entry_id) || '—' },
      blue: { name: names.get(match.blue_entry_id) || '—' },
      tournament: {
        id: tournament?.id || match.tournament_id,
        name: tournament?.name || '—',
        status: tournament?.status || null,
      },
    },
    map,
    live: {
      latest_seq: Number.isFinite(Number(last?.seq)) ? Number(last.seq) : 0,
      has_initial: Boolean(initialPayload),
      initial_pieces: Array.isArray(initialPayload?.initial_pieces) ? initialPayload.initial_pieces : [],
      // Replay chỉ dùng khi ván đã xong mà chưa kịp có event live (dữ liệu cũ).
      replay_available: match.status === 'finished' && Boolean(match.replay_json),
    },
  };
}

function pickTournament(events) {
  const running = events
    .filter((event) => RUNNING_STATUSES.includes(event.status))
    .sort((a, b) => (Date.parse(b.started_at || 0) || 0) - (Date.parse(a.started_at || 0) || 0))[0];
  if (running) return running;
  // Không có giải đang chạy: hiển thị giải gần nhất để khán giả xem lại kết quả.
  return [...events].sort(
    (a, b) =>
      (Date.parse(b.finished_at || b.started_at || b.created_at || 0) || 0) -
        (Date.parse(a.finished_at || a.started_at || a.created_at || 0) || 0) ||
      String(a.id).localeCompare(b.id)
  )[0];
}

async function workerRow(runningMatches) {
  try {
    const [beat] = await rows('worker_state', 'select=worker_id,heartbeat_at&order=heartbeat_at.desc&limit=1');
    if (beat) return beat;
  } catch {
    // Migration live chưa chạy: fallback theo lease của ván đang chấm.
  }
  const running = runningMatches.find((match) => match.worker_id && match.lease_until);
  return running ? { worker_id: running.worker_id, heartbeat_at: running.lease_until } : null;
}

/** Tổng quan công khai: giải đang chạy (hoặc giải gần nhất) + các ván đang đấu. */
export async function getLiveOverview({ now = Date.now() } = {}) {
  const events = await rows('tournaments', 'select=id,name,status,started_at,finished_at,created_at');
  const tournament = pickTournament(events);

  if (!tournament) {
    return {
      server_time: nowIso(),
      event: null,
      matches: [],
      recent_finished: [],
      counts: { total: 0, finished: 0, running: 0, pending: 0 },
      worker: computeWorkerState(await workerRow([]), { now }),
    };
  }

  const matches = await rows(
    'matches',
    `tournament_id=eq.${tournament.id}&select=id,stage,series_id,game_no,seed,status,result,reason,ply_count,started_at,finished_at,red_entry_id,blue_entry_id,worker_id,lease_until`
  );
  const entries = await rows('tournament_entries', `tournament_id=eq.${tournament.id}&select=id,participant_id`);
  const names = await namesByEntry(entries);

  const counts = { total: 0, finished: 0, running: 0, pending: 0 };
  for (const match of matches) {
    counts[match.status] = (counts[match.status] || 0) + 1;
    counts.total += 1;
  }

  const runningMatches = matches
    .filter((match) => match.status === 'running')
    .sort((a, b) => (Date.parse(a.started_at || 0) || 0) - (Date.parse(b.started_at || 0) || 0));

  // Đếm nước đã ghi cho các ván đang chấm (một query, gộp trong JS).
  const livePlies = new Map();
  if (runningMatches.length) {
    const ids = runningMatches.map((match) => match.id).join(',');
    const moves = await rows('match_events', `match_id=in.(${ids})&kind=eq.move&select=match_id`);
    for (const move of moves) livePlies.set(move.match_id, (livePlies.get(move.match_id) || 0) + 1);
  }

  const side = (entryId) => ({ name: names.get(entryId) || '—' });

  return {
    server_time: nowIso(),
    event: {
      id: tournament.id,
      name: tournament.name,
      status: tournament.status,
      started_at: tournament.started_at,
      finished_at: tournament.finished_at,
    },
    matches: runningMatches.map((match) => ({
      id: match.id,
      stage: match.stage,
      series_id: match.series_id,
      game_no: match.game_no,
      seed: Number(match.seed),
      started_at: match.started_at,
      ply: livePlies.get(match.id) || 0,
      red: side(match.red_entry_id),
      blue: side(match.blue_entry_id),
    })),
    recent_finished: matches
      .filter((match) => match.status === 'finished')
      .sort((a, b) => (Date.parse(b.finished_at || b.started_at || 0) || 0) - (Date.parse(a.finished_at || a.started_at || 0) || 0))
      .slice(0, 8)
      .map((match) => ({
        id: match.id,
        stage: match.stage,
        series_id: match.series_id,
        game_no: match.game_no,
        status: match.status,
        result: match.result,
        reason: match.reason,
        ply_count: match.ply_count,
        finished_at: match.finished_at,
        red: side(match.red_entry_id),
        blue: side(match.blue_entry_id),
      })),
    counts,
    worker: computeWorkerState(await workerRow(runningMatches), { now }),
  };
}


/**
 * Log bot của một ván. `side = null` chỉ dành cho admin (xem cả hai bên).
 * Caller (route) chịu trách nhiệm kiểm tra quyền trước khi gọi.
 */
export async function listBotOutput(matchId, { side = null, afterId = 0, limit = 200 } = {}) {
  const safeSide = BOT_SIDES.includes(side) ? side : null;
  const safeAfter = Number.isFinite(Number(afterId)) && Number(afterId) > 0 ? Number(afterId) : 0;
  const safeLimit = normalizeLimit(limit, { fallback: 200, max: 500 });
  if (!isUuid(matchId)) return { side: safeSide, lines: [], next_after_id: safeAfter };

  const filter = `match_id=eq.${matchId}${safeSide ? `&side=eq.${safeSide}` : ''}&id=gt.${safeAfter}`;
  const lines = await rows(
    'match_bot_output',
    `${filter}&select=id,side,stream,line,created_at&order=id.asc&limit=${safeLimit}`
  );

  return {
    side: safeSide,
    lines,
    next_after_id: lines.length ? lines[lines.length - 1].id : safeAfter,
  };
}

/** Dọn event/log của các giải đã kết thúc quá `keepDays` ngày (worker gọi khi boot). */
export async function pruneLiveHistory({ keepDays = 2, now = Date.now() } = {}) {
  const cutoff = new Date(now - keepDays * 24 * 60 * 60 * 1000).toISOString();
  const finished = await rows('tournaments', `status=eq.finished&finished_at=lt.${cutoff}&select=id`);
  if (!finished.length) return { events: 0, output: 0 };
  const matches = await rows('matches', `tournament_id=in.(${finished.map((event) => event.id).join(',')})&select=id`);
  if (!matches.length) return { events: 0, output: 0 };
  const scope = `match_id=in.(${matches.map((match) => match.id).join(',')})`;
  const events = await request(`/rest/v1/mvp_match_events?${scope}`, { method: 'DELETE' });
  const output = await request(`/rest/v1/mvp_match_bot_output?${scope}`, { method: 'DELETE' });
  return {
    events: Array.isArray(events) ? events.length : 0,
    output: Array.isArray(output) ? output.length : 0,
  };
}

/** Worker ghi nhịp tim để trang xem trực tiếp biết "đang chấm" (best effort). */
export async function heartbeatLiveWorker(workerId, matchId = null) {
  await request('/rest/v1/mvp_worker_state', {
    method: 'POST',
    body: { worker_id: workerId, heartbeat_at: nowIso(), match_id: matchId },
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
  });
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
  heartbeatLiveWorker,
};
