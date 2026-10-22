import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import config from '../../server/config.js';
import { rows, remove, health } from '../../server/shared/client.js';
import { createAccount } from '../../server/shared/accounts.js';
import { createApp } from '../../server/app.js';

const receipt = JSON.parse(readFileSync(`${config.dataDir}/shared-db-import-receipt.json`, 'utf8'));
const db = new Database(receipt.backup, { readonly: true });
const original = db.prepare('SELECT id,password_hash FROM local_accounts ORDER BY id').all();
db.close();
const accounts = await rows('accounts');
for (const a of original) assert.equal(accounts.find((r) => r.id === (receipt.idMap[a.id] || a.id))?.password_hash, a.password_hash);
const counts = {};
for (const [key, table] of Object.entries({ participants: 'participants', accounts: 'accounts', tournaments: 'tournaments', entries: 'tournament_entries', submissions: 'submissions', matches: 'matches' })) {
  counts[key] = (await rows(table, 'select=id')).length;
  assert.equal(counts[key], receipt.counts[key]);
}
assert.equal((await rows('sessions')).length, 0, 'No legacy sessions imported');
const account = await createAccount({ username: `smoke-${randomUUID().slice(0,8)}`, password: 'trusted-smoke-password', role: 'admin' });
const server = createApp().listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
try {
  assert.equal((await fetch(`${base}/api/local/events`)).status, 401);
  const login = await fetch(`${base}/api/local/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: account.username, password: 'trusted-smoke-password' }) });
  assert.equal(login.status, 200);
  const session = await login.json();
  const cookie = login.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(`${base}/api/local/events`, { headers: { cookie } })).status, 200);
  assert.equal((await fetch(`${base}/api/local/logout`, { method: 'POST', headers: { cookie } })).status, 403);
  assert.equal((await fetch(`${base}/api/local/logout`, { method: 'POST', headers: { cookie, 'x-csrf-token': session.csrf } })).status, 200);
  assert.equal((await fetch(`${base}/api/local/me`, { headers: { cookie } })).status, 401);
  const result = { health: await health(), counts, passwordHashesPreserved: true, sessionsNotImported: true, apiAuthCsrfLogout: true };
  writeFileSync(`${config.dataDir}/shared-verification.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await new Promise((resolve) => server.close(resolve));
  await remove('sessions', `account_id=eq.${account.id}`);
  await remove('accounts', `id=eq.${account.id}`);
}