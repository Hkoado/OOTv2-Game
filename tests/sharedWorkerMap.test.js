/**
 * Test worker shared đối chiếu snapshot map trước khi chấm:
 * - Ưu tiên snapshot trên `mvp_matches`, fallback map của giải cho ván cũ.
 * - Hash lệch/hỏng => lỗi hạ tầng: KHÔNG chạy bot, KHÔNG ghi kết quả, có release lease.
 * Chạy: `node --test tests/sharedWorkerMap.test.js`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { EMPTY_MAP } from '../src/game/maps.js';
import { matchMapSnapshot } from '../server/contracts/mapSnapshot.js';

const BLOCKED_MAP = { ...EMPTY_MAP, blocked: ['e4', 'e6'] };
const ENV_KEYS = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];

/** Cấu hình Supabase giả + fetch giả; trả `calls` để kiểm URL đã gọi. */
function fakeSupabase(handler) {
  const previous = ENV_KEYS.map((key) => [key, process.env[key]]);
  const originalFetch = globalThis.fetch;
  const calls = [];
  process.env.SUPABASE_URL = 'https://shared-test.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    calls.push({ url: target, options });
    const body = handler(target, options);
    return new Response(JSON.stringify(body === undefined ? [] : body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  return {
    calls,
    restore() {
      globalThis.fetch = originalFetch;
      for (const [key, value] of previous) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    },
  };
}

test('matchMapFor: dùng snapshot của ván và không truy vấn map giải', async () => {
  const snapshot = matchMapSnapshot(BLOCKED_MAP);
  const fake = fakeSupabase(() => []);
  try {
    const { matchMapFor } = await import('../server/shared/worker.js');
    const info = await matchMapFor({ tournament_id: 'event-1', map_json: snapshot.json, map_hash: snapshot.hash });
    assert.equal(info.error, null);
    assert.equal(info.source, 'match');
    assert.equal(info.hash, snapshot.hash);
    assert.deepEqual(info.map.blocked, ['e4', 'e6']);
    assert.equal(fake.calls.length, 0, 'không cần gọi DB khi ván đã có snapshot');
  } finally {
    fake.restore();
  }
});

test('matchMapFor: ván cũ không có snapshot thì đọc map hiện tại của giải', async () => {
  const eventMap = matchMapSnapshot(EMPTY_MAP);
  const fake = fakeSupabase((url) => {
    assert.match(url, /\/rest\/v1\/mvp_tournaments\?/u);
    assert.match(url, /select=map_json/u);
    return [{ map_json: eventMap.json }];
  });
  try {
    const { matchMapFor } = await import('../server/shared/worker.js');
    const info = await matchMapFor({ tournament_id: 'event-1', map_json: null, map_hash: null });
    assert.equal(info.error, null);
    assert.equal(info.source, 'event');
    assert.equal(info.hash, eventMap.hash);
    assert.deepEqual(info.map, JSON.parse(eventMap.json));
  } finally {
    fake.restore();
  }
});

test('processSharedMatch: hash map lệch thì không chạy bot và không ghi kết quả', async () => {
  const claimed = {
    id: '00000000-0000-4000-8000-000000000010',
    tournament_id: '00000000-0000-4000-8000-000000000011',
    lease_token: '00000000-0000-4000-8000-000000000012',
    seed: 7,
    map_json: matchMapSnapshot(BLOCKED_MAP).json,
    map_hash: 'd'.repeat(64),
  };
  const fake = fakeSupabase((url) => {
    if (url.includes('/rpc/mvp_claim')) return claimed;
    if (url.includes('/rpc/mvp_release')) return true;
    return [];
  });
  try {
    const { processSharedMatch } = await import('../server/shared/worker.js');
    let botRan = false;
    const result = await processSharedMatch({
      workerId: 'map-snapshot-test',
      verbose: false,
      run: async () => {
        botRan = true;
        return { result: 'draw', reason: 'move_limit', ply_count: 0, replay: {}, notes: [] };
      },
    });

    assert.equal(botRan, false, 'không được chạy bot khi snapshot map không khớp');
    assert.equal(result.processed, true);
    assert.equal(result.recorded, false);
    assert.equal(result.reason, 'infrastructure');
    assert.ok(fake.calls.some((call) => call.url.includes('/rpc/mvp_release')), 'phải release lease để chạy lại');
    assert.equal(fake.calls.some((call) => call.url.includes('/rpc/mvp_finish')), false, 'không ghi kết quả');
  } finally {
    fake.restore();
  }
});
