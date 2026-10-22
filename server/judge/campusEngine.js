/** Versioned Campus engine. No bot execution, DB, network or ambient clock/RNG. */
import { createNewGame, createUnplacedPieces, executeMove, GAME_PHASES } from '../../src/game/gameState.js';
import { PLAYERS, BASES, RED_HOME_SQUARES, BLUE_HOME_SQUARES } from '../../src/game/constants.js';
import { getValidMoves } from '../../src/game/rules.js';
import { normalizeMap, RULES_VERSION } from '../../src/game/maps.js';
import { contentHash, mapHash } from '../contracts/canonical.js';
import { validatePlacements, otherPlayer } from './gameAdapter.js';

export const CAMPUS_MAX_PLIES = 400;
export const BOT_FAULTS = Object.freeze([
  'BOT_TIMEOUT', 'BOT_CPU_LIMIT', 'BOT_MEMORY_LIMIT', 'BOT_CRASH',
  'INVALID_JSON', 'INVALID_SETUP', 'ILLEGAL_MOVE', 'OUTPUT_LIMIT', 'PROTOCOL_ERROR',
]);
const fixedClock = () => 0;
const isPlayer = (player) => player === PLAYERS.RED || player === PLAYERS.BLUE;
function requirePlayer(player) {
  if (!isPlayer(player)) throw new Error('Invalid player');
}
function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
}

export function createCampusGame({ map, seed, id = 'campus' }, { clock = fixedClock } = {}) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('Seed must be uint32');
  const normalized = normalizeMap(map);
  Object.freeze(normalized.bases);
  Object.freeze(normalized.blocked);
  Object.freeze(normalized);
  return {
    ...createNewGame(id, clock), phase: GAME_PHASES.SETUP_RED,
    rulesVersion: RULES_VERSION, map: normalized, mapHash: mapHash(normalized), seed,
    ply: 0, repetitions: {}, result: null, terminationReason: null,
  };
}

export function campusLegalMoves(state, player = state.turn) {
  requirePlayer(player);
  if (state.phase !== GAME_PHASES.PLAYING || state.turn !== player) return [];
  return Object.values(state.pieces).filter((p) => p.player === player && p.alive)
    .flatMap((p) => getValidMoves(state.pieces, p.id, state.map).map((m) => ({ pieceId: p.id, to: m.square })));
}

export function validateCampusSetup(state, player, placements) {
  requirePlayer(player);
  if (state.phase !== (player === PLAYERS.RED ? GAME_PHASES.SETUP_RED : GAME_PHASES.SETUP_BLUE)) {
    return { ok: false, error: 'wrong_phase' };
  }
  if (!Array.isArray(placements) || !placements.every((p) => exactKeys(p, ['pieceId', 'square']))) {
    return { ok: false, error: 'bad_schema' };
  }
  const checked = validatePlacements(player, placements.map((p) => ({ piece_id: p.pieceId, square: p.square })));
  if (!checked.ok) return checked;
  const blocked = new Set(state.map.blocked);
  if (placements.some((p) => blocked.has(p.square))) return { ok: false, error: 'blocked_square' };
  return checked;
}

export function repetitionKey(state) {
  return contentHash({
    mapHash: state.mapHash, turn: state.turn,
    pieces: Object.values(state.pieces).filter((p) => p.alive)
      .map((p) => `${p.player}:${p.type}:${p.square}`).sort(),
  });
}

function terminal(state, winner, reason) {
  return {
    ...state, phase: GAME_PHASES.FINISHED, winner,
    result: winner ? `${winner}_win` : 'draw', terminationReason: reason, winReason: reason,
  };
}

function checkNextTurn(state) {
  if (!campusLegalMoves(state).length) return terminal(state, otherPlayer(state.turn), 'NO_LEGAL_MOVE');
  const key = repetitionKey(state);
  const count = (state.repetitions[key] || 0) + 1;
  const counted = { ...state, repetitions: { ...state.repetitions, [key]: count } };
  if (count >= 3) return terminal(counted, null, 'REPETITION');
  if (state.ply >= CAMPUS_MAX_PLIES) return terminal(counted, null, 'PLY_LIMIT');
  return counted;
}

export function applyCampusSetup(state, player, placements, { clock = fixedClock } = {}) {
  const checked = validateCampusSetup(state, player, placements);
  if (!checked.ok) throw new Error(`Invalid setup: ${checked.error}`);
  const pieces = { ...state.pieces };
  for (const piece of createUnplacedPieces(player)) {
    pieces[piece.id] = { ...piece, square: checked.byId.get(piece.id) };
  }
  const next = {
    ...state, pieces,
    unplacedPieces: { ...state.unplacedPieces, [player]: [] },
    phase: player === PLAYERS.RED ? GAME_PHASES.SETUP_BLUE : GAME_PHASES.PLAYING,
    turn: PLAYERS.RED, updatedAt: clock(),
  };
  return player === PLAYERS.BLUE ? checkNextTurn(next) : next;
}

export function applyCampusMove(state, player, move, { clock = fixedClock } = {}) {
  requirePlayer(player);
  if (!exactKeys(move, ['pieceId', 'to'])) throw new Error('Invalid move schema');
  const moved = executeMove(state, player, move.pieceId, move.to, { map: state.map, clock });
  const next = { ...moved, ply: state.ply + 1 };
  if (next.winner) {
    const atBase = Object.values(next.pieces).some((p) => p.alive && p.player === next.winner && p.square === BASES[otherPlayer(next.winner)]);
    return terminal(next, next.winner, atBase ? 'BASE_REACHED' : 'TYPE_ELIMINATED');
  }
  return checkNextTurn(next);
}

/** Supervisor supplies measured bot faults. Infrastructure errors never award points. */
export function adjudicateCampusBotFault(state, player, fault) {
  requirePlayer(player);
  if (!BOT_FAULTS.includes(fault)) throw new Error('Unsupported bot fault');
  const expected = state.phase === GAME_PHASES.SETUP_RED ? PLAYERS.RED
    : state.phase === GAME_PHASES.SETUP_BLUE ? PLAYERS.BLUE
      : state.phase === GAME_PHASES.PLAYING ? state.turn : null;
  if (expected !== player) throw new Error('Fault outside active player/phase');
  return terminal(state, otherPlayer(player), fault);
}

export function campusObservation(state, player) {
  requirePlayer(player);
  const home = player === PLAYERS.RED ? RED_HOME_SQUARES : BLUE_HOME_SQUARES;
  return structuredClone({
    id: state.roomId, rulesVersion: state.rulesVersion, map: state.map, mapHash: state.mapHash,
    seed: state.seed, you: player, phase: state.phase, turn: state.turn, ply: state.ply,
    pieces: Object.values(state.pieces).filter((p) => p.alive),
    unplaced: state.unplacedPieces[player],
    availableSquares: home.filter((s) => !state.map.blocked.includes(s)),
    legalMoves: campusLegalMoves(state, player),
  });
}

/** Hash authoritative state only; presentation timestamps/history are not decisions. */
export function campusStateHash(state) {
  return contentHash({
    rulesVersion: state.rulesVersion, mapHash: state.mapHash, seed: state.seed,
    phase: state.phase, turn: state.turn, ply: state.ply,
    pieces: Object.values(state.pieces).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    repetitions: state.repetitions, result: state.result, terminationReason: state.terminationReason,
  });
}
