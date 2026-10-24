/**
 * officialBroadcasts.js — publication cho ván official.
 *
 * Cùng nguyên tắc H3 như `shared/publication.js`: **chấm trước — lưu kín — phát theo lịch**.
 * Một ván official chỉ được đặt lịch khi đã có kết quả accepted; viewer chỉ nhận đúng
 * `visible_plies` nước đã phát và không bao giờ thấy kết quả trước `reveal_result`.
 *
 * Hàm thuần (`trimOfficialReplay`, `officialBroadcastView`, `officialViewerPackage`)
 * test được bằng `node --test`; phần DB tách thành tham số `deps` để test không chạm Supabase.
 */
import { rows, insert, update } from '../shared/client.js';
import { HttpError } from '../lib/httpError.js';
import { assertEventMember, computeBroadcast, isPublished, maxEventSeq, normalizeSchedule }
  from '../shared/publication.js';

export const OFFICIAL_BROADCAST_VERSION = 'official-broadcast.v1';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GAME_KEY_RE = /^[A-Za-z0-9:_-]{1,120}$/;
const fail = (status, code, message) => new HttpError(status, code, message);

export function requireRoundPk(value) {
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    throw fail(400, 'bad_round_id', 'roundPk phải là UUID của vòng official.');
  }
  return value;
}

export function requireGameKey(value) {
  if (typeof value !== 'string' || !GAME_KEY_RE.test(value)) {
    throw fail(400, 'bad_game_key', 'gameKey không hợp lệ.');
  }
  return value;
}

/** Số nước thật của replay (0 nếu chưa có/không hợp lệ). */
export function replayPlyCount(replay) {
  if (!replay || typeof replay !== 'object' || !Array.isArray(replay.events)) return 0;
  return replay.events.length;
}

/**
 * Replay gửi viewer: cắt đúng số nước đã phát. Chưa tới lúc mở kết quả thì bỏ
 * `result`/`terminationReason` và cả `contentHash` (hash của bản đầy đủ, không dùng để
 * xác thực bản đã cắt).
 */
export function trimOfficialReplay(replay, { visiblePlies = 0, reveal = false } = {}) {
  if (!replay || typeof replay !== 'object') return null;
  const events = Array.isArray(replay.events) ? replay.events : [];
  const cap = reveal ? events.length : Math.max(0, Math.min(events.length, Math.floor(Number(visiblePlies) || 0)));
  const { contentHash, result, terminationReason, ...rest } = replay;
  const trimmed = { ...rest, events: events.slice(0, cap) };
  if (reveal) return { ...trimmed, contentHash, result: result ?? null, terminationReason: terminationReason ?? null };
  return { ...trimmed, result: null, terminationReason: null };
}

/** View trạng thái phát: không chứa nước đi và không chứa kết quả. */
export function officialBroadcastView(row, info) {
  return {
    round_id: row.round_pk,
    game_key: row.game_key,
    event_id: row.event_id,
    state: row.state,
    phase: info.phase,
    starts_at: row.starts_at,
    ply_interval_ms: Number(row.ply_interval_ms),
    release_mode: row.release_mode,
    visible_plies: info.visible_plies,
    total_plies: info.total_plies,
    reveal_result: info.reveal_result,
    next_poll_ms: info.next_poll_ms,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    canceled_at: row.canceled_at || null,
  };
}

/**
 * Gói dữ liệu cho viewer: chỉ event `seq` đã tới hạn phát (hoặc toàn bộ khi đã mở).
 * Kết quả chỉ xuất hiện khi `reveal_result = true`.
 */
export function officialViewerPackage({ roundPk, gameKey, game, replay, info, afterSeq = 0 }) {
  if (!isPublished(info)) throw fail(404, 'broadcast_not_published', 'Ván chưa được công bố.');
  const cap = maxEventSeq(info);
  const after = Number.isFinite(Number(afterSeq)) && Number(afterSeq) > 0 ? Math.floor(Number(afterSeq)) : 0;
  const events = (Array.isArray(replay?.events) ? replay.events : [])
    .filter((event) => Number.isInteger(event?.seq) && event.seq > after)
    .filter((event) => cap === Number.POSITIVE_INFINITY || event.seq <= cap);
  const reveal = info.reveal_result === true;
  return {
    schema_version: OFFICIAL_BROADCAST_VERSION,
    round_id: roundPk,
    game_key: gameKey,
    phase: info.phase,
    server_time: info.server_time,
    starts_at: info.starts_at,
    ply_interval_ms: info.ply_interval_ms,
    release_mode: info.release_mode,
    visible_plies: info.visible_plies,
    total_plies: info.total_plies,
    reveal_result: reveal,
    next_poll_ms: info.next_poll_ms,
    events,
    ...(reveal ? { result: game?.result ?? null, replay: trimOfficialReplay(replay, { reveal: true }) } : {}),
  };
}

