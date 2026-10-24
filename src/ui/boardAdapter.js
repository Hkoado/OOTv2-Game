import { BASES, FILES, getSquareZone } from '../game/constants.js';
import { terrainBlocks } from '../game/terrain.js';

/** Reuse the existing four terrain assets; movement is validated by the engine. */
export function boardOptions({ pieces = {}, map, selectedSquare = null, validMoves = [], lastMove = null, orientation = 'red', readOnly = true, onSquareClick = null, allowTerrainEditing = false, title = 'OTT-v2' } = {}) {
  const blocked = new Set(map?.blocked || []);
  const zones = Object.fromEntries(FILES.flatMap((file) => Array.from({ length: 9 }, (_, i) => {
    const square = `${file}${i + 1}`;
    const zone = getSquareZone(square);
    return [square, zone === 'red-home' ? 'red' : zone === 'blue-home' ? 'blue' : 'neutral'];
  })));
  return {
    pieces: (Array.isArray(pieces) ? pieces : Object.values(pieces)).filter((piece) => piece.alive !== false && piece.square),
    terrains: { ...map?.terrains, ...Object.fromEntries([...blocked].map((square) => [square, 'chasm'])) },
    zones,
    bases: Object.fromEntries(Object.entries(BASES).map(([team, square]) => [square, team])),
    selectedSquare, validMoves, lastMove, orientation, readOnly, title,
    onSquareClick: readOnly || !onSquareClick ? null : (square) => {
      if (allowTerrainEditing || !terrainBlocks(map, square, '*')) onSquareClick(square);
    },
  };
}