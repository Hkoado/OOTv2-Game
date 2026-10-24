/**
 * worker-health.js — preflight mà worker thật sự cần, chạy được trên máy chấm.
 *
 * Chỉ đọc: không claim job, không ghi bảng, không tạo tài khoản. Dùng để `workerctl start`
 * từ chối khởi động khi schema Storage/intake/judge còn thiếu, thay vì để worker
 * chết lặp lại trong systemd.
 *
 * Readiness được tách theo service: máy chỉ nạp bài GitHub không cần bảng official, và máy
 * chấm official/manual không cần bảng intake. `--scope` chọn nhóm cần kiểm; mặc định `all`.
 *
 * Chạy: `node tools/cli/worker-health.js [--scope=github|judge|all] [--json]`.
 * Exit 0 = dùng được, 1 = thiếu điều kiện, 64 = tham số sai.
 */
import { readFileSync } from 'node:fs';
import { githubClaimHealthy, jsonbClaimHealthy, jsonbGuardHealthy } from './workerHealthProbes.js';
import '../../server/config.js';

const argv = process.argv.slice(2);
const json = argv.includes('--json');
const scopeArg = (argv.find((arg) => arg.startsWith('--scope=')) ?? '').slice('--scope='.length) || 'all';
if (!['github', 'judge', 'all'].includes(scopeArg)) {
  console.error('usage: node tools/cli/worker-health.js [--scope=github|judge|all] [--json]');
  process.exit(64);
}
const wants = (group) => scopeArg === 'all' || scopeArg === group;

const checks = [];
function record(group, name, ok, detail) {
  if (wants(group)) checks.push({ scope: group, name, ok, detail });
}

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  for (const group of ['github', 'judge']) {
    record(group, 'credentials', false, 'missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }
} else if (!/^https:\/\/[a-z]{20}\.supabase\.co$/.test(url.replace(/\/$/, ''))) {
  for (const group of ['github', 'judge']) {
    record(group, 'credentials', false, 'SUPABASE_URL is not a https Supabase project URL');
  }
} else {
  for (const group of ['github', 'judge']) record(group, 'credentials', true, 'service role configured');
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

async function postRpc(name, payload) {
  const response = await fetch(`${base}/rest/v1/rpc/${name}`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload), signal: AbortSignal.timeout(15000),
  });
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status, body };
}

async function table(group, name, label) {
  try {
    const result = await get(`/rest/v1/${name}?select=id&limit=1`);
    record(group, name, result.status === 200, result.status === 200 ? label : `HTTP ${result.status}`);
  } catch {
    record(group, name, false, 'network');
  }
}

/**
 * PostgREST bọc `raise exception` thành `400` + `{code:'P0001', message:<raise text>}`.
 * Chỉ nhận đúng guard đã biết; mọi lỗi khác (401/404/PGRST202…) là FAIL, không phải PASS.
 * Các probe dưới đây dùng input cố ý không hợp lệ và guard chạy trước mọi truy vấn job,
 * nên không lease, không UPDATE và không ghi dòng nào.
 */
if (base && key && wants('github')) {
  for (const [name, label] of [['mvp_repo_sync_jobs', 'job table'], ['mvp_github_receipts', 'receipt table'],
    ['mvp_repo_connections', 'repo approval table']]) {
    try {
      const result = await get(`/rest/v1/${name}?select=*&limit=1`);
      record('github', name, result.status === 200, result.status === 200 ? label : `HTTP ${result.status}`);
    } catch {
      record('github', name, false, 'network');
    }
  }
  try {
    const { status, body } = await postRpc('mvp_github_claim', { p_worker: '', p_lease_seconds: 1 });
    // Guard thật là `bad_worker` (worker rỗng) và nó chạy trước truy vấn job. Nhận cả
    // `bad_lease` để không vỡ trên deployment cũ, nhưng không nhận lỗi nào khác.
    const hit = githubClaimHealthy({ status, body });
    record('github', 'mvp_github_claim', hit !== null,
      hit ? `${hit} guard reachable` : `HTTP ${status} ${body?.code || ''} ${body?.message || ''}`.trim());
  } catch {
    record('github', 'mvp_github_claim', false, 'network');
  }
}

