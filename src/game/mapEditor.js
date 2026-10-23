import { squareToCoords, coordsToSquare } from './constants.js';
import { upgradeTerrainMap, TERRAIN_BLOCKS } from './terrain.js';

export function paintTerrain(map, square, terrain, mirror = true) {
  if (!/^[a-i][1-9]$/.test(square) || (terrain !== '' && !Object.hasOwn(TERRAIN_BLOCKS, terrain))) throw new Error('Invalid terrain brush');
  const next = upgradeTerrainMap(map);
  const { col, row } = squareToCoords(square);
  const squares = mirror ? [square, coordsToSquare(10 - col, 10 - row)] : [square];
  if (squares.some((s) => s === 'a1' || s === 'i9')) return next;
  for (const s of squares) {
    if (terrain) next.terrains[s] = terrain;
    else delete next.terrains[s];
  }
  return next;
}