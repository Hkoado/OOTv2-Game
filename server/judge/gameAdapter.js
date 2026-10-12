/**
 * gameAdapter.js — Lớp adapter mỏng giữa engine OOTv2 thật (src/game/*)
 * và giao thức bot/matching của tournament.
 *
 * Nguyên tắc:
 * - KHÔNG fork luật chơi. Mọi thay đổi trạng thái đi qua các hàm gốc trong
 *   src/game/gameState.js và src/game/rules.js.
 * - Server (adapter) là trọng tài cuối: bot chỉ được gửi `placements` hoặc
 *   `{piece_id, to}`; mọi thứ khác đều bị bỏ qua/coi là lỗi.
 */

import {
  PLAYERS,
  RED_HOME_SQUARES,
  BLUE_HOME_SQUARES,
  BASES,
  squareToCoords,
  coordsToSquare,
} from '../../src/game/constants.js';
import {
  GAME_PHASES,
  createNewGame,
  createUnplacedPieces,
  startSetupRed,
  completeSetupRed,
  completeSetupBlue,
  executeMove,
} from '../../src/game/gameState.js';
import { getValidMoves, getPieceAtSquare } from '../../src/game/rules.js';

// Re-export các hằng số engine mà tầng tournament hay dùng, để nơi khác chỉ cần
// import từ adapter (một cửa duy nhất vào engine) và tránh lệch đường dẫn.
export { PLAYERS } from '../../src/game/constants.js';
export { GAME_PHASES } from '../../src/game/gameState.js';

export const PROTOCOL_VERSION = 1;

/** Số nước đi tối đa của CẢ HAI bên cộng lại; vượt qua => hòa (`move_limit`). */
export const MAX_PLIES = 200;

/** Lý do kết thúc trận hợp lệ. */
export const REASONS = {
  BASE_CAPTURE: 'base_capture',
  TYPE_ELIMINATED: 'type_eliminated',
  MOVE_LIMIT: 'move_limit',
  FORFEIT_SETUP: 'forfeit_setup',
  FORFEIT_MOVE: 'forfeit_move',
  NO_LEGAL_MOVE: 'no_legal_move',
  INTERNAL_ERROR: 'internal_error',
};

export const RESULTS = {
  RED_WIN: 'red_win',
  BLUE_WIN: 'blue_win',
  DRAW: 'draw',
};

export function homeSquaresFor(player) {
  return player === PLAYERS.RED ? [...RED_HOME_SQUARES] : [...BLUE_HOME_SQUARES];
}

export function isValidSquareName(square) {
  if (typeof square !== 'string' || square.length !== 2) return false;
  const { col, row } = squareToCoords(square);
  if (!Number.isInteger(col) || !Number.isInteger(row)) return false;
  return coordsToSquare(col, row) === square;
}

/**
 * Tạo state tournament mới: chưa ai xếp quân, phase = setup_red.
 * Dùng đúng `createNewGame` + `startSetupRed` của engine (không viết lại state machine).
 */
export function createTournamentGame(roomId = 'tournament') {
  return startSetupRed(createNewGame(roomId));
}

/** Danh sách 9 quân "chưa đặt" của một phe, lấy từ engine (không hardcode id). */
export function pieceCatalogue(player) {
  return createUnplacedPieces(player).map((p) => ({ id: p.id, type: p.type }));
}

/** Mảng 18 quân (kèm quân đã chết) để gửi cho bot / lưu replay. */
export function getPiecesArray(state) {
  return Object.values(state.pieces).map((p) => ({
    id: p.id,
    player: p.player,
    type: p.type,
    square: p.alive ? p.square : null,
    alive: !!p.alive,
  }));
}