// ---------- DB ----------
const selectGame = 'game_key,stage,result,replay_hash,recorded_at';

export async function loadOfficialBroadcastContext(roundPk, gameKey) {
  const [round] = await rows('official_rounds', `id=eq.${roundPk}&select=id,event_id,round_id,frozen`);
  if (!round) return null;
  const [game] = await rows('official_games',
    `round_pk=eq.${roundPk}&game_key=eq.${encodeURIComponent(gameKey)}&select=${selectGame}`);
  const [broadcast] = await rows('official_broadcasts',
    `round_pk=eq.${roundPk}&game_key=eq.${encodeURIComponent(gameKey)}`);
  return { round, game: game || null, broadcast: broadcast || null };
}

/** Replay lấy từ attempt `succeeded` mới nhất (nguồn duy nhất có payload replay). */
export async function loadOfficialReplay(roundPk, gameKey) {
  const [attempt] = await rows('official_job_attempts',
    `round_pk=eq.${roundPk}&game_key=eq.${encodeURIComponent(gameKey)}`
    + '&outcome=eq.succeeded&select=attempt,replay&order=attempt.desc&limit=1');
  return attempt?.replay ?? null;
}

async function defaults(roundPk, gameKey) {
  const [context, replay] = await Promise.all([
    loadOfficialBroadcastContext(roundPk, gameKey),
    loadOfficialReplay(roundPk, gameKey),
  ]);
  if (!context) return null;
  return { ...context, replay, totalPlies: replayPlyCount(replay) };
}

/**
 * Đặt/đổi/huỷ lịch phát. Chỉ admin gọi (route đã gate); ván phải có kết quả accepted.
 * `state = canceled` giữ dòng để audit; `ended` đóng lịch và mở toàn bộ.
 */
export async function scheduleOfficialGameBroadcast({ roundPk, gameKey, account, body = {} } = {},
  deps = {}) {
  requireRoundPk(roundPk); requireGameKey(gameKey);
  const load = deps.load || defaults;
  const context = await load(roundPk, gameKey);
  if (!context?.round) throw fail(404, 'round_not_found', 'Không tìm thấy vòng official.');
  if (!context.game) throw fail(404, 'game_not_found', 'Không tìm thấy ván trong vòng.');
  const state = body.state === undefined || body.state === null ? 'scheduled' : String(body.state);
  if (!['scheduled', 'canceled', 'ended'].includes(state)) {
    throw fail(400, 'bad_state', 'state phải là scheduled, canceled hoặc ended.');
  }
  if (state === 'scheduled' && !context.game.result) {
    throw fail(409, 'game_not_scored', 'Chỉ đặt lịch phát cho ván đã chấm xong.');
  }
  const schedule = normalizeSchedule(body);
  const now = Date.now();
  const patch = {
    event_id: context.round.event_id, state, starts_at: schedule.startsAt,
    ply_interval_ms: schedule.plyIntervalMs, release_mode: schedule.releaseMode,
    updated_at: new Date(now).toISOString(),
    canceled_at: state === 'canceled' ? new Date(now).toISOString() : null,
  };
  const save = deps.save || (async (existing) => {
    if (existing) {
      const [row] = await update('official_broadcasts',
        `round_pk=eq.${roundPk}&game_key=eq.${encodeURIComponent(gameKey)}`, patch);
      return row;
    }
    const [row] = await insert('official_broadcasts',
      { round_pk: roundPk, game_key: gameKey, ...patch, created_by: account?.id ?? null });
    return row;
  });
  const row = await save(context.broadcast, patch);
  const saved = row || { round_pk: roundPk, game_key: gameKey, ...patch, created_at: null };
  const info = computeBroadcast(saved, { now, totalPlies: context.totalPlies ?? 0 });
  return { broadcast: officialBroadcastView(saved, info), game: context.game };
}

