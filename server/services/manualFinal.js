/**
 * manualFinal.js — Backend "Chung kết thủ công" (BTC-only).
 *
 * Phạm vi và ranh giới (docs/18, docs/19):
 * - Tách hẳn khỏi intake GitHub online: không giả receipt/SHA GitHub, không nới capture policy.
 * - Admin-only; đội/anonymous không đọc/ghi bất kỳ route nào (router chặn trước service).
 * - API KHÔNG chạy Python/git/bot: chỉ nhận file, hash, lưu Storage private và xếp job.
 * - Chọn/khóa/chấm/hủy dùng RPC SQL nguyên tử (fence lease/generation); payload DTO là whitelist,
 *   không trả `storage_path`, token lease hay snapshot private.
 * - Offline hoàn toàn không Internet không thuộc phạm vi; đợt này vẫn cần Supabase/worker.
 */

import { createHash, randomUUID } from 'node:crypto';

import config from '../config.js';
import { HttpError } from '../lib/httpError.js';
import { rows, insert, update, rpc, uuid } from '../shared/client.js';
import { normalizeMap } from '../../src/game/maps.js';
import { mapHash, contentHash } from '../contracts/canonical.js';
import { createOfficialRuntimeIdentity } from '../judge/officialRuntime.js';
import { randomSeed } from '../judge/rng.js';
import { MAX_OFFICIAL_TEAMS, LEVEL_LABELS } from '../../src/game/competition.js';
import { inspectSourceBuffer } from './botValidation.js';
import { storeVerifiedSource } from '../shared/artifactUpload.js';
import { downloadStorageArtifact, ArtifactDownloadError } from '../shared/artifactDownload.js';

export const MANUAL_SNAPSHOT_VERSION = 'manual-final-match.v1';
export const MANUAL_COLOR_POLICY = 'manual-final.red-first.v1';
export const MANUAL_LEVELS = Object.freeze(['weekly', 'monthly', 'semester']);
export const EVENT_STATUSES = Object.freeze(['draft', 'intake', 'locked', 'closed']);
export const SUBMISSION_STATUSES = Object.freeze(['pending', 'valid', 'invalid', 'infrastructure']);
export const MATCH_STATUSES = Object.freeze(['queued', 'running', 'finished', 'bot_fault', 'infra_fault', 'canceled']);
/** Chỉ các trạng thái này mới được chấm lại bằng /rerun. */
export const RERUNNABLE_STATUSES = Object.freeze(['canceled', 'infra_fault', 'bot_fault']);
const STATUS_RANK = Object.freeze({ draft: 0, intake: 1, locked: 2, closed: 3 });
const SERIES_RE = /^[A-Za-z0-9:_-]{1,40}$/u;
const SNAPSHOT_KEYS = Object.freeze(['schemaVersion', 'provenance', 'eventId', 'roundNo', 'seriesId',
  'gameNo', 'seed', 'mapHash', 'map', 'runtime', 'colorPolicy', 'red', 'blue']);

const fail = (status, code, message) => new HttpError(status, code, message);

