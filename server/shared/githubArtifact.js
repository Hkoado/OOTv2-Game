/** K3 source acquisition. Consumes H1 internal job identity, never mutable HEAD.
 * No DB writes, Python, clone, arbitrary URL, or trust/sandbox attestation here.
 */
import { createHash } from 'node:crypto';
import config from '../config.js';
import { parseRepository } from '../services/githubRepo.js';

export class GithubArtifactError extends Error {
  constructor(code, category = 'infrastructure') {
    super(`GitHub artifact: ${code}`);
    this.name = 'GithubArtifactError'; this.code = code; this.category = category;
  }
}
const fail = (code, category) => { throw new GithubArtifactError(code, category); };
const sha = (value) => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const sourceLimit = 256 * 1024;

/** job must come from a trusted H1 claim/receipt, NOT a browser payload.
 * ExpectedHash is optional on first acquisition, mandatory when restoring pinned source.
 * timeoutMs bounds the entire metadata/commit/tree/blob pipeline, including body reads.
 */
export async function fetchGithubArtifact(job, { fetchImpl = globalThis.fetch, token = config.github.token,
  timeoutMs = 20000, signal, expectedHash } = {}) {
  if (!job || !Number.isSafeInteger(job.repo_id) || job.repo_id < 1 || !sha(job.commit_sha)
    || job.file_path !== 'bot.py' || (expectedHash !== undefined && !/^[a-f0-9]{64}$/.test(expectedHash))) {
    fail('invalid_identity');
  }
  let repo;
  try { repo = parseRepository(job.repository); } catch { fail('invalid_identity'); }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 20000) fail('invalid_budget');
  const controller = new AbortController();
  let stopError, rejectStop;
  const stopped = new Promise((_, reject) => { rejectStop = reject; });
  const stop = (code) => {
    if (stopError) return;
    stopError = new GithubArtifactError(code); controller.abort(); rejectStop(stopError);
  };
  const onAbort = () => stop('canceled');
  const race = (promise) => Promise.race([promise, stopped]);
  const discard = (body) => { if (body && !body.locked) body.cancel().catch(() => {}); };
  const base = `https://api.github.com/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`;
  let timer;
  async function get(suffix, limit) {
    let response, reader;
    try {
      if (stopError) throw stopError;
      const pending = fetchImpl(base + suffix, { method: 'GET', redirect: 'error', signal: controller.signal,
        headers: { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28',
          'user-agent': 'ootv2-worker', ...(token ? { authorization: `Bearer ${token}` } : {}) } });
      Promise.resolve(pending).then((late) => { if (controller.signal.aborted) discard(late.body); }, () => {});
      response = await race(pending);
      if (stopError) throw stopError;
      if (response.redirected || (response.status >= 300 && response.status < 400)) fail('redirect_rejected');
      if (response.status === 429 || (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0')) fail('rate_limited');
      if ([401, 403, 404].includes(response.status)) fail('repository_unavailable');
      if (!response.ok) fail('upstream_unavailable');
      const length = response.headers.get('content-length');
      if (length !== null && (!/^\d+$/.test(length) || Number(length) > limit)) fail('metadata_limit');
      if (!response.body) fail('bad_response');
      reader = response.body.getReader();
      const output = Buffer.allocUnsafe(limit); let size = 0;
      while (true) {
        const { done, value } = await race(reader.read());
        if (stopError) throw stopError;
        if (done) break;
        if (!(value instanceof Uint8Array) || value.byteLength > limit - size) fail('metadata_limit');
        output.set(value, size); size += value.byteLength;
      }
      if (length !== null && Number(length) !== size) fail('bad_response');
      try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(output.subarray(0, size))); }
      catch { fail('bad_response'); }
    } finally {
      if (reader) reader.cancel().catch(() => {}); else discard(response?.body);
    }
  }
  try {
    if (signal?.aborted) fail('canceled');
    signal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => stop('timeout'), timeoutMs);
    const identity = await get('', 65536);
    if (identity?.id !== job.repo_id) fail('repository_identity_changed', 'repo');
    const commit = await get(`/git/commits/${job.commit_sha}`, 256 * 1024);
    if (commit?.sha !== job.commit_sha || !sha(commit?.tree?.sha)) fail('commit_integrity');
    const tree = await get(`/git/trees/${commit.tree.sha}`, 1024 * 1024);
    if (tree?.sha !== commit.tree.sha || tree.truncated !== false || !Array.isArray(tree.tree)) fail('tree_incomplete');
    const entries = tree.tree.filter((entry) => entry.path === 'bot.py');
    if (entries.length === 0) fail('bot_file_missing', 'code');
    if (entries.length !== 1) fail('tree_integrity');
    const entry = entries[0];
    // An executable bit on a .py source remains a regular file. Reject links/submodules/trees.
    if (entry.type !== 'blob' || !['100644', '100755'].includes(entry.mode)) fail('not_regular_file', 'code');
    if (!Number.isSafeInteger(entry.size) || entry.size < 1 || entry.size > sourceLimit) fail('source_size', 'code');
    if (!sha(entry.sha)) fail('tree_integrity');
    const blob = await get(`/git/blobs/${entry.sha}`, 400 * 1024);
    if (blob?.sha !== entry.sha || blob.encoding !== 'base64' || blob.size !== entry.size || typeof blob.content !== 'string') fail('blob_integrity');
    const encoded = blob.content.replace(/[\r\n]/g, '');
    if (encoded.length !== 4 * Math.ceil(entry.size / 3) || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) fail('blob_encoding');
    const source = Buffer.from(encoded, 'base64');
    if (source.length !== entry.size || source.toString('base64') !== encoded) fail('blob_integrity');
    const gitHash = createHash('sha1').update(`blob ${source.length}\0`).update(source).digest('hex');
    if (gitHash !== entry.sha) fail('blob_integrity');
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(source); } catch { fail('source_utf8', 'code'); }
    if (source.includes(0)) fail('source_binary', 'code');
    if (text.startsWith('version https://git-lfs.github.com/spec/v1')) fail('lfs_pointer', 'code');
    const sourceHash = createHash('sha256').update(source).digest('hex');
    if (expectedHash !== undefined && sourceHash !== expectedHash) fail('pinned_hash_mismatch');
    return { source, sourceHash, size: source.length, repoId: job.repo_id, commitSha: job.commit_sha,
      blobSha: entry.sha, filePath: 'bot.py', sourceKind: 'github' };
  } catch (error) {
    if (stopError) throw stopError;
    if (error instanceof GithubArtifactError) throw error;
    // Never leak source, private remote errors or credentials into receipts/logs.
    throw new GithubArtifactError('transport_failure');
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', onAbort); controller.abort();
  }
}