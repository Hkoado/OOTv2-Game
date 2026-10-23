/**
 * githubIntakeApi.test.js — Hợp đồng HTTP của intake GitHub (H1).
 *
 * Toàn bộ Supabase và GitHub được giả lập ở lớp `fetch`; test KHÔNG chạm DB/mạng thật.
 * Bảo vệ các quy tắc đã chốt:
 * - Team tự đăng ký repo nhưng phải được BTC duyệt mới nộp được (`repo_not_approved`).
 * - API chỉ resolve metadata + SHA (không tải blob/source), trả receipt whitelist.
 * - Cùng SHA không tạo job mới/quota mới; quota 24h tính theo SHA mới.
 * - Cross-team bị 403; cần CSRF; giải đã chạy thì đóng băng (`event_frozen`).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID, scryptSync } from 'node:crypto';

process.env.SUPABASE_URL = 'https://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only';

const { createApp } = await import('../server/app.js');

const PASSWORD = 'mat-khau-kiem-thu-12';
const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const EVENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const RUNNING_EVENT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TEAM_PARTICIPANT = '44444444-4444-4444-8444-444444444444';
const OTHER_PARTICIPANT = '55555555-5555-4555-8555-555555555555';
const REPO_URL = 'https://github.com/team-delta/ootv2-bot';
const OWNER = 'team-delta';
const NAME = 'ootv2-bot';
const SHA = 'a'.repeat(40);

const json = (data, status = 200, headers = {}) =>
  new Response(data === null ? null : JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

function encode(password) {
  const salt = 'a'.repeat(32);
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}

function seedStore() {
  return {
    participants: [
      { id: TEAM_PARTICIPANT, name: 'Đội Delta', name_key: 'đội delta', created_at: '2026-10-20T00:00:00.000Z' },
      { id: OTHER_PARTICIPANT, name: 'Đội Echo', name_key: 'đội echo', created_at: '2026-10-20T00:00:01.000Z' },
    ],
    accounts: [
      { id: ADMIN_ID, username: 'admin', password_hash: encode(PASSWORD), role: 'admin', participant_id: null, members: '', contact: '', repository: '', branch: 'main', created_at: '2026-10-20T00:00:00.000Z' },
      { id: '22222222-2222-4222-8222-222222222222', username: 'delta', password_hash: encode(PASSWORD), role: 'team', participant_id: TEAM_PARTICIPANT, members: '', contact: '', repository: '', branch: 'main', created_at: '2026-10-20T00:00:01.000Z' },
      { id: '33333333-3333-4333-8333-333333333333', username: 'echo', password_hash: encode(PASSWORD), role: 'team', participant_id: OTHER_PARTICIPANT, members: '', contact: '', repository: '', branch: 'main', created_at: '2026-10-20T00:00:02.000Z' },
    ],
    sessions: [],
    submissions: [],
    tournaments: [
      { id: EVENT_ID, name: 'Giải Tuần 1', status: 'draft', seed: 7, created_at: '2026-10-20T00:00:00.000Z' },
      { id: RUNNING_EVENT_ID, name: 'Giải đang chạy', status: 'group_running', seed: 8, created_at: '2026-10-20T00:00:00.000Z' },
    ],
    tournament_entries: [
      { id: '66666666-6666-4666-8666-666666666666', tournament_id: EVENT_ID, participant_id: TEAM_PARTICIPANT, seed_order: 1 },
      { id: '77777777-7777-4777-8777-777777777777', tournament_id: EVENT_ID, participant_id: OTHER_PARTICIPANT, seed_order: 2 },
    ],
    repo_connections: [],
    repo_sync_jobs: [],
    github_receipts: [],
  };
}

/** PostgREST giả lập tối thiểu: filter eq/gt/lte/in, order, limit + dispatch RPC. */
function fakeRest(store) {
  const calls = [];
  const matchRow = (row, key, raw) => {
    const [op, ...rest] = String(raw).split('.');
    const value = rest.join('.');
    if (op === 'eq') return String(row[key]) === value;
    if (op === 'gt') return Number(row[key]) > Number(value);
    if (op === 'lte') return Number(row[key]) <= Number(value);
    if (op === 'in') return value.replace(/^\(|\)$/gu, '').split(',').includes(String(row[key]));
    return true;
  };
  const rpcHandlers = { mvp_repo_connection_upsert: connectionUpsert, mvp_repo_connection_revoke: connectionRevoke, mvp_github_intake: intake };
  return async (url, options = {}) => {
    const target = new URL(String(url));
    if (target.origin !== 'https://example.invalid') throw new Error(`Test không được gọi DB thật: ${target.origin}`);
    const method = (options.method || 'GET').toUpperCase();
    if (target.pathname.startsWith('/rest/v1/rpc/')) {
      const name = target.pathname.slice('/rest/v1/rpc/'.length);
      const body = options.body ? JSON.parse(String(options.body)) : {};
      calls.push({ method, rpc: name, body });
      const handler = rpcHandlers[name];
      if (!handler) throw new Error(`RPC chưa được giả lập: ${name}`);
      return json(handler(store, body));
    }
    const table = target.pathname.replace('/rest/v1/mvp_', '').replace('/rest/v1/', '');
    const rowsInTable = store[table] || (store[table] = []);
    const params = [...target.searchParams];
    calls.push({ method, table, params: Object.fromEntries(params) });
    const filters = params.filter(([key]) => !['select', 'order', 'limit', 'offset'].includes(key));
    const selected = () => rowsInTable.filter((row) => filters.every(([key, raw]) => matchRow(row, key, raw)));

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
    throw new Error(`Phương thức chưa hỗ trợ trong test: ${method}`);
  };
}

