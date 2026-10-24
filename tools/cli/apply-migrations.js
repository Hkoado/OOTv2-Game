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
import { createHash } from 'node:crypto';
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
const smoke = args.includes('--smoke');
/** Dự án chính thức mới chỉ có foundation: cho phép apply các migration tạo bảng runtime. */
const bootstrap = args.includes('--bootstrap');
/** Ghi lịch sử version/name/checksum vào `public.ootv2_schema_migrations` (kể cả bản đã apply trước đó). */
const recordHistory = args.includes('--record-history');
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
    version: '20261022125205',
    file: 'supabase/migrations/20261022125205_shared_mvp_runtime_tables.sql',
    why: 'bảng runtime MVP shared (participants/submissions/tournaments/matches/accounts/sessions)',
    exists: async () => (await restGet('/rest/v1/mvp_participants?select=*&limit=1')).status === 200,
  },
  {
    version: '20261022125322',
    file: 'supabase/migrations/20261022125322_shared_mvp_runtime_functions.sql',
    why: 'RPC MVP shared (account/draft/claim/finish/release/import)',
    exists: async () => {
      const result = await restRpc('mvp_account_create', { p_account: {}, p_participant: null });
      return !(result.status === 404 && result.body?.code === 'PGRST202');
    },
  },
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
    version: '20261024120000',
    file: 'supabase/migrations/20261024120000_mvp_match_map_snapshot.sql',
    why: 'mvp_matches.map_json/map_hash + mvp_stage_commit nhận snapshots',
    exists: async () => (await restGet('/rest/v1/mvp_matches?select=map_hash&limit=1')).status === 200,
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
  {
    version: '20261024180000',
    file: 'supabase/migrations/20261024180000_lock_published_maps.sql',
    why: 'trigger mvp_lock_published_maps (khóa map đã publish)',
    exists: async () => {
      // Trigger function không lộ qua PostgREST; chỉ Management API đọc được pg_proc.
      if (!accessToken || !projectRef) return false;
      try {
        const found = await managementRows(
          "select count(*)::int as c from pg_proc where proname = 'mvp_lock_published_maps'"
        );
        return Number(found?.[0]?.c || 0) > 0;
      } catch {
        return false;
      }
    },
  },
  {
    version: '20261025090000',
    file: 'supabase/migrations/20261025090000_official_schedule.sql',
    why: 'mvp_official_rounds/games + 4 RPC mvp_official_*',
    exists: async () => (await restGet('/rest/v1/mvp_official_rounds?select=*&limit=1')).status === 200,
  },
];

PLAN.push({
  version: '20261025100000',
  file: 'supabase/migrations/20261025100000_cutoff_capture.sql',
  why: 'authoritative cutoff capture + fenced atomic pin',
  exists: async () => (await restGet('/rest/v1/mvp_cutoff_captures?select=*&limit=1')).status === 200,
});

PLAN.push({
  version: '20261026090000',
  file: 'supabase/migrations/20261026090000_official_worker_jobs.sql',
  why: 'K3 official jobs queue + lease/generation fencing + attempts audit',
  exists: async () => (await restGet('/rest/v1/mvp_official_jobs?select=*&limit=1')).status === 200,
});

PLAN.push({
  version: '20261026100000',
  file: 'supabase/migrations/20261026100000_manual_final.sql',
  why: 'Chung kết thủ công: 6 bảng + 7 RPC mvp_manual_final_*',
  exists: async () => (await restGet('/rest/v1/mvp_manual_final_events?select=*&limit=1')).status === 200,
});

PLAN.push({
  version: '20261026110000',
  file: 'supabase/migrations/20261026110000_official_grants_hardening.sql',
  why: 'Huy review: service_role chỉ SELECT trên official jobs/rounds/games (ghi qua RPC fence)',
  exists: async () => {
    // Quyền bảng không lộ qua PostgREST; đọc bằng Management API.
    if (!accessToken || !projectRef) return false;
    try {
      const found = await managementRows(
        "select has_table_privilege('service_role','public.mvp_official_jobs','UPDATE') as upd,"
        + " has_table_privilege('service_role','public.mvp_official_games','UPDATE') as games_upd"
      );
      return found?.[0]?.upd === false && found?.[0]?.games_upd === false;
    } catch {
      return false;
    }
  },
});