/** Request `setup` cho bot. Red luôn được gọi trước; Blue thấy đội hình Red. */
export function buildSetupRequest(state, player, seed) {
  const request = {
    protocol_version: PROTOCOL_VERSION,
    request: 'setup',
    player,
    seed,
    my_pieces: pieceCatalogue(player),
    available_squares: homeSquaresFor(player),
    opponent_pieces: [],
  };

  if (player === PLAYERS.BLUE) {
    request.opponent_pieces = Object.values(state.pieces)
      .filter((p) => p.player === PLAYERS.RED && p.alive)
      .map((p) => ({ id: p.id, type: p.type, square: p.square }));
  }

  return request;
}

/**
 * Kiểm tra `placements` do bot trả về có hợp lệ tuyệt đối hay không.
 * Yêu cầu: đúng 9 mục, 9 piece_id duy nhất thuộc phe đó, 9 ô duy nhất nằm trong sân nhà phe đó.
 * @returns {{ ok: true, byId: Map } | { ok: false, error: string, message: string }}
 */
export function validatePlacements(player, placements) {
  if (!Array.isArray(placements)) {
    return { ok: false, error: 'bad_schema', message: 'placements phải là một mảng' };
  }
  if (placements.length !== 9) {
    return {
      ok: false,
      error: 'bad_placement_count',
      message: `Cần đúng 9 placement, nhận được ${placements.length}`,
    };
  }

  const expectedIds = new Set(pieceCatalogue(player).map((p) => p.id));
  const homeSquares = new Set(homeSquaresFor(player));
  const usedIds = new Set();
  const usedSquares = new Set();
  const byId = new Map();

  for (const raw of placements) {
    if (!raw || typeof raw !== 'object') {
      return { ok: false, error: 'bad_schema', message: 'placement không phải object' };
    }
    const pieceId = raw.piece_id;
    const square = raw.square;

    if (typeof pieceId !== 'string' || !expectedIds.has(pieceId)) {
      return {
        ok: false,
        error: 'unknown_piece',
        message: `piece_id không thuộc phe ${player}: ${String(pieceId)}`,
      };
    }
    if (usedIds.has(pieceId)) {
      return { ok: false, error: 'duplicate_piece', message: `piece_id bị lặp: ${pieceId}` };
    }
    if (!isValidSquareName(square)) {
      return { ok: false, error: 'bad_square', message: `Ô không hợp lệ: ${String(square)}` };
    }
    if (!homeSquares.has(square)) {
      return {
        ok: false,
        error: 'square_outside_home',
        message: `Ô ${square} không thuộc sân nhà của phe ${player}`,
      };
    }
    if (usedSquares.has(square)) {
      return { ok: false, error: 'duplicate_square', message: `Ô bị trùng: ${square}` };
    }

    usedIds.add(pieceId);
    usedSquares.add(square);
    byId.set(pieceId, square);
  }

  for (const id of expectedIds) {
    if (!usedIds.has(id)) {
      return { ok: false, error: 'incomplete_placements', message: `Thiếu quân: ${id}` };
    }
  }

  return { ok: true, byId };
}

/**
 * Áp dụng setup hợp lệ vào state bằng chính `completeSetupRed/Blue` của engine.
 * `byId` đến từ `validatePlacements`. Vì đã đủ 9 ô nên `autoPlaceRemaining`
 * bên trong engine là no-op (không phụ thuộc Math.random).
 */
export function applySetup(state, player, byId) {
  const placed = createUnplacedPieces(player).map((piece) => ({
    ...piece,
    square: byId.get(piece.id),
  }));

  if (player === PLAYERS.RED) {
    return completeSetupRed(state, placed);
  }
  return completeSetupBlue(state, placed);
}

/** Toàn bộ nước đi hợp lệ của phe đang tới lượt, sinh từ `getValidMoves`. */
export function listAllLegalMoves(state, player) {
  const moves = [];
  for (const piece of Object.values(state.pieces)) {
    if (!piece.alive || piece.player !== player) continue;
    for (const move of getValidMoves(state.pieces, piece.id)) {
      moves.push({ piece_id: piece.id, to: move.square });
    }
  }
  return moves;
}