/** Trạng thái phát của một ván; đội chỉ thấy khi đã công bố (admin thấy cả khi chưa). */
export async function officialBroadcastState({ roundPk, gameKey, account, now = Date.now() } = {},
  deps = {}) {
  requireRoundPk(roundPk); requireGameKey(gameKey);
  const load = deps.load || defaults;
  const member = deps.member || assertEventMember;
  const context = await load(roundPk, gameKey);
  if (!context?.round) throw fail(404, 'round_not_found', 'Không tìm thấy vòng official.');
  if (!context.game) throw fail(404, 'game_not_found', 'Không tìm thấy ván trong vòng.');
  await member(context.round.event_id, account);
  const info = computeBroadcast(context.broadcast, { now, totalPlies: context.totalPlies ?? 0 });
  if (account?.role !== 'admin' && !isPublished(info)) {
    throw fail(404, 'broadcast_not_published', 'Ván chưa được công bố.');
  }
  const row = context.broadcast || { round_pk: roundPk, game_key: gameKey,
    event_id: context.round.event_id, state: 'scheduled', starts_at: null,
    ply_interval_ms: 2000, release_mode: 'window' };
  return { broadcast: officialBroadcastView(row, info), round_id: context.round.round_id,
    game: context.game };
}

/** Gói viewer: cần đúng membership; chưa công bố thì 404. */
export async function officialGameViewerPackage({ roundPk, gameKey, account, afterSeq = 0,
  now = Date.now() } = {}, deps = {}) {
  requireRoundPk(roundPk); requireGameKey(gameKey);
  const load = deps.load || defaults;
  const member = deps.member || assertEventMember;
  const context = await load(roundPk, gameKey);
  if (!context?.round) throw fail(404, 'round_not_found', 'Không tìm thấy vòng official.');
  if (!context.game) throw fail(404, 'game_not_found', 'Không tìm thấy ván trong vòng.');
  await member(context.round.event_id, account);
  const info = computeBroadcast(context.broadcast, { now, totalPlies: context.totalPlies ?? 0 });
  if (!isPublished(info)) throw fail(404, 'broadcast_not_published', 'Ván chưa được công bố.');
  return officialViewerPackage({ roundPk, gameKey, game: context.game,
    replay: context.replay, info, afterSeq });
}

/** Danh sách các ván đã công bố hoặc đang phát của vòng official. */
export async function listPublishedOfficialGames({ roundPk, account, now = Date.now() } = {}, deps = {}) {
  requireRoundPk(roundPk);
  const loadRound = deps.loadRound || (async (id) => {
    const [round] = await rows('official_rounds', `id=eq.${id}&select=id,event_id,round_id,frozen`);
    return round || null;
  });
  const member = deps.member || assertEventMember;
  const round = await loadRound(roundPk);
  if (!round) throw fail(404, 'round_not_found', 'Không tìm thấy vòng official.');
  await member(round.event_id, account);

  const loadBroadcasts = deps.loadBroadcasts || (async (id) => {
    return rows('official_broadcasts', `round_pk=eq.${id}&order=starts_at.asc`);
  });
  const loadGames = deps.loadGames || (async (id) => {
    return rows('official_games',
      `round_pk=eq.${id}&select=round_pk,game_key,stage,series_id,game_no,red_participant_id,blue_participant_id,result,reason,ply_count`);
  });

  const [broadcastRows, gameRows] = await Promise.all([
    loadBroadcasts(roundPk),
    loadGames(roundPk),
  ]);

  const gamesByKey = new Map((gameRows || []).map((g) => [g.game_key, g]));
  const published = [];

  for (const bRow of (broadcastRows || [])) {
    const game = gamesByKey.get(bRow.game_key);
    const totalPlies = game?.ply_count ? Number(game.ply_count) : 0;
    const info = computeBroadcast(bRow, { now, totalPlies });
    if (account?.role === 'admin' || isPublished(info)) {
      published.push({
        game_key: bRow.game_key,
        stage: game?.stage ?? null,
        series_id: game?.series_id ?? null,
        game_no: game?.game_no ?? null,
        red_participant_id: game?.red_participant_id ?? null,
        blue_participant_id: game?.blue_participant_id ?? null,
        broadcast: officialBroadcastView(bRow, info),
      });
    }
  }

  return { round_id: round.round_id, round_pk: roundPk, event_id: round.event_id, games: published };
}