const RPC_ERRORS = Object.freeze({
  event_not_found: [404, 'tournament_not_found', 'Không tìm thấy đợt chung kết thủ công.'],
  event_not_open: [409, 'event_not_open', 'Đợt chưa mở nhận bài (trạng thái phải là intake).'],
  event_not_locked: [409, 'event_not_locked', 'Đợt chưa khóa bài; khóa tất cả đội trước khi chấm.'],
  not_in_event: [403, 'scope_denied', 'Đội không thuộc đợt này.'],
  submission_not_found: [404, 'submission_not_found', 'Không tìm thấy bài.'],
  submission_not_valid: [409, 'submission_not_valid', 'Bài chưa hợp lệ (pending/invalid); không chọn hoặc khóa.'],
  submission_locked: [409, 'submission_locked', 'Bài đã khóa; không đổi phiên bản sau khóa.'],
  not_selected: [409, 'not_selected', 'Đội chưa chọn phiên bản để khóa.'],
  red_submission_not_locked: [409, 'red_submission_not_locked', 'Bài đội Đỏ chưa khóa hoặc chưa hợp lệ.'],
  blue_submission_not_locked: [409, 'blue_submission_not_locked', 'Bài đội Xanh chưa khóa hoặc chưa hợp lệ.'],
  match_not_found: [404, 'match_not_found', 'Không tìm thấy trận.'],
  result_conflict: [409, 'result_conflict', 'Đã có kết quả được chấp nhận; không hủy để ghi đè.'],
  reason_required: [400, 'reason_required', 'Cần lý do ít nhất 5 ký tự.'],
  duplicate_game: [409, 'duplicate_game', 'Ván này đã có kết quả được chấp nhận.'],
  bad_request: [400, 'bad_request', 'Yêu cầu không hợp lệ.'],
  lease_lost: [409, 'lease_lost', 'Lease đã mất; không ghi kết quả.'],
  job_not_found: [404, 'job_not_found', 'Không tìm thấy job.'],
  job_canceled: [409, 'job_canceled', 'Job đã bị hủy.'],
  job_not_running: [409, 'job_not_running', 'Job không ở trạng thái chạy.'],
  bad_outcome: [400, 'bad_outcome', 'Kết quả chấm không hợp lệ.'],
  source_hash_mismatch: [409, 'source_hash_mismatch', 'Hash bài không khớp bản đã nộp.'],
  bad_worker: [400, 'bad_worker', 'worker_id không hợp lệ.'],
});

/** RPC trả `{ok:false,error}` → HttpError có code ổn định cho UI. */
export function throwRpcError(code) {
  const mapped = RPC_ERRORS[code] || [503, 'shared_db_error', 'Thao tác DB chung thất bại.'];
  throw fail(mapped[0], mapped[1], mapped[2]);
}

function accepted(result) {
  if (!result || typeof result !== 'object') throw fail(503, 'bad_rpc_response', 'DB không trả kết quả hợp lệ.');
  if (result.ok !== true) throwRpcError(result.error);
  return result;
}

const sha256Hex = (buffer) => createHash('sha256').update(buffer).digest('hex');
const iso = (value) => (value ? new Date(value).toISOString() : null);

function storageError(error) {
  if (error instanceof HttpError) return error;
  const code = error instanceof ArtifactDownloadError ? error.code : 'storage_unavailable';
  return fail(503, 'artifact_unavailable', `Không lưu/tải được artifact (${code}). Không có bài nào được ghi.`);
}

/** Tên file chỉ để hiển thị; không bao giờ là đường dẫn thực thi. */
export function displayFilename(originalname) {
  const base = String(originalname || 'bot.py').split(/[\\/]/u).pop().replace(/[\u0000-\u001f]/gu, '').trim();
  const name = base || 'bot.py';
  return name.length > 200 ? name.slice(-200) : name;
}

/** DTO đợt: map/budget đầy đủ chỉ vì mọi route của module này đã admin-only. */
export function eventView(row) {
  const runtime = row.runtime_json || {};
  return {
    id: row.id,
    name: row.name,
    level: row.level,
    level_label: LEVEL_LABELS[row.level] || row.level,
    round_no: Number(row.round_no),
    intake_mode: row.intake_mode,
    status: row.status,
    seed: Number(row.seed),
    map: row.map_json || null,
    map_hash: row.map_hash,
    runtime: {
      runtimeVersion: runtime.runtimeVersion,
      rulesVersion: runtime.rulesVersion,
      protocolVersion: runtime.protocolVersion,
      runtimeHash: runtime.runtimeHash,
      budgetHash: runtime.budgetHash,
      budget: runtime.budget || null,
    },
    created_by: row.created_by,
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
    closed_at: iso(row.closed_at),
  };
}

/** DTO bài nộp: hash/actor/giờ server, KHÔNG có storage_path hay bytes. */
export function submissionView(row) {
  return {
    id: row.id,
    event_id: row.event_id,
    team_id: row.team_id,
    round_no: Number(row.round_no),
    source_kind: row.source_kind,
    filename: row.filename,
    sha256: row.sha256,
    byte_size: Number(row.byte_size),
    status: row.status,
    error_code: row.error_code || null,
    error_message: row.error_message || null,
    received_at: iso(row.received_at),
    received_by: row.received_by,
    selected: Boolean(row.selected_at),
    selected_at: iso(row.selected_at),
    locked: Boolean(row.locked_at),
    locked_at: iso(row.locked_at),
  };
}

