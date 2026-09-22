import {
  BOARD_SIZE,
  PLAYERS,
  PIECE_TYPES,
  PIECE_LABELS,
  BEATS,
  BASES,
  squareToCoords,
  coordsToSquare,
} from './constants.js';

/**
 * Kiểm tra xem một nước đi có hợp lệ hay không theo luật OTTv2
 * @param {Object} pieces - Danh sách quân cờ hiện tại { [pieceId]: piece }
 * @param {string} pieceId - ID quân cờ muốn di chuyển
 * @returns {Array<{ square: string, type: 'move' | 'capture', capturedPieceId?: string }>} Danh sách các ô có thể đi
 */
export function getValidMoves(pieces, pieceId) {
  const piece = pieces[pieceId];
  if (!piece || !piece.alive) return [];

  const { col, row } = squareToCoords(piece.square);
  const validMoves = [];

  // 8 hướng di chuyển như quân Vua (tối đa 1 ô)
  const directions = [
    [-1, -1], [-1, 0], [-1, 1],
    [0, -1],           [0, 1],
    [1, -1],  [1, 0],  [1, 1],
  ];

  for (const [dx, dy] of directions) {
    const targetCol = col + dx;
    const targetRow = row + dy;

    // Nằm ngoài bàn cờ 9x9
    if (targetCol < 1 || targetCol > BOARD_SIZE || targetRow < 1 || targetRow > BOARD_SIZE) {
      continue;
    }

    const targetSquare = coordsToSquare(targetCol, targetRow);
    const occupant = getPieceAtSquare(pieces, targetSquare);

    if (!occupant) {
      // Ô trống -> có thể di chuyển
      validMoves.push({
        square: targetSquare,
        type: 'move',
      });
      continue;
    }

    // Nếu là quân phe mình -> bị chặn
    if (occupant.player === piece.player) {
      continue;
    }

    // Quân địch:
    // 1. Cùng loại: hai quân cùng loại không thể ăn nhau mà chỉ đứng chặn đường nhau
    if (occupant.type === piece.type) {
      continue;
    }

    // 2. Quân ta mạnh hơn quân địch (Búa ăn Kéo, Kéo ăn Bao, Bao ăn Búa)
    if (BEATS[piece.type] === occupant.type) {
      validMoves.push({
        square: targetSquare,
        type: 'capture',
        capturedPieceId: occupant.id,
      });
      continue;
    }

    // 3. Quân ta yếu hơn quân địch (ví dụ Kéo đi vào ô Búa của địch)
    // -> Hệ thống chặn nước đi tự sát
    continue;
  }

  return validMoves;
}

/**
 * Lấy quân cờ còn sống tại ô square
 */
export function getPieceAtSquare(pieces, square) {
  return Object.values(pieces).find(
    (p) => p.alive && p.square === square
  ) || null;
}

/**
 * Đếm số lượng quân còn lại theo từng loại của một người chơi
 */
export function getRemainingPieceCounts(pieces, player) {
  const counts = {
    [PIECE_TYPES.ROCK]: 0,
    [PIECE_TYPES.PAPER]: 0,
    [PIECE_TYPES.SCISSORS]: 0,
  };

  Object.values(pieces).forEach((piece) => {
    if (piece.alive && piece.player === player) {
      counts[piece.type] = (counts[piece.type] || 0) + 1;
    }
  });

  return counts;
}

/**
 * Kiểm tra điều kiện thắng của trận đấu
 * 1. Đưa quân vào nhà chính đối phương (Đỏ vào i9, Xanh vào a1)
 * 2. Ăn hết sạch hoàn toàn 1 loại quân của đối phương
 * @param {Object} pieces
 * @returns {{ winner: 'red' | 'blue', reason: string } | null}
 */
export function checkWinCondition(pieces) {
  // 1. Kiểm tra Nhà chính
  // Đội Đỏ vào ô Nhà chính i9 của Đội Xanh
  const redReachedBase = Object.values(pieces).some(
    (p) => p.alive && p.player === PLAYERS.RED && p.square === BASES[PLAYERS.BLUE]
  );
  if (redReachedBase) {
    return {
      winner: PLAYERS.RED,
      reason: `Đội Đỏ đã thành công đưa quân vào Nhà chính (${BASES[PLAYERS.BLUE]}) của Đội Xanh!`,
    };
  }

  // Đội Xanh vào ô Nhà chính a1 của Đội Đỏ
  const blueReachedBase = Object.values(pieces).some(
    (p) => p.alive && p.player === PLAYERS.BLUE && p.square === BASES[PLAYERS.RED]
  );
  if (blueReachedBase) {
    return {
      winner: PLAYERS.BLUE,
      reason: `Đội Xanh đã thành công đưa quân vào Nhà chính (${BASES[PLAYERS.RED]}) của Đội Đỏ!`,
    };
  }

  // 2. Kiểm tra Ăn hết sạch 1 loại quân của đối phương
  const redCounts = getRemainingPieceCounts(pieces, PLAYERS.RED);
  const blueCounts = getRemainingPieceCounts(pieces, PLAYERS.BLUE);

  // Kiểm tra xem Đội Xanh có bị diệt sạch 1 loại quân nào không -> Nếu có, Đội Đỏ thắng
  for (const type of Object.values(PIECE_TYPES)) {
    if (blueCounts[type] === 0) {
      return {
        winner: PLAYERS.RED,
        reason: `Đội Đỏ đã tiêu diệt hoàn toàn toàn bộ quân ${PIECE_LABELS[type]} của Đội Xanh!`,
      };
    }
  }

  // Kiểm tra xem Đội Đỏ có bị diệt sạch 1 loại quân nào không -> Nếu có, Đội Xanh thắng
  for (const type of Object.values(PIECE_TYPES)) {
    if (redCounts[type] === 0) {
      return {
        winner: PLAYERS.BLUE,
        reason: `Đội Xanh đã tiêu diệt hoàn toàn toàn bộ quân ${PIECE_LABELS[type]} của Đội Đỏ!`,
      };
    }
  }

  return null;
}
