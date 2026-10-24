import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReplayFrames } from '../src/tournament/replay.js';
import { createUnplacedPieces } from '../src/game/gameState.js';
import { RED_HOME_SQUARES, BLUE_HOME_SQUARES } from '../src/game/constants.js';
import { SAMPLE_MAPS } from '../src/game/sampleMaps.js';
import { getValidMoves } from '../src/game/rules.js';

test('buildReplayFrames: hỗ trợ định dạng MVP v1 cũ (hỗ trợ cả chữ hoa và chữ thường)', () => {
  const mvpReplay = {
    seed: 42,
    initial_pieces: [
      { id: 'red-rock-1', player: 'red', type: 'rock', square: 'a2', alive: true },
      { id: 'blue-rock-1', player: 'blue', type: 'rock', square: 'i8', alive: true },
    ],
    events: [
      { player: 'red', piece_id: 'red-rock-1', from: 'A2', to: 'A3', captured_piece_id: null },
    ],
  };

  const parsed = buildReplayFrames(mvpReplay);
  assert.equal(parsed.error, null);
  assert.equal(parsed.frames.length, 2);
  assert.equal(parsed.frames[0].pieces['red-rock-1'].square, 'a2');
  assert.equal(parsed.frames[1].pieces['red-rock-1'].square, 'a3');
  assert.equal(parsed.frames[1].lastMove.from, 'a2');
  assert.equal(parsed.frames[1].lastMove.to, 'a3');
});

test('buildReplayFrames: hỗ trợ định dạng Campus Engine v2 với bản đồ địa hình và setup kín', () => {
  const map = SAMPLE_MAPS[0].map;
  const redSetup = createUnplacedPieces('red').map((p, i) => ({
    pieceId: p.id,
    square: RED_HOME_SQUARES.filter((s) => !map.blocked.includes(s))[i],
  }));
  const blueSetup = createUnplacedPieces('blue').map((p, i) => ({
    pieceId: p.id,
    square: BLUE_HOME_SQUARES.filter((s) => !map.blocked.includes(s))[i],
  }));

  // Tìm một nước đi hợp lệ cho quân đỏ đầu tiên
  const initialPieces = {};
  for (const p of [...createUnplacedPieces('red'), ...createUnplacedPieces('blue')]) {
    initialPieces[p.id] = { ...p, square: null, alive: true };
  }
  for (const pl of redSetup) initialPieces[pl.pieceId].square = pl.square;
  for (const pl of blueSetup) initialPieces[pl.pieceId].square = pl.square;

  const pieceIdToMove = redSetup.find((pl) => getValidMoves(initialPieces, pl.pieceId, map).length > 0).pieceId;
  const targetSquare = getValidMoves(initialPieces, pieceIdToMove, map)[0].square;

  const campusReplay = {
    schemaVersion: 'campus-engine-replay.v1',
    rulesVersion: 'ott-campus.v2',
    config: {
      id: 'match-1',
      seed: 12345,
      map,
    },
    events: [
      { seq: 1, action: { kind: 'setup', player: 'red', placements: redSetup } },
      { seq: 2, action: { kind: 'setup', player: 'blue', placements: blueSetup } },
      {
        seq: 3,
        action: {
          kind: 'move',
          player: 'red',
          move: { pieceId: pieceIdToMove, to: targetSquare },
        },
      },
    ],
    result: 'red_win',
  };

  const parsed = buildReplayFrames(campusReplay);
  assert.equal(parsed.error, null);
  assert.equal(parsed.frames.length, 2); // Frame 0: setup, Frame 1: sau nước 1

  // Kiểm tra frame 0 đã có đầy đủ 18 quân sau khi gộp hai setup
  const frame0Pieces = Object.values(parsed.frames[0].pieces);
  assert.equal(frame0Pieces.filter((p) => p.player === 'red' && p.square).length, 9);
  assert.equal(frame0Pieces.filter((p) => p.player === 'blue' && p.square).length, 9);

  // Kiểm tra frame 1: quân red di chuyển đúng ô
  const movedPiece = parsed.frames[1].pieces[pieceIdToMove];
  assert.equal(movedPiece.square, targetSquare);
  assert.equal(parsed.frames[1].lastMove.to, targetSquare);
});

test('buildReplayFrames: xử lý sự kiện bot_fault không làm sập replay', () => {
  const map = SAMPLE_MAPS[0].map;
  const redSetup = createUnplacedPieces('red').map((p, i) => ({
    pieceId: p.id,
    square: RED_HOME_SQUARES.filter((s) => !map.blocked.includes(s))[i],
  }));
  const blueSetup = createUnplacedPieces('blue').map((p, i) => ({
    pieceId: p.id,
    square: BLUE_HOME_SQUARES.filter((s) => !map.blocked.includes(s))[i],
  }));

  const faultReplay = {
    schemaVersion: 'campus-engine-replay.v1',
    config: { map, seed: 99 },
    events: [
      { seq: 1, action: { kind: 'setup', player: 'red', placements: redSetup } },
      { seq: 2, action: { kind: 'setup', player: 'blue', placements: blueSetup } },
      { seq: 3, action: { kind: 'bot_fault', player: 'red', fault: 'BOT_TIMEOUT' } },
    ],
    result: 'blue_win',
  };

  const parsed = buildReplayFrames(faultReplay);
  assert.equal(parsed.error, null);
  assert.equal(parsed.frames.length, 2);
  assert.match(parsed.frames[1].description, /BOT_TIMEOUT/);
});

test('buildReplayFrames: từ chối an toàn khi dữ liệu rỗng', () => {
  assert.equal(buildReplayFrames(null).frames.length, 0);
  assert.equal(buildReplayFrames(undefined).frames.length, 0);
});

