/**
 * officialWorker.js — service chấm trận Campus chính thức (K3).
 *
 * Chỉ claim job đã pin (round/game/map/runtime/budget hash), chạy `runCampusMatch` qua
 * adapter sandbox fail-closed, rồi ghi MỘT accepted result có fencing. Không dùng runner
 * MVP, không chạy bot trên API, không fallback khi sandbox lỗi.
 *
 * Chạy: `node server/officialWorker.js` (service) hoặc `--once`/`--drain` cho CI/kiểm thử.
 */
import { hostname } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';

import { assertSharedConfig } from './shared/client.js';
import { isMainModule } from './shared/entrypoint.js';
import { claimOfficialJob, reapOfficialJobs } from './shared/officialJobs.js';
import { claimManualFinalJobs, heartbeatManualFinalJob } from './shared/manualFinalJobs.js';
import { executeOfficialJob } from './services/officialExecution.js';
import { MANUAL_WORKER_LEASE_SECONDS, executeManualFinalJob } from './services/manualFinalExecution.js';
import { assertCampusSandboxReady } from './judge/campusSandboxFactory.js';

/** Queue một tiến trình worker có thể xử lý; cùng sandbox/budget, khác nguồn job. */
export const WORKER_QUEUES = Object.freeze(['official', 'manual']);
const MIN_POLL_MS = 250;
const MAX_POLL_MS = 60000;
const MIN_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 300000;
const WORKER_ID = /^[\x20-\x7e]{1,120}$/;

const isInt = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
const safeMessage = (error) => String(error?.code || error?.message || error).slice(0, 160);

export function defaultWorkerId(prefix = 'official') {
  return `${prefix}-${hostname().slice(0, 40)}-${process.pid}`;
}

/**
 * One claim → one execution. `claim`/`execute`/`reap` are injectable so the loop test
 * never touches DB or Python. A failed job never becomes a result and never stops the
 * service; only infrastructure errors back off.
 */
export async function processOfficialJob({ workerId, leaseSeconds = 120, signal,
  claim = claimOfficialJob, execute = executeOfficialJob, reap = reapOfficialJobs, logger = console } = {}) {
  const reaped = await reap({ limit: 50 }).catch(() => ({ reaped: 0 }));
  if (reaped.reaped > 0) logger.warn?.(`[official-worker] reaped ${reaped.reaped} expired lease(s)`);
  const job = await claim({ workerId, leaseSeconds });
  if (!job) return { processed: false, reaped: reaped.reaped };
  const result = await execute(job, { heartbeatMs: Math.max(5000, Math.floor(leaseSeconds * 1000 / 3)),
    leaseSeconds, signal, logger });
  logger.log?.(JSON.stringify({ at: 'official-worker', workerId, job: job.id,
    round: job.roundId, game: job.gameKey, attempt: job.attempt, reclaimed: job.reclaimed,
    recorded: result.recorded === true, reason: result.reason ?? null }));
  return { processed: true, jobId: job.id, recorded: result.recorded === true,
    reason: result.reason ?? null, result: result.result ?? null, attempt: job.attempt };
}

/**
 * Chung kết thủ công: claim một job `validate`/`match` rồi chấm bằng cùng runner/sandbox.
 * Không có runner manual thứ hai; manual và official chỉ khác nguồn job.
 */
