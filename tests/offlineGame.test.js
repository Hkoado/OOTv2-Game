import test from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLE_MAPS } from '../src/game/sampleMaps.js';
import { validateMap } from '../src/game/maps.js';
import { createOfflineGame, placeOfflinePiece, fillOfflineSetup, confirmOfflineSetup, moveOfflinePiece } from '../src/game/offlineGame.js';
import { getValidMoves } from '../src/game/rules.js';

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
    assert(Object.values(state.pieces).every((p) => !map.blocked.includes(p.square)));
    const piece = Object.values(state.pieces).find((p) => p.player === 'red' && getValidMoves(state.pieces, p.id, map).length);
    const to = getValidMoves(state.pieces, piece.id, map)[0].square;
    const next = moveOfflinePiece(state, piece.id, to);
    assert.equal(next.turn, 'blue'); assert.equal(next.history.length, 1);
    assert.equal(state.history.length, 0);
    assert.throws(() => moveOfflinePiece(next, piece.id, to));
  }
});

test('offline: moving and swapping setup pieces preserves nine unique IDs', () => {
  const state = fillOfflineSetup(createOfflineGame(SAMPLE_MAPS[0].map));
  const [a, b] = Object.values(state.pieces);
  const swapped = placeOfflinePiece(state, a.id, b.square);
  assert.equal(swapped.pieces[a.id].square, b.square);
  assert.equal(swapped.pieces[b.id].square, a.square);
  assert.equal(new Set(Object.values(swapped.pieces).map((p) => p.square)).size, 9);
});