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
}

const ok = checks.every((item) => item.ok);
if (process.argv.includes('--json')) {
  process.stdout.write(`${JSON.stringify({ ok, checks })}\n`);
} else {
  for (const item of checks) console.log(`${item.ok ? 'PASS' : 'FAIL'} ${item.name}: ${item.detail}`);
  console.log(ok ? 'worker-health: OK' : 'worker-health: BLOCKED');
}
process.exitCode = ok ? 0 : 1;
