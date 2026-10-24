import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { downloadStorageArtifact } from '../server/shared/artifactDownload.js';
import { storeVerifiedSource } from '../server/shared/artifactUpload.js';

const key = '00000000-0000-4000-8000-000000000001.py';
function setup(t, fetcher) {
  const original = globalThis.fetch;
  const values = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'].map((name) => [name, process.env[name]]);
  process.env.SUPABASE_URL = 'https://artifact-test.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'private-test-token';
  globalThis.fetch = fetcher;
  t.after(() => {
    globalThis.fetch = original;
    for (const [name, value] of values) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  });
}

test('bounded Storage download uses fixed bucket, no redirects; exact size accepted without arrayBuffer', async (t) => {
  setup(t, async (url, options) => {
    assert.equal(url, `https://artifact-test.invalid/storage/v1/object/ootv2-bots/${key}`);
    assert.equal(options.redirect, 'error'); assert.equal(options.method, 'GET');
    assert.equal(options.headers.Authorization, 'Bearer private-test-token');
    const response = new Response(Buffer.alloc(256 * 1024, 32));
    response.arrayBuffer = () => assert.fail('must stream, not buffer entire response');
    return response;
  });
  assert.equal((await downloadStorageArtifact(key, { maxBytes: 256 * 1024 })).length, 256 * 1024);
});

test('bounded Storage rejects invalid identities/budgets before network', async (t) => {
  setup(t, () => assert.fail('network must not run'));
  for (const bad of ['../bot.py', 'https://evil.invalid/bot.py', '-'.repeat(36) + '.py', key + '?secret=1']) {
    await assert.rejects(downloadStorageArtifact(bad, { maxBytes: 100 }), { code: 'invalid_key' });
  }
  for (const maxBytes of [0, -1, 1.5, 262145, Infinity]) {
    await assert.rejects(downloadStorageArtifact(key, { maxBytes }), { code: 'invalid_budget' });
  }
  process.env.SUPABASE_URL = 'https://user:password@artifact-test.invalid';
  await assert.rejects(downloadStorageArtifact(key, { maxBytes: 100 }), { code: 'storage_configuration' });
});

test('declared oversize rejected without reading body; body canceled', async (t) => {
  let canceled = false, pulled = false;
  setup(t, async () => new Response(new ReadableStream({
    pull() { pulled = true; }, cancel() { canceled = true; },
  }, { highWaterMark: 0 }), { headers: { 'Content-Length': '262145' } }));
  await assert.rejects(downloadStorageArtifact(key, { maxBytes: 262144 }), { code: 'source_size_limit' });
  assert.equal(canceled, true); assert.equal(pulled, false);
});

test('chunked source without length stops at crossing budget, not EOF', async (t) => {
  let pulls = 0, canceled = false;
  setup(t, async () => new Response(new ReadableStream({
    pull(controller) { pulls++; controller.enqueue(new Uint8Array(64)); },
    cancel() { canceled = true; },
  }, { highWaterMark: 0 })));
  await assert.rejects(downloadStorageArtifact(key, { maxBytes: 100 }), { code: 'source_size_limit' });
  assert.equal(pulls, 2); assert.equal(canceled, true);
});

test('lying/invalid length and empty sources rejected', async (t) => {
  setup(t, async () => new Response('abc', { headers: { 'Content-Length': '2' } }));
  await assert.rejects(downloadStorageArtifact(key, { maxBytes: 100 }), { code: 'source_size_mismatch' });
  globalThis.fetch = async () => new Response('abc', { headers: { 'Content-Length': 'nope' } });
  await assert.rejects(downloadStorageArtifact(key, { maxBytes: 100 }), { code: 'source_size_limit' });
  globalThis.fetch = async () => new Response('');
  await assert.rejects(downloadStorageArtifact(key, { maxBytes: 100 }), { code: 'empty_source' });
});

test('deadline bounds stalled fetch and stalled body, including cancel that never settles', async (t) => {
  setup(t, () => new Promise(() => {}));
  await assert.rejects(downloadStorageArtifact(key, { maxBytes: 100, timeoutMs: 30 }), { code: 'download_timeout' });
  let canceled = false;
  globalThis.fetch = async () => new Response(new ReadableStream({
    pull() {}, cancel() { canceled = true; return new Promise(() => {}); },
  }));
  await assert.rejects(downloadStorageArtifact(key, { maxBytes: 100, timeoutMs: 30 }), { code: 'download_timeout' });
  assert.equal(canceled, true);
});

test('AbortSignal cancels preflight and an in-flight read', async (t) => {
  setup(t, () => assert.fail('already-aborted fetch'));
  await assert.rejects(downloadStorageArtifact(key, { maxBytes: 100, signal: AbortSignal.abort() }), { code: 'download_cancelled' });
  const controller = new AbortController();
  globalThis.fetch = async () => new Response(new ReadableStream({ pull() { controller.abort(); } }));
  await assert.rejects(downloadStorageArtifact(key, { maxBytes: 100, signal: controller.signal }), { code: 'download_cancelled' });
});

