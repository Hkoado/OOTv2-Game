import { createNewGame, createUnplacedPieces, executeMove, GAME_PHASES } from './gameState.js';
import { RED_HOME_SQUARES, BLUE_HOME_SQUARES } from './constants.js';
import { EMPTY_TERRAIN_MAP, normalizeMap } from './maps.js';
import { getValidMoves } from './rules.js';
import { terrainBlocks, upgradeTerrainMap } from './terrain.js';

export function createOfflineGame(map = EMPTY_TERRAIN_MAP) {
  return { ...createNewGame('offline', () => 0), phase: GAME_PHASES.SETUP_RED,
    map: normalizeMap(upgradeTerrainMap(normalizeMap(map))), repetitions: {}, ply: 0 };
}

export function offlinePlayer(state) {
  return state.phase === GAME_PHASES.SETUP_BLUE ? 'blue' : state.phase === GAME_PHASES.SETUP_RED ? 'red' : state.turn;
}

export function setupSquares(state, player = offlinePlayer(state), type = '*') {
  return (player === 'red' ? RED_HOME_SQUARES : BLUE_HOME_SQUARES).filter((s) => !terrainBlocks(state.map, s, type));
}

/** Validate against engine-owned IDs/types, not a caller-supplied piece catalogue. */
function validateOfflinePlacements(state, player, requireComplete = false) {
  const catalogue = createUnplacedPieces(player);
  const pieces = Object.values(state.pieces).filter((p) => p.player === player);
  const used = new Set();
  for (const piece of pieces) {
    const expected = catalogue.find((p) => p.id === piece.id);
    if (!expected || expected.type !== piece.type || !piece.alive
      || !setupSquares(state, player, piece.type).includes(piece.square) || used.has(piece.square)) {
      throw new Error('Đội hình không hợp lệ theo sân nhà hoặc địa hình.');
    }
    used.add(piece.square);
  }
  if (requireComplete && (pieces.length !== 9 || catalogue.some((p) => !state.pieces[p.id]))) {
    throw new Error('Cần xếp đủ 9 quân trước khi xác nhận.');
  }
}

export function placeOfflinePiece(state, typeOrId, square) {
  if (![GAME_PHASES.SETUP_RED, GAME_PHASES.SETUP_BLUE].includes(state.phase)) throw new Error('Không ở lượt xếp quân.');
  const player = offlinePlayer(state);
  if (!setupSquares(state).includes(square)) throw new Error('Chọn ô trống trong sân nhà.');
  const catalogue = createUnplacedPieces(player);
  const piece = catalogue.find((p) => p.id === typeOrId)
    || catalogue.find((p) => p.type === typeOrId && !state.pieces[p.id]);
  if (!piece) throw new Error('Đã xếp hết loại quân này.');
  if (terrainBlocks(state.map, square, piece.type)) throw new Error('Địa hình cản loại quân này.');
  const occupant = Object.values(state.pieces).find((p) => p.square === square && p.alive);
  const pieces = { ...state.pieces };
  if (occupant && occupant.id !== piece.id) {
    const from = pieces[piece.id]?.square;
    if (!from) throw new Error('Ô đã có quân.');
    if (occupant.player !== player || !setupSquares(state, player, occupant.type).includes(from)) {
      throw new Error('Không thể đổi chỗ: địa hình cản quân tại ô ban đầu.');
    }
    pieces[occupant.id] = { ...occupant, square: from };
  }
  pieces[piece.id] = { ...piece, square };
  const next = { ...state, pieces };
  validateOfflinePlacements(next, player);
  return next;
}

export function removeOfflinePiece(state, pieceId) {
  if (![GAME_PHASES.SETUP_RED, GAME_PHASES.SETUP_BLUE].includes(state.phase)
    || state.pieces[pieceId]?.player !== offlinePlayer(state)) throw new Error('Không thể nhấc quân này.');
  const pieces = { ...state.pieces };
  delete pieces[pieceId];
  return { ...state, pieces };
}

export function fillOfflineSetup(state) {
  let next = state;
  const player = offlinePlayer(state);
  if (![GAME_PHASES.SETUP_RED, GAME_PHASES.SETUP_BLUE].includes(state.phase)) throw new Error('Không ở lượt xếp quân.');
  validateOfflinePlacements(state, player);
  const fixed = new Set(Object.values(state.pieces).map((p) => p.square));
  const assigned = new Map();
  // Bipartite matching avoids greedy dead ends on type-specific terrain.
  function assign(piece, visited) {
    for (const square of setupSquares(state, player, piece.type)) {
      if (fixed.has(square) || visited.has(square)) continue;
      visited.add(square);
      const previous = assigned.get(square);
      if (!previous || assign(previous, visited)) { assigned.set(square, piece); return true; }
    }
    return false;
  }
  for (const piece of createUnplacedPieces(player).filter((p) => !state.pieces[p.id])) {
    if (!assign(piece, new Set())) throw new Error('Không còn đủ ô hợp lệ; hãy nhấc hoặc đổi vị trí quân đã đặt.');
  }
  for (const [square, piece] of assigned) next = placeOfflinePiece(next, piece.id, square);
  return next;
}

function checkTurn(state) {
  const legal = Object.values(state.pieces).some((p) => p.alive && p.player === state.turn && getValidMoves(state.pieces, p.id, state.map).length);
  if (!legal) return { ...state, phase: GAME_PHASES.FINISHED, winner: state.turn === 'red' ? 'blue' : 'red', winReason: 'Không còn nước hợp lệ' };
  const key = JSON.stringify([state.turn, Object.values(state.pieces).filter((p) => p.alive).map((p) => `${p.player}:${p.type}:${p.square}`).sort()]);
  const repetitions = { ...state.repetitions, [key]: (state.repetitions[key] || 0) + 1 };
  if (repetitions[key] >= 3 || state.ply >= 400) return { ...state, repetitions, phase: GAME_PHASES.FINISHED, winner: null, winReason: repetitions[key] >= 3 ? 'Lặp thế 3 lần' : 'Đủ 400 nước' };
  return { ...state, repetitions };
}

export function confirmOfflineSetup(state) {
  const player = offlinePlayer(state);
  if (![GAME_PHASES.SETUP_RED, GAME_PHASES.SETUP_BLUE].includes(state.phase)) throw new Error('Không ở lượt xếp quân.');
  validateOfflinePlacements(state, player, true);
  const next = { ...state, phase: player === 'red' ? GAME_PHASES.SETUP_BLUE : GAME_PHASES.PLAYING, turn: 'red' };
  return player === 'blue' ? checkTurn(next) : next;
}

export function moveOfflinePiece(state, pieceId, to) {
  const next = { ...executeMove(state, state.turn, pieceId, to, { map: state.map, clock: () => 0 }), ply: state.ply + 1 };
  return next.phase === GAME_PHASES.FINISHED ? next : checkTurn(next);
}