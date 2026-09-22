import {
  PLAYERS,
  PIECE_TYPES,
  INITIAL_PIECE_SET,
  RED_HOME_SQUARES,
  BLUE_HOME_SQUARES,
  SETUP_TIME_SECONDS,
  PIECE_LABELS,
} from './constants.js';
import { getValidMoves, checkWinCondition, getPieceAtSquare } from './rules.js';

export const GAME_PHASES = {
  WAITING: 'waiting',       // Chờ người chơi 2 vào
  SETUP_RED: 'setup_red',   // Đội Đỏ xếp 9 quân (30s)
  SETUP_BLUE: 'setup_blue', // Đội Xanh xếp 9 quân (30s)
  PLAYING: 'playing',       // Thi đấu chính thức (Đỏ đi trước)
  FINISHED: 'finished',     // Kết thúc ván đấu
};

/**
 * Tạo danh sách 9 quân ban đầu cho 1 bên (chưa đặt lên bàn cờ)
 */
export function createUnplacedPieces(player) {
  return INITIAL_PIECE_SET.map((type, index) => ({
    id: `${player}_${type}_${index}`,
    player,
    type,
    square: null,
    alive: true,
  }));
}

/**
 * Tự động xếp các quân còn lại vào các ô trống hợp lệ trong sân nhà
 */
export function autoPlaceRemaining(existingPlacedPieces, player) {
  const homeSquares = player === PLAYERS.RED ? [...RED_HOME_SQUARES] : [...BLUE_HOME_SQUARES];
  
  // Các ô đã có quân
  const occupiedSquares = new Set(
    existingPlacedPieces.map((p) => p.square).filter(Boolean)
  );

  // Các ô còn trống trong sân nhà
  const availableSquares = homeSquares.filter((sq) => !occupiedSquares.has(sq));
  
  // Trộn ngẫu nhiên ô trống
  for (let i = availableSquares.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [availableSquares[i], availableSquares[j]] = [availableSquares[j], availableSquares[i]];
  }

  const result = [...existingPlacedPieces];
  let squareIdx = 0;

  for (const piece of result) {
    if (!piece.square && squareIdx < availableSquares.length) {
      piece.square = availableSquares[squareIdx++];
    }
  }

  return result;
}

/**
 * Trạng thái khởi tạo của một phòng chơi mới
 */
export function createNewGame(roomId = 'ROOM_1') {
  return {
    roomId,
    hostId: null, // ID của chủ phòng tạo phòng
    phase: GAME_PHASES.WAITING,
    turn: PLAYERS.RED, // Đỏ đi trước
    seats: {
      [PLAYERS.RED]: null,  // { id, name }
      [PLAYERS.BLUE]: null, // { id, name }
    },
    participants: [], // Danh sách người trong phòng: [{ id, name, isHost, joinedAt }]
    spectators: [],   // Danh sách ID người xem
    pieces: {},       // { [id]: piece }
    unplacedPieces: {
      [PLAYERS.RED]: createUnplacedPieces(PLAYERS.RED),
      [PLAYERS.BLUE]: createUnplacedPieces(PLAYERS.BLUE),
    },
    setupDeadline: null, // Timestamp hết hạn xếp quân (30s)
    history: [],         // Danh sách các nước đi đã qua
    lastMove: null,      // { from, to, pieceId, capturedPieceId }
    winner: null,        // 'red' | 'blue'
    winReason: null,     // Lý do thắng
    updatedAt: Date.now(),
  };
}

/**
 * Chủ phòng duyệt đối thủ vào Đội Xanh và bắt đầu giai đoạn xếp quân Đỏ (30s)
 */
export function approveOpponent(state, opponent) {
  if (!opponent || !opponent.id) return state;
  return {
    ...state,
    seats: {
      ...state.seats,
      [PLAYERS.BLUE]: { id: opponent.id, name: opponent.name },
    },
    phase: GAME_PHASES.SETUP_RED,
    setupDeadline: Date.now() + SETUP_TIME_SECONDS * 1000,
    updatedAt: Date.now(),
  };
}

/**
 * Bắt đầu giai đoạn xếp quân của Đội Đỏ (30s)
 */
export function startSetupRed(state) {
  return {
    ...state,
    phase: GAME_PHASES.SETUP_RED,
    setupDeadline: Date.now() + SETUP_TIME_SECONDS * 1000,
    updatedAt: Date.now(),
  };
}

