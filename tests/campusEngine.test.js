import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EMPTY_MAP, validateMap, countDisjointPaths } from '../src/game/maps.js';
import { canonicalJson, contentHash, mapHash } from '../server/contracts/canonical.js';
import { getValidMoves } from '../src/game/rules.js';
import { createNewGame, createUnplacedPieces, executeMove } from '../src/game/gameState.js';
import {
  createCampusGame, validateCampusSetup, applyCampusSetup, applyCampusMove,
  campusLegalMoves, repetitionKey, campusStateHash, campusObservation, adjudicateCampusBotFault,
} from '../server/judge/campusEngine.js';
import { recordCampusReplay, verifyCampusReplay } from '../server/replay/campusReplay.js';
import { RED_HOME_SQUARES, BLUE_HOME_SQUARES } from '../src/game/constants.js';

const mapWith = (blocked) => ({ ...structuredClone(EMPTY_MAP), blocked });
const placements = (player, map = EMPTY_MAP) => createUnplacedPieces(player).map((p, i) => ({
  pieceId: p.id,
  square: (player === 'red' ? RED_HOME_SQUARES : BLUE_HOME_SQUARES).filter((s) => !map.blocked.includes(s))[i],
}));
function playingState(map = EMPTY_MAP) {
  const triples = [
    ['r', 'red', 'rock', 'c3'], ['rp', 'red', 'paper', 'a3'], ['rs', 'red', 'scissors', 'a4'],
    ['b', 'blue', 'rock', 'g7'], ['bp', 'blue', 'paper', 'i7'], ['bs', 'blue', 'scissors', 'i6'],
  ];
  return {
    ...createCampusGame({ map, seed: 7 }), phase: 'playing',
    pieces: Object.fromEntries(triples.map(([id, player, type, square]) => [id, { id, player, type, square, alive: true }])),
  };
}

test('MapV1 validates schema, symmetry, bases and available setup squares', () => {
  assert.equal(validateMap(mapWith(['e4', 'e6'])).ok, true);
  for (const map of [
    { ...EMPTY_MAP, width: 8 }, { ...EMPTY_MAP, bases: { red: 'b1', blue: 'i9' } },
    { ...EMPTY_MAP, unknown: true }, { ...EMPTY_MAP, rulesVersion: 'future' },
    mapWith(['e4']), mapWith(['e4', 'e6', 'e4']), mapWith(['a1', 'i9']), mapWith(['a10']), mapWith(['e4\n']),
    mapWith(Array(1)), { ...EMPTY_MAP, id: 'arena\n' },
    { ...EMPTY_MAP, blocked: null }, { ...EMPTY_MAP, revision: 0 },
    mapWith([...RED_HOME_SQUARES, ...BLUE_HOME_SQUARES].filter((s) => !['a1', 'i9'].includes(s))),
  ]) assert.equal(validateMap(map).ok, false, JSON.stringify(map));
});

test('Map graph rejects isolated setup squares and a one-vertex bottleneck', () => {
  assert.match(validateMap(mapWith(['a2', 'b1', 'b2', 'i8', 'h9', 'h8'])).errors.join(), /disconnected/);
  const middle = [];
  for (let row = 1; row <= 9; row++) for (let col = 1; col <= 9; col++) {
    const square = `${String.fromCharCode(96 + col)}${row}`;
    if (col + row >= 9 && col + row <= 11 && !['d5', 'e5', 'f5'].includes(square)) middle.push(square);
  }
  const narrow = mapWith(middle);
  const checked = validateMap(narrow);
  assert.equal(checked.ok, false);
  assert.equal(checked.report.disjointPaths, 1);
  assert.match(checked.errors.join(), /vertex-disjoint/);
  assert.equal(validateMap(EMPTY_MAP).report.disjointPaths, 2);
  // Two routes that share an internal vertex are only one disjoint route.
  const graph = new Map([
    ['a', ['c']], ['b', ['c']], ['c', ['a', 'b', 'd', 'e']], ['d', ['c']], ['e', ['c']],
  ]);
  assert.equal(countDisjointPaths(graph, ['a', 'b'], ['d', 'e']), 1);
});

