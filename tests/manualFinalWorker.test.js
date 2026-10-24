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
    claim: async (args) => { calls.push(['claim', args]); return { jobs: [claimed] }; },
    execute: async (job, options) => {
      calls.push(['execute', job, options]);
      return { recorded: true, status: 'finished', reason: 'BASE_REACHED' };
    },
  });
  assert.deepEqual(calls[0], ['claim', { worker: 'manual-1', limit: 1, leaseSeconds: 300 }]);
  assert.equal(calls[1][1], claimed);
  assert.equal(calls[1][2].logger, quiet);
  assert.deepEqual(result, { processed: true, jobId: 'job-1', kind: 'match', recorded: true,
    status: 'finished', reason: 'BASE_REACHED' });
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