export function jobView(row) {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    attempt: Number(row.attempt),
    generation: Number(row.generation),
    submission_id: row.submission_id || null,
    match_id: row.match_id || null,
    input_hash: row.input_hash,
    error_code: row.error_code || null,
    error_message: row.error_message || null,
    available_at: iso(row.available_at),
    created_at: iso(row.created_at),
    finished_at: iso(row.finished_at),
  };
}

export function matchView(row, names = new Map()) {
  const side = (teamId, submissionId) => ({
    team_id: teamId,
    name: names.get(teamId) || null,
    submission_id: submissionId,
  });
  return {
    id: row.id,
    event_id: row.event_id,
    round_no: Number(row.round_no),
    series_id: row.series_id,
    game_no: Number(row.game_no),
    red: side(row.red_team_id, row.red_submission_id),
    blue: side(row.blue_team_id, row.blue_submission_id),
    seed: Number(row.seed),
    map_hash: row.map_hash,
    snapshot_hash: row.snapshot_hash,
    color_policy: MANUAL_COLOR_POLICY,
    status: row.status,
    result: row.result || null,
    reason: row.reason || null,
    ply_count: row.ply_count === null || row.ply_count === undefined ? null : Number(row.ply_count),
    error_code: row.error_code || null,
    error_message: row.error_message || null,
    requested_by: row.requested_by,
    requested_at: iso(row.requested_at),
    started_at: iso(row.started_at),
    finished_at: iso(row.finished_at),
    canceled_at: iso(row.canceled_at),
    cancel_reason: row.cancel_reason || null,
    rerun_of: row.rerun_of || null,
    replay_available: Boolean(row.replay_json),
    can_cancel: row.status !== 'finished' && row.status !== 'canceled',
    can_rerun: RERUNNABLE_STATUSES.includes(row.status),
  };
}

function auditView(row, names = new Map()) {
  return {
    id: Number(row.id),
    entity: row.entity,
    entity_id: row.entity_id,
    action: row.action,
    actor: row.actor || null,
    actor_name: row.actor ? names.get(row.actor) || null : null,
    reason: row.reason || null,
    detail: row.detail || {},
    created_at: iso(row.created_at),
  };
}

async function requireEvent(eventId) {
  const [event] = await rows('manual_final_events', `id=eq.${uuid(eventId)}`);
  if (!event) throw fail(404, 'tournament_not_found', 'Không tìm thấy đợt chung kết thủ công.');
  return event;
}

async function teamNames() {
  const participants = await rows('participants', 'select=id,name');
  return new Map(participants.map((team) => [team.id, team.name]));
}


/** Danh sách đợt (admin). */
export async function listEvents() {
  const events = await rows('manual_final_events', 'order=created_at.desc,id');
  return { events: events.map(eventView) };
}

/**
 * Tạo đợt + đội trong một lần gọi; map/runtime bị pin ngay (không sửa sau khi tạo).
 * Đợt luôn bắt đầu `draft`; BTC tự mở `intake` khi sẵn sàng nhận file.
 */
