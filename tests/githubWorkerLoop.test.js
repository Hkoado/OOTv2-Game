import test from 'node:test';
import assert from 'node:assert/strict';
import { runGithubWorker } from '../server/githubWorker.js';

const deps = { createDeps: () => ({ validateSource: () => ({ status: 'valid' }), storeSource: () => ({}) }) };
const silent = { log: () => {}, error: () => {} };

/** Scripted fake: each entry answers one poll, the last entry repeats. */
function scripted(results) {
  let index = 0;
  const calls = [];
  return {
    calls,
    processJob: async (options) => {
      calls.push(options);
      const value = results[Math.min(index, results.length - 1)];
      index += 1;
      if (value instanceof Error) throw value;
      return value;
    },
  };
}

test('drains the queue immediately, then stops when the claim is empty', async () => {
  const fake = scripted([
    { processed: true, recorded: true, reason: 'valid' },
    { processed: true, recorded: false, reason: 'infrastructure' },
    { processed: false },
  ]);
  const pauses = [];
  const stats = await runGithubWorker({
    drain: true, workerId: 'test', processJob: fake.processJob, ...deps, logger: silent,
    pause: async (ms) => { pauses.push(ms); },
  });
  assert.equal(stats.processed, 2);
  assert.equal(stats.recorded, 1);
  assert.equal(fake.calls.length, 3);
  assert.deepEqual(pauses, []);
  assert.equal(fake.calls[0].enabled, true);
  assert.equal(fake.calls[0].workerId, 'test');
  assert.equal(fake.calls[0].heartbeatMs, 10000);
});

test('service mode polls with a delay instead of spinning when idle', async () => {
  const controller = new AbortController();
  const pauses = [];
  const stats = await runGithubWorker({
    workerId: 'test', ...deps, logger: silent,
    processJob: async () => ({ processed: false }),
    pause: async (ms) => { pauses.push(ms); if (pauses.length === 3) controller.abort(); },
    signal: controller.signal,
  });
  assert.equal(stats.processed, 0);
  assert.equal(stats.idlePolls, 3);
  assert.deepEqual(pauses, [5000, 5000, 5000]);
  assert.equal(stats.stopped, true);
});

test('one bad job backs off and keeps the service alive', async () => {
  const fake = scripted([
    Object.assign(new Error('db down'), { code: 'database_unavailable' }),
    { processed: true, recorded: true, reason: 'valid' },
    { processed: false },
  ]);
  const pauses = [];
  const logged = [];
  const stats = await runGithubWorker({
    drain: true, workerId: 'test', processJob: fake.processJob, ...deps,
    logger: { log: () => {}, error: (line) => logged.push(line) },
    pause: async (ms) => { pauses.push(ms); },
  });
  assert.equal(stats.failures, 1);
  assert.equal(stats.processed, 1);
  assert.deepEqual(pauses, [15000]);
  assert.equal(logged.length, 1);
  assert.match(logged[0], /database_unavailable/);
  // Never leak credentials into logs.
  assert.doesNotMatch(logged[0], /service_role|apikey|Bearer/i);
});

test('once mode surfaces the first failure instead of looping forever', async () => {
  await assert.rejects(runGithubWorker({
    once: true, workerId: 'test', ...deps, logger: silent,
    processJob: async () => { throw new Error('boom'); },
    pause: async () => {},
  }), /boom/);
  const stats = await runGithubWorker({
    once: true, workerId: 'test', ...deps, logger: silent,
    processJob: async () => ({ processed: true, recorded: true, reason: 'valid' }),
    pause: async () => {},
  });
  assert.equal(stats.processed, 1);
});

test('invalid timing or identity configuration is refused before any claim', async () => {
  let called = false;
  const options = { workerId: 'test', ...deps, logger: silent, pause: async () => {},
    processJob: async () => { called = true; return { processed: false }; } };
  for (const [overrides, code] of [
    [{ pollMs: 10 }, 'invalid_poll_interval'],
    [{ pollMs: 120000 }, 'invalid_poll_interval'],
    [{ errorBackoffMs: 10 }, 'invalid_error_backoff'],
    [{ workerId: '   ' }, 'invalid_worker_id'],
    [{ processJob: null }, 'invalid_worker_dependencies'],
  ]) {
    await assert.rejects(runGithubWorker({ ...options, ...overrides }), { code });
  }
  assert.equal(called, false);
});

test('an already-aborted signal claims nothing', async () => {
  const controller = new AbortController();
  controller.abort();
  let called = false;
  const stats = await runGithubWorker({
    workerId: 'test', ...deps, logger: silent, signal: controller.signal,
    processJob: async () => { called = true; return { processed: false }; },
    pause: async () => {},
  });
  assert.equal(called, false);
  assert.equal(stats.processed, 0);
  assert.equal(stats.stopped, true);
});
