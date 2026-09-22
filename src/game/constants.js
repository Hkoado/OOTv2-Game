export const BOARD_SIZE = 9;
export const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];
export const RANKS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

export const PLAYERS = {
  RED: 'red',
  BLUE: 'blue',
};

export const PLAYER_NAMES = {
  [PLAYERS.RED]: 'Đội Đỏ',
  [PLAYERS.BLUE]: 'Đội Xanh',
};

export const PIECE_TYPES = {
  ROCK: 'rock',       // Đấm / Búa
  PAPER: 'paper',     // Lá / Bao
  SCISSORS: 'scissors', // Kéo
};

export const PIECE_LABELS = {
  [PIECE_TYPES.ROCK]: 'Đấm',
  [PIECE_TYPES.PAPER]: 'Lá',
  [PIECE_TYPES.SCISSORS]: 'Kéo',
};

export const PIECE_ICONS = {
  [PIECE_TYPES.ROCK]: '✊',
  [PIECE_TYPES.PAPER]: '✋',
  [PIECE_TYPES.SCISSORS]: '✌️',
};

// Quy tắc Oẳn Tù Tì: Búa ăn Kéo, Kéo ăn Bao, Bao ăn Búa
export const BEATS = {
  [PIECE_TYPES.ROCK]: PIECE_TYPES.SCISSORS,
  [PIECE_TYPES.SCISSORS]: PIECE_TYPES.PAPER,
  [PIECE_TYPES.PAPER]: PIECE_TYPES.ROCK,
};

// Nhà chính của 2 đội
export const BASES = {
  [PLAYERS.RED]: 'a1',
  [PLAYERS.BLUE]: 'i9',
};

// Mỗi đội có 9 quân: 3 Đấm, 3 Lá, 3 Kéo
export const INITIAL_PIECE_SET = [
  PIECE_TYPES.ROCK, PIECE_TYPES.ROCK, PIECE_TYPES.ROCK,
  PIECE_TYPES.PAPER, PIECE_TYPES.PAPER, PIECE_TYPES.PAPER,
  PIECE_TYPES.SCISSORS, PIECE_TYPES.SCISSORS, PIECE_TYPES.SCISSORS,
];

export const SETUP_TIME_SECONDS = 30;

// Chuyển đổi tên ô (ví dụ 'a1') sang tọa độ số (col: 1..9, row: 1..9)
export function squareToCoords(square) {
  const file = square[0];
  const rank = parseInt(square.slice(1), 10);
  const col = FILES.indexOf(file) + 1;
  const row = rank;
  return { col, row };
}

// Chuyển đổi tọa độ số sang tên ô (ví dụ col 1, row 1 -> 'a1')
export function coordsToSquare(col, row) {
  if (col < 1 || col > 9 || row < 1 || row > 9) return null;
  return `${FILES[col - 1]}${row}`;
}

// Kiểm tra ô thuộc khu vực nào:
// Tổng col + row:
// <= 8: Sân nhà Đỏ (28 ô)
// in [9, 10, 11]: Ranh giới 3 đường chéo giữa sân (25 ô)
// >= 12: Sân nhà Xanh (28 ô)
export function getSquareZone(square) {
  const { col, row } = squareToCoords(square);
  const sum = col + row;
  if (sum <= 8) return 'red-home';
  if (sum >= 9 && sum <= 11) return 'border';
  return 'blue-home';
}

// Danh sách 28 ô sân nhà của Đỏ
export const RED_HOME_SQUARES = [];
// Danh sách 28 ô sân nhà của Xanh
export const BLUE_HOME_SQUARES = [];
// Danh sách 25 ô ranh giới
export const BORDER_SQUARES = [];

for (let r = 1; r <= 9; r++) {
  for (let c = 1; c <= 9; c++) {
    const sq = coordsToSquare(c, r);
    const sum = c + r;
    if (sum <= 8) RED_HOME_SQUARES.push(sq);
    else if (sum >= 12) BLUE_HOME_SQUARES.push(sq);
    else BORDER_SQUARES.push(sq);
  }
}