test('Canonical UTF-8 hashes ignore key/blocked order and map record labels', () => {
  assert.equal(canonicalJson({ z: 'Tiếng Việt', a: { y: 2, x: 1 } }), '{"a":{"x":1,"y":2},"z":"Tiếng Việt"}');
  assert.equal(contentHash({ a: 1, b: 2 }), contentHash({ b: 2, a: 1 }));
  const first = mapWith(['e4', 'e6']);
  assert.equal(mapHash(first), mapHash({ ...first, id: 'another-label', revision: 2, blocked: ['e6', 'e4'] }));
  assert.notEqual(mapHash(first), mapHash(EMPTY_MAP));
  assert.throws(() => mapHash(mapWith(['e4', 'e4'])), /Invalid map/);
  for (const value of [undefined, NaN, Infinity, { x: undefined }]) assert.throws(() => canonicalJson(value));
});

test('Obstacles and corner cutting share movement geometry, without changing legacy defaults', () => {
  const pieces = { r: { id: 'r', player: 'red', type: 'rock', square: 'e5', alive: true } };
  const targets = (blocked) => getValidMoves(pieces, 'r', { blocked }).map((m) => m.square);
  assert.equal(getValidMoves(pieces, 'r').length, 8);
  assert.ok(!targets(['e6']).includes('e6'));
  assert.ok(!targets(['e6', 'f5']).includes('f6'));
  assert.ok(targets(['e6']).includes('f6'));
  // Pieces beside the diagonal do not block the corner.
  pieces.p = { id: 'p', player: 'red', type: 'paper', square: 'f5', alive: true };
  assert.ok(getValidMoves(pieces, 'r', { blocked: ['e6'] }).some((m) => m.square === 'f6'));
});

test('Campus setup strictly checks phase, owner, zone, obstacles, duplicates and fields', () => {
  const map = mapWith(['b2', 'h8']);
  const state = createCampusGame({ map, seed: 1 });
  const valid = placements('red', map);
  assert.equal(validateCampusSetup(state, 'red', valid).ok, true);
  for (const bad of [
    valid.slice(0, 8),
    valid.map((p, i) => i ? p : { ...p, square: 'i9' }),
    valid.map((p, i) => i ? p : { ...p, square: 'b2' }),
    valid.map((p, i) => i ? p : { ...p, pieceId: 'blue_rock_0' }),
    valid.map((p, i) => i ? p : { ...p, alive: true }),
    valid.map((p, i) => i === 1 ? valid[0] : p),
  ]) {
    assert.equal(validateCampusSetup(state, 'red', bad).ok, false);
    assert.throws(() => applyCampusSetup(state, 'red', bad));
  }
  assert.throws(() => applyCampusSetup(state, 'blue', placements('blue', map)), /wrong_phase/);
  assert.throws(() => applyCampusSetup(state, 'intruder', valid), /player/);
  const red = applyCampusSetup(state, 'red', valid);
  assert.equal(campusObservation(state, 'red').pieces.length, 0);
  const obs = campusObservation(red, 'blue');
  assert.equal(obs.pieces.length, 9);
  assert.equal(obs.unplaced.length, 9);
  assert.ok(!obs.availableSquares.includes('h8'));
  obs.pieces[0].square = 'i9';
  assert.notEqual(Object.values(red.pieces)[0].square, 'i9');
  assert.equal(applyCampusSetup(red, 'blue', placements('blue', map)).phase, 'playing');
  assert.equal(Object.keys(state.pieces).length, 0);
});

test('Campus execution checks turn/ownership/schema/obstacles without mutating input', () => {
  const state = playingState(mapWith(['c4', 'g6']));
  const before = structuredClone(state);
  for (const [player, move] of [
    ['blue', { pieceId: 'b', to: 'g8' }], ['red', { pieceId: 'b', to: 'g8' }],
    ['red', { pieceId: 'r', to: 'c4' }], ['red', { pieceId: 'r', to: 'c9' }],
    ['red', { pieceId: 'r', to: 'd3', winner: 'red' }],
  ]) assert.throws(() => applyCampusMove(state, player, move));
  assert.deepEqual(state, before);
  assert.equal(campusLegalMoves(state, 'blue').length, 0);
});

