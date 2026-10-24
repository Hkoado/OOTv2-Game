/**
 * Callbacks cho GitHub cutoff worker. Tách khỏi CLI để service systemd và CLI
 * dùng đúng một implementation — không có đường chạy code thứ hai.
 *
 * Ở đây CHỈ kiểm tra tĩnh + cú pháp Python; không chạy bot, không phải sandbox.
 */
import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import config from '../config.js';
import { storeVerifiedSource } from './artifactUpload.js';
import { checkPythonSyntax, inspectSourceBuffer } from '../services/botValidation.js';

export function validateCutoffSource(source, { signal } = {}) {
  if (signal?.aborted) throw Object.assign(new Error('canceled'), { code: 'canceled' });
  const sourceCheck = inspectSourceBuffer(source);
  if (!sourceCheck.ok) return { status: 'invalid', error: sourceCheck.error };
  const file = path.join(config.artifactCacheDir, `validate-${randomUUID()}.py`);
  try {
    writeFileSync(file, source, { mode: 0o600 });
    const syntax = checkPythonSyntax(file);
    if (syntax.ok) return { status: 'valid' };
    if (syntax.error === 'syntax_error') return { status: 'invalid', error: syntax.error };
    return { status: 'infrastructure', error: syntax.error || 'syntax_check_failed' };
  } finally {
    try {
      unlinkSync(file);
    } catch {
      // Already removed; nothing to clean up.
    }
  }
}

export function storeCutoffSource(source, { sourceHash, signal } = {}) {
  return storeVerifiedSource(source, { sourceHash, signal });
}

/** Prepare the artifact cache once per process, then expose the reviewed callbacks. */
export function createCutoffWorkerDeps() {
  mkdirSync(config.artifactCacheDir, { recursive: true });
  return { validateSource: validateCutoffSource, storeSource: storeCutoffSource };
}
