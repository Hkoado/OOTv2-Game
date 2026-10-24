/**
 * manualFinalDrill.test.js — Guardrail cho rehearsal migration/drill Chung kết thủ công.
 *
 * Test KHÔNG chạm mạng/DB: chỉ kiểm script ghép transaction, cấm COMMIT và cấm chạy
 * migration ngoài ý muốn. Drill thật chạy bằng `npm run db:manual` (có bằng chứng riêng).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { composeDrillSql, stripTransaction, MIGRATION_FILE, DRILL_FILE } from '../tools/cli/manual-final-drill.js';

const migrationSql = readFileSync(new URL(`../${MIGRATION_FILE}`, import.meta.url), 'utf8');
const drillSql = readFileSync(new URL(`../${DRILL_FILE}`, import.meta.url), 'utf8');

test('drill: file test là transaction riêng và kết thúc bằng ROLLBACK', () => {
  assert.match(drillSql, /^[ \t]*begin\s*;[ \t]*$/imu);
  assert.match(drillSql, /^[ \t]*rollback\s*;[ \t]*$/imu);
  assert.doesNotMatch(migrationSql, /\bcommit\s*;/iu);
});

test('drill: ghép migration + assertions thành MỘT transaction rồi rollback', () => {
  const composed = composeDrillSql({ migrationSql, drillSql });
  assert.match(composed, /^begin;\n/u);
  assert.match(composed, /rollback;\n$/u);
  assert.equal((composed.match(/\bbegin\s*;/giu) || []).length, 1, 'chỉ một BEGIN ngoài cùng');
  assert.equal((composed.match(/\brollback\s*;/giu) || []).length, 1, 'chỉ một ROLLBACK');
  assert.doesNotMatch(composed, /\bcommit\s*;/iu);
  assert.match(composed, /create table public\.mvp_manual_final_events/u);
  assert.match(composed, /drill_finish_failed/u, 'giữ nguyên assertions của drill');
});

test('drill: từ chối drill không transactional hoặc có COMMIT', () => {
  assert.throws(() => composeDrillSql({ migrationSql, drillSql: 'do $$ begin null; end $$;' }),
    /drill_must_be_transactional/u);
  assert.throws(() => composeDrillSql({ migrationSql: `${migrationSql}\ncommit;`, drillSql }),
    /migration_contains_transaction_control/u);
  const injected = drillSql.replace('rollback;', 'commit;\nrollback;');
  assert.throws(() => composeDrillSql({ migrationSql, drillSql: injected }),
    /drill_contains_transaction_control/u);
});

test('stripTransaction: bỏ đúng begin/rollback của file drill, giữ block PL/pgSQL', () => {
  const body = stripTransaction(drillSql);
  assert.doesNotMatch(body, /^[ \t]*begin\s*;[ \t]*$/imu);
  assert.doesNotMatch(body, /^[ \t]*rollback\s*;[ \t]*$/imu);
  assert.match(body, /^do \$\$/mu);
});
