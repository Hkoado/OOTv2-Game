/**
 * replay.js — Dựng lại ván đấu chỉ để XEM từ `initial_pieces` + `events` do API trả về.
 *
 * Nguyên tắc: dùng đúng engine `src/game/gameState.js` (`executeMove`) nên board replay
 * khớp tuyệt đối với trọng tài server; không tự viết lại luật và không cho người xem
 * tác động vào state (read-only).
 */

import { GAME_PHASES, createNewGame, executeMove } from '../game/gameState.js';
import { PLAYERS } from '../game/constants.js';

const INITIAL_DESCRIPTION = 'Thế trận ban đầu sau khi hai đội xếp quân';

function snapshot(state, index, lastMove, description) {
  return {
    index,
    pieces: state.pieces,
    turn: state.turn,
    phase: state.phase,
    winner: state.winner || null,
    winReason: state.winReason || null,
    lastMove: lastMove || null,
    description: description || INITIAL_DESCRIPTION,
  };
}

/**
 * @param {object} replay  Payload từ `GET /api/matches/:id/replay`
 * @returns {{frames: object[], error: string|null, finished: boolean}}
 *   `frames[0]` là trạng thái ban đầu; `frames[n]` là sau nước thứ n.
 */
export function buildReplayFrames(replay) {
  const pieces = {};
  for (const piece of replay?.initial_pieces || []) {
    pieces[piece.id] = { ...piece };
  }

  const start = {
    ...createNewGame('replay'),
    phase: GAME_PHASES.PLAYING,
    turn: PLAYERS.RED,
    pieces,
    history: [],
  };

  const frames = [snapshot(start, 0, null, INITIAL_DESCRIPTION)];
  let state = start;

  const events = replay?.events || [];
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    try {
      state = executeMove(state, event.player, event.piece_id, event.to);
    } catch (error) {
      return {
        frames,
        finished: false,
        error: `Không dựng lại được nước ${index + 1} (${event.piece_id} → ${event.to}): ${error.message}`,
      };
    }
    frames.push(
      snapshot(
        state,
        index + 1,
        { from: event.from, to: event.to, player: event.player, captured: event.captured_piece_id || null },
        state.history[state.history.length - 1]
      )
    );
  }

  return { frames, finished: state.phase === GAME_PHASES.FINISHED, error: null };
}

/** Quân còn sống của một ô (dùng cho board read-only). */
export function pieceAtSquare(pieces, square) {
  return Object.values(pieces || {}).find((piece) => piece.alive && piece.square === square) || null;
}

export default { buildReplayFrames, pieceAtSquare };
