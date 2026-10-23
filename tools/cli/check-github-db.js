/**
 * check-github-db.js — Kiểm tra nhanh migration GitHub/H3 đã áp dụng trên Supabase thật.
 *
 * Read-only: chỉ GET bảng và gọi RPC với UUID "không tồn tại" (trả lỗi domain, không ghi dữ liệu).
 * Không in URL/key; chỉ in HTTP status + mã lỗi để biết migration nào còn thiếu.
 * Chạy: `node tools/cli/check-github-db.js`.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');

function loadEnv() {
  try {
    const raw = readFileSync(path.join(root, '.env'), 'utf8');
    const env = {};
    for (const line of raw.split(/\r?\n/u)) {
      const match = /^([A-Za-z0-9_]+)=(.*)$/u.exec(line.trim());
      if (match) env[match[1]] = match[2].replace(/^["']|["']$/gu, '');
    }
    return { ...env, ...process.env };
  } catch {
    return process.env;
  }
}

const env = loadEnv();
const url = env.SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Thiếu SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY trong .env');
  process.exit(1);
}

const headers = { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' };

async function probe(label, pathname, options = {}) {
  try {
    const response = await fetch(`${url}${pathname}`, { ...options, headers: { ...headers, ...(options.headers || {}) } });
    let body = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    const code = body?.code || body?.error || '';
    const hint = body?.message ? String(body.message).slice(0, 80) : typeof body === 'object' ? JSON.stringify(body).slice(0, 80) : '';
    console.log(`${label}: HTTP ${response.status}${code ? ` ${code}` : ''}${hint ? ` — ${hint}` : ''}`);
    return { status: response.status, body };
  } catch (error) {
    console.log(`${label}: NETWORK ${error.message}`);
    return { status: 0, body: null };
  }
}

const ZERO = '00000000-0000-4000-8000-000000000000';

console.log('== Bảng dữ liệu (mong đợi 200 rỗng nếu đã apply) ==');
for (const table of ['mvp_repo_connections', 'mvp_repo_sync_jobs', 'mvp_github_receipts', 'mvp_match_broadcasts']) {
  await probe(table, `/rest/v1/${table}?select=*&limit=1`);
}

console.log('\n== Baseline migration cũ (phải 200 trước khi apply migration mới) ==');
for (const table of ['mvp_tournaments', 'mvp_submissions', 'mvp_match_events', 'mvp_match_bot_output', 'mvp_worker_state', 'mvp_match_logs', 'mvp_official_setups', 'maps', 'round_maps', 'games']) {
  await probe(table, `/rest/v1/${table}?select=*&limit=1`);
}

console.log('\n== RPC (mong đợi lỗi domain, KHÔNG phải PGRST202 "Could not find") ==');
await probe('mvp_github_intake', '/rest/v1/rpc/mvp_github_intake', {
  method: 'POST',
  body: JSON.stringify({
    p_event: ZERO, p_team: ZERO, p_account: null,
    p_repository: 'https://github.com/a/b', p_branch: 'main', p_file_path: 'bot.py',
    p_repo_id: 1, p_commit_sha: 'a'.repeat(40), p_daily_quota: 10,
  }),
});
await probe('mvp_github_claim', '/rest/v1/rpc/mvp_github_claim', {
  method: 'POST',
  body: JSON.stringify({ p_worker: 'probe-only', p_lease_seconds: 1 }),
});
await probe('mvp_repo_connection_revoke', '/rest/v1/rpc/mvp_repo_connection_revoke', {
  method: 'POST',
  body: JSON.stringify({ p_event: ZERO, p_team: ZERO, p_actor: ZERO }),
});

console.log('\nGhi chú: PGRST202 = chưa có function (migration chưa apply).');
console.log('Domain error (vd bỏ_lease/event_not_found/bad_lease) = function đã tồn tại.');
