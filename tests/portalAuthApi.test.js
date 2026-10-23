/**
 * portalAuthApi.test.js — Hồi quy HTTP cho auth/session/CSRF/phân quyền của M1.
 *
 * Mục tiêu bảo vệ (đã có trong code, nay có test):
 * - Login chỉ trả whitelist account, cookie HttpOnly + SameSite=Strict, không lộ hash.
 * - Thiếu/sai session → 401; thiếu/sai CSRF, origin lạ → 403 và không ghi DB.
 * - Team không vào route admin, không nộp bài thay đội khác.
 * - Profile chỉ nhận repository GitHub HTTPS không token (chặn SSRF).
 *
 * Toàn bộ Supabase được giả lập ở lớp `fetch`; test KHÔNG gọi DB thật.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { scryptSync } from 'node:crypto';

process.env.SUPABASE_URL = 'https://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only';

const { createApp } = await import('../server/app.js');

const PASSWORD = 'mat-khau-kiem-thu-12';
const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const TEAM_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_TEAM_ID = '33333333-3333-4333-8333-333333333333';
const TEAM_PARTICIPANT = '44444444-4444-4444-8444-444444444444';
const OTHER_PARTICIPANT = '55555555-5555-4555-8555-555555555555';

const json = (data, status = 200) =>
  new Response(data === null ? null : JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });

/** Hash theo đúng định dạng `accounts.js`: `<salt>:<scrypt hex 64 bytes>`. */
function encode(password) {
  const salt = 'a'.repeat(32);
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}

function seedStore() {
  return {
    participants: [
      { id: TEAM_PARTICIPANT, name: 'Đội Một', name_key: 'đội một', created_at: '2026-10-20T00:00:00.000Z' },
      { id: OTHER_PARTICIPANT, name: 'Đội Hai', name_key: 'đội hai', created_at: '2026-10-20T00:00:01.000Z' },
    ],
    accounts: [
      {
        id: ADMIN_ID, username: 'admin', password_hash: encode(PASSWORD), role: 'admin',
        participant_id: null, members: '', contact: '', repository: '', branch: 'main',
        created_at: '2026-10-20T00:00:00.000Z',
      },
      {
        id: TEAM_ID, username: 'doi1', password_hash: encode(PASSWORD), role: 'team',
        participant_id: TEAM_PARTICIPANT, members: '', contact: '', repository: '', branch: 'main',
        created_at: '2026-10-20T00:00:01.000Z',
      },
      {
        id: OTHER_TEAM_ID, username: 'doi2', password_hash: encode(PASSWORD), role: 'team',
        participant_id: OTHER_PARTICIPANT, members: '', contact: '', repository: '', branch: 'main',
        created_at: '2026-10-20T00:00:02.000Z',
      },
    ],
    sessions: [],
    submissions: [],
    tournaments: [],
    tournament_entries: [],
  };
}


/**
 * PostgREST giả lập tối thiểu cho các truy vấn mà `shared/client.js` phát ra.
 * Mọi request ra khỏi `https://example.invalid` đều bị chặn để test không thể
 * vô tình chạm Supabase thật cấu hình trong `.env`.
 */
function fakeRest(store) {
  const calls = [];
  const matches = (row, key, raw) => {
    const [op, ...rest] = String(raw).split('.');
    const value = rest.join('.');
    if (op === 'eq') return String(row[key]) === value;
    if (op === 'gt') return Number(row[key]) > Number(value);
    if (op === 'gte') return Number(row[key]) >= Number(value);
    if (op === 'lte') return Number(row[key]) <= Number(value);
    if (op === 'lt') return String(row[key]) < value;
    if (op === 'is') return value === 'null' ? row[key] === null : String(row[key]) === value;
    if (op === 'in') {
      const list = value.replace(/^\(|\)$/gu, '').split(',');
      return list.includes(String(row[key]));
    }
    return true;
  };
  const handler = async (url, options = {}) => {
    const target = new URL(String(url));
    if (target.origin !== 'https://example.invalid') {
      throw new Error(`Test không được gọi Supabase thật: ${target.origin}`);
    }
    const table = target.pathname.replace('/rest/v1/mvp_', '').replace('/rest/v1/', '');
    const method = (options.method || 'GET').toUpperCase();
    const params = [...target.searchParams];
    calls.push({ method, table, params: Object.fromEntries(params) });
    const tableRows = store[table] || (store[table] = []);
    const filterParams = params.filter(([key]) => !['select', 'order', 'limit', 'offset'].includes(key));
    const selected = () => tableRows.filter((row) => filterParams.every(([key, raw]) => matches(row, key, raw)));

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
      const updated = selected().map((row) => Object.assign(row, body));
      return json(updated);
    }

    if (method === 'DELETE') {
      const removed = new Set(selected());
      store[table] = tableRows.filter((row) => !removed.has(row));
      return new Response(null, { status: 204 });
    }

    throw new Error(`Phương thức chưa hỗ trợ trong test: ${method}`);
  };
  handler.calls = calls;
  return handler;
}

