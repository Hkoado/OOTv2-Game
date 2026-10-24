import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateManualOutcome } from '../server/shared/manualFinalJobs.js';

test('additive manual migration fences expired leases, bounds reclaim attempts and restricts heartbeat grants', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261026120000_manual_worker_heartbeat.sql', import.meta.url), 'utf8');
  assert.match(sql, /lease_until > clock_timestamp\(\)/);
  assert.match(sql, /j\.lease_until <= clock_timestamp\(\)/);
  assert.match(sql, /j\.attempt >= j\.max_attempts/);
  assert.match(sql, /for update skip locked/);
  assert.match(sql, /manual_finish_prerequisite_mismatch/);
  assert.match(sql, /revoke all on function public\.mvp_manual_final_heartbeat[^\n]+from public,anon,authenticated/);
  assert.match(sql, /grant execute on function public\.mvp_manual_final_heartbeat[^\n]+to service_role/);
});

test('manual outcome accepts engine 0-ply result but rejects negative or excessive plies', () => {
  const outcome = { status: 'finished', result: 'blue_win', reason: 'INVALID_SETUP',
    ply_count: 0, replay: { schemaVersion: 'campus-replay.v1' } };
  assert.equal(validateManualOutcome('match', outcome).ply_count, 0);
  for (const ply_count of [-1, 1001, 0.5]) {
    assert.throws(() => validateManualOutcome('match', { ...outcome, ply_count }));
  }
});