export async function createEvent({ name, level, roundNo = 1, teamIds = [], map, seed, actor }) {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 120) {
    throw fail(400, 'bad_name', 'Tên đợt từ 1 đến 120 ký tự.');
  }
  if (!MANUAL_LEVELS.includes(level)) throw fail(400, 'bad_level', 'Cấp giải phải là weekly/monthly/semester.');
  if (!Number.isInteger(roundNo) || roundNo < 1 || roundNo > 20) throw fail(400, 'bad_round', 'Vòng phải từ 1 đến 20.');
  if (!Array.isArray(teamIds) || teamIds.length < 2 || teamIds.length > MAX_OFFICIAL_TEAMS
    || new Set(teamIds).size !== teamIds.length) {
    throw fail(400, 'bad_teams', `Chọn 2..${MAX_OFFICIAL_TEAMS} đội không trùng.`);
  }
  teamIds.forEach((id) => uuid(id));
  let normalized;
  try {
    normalized = normalizeMap(map);
  } catch (error) {
    throw fail(400, 'bad_map', `Map không hợp lệ: ${error.message}`);
  }
  if (normalized.schemaVersion !== 'map.v2' || normalized.rulesVersion !== 'ott-campus.v2') {
    throw fail(400, 'legacy_map_read_only', 'Đợt mới chỉ dùng map v2 (ott-campus.v2); map v1 chỉ để đọc lịch sử.');
  }
  const teams = await rows('participants', `id=in.(${teamIds.join(',')})&select=id,name`);
  if (teams.length !== teamIds.length) throw fail(400, 'unknown_team', 'Có đội không tồn tại trong hệ thống.');
  let runtime;
  try {
    runtime = createOfficialRuntimeIdentity();
  } catch (error) {
    throw fail(503, 'runtime_unavailable', `Không đọc được runtime chính thức: ${error.message}`);
  }
  const eventId = randomUUID();
  const hashedMap = mapHash(normalized);
  await insert('manual_final_events', {
    id: eventId,
    name: name.trim(),
    level,
    round_no: roundNo,
    intake_mode: 'manual_final',
    status: 'draft',
    map_json: normalized,
    map_hash: hashedMap,
    runtime_json: runtime,
    seed: Number.isSafeInteger(seed) && seed >= 0 && seed <= 0xffffffff ? seed : randomSeed(),
    created_by: actor.id,
  });
  await insert('manual_final_teams', teamIds.map((team_id, index) => ({
    event_id: eventId, team_id, seed_order: index + 1,
  })));
  await insert('manual_final_audit', {
    event_id: eventId,
    entity: 'event',
    entity_id: eventId,
    action: 'create',
    actor: actor.id,
    detail: { level, round_no: roundNo, teams: teamIds.length, map_hash: hashedMap },
  });
  return getEvent(eventId);
}


/** Tổng hợp đợt: đội, phiên bản bài, trận, job, readiness và audit gần nhất. */
export async function getEvent(eventId, { auditLimit = 20 } = {}) {
  const event = await requireEvent(eventId);
  const [teams, submissions, matches, jobs, auditRows, names] = await Promise.all([
    rows('manual_final_teams', `event_id=eq.${event.id}&order=seed_order`),
    rows('manual_final_submissions', `event_id=eq.${event.id}&order=received_at.desc,id.desc`),
    rows('manual_final_matches', `event_id=eq.${event.id}&order=requested_at,id`),
    rows('manual_final_jobs', `event_id=eq.${event.id}&order=created_at,id`),
    rows('manual_final_audit', `event_id=eq.${event.id}&order=created_at.desc,id.desc&limit=${auditLimit}`),
    teamNames(),
  ]);
  const actorIds = [...new Set(auditRows.map((row) => row.actor).filter(Boolean))];
  const accounts = actorIds.length
    ? await rows('accounts', `id=in.(${actorIds.join(',')})&select=id,username`)
    : [];
  const accountNames = new Map(accounts.map((account) => [account.id, account.username]));

  const lockedTeams = new Set(submissions.filter((row) => row.locked_at).map((row) => row.team_id));
  const blockers = teams.filter((team) => !lockedTeams.has(team.team_id)).map((team) => ({
    code: 'team_not_locked',
    team_id: team.team_id,
    message: `Đội ${names.get(team.team_id) || team.team_id} chưa khóa bài hợp lệ.`,
  }));
  const pendingValidations = jobs.filter((job) => job.kind === 'validate' && ['queued', 'running'].includes(job.status));
  const openMatches = matches.filter((match) => ['queued', 'running'].includes(match.status));
  const statusCount = (status) => matches.filter((match) => match.status === status).length;

  return {
    event: eventView(event),
    teams: teams.map((team) => {
      const versions = submissions.filter((row) => row.team_id === team.team_id);
      const selected = versions.find((row) => row.selected_at) || null;
      const locked = versions.find((row) => row.locked_at) || null;
      return {
        team_id: team.team_id,
        name: names.get(team.team_id) || null,
        seed_order: Number(team.seed_order),
        submission_count: versions.length,
        selected_submission_id: selected?.id || null,
        locked_submission_id: locked?.id || null,
        locked_sha256: locked?.sha256 || null,
      };
    }),
    submissions: submissions.map(submissionView),
    matches: matches.map((row) => matchView(row, names)),
    jobs: jobs.map(jobView),
    readiness: {
      teams: teams.length,
      locked_teams: lockedTeams.size,
      pending_validations: pendingValidations.length,
      matches: {
        queued: statusCount('queued'),
        running: statusCount('running'),
        finished: statusCount('finished'),
        bot_fault: statusCount('bot_fault'),
        infra_fault: statusCount('infra_fault'),
        canceled: statusCount('canceled'),
      },
      can_lock_round: event.status === 'intake' && blockers.length === 0,
      can_close: event.status === 'locked' && openMatches.length === 0
        && jobs.every((job) => !['queued', 'running'].includes(job.status)),
      blockers,
    },
    audit: auditRows.map((row) => auditView(row, accountNames)),
  };
}


