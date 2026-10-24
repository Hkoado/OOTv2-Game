import '../../server/config.js';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { workerEnvironment } from '../production/workerEnvironment.js';

const args = process.argv.slice(2);

try {
  if (args.includes('--check')) {
    // Validation only: never writes or prints credential values.
    workerEnvironment(process.env);
    console.log('worker-env: OK (allowlist validated, values not shown)');
  } else {
    const target = args[0];
    if (!target || !path.isAbsolute(target)) throw new Error('absolute_output_path_required');
    writeFileSync(target, workerEnvironment(process.env), { flag: 'wx', mode: 0o600 });
    console.log('Worker credentials exported with allowlist; values not logged.');
  }
} catch (error) {
  const code = /^[a-z0-9_]+$/i.test(String(error?.message)) ? String(error.message) : 'worker_env_invalid';
  console.error(code);
  process.exitCode = 1;
}
