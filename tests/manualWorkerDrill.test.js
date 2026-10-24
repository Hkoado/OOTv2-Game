/**
 * manualWorkerDrill.test.js — Drill 2 worker cho queue manual (không DB/Python).
 *
 * Chạy `runDrill()` của `tools/cli/manual-worker-drill.js`: worker loop + executor thật,
 * queue in-memory mô phỏng lease/generation/attempt của `mvp_manual_final_*`.
 * Bảo vệ: 2 worker không chấm trùng, lease mất không ghi, retry giữ input, hết lượt →
 * infra_fault, finish lặp → already_finished, 0-ply → bot_fault, validate không tạo kết quả trận.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createDrillQueue, drillMatchJob, runDrill } from '../tools/cli/manual-worker-drill.js';

test('drill 2 worker manual: toàn bộ kịch bản PASS', async () => {
  const report = await runDrill();
  assert.equal(report.version, 'manual-worker-drill.v1');
  assert.equal(report.total, 9);
  assert.deepEqual(report.scenarios.filter((item) => !item.pass), []);
  assert.equal(report.passAll, true);
  assert.equal(report.pass, 9);
});

test('queue drill: claim cấp generation/attempt tăng và requeue khi lease hết hạn', () => {
  const job = drillMatchJob();
  const queue = createDrillQueue({ jobs: [{ ...job, createdAt: 1 }] });
  const first = queue.claim({ worker: 'a', leaseSeconds: 10 }).jobs[0];
  assert.equal(first.generation, 1);
  assert.equal(first.attempt, 1);
  assert.deepEqual(queue.claim({ worker: 'b', leaseSeconds: 10 }).jobs, []);
  queue.advance(10_000);
  const second = queue.claim({ worker: 'b', leaseSeconds: 10 }).jobs[0];
  assert.equal(second.generation, 2);
  assert.equal(second.attempt, 2);
  assert.equal(second.inputHash, first.inputHash);
});