/** Đi đúng thứ tự draft → intake → locked → closed; không nhảy bước, không quay lại. */
export async function setEventStatus({ eventId, target, actor, reason = null }) {
  if (!EVENT_STATUSES.includes(target)) throw fail(400, 'bad_status', 'Trạng thái đích không hợp lệ.');
  if (reason !== null && (typeof reason !== 'string' || reason.trim().length < 3 || reason.trim().length > 500)) {
    throw fail(400, 'bad_reason', 'Lý do phải từ 3 đến 500 ký tự.');
  }
  const event = await requireEvent(eventId);
  if (event.status === target) return getEvent(event.id);
  if (STATUS_RANK[target] !== STATUS_RANK[event.status] + 1) {
    throw fail(409, 'bad_transition', `Không thể chuyển ${event.status} → ${target}; chỉ đi tuần tự.`);
  }
  const detail = await getEvent(event.id);
  if (target === 'locked' && detail.readiness.blockers.length) {
    throw fail(409, 'teams_not_locked', `Còn ${detail.readiness.blockers.length} đội chưa khóa bài hợp lệ.`);
  }
  if (target === 'closed') {
    const { matches, pending_validations: pending } = detail.readiness;
    if (matches.queued || matches.running || pending) {
      throw fail(409, 'jobs_pending', 'Còn trận hoặc job chưa xong; chờ chấm/khóa xong rồi chốt.');
    }
  }
  await update('manual_final_events', `id=eq.${event.id}`, {
    status: target,
    closed_at: target === 'closed' ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  });
  await insert('manual_final_audit', {
    event_id: event.id,
    entity: 'event',
    entity_id: event.id,
    action: target === 'closed' ? 'close' : 'status',
    actor: actor.id,
    reason: reason ? reason.trim() : null,
    detail: { from: event.status, to: target },
  });
  return getEvent(event.id);
}

/**
 * Nhận một file `.py` UTF-8 cho đúng đội trong đợt.
 * - Kích thước/đuôi do middleware; ở đây kiểm UTF-8/NUL và hash server.
 * - Upload lặp cùng bytes trả bản ghi cũ (idempotent), không tạo bản trùng.
 * - Trạng thái luôn `pending`: syntax/protocol smoke do worker chạy (API không chạy code).
 */