/** Dựng app + HTTP server thật trên loopback, không bind public. */
async function startApp(t, store) {
  const originalFetch = globalThis.fetch;
  const rest = fakeRest(store);
  // Chỉ chặn host Supabase; request HTTP tới server test (loopback) vẫn dùng fetch thật.
  // Mọi origin khác đều rơi vào `fakeRest` và bị ném lỗi → không thể chạm DB thật.
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
  const setCookie = response.headers.getSetCookie
    ? response.headers.getSetCookie().join(';')
    : response.headers.get('set-cookie') || '';
  return { response, body, cookie: setCookie.split(';')[0], setCookie };
}


test('login: whitelist account, cookie HttpOnly/SameSite=Strict, không lộ password_hash', async (t) => {
  const store = seedStore();
  const { base, rest } = await startApp(t, store);
  const { response, body, cookie, setCookie } = await login(base, 'doi1');

  assert.equal(response.status, 200);
  assert.equal(body.account.username, 'doi1');
  assert.equal(body.account.role, 'team');
  assert.equal(body.account.name, 'Đội Một');
  assert.match(body.csrf, /^[a-f0-9]{64}$/u);
  assert.ok(!JSON.stringify(body).includes('password_hash'), 'không được trả hash mật khẩu');
  assert.ok(!JSON.stringify(body).includes('salt'), 'không được trả salt');
  assert.match(setCookie, /HttpOnly/iu);
  assert.match(setCookie, /SameSite=Strict/iu);
  assert.match(setCookie, /Path=\/api\/local/iu);
  assert.ok(!/Secure/iu.test(setCookie), 'HTTP loopback không được đặt Secure');

  // Session lưu dạng hash, không lưu token thô.
  assert.equal(store.sessions.length, 1);
  assert.notEqual(store.sessions[0].token_hash, cookie.split('=')[1]);
  assert.equal(store.sessions[0].token_hash.length, 64);
  assert.ok(rest.calls.length > 0, 'phải đi qua PostgREST giả lập');
});

test('session: thiếu cookie, token sai và sau logout đều bị 401', async (t) => {
  const store = seedStore();
  const { base } = await startApp(t, store);

  const anonymous = await globalThis.fetch(`${base}/api/local/me`);
  assert.equal(anonymous.status, 401);
  assert.equal((await anonymous.json()).error, 'login_required');

  const invalid = await globalThis.fetch(`${base}/api/local/me`, {
    headers: { cookie: `oot_local_session=${'f'.repeat(64)}` },
  });
  assert.equal(invalid.status, 401);

  const { body, cookie } = await login(base, 'doi1');
  const me = await globalThis.fetch(`${base}/api/local/me`, { headers: { cookie } });
  assert.equal(me.status, 200);
  assert.equal((await me.json()).csrf, body.csrf);

  const logout = await globalThis.fetch(`${base}/api/local/logout`, {
    method: 'POST',
    headers: { cookie, 'x-csrf-token': body.csrf },
  });
  assert.equal(logout.status, 200);
  assert.equal(store.sessions.length, 0);

  const after = await globalThis.fetch(`${base}/api/local/me`, { headers: { cookie } });
  assert.equal(after.status, 401);
});

test('CSRF và origin: thiếu/sai token hoặc origin lạ bị 403, không ghi DB', async (t) => {
  const store = seedStore();
  const { base } = await startApp(t, store);
  const { body, cookie } = await login(base, 'doi1');
  const before = JSON.stringify(store.accounts);
  const profile = { members: 'A, B', contact: '', repository: '', branch: 'main' };

  const noToken = await globalThis.fetch(`${base}/api/local/profile`, {
    method: 'PUT',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify(profile),
  });
  assert.equal(noToken.status, 403);
  assert.equal((await noToken.json()).error, 'csrf_required');

  const wrongToken = await globalThis.fetch(`${base}/api/local/profile`, {
    method: 'PUT',
    headers: { cookie, 'content-type': 'application/json', 'x-csrf-token': '0'.repeat(64) },
    body: JSON.stringify(profile),
  });
  assert.equal(wrongToken.status, 403);
  assert.equal((await wrongToken.json()).error, 'csrf_required');

  const foreignOrigin = await globalThis.fetch(`${base}/api/local/profile`, {
    method: 'PUT',
    headers: {
      cookie, 'content-type': 'application/json', 'x-csrf-token': body.csrf,
      origin: 'https://evil.example',
    },
    body: JSON.stringify(profile),
  });
  assert.equal(foreignOrigin.status, 403);
  assert.equal((await foreignOrigin.json()).error, 'scope_denied');

  assert.equal(JSON.stringify(store.accounts), before, 'request bị chặn không được ghi DB');
});

