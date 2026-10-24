import test from 'node:test';
import assert from 'node:assert/strict';
import { assertProductionSafety } from '../server/lib/productionSafety.js';
import { loadEnvFile } from '../server/config.js';
import { createApp } from '../server/app.js';
import { runBotRequest } from '../server/judge/botRunner.js';
import { createTrustedCampusSession } from '../server/judge/campusTrustedSession.js';
import { runWorker } from '../server/worker.js';
import { projectRefOf } from '../server/shared/client.js';
import { readFileSync } from 'node:fs';

test('production and Vercel reject development bypasses without touching secrets', () => {
  for (const mode of [{ NODE_ENV: 'production' }, { VERCEL: '1' }]) {
    for (const key of ['OOTV2_ALLOW_TRUSTED_DEV', 'OOTV2_SANDBOX_ALLOW_WSL',
      'OOTV2_ALLOW_LOCAL_ORIGIN', 'OOTV2_ALLOW_ONLINE_UPLOAD']) {
      assert.throws(() => assertProductionSafety({ ...mode, [key]: '1' }), { code: 'production_unsafe_config' });
    }
    assert.throws(() => assertProductionSafety({ ...mode, OOTV2_CAMPUS_SANDBOX: 'trusted-dev' }),
      { code: 'production_unsafe_sandbox' });
    assert.throws(() => assertProductionSafety({ ...mode, OOTV2_SANDBOX_SECCOMP: 'off' }),
      { code: 'production_unsafe_sandbox' });
    assert.doesNotThrow(() => assertProductionSafety({ ...mode, OOTV2_CAMPUS_SANDBOX: 'linux-sandbox' }));
    assert.deepEqual(loadEnvFile(undefined, mode), { file: null, loaded: 0 });
  }
  assert.doesNotThrow(() => assertProductionSafety({ OOTV2_ALLOW_TRUSTED_DEV: '1' }));
});

test('production database target is pinned to the primary Supabase project', () => {
  assert.equal(projectRefOf('https://ftzockzolisecnyhlwej.supabase.co'), 'ftzockzolisecnyhlwej');
  assert.equal(projectRefOf('https://wsyfcgurnrowcuefwynx.supabase.co'), 'wsyfcgurnrowcuefwynx');
  const source = readFileSync(new URL('../server/shared/client.js', import.meta.url), 'utf8');
  assert.match(source, /PRIMARY_PROJECT_REF = 'ftzockzolisecnyhlwej'/);
  assert.match(source, /projectRefOf\(url\) !== PRIMARY_PROJECT_REF/);
});

test('direct legacy and trusted transports refuse production before any artifact or DB access', async () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    await assert.rejects(runBotRequest({}), { code: 'legacy_runner_forbidden' });
    await assert.rejects(createTrustedCampusSession({ trusted: true }), { code: 'trusted_dev_forbidden' });
    await assert.rejects(runWorker(), { code: 'legacy_worker_forbidden' });
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});

async function serve(t, options) {
  const server = createApp(options).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  return `http://127.0.0.1:${server.address().port}`;
}

test('public liveness is cheap; readiness requires session and admin before DB access', async (t) => {
  let checks = 0;
  const base = await serve(t, { checkHealth: async () => { checks += 1; } });
  const live = await fetch(`${base}/api/health`);
  assert.equal(live.status, 200);
  assert.deepEqual(await live.json(), { ok: true, service: 'ootv2-tournament-api' });
  assert.equal(live.headers.get('cache-control'), 'no-store');
  assert.equal(live.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await fetch(`${base}/api/ready`)).status, 401);
  assert.equal(checks, 0);
  const teamBase = await serve(t, { checkHealth: async () => { checks += 1; },
    sessionGuard: (req, res, next) => { req.account = { role: 'team' }; next(); } });
  assert.equal((await fetch(`${teamBase}/api/ready`)).status, 403);
  assert.equal(checks, 0);
});

test('admin readiness reports only bounded status, never upstream errors or worker acceptance', async (t) => {
  const admin = (req, res, next) => { req.account = { role: 'admin' }; next(); };
  let broken = false;
  const base = await serve(t, { sessionGuard: admin, checkHealth: async () => {
    if (broken) throw new Error('SECRET http://private-host/token');
    return { secret: 'never expose' };
  } });
  let response = await fetch(`${base}/api/ready`);
  assert.deepEqual(await response.json(), { ok: true, database: 'ready', workerReadiness: 'not_checked' });
  broken = true;
  response = await fetch(`${base}/api/ready`);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { ok: false, error: 'database_unavailable' });
  response = await fetch(`${base}/api/ready`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{broken' });
  assert.equal(response.status, 400);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});