/** Bản JS mô phỏng `mvp_repo_connection_upsert` (SQL thật được giữ nguyên trong migration). */
function connectionUpsert(store, body) {
  const event = store.tournaments.find((row) => row.id === body.p_event);
  if (!event) return { ok: false, error: 'event_not_found' };
  if (event.status !== 'draft') return { ok: false, error: 'event_frozen' };
  const member = store.tournament_entries.some((row) => row.tournament_id === body.p_event && row.participant_id === body.p_team);
  if (!member) return { ok: false, error: 'not_in_event' };
  const taken = store.repo_connections.some(
    (row) => row.event_id === body.p_event && Number(row.repo_id) === Number(body.p_repo_id) && row.team_id !== body.p_team
  );
  if (taken) return { ok: false, error: 'repo_taken' };
  const now = new Date().toISOString();
  let connection = store.repo_connections.find((row) => row.event_id === body.p_event && row.team_id === body.p_team);
  if (!connection) {
    connection = {
      id: randomUUID(), event_id: body.p_event, team_id: body.p_team, repo_id: Number(body.p_repo_id),
      repository: body.p_repository, branch: body.p_branch, file_path: 'bot.py',
      approved: body.p_approved === true, approved_by: body.p_approved ? body.p_actor : null,
      created_at: now, updated_at: now,
    };
    store.repo_connections.push(connection);
  } else {
    const keep = Number(connection.repo_id) === Number(body.p_repo_id)
      && connection.repository === body.p_repository
      && connection.branch === body.p_branch
      && connection.approved === true;
    connection.repo_id = Number(body.p_repo_id);
    connection.repository = body.p_repository;
    connection.branch = body.p_branch;
    connection.approved = body.p_approved === true || keep;
    if (body.p_approved) connection.approved_by = body.p_actor;
    connection.updated_at = now;
  }
  // Mirror SQL 20261024170000: thu hồi/đổi repo => hủy job chờ + đóng băng receipt chưa kết thúc.
  let canceledJobs = 0;
  if (connection.approved !== true) {
    const mine = store.repo_sync_jobs.filter((job) => job.event_id === body.p_event && job.team_id === body.p_team
      && ['queued', 'leased', 'running'].includes(job.status));
    for (const job of mine) {
      job.status = 'canceled';
      job.lease_token = null;
      job.lease_until = null;
      job.error = 'repository_changed';
      job.error_category = 'repo';
      const receipt = store.github_receipts.find((row) => row.job_id === job.id);
      if (receipt && ['resolving', 'fetching', 'checking'].includes(receipt.status)) {
        receipt.status = 'frozen';
        receipt.error = 'repository_changed';
        receipt.error_category = 'repo';
      }
    }
    canceledJobs = mine.length;
  }
  return { ok: true, connection, canceled_jobs: canceledJobs };
}

