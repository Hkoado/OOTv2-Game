import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../supabase/migrations/20261026150000_official_lease_fencing.sql',
  import.meta.url), 'utf8');

test('official lease fencing: heartbeat không hồi sinh lease hết hạn, fail closed nếu body khác', () => {
  assert.match(sql, /mvp_official_heartbeat_job\(uuid,uuid,integer,integer\)/);
  assert.match(sql, /and lease_until is not null and lease_until > clock_timestamp\(\)/);
  assert.match(sql, /official_heartbeat_prerequisite_mismatch/);
  assert.match(sql, /pg_get_functiondef\('public\.mvp_official_finish_job\(uuid,uuid,integer,text,text,jsonb\)'::regprocedure\)/);
  assert.match(sql, /official_finish_prerequisite_mismatch/);
  assert.match(sql, /pg_get_functiondef\('public\.mvp_official_fail_job\(uuid,uuid,integer,text,text,boolean\)'::regprocedure\)/);
  assert.match(sql, /official_fail_prerequisite_mismatch/);
  assert.match(sql, /or j\.lease_until is null or j\.lease_until <= clock_timestamp\(\) then/);
  assert.doesNotMatch(sql, /drop (table|function)/i);
});
