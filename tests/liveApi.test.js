/**
 * Test API khán giả (`/api/live`) và ACL của log bot (L2, `/api/local/live/...`):
 * - Công khai, không cần đăng nhập, không lộ log/ghi chú/đường dẫn.
 * - L2 chỉ trả cho đúng đội sở hữu bên của mình; admin xem được cả hai bên.
 *
 * Chạy: `node --test tests/liveApi.test.js`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { startTestEnv } from './helpers/testEnv.js';

const PASSWORD = 'live-test-password';
let counter = 0;

async function login(env, username) {
  const response = await fetch(`${env.baseUrl}/api/local/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: PASSWORD }),
  });
  const body = await response.json().catch(() => null);
  const setCookie = response.headers.get('set-cookie') || '';
  return { status: response.status, body, cookie: setCookie.split(';')[0] };
}

/** Tạo 3 tài khoản đội + admin rồi dựng giải đang chạy với 1 ván `running`. */
async function seedTournament(env) {
  counter += 1;
  const accountsService = await import('../server/services/localAccounts.js');
  accountsService.initAccounts();

  const admin = await accountsService.createAccount({
    username: `live_admin_${counter}`,
    password: PASSWORD,
    role: 'admin',
  });
  const red = await accountsService.createAccount({
    username: `live_red_${counter}`,
    password: PASSWORD,
    role: 'team',
    name: `Red Bot ${counter}`,
  });
  const blue = await accountsService.createAccount({
    username: `live_blue_${counter}`,
    password: PASSWORD,
    role: 'team',
    name: `Blue Bot ${counter}`,
  });
  const other = await accountsService.createAccount({
    username: `live_other_${counter}`,
    password: PASSWORD,
    role: 'team',
    name: `Other Bot ${counter}`,
  });

  const db = env.getDb();
  const now = new Date().toISOString();
  const ids = {
    tournament: `t-api-${counter}`,
    match: `m-api-${counter}`,
    adminUsername: admin.username,
    redUsername: red.username,
    blueUsername: blue.username,
    otherUsername: other.username,
  };

  db.prepare(
    `INSERT INTO tournaments (id, name, status, seed, created_at, started_at)
     VALUES (?, ?, 'group_running', 11, ?, ?)`
  ).run(ids.tournament, `Live API Event ${counter}`, now, now);
  db.prepare(
    `INSERT INTO tournament_entries (id, tournament_id, participant_id, seed_order, group_name)
     VALUES (?, ?, ?, 1, 'A')`
  ).run(`e-red-api-${counter}`, ids.tournament, red.participant_id);
  db.prepare(
    `INSERT INTO tournament_entries (id, tournament_id, participant_id, seed_order, group_name)
     VALUES (?, ?, ?, 2, 'A')`
  ).run(`e-blue-api-${counter}`, ids.tournament, blue.participant_id);
  db.prepare(
    `INSERT INTO matches (id, tournament_id, stage, series_id, game_no, red_entry_id, blue_entry_id,
                          seed, status, started_at)
     VALUES (?, ?, 'group', 'A', 1, ?, ?, 11, 'running', ?)`
  ).run(ids.match, ids.tournament, `e-red-api-${counter}`, `e-blue-api-${counter}`, now);

  return ids;
}