test('Repetition ignores IDs, seed and timestamps, includes turn/map and counts initial position', () => {
  let state = playingState();
  const altered = structuredClone(state);
  altered.pieces.r.id = 'different-id'; altered.seed = 999; altered.updatedAt = 999;
  assert.equal(repetitionKey(state), repetitionKey(altered));
  assert.notEqual(repetitionKey(state), repetitionKey({ ...state, turn: 'blue' }));
  assert.notEqual(repetitionKey(state), repetitionKey({ ...state, mapHash: 'different' }));
  state.repetitions[repetitionKey(state)] = 1;
  const cycle = [['red', 'r', 'c4'], ['blue', 'b', 'g6'], ['red', 'r', 'c3'], ['blue', 'b', 'g7']];
  for (let i = 0; i < 8; i++) {
    const [player, pieceId, to] = cycle[i % 4];
    state = applyCampusMove(state, player, { pieceId, to });
    if (i < 7) assert.equal(state.phase, 'playing');
  }
  assert.equal(state.result, 'draw');
  assert.equal(state.terminationReason, 'REPETITION');
  let setup = createCampusGame({ map: EMPTY_MAP, seed: 9 });
  setup = applyCampusSetup(setup, 'red', placements('red'));
  setup = applyCampusSetup(setup, 'blue', placements('blue'));
  assert.equal(setup.repetitions[repetitionKey(setup)], 1);
});

test('400 plies draw; base/elimination wins take precedence over draw', () => {
  const state = { ...playingState(), ply: 399 };
  assert.equal(applyCampusMove(state, 'red', { pieceId: 'r', to: 'c4' }).terminationReason, 'PLY_LIMIT');
  state.pieces.r = { ...state.pieces.r, square: 'h8' };
  const base = applyCampusMove(state, 'red', { pieceId: 'r', to: 'i9' });
  assert.equal(base.result, 'red_win');
  assert.equal(base.terminationReason, 'BASE_REACHED');
  state.pieces.r = { ...state.pieces.r, square: 'h6' };
  const elimination = applyCampusMove(state, 'red', { pieceId: 'r', to: 'i6' });
  assert.equal(elimination.result, 'red_win');
  assert.equal(elimination.terminationReason, 'TYPE_ELIMINATED');
});

test('NO_LEGAL_MOVE takes precedence over draw after switching turn', () => {
  const map = mapWith(['d4', 'e4', 'f4', 'c4', 'c5', 'c6', 'd6', 'e6', 'f6', 'g4', 'g5', 'g6']);
  const state = { ...playingState(map), ply: 399 };
  state.pieces.b.square = 'd5'; state.pieces.bp.square = 'e5'; state.pieces.bs.square = 'f5';
  const next = applyCampusMove(state, 'red', { pieceId: 'r', to: 'c2' });
  assert.equal(next.result, 'red_win');
  assert.equal(next.terminationReason, 'NO_LEGAL_MOVE');
});

test('Injected clock and detached map keep authoritative state deterministic', () => {
  const map = mapWith(['e4', 'e6']);
  const a = createCampusGame({ map, seed: 8 }, { clock: () => 123 });
  const b = createCampusGame({ map, seed: 8 }, { clock: () => 456 });
  assert.equal(a.updatedAt, 123);
  assert.equal(campusStateHash(a), campusStateHash(b));
  map.blocked.push('e5');
  assert.equal(a.map.blocked.length, 2);
  assert.throws(() => a.map.blocked.push('e5'));
  for (const seed of [-1, 2 ** 32, 0.5, NaN]) assert.throws(() => createCampusGame({ map: EMPTY_MAP, seed }));
});

test('Measured bot faults forfeit only the active player; infrastructure errors do not score', () => {
  const config = { map: EMPTY_MAP, seed: 2 };
  const initial = createCampusGame(config);
  const lost = adjudicateCampusBotFault(initial, 'red', 'BOT_TIMEOUT');
  assert.equal(lost.result, 'blue_win');
  assert.throws(() => adjudicateCampusBotFault(initial, 'blue', 'BOT_CRASH'));
  assert.throws(() => adjudicateCampusBotFault(lost, 'red', 'BOT_CRASH'));
  for (const fault of ['INFRA_ERROR', 'ADMIN_CANCEL', 'invented']) {
    assert.throws(() => adjudicateCampusBotFault(initial, 'red', fault));
  }
  const replay = recordCampusReplay(config, [{ kind: 'bot_fault', player: 'red', fault: 'BOT_TIMEOUT' }]);
  assert.equal(verifyCampusReplay(replay).finished, true);
});