/** Bản JS mô phỏng `mvp_repo_connection_revoke`: luôn thu hồi duyệt + hủy job chờ. */
function connectionRevoke(store, body) {
  const event = store.tournaments.find((row) => row.id === body.p_event);
  if (!event) return { ok: false, error: 'event_not_found' };
  if (event.status !== 'draft') return { ok: false, error: 'event_frozen' };
  const connection = store.repo_connections.find((row) => row.event_id === body.p_event && row.team_id === body.p_team);
  if (!connection) return { ok: false, error: 'repository_not_registered' };
  connection.approved = false;
  connection.approved_by = null;
  const mine = store.repo_sync_jobs.filter((job) => job.event_id === body.p_event && job.team_id === body.p_team
    && ['queued', 'leased', 'running'].includes(job.status));
  for (const job of mine) {
    job.status = 'canceled';
    job.lease_token = null;
    job.lease_until = null;
    job.error = 'repository_revoked';
    job.error_category = 'repo';
    const receipt = store.github_receipts.find((row) => row.job_id === job.id);
    if (receipt && ['resolving', 'fetching', 'checking'].includes(receipt.status)) {
      receipt.status = 'frozen';
      receipt.error = 'repository_revoked';
      receipt.error_category = 'repo';
    }
  }
  return { ok: true, connection, canceled_jobs: mine.length };
}

