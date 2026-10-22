import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';

test('local core: real login, session/CSRF, team isolation, persistence and MVP scheduling', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'oot-local-core-'));
  process.env.OOTV2_DATA_DIR = dir;
  process.env.OOTV2_DB_PATH = path.join(dir, 'core.sqlite');
  const { initDb, closeDb, getDb } = await import('../server/db.js');
  const { createApp } = await import('../server/app.js');
  const { createAccount, initAccounts, resetPassword } = await import('../server/services/localAccounts.js');
  initDb(); initAccounts();
  await createAccount({ username: 'admin', password: 'test-admin-password', role: 'admin' });
  const server = createApp().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  async function api(route, { method = 'GET', body, session, origin, raw = false } = {}) {
    const headers = {};
    if (session) { headers.cookie = session.cookie; headers['x-csrf-token'] = session.csrf; }
    if (origin) headers.origin = origin;
    if (body && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
    const response = await fetch(`${base}/api${route}`, { method, headers, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined });
    const payload = await response.json();
    return raw ? { response, payload } : { status: response.status, ...payload };
  }
  async function signIn(username, password) {
    const { response, payload } = await api('/local/login', { method: 'POST', body: { username, password }, raw: true });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('set-cookie'), /HttpOnly/i);
    return { cookie: response.headers.get('set-cookie').split(';')[0], csrf: payload.csrf, account: payload.account };
  }
  try {
    assert.equal((await api('/local/me')).status, 401);
    assert.equal((await api('/participants')).status, 404, 'legacy bypass is disabled by default');
    assert.equal((await api('/local/login', { method: 'POST', body: { username: 'admin', password: 'wrong' } })).status, 401);
    assert.equal((await api('/local/login', { method: 'POST', origin: 'https://evil.test', body: { username: 'admin', password: 'test-admin-password' } })).status, 403);
    const admin = await signIn('admin', 'test-admin-password');
    const ids = [];
    for (let i = 0; i < 8; i++) {
      const row = await api('/local/teams', { method: 'POST', session: admin, body: { name: `Core Team ${i}`, username: `team${i}`, password: 'trusted-team-password' } });
      assert.equal(row.status, 201);
      assert.equal(row.password_hash, undefined);
      ids.push(row.participant_id);
    }
    const team = await signIn('team0', 'trusted-team-password');
    assert.equal((await api('/local/teams', { session: team })).status, 403);
    assert.equal((await api('/local/profile', { method: 'PUT', session: { ...team, csrf: 'wrong' }, body: {} })).status, 403);
    assert.equal((await api(`/local/submissions/${ids[1]}`, { method: 'POST', session: team })).status, 403);
    const profile = { members: 'A · SV01\nB · SV02', contact: 'team@example.test', repository: 'https://github.com/team/bot', branch: 'main' };
    assert.equal((await api('/local/profile', { method: 'PUT', session: team, body: profile })).status, 200);
    assert.equal((await api('/local/profile', { method: 'PUT', session: team, body: { ...profile, repository: 'https://token@github.com/team/bot' } })).status, 400);
    assert.equal((await api('/local/me', { session: team })).account.repository, profile.repository);
    // Test scheduler with deterministic valid fixture bots, never arbitrary downloaded code.
    const { readFileSync } = await import('node:fs');
    const file = readFileSync(new URL('./fixtures/bot_illegal_after_first_ply.py', import.meta.url));
    for (const id of ids) {
      const form = new FormData(); form.append('file', new Blob([file]), 'bot.py');
      const result = await api(`/local/submissions/${id}`, { method: 'POST', session: admin, body: form });
      assert.equal(result.status, 'valid', JSON.stringify(result));
      assert.equal(result.storage_path, undefined);
    }
    const event = await api('/local/events', { method: 'POST', session: admin, body: { name: 'Core local test', participantIds: ids } });
    assert.equal(event.status, 'draft');
    await api(`/local/events/${event.id}/start`, { method: 'POST', session: admin });
    assert.equal((await api(`/local/events/${event.id}`, { session: team })).matches.length, 24);
    const { processOneMatch } = await import('../server/worker.js');
    let steps = 0;
    while (getDb().prepare('SELECT status FROM tournaments WHERE id=?').get(event.id).status !== 'finished') {
      assert(++steps <= 30, 'worker must finish exactly 30 games');
      await processOneMatch({ verbose: false });
    }
    assert.equal(steps, 30);
    const firstMatch = getDb().prepare('SELECT id FROM matches WHERE tournament_id=? AND stage=? LIMIT 1').get(event.id, 'group');
    const replay = await api(`/local/matches/${firstMatch.id}/replay`, { session: team });
    assert.equal(replay.status, 200);
    assert(replay.replay);
    const outsider = await createAccount({ username: 'outsider', password: 'outsider-password', name: 'Outside team' });
    const other = await signIn('outsider', 'outsider-password');
    assert.equal((await api(`/local/events/${event.id}`, { session: other })).status, 403);
    assert.equal((await api('/local/events', { session: other })).events.length, 0);
    assert(outsider.participant_id);
    assert.notEqual(getDb().prepare('SELECT password_hash FROM local_accounts WHERE username=?').get('team0').password_hash, 'trusted-team-password');
    await resetPassword(team.account.id, 'new-trusted-password');
    assert.equal((await api('/local/me', { session: team })).status, 401);
    await api('/local/logout', { method: 'POST', session: admin });
    assert.equal((await api('/local/me', { session: admin })).status, 401);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    closeDb(); rmSync(dir, { recursive: true, force: true });
  }
});