/**
 * manualFinalJobs.js — Contract worker cho Chung kết thủ công (Huy ↔ Khoa).
 *
 * Cùng queue semantics với GitHub intake nhưng KHÔNG có runner thứ hai:
 * worker claim job `validate` (kiểm syntax + protocol smoke sau khi tải artifact Storage)
 * hoặc job `match` (chấm cặp bài đã khóa), rồi finish/release bằng RPC có fence
 * lease token + generation. Mọi kiểm trạng thái/kết quả nằm ở SQL
 * `20261026100000_manual_final.sql`; client chỉ validate payload và chuẩn hoá DTO.
 *
 * `leaseLost` nghĩa là worker cũ/stale: phải dừng, KHÔNG ghi kết quả.
 * `alreadyFinished` nghĩa là lần trước đã commit nhưng mất response: không ghi lần 2.
 */

import { rpc } from './client.js';
import { HttpError } from '../lib/httpError.js';

export const MANUAL_JOB_KINDS = Object.freeze(['validate', 'match']);
export const MANUAL_VALIDATE_OUTCOMES = Object.freeze(['valid', 'invalid', 'infrastructure']);
export const MANUAL_MATCH_OUTCOMES = Object.freeze(['finished', 'bot_fault', 'infra_fault']);
export const MANUAL_DEFAULT_LEASE_SECONDS = 120;
export const MANUAL_DEFAULT_MAX_ATTEMPTS = 3;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const SHA256_RE = /^[0-9a-f]{64}$/u;
const STORAGE_RE = /^[0-9a-f-]{36}\.py$/u;
const RESULTS = Object.freeze(['red_win', 'blue_win', 'draw']);

const fail = (code, message) => new HttpError(400, code, message);
const isUuid = (value) => typeof value === 'string' && UUID_RE.test(value);

function assertFence({ jobId, token, generation }) {
  if (!isUuid(jobId)) throw fail('bad_job', 'jobId không hợp lệ.');
  if (!isUuid(token)) throw fail('bad_lease', 'lease token không hợp lệ.');
  if (!Number.isSafeInteger(generation) || generation < 1) throw fail('bad_generation', 'generation không hợp lệ.');
}

