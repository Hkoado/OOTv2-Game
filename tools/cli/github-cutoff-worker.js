/**
 * Drain GitHub cutoff jobs: pinned source -> static UTF-8/size check -> Python syntax
 * -> private Storage upload -> receipt valid. It does NOT execute bot code (no smoke test);
 * match execution remains in the sandboxed runner.
 *
 * Usage: node tools/cli/github-cutoff-worker.js [--drain] [--max 50]
 */
import '../../server/config.js';
import { processGithubJob } from '../../server/shared/githubConsumer.js';
import { createCutoffWorkerDeps } from '../../server/shared/githubWorkerDeps.js';
import { defaultWorkerId } from '../../server/githubWorker.js';

const args = new Set(process.argv.slice(2));
const maxArg = process.argv.indexOf('--max');
const max = maxArg >= 0 ? Math.max(1, Math.min(200, Number(process.argv[maxArg + 1]) || 50)) : 50;
const workerId = defaultWorkerId('cutoff');
const deps = createCutoffWorkerDeps();

const results = [];
for (let index = 0; index < max; index++) {
  const result = await processGithubJob({
    enabled: true, workerId, ...deps,
    heartbeatMs: 10000, operationTimeoutMs: 60000,
  });
  results.push(result);
  console.log(JSON.stringify({ workerId, ...result }));
  if (!result.processed) break;
  if (!args.has('--drain')) break;
}
const processed = results.filter((item) => item.processed).length;
console.log(`RESULT processed=${processed} results=${results.length}`);
process.exitCode = results.some((item) => item.processed && !item.recorded) ? 1 : 0;
