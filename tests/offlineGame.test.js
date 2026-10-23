import test from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLE_MAPS } from '../src/game/sampleMaps.js';
import { EMPTY_MAP, validateMap } from '../src/game/maps.js';
import { createOfflineGame, placeOfflinePiece, removeOfflinePiece, fillOfflineSetup, confirmOfflineSetup, moveOfflinePiece } from '../src/game/offlineGame.js';
import { getValidMoves } from '../src/game/rules.js';
import { terrainBlocks } from '../src/game/terrain.js';
import { executeMove } from '../src/game/gameState.js';
import { readFileSync } from 'node:fs';

test('offline: all sample maps valid, setup deterministic, red then blue, obstacles respected', () => {
  for (const { map } of SAMPLE_MAPS) {
    assert.equal(validateMap(map).ok, true, map.id);
    let state = createOfflineGame(map);
    assert.throws(() => confirmOfflineSetup(state));
    assert.throws(() => placeOfflinePiece(state, 'rock', 'i9'));
    if (map.blocked.length) assert.throws(() => placeOfflinePiece(state, 'rock', map.blocked[0]));
    const filled = fillOfflineSetup(state);
    assert.equal(Object.keys(state.pieces).length, 0, 'input not mutated');
    assert.deepEqual(fillOfflineSetup(state), filled, 'no ambient RNG');
    state = confirmOfflineSetup(filled);
    assert.equal(state.phase, 'setup_blue');
    assert.equal(Object.values(state.pieces).filter((p) => p.player === 'red').length, 9);
    state = confirmOfflineSetup(fillOfflineSetup(state));
    assert.equal(state.turn, 'red'); assert.equal(state.phase, 'playing');
    assert.equal(Object.keys(state.pieces).length, 18);
    assert(Object.values(state.pieces).every((p) => !terrainBlocks(map, p.square, p.type)));
    const piece = Object.values(state.pieces).find((p) => p.player === 'red' && getValidMoves(state.pieces, p.id, map).length);
    const to = getValidMoves(state.pieces, piece.id, map)[0].square;
    const next = moveOfflinePiece(state, piece.id, to);
    assert.equal(next.turn, 'blue'); assert.equal(next.history.length, 1);
    assert.equal(state.history.length, 0);
    assert.throws(() => moveOfflinePiece(next, piece.id, to));
  }
});

test('exactly five v2 samples cover four individual terrains and all terrains; downloadable JSON matches', () => {
  assert.equal(SAMPLE_MAPS.length, 5);
  assert.equal(new Set(SAMPLE_MAPS.map(({ map }) => map.id)).size, 5);
  for (const { map } of SAMPLE_MAPS) {
    assert.equal(map.schemaVersion, 'map.v2');
    assert.equal(map.rulesVersion, 'ott-campus.v2');
    assert.equal(map.blocked.length, 0);
    assert.ok(validateMap(map).ok);
    const json = JSON.parse(readFileSync(new URL(`../examples/maps/${map.id}.json`, import.meta.url)));
    assert.deepEqual(json, map);
  }
  assert.deepEqual([...new Set(Object.values(SAMPLE_MAPS[4].map.terrains))].sort(), ['bush', 'chasm', 'fire', 'water']);
  assert.deepEqual([...new Set(Object.values(SAMPLE_MAPS[3].map.terrains))], ['chasm']);
});

test('offline manual placement blocks each terrain type for both colors, without mutating state', () => {
  const map = SAMPLE_MAPS[4].map;
  let state = createOfflineGame(map);
  for (const player of ['red', 'blue']) {
    const before = JSON.stringify(state);
    const squares = player === 'red' ? ['b2', 'c2', 'b3', 'c3'] : ['h8', 'g8', 'h7', 'g7'];
    for (const [square, blocked] of squares.map((square, i) => [square, ['paper', 'scissors', 'rock', '*'][i]])) {
      for (const type of ['rock', 'paper', 'scissors']) {
        if (blocked === '*' || type === blocked) assert.throws(() => placeOfflinePiece(state, type, square));
        else assert.ok(Object.values(placeOfflinePiece(state, type, square).pieces).some((p) => p.player === player && p.square === square));
      }
    }
    assert.equal(JSON.stringify(state), before);
    state = confirmOfflineSetup(fillOfflineSetup(state));
  }
});

test('offline rejects illegal reverse swap, validates confirmation, supports safe removal and preserves manual choices', () => {
  let state = createOfflineGame(SAMPLE_MAPS[4].map);
  state = placeOfflinePiece(state, 'rock', 'b2');
  state = placeOfflinePiece(state, 'paper', 'a2');
  const rock = Object.values(state.pieces).find((p) => p.type === 'rock');
  const paper = Object.values(state.pieces).find((p) => p.type === 'paper');
  const before = JSON.stringify(state);
  assert.throws(() => placeOfflinePiece(state, rock.id, 'a2'), /đổi chỗ/);
  assert.equal(JSON.stringify(state), before);
  const filled = fillOfflineSetup(state);
  assert.equal(filled.pieces[rock.id].square, 'b2');
  assert.equal(filled.pieces[paper.id].square, 'a2');
  const removed = removeOfflinePiece(filled, paper.id);
  assert.equal(removed.pieces[paper.id], undefined);
  assert.throws(() => confirmOfflineSetup(removed));
  assert.throws(() => confirmOfflineSetup({ ...filled, pieces: { ...filled.pieces, [paper.id]: { ...paper, square: 'b2' } } }));
  const blue = confirmOfflineSetup(filled);
  assert.throws(() => removeOfflinePiece(blue, rock.id));
});

test('new offline games upgrade a copied legacy map without changing the historical input', () => {
  const map = { ...EMPTY_MAP, blocked: ['e4', 'e6'] }, before = JSON.stringify(map);
  const state = createOfflineGame(map);
  assert.equal(state.map.rulesVersion, 'ott-campus.v2');
  assert.deepEqual(state.map.terrains, { e4: 'chasm', e6: 'chasm' });
  assert.equal(JSON.stringify(map), before);
  assert.equal(createOfflineGame().map.rulesVersion, 'ott-campus.v2');
});

test('shared executeMove defaults to state map; caller cannot accidentally bypass terrain', () => {
  const state = { ...createOfflineGame(SAMPLE_MAPS[4].map), phase: 'playing', turn: 'red',
    pieces: { p: { id: 'p', player: 'red', type: 'paper', alive: true, square: 'b1' } } };
  assert.throws(() => executeMove(state, 'red', 'p', 'b2'), /không hợp lệ/);
});

test('offline: moving and swapping setup pieces preserves nine unique IDs', () => {
  const state = fillOfflineSetup(createOfflineGame(SAMPLE_MAPS[0].map));
  const [a, b] = Object.values(state.pieces);
  const swapped = placeOfflinePiece(state, a.id, b.square);
  assert.equal(swapped.pieces[a.id].square, b.square);
  assert.equal(swapped.pieces[b.id].square, a.square);
  assert.equal(new Set(Object.values(swapped.pieces).map((p) => p.square)).size, 9);
});