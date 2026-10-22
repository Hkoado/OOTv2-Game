import { createNewGame, createUnplacedPieces, executeMove, GAME_PHASES } from './gameState.js';
import { RED_HOME_SQUARES, BLUE_HOME_SQUARES } from './constants.js';
import { normalizeMap } from './maps.js';
import { getValidMoves } from './rules.js';

export function createOfflineGame(map) {
  return { ...createNewGame('offline', () => 0), phase: GAME_PHASES.SETUP_RED,
    map: normalizeMap(map), repetitions: {}, ply: 0 };
}

export function offlinePlayer(state) {
  return state.phase === GAME_PHASES.SETUP_BLUE ? 'blue' : state.phase === GAME_PHASES.SETUP_RED ? 'red' : state.turn;
}

export function setupSquares(state, player = offlinePlayer(state)) {
  return (player === 'red' ? RED_HOME_SQUARES : BLUE_HOME_SQUARES).filter((s) => !state.map.blocked.includes(s));
}

export function placeOfflinePiece(state, typeOrId, square) {
  if (![GAME_PHASES.SETUP_RED, GAME_PHASES.SETUP_BLUE].includes(state.phase)) throw new Error('Không ở lượt xếp quân.');
  const player = offlinePlayer(state);
  if (!setupSquares(state).includes(square)) throw new Error('Chọn ô trống trong sân nhà.');
  const catalogue = createUnplacedPieces(player);
  const piece = catalogue.find((p) => p.id === typeOrId)
    || catalogue.find((p) => p.type === typeOrId && !state.pieces[p.id]);
  if (!piece) throw new Error('Đã xếp hết loại quân này.');
  const occupant = Object.values(state.pieces).find((p) => p.square === square && p.alive);
  const pieces = { ...state.pieces };
  if (occupant && occupant.id !== piece.id) {
    const from = pieces[piece.id]?.square;
    if (!from) throw new Error('Ô đã có quân.');
    pieces[occupant.id] = { ...occupant, square: from };
  }
  pieces[piece.id] = { ...piece, square };
  return { ...state, pieces };
}

export function fillOfflineSetup(state) {
  let next = state;
  const player = offlinePlayer(state);
  if (![GAME_PHASES.SETUP_RED, GAME_PHASES.SETUP_BLUE].includes(state.phase)) throw new Error('Không ở lượt xếp quân.');
  for (const piece of createUnplacedPieces(player)) {
    if (next.pieces[piece.id]) continue;
    const square = setupSquares(next).find((s) => !Object.values(next.pieces).some((p) => p.square === s));
    next = placeOfflinePiece(next, piece.id, square);
  }
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
  if (![GAME_PHASES.SETUP_RED, GAME_PHASES.SETUP_BLUE].includes(state.phase)
    || createUnplacedPieces(player).some((p) => !state.pieces[p.id])) throw new Error('Cần xếp đủ 9 quân trước khi xác nhận.');
  const next = { ...state, phase: player === 'red' ? GAME_PHASES.SETUP_BLUE : GAME_PHASES.PLAYING, turn: 'red' };
  return player === 'blue' ? checkTurn(next) : next;
}

export function moveOfflinePiece(state, pieceId, to) {
  const next = { ...executeMove(state, state.turn, pieceId, to, { map: state.map, clock: () => 0 }), ply: state.ply + 1 };
  return next.phase === GAME_PHASES.FINISHED ? next : checkTurn(next);
}