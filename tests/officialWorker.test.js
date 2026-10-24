import test from 'node:test';
import assert from 'node:assert/strict';
import { processOfficialJob, runOfficialWorker } from '../server/officialWorker.js';

const quiet = { log() {}, warn() {}, error() {} };

test('processOfficialJob reaps, claims, and executes one claimed job with lease timing', async () => {
  const calls = [];
  const job = { id: 'job-1', roundId: 'round-1', gameKey: 'g1', attempt: 2, reclaimed: true };
  const result = await processOfficialJob({ workerId: 'worker-1', leaseSeconds: 90, logger: quiet,
    reap: async (args) => { calls.push(['reap', args]); return { reaped: 1 }; },
    claim: async (args) => { calls.push(['claim', args]); return job; },
    execute: async (claimed, options) => {
      calls.push(['execute', claimed, options]);
      return { recorded: true, result: 'red_win', reason: 'captured' };
    },
  });

  assert.deepEqual(calls[0], ['reap', { limit: 50 }]);
  assert.deepEqual(calls[1], ['claim', { workerId: 'worker-1', leaseSeconds: 90 }]);
  assert.equal(calls[2][1], job);
  assert.equal(calls[2][2].heartbeatMs, 30000);
  assert.equal(calls[2][2].leaseSeconds, 90);
  assert.equal(calls[2][2].signal, undefined);
  assert.deepEqual(result, { processed: true, jobId: 'job-1', recorded: true,
    reason: 'captured', result: 'red_win', attempt: 2 });
});

test('processOfficialJob forwards the shutdown signal to the claimed execution', async () => {
  const controller = new AbortController();
  let received;
  await processOfficialJob({ workerId: 'worker-1', signal: controller.signal, logger: quiet,
    reap: async () => ({ reaped: 0 }), claim: async () => ({ id: 'job-1', roundId: 'round-1',
      gameKey: 'g1', attempt: 1 }),
    execute: async (_job, options) => { received = options.signal; return { recorded: false }; },
  });
  assert.equal(received, controller.signal);
});

test('processOfficialJob does not execute when queue is empty and tolerates reap failure', async () => {
  let claims = 0;
  const result = await processOfficialJob({ workerId: 'worker-1', logger: quiet,
    reap: async () => { throw new Error('temporary db issue'); },
    claim: async () => { claims += 1; return null; },
    execute: async () => assert.fail('must not execute without a claim'),
  });
  assert.equal(claims, 1);
  assert.deepEqual(result, { processed: false, reaped: 0 });
});

test('runOfficialWorker backs off after transient failures and continues polling', async () => {
  const delays = [];
  let calls = 0;
  const controller = new AbortController();
  const result = await runOfficialWorker({ workerId: 'worker-1', pollMs: 250,
    errorBackoffMs: 1000, signal: controller.signal, logger: quiet,
    processJob: async () => {
      calls += 1;
      if (calls === 1) throw new Error('temporary db issue');
      return { processed: false, reaped: 0 };
    },
    pause: async (ms) => { delays.push(ms); if (delays.length === 2) controller.abort(); },
  });
  assert.equal(calls, 2);
  assert.deepEqual(delays, [1000, 250]);
  assert.equal(result.failures, 1);
  assert.equal(result.idlePolls, 1);
  assert.equal(result.stopped, true);
});

test('runOfficialWorker once mode propagates infrastructure errors without retrying', async () => {
  let calls = 0;
  await assert.rejects(runOfficialWorker({ once: true, workerId: 'worker-1', logger: quiet,
    processJob: async () => { calls += 1; throw Object.assign(new Error('db down'), { code: 'database_unavailable' }); },
    pause: async () => assert.fail('once mode must not back off'),
  }), { code: 'database_unavailable' });
  assert.equal(calls, 1);
});

test('runOfficialWorker stops after an abort during idle wait', async () => {
  const controller = new AbortController();
  let calls = 0;
  const result = await runOfficialWorker({ workerId: 'worker-1', signal: controller.signal,
    logger: quiet, processJob: async () => { calls += 1; return { processed: false }; },
    pause: async () => controller.abort(),
  });
  assert.equal(calls, 1);
  assert.equal(result.stopped, true);
  assert.equal(result.idlePolls, 1);
});