import test from 'node:test';
import assert from 'node:assert/strict';

import { PLAYERS, PIECE_TYPES } from '../src/game/constants.js';
import { createNewGame, GAME_PHASES } from '../src/game/gameState.js';
import {
  MAX_PLIES,
  RESULTS,
  REASONS,
  createTournamentGame,
  pieceCatalogue,
  buildSetupRequest,
  validatePlacements,
  applySetup,
  listAllLegalMoves,
  buildMoveRequest,
  applyValidatedMove,
  determineWinReason,
  replayFromRecord,
  replayMatchesResult,
  homeSquaresFor,
} from '../server/judge/gameAdapter.js';
import { createRng } from '../server/judge/rng.js';

/** State "trần" để test thuần luật: không đi qua setup. */
function makeState(triples, turn = PLAYERS.RED) {
  const pieces = {};
  for (const [id, player, type, square] of triples) {
    pieces[id] = { id, player, type, square, alive: true };
  }
  return {
    ...createNewGame('unit-test'),
    phase: GAME_PHASES.PLAYING,
    turn,
    pieces,
    history: [],
  };
}

function placementsFor(player) {
  const squares = homeSquaresFor(player).slice(0, 9);
  return pieceCatalogue(player).map((piece, index) => ({
    piece_id: piece.id,
    square: squares[index],
  }));
}

function setupBothSides() {
  let state = createTournamentGame();
  const redCheck = validatePlacements(PLAYERS.RED, placementsFor(PLAYERS.RED));
  assert.equal(redCheck.ok, true);
  state = applySetup(state, PLAYERS.RED, redCheck.byId);

  const blueCheck = validatePlacements(PLAYERS.BLUE, placementsFor(PLAYERS.BLUE));
  assert.equal(blueCheck.ok, true);
  state = applySetup(state, PLAYERS.BLUE, blueCheck.byId);
  return state;
}

test('M1: state tournament khởi tạo ở giai đoạn xếp quân Đỏ, Đỏ đi trước', () => {
  const state = createTournamentGame();
  assert.equal(state.phase, GAME_PHASES.SETUP_RED);
  assert.equal(state.turn, PLAYERS.RED);
  assert.equal(Object.keys(state.pieces).length, 0);
});

test('M1: request setup đỏ có 9 quân, 28 ô sân nhà, chưa thấy đối thủ', () => {
  const state = createTournamentGame();
  const req = buildSetupRequest(state, PLAYERS.RED, 12345);
  assert.equal(req.protocol_version, 1);
  assert.equal(req.request, 'setup');
  assert.equal(req.player, PLAYERS.RED);
  assert.equal(req.seed, 12345);
  assert.equal(req.my_pieces.length, 9);
  assert.equal(req.available_squares.length, 28);
  assert.deepEqual(req.opponent_pieces, []);
  const types = req.my_pieces.map((p) => p.type);
  for (const type of Object.values(PIECE_TYPES)) {
    assert.equal(types.filter((t) => t === type).length, 3);
  }
});

test('M1: Xanh nhận đủ 9 quân Đỏ đã xếp trước khi setup', () => {
  let state = createTournamentGame();
  const redCheck = validatePlacements(PLAYERS.RED, placementsFor(PLAYERS.RED));
  state = applySetup(state, PLAYERS.RED, redCheck.byId);

  const req = buildSetupRequest(state, PLAYERS.BLUE, 1);
  assert.equal(req.opponent_pieces.length, 9);
  for (const piece of req.opponent_pieces) {
    assert.ok(homeSquaresFor(PLAYERS.RED).includes(piece.square));
  }
  assert.equal(req.available_squares.length, 28);
  assert.ok(req.available_squares.every((sq) => homeSquaresFor(PLAYERS.BLUE).includes(sq)));
});

test('M1: validate placements từ chối thiếu quân, trùng ô, sai sân, id lạ', () => {
  const good = placementsFor(PLAYERS.RED);
  assert.equal(validatePlacements(PLAYERS.RED, good).ok, true);
  assert.equal(validatePlacements(PLAYERS.RED, good.slice(0, 8)).ok, false);

  const duplicated = good.map((p, i) => (i === 1 ? { ...p, square: good[0].square } : p));
  const dupResult = validatePlacements(PLAYERS.RED, duplicated);
  assert.equal(dupResult.ok, false);
  assert.equal(dupResult.error, 'duplicate_square');

  const outside = good.map((p, i) => (i === 0 ? { ...p, square: 'i9' } : p));
  const outsideResult = validatePlacements(PLAYERS.RED, outside);
  assert.equal(outsideResult.ok, false);
  assert.equal(outsideResult.error, 'square_outside_home');

  const alien = good.map((p, i) => (i === 0 ? { ...p, piece_id: 'blue_rock_0' } : p));
  assert.equal(validatePlacements(PLAYERS.RED, alien).ok, false);

  const repeated = good.map((p, i) => (i === 1 ? { ...p, piece_id: good[0].piece_id } : p));
  assert.equal(validatePlacements(PLAYERS.RED, repeated).ok, false);
});

