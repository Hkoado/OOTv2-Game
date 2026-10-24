import test from 'node:test';
import assert from 'node:assert/strict';
import { productionMigrations, projectRef, freshDatabaseBundle } from '../tools/production/migrationPlan.js';
import { workerEnvironment } from '../tools/production/workerEnvironment.js';
import { readFileSync } from 'node:fs';

test('production manifest includes foundations and capture, exact checksums, ordered once', () => {
  const plan = productionMigrations();
  assert.equal(plan[0].name, 'campus_foundation');
  assert.ok(plan.some((m) => m.name === 'cutoff_capture'));
  assert.deepEqual(plan.map((m) => m.version), [...new Set(plan.map((m) => m.version))].sort());
  assert.ok(plan.every((m) => /^[a-f0-9]{64}$/.test(m.sha256) && !m.sql.includes('\r')));
  const sql = freshDatabaseBundle(plan);
  assert.match(sql, /production_bootstrap_requires_empty_public_schema/);
  assert.match(sql, /REVOKE ALL ON public.ootv2_schema_migrations/);
  assert.ok(sql.endsWith('COMMIT;\n'));
  assert.ok(plan.every((m) => sql.includes(m.sql) && sql.includes(m.sha256)));
});

test('production target rejects non-Supabase endpoints and ambiguous URLs', () => {
  assert.equal(projectRef('https://abcdefghijklmnopqrst.supabase.co'), 'abcdefghijklmnopqrst');
  for (const url of ['http://abcdefghijklmnopqrst.supabase.co', 'https://example.com',
    'https://user:pass@abcdefghijklmnopqrst.supabase.co', 'https://abcdefghijklmnopqrst.supabase.co/path']) {
    assert.throws(() => projectRef(url));
  }
  assert.throws(() => freshDatabaseBundle([]));
});

test('worker environment exports only runtime allowlist, never migration/browser secrets', () => {
  const env = { SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'secret-token',
    SUPABASE_ACCESS_TOKEN: 'ddl-token', SUPABASE_DB_URL: 'db-password', VITE_SECRET: 'bad-browser-secret',
    OOTV2_GITHUB_TOKEN: 'github-token' };
  const result = workerEnvironment(env);
  assert.match(result, /SUPABASE_SERVICE_ROLE_KEY=secret-token/);
  assert.match(result, /OOTV2_GITHUB_TOKEN=github-token/);
  assert.doesNotMatch(result, /ddl-token|db-password|bad-browser-secret/);
  assert.throws(() => workerEnvironment({ ...env, SUPABASE_SERVICE_ROLE_KEY: 'a\nX=b' }));
  assert.throws(() => workerEnvironment({}));
});

test('VM install refuses unchecked SSH and never starts the legacy worker', () => {
  const ps = readFileSync(new URL('../tools/vm/Install-Judge.ps1', import.meta.url), 'utf8');
  assert.match(ps, /StrictHostKeyChecking=yes/);
  assert.match(ps, /export-worker-env\.js/);
  const sh = readFileSync(new URL('../tools/provision/install-judge.sh', import.meta.url), 'utf8');
  assert.match(sh, /wsl_is_not_a_judge_vm/);
  assert.match(sh, /sha256sum --check/);
  assert.match(sh, /worker is NOT enabled/);
  assert.doesNotMatch(sh, /systemctl enable.*worker/);
});