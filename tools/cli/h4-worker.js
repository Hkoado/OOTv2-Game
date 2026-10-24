/**
 * h4-worker.js — tiến trình worker THẬT (OS process riêng) dùng cho drill H4.
 *
 * Không phải worker production: chỉ claim job của drill, ghi progress, finish `invalid`,
 * rồi finish lần hai để kiểm idempotency. Mỗi sự kiện in một dòng JSON ra stdout để
 * `h4-drill.js` đọc và assert.
 *
 * Env:
 *   H4_WORKER      tên worker (1..120 ký tự)
 *   H4_MODE        normal | crash (crash = claim 1 job rồi thoát ngay, mô phỏng worker chết)
 *   H4_HOLD_MS     thời gian giữ job trước khi finish (mặc định 600)
 *   H4_MAX_JOBS    số job tối đa xử lý (mặc định 4)
 *   H4_DEADLINE_MS hạn tổng (mặc định 20000)
 * Credential: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (đọc từ .env ở repo root).
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
const worker = (env.H4_WORKER || `h4-${process.pid}`).slice(0, 120);
const mode = env.H4_MODE === 'crash' ? 'crash' : 'normal';
const holdMs = Math.max(0, Number(env.H4_HOLD_MS || 600));
const maxJobs = Math.max(1, Number(env.H4_MAX_JOBS || 4));
const deadline = Date.now() + Math.max(3000, Number(env.H4_DEADLINE_MS || 20000));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const emit = (payload) => process.stdout.write(`${JSON.stringify({ ...payload, worker, pid: process.pid })}\n`);

if (!url || !key) {
  emit({ event: 'fatal', error: 'missing_supabase_env' });
  process.exit(2);
}

const headers = { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' };

async function rpc(name, payload) {
  const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`rpc ${name} HTTP ${response.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

const OUTCOME = { status: 'invalid', error: 'h4-drill invalid bot', error_category: 'code' };
let handled = 0;
let idle = 0;

emit({ event: 'start', mode, maxJobs });

try {
  while (handled < maxJobs && Date.now() < deadline) {
    const claim = await rpc('mvp_github_claim', { p_worker: worker, p_lease_seconds: 10, p_max_attempts: 3 });
    if (!claim || !claim.job) {
      idle += 1;
      emit({ event: 'idle', idle });
      if (idle >= 3) break;
      await sleep(400);
      continue;
    }
    idle = 0;
    const { job, lease } = claim;
    emit({
      event: 'claimed',
      job_id: job.id,
      event_id: job.event_id,
      token: lease.token,
      generation: lease.generation,
      attempt: lease.attempt,
    });
    if (mode === 'crash') {
      emit({ event: 'crash', job_id: job.id, note: 'thoát không finish, lease còn hạn' });
      // Không gọi process.exit: stdout pipe có thể bị cắt mất dòng JSON cuối.
      break;
    }

    const progressed = await rpc('mvp_github_progress', {
      p_job: job.id,
      p_token: lease.token,
      p_generation: lease.generation,
      p_status: 'checking',
      p_note: 'h4-drill',
    });
    emit({ event: 'progress', job_id: job.id, ok: progressed === true });
    await sleep(holdMs);

    const finishArgs = {
      p_job: job.id,
      p_token: lease.token,
      p_generation: lease.generation,
      p_outcome: OUTCOME,
    };
    const first = await rpc('mvp_github_finish', finishArgs);
    const second = await rpc('mvp_github_finish', finishArgs);
    emit({
      event: 'finished',
      job_id: job.id,
      applied: first?.applied === true,
      alreadyFinished: second?.already_finished === true,
      secondApplied: second?.applied === true,
    });
    handled += 1;
  }
  emit({ event: 'done', handled });
} catch (error) {
  emit({ event: 'fatal', error: String(error.message || error).slice(0, 300) });
  process.exit(1);
}
