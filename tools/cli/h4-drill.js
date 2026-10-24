/**
 * h4-drill.js — H4 integration drill trên Supabase THẬT (2 tiến trình worker).
 *
 * Phủ: hai worker OS process claim song song (không trùng job/token), crash/retry + reclaim cap,
 * stale token/generation, duplicate finish idempotent, cutoff, revoke. Dữ liệu drill được seed
 * với UUID ngẫu nhiên rồi XOÁ sạch trong `finally`.
 *
 * An toàn:
 * - Từ chối chạy nếu `mvp_repo_sync_jobs` đang có job lạ (không tranh job thật).
 * - Chỉ thao tác trên event/team do chính drill tạo; không sửa dòng khác.
 * - Không in service key/token; chỉ in UUID và kết quả assert.
 *
 * Chạy: npm run db:h4      (hoặc node tools/cli/h4-drill.js)
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
  process.exit(2);
}

const runId = randomBytes(4).toString('hex');
const headers = { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' };
const sha40 = (text) => createHash('sha1').update(`h4-${runId}-${text}`).digest('hex');
const sha256 = (text) => createHash('sha256').update(`h4-${runId}-${text}`).digest('hex');

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

async function readBody(response, label) {
  const text = await response.text();
  if (!response.ok) throw new Error(`${label} HTTP ${response.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

async function rpc(name, payload) {
  const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  return readBody(response, `rpc ${name}`);
}

async function insertRows(table, rows) {
  const response = await fetch(`${url}/rest/v1/${table}`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=representation' },
    body: JSON.stringify(rows),
  });
  return readBody(response, `insert ${table}`);
}

async function selectRows(table, query) {
  const response = await fetch(`${url}/rest/v1/${table}?${query}`, { headers });
  return readBody(response, `select ${table}`);
}

async function patchRows(table, query, patch) {
  const response = await fetch(`${url}/rest/v1/${table}?${query}`, {
    method: 'PATCH',
    headers: { ...headers, Prefer: 'return=representation' },
    body: JSON.stringify(patch),
  });
  return readBody(response, `patch ${table}`);
}

async function deleteRows(table, query) {
  const response = await fetch(`${url}/rest/v1/${table}?${query}`, {
    method: 'DELETE',
    headers: { ...headers, Prefer: 'return=representation' },
  });
  const rows = await readBody(response, `delete ${table}`);
  return Array.isArray(rows) ? rows.length : 0;
}

const seeded = [];
const createdSubmissions = [];

/**
 * Seed một event draft + team + entry + repo đã duyệt + N job intake.
 * Mọi UUID ngẫu nhiên nên không đụng dữ liệu thật.
 */
async function seedEvent(label, jobCount) {
  const eventId = randomUUID();
  const teamId = randomUUID();
  const actorId = randomUUID();
  const repoId = 900000000000 + Number.parseInt(runId.slice(0, 6), 16) % 99999999;
  const repo = `https://github.com/h4-drill/${runId}-${label}`;
  const now = new Date().toISOString();

  await insertRows('mvp_participants', [{
    id: teamId,
    name: `H4 drill ${runId} ${label}`.slice(0, 60),
    name_key: `h4 drill ${runId} ${label}`.toLowerCase(),
    created_at: now,
  }]);
  await insertRows('mvp_tournaments', [{
    id: eventId,
    name: `H4 drill ${runId} ${label}`,
    status: 'draft',
    seed: 1,
    created_at: now,
  }]);
  await insertRows('mvp_tournament_entries', [{
    id: randomUUID(),
    tournament_id: eventId,
    participant_id: teamId,
    seed_order: 1,
    group_name: null,
    submission_id: null,
  }]);

  const seed = { label, eventId, teamId, actorId, repoId, repo, jobIds: [] };
  seeded.push(seed);

  const connection = await rpc('mvp_repo_connection_upsert', {
    p_event: eventId,
    p_team: teamId,
    p_repository: repo,
    p_repo_id: repoId,
    p_branch: 'main',
    p_file_path: 'bot.py',
    p_approved: true,
    p_actor: actorId,
  });
  if (connection?.ok !== true) throw new Error(`seed ${label}: connection ${JSON.stringify(connection)}`);

  for (let index = 0; index < jobCount; index += 1) {
    const intake = await rpc('mvp_github_intake', {
      p_event: eventId,
      p_team: teamId,
      p_account: null,
      p_repository: repo,
      p_branch: 'main',
      p_file_path: 'bot.py',
      p_repo_id: repoId,
      p_commit_sha: sha40(`${label}-${index}`),
      p_daily_quota: 20,
    });
    if (intake?.ok !== true || !intake.job?.id) throw new Error(`seed ${label}: intake ${JSON.stringify(intake)}`);
    seed.jobIds.push(intake.job.id);
  }
  return seed;
}

