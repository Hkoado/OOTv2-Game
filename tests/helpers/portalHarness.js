/**
 * portalHarness.js — Harness HTTP tối thiểu cho test API portal (không chạm Supabase thật).
 * `createApp` được import ĐỘNG trong `startPortal()` để test kịp set `process.env`
 * (config đọc env lúc import).
 */

import { once } from 'node:events';
import { randomUUID, scryptSync } from 'node:crypto';

export const PASSWORD = 'mat-khau-kiem-thu-12';
export const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
export const TEAM_PARTICIPANT = '44444444-4444-4444-8444-444444444444';
export const TEAM_ACCOUNT = '22222222-2222-4222-8222-222222222222';
export const EVENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const encode = (password) => {
  const salt = 'a'.repeat(32);
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
};

export function seedStore() {
  const now = new Date().toISOString();
  return {
    participants: [{ id: TEAM_PARTICIPANT, name: 'Đội Upload', name_key: 'đội upload', created_at: now }],
    accounts: [
      { id: ADMIN_ID, username: 'admin', password_hash: encode(PASSWORD), role: 'admin', participant_id: null, members: '', contact: '', repository: '', branch: 'main', created_at: now },
      { id: TEAM_ACCOUNT, username: 'upload', password_hash: encode(PASSWORD), role: 'team', participant_id: TEAM_PARTICIPANT, members: '', contact: '', repository: '', branch: 'main', created_at: now },
    ],
    sessions: [],
    submissions: [],
    tournaments: [{ id: EVENT, name: 'Giải nhận bài', status: 'draft', seed: 3, created_at: now }],
    tournament_entries: [{ id: '66666666-6666-4666-8666-666666666666', tournament_id: EVENT, participant_id: TEAM_PARTICIPANT, seed_order: 1 }],
    official_setups: [],
    repo_connections: [],
    repo_sync_jobs: [],
    github_receipts: [],
    match_events: [],
    match_bot_output: [],
    worker_state: [],
  };
}

export const json = (data, status = 200) =>
  new Response(data === null ? null : JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });


/** PostgREST + Storage giả lập: đủ cho auth, upload, intake trong test. */
export function fakeBackend(store) {
  const matchRow = (row, key, raw) => {
    const [op, ...rest] = String(raw).split('.');
    const value = rest.join('.');
    if (op === 'not') return !matchRow(row, key, value);
    if (op === 'eq') return String(row[key]) === value;
    if (op === 'gt') return Number(row[key]) > Number(value);
    if (op === 'lte') return Number(row[key]) <= Number(value);
    if (op === 'in') return value.replace(/^\(|\)$/gu, '').split(',').includes(String(row[key]));
    if (op === 'is') return value === 'null' ? row[key] === null : String(row[key]) === value;
    return true;
  };
  return async (url, options = {}) => {
    const target = new URL(String(url));
    if (target.origin !== 'https://example.invalid') throw new Error(`Test không được gọi host lạ: ${target.origin}`);
    // Storage private: POST lưu bytes, GET trả lại đúng bytes (storeVerifiedSource kiểm round-trip).
    if (target.pathname.startsWith('/storage/v1/object/')) {
      const key = target.pathname.split('/').pop();
      const objects = store.__storage || (store.__storage = new Map());
      const method = (options.method || 'GET').toUpperCase();
      if (method === 'POST') {
        const body = Buffer.isBuffer(options.body) ? options.body : Buffer.from(String(options.body || ''));
        objects.set(key, body);
        return json({ Key: `ootv2-bots/${key}` });
      }
      const stored = objects.get(key);
      if (!stored) return new Response('not found', { status: 404 });
      return new Response(stored, { status: 200, headers: { 'content-length': String(stored.length) } });
    }
    // RPC: test cung cấp handler mô phỏng transaction SQL (xem tests/helpers/manualFinalFake.js).
    if (target.pathname.startsWith('/rest/v1/rpc/')) {
      const name = target.pathname.slice('/rest/v1/rpc/'.length);
      const handler = store.__rpc?.[name];
      if (!handler) throw new Error(`RPC chưa được mock trong test: ${name}`);
      const payload = options.body ? JSON.parse(String(options.body)) : {};
      return json(await handler(payload, store));
    }
    const table = target.pathname.replace('/rest/v1/mvp_', '').replace('/rest/v1/', '');
    const method = (options.method || 'GET').toUpperCase();
    const params = [...target.searchParams];
    const rowsInTable = store[table] || (store[table] = []);
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
        // Postgres defaults: uuid PK + identity cho bảng audit (fake không có DEFAULT).
        if (saved.id === undefined && table !== 'manual_final_audit') saved.id = randomUUID();
        if (saved.id === undefined) saved.id = rowsInTable.length + 1;
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

export async function startPortal(t, store) {
  const originalFetch = globalThis.fetch;
  const backend = fakeBackend(store);
  globalThis.fetch = (url, options) => {
    const target = String(url);
    if (target.startsWith('http://127.0.0.1:')) return originalFetch(url, options);
    return backend(url, options);
  };
  const { createApp } = await import('../../server/app.js');
  const app = createApp();
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    globalThis.fetch = originalFetch;
    await new Promise((resolve) => server.close(resolve));
  });
  return { base: `http://127.0.0.1:${server.address().port}` };
}


export async function login(base, username) {
  const response = await globalThis.fetch(`${base}/api/local/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: PASSWORD }),
  });
  const body = await response.json();
  const setCookie = response.headers.getSetCookie ? response.headers.getSetCookie().join(';') : response.headers.get('set-cookie') || '';
  return { cookie: setCookie.split(';')[0], csrf: body.csrf };
}

/** Gửi multipart `file` = bot.py tối thiểu. */
export async function uploadBot(base, { teamId, session, source = 'print("ok")\n' }) {
  const form = new FormData();
  form.append('file', new Blob([Buffer.from(source, 'utf8')], { type: 'text/x-python' }), 'bot.py');
  const response = await globalThis.fetch(`${base}/api/local/submissions/${teamId}`, {
    method: 'POST',
    headers: { cookie: session?.cookie || '', 'x-csrf-token': session?.csrf || '' },
    body: form,
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}
