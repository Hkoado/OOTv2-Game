/** Opt-in coordinator foundation, NOT an execution/sandbox adapter.
 * Deliberately absent from runSharedWorker: caller supplies reviewed validation and storage.
 */
import { createHash } from 'node:crypto';
import * as jobs from './githubJobs.js';
import { fetchGithubArtifact, GithubArtifactError } from './githubArtifact.js';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const hash = (source) => createHash('sha256').update(source).digest('hex');
const fault = (code) => Object.assign(new Error(code), { code });

/**
 * validateSource(Buffer,{signal,sourceHash}) -> {status: valid|invalid|infrastructure}
 * storeSource(Buffer,{signal,sourceHash}) -> {storage_path: UUID.py, sha256}
 * Neither callback receives GitHub token, lease token, raw job or repository metadata.
 * Callbacks MUST honor signal and clean up their own resources. No default execution path.
 */
export async function processGithubJob({ enabled = false, workerId, validateSource, storeSource,
  cache, signal, heartbeatMs = 10000, operationTimeoutMs = 60000,
  jobApi = jobs, acquireSource = fetchGithubArtifact } = {}) {
  if (!enabled) return { processed: false, reason: 'disabled' };
  if (typeof workerId !== 'string' || !workerId.trim() || typeof validateSource !== 'function'
    || typeof storeSource !== 'function' || !Number.isInteger(heartbeatMs) || heartbeatMs < 1
    || heartbeatMs > 30000 || !Number.isInteger(operationTimeoutMs) || operationTimeoutMs < 1
    || operationTimeoutMs > 60000) throw fault('invalid_consumer_configuration');
  if (signal?.aborted) return { processed: false, reason: 'canceled' };
  const claimed = await jobApi.claimGithubJob({ worker: workerId, leaseSeconds: 120 });
  if (!claimed) return { processed: false };
  const { job, receipt, lease } = claimed;
  const identityFields = ['event_id', 'team_id', 'repo_id', 'repository', 'commit_sha', 'file_path'];
  if (!job || !receipt || !lease || !UUID.test(job.id) || !UUID.test(lease.token)
    || !Number.isSafeInteger(lease.generation) || lease.generation < 1
    || receipt.job_id !== job.id || identityFields.some((key) => job[key] !== receipt[key])
    || (receipt.source_hash != null && !HASH.test(receipt.source_hash))) {
    // Do not guess a fence/identity or mutate malformed claims. Lease expires for operator review.
    return { processed: true, recorded: false, reason: 'invalid_claim' };
  }
  const fence = { jobId: job.id, token: lease.token, generation: lease.generation };
  const controller = new AbortController();
  let stopped, rejectStop, inFlight, timer, interval, pin;
  let finishing = false;
  const stopPromise = new Promise((_, reject) => { rejectStop = reject; });
  // Attach immediately, including when cancellation happens before the first operation.
  stopPromise.catch(() => {});
  const stop = (code) => {
    if (stopped) return;
    stopped = fault(code); controller.abort(); rejectStop(stopped);
  };
  const onAbort = () => stop('canceled');
  const guard = () => { if (stopped) throw stopped; };
  const run = async (task) => {
    guard();
    const result = await Promise.race([Promise.resolve().then(() => { guard(); return task(); }), stopPromise]);
    guard(); return result;
  };
  const beat = () => {
    if (inFlight) return inFlight;
    inFlight = run(() => jobApi.heartbeatGithubJob({ ...fence, leaseSeconds: 120 }))
      .then((ok) => { if (ok !== true) stop('lease_lost'); })
      .catch(() => { stop('lease_lost'); })
      .finally(() => { inFlight = null; });
    return inFlight;
  };
  const progress = async (status) => {
    if (await run(() => jobApi.progressGithubJob({ ...fence, status })) !== true) stop('lease_lost');
    guard();
  };
  const finish = async (outcome) => {
    await beat(); guard();
    finishing = true;
    const recorded = await run(() => jobApi.finishGithubJob({ ...fence, outcome }));
    return { processed: true, recorded: recorded === true, reason: recorded === true ? outcome.status : 'lease_lost' };
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) onAbort();
  timer = setTimeout(() => stop('operation_timeout'), operationTimeoutMs);
  interval = setInterval(() => { void beat(); }, heartbeatMs);
  try {
    await beat(); guard();
    await progress('fetching');
    const artifact = await run(() => acquireSource(job, { signal: controller.signal,
      ...(receipt.source_hash ? { expectedHash: receipt.source_hash } : {}) }));
    if (!Buffer.isBuffer(artifact?.source) || artifact.source.length < 1 || artifact.source.length > 262144
      || !HASH.test(artifact.sourceHash) || hash(artifact.source) !== artifact.sourceHash
      || (receipt.source_hash && artifact.sourceHash !== receipt.source_hash)) throw fault('artifact_integrity');
    const sourceHash = artifact.sourceHash;
    if (cache) {
      cache.put(artifact.source, sourceHash);
      pin = cache.acquire(sourceHash);
    }
    await progress('checking');
    const validation = await run(() => validateSource(Buffer.from(artifact.source), { signal: controller.signal, sourceHash }));
    if (validation?.status === 'invalid') {
      return await finish({ status: 'invalid', source_hash: sourceHash,
        error: 'bot_validation_failed', error_category: 'code' });
    }
    if (validation?.status !== 'valid') throw fault('validation_infrastructure');
    await beat(); guard();
    const stored = await run(() => storeSource(Buffer.from(artifact.source), { signal: controller.signal, sourceHash }));
    if (typeof stored?.storage_path !== 'string' || !stored.storage_path.endsWith('.py')
      || !UUID.test(stored.storage_path.slice(0, -3)) || stored.sha256 !== sourceHash) throw fault('storage_integrity');
    return await finish({ status: 'valid', source_hash: sourceHash,
      submission: { storage_path: stored.storage_path, sha256: sourceHash } });
  } catch (error) {
    // An uncertain finish may already have committed. Never release/delete its artifact.
    if (finishing) return { processed: true, recorded: false, reason: stopped?.code || 'completion_unknown' };
    if (stopped) return { processed: true, recorded: false, reason: stopped.code };
    if (error instanceof GithubArtifactError && error.category === 'code') {
      try {
        return await finish({ status: 'invalid', error: 'github_source_invalid', error_category: 'code' });
      } catch { return { processed: true, recorded: false, reason: stopped?.code || 'completion_unknown' }; }
    }
    try {
      // Compensate for current release SQL lacking expiry check: confirm lease before release.
      // This is NOT a substitute for fixing/verifying server-side fencing on PostgreSQL.
      await beat(); guard();
      const released = await run(() => jobApi.releaseGithubJob({ ...fence,
        error: 'github_worker_infrastructure', maxAttempts: 3 }));
      return { processed: true, recorded: false, reason: released?.ok === true ? 'infrastructure' : 'lease_lost' };
    } catch { return { processed: true, recorded: false, reason: stopped?.code || 'release_unknown' }; }
  } finally {
    clearTimeout(timer); clearInterval(interval);
    signal?.removeEventListener('abort', onAbort);
    controller.abort();
    pin?.release();
  }
}