async function cleanup() {
  for (const seed of seeded) {
    await deleteRows('mvp_github_receipts', `event_id=eq.${seed.eventId}`);
    await deleteRows('mvp_repo_sync_jobs', `event_id=eq.${seed.eventId}`);
    await deleteRows('mvp_repo_connections', `event_id=eq.${seed.eventId}`);
    await deleteRows('mvp_official_setups', `tournament_id=eq.${seed.eventId}`);
    await deleteRows('mvp_tournament_entries', `tournament_id=eq.${seed.eventId}`);
    // submissions trỏ participant (FK) nên phải xoá trước participants; receipts đã xoá ở trên.
    await deleteRows('mvp_submissions', `participant_id=eq.${seed.teamId}`);
    await deleteRows('mvp_tournaments', `id=eq.${seed.eventId}`);
    await deleteRows('mvp_participants', `id=eq.${seed.teamId}`);
  }
  for (const id of createdSubmissions) await deleteRows('mvp_submissions', `id=eq.${id}`);
}

function spawnWorker(name, extraEnv) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(here, 'h4-worker.js')], {
      env: { ...process.env, ...extraEnv, H4_WORKER: name },
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => child.kill(), 40000);
    child.on('close', (code) => {
      clearTimeout(timer);
      const events = stdout.split(/\r?\n/u).filter(Boolean).flatMap((line) => {
        try {
          return [JSON.parse(line)];
        } catch {
          return [];
        }
      });
      resolve({ name, code, pid: child.pid, events, stderr: stderr.slice(0, 400) });
    });
  });
}

async function scenarioWorkers() {
  const seed = await seedEvent('workers', 4);
  const [first, second] = await Promise.all([
    spawnWorker('h4-a', { H4_MAX_JOBS: '4', H4_HOLD_MS: '500' }),
    spawnWorker('h4-b', { H4_MAX_JOBS: '4', H4_HOLD_MS: '500' }),
  ]);
  const runs = [first, second];
  const claims = runs.flatMap((run) => run.events.filter((event) => event.event === 'claimed'));
  const finished = runs.flatMap((run) => run.events.filter((event) => event.event === 'finished'));
  const fatal = runs.flatMap((run) => run.events.filter((event) => event.event === 'fatal'));

  check('2 worker là 2 OS process riêng', first.pid !== second.pid && first.pid !== process.pid && second.pid !== process.pid,
    `pids ${first.pid}, ${second.pid}`);
  check('không worker nào lỗi', fatal.length === 0, fatal.map((event) => event.error).join(' | '));
  check('cả hai worker đều nhận job', new Set(claims.map((claim) => claim.worker)).size === 2,
    [...new Set(claims.map((claim) => claim.worker))].join(','));
  check('claim đủ 4 job của drill', claims.length === 4, `claims=${claims.length}`);
  check('không job nào bị claim 2 lần', new Set(claims.map((claim) => claim.job_id)).size === claims.length);
  check('mỗi lần claim có lease token riêng', new Set(claims.map((claim) => claim.token)).size === claims.length);
  check('chỉ claim job của event drill', claims.every((claim) => claim.event_id === seed.eventId));
  check('finish lần đầu applied=true', finished.length === 4 && finished.every((item) => item.applied === true));
  check('finish lần hai already_finished, không ghi lại',
    finished.every((item) => item.alreadyFinished === true && item.secondApplied === false));

  const jobs = await selectRows('mvp_repo_sync_jobs', `event_id=eq.${seed.eventId}&select=id,status,attempt`);
  check('DB: 4 job bot_fault, attempt=1', jobs.length === 4 && jobs.every((job) => job.status === 'bot_fault' && job.attempt === 1));
  const receipts = await selectRows('mvp_github_receipts', `event_id=eq.${seed.eventId}&select=status`);
  check('DB: 4 receipt invalid', receipts.length === 4 && receipts.every((receipt) => receipt.status === 'invalid'));
}

