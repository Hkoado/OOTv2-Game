import test from 'node:test';
import assert from 'node:assert/strict';
import { productionMigrations, projectRef, freshDatabaseBundle } from '../tools/production/migrationPlan.js';
import { workerEnvironment } from '../tools/production/workerEnvironment.js';
import { readFileSync, readdirSync } from 'node:fs';

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

test('guest shell/service files stay LF-only and the unit is sandboxed', () => {
  for (const dir of ['tools/provision', 'tools/vm', 'sandbox/linux']) {
    const folder = new URL(`../${dir}/`, import.meta.url);
    for (const name of readdirSync(folder)) {
      if (!/\.(sh|service|timer)$/.test(name)) continue;
      const text = readFileSync(new URL(name, folder), 'utf8');
      assert.equal(text.includes('\r'), false, `${dir}/${name} must use LF endings`);
    }
  }
  const unit = readFileSync(new URL('../tools/provision/ootv2-github-worker.service', import.meta.url), 'utf8');
  assert.match(unit, /^User=ootv2-worker$/m);
  assert.match(unit, /^NoNewPrivileges=yes$/m);
  assert.match(unit, /^ProtectSystem=strict$/m);
  assert.match(unit, /^WantedBy=multi-user\.target$/m);
  assert.match(unit, /ExecStart=\/opt\/ootv2-node\/bin\/node \/srv\/ootv2\/current\/server\/githubWorker\.js/);
  assert.doesNotMatch(unit, /server\/worker\.js/);
  const judge = readFileSync(new URL('../tools/provision/ootv2-official-worker.service', import.meta.url), 'utf8');
  assert.match(judge, /server\/officialWorker\.js --all/);
  assert.match(judge, /OOTV2_CAMPUS_SANDBOX=linux-sandbox/);
  assert.match(judge, /assertCampusSandboxReady/);
  assert.doesNotMatch(judge, /OOTV2_ALLOW_TRUSTED_DEV/);
  const attest = readFileSync(new URL('../tools/provision/ootv2-attest.service', import.meta.url), 'utf8');
  assert.match(attest, /\/srv\/ootv2\/current\/sandbox\/linux\/attest.sh/);
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
  // known_hosts phải có entry cho đúng địa chỉ trước khi gửi archive credential.
  assert.match(ps, /Invoke-Native 'ssh-keygen\.exe' @\('-F', \$Address, '-f', \$KnownHostsPath\)/);
  const sh = readFileSync(new URL('../tools/provision/install-judge.sh', import.meta.url), 'utf8');
  assert.match(sh, /wsl_is_not_a_judge_vm/);
  assert.match(sh, /sha256sum --check/);
  // Releases are swapped, and the worker is only referenced by an explicit stop.
  assert.match(sh, /deploy-release\.sh/);
  assert.doesNotMatch(sh, /systemctl (enable|start)[^\n]*github-worker/);
  assert.doesNotMatch(sh, /server\/worker\.js/);
  assert.match(sh, /NOT part of the github service/);
  const ctl = readFileSync(new URL('../tools/provision/workerctl.sh', import.meta.url), 'utf8');
  assert.match(ctl, /worker-health\.js/);
  assert.match(ctl, /worker_start_refused/);
});