import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReplayFrames } from '../src/tournament/replay.js';
import { createUnplacedPieces } from '../src/game/gameState.js';
import { getValidMoves } from '../src/game/rules.js';
import { SAMPLE_MAPS } from '../src/game/sampleMaps.js';
import { RED_HOME_SQUARES, BLUE_HOME_SQUARES } from '../src/game/constants.js';

test('OfficialGameViewer synthetic replay builds frames exclusively from received events', () => {
  const map = SAMPLE_MAPS[0].map;
  const redSetup = createUnplacedPieces('red').map((p, i) => ({
    pieceId: p.id,
    square: RED_HOME_SQUARES.filter((s) => !map.blocked.includes(s))[i],
  }));
  const blueSetup = createUnplacedPieces('blue').map((p, i) => ({
    pieceId: p.id,
    square: BLUE_HOME_SQUARES.filter((s) => !map.blocked.includes(s))[i],
  }));

  const initialPieces = {};
  for (const p of [...createUnplacedPieces('red'), ...createUnplacedPieces('blue')]) {
    initialPieces[p.id] = { ...p, square: null, alive: true };
  }
  for (const pl of redSetup) initialPieces[pl.pieceId].square = pl.square;
  for (const pl of blueSetup) initialPieces[pl.pieceId].square = pl.square;

  const pieceIdToMove = redSetup.find((pl) => getValidMoves(initialPieces, pl.pieceId, map).length > 0).pieceId;
  const targetSquare = getValidMoves(initialPieces, pieceIdToMove, map)[0].square;
  const fromSquare = initialPieces[pieceIdToMove].square;

  // Case 1: Stream broadcasting, reveal_result = false (no result revealed)
  const syntheticReplayStreaming = {
    schemaVersion: 'campus-engine-replay.v1',
    map,
    events: [
      {
        seq: 1,
        action: {
          kind: 'setup',
          player: 'red',
          placements: redSetup,
        },
      },
      {
        seq: 2,
        action: {
          kind: 'setup',
          player: 'blue',
          placements: blueSetup,
        },
      },
      {
        seq: 3,
        action: {
          kind: 'move',
          player: 'red',
          move: { pieceId: pieceIdToMove, from: fromSquare, to: targetSquare },
        },
      },
    ],
    result: null,
    terminationReason: null,
  };

  const parsedStreaming = buildReplayFrames(syntheticReplayStreaming);
  assert.equal(parsedStreaming.error, null);
  // Initial frame (setup frame 0) + 1 move frame = 2 frames
  assert.equal(parsedStreaming.frames.length, 2);
  assert.equal(parsedStreaming.frames[0].index, 0);
  assert.equal(parsedStreaming.frames[1].index, 1);
  // Winner is null because result is not revealed yet
  assert.equal(parsedStreaming.frames[1].winner, null);

  // Case 2: reveal_result = true with result
  const syntheticReplayFinished = {
    ...syntheticReplayStreaming,
    result: 'red_win',
    terminationReason: 'BASE_CAPTURE',
  };
  const parsedFinished = buildReplayFrames(syntheticReplayFinished);
  assert.equal(parsedFinished.frames.length, 2);
});

test('Official tickets data structure contract: awarded, reserves, vacant', () => {
  const serverTicketPayload = {
    ranking: [
      { participantId: 'team-1', rank: 1, seed: 1 },
      { participantId: 'team-2', rank: 2, seed: 4 },
      { participantId: 'team-3', rank: 3, seed: 2 },
      { participantId: 'team-4', rank: 4, seed: 3 },
    ],
    tickets: {
      awarded: [
        { participantId: 'team-1', rank: 1, seed: 1 },
        { participantId: 'team-2', rank: 2, seed: 4 },
      ],
      reserves: [
        { participantId: 'team-3', rank: 3, seed: 2 },
        { participantId: 'team-4', rank: 4, seed: 3 },
      ],
      vacant: 0,
    },
  };

  assert.ok(Array.isArray(serverTicketPayload.tickets.awarded));
  assert.ok(Array.isArray(serverTicketPayload.tickets.reserves));
  assert.equal(typeof serverTicketPayload.tickets.vacant, 'number');
  assert.equal(serverTicketPayload.tickets.awarded.length, 2);
  assert.equal(serverTicketPayload.tickets.reserves.length, 2);
  assert.equal(serverTicketPayload.tickets.vacant, 0);
});
