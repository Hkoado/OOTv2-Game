import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EMPTY_MAP, EMPTY_TERRAIN_MAP, normalizeMap, validateMap } from '../src/game/maps.js';
import { terrainBlocks, upgradeTerrainMap } from '../src/game/terrain.js';
import { paintTerrain } from '../src/game/mapEditor.js';
import { getValidMoves } from '../src/game/rules.js';
import { boardOptions } from '../src/ui/boardAdapter.js';
import { createCampusGame, campusObservation, applyCampusSetup, validateCampusSetup, campusLegalMoves } from '../server/judge/campusEngine.js';
import { buildCampusBotRequest } from '../server/contracts/botProtocol.js';
import { mapHash } from '../server/contracts/canonical.js';
import { recordCampusReplay, verifyCampusReplay } from '../server/replay/campusReplay.js';
import { assignOfficialColors, assignNextOfficialGameColor } from '../server/lib/officialColors.js';
import { nextOfficialGroupGame, computeOfficialGroupStandings } from '../server/lib/officialGroups.js';
import { createOfficialKnockoutSeries, nextOfficialKnockoutGame } from '../server/lib/officialBracket.js';
import { runCampusMatch } from '../server/judge/campusMatchRunner.js';
import { resolvePython } from '../server/judge/botRunner.js';
import { runMatch } from '../server/judge/matchRunner.js';
import { fileURLToPath } from 'node:url';
import { normalizeCompetition } from '../src/game/competition.js';

const mapWith = (terrains) => ({ ...structuredClone(EMPTY_TERRAIN_MAP), terrains });
const piece = (type, square = 'e5') => ({ id: 'p', type, square, player: 'red', alive: true });
const setup = (state, player) => {
  const obs = campusObservation(state, player), used = new Set();
  return obs.unplaced.map((p) => {
    const square = (obs.availableSquaresByType?.[p.type] || obs.availableSquares).find((s) => !used.has(s));
    used.add(square); return { pieceId: p.id, square };
  });
};

test('v2 all four terrains block exactly the requested piece types, including captures', () => {
  for (const [terrain, forbidden] of [['fire', 'paper'], ['water', 'scissors'], ['bush', 'rock'], ['chasm', '*']]) {
    for (const type of ['rock', 'paper', 'scissors']) {
      const map = mapWith({ e6: terrain, e4: terrain });
      const allowed = forbidden !== '*' && type !== forbidden;
      assert.equal(terrainBlocks(map, 'e6', type), !allowed);
      const pieces = { p: piece(type) };
      assert.equal(getValidMoves(pieces, 'p', map).some((m) => m.square === 'e6'), allowed);
      const weaker = { rock: 'scissors', scissors: 'paper', paper: 'rock' }[type];
      pieces.enemy = { ...piece(weaker, 'e6'), id: 'enemy', player: 'blue' };
      assert.equal(getValidMoves(pieces, 'p', map).some((m) => m.square === 'e6'), allowed);
    }
  }
});

test('v2 corner blocking is type-specific; legacy open/blocked behavior is unchanged', () => {
  const map = mapWith({ e6: 'fire', f5: 'fire' });
  assert.equal(getValidMoves({ p: piece('paper') }, 'p', map).some((m) => m.square === 'f6'), false);
  assert.equal(getValidMoves({ p: piece('rock') }, 'p', map).some((m) => m.square === 'f6'), true);
  assert.equal(getValidMoves({ p: piece('paper') }, 'p').length, 8);
  assert.equal(getValidMoves({ p: piece('rock') }, 'p', { blocked: ['e6'] }).length, 7);
});

test('map.v2 validation/hash/editor: strict types, bases, symmetry, routes and canonical terrain order', () => {
  let map = paintTerrain(EMPTY_MAP, 'e4', 'fire');
  assert.equal(validateMap(map).ok, true);
  assert.deepEqual(map.terrains, { e4: 'fire', e6: 'fire' });
  const normalized = normalizeMap(map);
  assert.equal(mapHash(map), mapHash({ ...map, terrains: { e6: 'fire', e4: 'fire' } }));
  assert.notEqual(mapHash(map), mapHash(EMPTY_TERRAIN_MAP));
  for (const bad of [mapWith({ e4: 'fire' }), mapWith({ e5: 'lava' }), mapWith({ a1: 'fire', i9: 'fire' }),
    { ...map, blocked: ['e5'] }, { ...map, terrains: null }, { ...map, unknown: true }]) {
    assert.equal(validateMap(bad).ok, false);
  }
  assert.equal(validateMap(mapWith({ a2: 'fire', b1: 'fire', b2: 'fire', i8: 'fire', h9: 'fire', h8: 'fire' })).ok, false);
  assert.deepEqual(upgradeTerrainMap({ ...EMPTY_MAP, blocked: ['e4', 'e6'] }).terrains, { e4: 'chasm', e6: 'chasm' });
  assert.deepEqual(paintTerrain(map, 'a1', 'chasm'), map);
  map = paintTerrain(map, 'e4', ''); assert.deepEqual(map.terrains, {});
  assert.equal(normalized.rulesVersion, 'ott-campus.v2');
});

