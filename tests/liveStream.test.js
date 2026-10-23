/**
 * liveStream.test.js — Kiểm tra lớp xem trực tiếp trên Supabase mà KHÔNG cần DB thật:
 * `globalThis.fetch` được thay bằng PostgREST giả lập tối thiểu.
 *
 * Mục tiêu bảo vệ:
 * - Snapshot công khai chỉ chứa field whitelist (không log bot, không ghi chú, không path).
 * - `seq` tăng đúng, ghi lại một nước không nhân đôi event, terminal chỉ một lần.
 * - `afterSeq` trả phần còn thiếu và bật `reset` khi client tụt lại.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only';

const live = await import('../server/shared/live.js');
const { default: config } = await import('../server/config.js');

const MATCH = '11111111-1111-4111-8111-111111111111';
const EVENT = '22222222-2222-4222-8222-222222222222';
const RED = '33333333-3333-4333-8333-333333333333';
const BLUE = '44444444-4444-4444-8444-444444444444';
const RED_ENTRY = '55555555-5555-4555-8555-555555555555';
const BLUE_ENTRY = '66666666-6666-4666-8666-666666666666';

/** PostgREST giả lập: đủ filter/order/limit/upsert cho các truy vấn của live.js. */
function fakeRest(store) {
  const match = (row, key, raw) => {
    const [op, ...rest] = raw.split('.');
    const value = rest.join('.');
    if (op === 'eq') return String(row[key]) === value;
    if (op === 'gt') return Number(row[key]) > Number(value);
    if (op === 'lt') return String(row[key]) < value;
    if (op === 'in') {
      const list = value.replace(/^\(|\)$/gu, '').split(',');
      return list.includes(String(row[key]));
    }
    return true;
  };
  return async (url, options = {}) => {
    const target = new URL(url);
    // `rows()/insert()` gọi bảng qua PostgREST với tiền tố `mvp_`.
    const table = target.pathname.replace('/rest/v1/mvp_', '').replace('/rest/v1/', '');
    const method = (options.method || 'GET').toUpperCase();
    const params = target.searchParams;
    const rows = store[table] || (store[table] = []);

    if (method === 'GET') {
      let data = rows.filter((row) => [...params].every(([key, raw]) => ['order', 'limit', 'select'].includes(key) || match(row, key, raw)));
      const order = params.get('order');
      if (order) {
        const [field, direction = 'asc'] = order.split('.');
        data = [...data].sort((a, b) => (a[field] > b[field] ? 1 : a[field] < b[field] ? -1 : 0));
        if (direction === 'desc') data.reverse();
      }
      const limit = Number(params.get('limit'));
      if (Number.isFinite(limit) && limit > 0) data = data.slice(0, limit);
      return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
    }

    if (method === 'POST') {
      const incoming = JSON.parse(String(options.body));
      const list = Array.isArray(incoming) ? incoming : [incoming];
      const merge = String(options.headers?.Prefer || '').includes('merge-duplicates');
      const saved = list.map((row) => {
        const key = table === 'match_events' ? (r) => r.match_id === row.match_id && r.seq === row.seq : (r) => r.worker_id && r.worker_id === row.worker_id;
        const existing = merge ? rows.find(key) : null;
        if (existing) {
          Object.assign(existing, row);
          return existing;
        }
        const created = { id: rows.length + 1, ...row };
        rows.push(created);
        return created;
      });
      return new Response(JSON.stringify(options.headers?.Prefer?.includes('return=minimal') ? null : saved), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (method === 'DELETE') {
      const keep = rows.filter((row) => ![...params].every(([key, raw]) => match(row, key, raw)));
      store[table] = keep;
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    }

    return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
  };
}

function seed() {
  return {
    matches: [
      {
        id: MATCH,
        tournament_id: EVENT,
        stage: 'group',
        series_id: 'A-r1',
        game_no: 1,
        seed: 7,
        status: 'running',
        result: null,
        reason: null,
        ply_count: null,
        started_at: '2026-10-23T10:00:00.000Z',
        finished_at: null,
        red_entry_id: RED_ENTRY,
        blue_entry_id: BLUE_ENTRY,
        worker_id: 'judge-1',
        lease_until: '2026-10-23T10:01:00.000Z',
        replay_json: '{"secret":"replay-only"}',
      },
    ],
    tournament_entries: [
      { id: RED_ENTRY, tournament_id: EVENT, participant_id: RED, seed_order: 1, group_name: 'A' },
      { id: BLUE_ENTRY, tournament_id: EVENT, participant_id: BLUE, seed_order: 2, group_name: 'A' },
    ],
    participants: [
      { id: RED, name: 'Đỏ Alpha' },
      { id: BLUE, name: 'Xanh Beta' },
    ],
    tournaments: [
      {
        id: EVENT,
        name: 'Giải thử',
        status: 'group_running',
        started_at: '2026-10-23T09:59:00.000Z',
        finished_at: null,
        created_at: '2026-10-22T09:00:00.000Z',
        map_json: '{"blocked":[]}',
      },
    ],
    match_events: [
      {
        match_id: MATCH,
        seq: 0,
        kind: 'initial',
        payload_json: JSON.stringify({ seed: 7, initial_pieces: [{ id: 'r1', type: 'rock', owner: 'red' }] }),
        created_at: '2026-10-23T10:00:00.000Z',
      },
    ],
    match_bot_output: [],
    worker_state: [{ worker_id: 'judge-1', heartbeat_at: new Date().toISOString(), match_id: MATCH }],
  };
}


test('snapshot công khai chỉ trả field whitelist (không log/ghi chú/đường dẫn)', async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = fakeRest(seed());
  t.after(() => { globalThis.fetch = original; });

  const snapshot = await live.getLiveMatchSnapshot(MATCH);
  assert.equal(snapshot.match.red.name, 'Đỏ Alpha');
  assert.equal(snapshot.match.blue.name, 'Xanh Beta');
  assert.equal(snapshot.match.tournament.name, 'Giải thử');
  assert.deepEqual(snapshot.map, { blocked: [] });
  assert.equal(snapshot.live.has_initial, true);
  assert.equal(snapshot.live.latest_seq, 0);
  assert.equal(snapshot.live.initial_pieces[0].type, 'rock');

  const text = JSON.stringify(snapshot);
  assert.ok(!text.includes('replay-only'), 'không lộ replay_json');
  assert.ok(!text.includes('storage_path'), 'không lộ đường dẫn lưu trữ');
  assert.ok(!text.includes('notes'), 'không lộ ghi chú chấm');

  assert.equal(await live.getLiveMatchSnapshot('khong-ton-tai'), null);
  assert.equal(await live.liveMatchExists('khong-ton-tai'), false);
});

test('event: seq tăng đúng, ghi lại không nhân đôi, afterSeq/reset chính xác', async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = fakeRest(seed());
  t.after(() => { globalThis.fetch = original; });

  await live.recordLiveMove(MATCH, { ply: 1, event: { type: 'move' } });
  await live.recordLiveMove(MATCH, { ply: 1, event: { type: 'move' } });
  assert.equal(await live.recordLiveTerminal(MATCH, { result: 'red_win', reason: 'base_capture', ply_count: 1 }), true);
  assert.equal(await live.recordLiveTerminal(MATCH, { result: 'red_win' }), false, 'terminal chỉ ghi một lần');

  const all = await live.listLiveEvents(MATCH, { afterSeq: 0 });
  assert.deepEqual(all.events.map((event) => event.kind), ['initial', 'move', 'terminal']);
  assert.deepEqual(all.events.map((event) => event.seq), [0, 1, 2]);
  assert.equal(all.latest_seq, 2);
  assert.equal(all.reset, false);

  const tail = await live.listLiveEvents(MATCH, { afterSeq: 1 });
  assert.deepEqual(tail.events.map((event) => event.seq), [2]);

  const stale = await live.listLiveEvents(MATCH, { afterSeq: 99 });
  assert.equal(stale.reset, true, 'client tụt lại phải tải lại snapshot');
  assert.deepEqual(stale.events, []);
});

