/**
 * githubJobs.js — Client contract cho worker GitHub intake (H1/H2 boundary).
 *
 * Worker BTC (Khoa) dùng các hàm này để claim → heartbeat/progress → finish | release.
 * Mọi kiểm lease/generation/trạng thái nằm ở RPC SQL (`20261024160000_github_jobs_worker.sql`),
 * client chỉ validate input và chuẩn hoá payload để không gửi dữ liệu rác.
 *
 * `false` từ heartbeat/progress/finish nghĩa là **mất lease** (worker cũ/stale): phải dừng ghi.
 */

import { rpc } from './client.js';
import { HttpError } from '../lib/httpError.js';

export const DEFAULT_LEASE_SECONDS = 120;
export const DEFAULT_MAX_ATTEMPTS = 3;
export const FINISH_STATUSES = Object.freeze(['valid', 'invalid', 'infrastructure']);
export const PROGRESS_STATUSES = Object.freeze(['fetching', 'checking']);
export const ERROR_CATEGORIES = Object.freeze(['code', 'infrastructure', 'repo']);

const SHA256_RE = /^[0-9a-f]{64}$/u;
const STORAGE_RE = /^[0-9a-f-]{36}\.py$/u;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

const fail = (code, message) => new HttpError(400, code, message);
const isUuid = (value) => typeof value === 'string' && UUID_RE.test(value);

/** Lease 10..900 giây (DB cũng chặn cùng khoảng). */
export function clampLeaseSeconds(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return DEFAULT_LEASE_SECONDS;
  return Math.min(900, Math.max(10, Math.round(seconds)));
}

/** Giới hạn 1..10 lần claim/retry (DB cũng kẹp). */
export function clampMaxAttempts(value) {
  const attempts = Number(value);
  if (!Number.isFinite(attempts)) return DEFAULT_MAX_ATTEMPTS;
  return Math.min(10, Math.max(1, Math.round(attempts)));
}

/** Chuẩn hoá outcome trước khi gửi RPC; ném `HttpError` nếu thiếu dữ liệu bắt buộc. */
export function validateFinishOutcome(outcome) {
  if (!outcome || typeof outcome !== 'object' || Array.isArray(outcome)) throw fail('bad_outcome', 'Outcome phải là object.');
  if (!FINISH_STATUSES.includes(outcome.status)) throw fail('bad_outcome', 'status phải là valid/invalid/infrastructure.');
  if (outcome.error !== undefined && outcome.error !== null && typeof outcome.error !== 'string') {
    throw fail('bad_outcome', 'error phải là chuỗi.');
  }
  const error = typeof outcome.error === 'string' ? outcome.error.slice(0, 400) : null;

  if (outcome.status !== 'valid') {
    return {
      status: outcome.status,
      source_hash: SHA256_RE.test(String(outcome.source_hash || '')) ? outcome.source_hash : null,
      submission_id: null,
      submission: null,
      error,
      error_category: ERROR_CATEGORIES.includes(outcome.error_category)
        ? outcome.error_category
        : outcome.status === 'invalid' ? 'code' : 'infrastructure',
    };
  }

  if (!SHA256_RE.test(String(outcome.source_hash || ''))) throw fail('bad_outcome', 'source_hash phải là sha256 hex.');
  if (outcome.submission_id !== undefined && outcome.submission_id !== null && !isUuid(outcome.submission_id)) {
    throw fail('bad_submission', 'submission_id không hợp lệ.');
  }
  let submission = null;
  if (outcome.submission) {
    const storagePath = String(outcome.submission.storage_path || '');
    const sha256 = String(outcome.submission.sha256 || '');
    if (!STORAGE_RE.test(storagePath)) throw fail('bad_submission', 'storage_path phải là <uuid>.py.');
    if (!SHA256_RE.test(sha256)) throw fail('bad_submission', 'sha256 của submission không hợp lệ.');
    if (sha256 !== outcome.source_hash) throw fail('bad_submission', 'sha256 phải khớp source_hash.');
    submission = { storage_path: storagePath, sha256 };
  }
  if (!outcome.submission_id && !submission) throw fail('missing_submission', 'Cần submission_id hoặc payload submission.');

  return {
    status: 'valid',
    source_hash: outcome.source_hash,
    submission_id: outcome.submission_id || null,
    submission,
    error: null,
    error_category: null,
  };
}


function assertJob({ jobId, token, generation }) {
  if (!isUuid(jobId)) throw fail('bad_job', 'job id không hợp lệ.');
  if (!isUuid(token)) throw fail('bad_lease_token', 'lease token không hợp lệ.');
  if (!Number.isInteger(generation) || generation < 1) throw fail('bad_generation', 'generation phải là số nguyên >= 1.');
}

