import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SAMPLE_MAPS } from '../../src/game/sampleMaps.js';
for (const { map } of SAMPLE_MAPS) writeFileSync(fileURLToPath(new URL(`../../examples/maps/${map.id}.json`, import.meta.url)), JSON.stringify(map, null, 2) + '\n');