/** K3 official job queue client. Postgres owns lease/generation fencing, the accepted
 * result transaction and the attempt audit; this module owns validation, canonical
 * input identity and error mapping. No fallback runner, no API route, no bot execution.
 */
import { rpc } from './client.js';
import { HttpError } from '../lib/httpError.js';
import { contentHash } from '../contracts/canonical.js';

export const OFFICIAL_JOB_INPUT_VERSION = 'campus-job-input.v1';
export const OFFICIAL_JOB_STATUSES = Object.freeze(['queued', 'running', 'succeeded', 'failed', 'cancelled']);
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const GAME_KEY = /^[A-Za-z0-9:_-]{1,120}$/;
const WORKER = /^[\x20-\x7e]{1,120}$/;
const RESULTS = Object.freeze(['red_win', 'blue_win', 'draw']);
const CATEGORIES = Object.freeze(['infrastructure', 'bot', 'input', 'operator']);

const RPC_STATUS = Object.freeze({
  round_not_found: 404, game_not_found: 404, job_not_found: 404,
  round_frozen: 409, input_mismatch: 409, job_not_terminal: 409,
  result_conflict: 409, result_exists: 409, lease_lost: 409,
  replay_too_large: 413,
  bad_input: 400, bad_worker: 400, bad_actor: 400,
});
const fail = (status, code, message) => new HttpError(status, code, message);

function assertUuid(value, name) {
  if (!UUID.test(value ?? '')) throw fail(400, `bad_${name}`, `${name} không hợp lệ.`);
  return value;
}
function assertHash(value, name) {
  if (!HASH.test(value ?? '')) throw fail(400, `bad_${name}`, `${name} phải là sha256 hex.`);
  return value;
}
function assertGameKey(value) {
  if (!GAME_KEY.test(value ?? '')) throw fail(400, 'bad_game_key', 'gameKey không hợp lệ.');
  return value;
}
function assertGeneration(value) {
  if (!Number.isInteger(value) || value < 0 || value > 1000000) {
    throw fail(400, 'bad_generation', 'generation không hợp lệ.');
  }
  return value;
}
function assertLeaseSeconds(value) {
  if (!Number.isInteger(value) || value < 30 || value > 3600) {
    throw fail(400, 'bad_lease', 'lease phải trong 30..3600 giây.');
  }
  return value;
}
function assertText(value, name, max) {
  if (typeof value !== 'string' || value.length < 1 || value.length > max) {
    throw fail(400, `bad_${name}`, `${name} không hợp lệ.`);
  }
  return value;
}

/** A rejected envelope is an error, never a silent success. */
function rejected(result, fallback) {
  if (!result || typeof result !== 'object') throw fail(503, 'bad_rpc_response', 'DB không trả kết quả hợp lệ.');
  if (result.ok === false) {
    const code = typeof result.error === 'string' ? result.error : fallback;
    throw fail(RPC_STATUS[code] ?? 400, code, `DB từ chối thao tác: ${code}.`);
  }
  return result;
}

/**
 * Retry identity: the same snapshot, pinned game, map identity and runtime/budget
 * hashes must produce the same hash, so a retried attempt can never silently run a
 * different input than the one the scheduler published.
 */