function seedLiveData(env, matchId) {
  // Gọi đồng bộ sau khi import để test không phụ thuộc worker.
  return import('../server/services/liveEvents.js').then((live) => {
    live.startLiveMatch(matchId, {
      seed: 11,
      initialPieces: [
        { id: 'r1', player: 'red', type: 'rock', square: 0, alive: true },
        { id: 'b1', player: 'blue', type: 'scissors', square: 80, alive: true },
      ],
    });
    live.recordLiveMove(matchId, {
      ply: 1,
      event: { player: 'red', piece_id: 'r1', from: 0, to: 9, captured_piece_id: null },
    });
    live.recordBotOutput(matchId, 'red', 'stderr', 'red-log secret-bot-log');
    live.recordBotOutput(matchId, 'blue', 'stderr', 'blue-log');
    return live;
  });

test('live API: công khai, chỉ trả bàn cờ + nước đi', async (t) => {
  const env = await startTestEnv();
  t.after(() => env.cleanup());
  const ids = await seedTournament(env);
  await seedLiveData(env, ids.match);

  const overview = await env.api('/api/live/overview');
  assert.equal(overview.status, 200);
  assert.equal(overview.body.event.id, ids.tournament);
  assert.equal(overview.body.matches.length, 1);
  assert.equal(overview.body.matches[0].id, ids.match);
  assert.equal(overview.body.matches[0].ply, 1);
  assert.equal(overview.body.counts.running, 1);

  const snapshot = await env.api(`/api/live/matches/${ids.match}`);
  assert.equal(snapshot.status, 200);
  assert.equal(snapshot.body.match.red.name, `Red Bot ${counter}`);
  assert.equal(snapshot.body.live.has_initial, true);
  assert.equal(snapshot.body.live.initial_pieces.length, 2);
  const snapshotText = JSON.stringify(snapshot.body);
  assert.ok(!snapshotText.includes('secret-bot-log'), 'API công khai không được trả log bot');
  assert.ok(!snapshotText.includes('storage_path'));
  assert.ok(!snapshotText.includes('replay_json'));

  const events = await env.api(`/api/live/matches/${ids.match}/events?afterSeq=0`);
  assert.equal(events.status, 200);
  assert.deepEqual(events.body.events.map((event) => event.kind), ['initial', 'move']);
  assert.equal(events.body.latest_seq, 1);
  assert.ok(!JSON.stringify(events.body).includes('secret-bot-log'));

  const tail = await env.api(`/api/live/matches/${ids.match}/events?afterSeq=1`);
  assert.deepEqual(tail.body.events, [], 'afterSeq = 1 chỉ trả event mới hơn nước 1');
  assert.equal(tail.body.reset, false);

  assert.equal((await env.api('/api/live/matches/khong-ton-tai')).status, 404);
  assert.equal((await env.api('/api/live/matches/khong-ton-tai/events')).status, 404);
});

test('live API: log bot chỉ đội sở hữu + admin', async (t) => {
  const env = await startTestEnv();
  t.after(() => env.cleanup());
  const ids = await seedTournament(env);
  await seedLiveData(env, ids.match);
  const endpoint = `/api/local/live/matches/${ids.match}/bot-output`;

  const anonymous = await env.api(endpoint);
  assert.equal(anonymous.status, 401);

  const red = await login(env, ids.redUsername);
  assert.equal(red.status, 200);
  const redView = await env.api(endpoint, { headers: { cookie: red.cookie } });
  assert.equal(redView.status, 200);
  assert.equal(redView.body.side, 'red');
  assert.deepEqual(redView.body.lines.map((line) => line.line), ['red-log secret-bot-log']);

  const other = await login(env, ids.otherUsername);
  const denied = await env.api(endpoint, { headers: { cookie: other.cookie } });
  assert.equal(denied.status, 403, 'đội không tham gia ván không được đọc log');

  const admin = await login(env, ids.adminUsername);
  const adminView = await env.api(endpoint, { headers: { cookie: admin.cookie } });
  assert.equal(adminView.status, 200);
  assert.equal(adminView.body.lines.length, 2, 'admin thấy cả hai bên');

  const blueOnly = await env.api(`${endpoint}?side=blue`, { headers: { cookie: admin.cookie } });
  assert.equal(blueOnly.body.side, 'blue');
  assert.deepEqual(blueOnly.body.lines.map((line) => line.line), ['blue-log']);

  const unknownMatch = await env.api('/api/local/live/matches/khong-ton-tai/bot-output', {
    headers: { cookie: admin.cookie },
  });
  assert.equal(unknownMatch.status, 404);
});

}