PLAN.push({
  version: '20261026120000',
  file: 'supabase/migrations/20261026120000_ko_round_roster_guard.sql',
  why: 'Huy review: cho phép round knockout pin 2 đội sau cutoff (giữ mọi kiểm provenance)',
  exists: async () => {
    // Không lộ qua PostgREST; đọc thân function bằng Management API (nếu có token).
    if (!accessToken || !projectRef) return false;
    try {
      const found = await managementRows(
        "select (prosrc like '%new.round_id = ''group''%') as patched from pg_proc"
        + " where proname='mvp_cutoff_verify_round'"
      );
      return found?.[0]?.patched === true;
    } catch {
      return false;
    }
  },
});


PLAN.push({
  version: '20261026130000',
  file: 'supabase/migrations/20261026130000_manual_worker_heartbeat.sql',
  why: 'Khoa review: heartbeat manual + fencing lease hết hạn + 0-ply result (additive)',
  exists: async () => {
    // RPC heartbeat: PGRST202 = chưa có function.
    const result = await restRpc('mvp_manual_final_heartbeat',
      { p_job: '00000000-0000-4000-8000-000000000000', p_token: '00000000-0000-4000-8000-000000000000',
        p_generation: 0 });
    return !(result.status === 404 && result.body?.code === 'PGRST202');
  },
});


PLAN.push({
  version: '20261026140000',
  file: 'supabase/migrations/20261026140000_official_broadcast.sql',
  why: 'Huy: publication cho ván official (lịch phát + viewer theo ply đã phát)',
  exists: async () => (await restGet('/rest/v1/mvp_official_broadcasts?select=*&limit=1')).status === 200,
});


PLAN.push({
  version: '20261026150000',
  file: 'supabase/migrations/20261026150000_official_lease_fencing.sql',
  why: 'Huy/Khoa chốt schema: heartbeat/finish/fail official từ chối lease đã hết hạn',
  exists: async () => {
    // Không lộ qua PostgREST; đọc thân hàm bằng Management API.
    if (!accessToken || !projectRef) return false;
    try {
      const found = await managementRows(
        "select (select prosrc like '%lease_until > clock_timestamp()%' from pg_proc where proname='mvp_official_heartbeat_job') as hb,"
        + " (select prosrc like '%j.lease_until <= clock_timestamp()%' from pg_proc where proname='mvp_official_finish_job') as fin,"
        + " (select prosrc like '%j.lease_until <= clock_timestamp()%' from pg_proc where proname='mvp_official_fail_job') as fail"
      );
      return found?.[0]?.hb === true && found?.[0]?.fin === true && found?.[0]?.fail === true;
    } catch {
      return false;
    }
  },
});


PLAN.push({
  version: '20261026160000',
  file: 'supabase/migrations/20261026160000_official_write_hardening.sql',
  why: 'Huy/Khoa chốt schema: service_role không xoá được ván/vòng/lịch phát official',
  exists: async () => {
    if (!accessToken || !projectRef) return false;
    try {
      const found = await managementRows(
        "select has_table_privilege('service_role','public.mvp_official_games','DELETE') as games_del,"
        + " has_table_privilege('service_role','public.mvp_official_rounds','DELETE') as rounds_del,"
        + " has_table_privilege('service_role','public.mvp_official_broadcasts','DELETE') as bc_del"
      );
      return found?.[0]?.games_del === false && found?.[0]?.rounds_del === false
        && found?.[0]?.bc_del === false;
    } catch {
      return false;
    }
  },
});

