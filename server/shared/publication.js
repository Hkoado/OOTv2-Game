/**
 * publication.js — Lịch phát và chính sách xem (H3).
 *
 * Nguyên tắc: **chấm trước — lưu kín — phát theo lịch**. Trạng thái `finished` của ván
 * KHÔNG phải công bố. Mọi dữ liệu (kết quả, standings, bracket, replay, log bot) chỉ ra
 * khỏi server khi có bản ghi `mvp_match_broadcasts` và mốc giờ server cho phép.
 *
 * Hàm thuần (`normalizeSchedule`, `computeBroadcast`, `maxEventSeq`) test được bằng `node --test`.
 */

import { insert, rows, update } from './client.js';
import { HttpError } from '../lib/httpError.js';
import { shapeEventRow } from '../services/liveView.js';

export const BROADCAST_STATES = Object.freeze(['scheduled', 'canceled', 'ended']);
export const RELEASE_MODES = Object.freeze(['window', 'full']);
export const DEFAULT_PLY_INTERVAL_MS = 2000;
export const MIN_PLY_INTERVAL_MS = 250;
export const MAX_PLY_INTERVAL_MS = 60000;
export const DEFAULT_POLL_MS = 2000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/u;
const isUuid = (value) => typeof value === 'string' && UUID_RE.test(value);
const fail = (status, code, message) => new HttpError(status, code, message);
const notPublished = () => fail(404, 'broadcast_not_published', 'Ván chưa được công bố.');

/** Validate input đặt lịch (giờ ISO có múi giờ, nhịp phát, chế độ phát). */
export function normalizeSchedule({ starts_at: startsAtRaw, ply_interval_ms: intervalRaw, release_mode: modeRaw } = {}) {
  const startsAtMs = typeof startsAtRaw === 'string' && ISO_RE.test(startsAtRaw.trim()) ? Date.parse(startsAtRaw.trim()) : Number.NaN;
  if (!Number.isFinite(startsAtMs)) throw fail(400, 'bad_starts_at', 'Thời điểm phát cần chuỗi ISO có múi giờ.');
  const plyIntervalMs = intervalRaw === undefined || intervalRaw === null ? DEFAULT_PLY_INTERVAL_MS : Number(intervalRaw);
  if (!Number.isInteger(plyIntervalMs) || plyIntervalMs < MIN_PLY_INTERVAL_MS || plyIntervalMs > MAX_PLY_INTERVAL_MS) {
    throw fail(400, 'bad_ply_interval', `Nhịp phát phải từ ${MIN_PLY_INTERVAL_MS} đến ${MAX_PLY_INTERVAL_MS} ms.`);
  }
  const releaseMode = modeRaw === undefined || modeRaw === null ? 'window' : String(modeRaw);
  if (!RELEASE_MODES.includes(releaseMode)) throw fail(400, 'bad_release_mode', 'Chế độ phát phải là window hoặc full.');
  return { startsAt: new Date(startsAtMs).toISOString(), plyIntervalMs, releaseMode };
}

/**
 * Tính trạng thái phát theo **giờ server**:
 * `visible_plies = clamp(floor((now - starts_at) / ply_interval_ms) + 1, 0, total_plies)`.
 * Chỉ `release_mode = 'full'` mới mở kết quả/replay khi đã phát hết.
 */
export function computeBroadcast(row, { now = Date.now(), totalPlies = 0 } = {}) {
  const total = Number.isFinite(Number(totalPlies)) ? Math.max(0, Math.floor(Number(totalPlies))) : 0;
  const base = {
    total_plies: total,
    server_time: new Date(now).toISOString(),
    starts_at: row?.starts_at || null,
    ply_interval_ms: row ? Number(row.ply_interval_ms) || DEFAULT_PLY_INTERVAL_MS : null,
    release_mode: row?.release_mode || null,
  };
  if (!row || row.state === 'canceled') {
    return { ...base, phase: 'hidden', visible_plies: 0, reveal_result: false, next_poll_ms: null };
  }
  const startsAtMs = Date.parse(row.starts_at);
  const interval = base.ply_interval_ms || DEFAULT_PLY_INTERVAL_MS;
  let phase;
  let visible;
  if (row.state === 'ended') {
    phase = 'ended';
    visible = total;
  } else if (!Number.isFinite(startsAtMs) || now < startsAtMs) {
    phase = 'waiting';
    visible = 0;
  } else if (total === 0) {
    phase = 'ended';
    visible = 0;
  } else {
    visible = Math.min(Math.max(Math.floor((now - startsAtMs) / interval) + 1, 0), total);
    phase = visible >= total ? 'ended' : 'broadcasting';
  }
  const revealResult = phase === 'ended' && row.release_mode === 'full';
  return {
    ...base,
    phase,
    visible_plies: visible,
    reveal_result: revealResult,
    next_poll_ms: phase === 'ended' ? null : DEFAULT_POLL_MS,
  };
}

