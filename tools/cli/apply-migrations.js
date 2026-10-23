/**
 * apply-migrations.js — Áp migration Supabase theo thứ tự, có kiểm tra "đã apply" để skip.
 *
 * Cần MỘT trong hai kênh DDL (PostgREST không chạy được DDL):
 *   1) SUPABASE_ACCESS_TOKEN  → Supabase Management API `POST /v1/projects/<ref>/database/query`
 *   2) SUPABASE_DB_URL + psql → chạy `psql --single-transaction -f -`
 *
 * An toàn:
 * - Mặc định dry-run; phải thêm `--apply` mới ghi DB.
 * - Mỗi migration chạy trong MỘT transaction; file lỗi thì dừng, không chạy tiếp.
 * - Kiểm tra object đại diện trước khi apply: đã có → skip (an toàn khi chạy lại).
 * - Preflight baseline `mvp_tournaments`, `mvp_submissions`, `maps` để tránh nhầm project.
 *
 * Chạy:
 *   node tools/cli/apply-migrations.js                 # xem kế hoạch
 *   node tools/cli/apply-migrations.js --apply         # apply các file còn thiếu
 *   node tools/cli/apply-migrations.js --apply --only=20261024130000
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
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
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const onlyArg = args.find((value) => value.startsWith('--only='));
const only = onlyArg ? new Set(onlyArg.slice('--only='.length).split(',').map((v) => v.trim()).filter(Boolean)) : null;

const url = env.SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
const accessToken = env.SUPABASE_ACCESS_TOKEN;
const dbUrl = env.SUPABASE_DB_URL || env.DATABASE_URL;
const projectRef = env.SUPABASE_PROJECT_REF || (url ? (/^https:\/\/([a-z0-9]+)\.supabase\.co$/u.exec(url)?.[1] ?? null) : null);

if (!url || !serviceKey) {
  console.error('Thiếu SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY trong .env');
  process.exit(1);
}

const restHeaders = { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, 'content-type': 'application/json' };

async function restGet(pathname) {
  const response = await fetch(`${url}${pathname}`, { headers: restHeaders });
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status, body };
}

async function restRpc(name, payload) {
  const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: restHeaders,
    body: JSON.stringify(payload),
  });
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status, body };
}


/** Object đại diện của mỗi migration: đã tồn tại thì coi như đã apply. */
const PLAN = [
  {
    version: '20261022150000',
    file: 'supabase/migrations/20261022150000_judge_monitor.sql',
    why: 'mvp_match_logs (quan sát chấm bài)',
    exists: async () => (await restGet('/rest/v1/mvp_match_logs?select=*&limit=1')).status === 200,
  },
  {
    version: '20261023120000',
    file: 'supabase/migrations/20261023120000_live_stream.sql',
    why: 'mvp_match_events/bot_output/worker_state (live)',
    exists: async () => (await restGet('/rest/v1/mvp_match_events?select=*&limit=1')).status === 200,
  },
  {
    version: '20261023160000',
    file: 'supabase/migrations/20261023160000_official_setup.sql',
    why: 'mvp_official_setups + seed_order 1..56',
    exists: async () => (await restGet('/rest/v1/mvp_official_setups?select=*&limit=1')).status === 200,
  },
  {
    version: '20261024130000',
    file: 'supabase/migrations/20261024130000_github_intake.sql',
    why: 'repo approval + job/receipt + mvp_github_intake',
    exists: async () => (await restGet('/rest/v1/mvp_repo_sync_jobs?select=*&limit=1')).status === 200,
  },
  {
    version: '20261024150000',
    file: 'supabase/migrations/20261024150000_broadcast_schedule.sql',
    why: 'mvp_match_broadcasts (H3)',
    exists: async () => (await restGet('/rest/v1/mvp_match_broadcasts?select=*&limit=1')).status === 200,
  },
  {
    version: '20261024160000',
    file: 'supabase/migrations/20261024160000_github_jobs_worker.sql',
    why: 'generation + claim/heartbeat/progress/finish/release',
    exists: async () => {
      // bad_lease được kiểm trước khi chạm DB -> không claim job thật.
      const result = await restRpc('mvp_github_claim', { p_worker: 'probe-only', p_lease_seconds: 1 });
      return !(result.status === 404 && result.body?.code === 'PGRST202');
    },
  },
  {
    version: '20261024170000',
    file: 'supabase/migrations/20261024170000_github_jobs_hardening.sql',
    why: 'lease expiry, finish envelope, reclaim cap, revoke',
    exists: async () => {
      const ZERO = '00000000-0000-4000-8000-000000000000';
      const result = await restRpc('mvp_repo_connection_revoke', { p_event: ZERO, p_team: ZERO, p_actor: ZERO });
      return !(result.status === 404 && result.body?.code === 'PGRST202');
    },
  },
];