/** Claim một job đang chờ/lease hết hạn; trả `null` khi không có việc. */
export async function claimGithubJob({ worker, leaseSeconds = DEFAULT_LEASE_SECONDS, maxAttempts = DEFAULT_MAX_ATTEMPTS } = {}) {
  if (typeof worker !== 'string' || !worker.trim()) throw fail('bad_worker', 'worker id không hợp lệ.');
  const result = await rpc('mvp_github_claim', {
    p_worker: worker.trim().slice(0, 120),
    p_lease_seconds: clampLeaseSeconds(leaseSeconds),
    p_max_attempts: clampMaxAttempts(maxAttempts),
  });
  if (!result) return null;
  return {
    job: result.job,
    receipt: result.receipt || null,
    lease: {
      token: result.lease?.token,
      generation: Number(result.lease?.generation || 0),
      expiresAt: result.lease?.expires_at || null,
      attempt: Number(result.lease?.attempt || 0),
      maxAttempts: Number(result.lease?.max_attempts || DEFAULT_MAX_ATTEMPTS),
    },
  };
}

/** Gia hạn lease. `false` = mất lease, worker phải dừng. */
export async function heartbeatGithubJob({ jobId, token, generation, leaseSeconds = DEFAULT_LEASE_SECONDS }) {
  assertJob({ jobId, token, generation });
  return Boolean(await rpc('mvp_github_heartbeat', {
    p_job: jobId,
    p_token: token,
    p_generation: generation,
    p_lease_seconds: clampLeaseSeconds(leaseSeconds),
  }));
}

/** Báo tiến độ fetching/checking cho UI. `false` = mất lease. */
export async function progressGithubJob({ jobId, token, generation, status, note = null }) {
  assertJob({ jobId, token, generation });
  if (!PROGRESS_STATUSES.includes(status)) throw fail('bad_progress', 'status phải là fetching/checking.');
  const safeNote = typeof note === 'string' ? note.slice(0, 400) : null;
  return Boolean(await rpc('mvp_github_progress', {
    p_job: jobId,
    p_token: token,
    p_generation: generation,
    p_status: status,
    p_note: safeNote,
  }));
}

/**
 * Ghi kết quả và trả envelope để đối soát: `{ applied, alreadyFinished, leaseLost, receipt }`.
 * - `alreadyFinished=true`: lần trước đã commit nhưng mất response → KHÔNG tạo submission lần 2;
 *   dùng `receipt.submission_id` để biết artifact của mình đã được nhận hay chưa.
 * - `leaseLost=true`: worker cũ/lease hết hạn → dừng, không coi là đã ghi.
 */
export async function finishGithubJob({ jobId, token, generation, outcome }) {
  assertJob({ jobId, token, generation });
  const payload = validateFinishOutcome(outcome);
  const result = await rpc('mvp_github_finish', {
    p_job: jobId,
    p_token: token,
    p_generation: generation,
    p_outcome: payload,
  });
  if (!result || typeof result !== 'object') throw fail('bad_finish_response', 'DB không trả kết quả finish hợp lệ.');
  if (result.ok === false) {
    if (result.error === 'lease_lost') {
      return { applied: false, alreadyFinished: false, leaseLost: true, receipt: null, job: null };
    }
    throw fail(result.error || 'finish_rejected', `Không ghi được kết quả: ${result.error || 'unknown'}`);
  }
  return {
    applied: result.applied === true,
    alreadyFinished: result.already_finished === true,
    leaseLost: false,
    receipt: result.receipt || null,
    job: result.job || null,
  };
}

/** Trả job để retry (backoff) hoặc `infra_fault`; lease hết hạn/sai token => `leaseLost`. */
export async function releaseGithubJob({ jobId, token, generation, error = null, maxAttempts = DEFAULT_MAX_ATTEMPTS }) {
  assertJob({ jobId, token, generation });
  const safeError = typeof error === 'string' ? error.slice(0, 400) : null;
  const result = await rpc('mvp_github_release', {
    p_job: jobId,
    p_token: token,
    p_generation: generation,
    p_error: safeError,
    p_max_attempts: clampMaxAttempts(maxAttempts),
  });
  if (!result || typeof result !== 'object') throw fail('bad_release_response', 'DB không trả kết quả release hợp lệ.');
  if (result.ok === false) {
    return {
      ok: false, applied: false, leaseLost: result.error === 'lease_lost',
      status: null, attempt: null, availableAt: null, receipt: null,
    };
  }
  return {
    ok: true,
    applied: result.applied === true,
    leaseLost: false,
    status: result.status || null,
    attempt: Number(result.attempt || 0),
    availableAt: result.available_at || null,
    receipt: result.receipt || null,
  };
}

export default {
  DEFAULT_LEASE_SECONDS,
  DEFAULT_MAX_ATTEMPTS,
  claimGithubJob,
  heartbeatGithubJob,
  progressGithubJob,
  finishGithubJob,
  releaseGithubJob,
  validateFinishOutcome,
  clampLeaseSeconds,
  clampMaxAttempts,
};
