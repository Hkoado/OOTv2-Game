/**
 * githubWorker.js — service dài hạn cho GitHub cutoff intake.
 *
 * Chỉ làm một việc đã được review: claim job có lease/token, tải source theo SHA,
 * kiểm tra tĩnh + cú pháp Python, upload Storage private, finish có fencing.
 * KHÔNG chấm trận, KHÔNG chạy bot, KHÔNG gọi `shared/worker.js` (MVP).
 *
 * Tách khỏi MVP vì `server/worker.js` chấm trận bằng runner MVP và không có
 * sandbox — không được phép trở thành fallback khi service này lỗi.
 *
 * Chạy: `npm run worker:github` (service) hoặc `--once`/`--drain` cho CI/kiểm thử.
 */
import { hostname } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';

import { assertSharedConfig } from './shared/client.js';
import { isMainModule } from './shared/entrypoint.js';
import { processGithubJob } from './shared/githubConsumer.js';
import { createCutoffWorkerDeps } from './shared/githubWorkerDeps.js';

const MIN_POLL_MS = 250;
const MAX_POLL_MS = 60000;
const MIN_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 300000;

const isInt = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
const safeMessage = (error) => String(error?.code || error?.message || error).slice(0, 160);

export function defaultWorkerId(prefix = 'github') {
  return `${prefix}-${hostname().slice(0, 40)}-${process.pid}`;
}

/**
 * `processJob`, `createDeps` and `pause` are injectable so tests never touch DB,
 * GitHub or the clock. Errors are contained: one bad job must not stop the service.
 */
export async function runGithubWorker({
  once = false,
  drain = false,
  pollMs = 5000,
  errorBackoffMs = 15000,
  signal,
  workerId = defaultWorkerId(),
  processJob = processGithubJob,
  createDeps = createCutoffWorkerDeps,
  pause = (ms) => sleep(ms, undefined, { signal }),
  logger = console,
} = {}) {
  if (!isInt(pollMs, MIN_POLL_MS, MAX_POLL_MS)) throw Object.assign(new Error('invalid_poll_interval'), { code: 'invalid_poll_interval' });
  if (!isInt(errorBackoffMs, MIN_BACKOFF_MS, MAX_BACKOFF_MS)) throw Object.assign(new Error('invalid_error_backoff'), { code: 'invalid_error_backoff' });
  if (typeof workerId !== 'string' || !workerId.trim() || workerId.length > 120) {
    throw Object.assign(new Error('invalid_worker_id'), { code: 'invalid_worker_id' });
  }
  if (typeof processJob !== 'function' || typeof createDeps !== 'function' || typeof pause !== 'function') {
    throw Object.assign(new Error('invalid_worker_dependencies'), { code: 'invalid_worker_dependencies' });
  }

  const deps = createDeps();
  let stopping = false;
  const stop = () => { stopping = true; };
  const onSignal = () => stop();
  signal?.addEventListener('abort', onSignal, { once: true });
  if (signal?.aborted) stopping = true;

  const stats = { workerId, processed: 0, recorded: 0, failures: 0, idlePolls: 0 };
  try {
    while (!stopping) {
      let result;
      try {
        result = await processJob({
          enabled: true,
          workerId,
          signal,
          ...deps,
          heartbeatMs: 10000,
          operationTimeoutMs: 60000,
        });
      } catch (error) {
        // Infrastructure/logic failure: log and back off. Never turn this into a
        // silent switch to another judge profile.
        stats.failures += 1;
        logger.error?.(JSON.stringify({ at: 'github-worker', workerId, error: safeMessage(error) }));
        if (once) throw error;
        await pause(errorBackoffMs);
        continue;
      }
      if (stopping) break;
      if (!result?.processed) {
        stats.idlePolls += 1;
        if (once || drain) break;
        await pause(pollMs);
        continue;
      }
      stats.processed += 1;
      if (result.recorded) stats.recorded += 1;
      logger.log?.(JSON.stringify({ at: 'github-worker', workerId, reason: result.reason, recorded: result.recorded === true }));
      if (once) break;
    }
  } finally {
    signal?.removeEventListener('abort', onSignal);
  }
  return { ...stats, stopped: stopping };
}

export async function runGithubWorkerEntry({ argv = process.argv.slice(2), ...options } = {}) {
  const args = new Set(argv);
  assertSharedConfig();
  const controller = new AbortController();
  const shutdown = () => controller.abort();
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  try {
    return await runGithubWorker({
      once: args.has('--once'),
      drain: args.has('--drain'),
      signal: controller.signal,
      ...options,
    });
  } finally {
    process.off('SIGINT', shutdown);
    process.off('SIGTERM', shutdown);
  }
}

const isEntryPoint = isMainModule(import.meta.url);

if (isEntryPoint) {
  runGithubWorkerEntry().then((stats) => {
    console.log(`RESULT processed=${stats.processed} recorded=${stats.recorded} failures=${stats.failures}`);
  }).catch((error) => {
    console.error('[github-worker] fatal:', safeMessage(error));
    process.exitCode = 1;
  });
}

export default { runGithubWorker, runGithubWorkerEntry };