/** Seq tối đa được trả cho viewer (0 = initial; ply = seq; terminal = tổng + 1). */
export function maxEventSeq(info) {
  if (!info || info.phase === 'hidden' || info.visible_plies <= 0) return info?.phase === 'hidden' ? -1 : 0;
  return info.reveal_result ? Number.POSITIVE_INFINITY : info.visible_plies;
}

export function isPublished(info) {
  return Boolean(info) && info.phase !== 'hidden';
}

/** View công khai cho admin/đội: không lộ nội dung nước đi. */
/** View công khai cho admin/đội: không lộ nội dung nước đi. */
export function broadcastView(row, info) {
  return {
    match_id: row.match_id,
    event_id: row.event_id,
    state: row.state,
    phase: info.phase,
    starts_at: row.starts_at,
    ply_interval_ms: Number(row.ply_interval_ms),
    release_mode: row.release_mode,
    visible_plies: info.visible_plies,
    total_plies: info.total_plies,
    reveal_result: info.reveal_result,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    canceled_at: row.canceled_at || null,
  };
}

async function loadMatch(matchId) {
  if (!isUuid(matchId)) return null;
  const [match] = await rows('matches', `id=eq.${matchId}&select=id,tournament_id,status,ply_count,result,reason,stage,series_id,game_no`);
  return match || null;
}

async function loadBroadcast(matchId) {
  if (!isUuid(matchId)) return null;
  const [row] = await rows('match_broadcasts', `match_id=eq.${matchId}`);
  return row || null;
}

/** Đội phải thuộc giải (admin bỏ qua); không phân biệt "không tồn tại" và "không có quyền". */
export async function assertEventMember(eventId, account) {
  if (account?.role === 'admin') return;
  const participantId = account?.participant_id;
  if (!participantId) throw fail(403, 'scope_denied', 'Cần tài khoản đội thuộc giải để xem ván.');
  const [entry] = await rows(
    'tournament_entries',
    `tournament_id=eq.${eventId}&participant_id=eq.${participantId}&select=id`
  );
  if (!entry) throw fail(403, 'scope_denied', 'Đội không thuộc giải này.');
}

/** Đặt/đổi lịch phát; chỉ ván đã chấm xong (route đã gate admin). */
export async function scheduleBroadcast({ matchId, startsAt, plyIntervalMs, releaseMode, actor, now = Date.now() }) {
  const plan = normalizeSchedule({ starts_at: startsAt, ply_interval_ms: plyIntervalMs, release_mode: releaseMode });
  const match = await loadMatch(matchId);
  if (!match) throw fail(404, 'match_not_found', 'Không tìm thấy ván đấu.');
  if (match.status !== 'finished') throw fail(409, 'match_not_graded', 'Chỉ đặt lịch phát cho ván đã chấm xong.');
  const payload = {
    event_id: match.tournament_id,
    state: 'scheduled',
    starts_at: plan.startsAt,
    ply_interval_ms: plan.plyIntervalMs,
    release_mode: plan.releaseMode,
    created_by: actor || null,
    updated_at: new Date(now).toISOString(),
    canceled_at: null,
  };
  const existing = await loadBroadcast(matchId);
  if (existing) await update('match_broadcasts', `match_id=eq.${matchId}`, payload);
  else await insert('match_broadcasts', { match_id: matchId, created_at: new Date(now).toISOString(), ...payload });
  const row = await loadBroadcast(matchId);
  const info = computeBroadcast(row, { now, totalPlies: Number(match.ply_count || 0) });
  return { broadcast: broadcastView(row, info) };
}

/** Hủy lịch trước giờ phát; đã bắt đầu thì không hủy. */
export async function cancelBroadcast({ matchId, now = Date.now() }) {
  const [match, row] = await Promise.all([loadMatch(matchId), loadBroadcast(matchId)]);
  if (!match || !row) throw fail(404, 'broadcast_not_scheduled', 'Ván chưa có lịch phát.');
  const info = computeBroadcast(row, { now, totalPlies: Number(match.ply_count || 0) });
  if (row.state === 'canceled') return { broadcast: broadcastView(row, info) };
  const startsAtMs = Date.parse(row.starts_at);
  if (!Number.isFinite(startsAtMs) || startsAtMs <= now || info.phase === 'broadcasting' || info.phase === 'ended') {
    throw fail(409, 'broadcast_started', 'Ván đã bắt đầu phát; không hủy được.');
  }
  await update('match_broadcasts', `match_id=eq.${matchId}`, {
    state: 'canceled',
    canceled_at: new Date(now).toISOString(),
    updated_at: new Date(now).toISOString(),
  });
  const canceled = await loadBroadcast(matchId);
  return { broadcast: broadcastView(canceled, computeBroadcast(canceled, { now, totalPlies: Number(match.ply_count || 0) })) };
}