const readSql = (relative) => readFileSync(path.join(root, relative), 'utf8');

async function runManagementSql(sql) {
  if (!accessToken || !projectRef) throw new Error('missing_access_token_or_ref');
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`management_api_${response.status}: ${detail.slice(0, 300)}`);
  }
  return response.text();
}

function runPsqlSql(sql) {
  const result = spawnSync('psql', [dbUrl, '-v', 'ON_ERROR_STOP=1', '--single-transaction', '-q', '-X', '-f', '-'], {
    input: sql,
    encoding: 'utf8',
    shell: false,
  });
  if (result.error) throw new Error(`psql_spawn: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`psql_exit_${result.status}: ${(result.stderr || '').slice(0, 300)}`);
  return result.stdout;
}

function pickTransport() {
  if (accessToken && projectRef) return { name: 'management-api', run: runManagementSql };
  if (dbUrl) {
    const probe = spawnSync('psql', ['--version'], { encoding: 'utf8', shell: false });
    if (probe.status === 0) return { name: 'psql', run: runPsqlSql };
  }
  return null;
}

async function preflight() {
  const missing = [];
  for (const table of ['mvp_tournaments', 'mvp_submissions', 'maps']) {
    if ((await restGet(`/rest/v1/${table}?select=*&limit=1`)).status !== 200) missing.push(table);
  }
  return missing;
}


async function main() {
  console.log(`Supabase: ${url}`);
  const channel = accessToken && projectRef ? 'Management API' : dbUrl ? 'psql (SUPABASE_DB_URL)' : 'CHƯA CÓ';
  console.log(`Kênh DDL: ${channel}`);
  console.log(`Chế độ: ${apply ? 'APPLY' : 'dry-run (thêm --apply để ghi DB)'}\n`);

  const missingBaseline = await preflight();
  if (missingBaseline.length) {
    console.error(`Dừng: baseline thiếu ${missingBaseline.join(', ')} — kiểm tra project/URL trước khi apply.`);
    process.exit(1);
  }

  const pending = [];
  for (const item of PLAN) {
    if (only && !only.has(item.version)) continue;
    const already = await item.exists();
    console.log(`${already ? 'SKIP ' : 'APPLY'} ${item.version}  ${item.why}`);
    if (!already) pending.push(item);
  }

  if (!pending.length) {
    console.log('\nTất cả migration trong kế hoạch đã áp dụng.');
    return;
  }
  if (!apply) {
    console.log(`\nDry-run: ${pending.length} migration cần apply. Chạy lại với --apply.`);
    return;
  }

  const transport = pickTransport();
  if (!transport) {
    console.error(
      '\nKhông có kênh DDL. Thêm MỘT trong hai vào .env rồi chạy lại:\n' +
        '  SUPABASE_ACCESS_TOKEN=sbp_...   (Personal Access Token, Management API)\n' +
        '  SUPABASE_DB_URL=postgresql://postgres.<ref>:<password>@<host>:5432/postgres   (cần psql)\n'
    );
    process.exit(2);
  }
  console.log(`\nDùng kênh: ${transport.name}`);
  for (const item of pending) {
    console.log(`\n→ apply ${item.version} (${item.file})`);
    try {
      await transport.run(readSql(item.file));
    } catch (error) {
      console.error(`LỖI ${item.version}: ${error.message}`);
      console.error('Đã dừng; migration sau KHÔNG chạy. Kiểm tra rồi chạy lại (file đã apply sẽ được skip).');
      process.exit(3);
    }
    const ok = await item.exists();
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${item.version}${ok ? '' : ' — object đại diện chưa thấy (PostgREST schema cache?)'}`);
    if (!ok) process.exit(4);
  }
  console.log('\nHoàn tất: các migration còn thiếu đã apply và kiểm tra lại.');
  console.log('Bước tiếp: node tools/cli/check-github-db.js');
}

await main();