export async function processManualFinalJob({ workerId, leaseSeconds = MANUAL_WORKER_LEASE_SECONDS,
  signal, claim = claimManualFinalJobs, execute = executeManualFinalJob,
  heartbeat = heartbeatManualFinalJob, heartbeatMs, logger = console } = {}) {
  if (signal?.aborted) return { processed: false };
  const { jobs } = await claim({ worker: workerId, limit: 1, leaseSeconds });
  const job = Array.isArray(jobs) ? jobs[0] ?? null : null;
  if (!job) return { processed: false };
  const controller = new AbortController();
  const shutdown = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', shutdown, { once: true });
  if (signal?.aborted) shutdown();
  let heartbeatError = null;
  let renewing = null;
  let stopped = false;
  const renew = () => {
    if (stopped || renewing) return renewing;
    renewing = Promise.resolve().then(() => heartbeat({ jobId: job.jobId, token: job.token,
      generation: job.generation, leaseSeconds })).then((ok) => {
      if (!ok) throw Object.assign(new Error('lease_lost'), { code: 'lease_lost' });
    }).catch((error) => {
      heartbeatError = error;
      controller.abort(error);
    }).finally(() => { renewing = null; });
    return renewing;
  };
  let timer;
  let result;
  try {
    await renew();
    if (heartbeatError) {
      if (heartbeatError.code !== 'lease_lost') throw heartbeatError;
      return { processed: true, jobId: job.jobId, kind: job.kind, recorded: false,
        status: 'lease_lost', reason: 'lease_lost' };
    }
    timer = setInterval(renew, heartbeatMs ?? Math.max(1000, Math.floor(leaseSeconds * 1000 / 3)));
    timer.unref?.();
    result = await execute(job, { signal: controller.signal, logger });
    // A failed renewal never turns an unrecorded attempt into success.
    if (heartbeatError && result.recorded !== true) {
      result = { ...result, recorded: false,
        status: heartbeatError.code === 'lease_lost' ? 'lease_lost' : 'infrastructure',
        reason: heartbeatError.code === 'lease_lost' ? 'lease_lost' : 'heartbeat_failed' };
    }
  } finally {
    stopped = true;
    clearInterval(timer);
    await renewing;
    signal?.removeEventListener('abort', shutdown);
  }
  logger.log?.(JSON.stringify({ at: 'manual-worker', workerId, job: job.jobId, kind: job.kind,
    attempt: job.attempt, recorded: result.recorded === true, status: result.status ?? null,
    reason: result.reason ?? null }));
  return { processed: true, jobId: job.jobId, kind: job.kind, recorded: result.recorded === true,
    status: result.status ?? null, reason: result.reason ?? null };
}

/**
 * Ghép nhiều queue vào một loop: thử theo thứ tự, dừng ở job đầu tiên xử lý được.
 * `handlers` được inject để test không cần DB/Python.
 */
export function createQueueProcessor({ queues = ['official'] , handlers = {} } = {}) {
  const list = Array.isArray(queues) ? [...queues] : null;
  if (!list || list.length === 0) throw Object.assign(new Error('invalid_queues'), { code: 'invalid_queues' });
  const resolved = {};
  for (const queue of list) {
    if (!WORKER_QUEUES.includes(queue)) {
      throw Object.assign(new Error('invalid_queue'), { code: 'invalid_queue' });
    }
    const handler = handlers[queue] ?? (queue === 'official' ? processOfficialJob : processManualFinalJob);
    if (typeof handler !== 'function') throw Object.assign(new Error('invalid_worker_dependencies'), { code: 'invalid_worker_dependencies' });
    resolved[queue] = handler;
  }
  return async (context) => {
    let reaped = 0;
    for (const queue of list) {
      // Mỗi queue có lease riêng (manual chưa có heartbeat → dài hơn).
      const leaseSeconds = typeof context?.leaseFor === 'function'
        ? context.leaseFor(queue) : context?.leaseSeconds;
      const outcome = await resolved[queue]({ ...context, leaseSeconds });
      reaped += Number(outcome?.reaped ?? 0);
      if (outcome?.processed) return { ...outcome, queue, reaped };
    }
    return { processed: false, reaped, queue: null };
  };
}

/** Chọn queue từ argv: mặc định official; `--manual` chỉ manual; `--all` cả hai. */
export function parseWorkerQueues({ argv = [] } = {}) {
  const args = new Set(argv);
  if (args.has('--manual') && args.has('--all')) {
    throw Object.assign(new Error('invalid_queues'), { code: 'invalid_queues' });
  }
  if (args.has('--manual')) return ['manual'];
  if (args.has('--all')) return [...WORKER_QUEUES];
  return ['official'];
}

