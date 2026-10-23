/**
 * publication.test.js — H3: lịch phát + chính sách xem.
 *
 * Phần 1 kiểm hàm thuần (mốc nước theo giờ server). Phần 2 kiểm HTTP với PostgREST giả lập:
 * không xem ẩn danh, đội chỉ thấy ván đã công bố, không lộ result/replay/log khi chưa mở.
 * Test KHÔNG chạm Supabase thật.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID, scryptSync } from 'node:crypto';

import { computeBroadcast, maxEventSeq, normalizeSchedule } from '../server/shared/publication.js';

process.env.SUPABASE_URL = 'https://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only';

const { createApp } = await import('../server/app.js');

const at = (iso) => Date.parse(iso);
const row = (overrides = {}) => ({
  match_id: 'm', event_id: 'e', state: 'scheduled',
  starts_at: '2026-10-24T10:00:00.000Z', ply_interval_ms: 2000, release_mode: 'full',
  ...overrides,
});

test('computeBroadcast: waiting → broadcasting → ended theo giờ server', () => {
  const r = row();
  const waiting = computeBroadcast(r, { now: at('2026-10-24T09:59:00.000Z'), totalPlies: 5 });
  assert.equal(waiting.phase, 'waiting');
  assert.equal(waiting.visible_plies, 0);
  assert.equal(waiting.reveal_result, false);

  const mid = computeBroadcast(r, { now: at('2026-10-24T10:00:05.000Z'), totalPlies: 5 });
  assert.equal(mid.phase, 'broadcasting');
  assert.equal(mid.visible_plies, 3);
  assert.equal(mid.reveal_result, false);
  assert.equal(mid.next_poll_ms, 2000);

  const ended = computeBroadcast(r, { now: at('2026-10-24T10:01:00.000Z'), totalPlies: 5 });
  assert.equal(ended.phase, 'ended');
  assert.equal(ended.visible_plies, 5);
  assert.equal(ended.reveal_result, true);
  assert.equal(ended.next_poll_ms, null);
});

test('computeBroadcast: window không mở kết quả; canceled = hidden; tổng 0 nước', () => {
  const windowMode = computeBroadcast(row({ release_mode: 'window' }), { now: at('2026-10-24T10:01:00.000Z'), totalPlies: 5 });
  assert.equal(windowMode.phase, 'ended');
  assert.equal(windowMode.reveal_result, false, 'window không mở replay/result');

  const canceled = computeBroadcast(row({ state: 'canceled' }), { now: at('2026-10-24T10:05:00.000Z'), totalPlies: 5 });
  assert.equal(canceled.phase, 'hidden');
  assert.equal(canceled.visible_plies, 0);
  assert.equal(maxEventSeq(canceled), -1);

  const zero = computeBroadcast(row(), { now: at('2026-10-24T10:00:02.000Z'), totalPlies: 0 });
  assert.equal(zero.phase, 'ended');
  assert.equal(zero.visible_plies, 0);

  const forced = computeBroadcast({ ...row(), state: 'ended' }, { now: at('2026-10-24T09:00:00.000Z'), totalPlies: 4 });
  assert.equal(forced.phase, 'ended');
  assert.equal(forced.visible_plies, 4);
});

test('maxEventSeq: 0 khi chờ, bằng visible_plies khi đang phát, vô cực khi mở đủ', () => {
  const r = row();
  assert.equal(maxEventSeq(computeBroadcast(r, { now: at('2026-10-24T09:00:00.000Z'), totalPlies: 5 })), 0);
  assert.equal(maxEventSeq(computeBroadcast(r, { now: at('2026-10-24T10:00:05.000Z'), totalPlies: 5 })), 3);
  assert.equal(maxEventSeq(computeBroadcast(r, { now: at('2026-10-24T10:10:00.000Z'), totalPlies: 5 })), Number.POSITIVE_INFINITY);
  assert.equal(
    maxEventSeq(computeBroadcast(row({ release_mode: 'window' }), { now: at('2026-10-24T10:10:00.000Z'), totalPlies: 5 })),
    5
  );
});

test('normalizeSchedule: validate giờ ISO, nhịp phát và chế độ phát', () => {
  assert.deepEqual(normalizeSchedule({ starts_at: '2026-10-24T10:00:00+07:00' }), {
    startsAt: '2026-10-24T03:00:00.000Z',
    plyIntervalMs: 2000,
    releaseMode: 'window',
  });
  const invalid = [
    { starts_at: '2026-10-24 10:00' },
    { starts_at: '2026-10-24T10:00:00.000Z', ply_interval_ms: 100 },
    { starts_at: '2026-10-24T10:00:00.000Z', ply_interval_ms: 120000 },
    { starts_at: '2026-10-24T10:00:00.000Z', ply_interval_ms: 2000, release_mode: 'stream' },
  ];
  for (const input of invalid) {
    assert.throws(() => normalizeSchedule(input), (error) => error.status === 400, JSON.stringify(input));
  }
});

const PASSWORD = 'mat-khau-kiem-thu-12';
const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const EVENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_EVENT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TEAM_A = '44444444-4444-4444-8444-444444444444';
const TEAM_B = '55555555-5555-4555-8555-555555555555';
const TEAM_C = '66666666-6666-4666-8666-666666666666';
const ENTRY_A = '77777777-7777-4777-8777-777777777777';
const ENTRY_B = '88888888-8888-4888-8888-888888888888';
const ENTRY_C = '99999999-9999-4999-8999-999999999999';
const MATCH_PUBLIC = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const MATCH_SECRET = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';

const json = (data, status = 200) =>
  new Response(data === null ? null : JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const encode = (password) => {
  const salt = 'a'.repeat(32);
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
};

function seedStore() {
  const now = new Date().toISOString();
  return {
    participants: [
      { id: TEAM_A, name: 'Đội Alpha', created_at: now },
      { id: TEAM_B, name: 'Đội Beta', created_at: now },
      { id: TEAM_C, name: 'Đội Gamma', created_at: now },
    ],
    accounts: [
      { id: ADMIN_ID, username: 'admin', password_hash: encode(PASSWORD), role: 'admin', participant_id: null, members: '', contact: '', repository: '', branch: 'main', created_at: now },
      { id: '22222222-2222-4222-8222-222222222222', username: 'alpha', password_hash: encode(PASSWORD), role: 'team', participant_id: TEAM_A, members: '', contact: '', repository: '', branch: 'main', created_at: now },
      { id: '33333333-3333-4333-8333-333333333333', username: 'gamma', password_hash: encode(PASSWORD), role: 'team', participant_id: TEAM_C, members: '', contact: '', repository: '', branch: 'main', created_at: now },
    ],
    sessions: [],
    submissions: [],
    tournaments: [
      { id: EVENT, name: 'Giải H3', status: 'group_running', seed: 5, created_at: now, started_at: '2026-10-24T10:00:00.000Z', map_json: '{"id":"open-arena","revision":1,"blocked":[]}' },
      { id: OTHER_EVENT, name: 'Giải khác', status: 'group_running', seed: 6, created_at: now, started_at: '2026-10-24T09:00:00.000Z', map_json: '{"id":"open-arena","revision":1,"blocked":[]}' },
    ],
    tournament_entries: [
      { id: ENTRY_A, tournament_id: EVENT, participant_id: TEAM_A, seed_order: 1, group_name: 'A' },
      { id: ENTRY_B, tournament_id: EVENT, participant_id: TEAM_B, seed_order: 2, group_name: 'A' },
      { id: ENTRY_C, tournament_id: OTHER_EVENT, participant_id: TEAM_C, seed_order: 1, group_name: 'A' },
    ],
    matches: [
      {
        id: MATCH_PUBLIC, tournament_id: EVENT, stage: 'group', series_id: 'gA_1-2', game_no: 1, seed: 11,
        status: 'finished', result: 'red_win', reason: 'base_capture', ply_count: 3,
        replay_json: '{"events":[{"ply":1}]}', started_at: now, finished_at: now,
        red_entry_id: ENTRY_A, blue_entry_id: ENTRY_B,
      },
      {
        id: MATCH_SECRET, tournament_id: EVENT, stage: 'group', series_id: 'gA_1-2', game_no: 2, seed: 12,
        status: 'finished', result: 'blue_win', reason: 'type_eliminated', ply_count: 2,
        replay_json: '{"events":[{"ply":1}]}', started_at: now, finished_at: now,
        red_entry_id: ENTRY_B, blue_entry_id: ENTRY_A,
      },
    ],
    match_events: [
      { match_id: MATCH_PUBLIC, seq: 0, kind: 'initial', payload_json: JSON.stringify({ seed: 11, initial_pieces: [{ id: 'r1' }] }), created_at: now },
      { match_id: MATCH_PUBLIC, seq: 1, kind: 'move', payload_json: JSON.stringify({ ply: 1, from: 'a1', to: 'a2' }), created_at: now },
      { match_id: MATCH_PUBLIC, seq: 2, kind: 'move', payload_json: JSON.stringify({ ply: 2, from: 'b1', to: 'b2' }), created_at: now },
      { match_id: MATCH_PUBLIC, seq: 3, kind: 'move', payload_json: JSON.stringify({ ply: 3, from: 'c1', to: 'c2' }), created_at: now },
      { match_id: MATCH_PUBLIC, seq: 4, kind: 'terminal', payload_json: JSON.stringify({ result: 'red_win', reason: 'base_capture', ply_count: 3 }), created_at: now },
    ],
    match_broadcasts: [],
    match_bot_output: [
      { id: 1, match_id: MATCH_PUBLIC, side: 'red', stream: 'stdout', line: 'hello', created_at: now },
    ],
    worker_state: [],
    official_setups: [],
  };
}

/** PostgREST giả lập: filter eq/gt/gte/lt/lte/in, order, limit, POST/PATCH/DELETE. */
function fakeRest(store) {
  const matchRow = (row, key, raw) => {
    const [op, ...rest] = String(raw).split('.');
    const value = rest.join('.');
    if (op === 'eq') return String(row[key]) === value;
    if (op === 'gt') return Number(row[key]) > Number(value);
    if (op === 'gte') return Number(row[key]) >= Number(value);
    if (op === 'lt') return Number(row[key]) < Number(value);
    if (op === 'lte') return Number(row[key]) <= Number(value);
    if (op === 'in') return value.replace(/^\(|\)$/gu, '').split(',').includes(String(row[key]));
    if (op === 'is') return value === 'null' ? row[key] === null : String(row[key]) === value;
    return true;
  };
  return async (url, options = {}) => {
    const target = new URL(String(url));
    if (target.origin !== 'https://example.invalid') throw new Error(`Test không được gọi DB thật: ${target.origin}`);
    const table = target.pathname.replace('/rest/v1/mvp_', '').replace('/rest/v1/', '');
    const method = (options.method || 'GET').toUpperCase();
    const params = [...target.searchParams];
    const tableRows = store[table] || (store[table] = []);
    const filters = params.filter(([key]) => !['select', 'order', 'limit', 'offset'].includes(key));
    const selected = () => tableRows.filter((row) => filters.every(([key, raw]) => matchRow(row, key, raw)));

    if (method === 'GET') {
      let data = selected();
      const order = target.searchParams.get('order');
      if (order) {
        const [field, direction = 'asc'] = order.split('.');
        data = [...data].sort((a, b) => (a[field] > b[field] ? 1 : a[field] < b[field] ? -1 : 0));
        if (direction === 'desc') data.reverse();
      }
      const limit = Number(target.searchParams.get('limit'));
      if (Number.isFinite(limit) && limit > 0) data = data.slice(0, limit);
      return json(data);
    }
    if (method === 'POST') {
      const incoming = JSON.parse(String(options.body));
      const list = Array.isArray(incoming) ? incoming : [incoming];
      const created = list.map((row) => {
        const saved = { ...row };
        tableRows.push(saved);
        return saved;
      });
      return json(created, 201);
    }
    if (method === 'PATCH') {
      const body = JSON.parse(String(options.body));
      return json(selected().map((row) => Object.assign(row, body)));
    }
    if (method === 'DELETE') {
      const removed = new Set(selected());
      store[table] = tableRows.filter((row) => !removed.has(row));
      return new Response(null, { status: 204 });
    }
    throw new Error(`Phương thức chưa hỗ trợ trong test: ${method}`);
  };
}