/** Danh sách lịch phát của giải: đội chỉ thấy ván đã công bố, admin thấy tất cả. */
export async function listBroadcastsForEvent({ eventId, account, now = Date.now() }) {
  await assertEventMember(eventId, account);
  const [broadcasts, matches] = await Promise.all([
    rows('match_broadcasts', `event_id=eq.${eventId}&order=starts_at.asc`),
    rows('matches', `tournament_id=eq.${eventId}&select=id,ply_count,stage,series_id,game_no,status`),
  ]);
  const byId = new Map(matches.map((match) => [match.id, match]));
  const result = [];
  for (const row of broadcasts) {
    const match = byId.get(row.match_id);
    const info = computeBroadcast(row, { now, totalPlies: Number(match?.ply_count || 0) });
    if (account?.role !== 'admin' && !isPublished(info)) continue;
    result.push({
      ...broadcastView(row, info),
      stage: match?.stage || null,
      series_id: match?.series_id || null,
      game_no: match?.game_no || null,
    });
  }
  return { broadcasts: result };
}

/** Tập match_id đã công bố / đã mở kết quả, dùng để lọc standings/bracket/replay. */
export async function publishedMatchSets(eventId, { now = Date.now() } = {}) {
  const [broadcasts, matches] = await Promise.all([
    rows('match_broadcasts', `event_id=eq.${eventId}`),
    rows('matches', `tournament_id=eq.${eventId}&select=id,ply_count`),
  ]);
  const totals = new Map(matches.map((match) => [match.id, Number(match.ply_count || 0)]));
  const live = new Set();
  const reveal = new Set();
  for (const row of broadcasts) {
    const info = computeBroadcast(row, { now, totalPlies: totals.get(row.match_id) || 0 });
    if (isPublished(info)) live.add(row.match_id);
    if (info.reveal_result) reveal.add(row.match_id);
  }
  return { live, reveal };
}

/** Trạng thái phát của một ván (dùng cho replay/log/live). */
export async function broadcastStateForMatch(matchId, { now = Date.now() } = {}) {
  const [match, row] = await Promise.all([loadMatch(matchId), loadBroadcast(matchId)]);
  const info = computeBroadcast(row, { now, totalPlies: Number(match?.ply_count || 0) });
  return { match, row, info };
}

/**
 * Gói dữ liệu phát cho viewer: chỉ event `seq <= visible_plies` (hoặc toàn bộ khi
 * `release_mode = 'full'` đã phát xong). Không trả kết quả khi chưa mở.
 */
export async function viewerPackage({ matchId, afterSeq = 0, account, now = Date.now() }) {
  const { match, info } = await broadcastStateForMatch(matchId, { now });
  if (!match) throw fail(404, 'match_not_found', 'Không tìm thấy ván đấu.');
  await assertEventMember(match.tournament_id, account);
  if (!isPublished(info)) throw notPublished();

  const cap = maxEventSeq(info);
  let events = [];
  if (cap >= 0) {
    const after = Number.isFinite(Number(afterSeq)) && Number(afterSeq) > 0 ? Math.floor(Number(afterSeq)) : 0;
    // afterSeq = 0 là lần tải đầu: cần cả event `initial` (seq 0). Các lần sau dùng `gt`.
    const parts = ['match_id=eq.' + match.id, after > 0 ? 'seq=gt.' + after : 'seq=gte.0'];
    if (Number.isFinite(cap)) parts.push('seq=lte.' + cap);
    parts.push('select=seq,kind,payload_json', 'order=seq.asc', 'limit=400');
    const found = await rows('match_events', parts.join('&'));
    events = found.map(shapeEventRow).filter(Boolean);
  }

  return {
    match_id: match.id,
    phase: info.phase,
    server_time: info.server_time,
    starts_at: info.starts_at,
    ply_interval_ms: info.ply_interval_ms,
    release_mode: info.release_mode,
    visible_plies: info.visible_plies,
    total_plies: info.total_plies,
    reveal_result: info.reveal_result,
    next_poll_ms: info.next_poll_ms,
    ...(info.reveal_result ? { result: match.result, reason: match.reason } : {}),
    events,
  };
}