/** Long-running loop: one match at a time per process, graceful stop on signal. */
export async function runOfficialWorker({
  once = false,
  drain = false,
  pollMs = 2000,
  errorBackoffMs = 15000,
  leaseSeconds = 120,
  manualLeaseSeconds = MANUAL_WORKER_LEASE_SECONDS,
  queues = ['official'],
  signal,
  workerId = defaultWorkerId(),
  processJob,
  pause = (ms) => sleep(ms, undefined, { signal }),
  logger = console,
} = {}) {
  if (!isInt(pollMs, MIN_POLL_MS, MAX_POLL_MS)) throw Object.assign(new Error('invalid_poll_interval'), { code: 'invalid_poll_interval' });
  if (!isInt(errorBackoffMs, MIN_BACKOFF_MS, MAX_BACKOFF_MS)) throw Object.assign(new Error('invalid_error_backoff'), { code: 'invalid_error_backoff' });
  if (!isInt(leaseSeconds, 30, 3600)) throw Object.assign(new Error('invalid_lease'), { code: 'invalid_lease' });
  if (!isInt(manualLeaseSeconds, 10, 900)) throw Object.assign(new Error('invalid_lease'), { code: 'invalid_lease' });
  if (typeof workerId !== 'string' || !WORKER_ID.test(workerId)) {
    throw Object.assign(new Error('invalid_worker_id'), { code: 'invalid_worker_id' });
  }
  const processor = processJob ?? createQueueProcessor({ queues });
  if (typeof processor !== 'function' || typeof pause !== 'function') {
    throw Object.assign(new Error('invalid_worker_dependencies'), { code: 'invalid_worker_dependencies' });
  }

  let stopping = false;
  const stop = () => { stopping = true; };
  const onSignal = () => stop();
  signal?.addEventListener('abort', onSignal, { once: true });
  if (signal?.aborted) stopping = true;

  const queueLease = (queue) => (queue === 'manual' ? manualLeaseSeconds : leaseSeconds);
  const stats = { workerId, processed: 0, recorded: 0, failures: 0, idlePolls: 0, reaped: 0 };
  try {
    while (!stopping) {
      let outcome;
      try {
        outcome = await processor({ workerId, leaseSeconds, manualLeaseSeconds,
          leaseFor: queueLease, signal, logger });
      } catch (error) {
        // DB/Storage/runner failure: back off, never switch judge profile locally.
        stats.failures += 1;
        logger.error?.(JSON.stringify({ at: 'official-worker', workerId, error: safeMessage(error) }));
        if (once) throw error;
        await pause(errorBackoffMs);
        continue;
      }
      if (stopping) break;
      if (!outcome?.processed) {
        stats.idlePolls += 1;
        stats.reaped += Number(outcome?.reaped ?? 0);
        if (once || drain) break;
        await pause(pollMs);
        continue;
      }
      stats.processed += 1;
      stats.reaped += Number(outcome.reaped ?? 0);
      if (outcome.recorded) stats.recorded += 1;
      if (once) break;
    }
  } finally {
    signal?.removeEventListener('abort', onSignal);
  }
  return { ...stats, stopped: stopping };
}

export async function runOfficialWorkerEntry({ argv = process.argv.slice(2), ...options } = {}) {
  const args = new Set(argv);
  assertSharedConfig();
  // Fail fast: thiếu sandbox/attestation thì dừng ngay, không claim job rồi retry vô hạn
  // và không bao giờ tự hạ xuống chạy bot Python trực tiếp trên host.
  const sandbox = assertCampusSandboxReady();
  if (sandbox.trustedDev) {
    console.warn('[official-worker] CẢNH BÁO: trusted-dev — bot chạy trực tiếp trên host, '
      + 'chỉ dùng cho máy dev tin cậy; KHÔNG dùng cho bài nộp công khai.');
  }
  console.log(JSON.stringify({ at: 'official-worker', sandbox: sandbox.mode }));
  const queues = parseWorkerQueues({ argv });
  const controller = new AbortController();
  const shutdown = () => controller.abort();
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  try {
    return await runOfficialWorker({ once: args.has('--once'), drain: args.has('--drain'),
      queues, ...(queues.length === 1 && queues[0] === 'manual'
        ? { workerId: defaultWorkerId('manual') } : {}),
      signal: controller.signal, ...options });
  } finally {
    process.off('SIGINT', shutdown);
    process.off('SIGTERM', shutdown);
  }
}

const isEntryPoint = isMainModule(import.meta.url);

if (isEntryPoint) {
  runOfficialWorkerEntry().then((stats) => {
    console.log(`RESULT processed=${stats.processed} recorded=${stats.recorded} failures=${stats.failures}`);
  }).catch((error) => {
    console.error('[official-worker] fatal:', safeMessage(error));
    process.exitCode = 1;
  });
}

export default { runOfficialWorker, runOfficialWorkerEntry, processOfficialJob,
  processManualFinalJob, createQueueProcessor, parseWorkerQueues };