if (base && key && (wants('github') || wants('judge'))) {
  try {
    // Artifact private dùng chung: intake tải bot GitHub, judge tải source manual.
    const result = await get('/storage/v1/bucket');
    const bucket = Array.isArray(result.body) ? result.body.find((item) => item.id === 'ootv2-bots') : null;
    const ok = result.status === 200 && bucket && bucket.public === false && Number(bucket.file_size_limit) === 262144;
    for (const group of ['github', 'judge']) {
      record(group, 'storage_bucket', Boolean(ok), ok ? 'private, 262144 bytes' : 'missing or misconfigured ootv2-bots');
    }
  } catch {
    for (const group of ['github', 'judge']) record(group, 'storage_bucket', false, 'network');
  }
}

if (base && key && wants('judge')) {
  for (const [name, label] of [['mvp_official_rounds', 'official round table'],
    ['mvp_official_games', 'official game table'], ['mvp_official_jobs', 'official job table'],
    ['mvp_manual_final_jobs', 'manual job table'], ['mvp_manual_final_matches', 'manual match table']]) {
    await table('judge', name, label);
  }
  try {
    // Official claim trả JSONB HTTP 200 (không raise) và clamp lease 30..3600 nên `bad_lease`
    // không bao giờ xảy ra; `bad_worker` là guard duy nhất chứng minh RPC tồn tại mà không lease.
    const { status, body } = await postRpc('mvp_official_claim_job', { p_worker: '', p_lease_seconds: 120 });
    const hit = jsonbClaimHealthy({ status, body });
    record('judge', 'mvp_official_claim_job', hit !== null,
      hit ? 'bad_worker guard reachable' : `HTTP ${status} ${body?.error || body?.code || ''}`.trim());
  } catch {
    record('judge', 'mvp_official_claim_job', false, 'network');
  }
  try {
    // `bad_worker` được trả trước mọi truy vấn job nên probe này không lease/ghi gì.
    const { status, body } = await postRpc('mvp_manual_final_claim',
      { p_worker: '', p_limit: 1, p_lease_seconds: 10 });
    const hit = jsonbClaimHealthy({ status, body });
    record('judge', 'mvp_manual_final_claim', hit !== null,
      hit ? 'bad_worker guard reachable' : `HTTP ${status} ${body?.error || body?.code || ''}`.trim());
  } catch {
    record('judge', 'mvp_manual_final_claim', false, 'network');
  }
  try {
    // Duration không hợp lệ bị từ chối trước UPDATE: probe không chạm job nào.
    const { status, body } = await postRpc('mvp_manual_final_heartbeat', {
      p_job: '00000000-0000-0000-0000-000000000000',
      p_token: '00000000-0000-0000-0000-000000000000', p_generation: 0, p_lease_seconds: 0,
    });
    const hit = jsonbGuardHealthy({ status, body }, 'bad_lease');
    record('judge', 'mvp_manual_final_heartbeat', hit !== null,
      hit ? 'duration guard reachable' : `HTTP ${status} ${body?.error || body?.code || ''}`.trim());
  } catch {
    record('judge', 'mvp_manual_final_heartbeat', false, 'network or invalid response');
  }
}

if (wants('judge') && process.platform === 'linux') {
  // Chỉ trên guest Linux: attestation phải còn hạn NGAY BÂY GIỜ, không chỉ lúc cài.
  // `workerctl start` gọi probe này nên VM hết hạn chứng nhận sẽ từ chối nhận việc mới.
  const attestationPath = process.env.OOTV2_SANDBOX_ATTESTATION || '/run/ootv2-sandbox-attestation.json';
  try {
    const { validateAttestation } = await import('../../server/judge/campusSandboxFactory.js');
    const attestation = validateAttestation(readFileSync(attestationPath, 'utf8'), {});
    record('judge', 'sandbox_attestation', true, `${attestation.profile} expires ${attestation.expiresAt}`);
  } catch (error) {
    record('judge', 'sandbox_attestation', false,
      `${error?.code || error?.message || 'invalid_attestation'} (${attestationPath})`);
  }
}

const ok = checks.every((item) => item.ok);
if (json) {
  process.stdout.write(`${JSON.stringify({ ok, scope: scopeArg, checks })}\n`);
} else {
  for (const item of checks) console.log(`${item.ok ? 'PASS' : 'FAIL'} [${item.scope}] ${item.name}: ${item.detail}`);
  console.log(`worker-health: ${ok ? 'OK' : 'BLOCKED'} (scope=${scopeArg})`);
}
process.exitCode = ok ? 0 : 1;