export function officialGameInputHash({ snapshotHash, game, runtime }) {
  assertHash(snapshotHash, 'snapshot_hash');
  if (!game || typeof game !== 'object' || Array.isArray(game)) throw fail(400, 'bad_game', 'Game phải là object.');
  assertGameKey(game.gameKey);
  assertHash(game.mapHash, 'map_hash');
  if (typeof game.mapPackVersion !== 'string' || !game.mapPackVersion || game.mapPackVersion.length > 80) {
    throw fail(400, 'bad_map_pack', 'mapPackVersion không hợp lệ.');
  }
  if (!Number.isInteger(game.seed) || game.seed < 0 || game.seed > 0xffffffff) throw fail(400, 'bad_seed', 'seed phải uint32.');
  assertUuid(game.redParticipantId, 'red_participant');
  assertUuid(game.blueParticipantId, 'blue_participant');
  if (!runtime || typeof runtime !== 'object') throw fail(400, 'bad_runtime', 'Runtime chưa được pin.');
  assertHash(runtime.runtimeHash, 'runtime_hash');
  assertHash(runtime.budgetHash, 'budget_hash');
  return contentHash({
    schemaVersion: OFFICIAL_JOB_INPUT_VERSION,
    snapshotHash,
    game: { gameKey: game.gameKey, stage: game.stage ?? null, seed: game.seed,
      redParticipantId: game.redParticipantId, blueParticipantId: game.blueParticipantId,
      mapSlot: game.mapSlot ?? null, mapHash: game.mapHash, mapPackVersion: game.mapPackVersion },
    runtime: { runtimeVersion: runtime.runtimeVersion ?? null,
      rulesVersion: runtime.rulesVersion ?? null, protocolVersion: runtime.protocolVersion ?? null,
      runtimeHash: runtime.runtimeHash, budgetHash: runtime.budgetHash },
  });
}

/** Returns `{ created, status, jobId }`; `recorded` status means the game already has a result. */
export async function enqueueOfficialJob({ roundId, gameKey, inputHash } = {}) {
  assertUuid(roundId, 'round_id');
  assertGameKey(gameKey);
  assertHash(inputHash, 'input_hash');
  const result = rejected(await rpc('mvp_official_enqueue_job', {
    p_round: roundId, p_game_key: gameKey, p_input_hash: inputHash,
  }), 'enqueue_rejected');
  return { created: result.created === true, status: String(result.status ?? ''),
    jobId: UUID.test(result.job_id ?? '') ? result.job_id : null };
}

function normalizeClaim(value) {
  if (!value || typeof value !== 'object') throw fail(503, 'bad_rpc_response', 'Claim trả về payload không hợp lệ.');
  if (value.ok === false) {
    const code = typeof value.error === 'string' ? value.error : 'claim_rejected';
    throw fail(RPC_STATUS[code] ?? 400, code, `DB từ chối claim: ${code}.`);
  }
  const job = value.job;
  if (!job || typeof job !== 'object') throw fail(503, 'bad_rpc_response', 'Claim thiếu job.');
  assertUuid(job.id, 'job_id');
  assertUuid(job.roundId, 'round_id');
  assertGameKey(job.gameKey);
  assertHash(job.inputHash, 'input_hash');
  assertUuid(job.leaseToken, 'lease_token');
  assertGeneration(job.generation);
  if (!Number.isInteger(job.attempt) || job.attempt < 1 || job.attempt > 20) {
    throw fail(503, 'bad_rpc_response', 'attempt không hợp lệ.');
  }
  return Object.freeze({
    id: job.id, roundId: job.roundId, gameKey: job.gameKey, stage: String(job.stage ?? ''),
    inputHash: job.inputHash, attempt: job.attempt, maxAttempts: Number(job.maxAttempts ?? 3),
    generation: job.generation, leaseToken: job.leaseToken, leaseUntil: job.leaseUntil ?? null,
    reclaimed: job.reclaimed === true || value.reclaimed === true,
  });
}

/** `null` means the queue is empty for this worker; never an invented local job. */
export async function claimOfficialJob({ workerId, leaseSeconds = 120 } = {}) {
  if (typeof workerId !== 'string' || !WORKER.test(workerId)) throw fail(400, 'bad_worker_id', 'workerId không hợp lệ.');
  assertLeaseSeconds(leaseSeconds);
  const result = await rpc('mvp_official_claim_job', { p_worker: workerId, p_lease_seconds: leaseSeconds });
  if (result === null || result === undefined) return null;
  return normalizeClaim(result);
}

