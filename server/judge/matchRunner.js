/**
 * matchRunner.js — Chạy MỘT trận: setup Đỏ -> setup Xanh -> vòng lặp nước đi.
 * Server (engine) là trọng tài duy nhất:
 * - Mọi nước đi phải nằm trong `legal_moves` do engine sinh.
 * - Bot tự báo thắng/thua bị bỏ qua hoàn toàn.
 * - Bot lỗi (timeout, JSON hỏng, exit != 0) => thua `forfeit_*`, worker không chết.
 */

import config from '../config.js';
import { EMPTY_MAP } from '../../src/game/maps.js';
import { runBotRequest } from './botRunner.js';
import { GAME_PHASES } from '../../src/game/gameState.js';
import {
  PLAYERS,
  MAX_PLIES,
  PROTOCOL_VERSION,
  REASONS,
  RESULTS,
  createTournamentGame,
  buildSetupRequest,
  validatePlacements,
  applySetup,
  buildMoveRequest,
  listAllLegalMoves,
  applyValidatedMove,
  determineWinReason,
  winnerPlayerToResult,
  otherPlayer,
  getPiecesArray,
  replayMatchesResult,
} from './gameAdapter.js';

function emptyReplay(matchId, seed, pieces, result, reason, map = EMPTY_MAP) {
  return {
    protocol_version: PROTOCOL_VERSION,
    match_id: matchId,
    seed,
    map: map || EMPTY_MAP,
    initial_pieces: pieces,
    events: [],
    result: result || null,
    reason: reason || null,
  };
}

/**
 * @param {{ matchId: string, seed: number, red: {name: string, filePath: string},
 *           blue: {name: string, filePath: string}, onProgress?: Function }} options
 * @returns {Promise<{result: string, reason: string, winner: string|null, ply_count: number,
 *                    replay: object, notes: string[]}>}
 */
export async function runMatch({ matchId, seed, red, blue, map = EMPTY_MAP, onProgress }) {
  const activeMap = map || EMPTY_MAP;
  const notes = [];
  const bots = {
    [PLAYERS.RED]: red,
    [PLAYERS.BLUE]: blue,
  };

  const callBot = (player, payload, timeoutMs) =>
    runBotRequest({ filePath: bots[player].filePath, payload, timeoutMs });

  try {
    let state = createTournamentGame(matchId, activeMap);

    // --- Setup Đỏ trước ---
    const redSetup = await callBot(
      PLAYERS.RED,
      buildSetupRequest(state, PLAYERS.RED, seed, activeMap),
      config.limits.setupTimeoutMs
    );
    if (!redSetup.ok) {
      notes.push(`setup Đỏ lỗi (${redSetup.errorCode}): ${redSetup.message}`);
      return {
        result: RESULTS.BLUE_WIN,
        reason: REASONS.FORFEIT_SETUP,
        winner: PLAYERS.BLUE,
        ply_count: 0,
        replay: emptyReplay(matchId, seed, getPiecesArray(state), RESULTS.BLUE_WIN, REASONS.FORFEIT_SETUP, activeMap),
        notes,
      };
    }
    const redCheck = validatePlacements(PLAYERS.RED, redSetup.response.placements, activeMap);
    if (!redCheck.ok) {
      notes.push(`setup Đỏ không hợp lệ (${redCheck.error}): ${redCheck.message}`);
      return {
        result: RESULTS.BLUE_WIN,
        reason: REASONS.FORFEIT_SETUP,
        winner: PLAYERS.BLUE,
        ply_count: 0,
        replay: emptyReplay(matchId, seed, getPiecesArray(state), RESULTS.BLUE_WIN, REASONS.FORFEIT_SETUP, activeMap),
        notes,
      };
    }
    state = applySetup(state, PLAYERS.RED, redCheck.byId);

    // --- Setup Xanh (thấy đội hình Đỏ) ---
    const blueSetup = await callBot(
      PLAYERS.BLUE,
      buildSetupRequest(state, PLAYERS.BLUE, seed, activeMap),
      config.limits.setupTimeoutMs
    );
    if (!blueSetup.ok) {
      notes.push(`setup Xanh lỗi (${blueSetup.errorCode}): ${blueSetup.message}`);
      return {
        result: RESULTS.RED_WIN,
        reason: REASONS.FORFEIT_SETUP,
        winner: PLAYERS.RED,
        ply_count: 0,
        replay: emptyReplay(matchId, seed, getPiecesArray(state), RESULTS.RED_WIN, REASONS.FORFEIT_SETUP, activeMap),
        notes,
      };
    }
    const blueCheck = validatePlacements(PLAYERS.BLUE, blueSetup.response.placements, activeMap);
    if (!blueCheck.ok) {
      notes.push(`setup Xanh không hợp lệ (${blueCheck.error}): ${blueCheck.message}`);
      return {
        result: RESULTS.RED_WIN,
        reason: REASONS.FORFEIT_SETUP,
        winner: PLAYERS.RED,
        ply_count: 0,
        replay: emptyReplay(matchId, seed, getPiecesArray(state), RESULTS.RED_WIN, REASONS.FORFEIT_SETUP, activeMap),
        notes,
      };
    }
    state = applySetup(state, PLAYERS.BLUE, blueCheck.byId);

    const initialPieces = getPiecesArray(state);
    const events = [];

    return await playLoop({
      state,
      events,
      initialPieces,
      matchId,
      seed,
      map: activeMap,
      callBot,
      notes,
      onProgress,
    });
  } catch (error) {
    // Lỗi ngoài dự kiến của engine/runner: không được làm chết worker.
    notes.push(`lỗi nội bộ khi chạy trận: ${error.message}`);
    return {
      result: RESULTS.DRAW,
      reason: REASONS.INTERNAL_ERROR,
      winner: null,
      ply_count: 0,
      replay: emptyReplay(matchId, seed, [], RESULTS.DRAW, REASONS.INTERNAL_ERROR, activeMap),
      notes,
    };
  }
}

