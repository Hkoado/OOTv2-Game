import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { processGithubJob } from '../server/shared/githubConsumer.js';
import { GithubArtifactError } from '../server/shared/githubArtifact.js';
import { createSourceCache } from '../server/shared/sourceCache.js';

const id = '11111111-1111-4111-8111-111111111111';
const token = '22222222-2222-4222-8222-222222222222';
const source = Buffer.from('trusted fixture, never executed');
const sourceHash = createHash('sha256').update(source).digest('hex');
function fixture(overrides = {}) {
  const calls = [];
  const job = { id, event_id: id, team_id: id, repo_id: 123, repository: 'https://github.com/team/bot',
    commit_sha: 'a'.repeat(40), file_path: 'bot.py' };
  const claim = { job, receipt: { ...job, job_id: id, source_hash: null },
    lease: { token, generation: 2 } };
  const api = {};
  for (const name of ['claim', 'heartbeat', 'progress', 'finish', 'release']) {
    api[`${name}GithubJob`] = async (args) => {
      calls.push({ name, args });
      return name === 'claim' ? claim
        : name === 'release' ? { ok: true }
        : name === 'finish' ? { applied: true, alreadyFinished: false, leaseLost: false }
        : true;
    };
  }
  return { calls, claim, options: { enabled: true, workerId: 'test-worker', jobApi: api,
    acquireSource: async () => ({ source, sourceHash }),
    validateSource: async () => ({ status: 'valid' }),
    storeSource: async () => ({ storage_path: `${id}.py`, sha256: sourceHash }), ...overrides } };
}
const finishCalls = (f) => f.calls.filter((c) => c.name === 'finish');

test('consumer defaults disabled; missing execution/storage adapters fail before claim', async () => {
  assert.deepEqual(await processGithubJob(), { processed: false, reason: 'disabled' });
  await assert.rejects(processGithubJob({ enabled: true, workerId: 'worker' }), { code: 'invalid_consumer_configuration' });
});

test('consumer empty queue and canceled startup never acquire source', async () => {
  const f = fixture(); f.options.jobApi.claimGithubJob = async () => null;
  assert.deepEqual(await processGithubJob(f.options), { processed: false });
  const controller = new AbortController(); controller.abort();
  assert.equal((await processGithubJob({ ...f.options, signal: controller.signal })).reason, 'canceled');
});

test('consumer valid pipeline uses identity, generation, private callback DTO and fenced submission', async () => {
  let released = 0;
  const f = fixture({ cache: { put(bytes, sha) { assert.deepEqual(bytes, source); assert.equal(sha, sourceHash); },
    acquire() { return { release() { released++; } }; } } });
  f.claim.receipt.source_hash = sourceHash;
  f.options.acquireSource = async (job, options) => {
    assert.equal(job, f.claim.job); assert.equal(options.expectedHash, sourceHash);
    return { source, sourceHash };
  };
  f.options.validateSource = async (bytes, options) => {
    assert.deepEqual(Object.keys(options).sort(), ['signal', 'sourceHash']);
    bytes.fill(0); return { status: 'valid' };
  };
  f.options.storeSource = async (bytes) => {
    assert.deepEqual(bytes, source); return { storage_path: `${id}.py`, sha256: sourceHash };
  };
  assert.deepEqual(await processGithubJob(f.options), { processed: true, recorded: true, reason: 'valid' });
  assert.equal(released, 1);
  const finished = finishCalls(f)[0].args;
  assert.equal(finished.generation, 2); assert.equal(finished.token, token);
  assert.deepEqual(finished.outcome.submission, { storage_path: `${id}.py`, sha256: sourceHash });
  assert.equal(finished.outcome.submission_id, undefined);
  assert.deepEqual(f.calls.filter((c) => c.name === 'progress').map((c) => c.args.status), ['fetching', 'checking']);
});