test('v2 sealed setup: blue input contains no opponent position/type; v1 replay contract stays intact', () => {
  let state = createCampusGame({ map: mapWith({ b2: 'fire', h8: 'fire' }), seed: 7 });
  const actions = [], red = setup(state, 'red');
  const onFire = red.find((p) => p.square === 'b2'), paper = red.find((p) => p.pieceId.includes('paper'));
  assert.ok(onFire && !onFire.pieceId.includes('paper'));
  const bad = red.map((p) => p === onFire ? { ...p, square: paper.square } : p === paper ? { ...p, square: 'b2' } : p);
  assert.equal(validateCampusSetup(state, 'red', bad).error, 'terrain_blocked');
  state = applyCampusSetup(state, 'red', red); actions.push({ kind: 'setup', player: 'red', placements: red });
  const request = buildCampusBotRequest(state, 'blue', 2, { responseWallMs: 5000 });
  assert.deepEqual(request.game.pieces, []);
  assert.equal(request.game.you, 'blue'); assert.equal(request.game.setupVisibility, 'sealed');
  assert.ok(!request.game.availableSquaresByType.paper.includes('h8'));
  assert.ok(request.game.availableSquaresByType.rock.includes('h8'));
  const blue = setup(state, 'blue');
  state = applyCampusSetup(state, 'blue', blue); actions.push({ kind: 'setup', player: 'blue', placements: blue });
  assert.equal(campusObservation(state, 'red').pieces.length, 18);
  assert.equal(state.turn, 'red'); assert.ok(campusLegalMoves(state).length);
  assert.equal(verifyCampusReplay(recordCampusReplay({ map: state.map, seed: 7 }, actions)).ok, true);
  let legacy = createCampusGame({ map: EMPTY_MAP, seed: 7 });
  legacy = applyCampusSetup(legacy, 'red', setup(legacy, 'red'));
  assert.equal(campusObservation(legacy, 'blue').pieces.length, 9);
});

test('UI uses existing art keys, editor can erase chasm; no image additions', () => {
  const map = mapWith({ e4: 'fire', e6: 'fire', d4: 'water', f6: 'water', d5: 'bush', f5: 'bush', e5: 'chasm' });
  const clicked = [];
  const options = boardOptions({ map, readOnly: false, allowTerrainEditing: true, onSquareClick: (s) => clicked.push(s) });
  assert.deepEqual(options.terrains, map.terrains);
  options.onSquareClick('e5'); assert.deepEqual(clicked, ['e5']);
  assert.equal(normalizeCompetition({}).primaryMap.rulesVersion, 'ott-campus.v2');
  assert.equal(normalizeCompetition({ schemaVersion: 'campus-setup.v1' }).primaryMap.rulesVersion, 'ott-campus.v1');
  const schema = JSON.parse(readFileSync(new URL('../server/contracts/map.v2.schema.json', import.meta.url)));
  assert.deepEqual(schema.properties.terrains.additionalProperties.enum, ['fire', 'water', 'bush', 'chasm']);
});

const historyGame = (gameId, redParticipantId, blueParticipantId, result, roundId = 'group') => ({ gameId, redParticipantId, blueParticipantId, result, roundId });
test('colors alternate first; conflicts favor more losses, fewer wins, then deterministic seed within same round', () => {
  const config = { participantIds: ['a', 'b'], roundId: 'group', gameId: 'next', seed: 123 };
  let history = [historyGame('prev', 'a', 'b', 'red_win')];
  assert.equal(assignOfficialColors({ ...config, history }).redParticipantId, 'b');
  history = [historyGame('1', 'a', 'c', 'red_win'), historyGame('2', 'b', 'd', 'blue_win')];
  assert.equal(assignOfficialColors({ ...config, history }).reason, 'more_losses');
  assert.equal(assignOfficialColors({ ...config, history }).redParticipantId, 'b');
  history = [historyGame('1', 'a', 'c', 'red_win'), historyGame('2', 'b', 'd', 'draw')];
  assert.equal(assignOfficialColors({ ...config, history }).reason, 'fewer_wins');
  const first = assignOfficialColors(config);
  assert.deepEqual(first, assignOfficialColors({ ...config, participantIds: ['b', 'a'] }));
  assert.deepEqual(first, assignOfficialColors({ ...config, history: history.map((g) => ({ ...g, roundId: 'old' })) }));
  assert.throws(() => assignOfficialColors({ ...config, history: [history[0], history[0]] }));
});

