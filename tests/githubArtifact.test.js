import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fetchGithubArtifact } from '../server/shared/githubArtifact.js';

const commitSha = 'a'.repeat(40), treeSha = 'b'.repeat(40);
const job = { repo_id: 123, repository: 'https://github.com/team/bot', file_path: 'bot.py', commit_sha: commitSha, branch: 'changed-head' };
function fixture(source = Buffer.from('print("hello")\n'), mutate = () => {}) {
  const blobSha = createHash('sha1').update(`blob ${source.length}\0`).update(source).digest('hex');
  const bodies = [{ id: 123 }, { sha: commitSha, tree: { sha: treeSha } },
    { sha: treeSha, truncated: false, tree: [{ path: 'bot.py', mode: '100644', type: 'blob', size: source.length, sha: blobSha }] },
    { sha: blobSha, size: source.length, encoding: 'base64', content: source.toString('base64') }];
  mutate(bodies); const calls = [];
  return { calls, bodies, source, blobSha, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    assert.equal(new URL(url).origin, 'https://api.github.com');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.authorization, 'Bearer fixture-secret');
    const body = bodies[calls.length - 1];
    assert.ok(body, 'no unexpected fifth request');
    return Response.json(body);
  } };
}
const run = (f, options = {}) => fetchGithubArtifact(job, { fetchImpl: f.fetchImpl, token: 'fixture-secret', ...options });

test('H1 job -> exact commit/tree/blob source; never reads branch HEAD or arbitrary download URL', async () => {
  const f = fixture();
  const result = await run(f);
  assert.deepEqual(result.source, f.source);
  assert.equal(result.sourceHash, createHash('sha256').update(f.source).digest('hex'));
  assert.equal(result.blobSha, f.blobSha); assert.equal(result.commitSha, job.commit_sha);
  assert.deepEqual(f.calls.map(({ url }) => new URL(url).pathname), ['/repos/team/bot',
    `/repos/team/bot/git/commits/${commitSha}`, `/repos/team/bot/git/trees/${treeSha}`, `/repos/team/bot/git/blobs/${f.blobSha}`]);
  assert.equal(JSON.stringify(result).includes('fixture-secret'), false);
});

test('source at 256 KiB accepted; pinned source requires same SHA256 on restore', async () => {
  const f = fixture(Buffer.alloc(256 * 1024, 32));
  const result = await run(f);
  assert.equal(result.size, 256 * 1024);
  assert.equal((await run(fixture(f.source), { expectedHash: result.sourceHash })).sourceHash, result.sourceHash);
  await assert.rejects(run(fixture(), { expectedHash: '0'.repeat(64) }), { code: 'pinned_hash_mismatch', category: 'infrastructure' });
});

test('invalid H1 identity rejected without network', async () => {
  for (const patch of [{ repo_id: 0 }, { repo_id: '123' }, { commit_sha: 'main' }, { file_path: 'other.py' },
    { repository: 'https://evil.invalid/team/bot' }]) {
    await assert.rejects(fetchGithubArtifact({ ...job, ...patch }, { fetchImpl: () => assert.fail() }), { code: 'invalid_identity' });
  }
});

for (const [label, mutate, code, category] of [
  ['repo replaced', (b) => { b[0].id = 456; }, 'repository_identity_changed', 'repo'],
  ['wrong commit', (b) => { b[1].sha = 'c'.repeat(40); }, 'commit_integrity', 'infrastructure'],
  ['truncated tree', (b) => { b[2].truncated = true; }, 'tree_incomplete', 'infrastructure'],
  ['missing file', (b) => { b[2].tree = []; }, 'bot_file_missing', 'code'],
  ['symlink', (b) => { b[2].tree[0].mode = '120000'; }, 'not_regular_file', 'code'],
  ['submodule', (b) => { b[2].tree[0].type = 'commit'; b[2].tree[0].mode = '160000'; }, 'not_regular_file', 'code'],
  ['directory', (b) => { b[2].tree[0].type = 'tree'; b[2].tree[0].mode = '040000'; }, 'not_regular_file', 'code'],
  ['oversize', (b) => { b[2].tree[0].size = 262145; }, 'source_size', 'code'],
  ['blob content changed', (b) => { b[3].content = Buffer.alloc(b[3].size, 32).toString('base64'); }, 'blob_integrity', 'infrastructure'],
  ['bad encoding', (b) => { b[3].encoding = 'none'; }, 'blob_integrity', 'infrastructure'],
]) {
  test(`GitHub artifact ${label} -> ${code}`, async () => {
    await assert.rejects(run(fixture(undefined, mutate)), { code, category });
  });
}

test('source UTF8/binary/LFS rejected without execution; executable Python mode remains regular source', async () => {
  for (const [bytes, code] of [[Buffer.from([0xff]), 'source_utf8'], [Buffer.from([0]), 'source_binary'],
    [Buffer.from('version https://git-lfs.github.com/spec/v1\noid sha256:abc\n'), 'lfs_pointer']]) {
    await assert.rejects(run(fixture(bytes)), { code, category: 'code' });
  }
  assert.equal((await run(fixture(undefined, (b) => { b[2].tree[0].mode = '100755'; }))).sourceKind, 'github');
});

test('metadata streaming budget cancels body without buffering an unbounded response', async () => {
  let canceled = false, reads = 0;
  const fetchImpl = async () => new Response(new ReadableStream({
    pull(c) { reads++; c.enqueue(Buffer.alloc(65536)); }, cancel() { canceled = true; },
  }, { highWaterMark: 0 }));
  await assert.rejects(fetchGithubArtifact(job, { fetchImpl }), { code: 'metadata_limit' });
  assert.equal(reads, 2); assert.equal(canceled, true);
});

test('whole-operation deadline and cancellation bound stalled fetch/body', async () => {
  await assert.rejects(fetchGithubArtifact(job, { timeoutMs: 25, fetchImpl: () => new Promise(() => {}) }), { code: 'timeout' });
  await assert.rejects(fetchGithubArtifact(job, { timeoutMs: 25, fetchImpl: async () => new Response(new ReadableStream({ pull() {} })) }), { code: 'timeout' });
  await assert.rejects(fetchGithubArtifact(job, { signal: AbortSignal.abort(), fetchImpl: () => assert.fail() }), { code: 'canceled' });
});

test('network/access/rate/redirect failures are infrastructure, redact private remote error', async () => {
  for (const status of [301, 401, 403, 404, 429, 500]) {
    await assert.rejects(fetchGithubArtifact(job, { fetchImpl: async () => new Response('fixture-secret source', { status }) }),
      (error) => error.category === 'infrastructure' && !error.message.includes('fixture-secret'));
  }
  await assert.rejects(fetchGithubArtifact(job, { fetchImpl: async () => { throw new Error('fixture-secret'); } }), { code: 'transport_failure' });
});