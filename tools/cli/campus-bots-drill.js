/**
 * campus-bots-drill.js — chạy hai bot Campus v2 mẫu trên MỘT map mặc định.
 *
 * - Chỉ dùng trusted-dev (KHÔNG phải sandbox); không ghi DB, không gọi mạng.
 * - Mỗi kịch bản chạy đủ setup kín → đi quân → kết thúc, rồi kiểm chứng replay.
 * - Exit 1 nếu có bot_fault hoặc replay không khớp; exit 0 khi cả hai kịch bản sạch.
 *
 * Usage: node tools/cli/campus-bots-drill.js [--map=<id>] [--seed=<uint32>]
 * Map mặc định là map mặc định của app (SAMPLE_MAPS[0], learn-fire).
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { SAMPLE_MAPS } from '../../src/game/sampleMaps.js';
import { runCampusMatch } from '../../server/judge/campusMatchRunner.js';
import { verifyCampusReplay } from '../../server/replay/campusReplay.js';
import { resolvePython } from '../../server/judge/botRunner.js';

const DEFAULT_MAP_ID = SAMPLE_MAPS[0].map.id;
const DEFAULT_SEED = 20261024;
const root = fileURLToPath(new URL('../../examples/', import.meta.url));
const bots = {
  attack: { allowedRoot: root, filePath: path.join(root, 'campus_bot_attack.py') },
  defense: { allowedRoot: root, filePath: path.join(root, 'campus_bot_defense.py') },
};

function parseArgs(argv) {
  const options = { map: DEFAULT_MAP_ID, seed: DEFAULT_SEED, help: false };
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg.startsWith('--map=')) {
      options.map = arg.slice('--map='.length);
    } else if (arg.startsWith('--seed=')) {
      const seed = Number(arg.slice('--seed='.length));
      if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('Seed must be uint32');
      options.seed = seed;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('Usage: node tools/cli/campus-bots-drill.js [--map=<id>] [--seed=<uint32>]\n'
      + `Maps: ${SAMPLE_MAPS.map((entry) => entry.map.id).join(', ')}`);
    return;
  }
  const entry = SAMPLE_MAPS.find((candidate) => candidate.map.id === options.map);
  if (!entry) {
    throw new Error(`Unknown map "${options.map}". Available: ${SAMPLE_MAPS.map((m) => m.map.id).join(', ')}`);
  }
  if (!resolvePython()) throw new Error('Python unavailable: trusted-dev drill needs Python 3.12+');

  // Mỗi cặp chạy hai chiều màu để kiểm tra setup/move của bot ở cả red và blue.
  const scenarios = [
    { id: 'attack_red--defense_blue', red: bots.attack, blue: bots.defense },
    { id: 'defense_red--attack_blue', red: bots.defense, blue: bots.attack },
  ];
  const results = [];
  let failed = false;
  for (const scenario of scenarios) {
    const outcome = await runCampusMatch({
      id: `drill-${scenario.id}`, map: entry.map, seed: options.seed,
      red: scenario.red, blue: scenario.blue, trusted: true, setupWallMs: 5000, moveWallMs: 2000,
    });
    const verified = verifyCampusReplay(outcome.replay);
    const faults = outcome.replay.events
      .filter((event) => event.action.kind === 'bot_fault')
      .map((event) => ({ seq: event.seq, player: event.action.player, fault: event.action.fault }));
    const ok = verified.ok && faults.length === 0;
    if (!ok) failed = true;
    results.push({
      scenario: scenario.id, result: outcome.result, reason: outcome.reason,
      plies: outcome.plyCount, setupComplete: outcome.plyCount > 0 && faults.length === 0,
      replayVerified: verified.ok, ...(verified.ok ? { replayHash: outcome.replay.contentHash } : { replayError: verified.error }),
      faults, ok,
    });
  }
  console.log(JSON.stringify({ map: entry.map.id, rulesVersion: entry.map.rulesVersion,
    seed: options.seed, scenarios: results, ok: !failed }, null, 2));
  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
