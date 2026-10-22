import { readFile } from 'node:fs/promises';
import { validateMap } from '../../src/game/maps.js';
import { mapHash } from '../../server/contracts/canonical.js';

try {
  if (process.argv.length !== 3) throw new Error('Usage: node tools/cli/validate-map.js <map.json>');
  const map = JSON.parse(await readFile(process.argv[2], 'utf8'));
  const checked = validateMap(map);
  console.log(JSON.stringify({ ...checked, ...(checked.ok ? { mapHash: mapHash(map) } : {}) }, null, 2));
  if (!checked.ok) process.exitCode = 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