test('consumer invalid validation never uploads and sanitizes bot messages', async () => {
  const f = fixture({ validateSource: async () => ({ status: 'invalid', error: 'secret source' }),
    storeSource: () => assert.fail('invalid source must not upload') });
  assert.equal((await processGithubJob(f.options)).reason, 'invalid');
  assert.equal(finishCalls(f)[0].args.outcome.error, 'bot_validation_failed');
  assert.ok(!JSON.stringify(f.calls).includes('secret source'));
});

test('consumer source faults become invalid; repository/access errors remain infrastructure', async () => {
  for (const category of ['code', 'repo', 'infrastructure']) {
    const f = fixture({ acquireSource: async () => { throw new GithubArtifactError('private failure', category); } });
    const result = await processGithubJob(f.options);
    assert.equal(result.reason, category === 'code' ? 'invalid' : 'infrastructure');
    assert.equal(finishCalls(f).length, category === 'code' ? 1 : 0);
    assert.ok(!JSON.stringify(f.calls).includes('private failure'));
  }
});

test('consumer malformed claim never guesses identity or lease', async () => {
  for (const mutate of [(f) => { f.claim.receipt.commit_sha = 'b'.repeat(40); },
    (f) => { f.claim.lease.token = null; }, (f) => { f.claim.receipt.source_hash = 'bad'; }]) {
    const f = fixture(); mutate(f);
    assert.equal((await processGithubJob(f.options)).reason, 'invalid_claim');
    assert.deepEqual(f.calls.map((c) => c.name), ['claim']);
  }
});

test('consumer integrity failures and ambiguous validation are infrastructure, not bot faults', async () => {
  for (const overrides of [
    { acquireSource: async () => ({ source, sourceHash: 'a'.repeat(64) }) },
    { validateSource: async () => ({ ok: true }) },
    { validateSource: async () => ({ status: 'infrastructure' }) },
    { storeSource: async () => ({ storage_path: '../bad.py', sha256: sourceHash }) },
    { storeSource: async () => { throw Error('token=secret'); } },
  ]) {
    const f = fixture(overrides);
    assert.equal((await processGithubJob(f.options)).reason, 'infrastructure');
    assert.equal(finishCalls(f).length, 0);
    assert.ok(!JSON.stringify(f.calls).includes('token=secret'));
  }
});

test('consumer lost heartbeat or progress prevents validation/storage/finish/release', async () => {
  for (const phase of ['heartbeat', 'progress']) {
    const f = fixture({ acquireSource: () => assert.fail('must not acquire') });
    f.options.jobApi[`${phase}GithubJob`] = async () => false;
    assert.equal((await processGithubJob(f.options)).reason, 'lease_lost');
    assert.equal(finishCalls(f).length, 0);
    assert.equal(f.calls.some((c) => c.name === 'release'), false);
  }
});

test('consumer heartbeat loss interrupts stalled fetch and aborts its signal', async () => {
  let observedSignal, beats = 0;
  const f = fixture({ heartbeatMs: 5, acquireSource: async (_job, { signal }) => {
    observedSignal = signal; return new Promise(() => {});
  } });
  f.options.jobApi.heartbeatGithubJob = async () => ++beats === 1;
  assert.equal((await processGithubJob(f.options)).reason, 'lease_lost');
  assert.equal(observedSignal.aborted, true);
  assert.equal(finishCalls(f).length, 0);
});

test('consumer external cancellation and deadline abort stalled validation with no stale writes', async () => {
  for (const external of [true, false]) {
    const controller = new AbortController(); let validatorSignal;
    const f = fixture({ operationTimeoutMs: external ? 1000 : 15, signal: controller.signal,
      validateSource: async (_source, { signal }) => {
        validatorSignal = signal;
        if (external) controller.abort();
        return new Promise(() => {});
      } });
    const result = await processGithubJob(f.options);
    assert.equal(result.reason, external ? 'canceled' : 'operation_timeout');
    assert.equal(validatorSignal.aborted, true);
    assert.equal(f.calls.some((c) => ['finish', 'release'].includes(c.name)), false);
  }
});

