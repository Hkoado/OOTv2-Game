import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { request, cacheRoot } from './client.js';
import config from '../config.js';

const bucket = 'ootv2-bots';
export function hashBuffer(buffer) { return createHash('sha256').update(buffer).digest('hex'); }
export async function uploadArtifact(id, buffer) {
  const key = `${id}.py`;
  await request(`/storage/v1/object/${bucket}/${key}`, { method: 'POST', body: buffer, headers: { 'Content-Type': 'application/octet-stream', 'x-upsert': 'false' } });
  return key;
}
export async function materialize(submission) {
  if (!/^[0-9a-f-]{36}\.py$/.test(submission.storage_path)) throw new Error('Invalid artifact key');
  const data = await request(`/storage/v1/object/${bucket}/${submission.storage_path}`, { raw: true });
  if (data.length > config.limits.maxSourceBytes || hashBuffer(data) !== submission.sha256) throw new Error('Artifact integrity mismatch');
  return temporaryBot(data);
}
export function temporaryBot(buffer) {
  mkdirSync(cacheRoot, { recursive: true });
  const file = path.join(cacheRoot, `${randomUUID()}.py`);
  writeFileSync(file, buffer, { flag: 'wx', mode: 0o600 });
  return { file, cleanup: () => rmSync(file, { force: true }) };
}