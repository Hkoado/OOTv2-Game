/**
 * githubJobs.test.js — Contract worker ↔ H1 (claim/heartbeat/progress/finish/release).
 *
 * Supabase được giả lập ở lớp fetch (chỉ RPC), nên test không chạm DB thật và kiểm được:
 * payload gửi đi, chuẩn hoá outcome, và quy ước "false = mất lease thì dừng ghi".
 */

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only';

const jobs = await import('../server/shared/githubJobs.js');

const JOB = '11111111-1111-4111-8111-111111111111';
const TOKEN = '22222222-2222-4222-8222-222222222222';
const SUBMISSION = '33333333-3333-4333-8333-333333333333';
const SHA = 'a'.repeat(64);

function fakeRpc(handler) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const target = new URL(String(url));
    assert.equal(target.origin, 'https://example.invalid', 'không được gọi host khác Supabase test');
    const name = target.pathname.replace('/rest/v1/rpc/', '');
    const body = options.body ? JSON.parse(String(options.body)) : null;
    calls.push({ name, body });
    const result = handler(name, body);
    return new Response(result === null ? 'null' : JSON.stringify(result), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

test('claim: clamp lease, trim worker và map lease/generation', async () => {
  const fake = fakeRpc((name) => {
    assert.equal(name, 'mvp_github_claim');
    return {
      job: { id: JOB, status: 'leased', generation: 2, attempt: 2 },
      receipt: { id: 'receipt', status: 'resolving', commit_sha: 'b'.repeat(40) },
      lease: { token: TOKEN, generation: 2, expires_at: '2026-10-24T10:02:00.000Z', attempt: 2, max_attempts: 3 },
    };
  });
  try {
    const claimed = await jobs.claimGithubJob({ worker: '  judge-a  ', leaseSeconds: 5 });
    assert.equal(fake.calls[0].body.p_worker, 'judge-a');
    assert.equal(fake.calls[0].body.p_lease_seconds, 10, 'lease tối thiểu 10 giây');
    assert.equal(claimed.lease.token, TOKEN);
    assert.equal(claimed.lease.generation, 2);
    assert.equal(claimed.lease.attempt, 2);
    assert.equal(claimed.receipt.status, 'resolving');

    assert.equal(await jobs.claimGithubJob({ worker: 'judge-a', leaseSeconds: 5000 }).then(() => 'ran'), 'ran');
    assert.equal(fake.calls[1].body.p_lease_seconds, 900, 'lease tối đa 900 giây');
  } finally {
    fake.restore();
  }

  const empty = fakeRpc(() => null);
  try {
    assert.equal(await jobs.claimGithubJob({ worker: 'judge-a' }), null, 'không có job trả null');
    await assert.rejects(jobs.claimGithubJob({ worker: '   ' }), { status: 400, code: 'bad_worker' });
  } finally {
    empty.restore();
  }
});

test('heartbeat/progress: gửi đúng lease và trả false khi mất lease', async () => {
  let reply = true;
  const fake = fakeRpc(() => reply);
  try {
    assert.equal(await jobs.heartbeatGithubJob({ jobId: JOB, token: TOKEN, generation: 3, leaseSeconds: 60 }), true);
    assert.deepEqual(fake.calls[0].body, { p_job: JOB, p_token: TOKEN, p_generation: 3, p_lease_seconds: 60 });

    assert.equal(await jobs.progressGithubJob({ jobId: JOB, token: TOKEN, generation: 3, status: 'fetching', note: 'đang tải bot.py' }), true);
    assert.equal(fake.calls[1].name, 'mvp_github_progress');
    assert.equal(fake.calls[1].body.p_status, 'fetching');
    assert.equal(fake.calls[1].body.p_note, 'đang tải bot.py');

    reply = false;
    assert.equal(await jobs.heartbeatGithubJob({ jobId: JOB, token: TOKEN, generation: 3 }), false);
    assert.equal(await jobs.finishGithubJob({
      jobId: JOB, token: TOKEN, generation: 3,
      outcome: { status: 'valid', source_hash: SHA, submission_id: SUBMISSION },
    }), false, 'false = worker cũ, không được coi là đã ghi');

    await assert.rejects(
      jobs.progressGithubJob({ jobId: JOB, token: TOKEN, generation: 3, status: 'done' }),
      { status: 400, code: 'bad_progress' }
    );
    await assert.rejects(
      jobs.heartbeatGithubJob({ jobId: JOB, token: TOKEN, generation: 0 }),
      { status: 400, code: 'bad_generation' }
    );
  } finally {
    fake.restore();
  }
});

test('finish: chuẩn hoá outcome, không cho client tự đặt participant_id', async () => {
  const fake = fakeRpc((name) => {
    assert.equal(name, 'mvp_github_finish');
    return true;
  });
  try {
    assert.equal(await jobs.finishGithubJob({
      jobId: JOB, token: TOKEN, generation: 4,
      outcome: {
        status: 'valid', source_hash: SHA,
        submission: { storage_path: `${SUBMISSION}.py`, sha256: SHA, participant_id: 'hacker' },
      },
    }), true);
    assert.deepEqual(fake.calls[0].body.p_outcome, {
      status: 'valid', source_hash: SHA, submission_id: null,
      submission: { storage_path: `${SUBMISSION}.py`, sha256: SHA },
      error: null, error_category: null,
    });

    assert.equal(await jobs.finishGithubJob({
      jobId: JOB, token: TOKEN, generation: 4,
      outcome: { status: 'invalid', error: 'SyntaxError: invalid syntax' },
    }), true);
    assert.deepEqual(fake.calls[1].body.p_outcome, {
      status: 'invalid', source_hash: null, submission_id: null, submission: null,
      error: 'SyntaxError: invalid syntax', error_category: 'code',
    });

    assert.equal(await jobs.finishGithubJob({
      jobId: JOB, token: TOKEN, generation: 4,
      outcome: { status: 'infrastructure', error: 'GitHub 429', error_category: 'infrastructure' },
    }), true);
    assert.equal(fake.calls[2].body.p_outcome.error_category, 'infrastructure');
  } finally {
    fake.restore();
  }
});

test('finish: chặn outcome thiếu/sai dữ liệu trước khi gọi RPC', () => {
  assert.throws(() => jobs.validateFinishOutcome(null), { code: 'bad_outcome' });
  assert.throws(() => jobs.validateFinishOutcome({ status: 'uploaded' }), { code: 'bad_outcome' });
  assert.throws(() => jobs.validateFinishOutcome({ status: 'valid', source_hash: 'abc' }), { code: 'bad_outcome' });
  assert.throws(() => jobs.validateFinishOutcome({ status: 'valid', source_hash: SHA }), { code: 'missing_submission' });
  assert.throws(
    () => jobs.validateFinishOutcome({ status: 'valid', source_hash: SHA, submission_id: 'not-uuid' }),
    { code: 'bad_submission' }
  );
  assert.throws(
    () => jobs.validateFinishOutcome({
      status: 'valid', source_hash: SHA,
      submission: { storage_path: 'bot.py', sha256: SHA },
    }),
    { code: 'bad_submission' }, 'storage_path phải là <uuid>.py'
  );
  assert.throws(
    () => jobs.validateFinishOutcome({
      status: 'valid', source_hash: SHA,
      submission: { storage_path: `${SUBMISSION}.py`, sha256: 'b'.repeat(64) },
    }),
    { code: 'bad_submission' }, 'sha256 phải khớp source_hash'
  );
  assert.throws(
    () => jobs.validateFinishOutcome({ status: 'invalid', error: 42 }),
    { code: 'bad_outcome' }, 'error phải là chuỗi'
  );
  assert.equal(jobs.validateFinishOutcome({ status: 'valid', source_hash: SHA, submission_id: SUBMISSION }).submission_id, SUBMISSION);
  assert.equal(jobs.clampLeaseSeconds('abc'), jobs.DEFAULT_LEASE_SECONDS);
});

test('release: trả trạng thái retry hoặc lease_lost; giới hạn max attempts', async () => {
  let reply = { ok: true, status: 'queued', attempt: 1, available_at: '2026-10-24T10:00:15.000Z' };
  const fake = fakeRpc(() => reply);
  try {
    const retry = await jobs.releaseGithubJob({ jobId: JOB, token: TOKEN, generation: 5, error: 'timeout GitHub', maxAttempts: 99 });
    assert.equal(retry.status, 'queued');
    assert.equal(fake.calls[0].body.p_max_attempts, 10, 'max attempts bị kẹp 10');
    assert.equal(fake.calls[0].body.p_error, 'timeout GitHub');

    reply = { ok: false, reason: 'lease_lost' };
    assert.deepEqual(await jobs.releaseGithubJob({ jobId: JOB, token: TOKEN, generation: 5 }), { ok: false, reason: 'lease_lost' });

    reply = null;
    assert.deepEqual(await jobs.releaseGithubJob({ jobId: JOB, token: TOKEN, generation: 5 }), { ok: false, reason: 'lease_lost' });

    await assert.rejects(
      jobs.releaseGithubJob({ jobId: 'bad', token: TOKEN, generation: 5 }),
      { status: 400, code: 'bad_job' }
    );
  } finally {
    fake.restore();
  }
});