test('network/HTTP/redirect/stream failures never expose upstream credentials or source', async (t) => {
  setup(t, async () => { throw new Error('private-test-token private-source'); });
  const safe = (error) => !/private-test-token|private-source/.test(error.message);
  await assert.rejects(downloadStorageArtifact(key, { maxBytes: 100 }), safe);
  for (const status of [302, 403, 404, 429, 500]) {
    globalThis.fetch = async () => new Response('private-test-token private-source', { status });
    await assert.rejects(downloadStorageArtifact(key, { maxBytes: 100 }), safe);
  }
  globalThis.fetch = async () => new Response(new ReadableStream({ start(c) { c.error(new Error('private-source')); } }));
  await assert.rejects(downloadStorageArtifact(key, { maxBytes: 100 }), safe);
});

test('materialize verifies hash before creating file, cleans up and keeps signature compatible', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'oot-bounded-artifact-'));
  const oldDataDir = process.env.OOTV2_DATA_DIR;
  process.env.OOTV2_DATA_DIR = dir;
  t.after(() => {
    if (oldDataDir === undefined) delete process.env.OOTV2_DATA_DIR; else process.env.OOTV2_DATA_DIR = oldDataDir;
    rmSync(dir, { recursive: true, force: true });
  });
  const source = Buffer.from('print("trusted fixture")\n');
  setup(t, async () => new Response(source));
  const { materialize, hashBuffer } = await import('../server/shared/artifacts.js');
  await assert.rejects(materialize({ storage_path: key, sha256: 'bad' }), { code: 'invalid_hash' });
  await assert.rejects(materialize({ storage_path: key, sha256: '0'.repeat(64) }), { code: 'source_hash_mismatch' });
  assert.deepEqual(readdirSync(dir), []);
  const local = await materialize({ storage_path: key, sha256: hashBuffer(source) });
  assert.deepEqual(readFileSync(local.file), source);
  local.cleanup(); local.cleanup();
  assert.deepEqual(readdirSync(path.join(dir, 'cache')), []);
});

test('validation worker keeps uploaded candidate on bounded download failure; no invalid/valid write', async (t) => {
  const calls = [];
  setup(t, async (url, options = {}) => {
    const target = new URL(url); calls.push({ target, options });
    assert.equal(target.origin, 'https://artifact-test.invalid');
    if (target.pathname === '/rest/v1/mvp_submissions' && (options.method ?? 'GET') === 'GET') {
      return Response.json([{ id: 'pending-fixture', storage_path: key, sha256: '0'.repeat(64) }]);
    }
    if (target.pathname.startsWith('/storage/v1/object/')) {
      return new Response('oversized', { headers: { 'Content-Length': '999999' } });
    }
    assert.fail('must not run validation, write DB or award results after failed retrieval');
  });
  const { validatePendingSubmissions } = await import('../server/shared/worker.js');
  assert.equal(await validatePendingSubmissions({ limit: 1 }), 0);
  assert.equal(calls.length, 2);
  assert.equal(calls.some(({ options }) => ['PATCH', 'POST'].includes(options.method)), false);
});

// Upload adapter shares the same test origin/credential as the download transport.
const upload = Buffer.from('trusted source, not executed\n');
const uploadHash = createHash('sha256').update(upload).digest('hex');

test('verified upload uses private UUID key, no upsert/redirect, reads back same bytes/hash', async (t) => {
  const calls = []; let discarded = false;
  setup(t, async (url, options) => {
    calls.push({ url, options });
    assert.equal(new URL(url).origin, 'https://artifact-test.invalid');
    assert.match(new URL(url).pathname, /^\/storage\/v1\/object\/ootv2-bots\/[a-f0-9-]{36}\.py$/);
    assert.equal(options.redirect, 'error'); assert.equal(options.headers.Authorization, 'Bearer private-test-token');
    if (options.method === 'POST') {
      assert.equal(options.headers['x-upsert'], 'false'); assert.deepEqual(options.body, upload);
      return new Response(new ReadableStream({ cancel() { discarded = true; } }));
    }
    return new Response(upload);
  });
  const result = await storeVerifiedSource(upload, { sourceHash: uploadHash });
  assert.equal(result.sha256, uploadHash); assert.equal(calls.length, 2);
  assert.equal(calls[0].url, calls[1].url); assert.ok(discarded);
  assert.ok(calls[0].url.endsWith(result.storage_path));
});

test('upload rejects invalid bytes, hashes, budgets and credentials before network', async (t) => {
  setup(t, () => assert.fail('no network'));
  for (const bytes of [Buffer.alloc(0), Buffer.alloc(262145), 'text']) {
    await assert.rejects(storeVerifiedSource(bytes, { sourceHash: uploadHash }), { code: 'invalid_source' });
  }
  await assert.rejects(storeVerifiedSource(upload, { sourceHash: 'a'.repeat(64) }), { code: 'invalid_source' });
  for (const timeoutMs of [0, 20001, 1.5]) {
    await assert.rejects(storeVerifiedSource(upload, { sourceHash: uploadHash, timeoutMs }), { code: 'invalid_budget' });
  }
  process.env.SUPABASE_URL = 'https://user:pass@artifact-test.invalid';
  await assert.rejects(storeVerifiedSource(upload, { sourceHash: uploadHash }), { code: 'storage_configuration' });
});