export async function uploadSubmission({ eventId, teamId, file, actor }) {
  const event = await requireEvent(eventId);
  uuid(teamId);
  if (!['draft', 'intake'].includes(event.status)) {
    throw fail(409, 'event_not_open', 'Đợt đã khóa/chốt; không nhận thêm bài.');
  }
  const [member] = await rows('manual_final_teams', `event_id=eq.${event.id}&team_id=eq.${teamId}`);
  if (!member) throw fail(403, 'scope_denied', 'Đội không thuộc đợt này.');
  if (!file || !Buffer.isBuffer(file.buffer) || !file.buffer.length) {
    throw fail(400, 'file_required', 'Thiếu file bot ở trường `file`.');
  }
  const inspection = inspectSourceBuffer(file.buffer, file.buffer.length);
  if (!inspection.ok) throw fail(400, inspection.error, inspection.message);
  const sha256 = sha256Hex(file.buffer);
  const [existing] = await rows('manual_final_submissions',
    `event_id=eq.${event.id}&team_id=eq.${teamId}&sha256=eq.${sha256}`);
  if (existing) return { duplicate: true, submission: submissionView(existing) };
  let stored;
  try {
    stored = await storeVerifiedSource(file.buffer, { sourceHash: sha256 });
  } catch (error) {
    throw storageError(error);
  }
  const submissionId = randomUUID();
  const [saved] = await insert('manual_final_submissions', {
    id: submissionId,
    event_id: event.id,
    round_no: Number(event.round_no),
    team_id: teamId,
    source_kind: 'manual_final',
    filename: displayFilename(file.originalname),
    storage_path: stored.storage_path,
    sha256,
    byte_size: file.buffer.length,
    status: 'pending',
    received_by: actor.id,
  });
  await insert('manual_final_jobs', {
    id: randomUUID(),
    event_id: event.id,
    round_no: Number(event.round_no),
    kind: 'validate',
    submission_id: submissionId,
    input_hash: sha256,
    status: 'queued',
  });
  await insert('manual_final_audit', {
    event_id: event.id,
    entity: 'submission',
    entity_id: saved.id,
    action: 'upload',
    actor: actor.id,
    detail: { team_id: teamId, sha256, byte_size: file.buffer.length },
  });
  return { duplicate: false, submission: submissionView(saved) };
}

/** Admin tải lại source đã nộp (ACL riêng, không lộ storage_path trong DTO). */
export async function sourceOfSubmission({ eventId, submissionId }) {
  uuid(eventId);
  uuid(submissionId);
  const [row] = await rows('manual_final_submissions', `id=eq.${submissionId}&event_id=eq.${eventId}`);
  if (!row) throw fail(404, 'submission_not_found', 'Không tìm thấy bài trong đợt này.');
  let bytes;
  try {
    bytes = await downloadStorageArtifact(row.storage_path, { maxBytes: config.limits.maxSourceBytes });
  } catch (error) {
    throw storageError(error);
  }
  if (sha256Hex(bytes) !== row.sha256 || bytes.length !== Number(row.byte_size)) {
    throw fail(409, 'artifact_integrity', 'Artifact không khớp hash đã lưu; không trả nội dung.');
  }
  return { filename: row.filename, sha256: row.sha256, received_at: iso(row.received_at), bytes };
}


/** BTC chọn đúng một phiên bản cho đội (chưa khóa). */
export async function selectSubmission({ eventId, submissionId, actor }) {
  uuid(eventId);
  uuid(submissionId);
  const [row] = await rows('manual_final_submissions', `id=eq.${submissionId}&event_id=eq.${eventId}`);
  if (!row) throw fail(404, 'submission_not_found', 'Không tìm thấy bài trong đợt này.');
  const result = accepted(await rpc('mvp_manual_final_select', { p_submission: submissionId, p_actor: actor.id }));
  return { select: { submission_id: result.submission_id, team_id: result.team_id, sha256: result.sha256, selected_at: iso(result.selected_at) } };
}

/** BTC khóa bài đã chọn của một đội; gọi lặp là idempotent. */
export async function lockSubmission({ eventId, teamId, actor }) {
  uuid(eventId);
  uuid(teamId);
  const result = accepted(await rpc('mvp_manual_final_lock', {
    p_event: eventId, p_team: teamId, p_actor: actor.id,
  }));
  return {
    lock: {
      team_id: teamId,
      submission_id: result.submission_id,
      sha256: result.sha256,
      locked_at: iso(result.locked_at),
      already_locked: result.already_locked === true,
    },
  };
}

