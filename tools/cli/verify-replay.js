import { readFile } from 'node:fs/promises';
import { verifyCampusReplay } from '../../server/replay/campusReplay.js';

try {
  if (process.argv.length !== 3) throw new Error('Usage: node tools/cli/verify-replay.js <campus-engine-replay.json>');
  const checked = verifyCampusReplay(JSON.parse(await readFile(process.argv[2], 'utf8')));
  console.log(JSON.stringify(checked, null, 2));
  if (!checked.ok) process.exitCode = 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
