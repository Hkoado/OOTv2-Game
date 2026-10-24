/**
 * replay.js — Dựng lại ván đấu chỉ để XEM từ payload replay do API trả về.
 *
 * Hỗ trợ cả hai định dạng:
 * 1. MVP v1: `initial_pieces` + `events` [{ player, piece_id, from, to, captured_piece_id }]
 * 2. Campus v2 (`campus-engine-replay.v1`): `config.map` + `events` [{ seq, action: { kind, player, placements|move|fault } }]
 *
 * Nguyên tắc: dùng đúng engine `src/game/gameState.js` (`executeMove`) với `map` nên board replay
 * khớp tuyệt đối với trọng tài server; không tự viết lại luật và không cho người xem
 * tác động vào state (read-only).
 */

import { GAME_PHASES, createNewGame, createUnplacedPieces, executeMove } from '../game/gameState.js';
import { PLAYERS } from '../game/constants.js';

const INITIAL_DESCRIPTION = 'Thế trận ban đầu sau khi hai đội xếp quân';
const normSquare = (s) => (typeof s === 'string' ? s.toLowerCase() : s);

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
 * @param {object} replay  Payload từ API replay (MVP hoặc Campus)
 * @returns {{frames: object[], error: string|null, finished: boolean}}
 *   `frames[0]` là trạng thái ban đầu; `frames[n]` là sau nước thứ n.
 */
export function buildReplayFrames(replay) {
  if (!replay) return { frames: [], finished: false, error: 'Không có dữ liệu replay.' };

  const map = replay?.map || replay?.config?.map || null;
  const isCampus =
    replay?.schemaVersion === 'campus-engine-replay.v1' ||
    (Array.isArray(replay?.events) && replay.events.some((ev) => ev?.action?.kind === 'setup'));

  if (isCampus) {
    const rawEvents = replay.events || [];
    const pieces = {};
    const unplacedRed = createUnplacedPieces(PLAYERS.RED);
    const unplacedBlue = createUnplacedPieces(PLAYERS.BLUE);
    for (const p of [...unplacedRed, ...unplacedBlue]) {
      pieces[p.id] = { ...p, square: null, alive: true };
    }

    const moveEvents = [];

    // 1. Phân loại setup vs move
    for (const item of rawEvents) {
      const action = item.action || item;
      if (action.kind === 'setup') {
        const player = action.player;
        const placements = action.placements || [];
        for (const pl of placements) {
          const pieceId = pl.pieceId || pl.piece_id;
          const square = normSquare(pl.square);
          if (pieces[pieceId]) {
            pieces[pieceId] = { ...pieces[pieceId], square, player, alive: true };
          }
        }
      } else {
        moveEvents.push(item);
      }
    }

    let state = {
      ...createNewGame('campus-replay'),
      phase: GAME_PHASES.PLAYING,
      turn: PLAYERS.RED,
      pieces,
      history: [],
      map,
    };

    const frames = [snapshot(state, 0, null, INITIAL_DESCRIPTION)];

    for (let index = 0; index < moveEvents.length; index += 1) {
      const item = moveEvents[index];
      const action = item.action || item;

      if (action.kind === 'move') {
        const player = action.player || state.turn;
        const move = action.move || {};
        const targetSquare = normSquare(move.to);
        let pieceId = move.pieceId || move.piece_id;
        let fromSquare = normSquare(move.from);

        if (!pieceId && fromSquare) {
          const found = Object.values(state.pieces).find((p) => p.alive && p.player === player && normSquare(p.square) === fromSquare);
          pieceId = found?.id;
        } else if (pieceId && !fromSquare) {
          fromSquare = normSquare(state.pieces[pieceId]?.square);
        }

        if (!pieceId) {
          return {
            frames,
            finished: false,
            error: `Không tìm thấy quân cờ cho nước đi thứ ${index + 1}`,
          };
        }

        const victim = Object.values(state.pieces).find(
          (p) => p.alive && p.player !== player && normSquare(p.square) === targetSquare
        );

        try {
          state = executeMove(state, player, pieceId, targetSquare, { map });
        } catch (error) {
          return {
            frames,
            finished: false,
            error: `Không dựng lại được nước ${index + 1} (${pieceId} → ${targetSquare}): ${error.message}`,
          };
        }

        frames.push(
          snapshot(
            state,
            index + 1,
            { from: fromSquare, to: targetSquare, player, captured: victim?.id || null },
            state.history[state.history.length - 1] || `${player} đi ${pieceId} tới ${targetSquare}`
          )
        );
      } else if (action.kind === 'bot_fault') {
        frames.push(
          snapshot(
            state,
            index + 1,
            null,
            `Lỗi bot (${action.player}): ${action.fault || 'Sự cố bot'}`
          )
        );
      }
    }

    return {
      frames,
      finished: state.phase === GAME_PHASES.FINISHED || Boolean(replay.result),
      error: null,
    };
  }

  // MVP Format (nguyên bản)
  const pieces = {};
  for (const piece of replay?.initial_pieces || []) {
    pieces[piece.id] = { ...piece, square: normSquare(piece.square) };
  }

  const start = {
    ...createNewGame('replay'),
    phase: GAME_PHASES.PLAYING,
    turn: PLAYERS.RED,
    pieces,
    history: [],
    map,
  };

  const frames = [snapshot(start, 0, null, INITIAL_DESCRIPTION)];
  let state = start;

  const events = replay?.events || [];
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    const targetSquare = normSquare(event.to);
    const fromSquare = normSquare(event.from);
    try {
      state = executeMove(state, event.player, event.piece_id, targetSquare, { map });
    } catch (error) {
      return {
        frames,
        finished: false,
        error: `Không dựng lại được nước ${index + 1} (${event.piece_id} → ${targetSquare}): ${error.message}`,
      };
    }
    frames.push(
      snapshot(
        state,
        index + 1,
        { from: fromSquare, to: targetSquare, player: event.player, captured: event.captured_piece_id || null },
        state.history[state.history.length - 1]
      )
    );
  }

  return { frames, finished: state.phase === GAME_PHASES.FINISHED, error: null };
}

/** Quân còn sống của một ô (dùng cho board read-only). */
export function pieceAtSquare(pieces, square) {
  const norm = normSquare(square);
  return Object.values(pieces || {}).find((piece) => piece.alive && normSquare(piece.square) === norm) || null;
}

export default { buildReplayFrames, pieceAtSquare };
