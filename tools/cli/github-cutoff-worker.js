/**
 * Drain GitHub cutoff jobs: pinned source -> static UTF-8/size check -> Python syntax
 * -> private Storage upload -> receipt valid. It does NOT execute bot code (no smoke test);
 * match execution remains in the sandboxed runner.
 *
 * Usage: node tools/cli/github-cutoff-worker.js [--drain] [--max 50]
 */
import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import '../../server/config.js';
import config from '../../server/config.js';
import { processGithubJob } from '../../server/shared/githubConsumer.js';
import { storeVerifiedSource } from '../../server/shared/artifactUpload.js';
import { checkPythonSyntax, inspectSourceBuffer } from '../../server/services/botValidation.js';

const args = new Set(process.argv.slice(2));
const maxArg = process.argv.indexOf('--max');
const max = maxArg >= 0 ? Math.max(1, Math.min(200, Number(process.argv[maxArg + 1]) || 50)) : 50;
const workerId = `cutoff-${hostname()}-${process.pid}`;

function validateSource(source, { signal } = {}) {
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
    try { unlinkSync(file); } catch { /* already gone */ }
  }
}

async function storeSource(source, { sourceHash, signal }) {
  return storeVerifiedSource(source, { sourceHash, signal });
}

mkdirSync(config.artifactCacheDir, { recursive: true });
const results = [];
for (let index = 0; index < max; index++) {
  const result = await processGithubJob({
    enabled: true, workerId, validateSource, storeSource,
    heartbeatMs: 10000, operationTimeoutMs: 60000,
  });
  results.push(result);
  console.log(JSON.stringify({ workerId, ...result }));
  if (!result.processed) break;
  if (!args.has('--drain')) break;
}
const processed = results.filter((item) => item.processed).length;
console.log(`RESULT processed=${processed} results=${results.length}`);
process.exit(0);