function clamp(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

/** Chuẩn hoá outcome trước khi gửi RPC; ném HttpError nếu thiếu dữ liệu bắt buộc. */
export function validateManualOutcome(kind, outcome) {
  if (!MANUAL_JOB_KINDS.includes(kind)) throw fail('bad_kind', 'kind phải là validate/match.');
  if (!outcome || typeof outcome !== 'object' || Array.isArray(outcome)) throw fail('bad_outcome', 'Outcome phải là object.');
  const rawError = typeof outcome.error === 'string' ? outcome.error.slice(0, 200) : null;
  const message = typeof outcome.message === 'string' ? outcome.message.slice(0, 400) : null;
  if (kind === 'validate') {
    if (!MANUAL_VALIDATE_OUTCOMES.includes(outcome.status)) {
      throw fail('bad_outcome', 'status phải là valid/invalid/infrastructure.');
    }
    if (outcome.status === 'valid') {
      if (!SHA256_RE.test(String(outcome.source_hash || ''))) throw fail('bad_outcome', 'source_hash phải là sha256 hex.');
      return { status: 'valid', source_hash: outcome.source_hash, error: null, message: null };
    }
    return { status: outcome.status, source_hash: null, error: rawError || 'bot_validation_failed', message };
  }
  if (!MANUAL_MATCH_OUTCOMES.includes(outcome.status)) {
    throw fail('bad_outcome', 'status phải là finished/bot_fault/infra_fault.');
  }
  if (outcome.status !== 'finished') {
    return { status: outcome.status, error: rawError || 'manual_final_infrastructure', message };
  }
  if (!RESULTS.includes(outcome.result)) throw fail('bad_outcome', 'result phải là red_win/blue_win/draw.');
  if (!Number.isInteger(outcome.ply_count) || outcome.ply_count < 1 || outcome.ply_count > 1000) {
    throw fail('bad_outcome', 'ply_count phải là số nguyên 1..1000.');
  }
  if (!outcome.replay || typeof outcome.replay !== 'object' || Array.isArray(outcome.replay)) {
    throw fail('bad_replay', 'replay phải là object (không nhận chuỗi/path).');
  }
  let serialized;
  try {
    serialized = JSON.stringify(outcome.replay);
  } catch {
    throw fail('bad_replay', 'replay không serialize được.');
  }
  if (serialized.length < 2 || serialized.length > 1048576) throw fail('bad_replay', 'replay vượt giới hạn 1 MiB.');
  return {
    status: 'finished',
    result: outcome.result,
    reason: typeof outcome.reason === 'string' ? outcome.reason.slice(0, 200) : null,
    ply_count: outcome.ply_count,
    replay: outcome.replay,
  };
}

/** DTO job cho worker; chỉ service_role mới thấy `storage_path` của artifact. */
export function normalizeClaimedJob(raw) {
  if (!raw || typeof raw !== 'object') throw fail('bad_claim', 'DB trả job không hợp lệ.');
  if (!isUuid(raw.job_id) || !MANUAL_JOB_KINDS.includes(raw.kind) || !isUuid(raw.token)
    || !Number.isSafeInteger(raw.generation) || !SHA256_RE.test(String(raw.input_hash))) {
    throw fail('bad_claim', 'Job thiếu trường bắt buộc.');
  }
  const submission = raw.submission && typeof raw.submission === 'object'
    ? {
      id: raw.submission.id,
      team_id: raw.submission.team_id,
      storage_path: raw.submission.storage_path,
      sha256: raw.submission.sha256,
      byte_size: Number(raw.submission.byte_size),
    }
    : null;
  if (raw.kind === 'validate' && (!submission || !STORAGE_RE.test(String(submission.storage_path))
    || !SHA256_RE.test(String(submission.sha256)))) {
    throw fail('bad_claim', 'Job validate thiếu artifact hợp lệ.');
  }
  const match = raw.match && typeof raw.match === 'object'
    ? {
      id: raw.match.id,
      series_id: raw.match.series_id,
      game_no: Number(raw.match.game_no),
      red_team_id: raw.match.red_team_id,
      blue_team_id: raw.match.blue_team_id,
      red_submission_id: raw.match.red_submission_id,
      blue_submission_id: raw.match.blue_submission_id,
      map_hash: raw.match.map_hash,
      seed: Number(raw.match.seed),
      snapshot_hash: raw.match.snapshot_hash,
      snapshot: raw.match.snapshot || null,
    }
    : null;
  if (raw.kind === 'match' && (!match || !SHA256_RE.test(String(match.snapshot_hash)) || !match.snapshot)) {
    throw fail('bad_claim', 'Job match thiếu snapshot hợp lệ.');
  }
  return {
    jobId: raw.job_id,
    kind: raw.kind,
    eventId: raw.event_id,
    roundNo: Number(raw.round_no),
    submissionId: raw.submission_id || null,
    matchId: raw.match_id || null,
    inputHash: raw.input_hash,
    token: raw.token,
    generation: Number(raw.generation),
    attempt: Number(raw.attempt),
    submission,
    match,
  };
}


/** Claim tối đa 5 job; mảng rỗng khi không có việc. */
export async function claimManualFinalJobs({ worker, limit = 1, leaseSeconds = MANUAL_DEFAULT_LEASE_SECONDS }) {
  if (typeof worker !== 'string' || !worker.trim() || worker.trim().length > 120) {
    throw fail('bad_worker', 'worker phải là chuỗi 1..120 ký tự.');
  }
  const result = await rpc('mvp_manual_final_claim', {
    p_worker: worker.trim(),
    p_limit: clamp(limit, 1, 5, 1),
    p_lease_seconds: clamp(leaseSeconds, 10, 900, MANUAL_DEFAULT_LEASE_SECONDS),
  });
  if (!result || result.ok !== true) {
    throw fail(result?.error || 'bad_claim_response', 'DB không cho claim job.');
  }
  const jobs = Array.isArray(result.jobs) ? result.jobs : [];
  return { jobs: jobs.map(normalizeClaimedJob) };
}

/** Ghi kết quả có fence; trả envelope để đối soát duplicate/lost lease. */
export async function finishManualFinalJob({ jobId, token, generation, kind, outcome }) {
  assertFence({ jobId, token, generation });
  const payload = validateManualOutcome(kind, outcome);
  const result = await rpc('mvp_manual_final_finish', {
    p_job: jobId, p_token: token, p_generation: generation, p_outcome: payload,
  });
  if (!result || typeof result !== 'object') throw fail('bad_finish_response', 'DB không trả kết quả finish hợp lệ.');
  if (result.ok !== true) {
    if (result.error === 'lease_lost') {
      return { applied: false, alreadyFinished: false, leaseLost: true, jobStatus: null, matchStatus: null };
    }
    throw fail(result.error || 'finish_rejected', `Không ghi được kết quả: ${result.error || 'unknown'}`);
  }
  return {
    applied: result.applied === true,
    alreadyFinished: result.already_finished === true,
    leaseLost: false,
    jobStatus: result.job_status || null,
    matchStatus: result.match_status || null,
    submissionStatus: result.submission_status || null,
    result: result.result || null,
    plyCount: result.ply_count === undefined || result.ply_count === null ? null : Number(result.ply_count),
    snapshotHash: result.snapshot_hash || null,
  };
}

/** Trả job để retry cùng input (backoff) hoặc `infra_fault` khi quá số lần. */
export async function releaseManualFinalJob({ jobId, token, generation, error = null,
  maxAttempts = MANUAL_DEFAULT_MAX_ATTEMPTS }) {
  assertFence({ jobId, token, generation });
  const result = await rpc('mvp_manual_final_release', {
    p_job: jobId,
    p_token: token,
    p_generation: generation,
    p_error: typeof error === 'string' ? error.slice(0, 200) : null,
    p_max_attempts: clamp(maxAttempts, 1, 10, MANUAL_DEFAULT_MAX_ATTEMPTS),
  });
  if (!result || typeof result !== 'object') throw fail('bad_release_response', 'DB không trả kết quả release hợp lệ.');
  if (result.ok !== true) {
    return { ok: false, leaseLost: result.error === 'lease_lost', status: null, attempt: null, availableAt: null };
  }
  return {
    ok: true,
    leaseLost: false,
    status: result.status || null,
    attempt: result.attempt === undefined ? null : Number(result.attempt),
    availableAt: result.available_at || null,
  };
}

export default {
  MANUAL_JOB_KINDS,
  claimManualFinalJobs,
  finishManualFinalJob,
  releaseManualFinalJob,
  validateManualOutcome,
  normalizeClaimedJob,
};

