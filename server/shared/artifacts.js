import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { request, cacheRoot } from './client.js';
import config from '../config.js';
import { downloadStorageArtifact, ArtifactDownloadError } from './artifactDownload.js';

const bucket = 'ootv2-bots';
export function hashBuffer(buffer) { return createHash('sha256').update(buffer).digest('hex'); }
export async function uploadArtifact(id, buffer) {
  const key = `${id}.py`;
  await request(`/storage/v1/object/${bucket}/${key}`, { method: 'POST', body: buffer, headers: { 'Content-Type': 'application/octet-stream', 'x-upsert': 'false' } });
  return key;
}
export async function materialize(submission, { signal, timeoutMs = 20000 } = {}) {
  if (!submission || typeof submission.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(submission.sha256)) {
    throw new ArtifactDownloadError('invalid_hash');
  }
  const data = await downloadStorageArtifact(submission.storage_path, { maxBytes: config.limits.maxSourceBytes, signal, timeoutMs });
  if (hashBuffer(data) !== submission.sha256) throw new ArtifactDownloadError('source_hash_mismatch');
  return temporaryBot(data);
}
export function temporaryBot(buffer) {
  mkdirSync(cacheRoot, { recursive: true });
  const file = path.join(cacheRoot, `${randomUUID()}.py`);
  try {
    writeFileSync(file, buffer, { flag: 'wx', mode: 0o600 });
  } catch (error) {
    // Do not leave partial files after disk-full/write errors. Never unlink an EEXIST file.
    if (error.code !== 'EEXIST') rmSync(file, { force: true });
    throw error;
  }
  return { file, cleanup: () => rmSync(file, { force: true }) };
}