import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { SAMPLE_MAPS } from '../src/game/sampleMaps.js';
import { runCampusMatch } from '../server/judge/campusMatchRunner.js';
import { verifyCampusReplay } from '../server/replay/campusReplay.js';
import { resolvePython } from '../server/judge/botRunner.js';

// Hai bot mẫu + MỘT map mặc định Campus v2 (map mặc định của app: SAMPLE_MAPS[0]).
// Trusted-dev drill, không phải sandbox.
const root = fileURLToPath(new URL('../examples/', import.meta.url));
const bots = {
  attack: { allowedRoot: root, filePath: path.join(root, 'campus_bot_attack.py') },
  defense: { allowedRoot: root, filePath: path.join(root, 'campus_bot_defense.py') },
};
const entry = SAMPLE_MAPS[0];
const skip = resolvePython() ? false : 'Python unavailable: Campus bot drill NOT RUN';
const BOT_FAULT_REASONS = ['INVALID_SETUP', 'ILLEGAL_MOVE', 'PROTOCOL_ERROR', 'INVALID_JSON',
  'OUTPUT_LIMIT', 'BOT_TIMEOUT', 'BOT_CRASH', 'BOT_CPU_LIMIT', 'BOT_MEMORY_LIMIT'];
const faultsOf = (outcome) => outcome.replay.events.filter((event) => event.action.kind === 'bot_fault');

test('two sample bots play one default v2 map: sealed setup, legal moves, verified replay',
  { skip, timeout: 180000 }, async () => {
    assert.ok(entry, 'app default map (SAMPLE_MAPS[0]) must exist');
    assert.equal(entry.map.rulesVersion, 'ott-campus.v2');
    assert.equal(entry.map.id, 'learn-fire', 'SAMPLE_MAPS[0] is the app default map');
    assert.ok(existsSync(bots.attack.filePath), 'missing campus_bot_attack.py');
    assert.ok(existsSync(bots.defense.filePath), 'missing campus_bot_defense.py');

    const outcome = await runCampusMatch({ id: 'bots-default-map', map: entry.map, seed: 20261024,
      red: bots.attack, blue: bots.defense, trusted: true, setupWallMs: 5000, moveWallMs: 2000 });

    assert.deepEqual(faultsOf(outcome), []);
    assert.equal(BOT_FAULT_REASONS.includes(outcome.reason), false, `unexpected reason: ${outcome.reason}`);
    assert.ok(outcome.plyCount > 0, 'bots must actually play');

    const setups = outcome.replay.events.filter((event) => event.action.kind === 'setup');
    assert.deepEqual(setups.map((event) => event.action.player), ['red', 'blue']);
    assert.ok(setups.every((event) => event.action.placements.length === 9), 'each bot places all 9 pieces');

    const verified = verifyCampusReplay(outcome.replay);
    assert.equal(verified.ok, true, verified.error);
    assert.equal(outcome.replay.rulesVersion, 'ott-campus.v2');

    // Setup kín: sự kiện setup của Đỏ không được chứa quân Xanh (bot tự xếp, không lộ đối thủ).
    for (const event of setups) {
      const ids = event.action.placements.map((placement) => placement.pieceId);
      assert.equal(new Set(ids).size, 9, 'nine distinct piece IDs');
      assert.ok(ids.every((id) => id.startsWith(event.action.player)), 'only own pieces are placed');
    }
  });

test('sample bots stay legal after swapping colours and replay deterministically',
  { skip, timeout: 180000 }, async () => {
    const config = { id: 'bots-colour-swap', map: entry.map, seed: 7,
      red: bots.defense, blue: bots.attack, trusted: true, setupWallMs: 5000, moveWallMs: 2000 };
    const first = await runCampusMatch(config);
    const second = await runCampusMatch(config);
    for (const outcome of [first, second]) {
      assert.deepEqual(faultsOf(outcome), []);
      const verified = verifyCampusReplay(outcome.replay);
      assert.equal(verified.ok, true, verified.error);
      assert.ok(['red_win', 'blue_win', 'draw'].includes(outcome.result));
    }
    assert.equal(first.replay.contentHash, second.replay.contentHash,
      'same map/seed/bots must reproduce the same replay');
  });