test('next-game color contract rejects future/gapped results and mutated pinned assignments', () => {
  const games = [1, 2, 3].map((i) => ({ id: `g${i}`, redParticipantId: 'a', blueParticipantId: 'b' }));
  const config = { games, roundId: 'group', seed: 9 };
  const first = assignNextOfficialGameColor(config);
  const results = [{ gameId: first.id, redParticipantId: first.redParticipantId, blueParticipantId: first.blueParticipantId, result: 'red_win' }];
  const second = assignNextOfficialGameColor({ ...config, results });
  assert.equal(second.redParticipantId, first.blueParticipantId);
  assert.throws(() => assignNextOfficialGameColor({ ...config, results: [{ ...results[0], gameId: 'g3' }] }));
  assert.throws(() => assignNextOfficialGameColor({ ...config, results: [{ ...results[0], redParticipantId: results[0].blueParticipantId }] }));
  assert.ok(nextOfficialGroupGame({ participantIds: ['a', 'b', 'c', 'd'], seed: 9, mapHash: 'a'.repeat(64), mapPackVersion: 'week-1' }).redParticipantId);
});

test('v2 group colors feed existing standings without changing scoring rules', () => {
  const config = { participantIds: ['a', 'b', 'c', 'd'], seed: 9, mapHash: 'a'.repeat(64), mapPackVersion: 'week-1' };
  const results = [];
  for (let i = 0; i < 12; i++) {
    const game = nextOfficialGroupGame({ ...config, results });
    results.push({ gameId: game.id, redParticipantId: game.redParticipantId, blueParticipantId: game.blueParticipantId, result: 'red_win' });
  }
  const table = computeOfficialGroupStandings({ ...config, results, colorPolicy: 'alternate-loss-priority.v1' });
  assert.equal(table.complete, true);
  for (const row of table.groups[0].rows) {
    assert.equal(row.gamesWon, 3); assert.equal(row.gamesLost, 3);
  }
});

test('v2 knockout colors alternate across blocks; extra gate checks actual pinned colors', () => {
  const map = { mapHash: 'a'.repeat(64), mapPackVersion: 'week-1' };
  const series = createOfficialKnockoutSeries({ id: 'semi', stage: 'semifinal', seed: 9,
    entrants: [{ participantId: 'a', seed: 1 }, { participantId: 'b', seed: 2 }], primaryMap: map, reserveMap: map });
  const results = [];
  let previous;
  for (let i = 0; i < 4; i++) {
    const game = nextOfficialKnockoutGame({ series, results });
    if (previous) assert.equal(game.redParticipantId, previous.blueParticipantId);
    results.push({ gameId: game.id, redParticipantId: game.redParticipantId, blueParticipantId: game.blueParticipantId, result: 'draw' });
    previous = game;
  }
  assert.ok(nextOfficialKnockoutGame({ series, results, includeExtra: true }));
});

test('trusted Campus sample executes v2 terrain and verifies replay end-to-end', { skip: !resolvePython() }, async () => {
  const root = fileURLToPath(new URL('../examples/', import.meta.url));
  const bot = { allowedRoot: root, filePath: fileURLToPath(new URL('../examples/campus_bot.py', import.meta.url)) };
  const outcome = await runCampusMatch({ id: 'terrain-e2e', seed: 9, map: mapWith({ b2: 'fire', h8: 'fire', e4: 'water', e6: 'water', d5: 'bush', f5: 'bush', e5: 'chasm' }),
    red: bot, blue: bot, trusted: true, moveWallMs: 3000 });
  assert.equal(verifyCampusReplay(outcome.replay).ok, true);
  assert.equal(outcome.replay.rulesVersion, 'ott-campus.v2');
  assert.notEqual(outcome.reason, 'INVALID_SETUP');
});

test('MVP runner fails closed rather than executing v2 with legacy rules', async () => {
  await assert.rejects(runMatch({ map: EMPTY_TERRAIN_MAP }), /map_runner_unavailable/);
});