test('M1: setup đỏ -> xanh chuyển sang playing với đủ 18 quân', () => {
  const state = setupBothSides();
  assert.equal(state.phase, GAME_PHASES.PLAYING);
  assert.equal(state.turn, PLAYERS.RED);
  assert.equal(Object.keys(state.pieces).length, 18);

  const redAlive = Object.values(state.pieces).filter((p) => p.player === PLAYERS.RED).length;
  const blueAlive = Object.values(state.pieces).filter((p) => p.player === PLAYERS.BLUE).length;
  assert.equal(redAlive, 9);
  assert.equal(blueAlive, 9);
  for (const piece of Object.values(state.pieces)) {
    const home = homeSquaresFor(piece.player);
    assert.ok(home.includes(piece.square), `${piece.id} ở ${piece.square} ngoài sân nhà`);
  }
});

test('M1: legal moves đi 1 ô theo 8 hướng và không rời bàn cờ', () => {
  const state = makeState([[`${PLAYERS.RED}_rock_0`, PLAYERS.RED, PIECE_TYPES.ROCK, 'e5']]);
  const moves = listAllLegalMoves(state, PLAYERS.RED);
  assert.equal(moves.length, 8);
  const targets = moves.map((m) => m.to).sort();
  assert.deepEqual(targets, ['d4', 'd5', 'd6', 'e4', 'e6', 'f4', 'f5', 'f6'].sort());

  const corner = makeState([[`${PLAYERS.RED}_rock_0`, PLAYERS.RED, PIECE_TYPES.ROCK, 'a1']]);
  const cornerMoves = listAllLegalMoves(corner, PLAYERS.RED).map((m) => m.to).sort();
  assert.deepEqual(cornerMoves, ['a2', 'b1', 'b2']);
});

test('M1: Búa ăn Kéo; Kéo không ăn được Búa; cùng loại và cùng phe chặn nhau', () => {
  let state = makeState([
    [`${PLAYERS.RED}_rock_0`, PLAYERS.RED, PIECE_TYPES.ROCK, 'e5'],
    [`${PLAYERS.BLUE}_scissors_0`, PLAYERS.BLUE, PIECE_TYPES.SCISSORS, 'e6'],
  ]);
  const captured = applyValidatedMove(state, PLAYERS.RED, {
    piece_id: `${PLAYERS.RED}_rock_0`,
    to: 'e6',
  });
  assert.equal(captured.state.pieces[`${PLAYERS.BLUE}_scissors_0`].alive, false);
  assert.equal(captured.event.captured_piece_id, `${PLAYERS.BLUE}_scissors_0`);
  assert.equal(captured.state.turn, PLAYERS.BLUE);

  state = makeState([
    [`${PLAYERS.RED}_scissors_0`, PLAYERS.RED, PIECE_TYPES.SCISSORS, 'e5'],
    [`${PLAYERS.BLUE}_rock_0`, PLAYERS.BLUE, PIECE_TYPES.ROCK, 'e6'],
  ]);
  assert.equal(listAllLegalMoves(state, PLAYERS.RED).filter((m) => m.to === 'e6').length, 0);
  assert.throws(() =>
    applyValidatedMove(state, PLAYERS.RED, { piece_id: `${PLAYERS.RED}_scissors_0`, to: 'e6' })
  );

  state = makeState([
    [`${PLAYERS.RED}_paper_0`, PLAYERS.RED, PIECE_TYPES.PAPER, 'e5'],
    [`${PLAYERS.BLUE}_paper_0`, PLAYERS.BLUE, PIECE_TYPES.PAPER, 'e6'],
  ]);
  assert.equal(listAllLegalMoves(state, PLAYERS.RED).filter((m) => m.to === 'e6').length, 0);

  state = makeState([
    [`${PLAYERS.RED}_paper_0`, PLAYERS.RED, PIECE_TYPES.PAPER, 'e5'],
    [`${PLAYERS.RED}_rock_0`, PLAYERS.RED, PIECE_TYPES.ROCK, 'e6'],
  ]);
  assert.equal(listAllLegalMoves(state, PLAYERS.RED).filter((m) => m.to === 'e6').length, 0);
});

test('M1: nước không có trong legal_moves bị từ chối (không đổi state)', () => {
  const state = makeState([
    [`${PLAYERS.RED}_rock_0`, PLAYERS.RED, PIECE_TYPES.ROCK, 'e5'],
    [`${PLAYERS.BLUE}_rock_0`, PLAYERS.BLUE, PIECE_TYPES.ROCK, 'i9'],
  ]);
  assert.throws(
    () => applyValidatedMove(state, PLAYERS.RED, { piece_id: `${PLAYERS.RED}_rock_0`, to: 'e9' }),
    /legal_moves/
  );
  assert.throws(() =>
    applyValidatedMove(state, PLAYERS.RED, { piece_id: `${PLAYERS.BLUE}_rock_0`, to: 'i8' })
  );
});