/** Bản JS mô phỏng `mvp_github_intake`: idempotency theo SHA + quota 24h + freeze. */
function intake(store, body) {
  const event = store.tournaments.find((row) => row.id === body.p_event);
  if (!event) return { ok: false, error: 'event_not_found' };
  if (event.status !== 'draft') return { ok: false, error: 'event_frozen' };
  if (!/^[0-9a-f]{40}$/u.test(body.p_commit_sha) || body.p_file_path !== 'bot.py') return { ok: false, error: 'bad_request' };
  const member = store.tournament_entries.some((row) => row.tournament_id === body.p_event && row.participant_id === body.p_team);
  if (!member) return { ok: false, error: 'not_in_event' };
  const connection = store.repo_connections.find((row) => row.event_id === body.p_event && row.team_id === body.p_team);
  if (!connection || connection.approved !== true) return { ok: false, error: 'repo_not_approved' };
  if (Number(connection.repo_id) !== Number(body.p_repo_id) || connection.repository !== body.p_repository
    || connection.branch !== body.p_branch) return { ok: false, error: 'repository_changed' };

  const sameKey = (row) => row.event_id === body.p_event && row.team_id === body.p_team
    && Number(row.repo_id) === Number(body.p_repo_id) && row.commit_sha === body.p_commit_sha && row.file_path === 'bot.py';
  const existing = store.github_receipts.find(sameKey);
  if (existing) return { ok: true, created: false, receipt: existing, job: store.repo_sync_jobs.find((row) => row.id === existing.job_id) };

  const since = Date.now() - 24 * 60 * 60 * 1000;
  const used = new Set(
    store.repo_sync_jobs
      .filter((row) => row.event_id === body.p_event && row.team_id === body.p_team && Date.parse(row.created_at) > since)
      .map((row) => row.commit_sha)
  ).size;
  if (used >= Number(body.p_daily_quota ?? 10)) return { ok: false, error: 'quota_exceeded' };

  const previous = store.github_receipts
    .filter((row) => row.event_id === body.p_event && row.team_id === body.p_team && row.status === 'valid')
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
  const now = new Date().toISOString();
  const job = {
    id: randomUUID(), event_id: body.p_event, team_id: body.p_team, repo_id: Number(body.p_repo_id),
    repository: body.p_repository, branch: body.p_branch, file_path: 'bot.py', commit_sha: body.p_commit_sha,
    status: 'queued', attempt: 0, available_at: now, error: null, error_category: null,
    requested_by: body.p_account, created_at: now, updated_at: now,
  };
  const receipt = {
    id: randomUUID(), job_id: job.id, event_id: body.p_event, team_id: body.p_team, repo_id: Number(body.p_repo_id),
    repository: body.p_repository, branch: body.p_branch, file_path: 'bot.py', commit_sha: body.p_commit_sha,
    status: 'resolving', source_hash: null, error: null, error_category: null, submission_id: null,
    previous_valid_submission_id: previous?.id || null, resolved_at: now, created_at: now, updated_at: now,
  };
  store.repo_sync_jobs.push(job);
  store.github_receipts.push(receipt);
  return { ok: true, created: true, receipt, job };
}
/** GitHub giả lập: chỉ metadata repo + commit SHA. */
function githubStub(state) {
  const fetchImpl = async (url) => {
    const target = new URL(String(url));
    state.calls.push(target.pathname);
    if (state.fail === 'rate_limit') return json({ message: 'API rate limit exceeded' }, 403, { 'x-ratelimit-remaining': '0' });
    const repoPath = `/repos/${OWNER}/${NAME}`;
    if (target.pathname === repoPath) {
      return json({ id: state.repoId, full_name: `${OWNER}/${NAME}`, private: false, default_branch: 'main' });
    }
    if (target.pathname === `${repoPath}/commits/${state.branch}`) return json({ sha: state.sha });
    return json({ message: 'Not Found' }, 404);
  };
  fetchImpl.calls = state.calls;
  return fetchImpl;
}

/** Dựng app thật trên loopback; Supabase và GitHub đều giả lập, host lạ bị chặn. */
async function startApp(t, store, githubState = {}) {
  const originalFetch = globalThis.fetch;
  const rest = fakeRest(store);
  const github = githubStub({ repoId: 987654321, sha: SHA, branch: 'main', calls: [], ...githubState });
  globalThis.fetch = (url, options) => {
    const target = String(url);
    if (target.startsWith('http://127.0.0.1:')) return originalFetch(url, options);
    if (target.startsWith('https://api.github.com')) return github(url, options);
    return rest(url, options);
  };
  const app = createApp();
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    globalThis.fetch = originalFetch;
    await new Promise((resolve) => server.close(resolve));
  });
  return { base: `http://127.0.0.1:${server.address().port}`, rest, github };
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