/**
 * Hoàn tất xếp quân của Đội Đỏ, chuyển sang Đội Xanh xếp (30s)
 */
export function completeSetupRed(state, redPieces) {
  // Đảm bảo đủ 9 quân được xếp
  const finalRed = autoPlaceRemaining(redPieces, PLAYERS.RED);
  const newPieces = { ...state.pieces };
  finalRed.forEach((p) => {
    newPieces[p.id] = p;
  });

  return {
    ...state,
    pieces: newPieces,
    unplacedPieces: {
      ...state.unplacedPieces,
      [PLAYERS.RED]: [],
    },
    phase: GAME_PHASES.SETUP_BLUE,
    setupDeadline: Date.now() + SETUP_TIME_SECONDS * 1000,
    updatedAt: Date.now(),
  };
}

/**
 * Hoàn tất xếp quân của Đội Xanh, bắt đầu trận đấu chính thức!
 */
export function completeSetupBlue(state, bluePieces) {
  const finalBlue = autoPlaceRemaining(bluePieces, PLAYERS.BLUE);
  const newPieces = { ...state.pieces };
  finalBlue.forEach((p) => {
    newPieces[p.id] = p;
  });

  return {
    ...state,
    pieces: newPieces,
    unplacedPieces: {
      ...state.unplacedPieces,
      [PLAYERS.BLUE]: [],
    },
    phase: GAME_PHASES.PLAYING,
    turn: PLAYERS.RED, // Đội Đỏ đi trước
    setupDeadline: null,
    history: [],
    lastMove: null,
    winner: null,
    winReason: null,
    updatedAt: Date.now(),
  };
}

/**
 * Thực hiện nước đi của một người chơi
 */
export function executeMove(state, playerId, pieceId, targetSquare) {
  if (state.phase !== GAME_PHASES.PLAYING) {
    throw new Error('Trận đấu chưa bắt đầu hoặc đã kết thúc');
  }

  if (state.turn !== playerId) {
    throw new Error('Chưa đến lượt của bạn');
  }

  const piece = state.pieces[pieceId];
  if (!piece || piece.player !== playerId || !piece.alive) {
    throw new Error('Quân cờ không hợp lệ');
  }

  const validMoves = getValidMoves(state.pieces, pieceId);
  const move = validMoves.find((m) => m.square === targetSquare);

  if (!move) {
    throw new Error('Nước đi không hợp lệ theo luật OTTv2');
  }

  const fromSquare = piece.square;
  const newPieces = { ...state.pieces };

  // Cập nhật vị trí quân đi
  newPieces[pieceId] = {
    ...piece,
    square: targetSquare,
  };

  let captureInfo = null;
  // Nếu là nước ăn quân
  if (move.type === 'capture' && move.capturedPieceId) {
    const victim = state.pieces[move.capturedPieceId];
    newPieces[move.capturedPieceId] = {
      ...victim,
      alive: false,
      square: null,
    };
    captureInfo = {
      victimPlayer: victim.player,
      victimType: victim.type,
      victimLabel: PIECE_LABELS[victim.type],
    };
  }

  // Kiểm tra thắng thua
  const winCheck = checkWinCondition(newPieces);

  // Tạo bản ghi lịch sử nước đi
  const moveNumber = state.history.length + 1;
  const moveText = captureInfo
    ? `${moveNumber}. ${piece.player === PLAYERS.RED ? 'Đỏ' : 'Xanh'} ${PIECE_LABELS[piece.type]}: ${fromSquare} → ${targetSquare} (Ăn ${captureInfo.victimLabel})`
    : `${moveNumber}. ${piece.player === PLAYERS.RED ? 'Đỏ' : 'Xanh'} ${PIECE_LABELS[piece.type]}: ${fromSquare} → ${targetSquare}`;

  const nextTurn = piece.player === PLAYERS.RED ? PLAYERS.BLUE : PLAYERS.RED;

  return {
    ...state,
    pieces: newPieces,
    turn: nextTurn,
    phase: winCheck ? GAME_PHASES.FINISHED : GAME_PHASES.PLAYING,
    winner: winCheck ? winCheck.winner : null,
    winReason: winCheck ? winCheck.reason : null,
    lastMove: {
      from: fromSquare,
      to: targetSquare,
      pieceId,
      capturedPieceId: move.capturedPieceId || null,
    },
    history: [...state.history, moveText],
    updatedAt: Date.now(),
  };
}
