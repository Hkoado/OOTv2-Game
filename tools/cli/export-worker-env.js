import '../../server/config.js';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { workerEnvironment } from '../production/workerEnvironment.js';

const target = process.argv[2];
if (!target || !path.isAbsolute(target)) throw new Error('absolute_output_path_required');
writeFileSync(target, workerEnvironment(process.env), { flag: 'wx', mode: 0o600 });
console.log('Worker credentials exported with allowlist; values not logged.');