/** Gọi API với session/CSRF; luôn parse JSON (kể cả lỗi) để assert mã lỗi. */
async function call(base, path, { method = 'GET', session, csrf = true, body } = {}) {
  const headers = {};
  if (session) headers.cookie = session.cookie;
  if (session && method !== 'GET' && csrf) headers['x-csrf-token'] = session.csrf;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await globalThis.fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

const REPO_PATH = `/repos/${OWNER}/${NAME}`;
const assertNoSourceDownload = (calls) => {
  for (const path of calls) {
    assert.ok(!path.includes('/contents'), `không được tải nội dung: ${path}`);
    assert.ok(!path.includes('/blobs'), `không được tải blob: ${path}`);
    assert.ok(path === REPO_PATH || path === `${REPO_PATH}/commits/main`, `chỉ metadata: ${path}`);
  }
};

test('đội đăng ký repo nhưng chưa được duyệt thì không nộp được', async (t) => {
  const store = seedStore();
  const { base, github } = await startApp(t, store);
  const session = await login(base, 'delta');

  const put = await call(base, `/api/local/events/${EVENT_ID}/repository`, {
    method: 'PUT', session, body: { repository: REPO_URL, branch: 'main' },
  });
  assert.equal(put.status, 200);
  assert.equal(put.body.connection.approved, false);
  assert.equal(put.body.connection.status, 'pending_approval');
  assert.equal(put.body.connection.repo_id, 987654321, 'phải resolve numeric repo ID');
  assert.equal(put.body.connection.repository, REPO_URL);

  const post = await call(base, `/api/local/events/${EVENT_ID}/submissions/from-github`, { method: 'POST', session, body: {} });
  assert.equal(post.status, 403);
  assert.equal(post.body.error, 'repo_not_approved');
  assert.equal(store.repo_sync_jobs.length, 0, 'chưa duyệt thì không tạo job');
  assert.equal(store.github_receipts.length, 0);
  assertNoSourceDownload(github.calls);
});

test('BTC duyệt repo: intake 202 trả receipt whitelist và chỉ resolve metadata', async (t) => {
  const store = seedStore();
  const { base, github } = await startApp(t, store);
  const team = await login(base, 'delta');
  const admin = await login(base, 'admin');

  await call(base, `/api/local/events/${EVENT_ID}/repository`, { method: 'PUT', session: team, body: { repository: REPO_URL } });
  const approve = await call(base, `/api/local/events/${EVENT_ID}/repository`, {
    method: 'PUT', session: admin, body: { team: TEAM_PARTICIPANT, repository: REPO_URL, branch: 'main' },
  });
  assert.equal(approve.status, 200);
  assert.equal(approve.body.connection.approved, true);
  assert.equal(approve.body.connection.status, 'approved');

  const post = await call(base, `/api/local/events/${EVENT_ID}/submissions/from-github`, { method: 'POST', session: team, body: {} });
  assert.equal(post.status, 202);
  assert.equal(post.body.created, true);
  const { receipt, job } = post.body;

  assert.equal(receipt.event_id, EVENT_ID);
  assert.equal(receipt.team_id, TEAM_PARTICIPANT);
  assert.equal(receipt.repo_id, 987654321);
  assert.equal(receipt.repository, REPO_URL);
  assert.equal(receipt.branch, 'main');
  assert.equal(receipt.commit_sha, SHA);
  assert.equal(receipt.status, 'resolving');
  assert.equal(receipt.source_kind, 'github');
  assert.equal(receipt.file_path, 'bot.py');
  assert.match(receipt.resolved_at, /^\d{4}-\d{2}-\d{2}T/u);
  assert.equal(receipt.error, null);
  assert.equal('storage_path' in receipt, false, 'receipt không lộ storage path');
  assert.equal(job.status, 'queued');
  assert.equal('lease_token' in job, false, 'job view không lộ lease token');

  assert.equal(store.repo_sync_jobs.length, 1);
  assert.equal(store.github_receipts.length, 1);
  assertNoSourceDownload(github.calls);
});




test('cùng SHA: idempotent, không tạo job mới; job cross-team bị 403, admin đọc được', async (t) => {
  const store = seedStore();
  const { base } = await startApp(t, store);
  const team = await login(base, 'delta');
  const other = await login(base, 'echo');
  const admin = await login(base, 'admin');
  await call(base, `/api/local/events/${EVENT_ID}/repository`, {
    method: 'PUT', session: admin, body: { team: TEAM_PARTICIPANT, repository: REPO_URL, branch: 'main' },
  });

  const first = await call(base, `/api/local/events/${EVENT_ID}/submissions/from-github`, { method: 'POST', session: team, body: {} });
  assert.equal(first.status, 202);
  const again = await call(base, `/api/local/events/${EVENT_ID}/submissions/from-github`, { method: 'POST', session: team, body: {} });
  assert.equal(again.status, 202);
  assert.equal(again.body.created, false);
  assert.equal(again.body.receipt.id, first.body.receipt.id);
  assert.equal(store.repo_sync_jobs.length, 1, 'cùng SHA không được tạo job mới');
  assert.equal(store.github_receipts.length, 1);

  const jobId = first.body.job.id;
  const denied = await call(base, `/api/local/repo-sync-jobs/${jobId}`, { session: other });
  assert.equal(denied.status, 403);
  assert.equal(denied.body.error, 'scope_denied');

  const allowed = await call(base, `/api/local/repo-sync-jobs/${jobId}`, { session: admin });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.body.job.id, jobId);
  assert.equal(allowed.body.receipt.id, first.body.receipt.id);
});

