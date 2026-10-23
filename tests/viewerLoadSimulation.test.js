/**
 * viewerLoadSimulation.test.js — B4: Thử nghiệm tải mô phỏng Viewer (50, 100, 200 concurrent viewers).
 *
 * Yêu cầu điều lệ B4 (docs/assignments/Bao.md):
 * "Tải 50/100/200 viewer và ghi request rate/P95/lỗi thay vì ước lượng."
 *
 * Môi trường kiểm thử:
 * - Mock PostgREST backend in-process (Express server HTTP nội bộ).
 * - Đo lường các chỉ số:
 *   + Tổng số requests, thời gian hoàn thành (ms)
 *   + Tốc độ xử lý (Requests/giây - RPS)
 *   + Độ trễ (Min, Max, Avg, P50, P90, P95, P99) tính bằng milliseconds
 *   + Tỷ lệ lỗi (Error rate %)
 *
 * Lưu ý: Kết quả được đo trên môi trường mock in-process; chưa kết nối PostgreSQL Supabase thật (ghi rõ NOT RUN).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { performance } from 'node:perf_hooks';
import { randomUUID, scryptSync } from 'node:crypto';

process.env.SUPABASE_URL = 'https://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only';

const { createApp } = await import('../server/app.js');

const PASSWORD = 'mat-khau-kiem-thu-12';
const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const TEAM_ID = '22222222-2222-4222-8222-222222222222';
const PARTICIPANT_ID = '44444444-4444-4444-8444-444444444444';
const EVENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MATCH_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const encode = (password) => {
  const salt = 'a'.repeat(32);
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
};

const json = (data, status = 200) =>
  new Response(data === null ? null : JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });

function seedLoadStore() {
  const now = new Date().toISOString();
  return {
    participants: [{ id: PARTICIPANT_ID, name: 'Đội Tải Viewer', name_key: 'đội tải viewer', created_at: now }],
    accounts: [
      { id: ADMIN_ID, username: 'admin', password_hash: encode(PASSWORD), role: 'admin', participant_id: null, created_at: now },
      { id: TEAM_ID, username: 'viewerteam', password_hash: encode(PASSWORD), role: 'team', participant_id: PARTICIPANT_ID, created_at: now },
    ],
    sessions: [],
    submissions: [],
    tournaments: [
      { id: EVENT_ID, name: 'Giải Đấu Tải Viewer', status: 'group_running', version: 1, created_at: now },
    ],
    tournament_entries: [
      { id: randomUUID(), tournament_id: EVENT_ID, participant_id: PARTICIPANT_ID, seed_order: 1, group_name: 'A' },
    ],
    official_setups: [],
    repo_connections: [],
    repo_sync_jobs: [],
    github_receipts: [],
    matches: [
      { id: MATCH_ID, tournament_id: EVENT_ID, status: 'finished', ply_count: 40, result: 'red_win_base', reason: 'base_captured', stage: 'group', game_no: 1 },
    ],
    match_broadcasts: [
      {
        match_id: MATCH_ID,
        event_id: EVENT_ID,
        state: 'scheduled',
        starts_at: '2026-10-24T00:00:00.000Z',
        ply_interval_ms: 2000,
        release_mode: 'full',
        created_at: now,
      },
    ],
    match_events: [
      { id: randomUUID(), match_id: MATCH_ID, seq: 0, kind: 'initial', payload_json: '{}' },
      { id: randomUUID(), match_id: MATCH_ID, seq: 1, kind: 'move', payload_json: '{"turn":"red","move":"A1-B2"}' },
      { id: randomUUID(), match_id: MATCH_ID, seq: 2, kind: 'move', payload_json: '{"turn":"blue","move":"I9-H8"}' },
      { id: randomUUID(), match_id: MATCH_ID, seq: 3, kind: 'move', payload_json: '{"turn":"red","move":"B2-C3"}' },
    ],
    match_bot_output: [],
    worker_state: [],
  };
}

function fakeLoadBackend(store) {
  const matchRow = (row, key, raw) => {
    const [op, ...rest] = String(raw).split('.');
    const value = rest.join('.');
    if (op === 'eq') return String(row[key]) === value;
    if (op === 'in') return value.replace(/^\(|\)$/gu, '').split(',').includes(String(row[key]));
    if (op === 'is') return value === 'null' ? row[key] === null : String(row[key]) === value;
    if (op === 'gt') return Number(row[key]) > Number(value);
    if (op === 'gte') return Number(row[key]) >= Number(value);
    if (op === 'lte') return Number(row[key]) <= Number(value);
    return true;
  };

  return async (url, options = {}) => {
    const target = new URL(String(url));
    const table = target.pathname.replace('/rest/v1/mvp_', '').replace('/rest/v1/', '');
    const method = (options.method || 'GET').toUpperCase();
    const rowsInTable = store[table] || (store[table] = []);
    const params = [...target.searchParams];
    const filters = params.filter(([key]) => !['select', 'order', 'limit', 'offset'].includes(key));
    const selected = () => rowsInTable.filter((row) => filters.every(([key, raw]) => matchRow(row, key, raw)));

    if (method === 'GET') {
      let data = selected();
      const limit = Number(target.searchParams.get('limit'));
      if (Number.isFinite(limit) && limit > 0) data = data.slice(0, limit);
      return json(data);
    }
    if (method === 'POST') {
      const incoming = JSON.parse(String(options.body));
      const created = (Array.isArray(incoming) ? incoming : [incoming]).map((row) => {
        const saved = { ...row };
        rowsInTable.push(saved);
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
      store[table] = rowsInTable.filter((row) => !removed.has(row));
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unsupported method: ${method}`);
  };
}

async function startLoadApp(t, store) {
  const originalFetch = globalThis.fetch;
  const backend = fakeLoadBackend(store);
  globalThis.fetch = (url, options) => {
    const target = String(url);
    if (target.startsWith('http://127.0.0.1:')) return originalFetch(url, options);
    return backend(url, options);
  };
  const app = createApp();
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    globalThis.fetch = originalFetch;
    await new Promise((resolve) => server.close(resolve));
  });
  return { base: `http://127.0.0.1:${server.address().port}` };
}

async function authenticateViewer(base) {
  const res = await globalThis.fetch(`${base}/api/local/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'viewerteam', password: PASSWORD }),
  });
  const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie().join(';') : res.headers.get('set-cookie') || '';
  return setCookie.split(';')[0];
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
}

async function executeConcurrentLoad({ base, cookie, endpoint, concurrency, totalRequests }) {
  const latencies = [];
  let successCount = 0;
  let errorCount = 0;

  const queue = Array.from({ length: totalRequests }, (_, i) => i);
  const startTime = performance.now();

  const worker = async () => {
    while (queue.length > 0) {
      queue.pop();
      const reqStart = performance.now();
      try {
        const res = await globalThis.fetch(`${base}${endpoint}`, {
          headers: { cookie },
        });
        const reqEnd = performance.now();
        const duration = reqEnd - reqStart;
        latencies.push(duration);
        if (res.status === 200) {
          successCount += 1;
        } else {
          errorCount += 1;
        }
      } catch {
        const reqEnd = performance.now();
        latencies.push(reqEnd - reqStart);
        errorCount += 1;
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  const totalDurationMs = performance.now() - startTime;

  latencies.sort((a, b) => a - b);
  const min = latencies[0] || 0;
  const max = latencies[latencies.length - 1] || 0;
  const avg = latencies.reduce((sum, v) => sum + v, 0) / (latencies.length || 1);
  const p50 = percentile(latencies, 50);
  const p90 = percentile(latencies, 90);
  const p95 = percentile(latencies, 95);
  const p99 = percentile(latencies, 99);
  const requestRate = totalRequests / (totalDurationMs / 1000);
  const errorRate = (errorCount / totalRequests) * 100;

  return {
    concurrency,
    totalRequests,
    successCount,
    errorCount,
    errorRate,
    totalDurationMs: Math.round(totalDurationMs * 10) / 10,
    requestRate: Math.round(requestRate * 10) / 10,
    min: Math.round(min * 10) / 10,
    avg: Math.round(avg * 10) / 10,
    p50: Math.round(p50 * 10) / 10,
    p90: Math.round(p90 * 10) / 10,
    p95: Math.round(p95 * 10) / 10,
    p99: Math.round(p99 * 10) / 10,
    max: Math.round(max * 10) / 10,
  };
}

// ==================== B4 LOAD TESTS ====================

test('B4 Load Test: Tải đồng thời 50 viewers polling live overview & broadcast package', async (t) => {
  const store = seedLoadStore();
  const { base } = await startLoadApp(t, store);
  const cookie = await authenticateViewer(base);

  // 1. Test 50 viewers polling /api/live/overview
  const overviewResult = await executeConcurrentLoad({
    base,
    cookie,
    endpoint: '/api/live/overview',
    concurrency: 50,
    totalRequests: 100,
  });

  // 2. Test 50 viewers polling /api/local/broadcasts/:matchId
  const broadcastResult = await executeConcurrentLoad({
    base,
    cookie,
    endpoint: `/api/local/broadcasts/${MATCH_ID}?afterSeq=0`,
    concurrency: 50,
    totalRequests: 100,
  });

  console.log(`[LOAD 50 VIEWERS] RPS: ${broadcastResult.requestRate} req/s | P50: ${broadcastResult.p50}ms | P95: ${broadcastResult.p95}ms | P99: ${broadcastResult.p99}ms | Error: ${broadcastResult.errorRate}%`);

  assert.equal(overviewResult.errorCount, 0, '50 viewers overview: tỷ lệ lỗi 0%');
  assert.equal(broadcastResult.errorCount, 0, '50 viewers broadcast: tỷ lệ lỗi 0%');
  assert.ok(overviewResult.p95 < 800, `Overview P95 (${overviewResult.p95}ms) < 800ms`);
  assert.ok(broadcastResult.p95 < 800, `Broadcast P95 (${broadcastResult.p95}ms) < 800ms`);
  assert.ok(broadcastResult.requestRate > 100, `RPS (${broadcastResult.requestRate}) > 100 req/s`);
});

test('B4 Load Test: Tải đồng thời 100 viewers polling live overview & broadcast package', async (t) => {
  const store = seedLoadStore();
  const { base } = await startLoadApp(t, store);
  const cookie = await authenticateViewer(base);

  const result = await executeConcurrentLoad({
    base,
    cookie,
    endpoint: `/api/local/broadcasts/${MATCH_ID}?afterSeq=1`,
    concurrency: 100,
    totalRequests: 200,
  });

  // Ghi log kết quả đo đạc thực tế phục vụ handoff B4
  console.log(`[LOAD 100 VIEWERS] RPS: ${result.requestRate} req/s | P50: ${result.p50}ms | P95: ${result.p95}ms | P99: ${result.p99}ms | Error: ${result.errorRate}%`);

  assert.equal(result.errorCount, 0, '100 viewers: tỷ lệ lỗi 0%');
  assert.ok(result.p95 < 1000, `P95 (${result.p95}ms) < 1000ms`);
  assert.ok(result.requestRate > 150, `RPS (${result.requestRate}) > 150 req/s`);
});

test('B4 Load Test: Tải đồng thời 200 viewers polling live stream package', async (t) => {
  const store = seedLoadStore();
  const { base } = await startLoadApp(t, store);
  const cookie = await authenticateViewer(base);

  const result = await executeConcurrentLoad({
    base,
    cookie,
    endpoint: `/api/local/broadcasts/${MATCH_ID}?afterSeq=0`,
    concurrency: 200,
    totalRequests: 400,
  });

  console.log(`[LOAD 200 VIEWERS] RPS: ${result.requestRate} req/s | P50: ${result.p50}ms | P95: ${result.p95}ms | P99: ${result.p99}ms | Error: ${result.errorRate}%`);

  assert.equal(result.errorCount, 0, '200 viewers: tỷ lệ lỗi 0%');
  assert.ok(result.p95 < 1500, `P95 (${result.p95}ms) < 1500ms`);
  assert.ok(result.requestRate > 200, `RPS (${result.requestRate}) > 200 req/s`);
});
