/**
 * verify-shared-db.js — Smoke kiểm tra DB chung Supabase + auth/CSRF/logout.
 *
 * Không đọc SQLite (đã bỏ). Tạo một tài khoản tạm, chạy login → CSRF → logout,
 * rồi xoá tài khoản. Chạy: `npm run db:verify`.
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { once } from 'node:events';

import config from '../../server/config.js';
import { rows, remove, health } from '../../server/shared/client.js';
import { createAccount } from '../../server/shared/accounts.js';
import { createApp } from '../../server/app.js';

const counts = {};
for (const table of ['participants', 'accounts', 'tournaments', 'tournament_entries', 'submissions', 'matches']) {
  counts[table] = (await rows(table, 'select=id')).length;
}

const password = `smoke-${randomUUID()}`;
const account = await createAccount({ username: `smoke-${randomUUID().slice(0, 8)}`, password, role: 'admin' });
const server = createApp().listen(0, '127.0.0.1');
await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;

try {
  assert.equal((await fetch(`${base}/api/local/events`)).status, 401);
  const login = await fetch(`${base}/api/local/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: account.username, password }),
  });
  assert.equal(login.status, 200);
  const session = await login.json();
  const cookie = login.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(`${base}/api/local/events`, { headers: { cookie } })).status, 200);
  assert.equal((await fetch(`${base}/api/local/logout`, { method: 'POST', headers: { cookie } })).status, 403);
  assert.equal(
    (await fetch(`${base}/api/local/logout`, { method: 'POST', headers: { cookie, 'x-csrf-token': session.csrf } }))
      .status,
    200
  );
  assert.equal((await fetch(`${base}/api/local/me`, { headers: { cookie } })).status, 401);

  const result = { health: await health(), counts, apiAuthCsrfLogout: true, driver: 'supabase' };
  mkdirSync(config.dataDir, { recursive: true });
  writeFileSync(`${config.dataDir}/shared-verification.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await new Promise((resolve) => server.close(resolve));
  await remove('sessions', `account_id=eq.${account.id}`);
  await remove('accounts', `id=eq.${account.id}`);
}