PLAN.push({
  version: '20261026170000',
  file: 'supabase/migrations/20261026170000_shared_login_throttle.sql',
  why: 'Huy: Login throttle dùng chung qua Supabase (bảo vệ brute-force serverless)',
  exists: async () => {
    if (!accessToken || !projectRef) return false;
    try {
      const found = await managementRows(
        "select to_regclass('public.mvp_login_attempts') as tbl, "
        + "proname from pg_proc where pronamespace = 'public'::regnamespace "
        + "and proname = 'mvp_login_throttle_hit'"
      );
      return Boolean(found?.[0]?.tbl);
    } catch {
      return false;
    }
  },
});



const readSql = (relative) => readFileSync(path.join(root, relative), 'utf8');

/** Management API không hiểu meta-command `\echo`; bỏ các dòng đó trước khi gửi. */
const sanitizeSql = (sql) => sql.replace(/^\s*\\echo[^\n]*$/gmu, '');

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

/** Management API trả JSON array các dòng; helper này parse an toàn cho probe pg_proc. */
async function managementRows(sql) {
  const raw = await runManagementSql(sql);
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
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

/** PostgREST giữ schema cache; sau DDL phải NOTIFY để nó nạp lại trước khi probe REST. */
async function reloadPostgrestSchema() {
  if (!accessToken || !projectRef) return;
  try {
    await runManagementSql("NOTIFY pgrst, 'reload schema'");
  } catch {
    // Không chặn apply nếu notify lỗi; vòng poll bên dưới sẽ thử lại.
  }
}

/** Sau khi apply, object có thể chưa hiện ngay qua REST vì schema cache -> poll + notify. */
async function confirmApplied(item, attempts = 8, delayMs = 1000) {
  if (await item.exists()) return true;
  for (let i = 0; i < attempts; i += 1) {
    await reloadPostgrestSchema();
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    if (await item.exists()) return true;
  }
  return false;
}

async function preflight() {
  const missing = [];
  for (const table of ['mvp_tournaments', 'mvp_submissions', 'maps']) {
    if ((await restGet(`/rest/v1/${table}?select=*&limit=1`)).status !== 200) missing.push(table);
  }
  return missing;
}


/**
 * Ledger version/name/checksum cho mọi lần apply. Cùng hình dạng với bảng mà bundle
 * `freshDatabaseBundle` tạo, để project mới và project đã có lịch sử đọc giống nhau.
 * `applied_at` của các dòng backfill là thời điểm ghi nhận, không phải thời điểm apply gốc.
 */
const LEDGER_DDL = `
create table if not exists public.ootv2_schema_migrations (
  version text primary key,
  name text not null,
  sha256 text not null,
  applied_at timestamptz not null default now()
);
alter table public.ootv2_schema_migrations enable row level security;
revoke all on public.ootv2_schema_migrations from public, anon, authenticated;
grant select on public.ootv2_schema_migrations to service_role;`;

function ledgerEntry(item) {
  const fileName = item.file.split('/').at(-1);
  const sql = readSql(item.file).replace(/\r\n/g, '\n');
  return { version: item.version, name: fileName.slice(15, -4),
    sha256: createHash('sha256').update(sql).digest('hex') };
}

async function writeLedger(transport, item, note = '') {
  const entry = ledgerEntry(item);
  await transport.run(`${LEDGER_DDL}
insert into public.ootv2_schema_migrations(version, name, sha256)
values ('${entry.version}', '${entry.name}', '${entry.sha256}')
on conflict (version) do nothing;
${note ? `update public.ootv2_schema_migrations set name = '${entry.name}', sha256 = '${entry.sha256}'
where version = '${entry.version}' and (name <> '${entry.name}' or sha256 <> '${entry.sha256}');` : ''}`);
  return entry;
}

/** Backfill: chỉ ghi cho migration mà probe `exists()` đã xác nhận object tồn tại. */
async function backfillHistory(transport) {
  console.log('\n→ ghi lịch sử cho các migration đã có (backfill version/name/checksum)');
  let recorded = 0;
  for (const item of PLAN) {
    if (only && !only.has(item.version)) continue;
    if (!(await item.exists())) continue;
    const entry = await writeLedger(transport, item, 'verify');
    console.log(`   ledger ${entry.version} ${entry.name} sha256:${entry.sha256.slice(0, 12)}…`);
    recorded += 1;
  }
  const result = await restGet('/rest/v1/ootv2_schema_migrations?select=version');
  const total = Array.isArray(result.body) ? result.body.length : '?';
  console.log(`OK   ledger: ${recorded} bản ghi đồng bộ, tổng ${total} dòng.`);
}


async function main() {
  console.log(`Supabase: ${url}`);
  const channel = accessToken && projectRef ? 'Management API' : dbUrl ? 'psql (SUPABASE_DB_URL)' : 'CHƯA CÓ';
  console.log(`Kênh DDL: ${channel}`);
  console.log(`Chế độ: ${apply ? 'APPLY' : 'dry-run (thêm --apply để ghi DB)'}\n`);

  const missingBaseline = await preflight();
  if (missingBaseline.length) {
    const createdByPlan = missingBaseline.every((table) => table === 'mvp_tournaments' || table === 'mvp_submissions');
    if (!(bootstrap && createdByPlan)) {
      console.error(`Dừng: baseline thiếu ${missingBaseline.join(', ')} — kiểm tra project/URL trước khi apply.`);
      process.exit(1);
    }
    console.log(`Bootstrap: thiếu ${missingBaseline.join(', ')} — sẽ tạo bằng migration runtime trong PLAN.`);
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
    const transport = apply ? pickTransport() : null;
    if (smoke && apply) {
      if (!transport) {
        console.error('\nKhông có kênh DDL để chạy smoke test (cần SUPABASE_ACCESS_TOKEN hoặc psql + SUPABASE_DB_URL).');
        process.exit(2);
      }
      const smokeSql = sanitizeSql(readSql('supabase/tests/github_intake.sql'));
      console.log(`\n→ smoke PostgreSQL qua ${transport.name} (transaction + ROLLBACK)`);
      try {
        await transport.run(smokeSql);
        console.log('OK   smoke PASS (đã rollback, không để lại dữ liệu)');
      } catch (error) {
        console.error(`LỖI smoke: ${error.message}`);
        process.exit(5);
      }
    }
    if (recordHistory && transport) await backfillHistory(transport);
    if (recordHistory && !apply) console.log('(--record-history chỉ ghi khi có --apply.)');
    return;
  }
  if (!apply) {
    console.log(`\nDry-run: ${pending.length} migration cần apply. Chạy lại với --apply.`);
    if (smoke) console.log('(--smoke chỉ chạy cùng --apply sau khi migration đã có đủ.)');
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
    const ok = await confirmApplied(item);
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${item.version}${ok ? '' : ' — object đại diện chưa thấy (PostgREST schema cache?)'}`);
    if (!ok) process.exit(4);
    try {
      const entry = await writeLedger(transport, item);
      console.log(`     ledger ${entry.version} ${entry.name} sha256:${entry.sha256.slice(0, 12)}…`);
    } catch (error) {
      console.warn(`     ledger: bỏ qua (${error.message}) — migration đã apply, chỉ thiếu bản ghi lịch sử.`);
    }
  }
  if (recordHistory) await backfillHistory(transport);
  console.log('\nHoàn tất: các migration còn thiếu đã apply và kiểm tra lại.');
  if (smoke) {
    console.log(`\n→ smoke PostgreSQL qua ${transport.name} (transaction + ROLLBACK)`);
    try {
      await transport.run(sanitizeSql(readSql('supabase/tests/github_intake.sql')));
      console.log('OK   smoke PASS (đã rollback, không để lại dữ liệu)');
    } catch (error) {
      console.error(`LỖI smoke: ${error.message}`);
      process.exit(5);
    }
  }
  console.log('Bước tiếp: node tools/cli/check-github-db.js');
}

await main();
