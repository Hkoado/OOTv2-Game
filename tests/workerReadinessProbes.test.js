import test from 'node:test';
import assert from 'node:assert/strict';
import { githubClaimHealthy, jsonbClaimHealthy, jsonbGuardHealthy } from '../tools/cli/workerHealthProbes.js';

// Hợp đồng thật (docs/HUY-KHOA-CHOT-SCHEMA-WORKER.md §4): `mvp_github_claim` raise
// `bad_worker` → HTTP 400/P0001; official/manual claim trả JSONB HTTP 200 với `ok:false`.
// Bug cũ: probe chỉ nhận `bad_lease` nên DB đúng vẫn bị chặn khởi động worker.
test('github claim probe accepts the real bad_worker guard and nothing broader', () => {
  assert.equal(githubClaimHealthy({ status: 400, body: { code: 'P0001', message: 'bad_worker' } }), 'bad_worker');
  // Deployment cũ raise bad_lease trước guard worker: vẫn là guard trước truy vấn job.
  assert.equal(githubClaimHealthy({ status: 400, body: { code: 'P0001', message: 'bad_lease' } }), 'bad_lease');
  // Lỗi khác nghĩa là RPC/history/quyền sai, không phải "đã sẵn sàng".
  assert.equal(githubClaimHealthy({ status: 404, body: { code: 'PGRST202', message: 'no function' } }), null);
  assert.equal(githubClaimHealthy({ status: 401, body: { message: 'jwt' } }), null);
  assert.equal(githubClaimHealthy({ status: 500, body: { code: 'P0001', message: 'bad_worker' } }), null);
  assert.equal(githubClaimHealthy({ status: 400, body: { code: 'P0001', message: 'other_failure' } }), null);
  assert.equal(githubClaimHealthy({ status: 400, body: null }), null);
});

test('jsonb claim probe never treats a real lease as healthy', () => {
  assert.equal(jsonbClaimHealthy({ status: 200, body: { ok: false, error: 'bad_worker' } }), 'bad_worker');
  // `ok:true` = RPC đã claim job thật; probe hỏng nghĩa là health-check đã tiêu thụ job.
  assert.equal(jsonbClaimHealthy({ status: 200, body: { ok: true, job: { id: 'x' } } }), null);
  assert.equal(jsonbClaimHealthy({ status: 200, body: { ok: false, error: 'bad_lease' } }), null);
  assert.equal(jsonbClaimHealthy({ status: 400, body: { ok: false, error: 'bad_worker' } }), null);
  assert.equal(jsonbClaimHealthy({ status: 200, body: { error: 'bad_worker' } }), null);
  // Official clamp lease 30..3600 ⇒ không bao giờ có bad_lease; guard phải là bad_worker.
  assert.equal(jsonbClaimHealthy({ status: 200, body: { ok: false, error: 'bad_lease' } }, 'bad_worker'), null);
});

test('jsonb guard probe is exact-match and status-bound', () => {
  assert.equal(jsonbGuardHealthy({ status: 200, body: { error: 'bad_lease' } }, 'bad_lease'), 'bad_lease');
  assert.equal(jsonbGuardHealthy({ status: 200, body: { error: 'lease_lost' } }, 'bad_lease'), null);
  assert.equal(jsonbGuardHealthy({ status: 200, body: { ok: true } }, 'bad_lease'), null);
  assert.equal(jsonbGuardHealthy({ status: 404, body: { error: 'bad_lease' } }, 'bad_lease'), null);
});
