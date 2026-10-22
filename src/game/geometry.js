import { squareToCoords, coordsToSquare } from './constants.js';

export const isSquare = (value) => typeof value === 'string' && value.length === 2 && /^[a-i][1-9]$/.test(value);

/** Shared by movement and map graph validation. Pieces do not affect corner cutting. */
export function canStep(from, to, blocked = new Set()) {
  if (!isSquare(from) || !isSquare(to) || blocked.has(from) || blocked.has(to)) return false;
  const a = squareToCoords(from);
  const b = squareToCoords(to);
  const dx = Math.abs(a.col - b.col);
  const dy = Math.abs(a.row - b.row);
  if (Math.max(dx, dy) !== 1) return false;
  return !(dx && dy
    && blocked.has(coordsToSquare(a.col, b.row))
    && blocked.has(coordsToSquare(b.col, a.row)));
}

export function adjacentSquares(square, blocked = new Set()) {
  const { col, row } = squareToCoords(square);
  const result = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const to = coordsToSquare(col + dx, row + dy);
      if (canStep(square, to, blocked)) result.push(to);
    }
  }
  return result;
}