async function scenarioCrash() {
  const seed = await seedEvent('crash', 1);
  const crashed = await spawnWorker('h4-crash', { H4_MODE: 'crash', H4_MAX_JOBS: '1' });
  check('worker crash đã claim rồi thoát ngay', crashed.events.some((event) => event.event === 'crash') && crashed.code === 0);

  // Lease 10s: chờ hết hạn rồi reclaim với max_attempts=1 (đã dùng 1 lần) => phải bị chặn.
  await sleep(11500);
  const reclaim = await rpc('mvp_github_claim', { p_worker: 'h4-probe-reclaim', p_lease_seconds: 10, p_max_attempts: 1 });
  check('crash quá max_attempts: không phát lại job', reclaim === null, JSON.stringify(reclaim).slice(0, 120));

  const jobs = await selectRows('mvp_repo_sync_jobs', `event_id=eq.${seed.eventId}&select=status,attempt,lease_token`);
  check('DB: job crash -> infra_fault, đã nhả lease',
    jobs.length === 1 && jobs[0].status === 'infra_fault' && jobs[0].lease_token === null, JSON.stringify(jobs[0] || {}));
  const receipts = await selectRows('mvp_github_receipts', `event_id=eq.${seed.eventId}&select=status`);
  check('DB: receipt crash -> infrastructure', receipts.length === 1 && receipts[0].status === 'infrastructure');
}

async function scenarioStale() {
  const seed = await seedEvent('stale', 1);
  const firstClaim = await rpc('mvp_github_claim', { p_worker: 'h4-probe-stale', p_lease_seconds: 10, p_max_attempts: 3 });
  check('claim được job stale', firstClaim?.job?.id === seed.jobIds[0]);
  const { job, lease } = firstClaim;
  const badToken = randomUUID();

  const wrongToken = await rpc('mvp_github_finish', {
    p_job: job.id, p_token: badToken, p_generation: lease.generation,
    p_outcome: { status: 'invalid', error: 'stale token', error_category: 'code' },
  });
  check('finish sai token -> lease_lost', wrongToken?.ok === false && wrongToken?.error === 'lease_lost');

  const wrongGeneration = await rpc('mvp_github_finish', {
    p_job: job.id, p_token: lease.token, p_generation: lease.generation - 1,
    p_outcome: { status: 'invalid', error: 'stale generation', error_category: 'code' },
  });
  check('finish sai generation -> lease_lost', wrongGeneration?.ok === false && wrongGeneration?.error === 'lease_lost');

  const staleProgress = await rpc('mvp_github_progress', {
    p_job: job.id, p_token: badToken, p_generation: lease.generation, p_status: 'checking', p_note: 'stale',
  });
  check('progress sai token -> false', staleProgress === false);

  const staleRelease = await rpc('mvp_github_release', {
    p_job: job.id, p_token: badToken, p_generation: lease.generation, p_error: 'stale', p_max_attempts: 3,
  });
  check('release sai token -> lease_lost', staleRelease?.ok === false);

  const release = await rpc('mvp_github_release', {
    p_job: job.id, p_token: lease.token, p_generation: lease.generation, p_error: 'h4 retry', p_max_attempts: 3,
  });
  check('release đúng lease -> queued + backoff', release?.ok === true && release?.status === 'queued');

  // Backoff 15s: drill dời available_at về quá khứ để khỏi chờ (chỉ sửa dòng của drill).
  await patchRows('mvp_repo_sync_jobs', `id=eq.${job.id}`, { available_at: new Date(Date.now() - 1000).toISOString() });
  const secondClaim = await rpc('mvp_github_claim', { p_worker: 'h4-probe-stale', p_lease_seconds: 10, p_max_attempts: 3 });
  check('reclaim sau release: attempt tăng lên 2', secondClaim?.job?.id === job.id && secondClaim?.lease?.attempt === 2,
    JSON.stringify(secondClaim?.lease || {}));

  const sourceHash = sha256('valid-finish');
  const finishArgs = {
    p_job: job.id,
    p_token: secondClaim.lease.token,
    p_generation: secondClaim.lease.generation,
    p_outcome: {
      status: 'valid',
      source_hash: sourceHash,
      submission: { storage_path: `${randomUUID()}.py`, sha256: sourceHash },
    },
  };
  const appliedFinish = await rpc('mvp_github_finish', finishArgs);
  check('finish valid applied + tạo submission', appliedFinish?.ok === true && appliedFinish?.applied === true
    && Boolean(appliedFinish?.receipt?.submission_id));
  if (appliedFinish?.receipt?.submission_id) createdSubmissions.push(appliedFinish.receipt.submission_id);

  const duplicate = await rpc('mvp_github_finish', finishArgs);
  check('finish lặp: already_finished, applied=false',
    duplicate?.ok === true && duplicate?.applied === false && duplicate?.already_finished === true);
  const submissions = await selectRows('mvp_submissions', `participant_id=eq.${seed.teamId}&select=id`);
  check('finish lặp không tạo submission thứ 2', submissions.length === 1, `submissions=${submissions.length}`);
}