async function startApp(t, store) {
  const originalFetch = globalThis.fetch;
  const rest = fakeRest(store);
  globalThis.fetch = (url, options) => {
    const target = String(url);
    if (target.startsWith('http://127.0.0.1:')) return originalFetch(url, options);
    return rest(url, options);
  };
  const app = createApp();
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    globalThis.fetch = originalFetch;
    await new Promise((resolve) => server.close(resolve));
  });
  return { base: `http://127.0.0.1:${server.address().port}`, rest };
}

async function login(base, username) {
  const response = await globalThis.fetch(`${base}/api/local/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: PASSWORD }),
  });
  const body = await response.json();
  const setCookie = response.headers.getSetCookie ? response.headers.getSetCookie().join(';') : response.headers.get('set-cookie') || '';
  return { cookie: setCookie.split(';')[0], csrf: body.csrf };
}

async function call(base, path, { method = 'GET', session, body } = {}) {
  const headers = {};
  if (session) {
    headers.cookie = session.cookie;
    if (method !== 'GET') headers['x-csrf-token'] = session.csrf;
  }
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await globalThis.fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

/** Đặt lịch phát cho ván đã chấm (admin). */
const schedule = (base, admin, startsAt, overrides = {}) =>
  call(base, '/api/local/admin/broadcasts', {
    method: 'POST',
    session: admin,
    body: { match_id: MATCH_PUBLIC, starts_at: startsAt, ply_interval_ms: 2000, release_mode: 'full', ...overrides },
  });


test('viewer: chờ → đang phát → hết; chỉ thấy nước đã phát, không lộ kết quả sớm', async (t) => {
  const store = seedStore();
  const { base } = await startApp(t, store);
  const admin = await login(base, 'admin');
  const teamA = await login(base, 'alpha');

  const waiting = await schedule(base, admin, new Date(Date.now() + 60_000).toISOString());
  assert.equal(waiting.status, 201);
  assert.equal(waiting.body.broadcast.phase, 'waiting');
  assert.equal(waiting.body.broadcast.visible_plies, 0);
  assert.equal(waiting.body.broadcast.total_plies, 3);

  const before = await call(base, `/api/local/broadcasts/${MATCH_PUBLIC}`, { session: teamA });
  assert.equal(before.status, 200);
  assert.equal(before.body.phase, 'waiting');
  assert.deepEqual(before.body.events.map((event) => event.seq), [0], 'chỉ có thế trận ban đầu');
  assert.equal('result' in before.body, false);

  // Bắt đầu cách đây 1 s, nhịp 2 s/nước → visible_plies = 1.
  await schedule(base, admin, new Date(Date.now() - 1000).toISOString());
  const mid = await call(base, `/api/local/broadcasts/${MATCH_PUBLIC}`, { session: teamA });
  assert.equal(mid.body.phase, 'broadcasting');
  assert.equal(mid.body.visible_plies, 1);
  assert.deepEqual(mid.body.events.map((event) => event.seq), [0, 1]);
  assert.equal('result' in mid.body, false, 'chưa được lộ kết quả');
  assert.equal(mid.body.total_plies, 3, 'chỉ lộ tổng số nước');

  const live = await call(base, `/api/live/matches/${MATCH_PUBLIC}`, { session: teamA });
  assert.equal(live.status, 200);
  assert.equal(live.body.match.result, null, 'live snapshot không lộ kết quả');
  assert.equal(live.body.match.reason, null);
  assert.equal(live.body.match.ply_count, null);
  assert.equal(live.body.live.replay_available, false);
  assert.equal(live.body.publication.phase, 'broadcasting');

  // Phát xong với release_mode = full → mở kết quả + event terminal.
  await schedule(base, admin, new Date(Date.now() - 60_000).toISOString());
  const done = await call(base, `/api/local/broadcasts/${MATCH_PUBLIC}`, { session: teamA });
  assert.equal(done.body.phase, 'ended');
  assert.equal(done.body.visible_plies, 3);
  assert.equal(done.body.result, 'red_win');
  assert.deepEqual(done.body.events.map((event) => event.seq), [0, 1, 2, 3, 4]);
});

test('release_mode window không mở replay; full mới mở; admin luôn xem được', async (t) => {
  const store = seedStore();
  const { base } = await startApp(t, store);
  const admin = await login(base, 'admin');
  const teamA = await login(base, 'alpha');

  const windowSchedule = await schedule(base, admin, new Date(Date.now() - 60_000).toISOString(), { release_mode: 'window' });
  assert.equal(windowSchedule.status, 201);
  assert.equal(windowSchedule.body.broadcast.state, 'scheduled');

  const pkg = await call(base, `/api/local/broadcasts/${MATCH_PUBLIC}`, { session: teamA });
  assert.equal(pkg.body.phase, 'ended');
  assert.equal(pkg.body.reveal_result, false);
  assert.equal('result' in pkg.body, false, 'window không mở kết quả dù đã phát hết');

  const teamReplay = await call(base, `/api/local/matches/${MATCH_PUBLIC}/replay`, { session: teamA });
  assert.equal(teamReplay.status, 404);
  assert.equal(teamReplay.body.error, 'replay_not_ready');

  const adminReplay = await call(base, `/api/local/matches/${MATCH_PUBLIC}/replay`, { session: admin });
  assert.equal(adminReplay.status, 200, 'admin luôn xem được replay');

  await schedule(base, admin, new Date(Date.now() - 60_000).toISOString(), { release_mode: 'full' });
  const opened = await call(base, `/api/local/matches/${MATCH_PUBLIC}/replay`, { session: teamA });
  assert.equal(opened.status, 200, 'full + phát hết mở replay cho đội');
});

test('ván chưa công bố bị ẩn khỏi event/live/replay/log; đội giải khác bị 403', async (t) => {
  const { base } = await startApp(t, seedStore());
  const admin = await login(base, 'admin');
  const teamA = await login(base, 'alpha');
  const teamC = await login(base, 'gamma');

  const hiddenEvent = await call(base, `/api/local/events/${EVENT}`, { session: teamA });
  assert.equal(hiddenEvent.status, 200);
  assert.deepEqual(hiddenEvent.body.matches, [], 'chưa công bố thì không hiện ván nào');
  assert.equal(hiddenEvent.body.standings.matches.finished, 0);
  assert.equal(hiddenEvent.body.bracket.champion, null);

  const secretPkg = await call(base, `/api/local/broadcasts/${MATCH_SECRET}`, { session: teamA });
  assert.equal(secretPkg.status, 404);
  assert.equal(secretPkg.body.error, 'broadcast_not_published');

  const secretLive = await call(base, `/api/live/matches/${MATCH_SECRET}`, { session: teamA });
  assert.equal(secretLive.status, 404);

  const secretLog = await call(base, `/api/local/live/matches/${MATCH_SECRET}/bot-output`, { session: teamA });
  assert.equal(secretLog.status, 404);
  assert.equal(secretLog.body.error, 'broadcast_not_published');

  const secretReplay = await call(base, `/api/local/matches/${MATCH_SECRET}/replay`, { session: teamA });
  assert.equal(secretReplay.status, 404);

  const crossEvent = await call(base, `/api/local/broadcasts/${MATCH_PUBLIC}`, { session: teamC });
  assert.equal(crossEvent.status, 403);
  assert.equal(crossEvent.body.error, 'scope_denied');

  // Công bố đầy đủ M1 → event chỉ hiện M1 và standings tính từ đúng ván đã mở.
  await schedule(base, admin, new Date(Date.now() - 60_000).toISOString());
  const published = await call(base, `/api/local/events/${EVENT}`, { session: teamA });
  assert.deepEqual(published.body.matches.map((match) => match.id), [MATCH_PUBLIC]);
  assert.equal(published.body.standings.matches.finished, 1);
  const rowA = published.body.standings.groups.A.find((row) => row.participant_id === TEAM_A);
  assert.equal(rowA.points, 3, 'chỉ cộng điểm ván đã công bố');
});

test('hủy lịch trước giờ phát; đã bắt đầu phát thì 409; đội không được đặt lịch', async (t) => {
  const { base } = await startApp(t, seedStore());
  const admin = await login(base, 'admin');
  const teamA = await login(base, 'alpha');

  await schedule(base, admin, new Date(Date.now() + 120_000).toISOString());
  const canceled = await call(base, `/api/local/admin/broadcasts/${MATCH_PUBLIC}/cancel`, { method: 'POST', session: admin });
  assert.equal(canceled.status, 200);
  assert.equal(canceled.body.broadcast.state, 'canceled');
  assert.equal(canceled.body.broadcast.phase, 'hidden');

  const hidden = await call(base, `/api/local/broadcasts/${MATCH_PUBLIC}`, { session: teamA });
  assert.equal(hidden.status, 404, 'hủy lịch thì quay về ẩn');

  await schedule(base, admin, new Date(Date.now() - 60_000).toISOString());
  const tooLate = await call(base, `/api/local/admin/broadcasts/${MATCH_PUBLIC}/cancel`, { method: 'POST', session: admin });
  assert.equal(tooLate.status, 409);
  assert.equal(tooLate.body.error, 'broadcast_started');

  const denied = await schedule(base, teamA, new Date(Date.now() + 60_000).toISOString());
  assert.equal(denied.status, 403);
  assert.equal(denied.body.error, 'admin_required');
});

test('không còn xem live ẩn danh; input đặt lịch sai bị 400; ván chưa chấm bị 409', async (t) => {
  const store = seedStore();
  const { base } = await startApp(t, store);

  const anonOverview = await call(base, '/api/live/overview');
  assert.equal(anonOverview.status, 401);
  assert.equal(anonOverview.body.error, 'login_required');

  const anonMatch = await call(base, `/api/live/matches/${MATCH_PUBLIC}`);
  assert.equal(anonMatch.status, 401);
  assert.ok(!JSON.stringify(anonMatch.body).includes('initial_pieces'), 'không lộ dữ liệu ván');

  const admin = await login(base, 'admin');
  const badTime = await schedule(base, admin, '2026-10-24 10:00');
  assert.equal(badTime.status, 400);
  assert.equal(badTime.body.error, 'bad_starts_at');

  const badInterval = await schedule(base, admin, new Date().toISOString(), { ply_interval_ms: 10 });
  assert.equal(badInterval.status, 400);
  assert.equal(badInterval.body.error, 'bad_ply_interval');

  const badMode = await schedule(base, admin, new Date().toISOString(), { release_mode: 'stream' });
  assert.equal(badMode.status, 400);
  assert.equal(badMode.body.error, 'bad_release_mode');

  store.matches[0].status = 'running';
  const notGraded = await schedule(base, admin, new Date().toISOString());
  assert.equal(notGraded.status, 409);
  assert.equal(notGraded.body.error, 'match_not_graded');
});


test('live overview: đội chỉ thấy giải mình tham gia, không lộ giải/đội khác', async (t) => {
  const { base } = await startApp(t, seedStore());
  const admin = await login(base, 'admin');
  const alpha = await login(base, 'alpha');
  const gamma = await login(base, 'gamma');

  const mine = await call(base, '/api/live/overview', { session: alpha });
  assert.equal(mine.status, 200);
  assert.equal(mine.body.event.id, EVENT, 'Alpha thuộc giải H3');

  const other = await call(base, '/api/live/overview', { session: gamma });
  assert.equal(other.status, 200);
  assert.equal(other.body.event.id, OTHER_EVENT, 'Gamma chỉ thấy giải của mình');
  assert.ok(!JSON.stringify(other.body).includes('Đội Alpha'), 'không lộ tên đội giải khác');

  const adminView = await call(base, '/api/live/overview', { session: admin });
  assert.equal(adminView.body.event.id, EVENT, 'admin thấy giải đang chạy mới nhất');

  const crossMatch = await call(base, `/api/live/matches/${MATCH_PUBLIC}`, { session: gamma });
  assert.equal(crossMatch.status, 403);
  assert.equal(crossMatch.body.error, 'scope_denied');
});
