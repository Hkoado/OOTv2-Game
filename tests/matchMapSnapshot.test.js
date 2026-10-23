/**
 * Test map snapshot theo ván cho runtime MVP dùng chung (Supabase):
 * - Snapshot + hash canonical ổn định, bỏ nhãn `id`/`revision`, chuẩn hoá ô cản.
 * - Đọc lại snapshot: ưu tiên map của ván, fallback map của giải, chặn hash lệch/hỏng.
 * - Request setup/move chỉ mang `map`/`map_hash` khi ván có snapshot.
 * - `runMatch` gắn cùng map/hash vào replay (setup -> move -> replay khớp nhau).
 * Chạy: `node --test tests/matchMapSnapshot.test.js`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { EMPTY_MAP, normalizeMap } from '../src/game/maps.js';
import { mapHash } from '../server/contracts/canonical.js';
import { matchMapSnapshot, resolveMatchMap } from '../server/contracts/mapSnapshot.js';
import {
  PLAYERS,
  buildMoveRequest,
  buildSetupRequest,
  createTournamentGame,
} from '../server/judge/gameAdapter.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const BLOCKED_MAP = { ...EMPTY_MAP, blocked: ['e4', 'e6'] };

test('map snapshot: hash canonical bỏ nhãn map và chuẩn hoá ô cản', () => {
  const a = matchMapSnapshot({ ...BLOCKED_MAP, blocked: ['e6', 'e4'] });
  const b = matchMapSnapshot({ ...BLOCKED_MAP, id: 'arena-v2', revision: 9 });

  assert.equal(a.hash, b.hash, 'id/revision không được làm đổi hash nội dung');
  assert.match(a.hash, /^[0-9a-f]{64}$/u);
  assert.deepEqual(JSON.parse(a.json).blocked, ['e4', 'e6']);
  assert.equal(JSON.parse(b.json).id, 'arena-v2', 'nhãn map vẫn được giữ trong snapshot');
  assert.notEqual(a.hash, mapHash(EMPTY_MAP));

  const empty = matchMapSnapshot();
  assert.deepEqual(empty, matchMapSnapshot(EMPTY_MAP), 'thiếu map => bàn mở MVP');
  assert.deepEqual(JSON.parse(empty.json), normalizeMap(EMPTY_MAP));
});

test('resolveMatchMap: ưu tiên snapshot của ván, fallback map giải, chặn hash lệch/hỏng', () => {
  const arena = matchMapSnapshot(EMPTY_MAP);
  const blocked = matchMapSnapshot(BLOCKED_MAP);

  const fromMatch = resolveMatchMap({ map_json: blocked.json, map_hash: blocked.hash, eventMapJson: arena.json });
  assert.equal(fromMatch.error, null);
  assert.equal(fromMatch.source, 'match');
  assert.equal(fromMatch.hash, blocked.hash);
  assert.deepEqual(fromMatch.map.blocked, ['e4', 'e6']);

  // Ván tạo trước migration: map_json NULL => dùng map hiện tại của giải.
  const legacy = resolveMatchMap({ map_json: null, map_hash: null, eventMapJson: arena.json });
  assert.equal(legacy.error, null);
  assert.equal(legacy.source, 'event');
  assert.equal(legacy.hash, mapHash(EMPTY_MAP));

  // Không có map ở đâu: chạy như profile bàn mở, không coi là lỗi.
  const none = resolveMatchMap({});
  assert.equal(none.map, null);
  assert.equal(none.error, null);

  // Sửa tay map_json hoặc map_hash đều phải bị phát hiện.
  assert.ok(resolveMatchMap({ map_json: blocked.json, map_hash: arena.hash }).error?.includes('map_hash'));
  assert.ok(resolveMatchMap({ map_json: '{oops', map_hash: arena.hash }).error);
  assert.ok(resolveMatchMap({ map_json: '{"geometry":"nope"}', map_hash: arena.hash }).error);
});

test('request setup/move chỉ mang map khi ván có snapshot', () => {
  const state = createTournamentGame('map-request-test');

  const setup = buildSetupRequest(state, PLAYERS.RED, 7, EMPTY_MAP);
  assert.deepEqual(setup.map, normalizeMap(EMPTY_MAP));
  assert.equal(setup.map_hash, mapHash(EMPTY_MAP));

  const plainSetup = buildSetupRequest(state, PLAYERS.RED, 7);
  assert.equal('map' in plainSetup, false);
  assert.equal('map_hash' in plainSetup, false);

  const move = buildMoveRequest(state, PLAYERS.RED, 7, 1, BLOCKED_MAP);
  assert.deepEqual(move.map.blocked, ['e4', 'e6']);
  assert.equal(move.map_hash, mapHash(BLOCKED_MAP));
  assert.equal('map' in buildMoveRequest(state, PLAYERS.RED, 7, 1), false);
});

test('runMatch: replay mang đúng map/hash của ván', async (t) => {
  // Bot phải nằm trong artifact cache (`data/cache`) như luồng thật, nên đổi data dir
  // sang thư mục tạm TRƯỚC khi import module server (config đọc env lúc import).
  const dataDir = mkdtempSync(path.join(tmpdir(), 'oot-map-snapshot-'));
  const cacheDir = path.join(dataDir, 'cache');
  mkdirSync(cacheDir, { recursive: true });
  const botPath = path.join(cacheDir, 'bot_illegal.py');
  copyFileSync(path.join(here, 'fixtures', 'bot_illegal_move.py'), botPath);
  const previousDataDir = process.env.OOTV2_DATA_DIR;
  process.env.OOTV2_DATA_DIR = dataDir;
  try {
    const { resolvePython } = await import('../server/judge/botRunner.js');
    if (!resolvePython()) {
      t.skip('Không tìm thấy Python 3 trên máy để chạy trận thật');
      return;
    }
    const { runMatch } = await import('../server/judge/matchRunner.js');

    const matchId = '00000000-0000-4000-8000-000000000001';
    const snapshot = matchMapSnapshot(EMPTY_MAP);
    const bots = { red: { name: 'Đỏ', filePath: botPath }, blue: { name: 'Xanh', filePath: botPath } };

    const withMap = await runMatch({ matchId, seed: 11, map: EMPTY_MAP, ...bots });
    assert.equal(withMap.reason, 'forfeit_move');
    assert.deepEqual(withMap.replay.map, normalizeMap(EMPTY_MAP));
    assert.equal(withMap.replay.map_hash, snapshot.hash);
    assert.equal(withMap.replay.match_id, matchId);

    // Ván không có snapshot (dữ liệu cũ) giữ nguyên replay như trước migration.
    const legacy = await runMatch({ matchId, seed: 12, ...bots });
    assert.equal(legacy.reason, 'forfeit_move');
    assert.equal('map' in legacy.replay, false);
    assert.equal('map_hash' in legacy.replay, false);
  } finally {
    if (previousDataDir === undefined) delete process.env.OOTV2_DATA_DIR;
    else process.env.OOTV2_DATA_DIR = previousDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  }
});