function pairKey({ eventId, roundNo, seriesId, gameNo, redTeamId, blueTeamId, rerunOf = null }) {
  return [`manual-final.v1`, eventId, roundNo, seriesId, gameNo, redTeamId, blueTeamId,
    ...(rerunOf ? ['rerun', rerunOf] : [])].join(':');
}

/** Snapshot bất biến cho một ván: map/runtime/bài đã khóa/seed/màu + provenance manual. */
function buildSnapshot({ event, roundNo, seriesId, gameNo, seed, red, blue }) {
  return {
    schemaVersion: MANUAL_SNAPSHOT_VERSION,
    provenance: 'manual_final',
    eventId: event.id,
    roundNo,
    seriesId,
    gameNo,
    seed,
    mapHash: event.map_hash,
    map: event.map_json,
    runtime: event.runtime_json,
    colorPolicy: MANUAL_COLOR_POLICY,
    red: {
      teamId: red.team_id, submissionId: red.id, sha256: red.sha256,
      byteSize: Number(red.byte_size), filename: red.filename,
      receivedAt: iso(red.received_at), sourceKind: red.source_kind,
    },
    blue: {
      teamId: blue.team_id, submissionId: blue.id, sha256: blue.sha256,
      byteSize: Number(blue.byte_size), filename: blue.filename,
      receivedAt: iso(blue.received_at), sourceKind: blue.source_kind,
    },
  };
}

async function lockedSubmission(eventId, teamId, side) {
  const [row] = await rows('manual_final_submissions',
    `event_id=eq.${eventId}&team_id=eq.${uuid(teamId)}&locked_at=not.is.null&status=eq.valid`);
  if (!row) {
    throw fail(409, `${side}_submission_not_locked`,
      `Bài đội ${side === 'red' ? 'Đỏ' : 'Xanh'} chưa khóa hoặc chưa hợp lệ.`);
  }
  return row;
}

/**
 * BTC chọn hai đội + ván và yêu cầu chấm bằng worker chung.
 * Idempotent theo (đợt, vòng, ván, hai đội, rerun); không bao giờ đọc "bài mới nhất".
 */
export async function requestPair({ eventId, redTeamId, blueTeamId, seriesId, gameNo = 1,
  seed, note = null, rerunOf = null, actor }) {
  const event = await requireEvent(eventId);
  if (!SERIES_RE.test(String(seriesId || ''))) throw fail(400, 'bad_series', 'series_id không hợp lệ (1..40 ký tự [A-Za-z0-9:_-]).');
  if (!Number.isInteger(gameNo) || gameNo < 1 || gameNo > 9) throw fail(400, 'bad_game_no', 'game_no phải từ 1 đến 9.');
  if (redTeamId === blueTeamId) throw fail(400, 'same_team', 'Hai đội của một ván phải khác nhau.');
  if (note !== null && (typeof note !== 'string' || note.length > 500)) throw fail(400, 'bad_note', 'Ghi chú tối đa 500 ký tự.');
  if (event.status !== 'locked') throw fail(409, 'event_not_locked', 'Đợt chưa khóa bài; khóa tất cả đội trước khi chấm.');
  const [red, blue] = await Promise.all([
    lockedSubmission(event.id, redTeamId, 'red'),
    lockedSubmission(event.id, blueTeamId, 'blue'),
  ]);
  const resolvedSeed = Number.isSafeInteger(seed) && seed >= 0 && seed <= 0xffffffff ? seed : Number(event.seed);
  const roundNo = Number(event.round_no);
  const snapshot = buildSnapshot({ event, roundNo, seriesId, gameNo, seed: resolvedSeed, red, blue });
  const result = accepted(await rpc('mvp_manual_final_pair', {
    p_payload: {
      eventId: event.id,
      seriesId,
      gameNo,
      redTeamId: red.team_id,
      blueTeamId: blue.team_id,
      seed: resolvedSeed,
      mapHash: event.map_hash,
      snapshotHash: contentHash(snapshot),
      snapshot,
      idempotencyKey: pairKey({ eventId: event.id, roundNo, seriesId, gameNo, redTeamId: red.team_id,
        blueTeamId: blue.team_id, rerunOf }),
      note: note ? note.trim() : null,
    },
    p_actor: actor.id,
  }));
  return {
    pair: {
      match_id: result.match_id,
      job_id: result.job_id || null,
      status: result.status,
      snapshot_hash: result.snapshot_hash,
      idempotent: result.idempotent === true,
    },
  };
}


