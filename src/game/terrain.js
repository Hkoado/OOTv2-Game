/** Campus v2 terrain rules. Art keys are the existing UI kit keys. */
export const TERRAIN_RULES_VERSION = 'ott-campus.v2';
export const TERRAIN_LABELS = Object.freeze({ fire: 'Lửa', water: 'Nước', bush: 'Bụi cây', chasm: 'Vực' });
export const TERRAIN_BLOCKS = Object.freeze({ fire: 'paper', water: 'scissors', bush: 'rock', chasm: '*' });

export function terrainBlocks(map, square, pieceType) {
  if (map?.blocked?.includes(square)) return true;
  if (map?.rulesVersion !== TERRAIN_RULES_VERSION) return false;
  const blockedType = TERRAIN_BLOCKS[map.terrains?.[square]];
  return blockedType === '*' || blockedType === pieceType;
}

export function blockedForPiece(map, pieceType) {
  return new Set([
    ...(map?.blocked || []),
    ...Object.keys(map?.terrains || {}).filter((square) => terrainBlocks(map, square, pieceType)),
  ]);
}

/** Explicit upgrade; never mutates old maps, hashes or stored replays. */
export function upgradeTerrainMap(map) {
  if (map.schemaVersion === 'map.v2') return structuredClone(map);
  return { ...structuredClone(map), schemaVersion: 'map.v2', rulesVersion: TERRAIN_RULES_VERSION,
    blocked: [], terrains: Object.fromEntries(map.blocked.map((square) => [square, 'chasm'])) };
}