async function scenarioRevoke() {
  const seed = await seedEvent('revoke', 2);
  const revoke = await rpc('mvp_repo_connection_revoke', {
    p_event: seed.eventId, p_team: seed.teamId, p_actor: seed.actorId,
  });
  check('revoke thu hồi repo + hủy 2 job chờ', revoke?.ok === true && revoke?.canceled_jobs === 2,
    JSON.stringify(revoke).slice(0, 160));
  const jobs = await selectRows('mvp_repo_sync_jobs', `event_id=eq.${seed.eventId}&select=status`);
  check('DB: job sau revoke -> canceled', jobs.length === 2 && jobs.every((job) => job.status === 'canceled'));
  const receipts = await selectRows('mvp_github_receipts', `event_id=eq.${seed.eventId}&select=status`);
  check('DB: receipt sau revoke -> frozen', receipts.length === 2 && receipts.every((receipt) => receipt.status === 'frozen'));
}

async function scenarioCutoff() {
  const seed = await seedEvent('cutoff', 0);
  await insertRows('mvp_official_setups', [{
    tournament_id: seed.eventId,
    config: { cutoff: new Date(Date.now() - 3600000).toISOString() },
    updated_at: new Date().toISOString(),
  }]);
  const intake = await rpc('mvp_github_intake', {
    p_event: seed.eventId,
    p_team: seed.teamId,
    p_account: null,
    p_repository: seed.repo,
    p_branch: 'main',
    p_file_path: 'bot.py',
    p_repo_id: seed.repoId,
    p_commit_sha: sha40('cutoff'),
    p_daily_quota: 20,
  });
  check('cutoff quá hạn -> past_cutoff', intake?.ok === false && intake?.error === 'past_cutoff',
    JSON.stringify(intake).slice(0, 160));
}

async function main() {
  console.log(`H4 drill — Supabase thật ${url}`);
  console.log(`run=${runId}\n`);

  // An toàn: claim là toàn cục; nếu DB đang có job thật thì không được chạy drill.
  const existing = await selectRows('mvp_repo_sync_jobs', 'select=id&limit=5');
  if (existing.length) {
    console.error(`Dừng: mvp_repo_sync_jobs đang có job (${existing.length}+). Không tranh job thật.`);
    process.exit(3);
  }

  try {
    await scenarioWorkers();
    await scenarioCrash();
    await scenarioStale();
    await scenarioRevoke();
    await scenarioCutoff();
  } catch (error) {
    check('drill chạy không lỗi', false, String(error.message || error).slice(0, 200));
  } finally {
    try {
      await cleanup();
    } catch (error) {
      console.error(`cleanup lỗi: ${String(error.message || error).slice(0, 300)}`);
    }
  }

  let leftover = 0;
  for (const seed of seeded) {
    leftover += (await selectRows('mvp_repo_sync_jobs', `event_id=eq.${seed.eventId}&select=id`)).length;
    leftover += (await selectRows('mvp_github_receipts', `event_id=eq.${seed.eventId}&select=id`)).length;
    leftover += (await selectRows('mvp_repo_connections', `event_id=eq.${seed.eventId}&select=id`)).length;
    leftover += (await selectRows('mvp_official_setups', `tournament_id=eq.${seed.eventId}&select=tournament_id`)).length;
    leftover += (await selectRows('mvp_tournament_entries', `tournament_id=eq.${seed.eventId}&select=id`)).length;
    leftover += (await selectRows('mvp_tournaments', `id=eq.${seed.eventId}&select=id`)).length;
    leftover += (await selectRows('mvp_participants', `id=eq.${seed.teamId}&select=id`)).length;
  }
  for (const id of createdSubmissions) leftover += (await selectRows('mvp_submissions', `id=eq.${id}&select=id`)).length;
  check('cleanup xoá sạch dữ liệu drill', leftover === 0, `leftover=${leftover}`);

  const failed = results.filter((item) => !item.ok);
  console.log(`\n${failed.length ? 'FAIL' : 'PASS'}  ${results.length - failed.length}/${results.length} check đạt`);
  process.exit(failed.length ? 1 : 0);
}

await main();