/** Request `move` gửi cho bot: toàn bộ 18 quân + danh sách nước hợp lệ. */
export function buildMoveRequest(state, player, seed, turnNumber) {
  return {
    protocol_version: PROTOCOL_VERSION,
    request: 'move',
    player,
    seed,
    turn_number: turnNumber,
    pieces: getPiecesArray(state),
    legal_moves: listAllLegalMoves(state, player),
  };
}

/**
 * Kiểm tra response `move` của bot. Trả về `{ state, event }` hoặc ném lỗi có `code`.
 * Luôn chạy qua `executeMove` để engine là trọng tài cuối cùng.
 */
export function applyValidatedMove(state, player, response) {
  if (!response || typeof response !== 'object') {
    const error = new Error('Response move không phải object');
    error.code = 'bad_schema';
    throw error;
  }
  const pieceId = response.piece_id;
  const to = response.to;

  if (typeof pieceId !== 'string' || typeof to !== 'string') {
    const error = new Error('Response move thiếu piece_id/to dạng chuỗi');
    error.code = 'bad_schema';
    throw error;
  }

  const legal = listAllLegalMoves(state, player);
  const allowed = legal.some((m) => m.piece_id === pieceId && m.to === to);
  if (!allowed) {
    const error = new Error(`Nước đi không có trong legal_moves: ${pieceId} -> ${to}`);
    error.code = 'illegal_move';
    throw error;
  }

  const victim = getPieceAtSquare(state.pieces, to);
  const from = state.pieces[pieceId]?.square ?? null;
  const next = executeMove(state, player, pieceId, to);

  return {
    state: next,
    event: {
      player,
      piece_id: pieceId,
      from,
      to,
      captured_piece_id: victim && victim.player !== player ? victim.id : null,
    },
  };
}

/** Phân loại lý do thắng theo state cuối (nhà chính trước, sau đó diệt loại quân). */
export function determineWinReason(state, winner) {
  const base = winner === PLAYERS.RED ? BASES[PLAYERS.BLUE] : BASES[PLAYERS.RED];
  const onBase = Object.values(state.pieces).some(
    (p) => p.alive && p.player === winner && p.square === base
  );
  return onBase ? REASONS.BASE_CAPTURE : REASONS.TYPE_ELIMINATED;
}

export function winnerPlayerToResult(winner) {
  if (winner === PLAYERS.RED) return RESULTS.RED_WIN;
  if (winner === PLAYERS.BLUE) return RESULTS.BLUE_WIN;
  return RESULTS.DRAW;
}

export function otherPlayer(player) {
  return player === PLAYERS.RED ? PLAYERS.BLUE : PLAYERS.RED;
}

/**
 * Dựng lại state từ replay đã lưu (`initial_pieces` + `events`) và đi qua từng event
 * bằng chính engine. Dùng cho UI replay và cho test tính nhất quán của replay.
 */
export function replayFromRecord(replay) {
  const pieces = {};
  for (const piece of replay.initial_pieces || []) {
    pieces[piece.id] = { ...piece };
  }

  let state = {
    ...createNewGame('replay'),
    phase: GAME_PHASES.PLAYING,
    turn: PLAYERS.RED,
    pieces,
    history: [],
  };

  for (const event of replay.events || []) {
    state = executeMove(state, event.player, event.piece_id, event.to);
  }

  return state;
}

/** Kiểm tra state replay kết thúc có khớp kết quả đã lưu hay không. */
export function replayMatchesResult(replay) {
  let state;
  try {
    state = replayFromRecord(replay);
  } catch {
    return { ok: false, reason: 'replay_invalid' };
  }

  const finished = state.phase === GAME_PHASES.FINISHED;
  const expected = replay.result;

  if (expected === RESULTS.DRAW) {
    return { ok: !finished, reason: finished ? 'unexpected_finish' : 'draw_consistent' };
  }

  if (!finished) return { ok: false, reason: 'expected_winner_but_not_finished' };

  const actual = winnerPlayerToResult(state.winner);
  return { ok: actual === expected, reason: actual === expected ? 'consistent' : 'result_mismatch' };
}