test('quota 24 giờ tính theo commit SHA mới', async (t) => {
  const store = seedStore();
  const now = new Date().toISOString();
  store.repo_connections.push({
    id: randomUUID(), event_id: EVENT_ID, team_id: TEAM_PARTICIPANT, repo_id: 987654321, repository: REPO_URL,
    branch: 'main', file_path: 'bot.py', approved: true, approved_by: ADMIN_ID, created_at: now, updated_at: now,
  });
  for (let index = 0; index < 10; index += 1) {
    store.repo_sync_jobs.push({
      id: randomUUID(), event_id: EVENT_ID, team_id: TEAM_PARTICIPANT, repo_id: 987654321, repository: REPO_URL,
      branch: 'main', file_path: 'bot.py', commit_sha: index.toString(16).padStart(40, '0'), status: 'completed',
      attempt: 1, available_at: now, error: null, error_category: null, created_at: now, updated_at: now,
    });
  }
  const { base } = await startApp(t, store);
  const team = await login(base, 'delta');

  const post = await call(base, `/api/local/events/${EVENT_ID}/submissions/from-github`, { method: 'POST', session: team, body: {} });
  assert.equal(post.status, 429);
  assert.equal(post.body.error, 'quota_exceeded');
  assert.equal(store.repo_sync_jobs.length, 10, 'không được thêm job khi hết quota');
});

test('thiếu CSRF, giải đã chạy và route admin-only đều bị chặn', async (t) => {
  const store = seedStore();
  const { base } = await startApp(t, store);
  const team = await login(base, 'delta');

  const noCsrf = await call(base, `/api/local/events/${EVENT_ID}/submissions/from-github`, {
    method: 'POST', session: team, csrf: false, body: {},
  });
  assert.equal(noCsrf.status, 403);
  assert.equal(noCsrf.body.error, 'csrf_required');
  assert.equal(store.repo_sync_jobs.length, 0);

  // Đội không thuộc giải: 403 (không lộ giải có tồn tại hay không).
  const notMember = await call(base, `/api/local/events/${RUNNING_EVENT_ID}/submissions/from-github`, { method: 'POST', session: team, body: {} });
  assert.equal(notMember.status, 403);
  assert.equal(notMember.body.error, 'scope_denied');

  const notMemberRead = await call(base, `/api/local/events/${RUNNING_EVENT_ID}/submissions/from-github`, { session: team });
  assert.equal(notMemberRead.status, 403, 'không đọc được receipt của giải khác');

  // Thành viên nhưng giải đã chạy: 409 event_frozen.
  store.tournaments[0].status = 'group_running';
  const frozen = await call(base, `/api/local/events/${EVENT_ID}/submissions/from-github`, { method: 'POST', session: team, body: {} });
  assert.equal(frozen.status, 409);
  assert.equal(frozen.body.error, 'event_frozen');

  const adminOnly = await call(base, `/api/local/events/${EVENT_ID}/repositories`, { session: team });
  assert.equal(adminOnly.status, 403);
  assert.equal(adminOnly.body.error, 'admin_required');
});