test('consumer finish envelope: lease_lost hoặc uncertain không release/delete source', async () => {
  for (const uncertain of [true, false]) {
    const f = fixture();
    f.options.jobApi.finishGithubJob = async () => {
      if (uncertain) throw Error('private DB error');
      return { applied: false, alreadyFinished: false, leaseLost: true };
    };
    assert.equal((await processGithubJob(f.options)).reason, uncertain ? 'completion_unknown' : 'lease_lost');
    assert.equal(f.calls.some((c) => c.name === 'release'), false);
  }

  // already_finished: lần trước đã commit nhưng mất response -> coi là đã ghi.
  const f = fixture();
  f.options.jobApi.finishGithubJob = async () => ({ applied: false, alreadyFinished: true, leaseLost: false,
    receipt: { status: 'valid', submission_id: id } });
  assert.deepEqual(await processGithubJob(f.options), { processed: true, recorded: true, reason: 'valid' });
});

test('consumer integrates actual RPC wrappers, pinned GitHub fetch and filesystem cache over mocked network', async (t) => {
  const f = fixture(), previousFetch = globalThis.fetch;
  const env = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'].map((key) => [key, process.env[key]]);
  process.env.SUPABASE_URL = 'https://consumer-test.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture-key';
  const root = mkdtempSync(path.join(tmpdir(), 'oot-consumer-')), cache = createSourceCache({ root });
  t.after(() => {
    globalThis.fetch = previousFetch; cache.close(); rmSync(root, { recursive: true, force: true });
    for (const [key, value] of env) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  });
  const blob = createHash('sha1').update(`blob ${source.length}\0`).update(source).digest('hex');
  const tree = 'b'.repeat(40), paths = [];
  globalThis.fetch = async (url, options) => {
    const target = new URL(url); paths.push(target.pathname);
    let response;
    if (target.origin === 'https://consumer-test.invalid') {
      const name = target.pathname.split('/').at(-1), args = JSON.parse(options.body);
      if (name === 'mvp_github_claim') response = { ...f.claim,
        lease: { token, generation: 2, expires_at: '2026-10-24T12:00:00Z', attempt: 1 } };
      else {
        assert.equal(args.p_job, id); assert.equal(args.p_token, token); assert.equal(args.p_generation, 2);
        if (name === 'mvp_github_finish') {
          assert.equal(args.p_outcome.status, 'valid');
          assert.equal(args.p_outcome.submission.sha256, sourceHash);
          response = { ok: true, applied: true, already_finished: false };
        } else {
          assert.ok(['mvp_github_heartbeat', 'mvp_github_progress'].includes(name));
          response = true;
        }
      }
    } else {
      assert.equal(target.origin, 'https://api.github.com');
      if (target.pathname === '/repos/team/bot') response = { id: 123 };
      else if (target.pathname.endsWith(`/git/commits/${f.claim.job.commit_sha}`)) response = { sha: f.claim.job.commit_sha, tree: { sha: tree } };
      else if (target.pathname.endsWith(`/git/trees/${tree}`)) response = { sha: tree, truncated: false,
        tree: [{ path: 'bot.py', mode: '100644', type: 'blob', size: source.length, sha: blob }] };
      else if (target.pathname.endsWith(`/git/blobs/${blob}`)) response = { sha: blob, encoding: 'base64', size: source.length, content: source.toString('base64') };
      else assert.fail('unexpected network path');
    }
    return new Response(JSON.stringify(response), { headers: { 'content-type': 'application/json' } });
  };
  const { jobApi, acquireSource, ...options } = f.options;
  assert.equal((await processGithubJob({ ...options, cache })).reason, 'valid');
  assert.deepEqual(cache.read(sourceHash), source);
  assert.equal(paths.filter((p) => p.startsWith('/repos/')).length, 4);
  assert.equal(paths.filter((p) => p.endsWith('/mvp_github_finish')).length, 1);
  assert.ok(!paths.some((p) => p.includes('/commits/main')));
});