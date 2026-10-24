/**
 * worker-health.js — preflight mà worker thật sự cần, chạy được trên máy chấm.
 *
 * Chỉ đọc: không claim job, không ghi bảng, không tạo tài khoản. Dùng để `workerctl start`
 * từ chối khởi động khi schema Storage/GitHub intake còn thiếu, thay vì để worker
 * chết lặp lại trong systemd.
 *
 * Chạy: `node tools/cli/worker-health.js [--json]`. Exit 0 = dùng được, 1 = thiếu điều kiện.
 */
import '../../server/config.js';

const checks = [];
function record(name, ok, detail) {
  checks.push({ name, ok, detail });
}

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  record('credentials', false, 'missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
} else if (!/^https:\/\/[a-z]{20}\.supabase\.co$/.test(url.replace(/\/$/, ''))) {
  record('credentials', false, 'SUPABASE_URL is not a https Supabase project URL');
} else {
  record('credentials', true, 'service role configured');
}

const base = url ? url.replace(/\/$/, '') : null;
const headers = key ? { apikey: key, Authorization: `Bearer ${key}` } : {};

async function get(pathname) {
  const response = await fetch(`${base}${pathname}`, { headers, signal: AbortSignal.timeout(15000) });
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status, body };
}

if (base && key) {
  for (const [table, label] of [['mvp_repo_sync_jobs', 'job table'], ['mvp_github_receipts', 'receipt table'],
    ['mvp_repo_connections', 'repo approval table']]) {
    try {
      const result = await get(`/rest/v1/${table}?select=*&limit=1`);
      record(table, result.status === 200, result.status === 200 ? label : `HTTP ${result.status}`);
    } catch {
      record(table, false, 'network');
    }
  }
  // Empty worker name fails validation before any row is touched, so this proves the
  // claim function exists without leasing real work.
  try {
    const response = await fetch(`${base}/rest/v1/rpc/mvp_github_claim`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_worker: '', p_lease_seconds: 1 }), signal: AbortSignal.timeout(15000),
    });
    let body = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    const code = body?.code || '';
    const message = typeof body?.message === 'string' ? body.message : '';
    // `bad_lease` is raised before the job query, so this cannot lease real work.
    const ok = response.status === 400 && message.includes('bad_lease');
    record('mvp_github_claim', ok, ok ? 'lease guard reachable'
      : `HTTP ${response.status} ${code || ''}`.trim());
  } catch {
    record('mvp_github_claim', false, 'network');
  }
  try {
    const result = await get('/storage/v1/bucket');
    const bucket = Array.isArray(result.body) ? result.body.find((item) => item.id === 'ootv2-bots') : null;
    const ok = result.status === 200 && bucket && bucket.public === false && Number(bucket.file_size_limit) === 262144;
    record('storage_bucket', Boolean(ok), ok ? 'private, 262144 bytes' : 'missing or misconfigured ootv2-bots');
  } catch {
    record('storage_bucket', false, 'network');
  }
  // Manual final (worker Khoa): bảng phải tồn tại và claim phải trả `bad_worker` cho tên rỗng.
  for (const [table, label] of [['mvp_manual_final_jobs', 'manual job table'],
    ['mvp_manual_final_matches', 'manual match table']]) {
    try {
      const result = await get(`/rest/v1/${table}?select=id&limit=1`);
      record(table, result.status === 200, result.status === 200 ? label : `HTTP ${result.status}`);
    } catch {
      record(table, false, 'network');
    }
  }
  try {
    // `bad_worker` được trả trước mọi truy vấn job nên probe này không lease/ghi gì.
    const response = await fetch(`${base}/rest/v1/rpc/mvp_manual_final_claim`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_worker: '', p_limit: 1, p_lease_seconds: 10 }),
      signal: AbortSignal.timeout(15000),
    });
    let body = null;
    try { body = await response.json(); } catch { body = null; }
    const ok = response.status === 200 && body?.ok === false && body?.error === 'bad_worker';
    record('mvp_manual_final_claim', ok,
      ok ? 'bad_worker guard reachable' : `HTTP ${response.status} ${body?.error || body?.code || ''}`.trim());
  } catch {
    record('mvp_manual_final_claim', false, 'network');
  }
}

if (base && key) {
  try {
    // Invalid duration is rejected before UPDATE: no job is touched by this probe.
    const response = await fetch(`${base}/rest/v1/rpc/mvp_manual_final_heartbeat`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_job: '00000000-0000-0000-0000-000000000000',
        p_token: '00000000-0000-0000-0000-000000000000', p_generation: 0, p_lease_seconds: 0 }),
      signal: AbortSignal.timeout(15000),
    });
    const body = await response.json();
    record('mvp_manual_final_heartbeat', response.status === 200 && body?.error === 'bad_lease',
      response.status === 200 && body?.error === 'bad_lease' ? 'duration guard reachable' : `HTTP ${response.status}`);
  } catch { record('mvp_manual_final_heartbeat', false, 'network or invalid response'); }
}

const ok = checks.every((item) => item.ok);
if (process.argv.includes('--json')) {
  process.stdout.write(`${JSON.stringify({ ok, checks })}\n`);
} else {
  for (const item of checks) console.log(`${item.ok ? 'PASS' : 'FAIL'} ${item.name}: ${item.detail}`);
  console.log(ok ? 'worker-health: OK' : 'worker-health: BLOCKED');
}
process.exitCode = ok ? 0 : 1;