async function requireMatch(eventId, matchId) {
  uuid(eventId);
  uuid(matchId);
  const [row] = await rows('manual_final_matches', `id=eq.${matchId}&event_id=eq.${eventId}`);
  if (!row) throw fail(404, 'match_not_found', 'Không tìm thấy trận trong đợt này.');
  return row;
}

/** Hủy trận chưa có kết quả accepted; giữ hàng lịch sử + audit, bắt buộc lý do. */
export async function cancelMatch({ eventId, matchId, reason, actor }) {
  if (typeof reason !== 'string' || reason.trim().length < 5 || reason.trim().length > 500) {
    throw fail(400, 'reason_required', 'Cần lý do 5..500 ký tự để hủy trận.');
  }
  const match = await requireMatch(eventId, matchId);
  const result = accepted(await rpc('mvp_manual_final_cancel', {
    p_match: match.id, p_actor: actor.id, p_reason: reason.trim(),
  }));
  return {
    cancel: {
      match_id: result.match_id,
      status: result.status,
      already_canceled: result.already_canceled === true,
      previous_status: result.previous_status || null,
    },
  };
}

/**
 * Chấm lại trận đã hủy/lỗi với đúng input cũ (cùng bài khóa, map, seed) và ghi audit.
 * Trận cũ cùng kết quả lịch sử không bị sửa/xóa.
 */
export async function rerunMatch({ eventId, matchId, reason, actor }) {
  if (typeof reason !== 'string' || reason.trim().length < 5 || reason.trim().length > 500) {
    throw fail(400, 'reason_required', 'Cần lý do 5..500 ký tự để chấm lại.');
  }
  const match = await requireMatch(eventId, matchId);
  if (!RERUNNABLE_STATUSES.includes(match.status)) {
    throw fail(409, 'rerun_not_allowed', `Chỉ chấm lại trận đã hủy/lỗi hạ tầng/bot (hiện tại: ${match.status}).`);
  }
  const [red, blue] = await Promise.all([
    rows('manual_final_submissions', `id=eq.${match.red_submission_id}&select=id,sha256,locked_at`),
    rows('manual_final_submissions', `id=eq.${match.blue_submission_id}&select=id,sha256,locked_at`),
  ]);
  if (!red[0]?.locked_at || !blue[0]?.locked_at) {
    throw fail(409, 'submission_not_locked', 'Bài của trận gốc không còn khóa; không chấm lại.');
  }
  const paired = await requestPair({
    eventId, redTeamId: match.red_team_id, blueTeamId: match.blue_team_id,
    seriesId: match.series_id, gameNo: Number(match.game_no), seed: Number(match.seed),
    note: `Chấm lại: ${reason.trim()}`, rerunOf: match.id, actor,
  });
  return { rerun: { ...paired.pair, rerun_of: match.id } };
}

/** Replay chỉ trả khi có kết quả accepted; route đã admin-only. */
export async function matchReplay({ eventId, matchId }) {
  const match = await requireMatch(eventId, matchId);
  if (match.status !== 'finished' || !match.replay_json) {
    throw fail(409, 'result_not_ready', 'Trận chưa có kết quả được chấp nhận.');
  }
  let replay;
  try {
    replay = JSON.parse(match.replay_json);
  } catch {
    throw fail(500, 'replay_corrupt', 'Replay lưu không đọc được; giữ nguyên kết quả và báo BTC kỹ thuật.');
  }
  const names = await teamNames();
  return { match: matchView(match, names), replay };
}

export default {
  listEvents, createEvent, getEvent, setEventStatus, uploadSubmission, sourceOfSubmission,
  selectSubmission, lockSubmission, requestPair, cancelMatch, rerunMatch, matchReplay,
};