test('log bot L2 lọc ký tự điều khiển và tách theo bên', async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = fakeRest(seed());
  t.after(() => { globalThis.fetch = original; });

  const written = await live.recordBotOutput(MATCH, 'red', 'stderr', '\u001b[31mboom\u001b[0m\r\nhello\n\n');
  assert.equal(written, 2);
  assert.equal(config.live.botOutputLinesPerMatch >= written, true);

  const red = await live.listBotOutput(MATCH, { side: 'red' });
  assert.equal(red.lines.length, 2);
  assert.ok(!red.lines.some((line) => line.line.includes('\u001b')));
  assert.equal(red.side, 'red');

  const blue = await live.listBotOutput(MATCH, { side: 'blue' });
  assert.deepEqual(blue.lines, [], 'đội không tham gia bên đó không thấy log');
});

test('overview: đếm ván, tên đội và trạng thái worker', async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = fakeRest(seed());
  t.after(() => { globalThis.fetch = original; });

  const overview = await live.getLiveOverview({ now: Date.parse('2026-10-23T10:00:05.000Z') });
  assert.equal(overview.event.id, EVENT);
  assert.equal(overview.counts.total, 1);
  assert.equal(overview.counts.running, 1);
  assert.equal(overview.matches[0].red.name, 'Đỏ Alpha');
  assert.equal(overview.matches[0].ply, 0);
  assert.equal(overview.worker.alive, true);
  assert.match(overview.server_time, /^\d{4}-\d{2}-\d{2}T/u);
});