test('Legacy and Campus open-map primitives produce the same moves/board', () => {
  const campus = playingState();
  const legacy = { ...createNewGame('legacy', () => 0), pieces: campus.pieces, phase: 'playing', turn: 'red' };
  assert.deepEqual(campusLegalMoves(campus), Object.values(legacy.pieces).filter((p) => p.player === 'red')
    .flatMap((p) => getValidMoves(legacy.pieces, p.id).map((m) => ({ pieceId: p.id, to: m.square }))));
  const oldNext = executeMove(legacy, 'red', 'r', 'c4', { clock: () => 0 });
  const newNext = applyCampusMove(campus, 'red', { pieceId: 'r', to: 'c4' });
  assert.deepEqual(oldNext.pieces, newNext.pieces);
  assert.equal(oldNext.turn, newNext.turn);
  assert.equal(oldNext.phase, newNext.phase);
});

test('Engine replay verifies every action hash and rejects tampering/version/sequence errors', () => {
  const config = { map: EMPTY_MAP, seed: 6 };
  const actions = [
    { kind: 'setup', player: 'red', placements: placements('red') },
    { kind: 'setup', player: 'blue', placements: placements('blue') },
  ];
  let state = applyCampusSetup(createCampusGame(config), 'red', placements('red'));
  state = applyCampusSetup(state, 'blue', placements('blue'));
  actions.push({ kind: 'move', player: 'red', move: campusLegalMoves(state)[0] });
  const replay = recordCampusReplay(config, actions);
  assert.equal(verifyCampusReplay(replay).ok, true);
  const edits = [
    (r) => { r.events[0].resultingStateHash = 'wrong'; },
    (r) => { r.events[1].seq = 3; },
    (r) => { r.mapHash = 'wrong'; },
    (r) => { r.result = 'red_win'; },
    (r) => { r.rulesVersion = 'unknown'; },
    (r) => { r.events[2].action.move.to = 'i9'; },
  ];
  for (const edit of edits) {
    const bad = structuredClone(replay); edit(bad);
    const { contentHash: ignored, ...content } = bad;
    bad.contentHash = contentHash(content); // Exercise semantic checks beyond outer integrity.
    assert.equal(verifyCampusReplay(bad).ok, false);
  }
  const tampered = structuredClone(replay); tampered.config.seed++;
  assert.match(verifyCampusReplay(tampered).error, /content hash/);
  assert.equal(verifyCampusReplay({ protocol_version: 1 }).ok, false);
});

test('Map/replay CLIs return success and failure exit codes without DB or bot runtime', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'oot-campus-'));
  try {
    const mapPath = path.join(directory, 'map.json'), replayPath = path.join(directory, 'replay.json');
    writeFileSync(mapPath, JSON.stringify(EMPTY_MAP));
    writeFileSync(replayPath, JSON.stringify(recordCampusReplay({ map: EMPTY_MAP, seed: 1 }, [])));
    assert.equal(spawnSync(process.execPath, ['tools/cli/validate-map.js', mapPath]).status, 0);
    assert.equal(spawnSync(process.execPath, ['tools/cli/verify-replay.js', replayPath]).status, 0);
    const demoPath = path.join(directory, 'demo.json');
    assert.equal(spawnSync(process.execPath, ['tools/cli/demo-campus.js', 'examples/maps/campus-arena.json', demoPath]).status, 0);
    assert.equal(spawnSync(process.execPath, ['tools/cli/verify-replay.js', demoPath]).status, 0);
    // Existing output is preserved.
    assert.equal(spawnSync(process.execPath, ['tools/cli/demo-campus.js', 'examples/maps/campus-arena.json', demoPath]).status, 1);
    writeFileSync(mapPath, JSON.stringify(mapWith(['e4'])));
    writeFileSync(replayPath, '{}');
    assert.equal(spawnSync(process.execPath, ['tools/cli/validate-map.js', mapPath]).status, 1);
    assert.equal(spawnSync(process.execPath, ['tools/cli/verify-replay.js', replayPath]).status, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
