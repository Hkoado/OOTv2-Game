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
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

import { assertSharedConfig } from './shared/client.js';
import { claimOfficialJob, reapOfficialJobs } from './shared/officialJobs.js';
import { executeOfficialJob } from './services/officialExecution.js';

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
    leaseSeconds, logger });
  logger.log?.(JSON.stringify({ at: 'official-worker', workerId, job: job.id,
    round: job.roundId, game: job.gameKey, attempt: job.attempt, reclaimed: job.reclaimed,
    recorded: result.recorded === true, reason: result.reason ?? null }));
  return { processed: true, jobId: job.id, recorded: result.recorded === true,
    reason: result.reason ?? null, result: result.result ?? null, attempt: job.attempt };
}

/** Long-running loop: one match at a time per process, graceful stop on signal. */
export async function runOfficialWorker({
  once = false,
  drain = false,
  pollMs = 2000,
  errorBackoffMs = 15000,
  leaseSeconds = 120,
  signal,
  workerId = defaultWorkerId(),
  processJob = processOfficialJob,
  pause = (ms) => sleep(ms, undefined, { signal }),
  logger = console,
} = {}) {
  if (!isInt(pollMs, MIN_POLL_MS, MAX_POLL_MS)) throw Object.assign(new Error('invalid_poll_interval'), { code: 'invalid_poll_interval' });
  if (!isInt(errorBackoffMs, MIN_BACKOFF_MS, MAX_BACKOFF_MS)) throw Object.assign(new Error('invalid_error_backoff'), { code: 'invalid_error_backoff' });
  if (!isInt(leaseSeconds, 30, 3600)) throw Object.assign(new Error('invalid_lease'), { code: 'invalid_lease' });
  if (typeof workerId !== 'string' || !WORKER_ID.test(workerId)) {
    throw Object.assign(new Error('invalid_worker_id'), { code: 'invalid_worker_id' });
  }
  if (typeof processJob !== 'function' || typeof pause !== 'function') {
    throw Object.assign(new Error('invalid_worker_dependencies'), { code: 'invalid_worker_dependencies' });
  }

  let stopping = false;
  const stop = () => { stopping = true; };
  const onSignal = () => stop();
  signal?.addEventListener('abort', onSignal, { once: true });
  if (signal?.aborted) stopping = true;

  const stats = { workerId, processed: 0, recorded: 0, failures: 0, idlePolls: 0, reaped: 0 };
  try {
    while (!stopping) {
      let outcome;
      try {
        outcome = await processJob({ workerId, leaseSeconds, signal, logger });
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
  const controller = new AbortController();
  const shutdown = () => controller.abort();
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  try {
    return await runOfficialWorker({ once: args.has('--once'), drain: args.has('--drain'),
      signal: controller.signal, ...options });
  } finally {
    process.off('SIGINT', shutdown);
    process.off('SIGTERM', shutdown);
  }
}

const isEntryPoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntryPoint) {
  runOfficialWorkerEntry().then((stats) => {
    console.log(`RESULT processed=${stats.processed} recorded=${stats.recorded} failures=${stats.failures}`);
  }).catch((error) => {
    console.error('[official-worker] fatal:', safeMessage(error));
    process.exitCode = 1;
  });
}

export default { runOfficialWorker, runOfficialWorkerEntry, processOfficialJob };