test('GET trạng thái mới nhất: trả connection + receipt, đóng băng khi giải bắt đầu', async (t) => {
  const store = seedStore();
  const { base } = await startApp(t, store);
  const team = await login(base, 'delta');
  const admin = await login(base, 'admin');
  await call(base, `/api/local/events/${EVENT_ID}/repository`, {
    method: 'PUT', session: admin, body: { team: TEAM_PARTICIPANT, repository: REPO_URL, branch: 'main' },
  });
  const post = await call(base, `/api/local/events/${EVENT_ID}/submissions/from-github`, { method: 'POST', session: team, body: {} });
  assert.equal(post.status, 202);

  const latest = await call(base, `/api/local/events/${EVENT_ID}/submissions/from-github`, { session: team });
  assert.equal(latest.status, 200);
  assert.equal(latest.body.event.status, 'draft');
  assert.equal(latest.body.connection.approved, true);
  assert.equal(latest.body.receipt.id, post.body.receipt.id);
  assert.equal(latest.body.receipt.status, 'resolving');

  // Giải bắt đầu => receipt được hiển thị là frozen nhưng vẫn giữ trạng thái nội bộ.
  store.tournaments[0].status = 'group_running';
  const frozenView = await call(base, `/api/local/events/${EVENT_ID}/submissions/from-github`, { session: team });
  assert.equal(frozenView.status, 200);
  assert.equal(frozenView.body.receipt.status, 'frozen');
  assert.equal(frozenView.body.receipt.previous_status, 'resolving');
  assert.match(frozenView.body.receipt.note, /cutoff/u);
});


test('admin thu hồi repo: hủy job chờ, đóng băng receipt, chặn intake và chặn start khi còn pending', async (t) => {
  const store = seedStore();
  const { base } = await startApp(t, store);
  const admin = await login(base, 'admin');
  const team = await login(base, 'delta');

  await call(base, `/api/local/events/${EVENT_ID}/repository`, {
    method: 'PUT', session: admin, body: { team: TEAM_PARTICIPANT, repository: REPO_URL, branch: 'main' },
  });
  const submitted = await call(base, `/api/local/events/${EVENT_ID}/submissions/from-github`, {
    method: 'POST', session: team, body: {},
  });
  assert.equal(submitted.status, 202);

  // Còn job chờ => freeze phải đợi, không start.
  const blockedStart = await call(base, `/api/local/events/${EVENT_ID}/start`, { method: 'POST', session: admin });
  assert.equal(blockedStart.status, 409);
  assert.equal(blockedStart.body.error, 'repo_sync_pending');

  const revoked = await call(base, `/api/local/events/${EVENT_ID}/repository?team=${TEAM_PARTICIPANT}`, {
    method: 'DELETE', session: admin,
  });
  assert.equal(revoked.status, 200);
  assert.equal(revoked.body.connection.approved, false);
  assert.equal(revoked.body.canceled_jobs, 1, 'hủy đúng job đang chờ');
  assert.equal(store.repo_sync_jobs[0].status, 'canceled');
  assert.equal(store.github_receipts[0].status, 'frozen', 'receipt chưa kết thúc bị đóng băng');

  const afterRevoke = await call(base, `/api/local/events/${EVENT_ID}/submissions/from-github`, {
    method: 'POST', session: team, body: {},
  });
  assert.equal(afterRevoke.status, 403);
  assert.equal(afterRevoke.body.error, 'repo_not_approved');

  // Hết job chờ: guard nhường cho logic giải (giải thiếu 8 đội nên 400, không còn 409 pending).
  const afterCancel = await call(base, `/api/local/events/${EVENT_ID}/start`, { method: 'POST', session: admin });
  assert.notEqual(afterCancel.body.error, 'repo_sync_pending');
  assert.ok([400, 409].includes(afterCancel.status));
});