/** `false` means the lease was lost/expired: the worker must stop and never write. */
export async function heartbeatOfficialJob({ jobId, token, generation, leaseSeconds = 120 } = {}) {
  assertUuid(jobId, 'job_id');
  assertUuid(token, 'lease_token');
  assertGeneration(generation);
  assertLeaseSeconds(leaseSeconds);
  const result = await rpc('mvp_official_heartbeat_job', {
    p_job: jobId, p_token: token, p_generation: generation, p_lease_seconds: leaseSeconds,
  });
  if (!result || typeof result !== 'object') throw fail(503, 'bad_rpc_response', 'Heartbeat trả về payload không hợp lệ.');
  if (result.ok === false && result.error === 'lease_lost') return false;
  rejected(result, 'heartbeat_rejected');
  return true;
}

/** Bounded replay payload: the DB rejects anything above 256 KiB. */
export async function finishOfficialJob({ jobId, token, generation, result, replayHash, replay = null } = {}) {
  assertUuid(jobId, 'job_id');
  assertUuid(token, 'lease_token');
  assertGeneration(generation);
  if (!RESULTS.includes(result)) throw fail(400, 'bad_result', 'result không hợp lệ.');
  assertHash(replayHash, 'replay_hash');
  const response = rejected(await rpc('mvp_official_finish_job', {
    p_job: jobId, p_token: token, p_generation: generation,
    p_result: result, p_replay_hash: replayHash, p_replay: replay,
  }), 'finish_rejected');
  return { alreadyRecorded: response.already_recorded === true, result: response.result ?? result };
}

/** Infrastructure retries keep the pinned input; bot/input faults are terminal. */
export async function failOfficialJob({ jobId, token, generation, error = null,
  category = 'infrastructure', retryable = true } = {}) {
  assertUuid(jobId, 'job_id');
  assertUuid(token, 'lease_token');
  assertGeneration(generation);
  if (!CATEGORIES.includes(category)) throw fail(400, 'bad_category', 'category không hợp lệ.');
  if (typeof retryable !== 'boolean') throw fail(400, 'bad_retryable', 'retryable phải boolean.');
  const response = rejected(await rpc('mvp_official_fail_job', {
    p_job: jobId, p_token: token, p_generation: generation,
    p_error: error === null || error === undefined ? null : String(error).slice(0, 400),
    p_category: category, p_retryable: retryable,
  }), 'fail_rejected');
  return { status: String(response.status ?? ''), attempt: Number(response.attempt ?? 0),
    terminal: response.terminal === true, availableAt: response.available_at ?? null };
}

export async function cancelOfficialJob({ jobId, actor, reason = null } = {}) {
  assertUuid(jobId, 'job_id');
  assertText(actor, 'actor', 120);
  const response = rejected(await rpc('mvp_official_cancel_job', {
    p_job: jobId, p_actor: actor,
    p_reason: reason === null || reason === undefined ? null : String(reason).slice(0, 400),
  }), 'cancel_rejected');
  return { alreadyCancelled: response.already_cancelled === true };
}

export async function requeueOfficialJob({ jobId, actor, reason = null } = {}) {
  assertUuid(jobId, 'job_id');
  assertText(actor, 'actor', 120);
  if (typeof reason !== 'string' || !reason.trim() || reason.length > 400) {
    throw fail(400, 'bad_reason', 'Chấm lại phải có lý do.');
  }
  const response = rejected(await rpc('mvp_official_requeue_job', {
    p_job: jobId, p_actor: actor, p_reason: reason.slice(0, 400),
  }), 'requeue_rejected');
  return { status: String(response.status ?? '') };
}

export async function reapOfficialJobs({ limit = 50 } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw fail(400, 'bad_limit', 'limit không hợp lệ.');
  const response = rejected(await rpc('mvp_official_reap_jobs', { p_limit: limit }), 'reap_rejected');
  return { reaped: Number(response.reaped ?? 0) };
}