function buildFinished(matchId, seed, initialPieces, events, result, reason, notes, map = EMPTY_MAP) {
  const replay = {
    protocol_version: PROTOCOL_VERSION,
    match_id: matchId,
    seed,
    map: map || EMPTY_MAP,
    initial_pieces: initialPieces,
    events,
    result,
    reason,
  };
  // Chỉ kiểm tra tính nhất quán replay cho các trận kết thúc bằng luật engine;
  // forfeit/timeout là quyết định của giải nên không thể dựng lại từ events.
  if (reason === REASONS.BASE_CAPTURE || reason === REASONS.TYPE_ELIMINATED || reason === REASONS.MOVE_LIMIT) {
    const consistency = replayMatchesResult(replay);
    if (!consistency.ok) {
      notes.push(`replay không khớp kết quả (${consistency.reason})`);
    }
    replay.replay_consistent = consistency.ok;
  }

  return {
    result,
    reason,
    winner: result === RESULTS.RED_WIN ? PLAYERS.RED : result === RESULTS.BLUE_WIN ? PLAYERS.BLUE : null,
    ply_count: events.length,
    replay,
    notes,
  };
}

/** Vòng lặp nước đi: engine kiểm tra từng nước, giới hạn MAX_PLIES. */
async function playLoop({ state, events, initialPieces, matchId, seed, map = EMPTY_MAP, callBot, notes, onProgress }) {
  let current = state;
  const activeMap = map || EMPTY_MAP;

  for (let ply = 1; ply <= MAX_PLIES; ply += 1) {
    const player = current.turn;
    const legalMoves = listAllLegalMoves(current, player, activeMap);

    if (legalMoves.length === 0) {
      notes.push(`${player} không còn nước đi hợp lệ`);
      const winner = otherPlayer(player);
      return buildFinished(
        matchId, seed, initialPieces, events,
        winnerPlayerToResult(winner),
        REASONS.NO_LEGAL_MOVE,
        notes,
        activeMap
      );
    }

    const live = await callBot(
      player,
      buildMoveRequest(current, player, seed, ply, activeMap),
      config.limits.moveTimeoutMs
    );
    if (!live.ok) {
      notes.push(`bot ${player} lỗi nước đi (${live.errorCode}): ${live.message}`);
      const winner = otherPlayer(player);
      return buildFinished(
        matchId, seed, initialPieces, events,
        winnerPlayerToResult(winner),
        REASONS.FORFEIT_MOVE,
        notes,
        activeMap
      );
    }

    let applied;
    try {
      applied = applyValidatedMove(current, player, live.response, activeMap);
    } catch (error) {
      notes.push(`bot ${player} trả nước không hợp lệ: ${error.message}`);
      const winner = otherPlayer(player);
      return buildFinished(
        matchId, seed, initialPieces, events,
        winnerPlayerToResult(winner),
        REASONS.FORFEIT_MOVE,
        notes,
        activeMap
      );
    }

    current = applied.state;
    events.push({ ply, ...applied.event });
    if (onProgress) onProgress({ ply, event: applied.event });

    if (current.phase === GAME_PHASES.FINISHED && current.winner) {
      const reason = determineWinReason(current, current.winner);
      return buildFinished(
        matchId, seed, initialPieces, events,
        winnerPlayerToResult(current.winner),
        reason,
        notes,
        activeMap
      );
    }
  }

  notes.push(`đạt giới hạn ${MAX_PLIES} plies`);
  return buildFinished(matchId, seed, initialPieces, events, RESULTS.DRAW, REASONS.MOVE_LIMIT, notes, activeMap);
}

export default { runMatch };