test('M1: thắng bằng chiếm nhà chính (reason base_capture)', () => {
  const state = makeState([
    [`${PLAYERS.RED}_rock_0`, PLAYERS.RED, PIECE_TYPES.ROCK, 'h8'],
    [`${PLAYERS.BLUE}_rock_0`, PLAYERS.BLUE, PIECE_TYPES.ROCK, 'i8'],
    [`${PLAYERS.BLUE}_paper_0`, PLAYERS.BLUE, PIECE_TYPES.PAPER, 'a9'],
    [`${PLAYERS.BLUE}_scissors_0`, PLAYERS.BLUE, PIECE_TYPES.SCISSORS, 'b9'],
  ]);
  const result = applyValidatedMove(state, PLAYERS.RED, {
    piece_id: `${PLAYERS.RED}_rock_0`,
    to: 'i9',
  });
  assert.equal(result.state.phase, GAME_PHASES.FINISHED);
  assert.equal(result.state.winner, PLAYERS.RED);
  assert.equal(determineWinReason(result.state, PLAYERS.RED), REASONS.BASE_CAPTURE);
});

test('M1: thắng bằng diệt sạch một loại quân (reason type_eliminated)', () => {
  const pieces = [
    [`${PLAYERS.RED}_scissors_0`, PLAYERS.RED, PIECE_TYPES.SCISSORS, 'e5'],
    [`${PLAYERS.RED}_rock_1`, PLAYERS.RED, PIECE_TYPES.ROCK, 'a1'],
    [`${PLAYERS.RED}_rock_2`, PLAYERS.RED, PIECE_TYPES.ROCK, 'a2'],
    [`${PLAYERS.RED}_paper_0`, PLAYERS.RED, PIECE_TYPES.PAPER, 'a3'],
    [`${PLAYERS.RED}_paper_1`, PLAYERS.RED, PIECE_TYPES.PAPER, 'a4'],
    [`${PLAYERS.BLUE}_paper_0`, PLAYERS.BLUE, PIECE_TYPES.PAPER, 'e6'],
    [`${PLAYERS.BLUE}_rock_0`, PLAYERS.BLUE, PIECE_TYPES.ROCK, 'i9'],
    [`${PLAYERS.BLUE}_rock_1`, PLAYERS.BLUE, PIECE_TYPES.ROCK, 'i8'],
    [`${PLAYERS.BLUE}_rock_2`, PLAYERS.BLUE, PIECE_TYPES.ROCK, 'i7'],
  ];
  // Xanh không còn quân Kéo nào -> Đỏ chỉ cần đi 1 nước hợp lệ là thắng
  const state = makeState(pieces);
  const result = applyValidatedMove(state, PLAYERS.RED, {
    piece_id: `${PLAYERS.RED}_scissors_0`,
    to: 'e6',
  });
  assert.equal(result.state.phase, GAME_PHASES.FINISHED);
  assert.equal(result.state.winner, PLAYERS.RED);
  assert.equal(determineWinReason(result.state, PLAYERS.RED), REASONS.TYPE_ELIMINATED);
});

test('M1: request move gửi đủ 18 quân và legal_moves khớp engine', () => {
  const state = setupBothSides();
  const req = buildMoveRequest(state, PLAYERS.RED, 777, 1);
  assert.equal(req.protocol_version, 1);
  assert.equal(req.request, 'move');
  assert.equal(req.seed, 777);
  assert.equal(req.turn_number, 1);
  assert.equal(req.pieces.length, 18);
  assert.ok(req.legal_moves.length > 0);
  for (const move of req.legal_moves) {
    assert.equal(Object.keys(move).sort().join(','), 'piece_id,to');
  }
  const usedPiece = req.legal_moves[0].piece_id;
  assert.equal(state.pieces[usedPiece].player, PLAYERS.RED);
  assert.equal(state.pieces[usedPiece].alive, true);
});

test('M1: replay dựng lại đúng trạng thái và kết quả đã lưu', () => {
  const state = setupBothSides();
  let current = state;
  const events = [];
  let replayResult = RESULTS.DRAW;

  for (let ply = 0; ply < 40 && current.phase === GAME_PHASES.PLAYING; ply++) {
    const moves = listAllLegalMoves(current, current.turn);
    assert.ok(moves.length > 0);
    const applied = applyValidatedMove(current, current.turn, moves[0]);
    events.push({ ply: ply + 1, ...applied.event });
    current = applied.state;
  }

  if (current.phase === GAME_PHASES.FINISHED) {
    replayResult = current.winner === PLAYERS.RED ? RESULTS.RED_WIN : RESULTS.BLUE_WIN;
  }

  const replay = {
    protocol_version: 1,
    seed: 42,
    initial_pieces: Object.values(state.pieces).map((p) => ({ ...p })),
    events,
    result: replayResult,
  };

  const rebuilt = replayFromRecord(replay);
  assert.equal(rebuilt.turn, current.turn);
  assert.equal(rebuilt.winner, current.winner);
  assert.equal(replayMatchesResult(replay).ok, true);
});

test('M1: PRNG có seed tái lập được và MAX_PLIES = 200', () => {
  const a = createRng(999);
  const b = createRng(999);
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
  assert.equal(MAX_PLIES, 200);
});

