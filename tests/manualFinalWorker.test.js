/**
 * manualFinalWorker.test.js — Wiring worker queue manual (mock, không DB/Python).
 *
 * Bảo vệ: claim 1 job manual → execute → log; queue rỗng không chạy gì; processor chọn
 * đúng queue và lease riêng; argv `--manual`/`--all` không mở nhầm queue.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createQueueProcessor, parseWorkerQueues, processManualFinalJob,
  runOfficialWorker } from '../server/officialWorker.js';

const quiet = { log() {}, warn() {}, error() {} };

test('processManualFinalJob claim đúng lease manual rồi chuyển job cho executor', async () => {
  const calls = [];
  const claimed = { jobId: 'job-1', kind: 'match', attempt: 1 };
  const result = await processManualFinalJob({ workerId: 'manual-1', logger: quiet,
    heartbeat: async () => true,
    claim: async (args) => { calls.push(['claim', args]); return { jobs: [claimed] }; },
    execute: async (job, options) => {
      calls.push(['execute', job, options]);
      return { recorded: true, status: 'finished', reason: 'BASE_REACHED' };
    },
  });
  assert.deepEqual(calls[0], ['claim', { worker: 'manual-1', limit: 1, leaseSeconds: 300 }]);
  assert.equal(calls[1][1], claimed);
  assert.equal(calls[1][2].logger, quiet);
  assert.ok(calls[1][2].signal instanceof AbortSignal);
  assert.deepEqual(result, { processed: true, jobId: 'job-1', kind: 'match', recorded: true,
    status: 'finished', reason: 'BASE_REACHED' });
});

test('manual heartbeat lease loss aborts execution and never records a result', async () => {
  let renewals = 0;
  const result = await processManualFinalJob({ workerId: 'w', logger: quiet, heartbeatMs: 5,
    claim: async () => ({ jobs: [{ jobId: 'job', kind: 'match', token: 'token', generation: 2 }] }),
    heartbeat: async () => ++renewals === 1,
    execute: async (_job, { signal }) => new Promise((resolve) => {
      const keepAlive = setTimeout(() => assert.fail('heartbeat did not abort'), 1000);
      signal.addEventListener('abort', () => {
        clearTimeout(keepAlive);
        resolve({ recorded: false });
      }, { once: true });
    }),
  });
  assert.equal(result.recorded, false);
  assert.equal(result.reason, 'lease_lost');
  const count = renewals;
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(renewals, count, 'heartbeat timer must be removed');
});

test('manual initial heartbeat failure does not execute and cleans up shutdown listener', async () => {
  const controller = new AbortController();
  let removed = 0;
  const remove = controller.signal.removeEventListener.bind(controller.signal);
  controller.signal.removeEventListener = (...args) => { removed += 1; return remove(...args); };
  await assert.rejects(processManualFinalJob({ workerId: 'w', signal: controller.signal,
    claim: async () => ({ jobs: [{ jobId: 'j' }] }),
    heartbeat: async () => { throw new Error('network'); },
    execute: async () => assert.fail('must not execute without lease verification'),
  }), /network/);
  assert.equal(removed, 1);
});

test('processManualFinalJob không chạy gì khi queue rỗng', async () => {
  const result = await processManualFinalJob({ workerId: 'manual-1', logger: quiet,
    claim: async () => ({ jobs: [] }),
    execute: async () => assert.fail('không được chạy khi queue rỗng'),
  });
  assert.deepEqual(result, { processed: false });
});

test('createQueueProcessor thử official trước rồi tới manual và cộng dồn reaped', async () => {
  const seen = [];
  const processor = createQueueProcessor({ queues: ['official', 'manual'], handlers: {
    official: async () => { seen.push('official'); return { processed: false, reaped: 2 }; },
    manual: async (context) => { seen.push(`manual:${context.leaseSeconds}`); return { processed: true, recorded: true }; },
  } });
  const result = await processor({ workerId: 'w1', leaseSeconds: 120,
    leaseFor: (queue) => (queue === 'manual' ? 300 : 120), logger: quiet });
  assert.deepEqual(seen, ['official', 'manual:300']);
  assert.equal(result.processed, true);
  assert.equal(result.queue, 'manual');
  assert.equal(result.reaped, 2);
});

test('createQueueProcessor từ chối queue lạ hoặc rỗng', () => {
  assert.throws(() => createQueueProcessor({ queues: ['mvp'] }), { code: 'invalid_queue' });
  assert.throws(() => createQueueProcessor({ queues: [] }), { code: 'invalid_queues' });
});

test('parseWorkerQueues: mặc định official, --manual chỉ manual, --all cả hai', () => {
  assert.deepEqual(parseWorkerQueues({ argv: [] }), ['official']);
  assert.deepEqual(parseWorkerQueues({ argv: ['--once'] }), ['official']);
  assert.deepEqual(parseWorkerQueues({ argv: ['--manual', '--once'] }), ['manual']);
  assert.deepEqual(parseWorkerQueues({ argv: ['--all'] }), ['official', 'manual']);
  assert.throws(() => parseWorkerQueues({ argv: ['--manual', '--all'] }), { code: 'invalid_queues' });
});

test('runOfficialWorker giữ lease manual dài hơn official trong cùng loop', async () => {
  const controller = new AbortController();
  let observed;
  const result = await runOfficialWorker({ workerId: 'w1', queues: ['official', 'manual'],
    leaseSeconds: 120, manualLeaseSeconds: 300, signal: controller.signal, logger: quiet,
    processJob: async (context) => {
      observed = { official: context.leaseFor('official'), manual: context.leaseFor('manual') };
      return { processed: false, reaped: 0 };
    },
    pause: async () => controller.abort(),
  });
  assert.deepEqual(observed, { official: 120, manual: 300 });
  assert.equal(result.idlePolls, 1);
  assert.equal(result.stopped, true);
});
