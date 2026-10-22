import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { boardOptions } from '../src/ui/boardAdapter.js';
import { normalizeBoard, getVisualCoordinates, nextFocusIndex } from '../src/ui/ott-v2-ui-kit/board.mjs';
import { createOfflineGame, fillOfflineSetup, confirmOfflineSetup, moveOfflinePiece } from '../src/game/offlineGame.js';
import { SAMPLE_MAPS } from '../src/game/sampleMaps.js';
import { getValidMoves } from '../src/game/rules.js';

test('kit adapter preserves live pieces, zones, bases and actual blocked map', () => {
  const state = fillOfflineSetup(createOfflineGame(SAMPLE_MAPS[1].map));
  const options = normalizeBoard(boardOptions({ pieces: state.pieces, map: state.map }));
  assert.equal(options.pieces.length, 9);
  assert.equal(Object.keys(options.zones).length, 81);
  assert.equal(Object.values(options.zones).filter((z) => z === 'red').length, 28);
  assert.equal(Object.values(options.zones).filter((z) => z === 'blue').length, 28);
  assert.deepEqual(options.bases, { a1: 'red', i9: 'blue' });
  assert.deepEqual(Object.keys(options.terrains), state.map.blocked);
  assert(Object.values(options.terrains).every((t) => t === 'chasm'));
});
test('read-only has no callback; blockers never forward moves', () => {
  const clicks = [];
  assert.equal(boardOptions({ onSquareClick: (s) => clicks.push(s) }).onSquareClick, null);
  const options = boardOptions({ readOnly: false, map: { blocked: ['e5'] }, onSquareClick: (s) => clicks.push(s) });
  options.onSquareClick('e5'); options.onSquareClick('a1');
  assert.deepEqual(clicks, ['a1']);
});
test('kit orientation and keyboard cover 81 coordinates without row wrapping', () => {
  const red = getVisualCoordinates('red').squares;
  assert.equal(new Set(red).size, 81);
  assert.deepEqual(getVisualCoordinates('blue').squares, [...red].reverse());
  assert.equal(nextFocusIndex(8, 'ArrowRight'), 8);
  assert.equal(nextFocusIndex(9, 'ArrowLeft'), 9);
});
test('adapter follows real setup and legal move snapshots without mutating engine', () => {
  let state = createOfflineGame(SAMPLE_MAPS[0].map);
  state = confirmOfflineSetup(fillOfflineSetup(state));
  state = confirmOfflineSetup(fillOfflineSetup(state));
  const piece = Object.values(state.pieces).find((p) => p.player === 'red' && getValidMoves(state.pieces, p.id, state.map).length);
  const moves = getValidMoves(state.pieces, piece.id, state.map);
  const before = JSON.stringify(state);
  const options = normalizeBoard(boardOptions({ pieces: state.pieces, selectedSquare: piece.square, validMoves: moves }));
  assert.equal(JSON.stringify(state), before);
  assert.deepEqual(options.validMoves, moves);
  const next = moveOfflinePiece(state, piece.id, moves[0].square);
  assert.equal(boardOptions({ pieces: next.pieces }).pieces.find((p) => p.id === piece.id).square, moves[0].square);
});
test('production uses local kit, not catalog or remote fonts', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert(!/fonts\.google|fonts\.gstatic/.test(html));
  assert(html.includes('href="/logo.png"'));
  const main = readFileSync(new URL('../src/tournament/portal/CampusPortal.jsx', import.meta.url), 'utf8');
  assert(main.includes('ott-v2-ui-kit/ui-kit.css'));
  for (const file of ['Board.jsx', '../tournament/ReplayBoard.jsx']) {
    const source = readFileSync(new URL(`../src/components/${file}`, import.meta.url), 'utf8');
    assert(source.includes('GameBoard'));
    assert(!source.includes('rows.flat()'));
  }
});