test('phân quyền: team bị chặn route admin và không nộp bài thay đội khác', async (t) => {
  const store = seedStore();
  const { base } = await startApp(t, store);
  const team = await login(base, 'doi1');
  const admin = await login(base, 'admin');

  const teamTeams = await globalThis.fetch(`${base}/api/local/teams`, { headers: { cookie: team.cookie } });
  assert.equal(teamTeams.status, 403);
  assert.equal((await teamTeams.json()).error, 'admin_required');

  const adminTeams = await globalThis.fetch(`${base}/api/local/teams`, { headers: { cookie: admin.cookie } });
  assert.equal(adminTeams.status, 200);
  const listed = await adminTeams.json();
  assert.equal(listed.participants.length, 2);
  assert.ok(listed.accounts.every((account) => !('password_hash' in account)), 'admin cũng không thấy hash');

  // H2: upload HTTP đã tắt mặc định → mọi request upload (kể cả đội khác) trả upload_disabled.
  // Multer/quyền sở hữu khi BTC opt-in được kiểm ở tests/uploadTrustedDev.test.js.
  for (const participant of [OTHER_PARTICIPANT, TEAM_PARTICIPANT]) {
    const upload = await globalThis.fetch(`${base}/api/local/submissions/${participant}`, {
      method: 'POST',
      headers: { cookie: team.cookie, 'x-csrf-token': team.body.csrf },
    });
    assert.equal(upload.status, 403);
    assert.equal((await upload.json()).error, 'upload_disabled');
  }
});

test('profile: chỉ nhận repository GitHub HTTPS không token, không SSRF', async (t) => {
  const store = seedStore();
  const { base } = await startApp(t, store);
  const { body, cookie } = await login(base, 'doi1');
  const headers = { cookie, 'content-type': 'application/json', 'x-csrf-token': body.csrf };
  const put = (repository) =>
    globalThis.fetch(`${base}/api/local/profile`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ members: '', contact: '', repository, branch: 'main' }),
    });

  for (const repository of [
    'http://github.com/doi1/bot',
    'https://gitlab.com/doi1/bot',
    'https://user:token@github.com/doi1/bot',
    'https://github.com/doi1/bot/tree/main',
    'https://github.com.evil.example/doi1/bot',
  ]) {
    const rejected = await put(repository);
    assert.equal(rejected.status, 400, `phải từ chối ${repository}`);
    assert.equal((await rejected.json()).error, 'bad_repository');
  }

  const branch = await globalThis.fetch(`${base}/api/local/profile`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ members: '', contact: '', repository: '', branch: 'main branch' }),
  });
  assert.equal(branch.status, 400);
  assert.equal((await branch.json()).error, 'bad_branch');

  const accepted = await put('https://github.com/doi1/bot');
  assert.equal(accepted.status, 200);
  const { account } = await accepted.json();
  assert.equal(account.repository, 'https://github.com/doi1/bot');
  assert.equal(account.branch, 'main');
  assert.ok(!('password_hash' in account));
  assert.equal(store.accounts.find((row) => row.username === 'doi1').repository, 'https://github.com/doi1/bot');
});




test('login remember: phiên 30 ngày + cookie Max-Age dài; mặc định 8 giờ', async (t) => {
  const store = seedStore();
  const { base } = await startApp(t, store);

  const signIn = async (remember) => {
    const response = await globalThis.fetch(`${base}/api/local/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'doi1', password: PASSWORD, remember }),
    });
    const body = await response.json();
    const setCookie = response.headers.getSetCookie
      ? response.headers.getSetCookie().join(';')
      : response.headers.get('set-cookie') || '';
    return { body, setCookie };
  };

  const remembered = await signIn(true);
  assert.equal(remembered.body.remember, true);
  assert.match(remembered.body.session_expires_at, /^\d{4}-\d{2}-\d{2}T/u);
  assert.match(remembered.setCookie, /Max-Age=2592000/u, 'cookie nhớ tài khoản phải 30 ngày');
  const longLived = store.sessions.find((session) => session.expires_at > Date.now() + 20 * 24 * 60 * 60 * 1000);
  assert.ok(longLived, 'session DB phải hạn ~30 ngày');

  store.sessions.length = 0;
  const normal = await signIn(false);
  assert.equal(normal.body.remember, false);
  assert.match(normal.setCookie, /Max-Age=28800/u, 'mặc định vẫn 8 giờ');
  assert.ok(store.sessions[0].expires_at <= Date.now() + 8 * 60 * 60 * 1000 + 5000);
});