test('failed upload redirect, error body and transport error stay redacted', async (t) => {
  let calls = 0;
  setup(t, async (_url, options) => { calls++; assert.equal(options.method, 'POST'); return new Response('private source/token', { status: 403 }); });
  await assert.rejects(storeVerifiedSource(upload, { sourceHash: uploadHash }), { code: 'upload_rejected' });
  assert.equal(calls, 1);
  globalThis.fetch = async () => new Response(null, { status: 302, headers: { location: 'https://evil.invalid' } });
  await assert.rejects(storeVerifiedSource(upload, { sourceHash: uploadHash }), { code: 'upload_rejected' });
  globalThis.fetch = async () => { throw Error('private credential'); };
  await assert.rejects(storeVerifiedSource(upload, { sourceHash: uploadHash }), (error) => error.code === 'upload_unavailable' && !error.message.includes('credential'));
});

test('successful upload with corrupt readback never returns an accepted reference', async (t) => {
  setup(t, async (_url, options) => options.method === 'POST' ? new Response('{}') : new Response('tampered'));
  await assert.rejects(storeVerifiedSource(upload, { sourceHash: uploadHash }), { code: 'upload_integrity' });
});

test('upload deadline and abort bound stalled POST/readback even if fetch ignores signal', async (t) => {
  setup(t, async () => new Promise(() => {}));
  await assert.rejects(storeVerifiedSource(upload, { sourceHash: uploadHash, timeoutMs: 15 }), { code: 'upload_timeout' });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(storeVerifiedSource(upload, { sourceHash: uploadHash, signal: controller.signal }), { code: 'upload_cancelled' });
  let observedSignal;
  globalThis.fetch = async (_url, options) => {
    if (options.method === 'POST') return new Response('{}');
    observedSignal = options.signal; return new Promise(() => {});
  };
  await assert.rejects(storeVerifiedSource(upload, { sourceHash: uploadHash, timeoutMs: 15 }), { code: 'upload_timeout' });
  assert.equal(observedSignal.aborted, true);
});

test('upload accepts a max-size source and cancellation mid-upload never retries', async (t) => {
  const bytes = Buffer.alloc(262144, 32), sha = createHash('sha256').update(bytes).digest('hex');
  setup(t, async (_url, options) => options.method === 'POST' ? new Response('{}') : new Response(bytes));
  assert.equal((await storeVerifiedSource(bytes, { sourceHash: sha })).sha256, sha);
  const controller = new AbortController(); let calls = 0;
  globalThis.fetch = async () => { calls++; controller.abort(); return new Response('{}'); };
  await assert.rejects(storeVerifiedSource(upload, { sourceHash: uploadHash, signal: controller.signal }), { code: 'upload_cancelled' });
  assert.equal(calls, 1);
});

test('upload adapter plugs into consumer and finish receives the exact storage reference', async (t) => {
  const id = '11111111-1111-4111-8111-111111111111';
  const token = '22222222-2222-4222-8222-222222222222';
  const job = { id, event_id: id, team_id: id, repo_id: 123, repository: 'https://github.com/team/bot',
    commit_sha: 'a'.repeat(40), file_path: 'bot.py' };
  const calls = [];
  const jobApi = {
    claimGithubJob: async () => ({ job, receipt: { ...job, job_id: id, source_hash: uploadHash },
      lease: { token, generation: 3 } }),
    heartbeatGithubJob: async () => true,
    progressGithubJob: async (args) => { calls.push(['progress', args.status]); return true; },
    finishGithubJob: async (args) => { calls.push(['finish', args.outcome]); return { applied: true }; },
    releaseGithubJob: async () => assert.fail('valid job must not release'),
  };
  setup(t, async (_url, options) => options.method === 'POST' ? new Response('{}') : new Response(upload));
  // Import after env setup: githubConsumer -> client.js caches the configured cache root at load.
  const { processGithubJob } = await import('../server/shared/githubConsumer.js');
  const result = await processGithubJob({ enabled: true, workerId: 'integration-worker', jobApi,
    acquireSource: async () => ({ source: upload, sourceHash: uploadHash }),
    validateSource: async () => ({ status: 'valid' }),
    storeSource: (bytes, options) => storeVerifiedSource(bytes, options) });
  assert.deepEqual(result, { processed: true, recorded: true, reason: 'valid' });
  assert.deepEqual(calls.map(([name, value]) => name === 'progress' ? value : name),
    ['fetching', 'checking', 'finish']);
  const outcome = calls.at(-1)[1];
  assert.equal(outcome.status, 'valid'); assert.equal(outcome.source_hash, uploadHash);
  assert.match(outcome.submission.storage_path, /^[a-f0-9-]{36}\.py$/);
  assert.equal(outcome.submission.sha256, uploadHash); assert.equal(outcome.submission_id, undefined);
});