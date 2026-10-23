import { RED_HOME_SQUARES, BLUE_HOME_SQUARES, coordsToSquare, squareToCoords } from './constants.js';
import { adjacentSquares, isSquare } from './geometry.js';
import { TERRAIN_RULES_VERSION, TERRAIN_BLOCKS, blockedForPiece } from './terrain.js';

export const RULES_VERSION = 'ott-campus.v1';
const fixed = {
  schemaVersion: 'map.v1', width: 9, height: 9,
  setupZoneRule: 'diagonal-28-v1',
  cornerRule: 'block-if-both-orthogonals-blocked', rulesVersion: RULES_VERSION,
};
export const EMPTY_MAP = {
  ...fixed, id: 'open-arena', revision: 1, bases: { red: 'a1', blue: 'i9' }, blocked: [],
};
export const EMPTY_TERRAIN_MAP = {
  ...EMPTY_MAP, schemaVersion: 'map.v2', rulesVersion: TERRAIN_RULES_VERSION, terrains: {},
};

export function sortSquares(squares) {
  return [...squares].sort((a, b) => {
    const x = squareToCoords(a), y = squareToCoords(b);
    return x.row - y.row || x.col - y.col;
  });
}

function reachable(start, graph) {
  const visited = new Set([start]);
  const queue = [start];
  for (let i = 0; i < queue.length; i++) {
    for (const to of graph.get(queue[i]) || []) {
      if (!visited.has(to)) { visited.add(to); queue.push(to); }
    }
  }
  return visited;
}

/** Node-split max flow; every board vertex has capacity 1, supernodes unlimited. */
export function countDisjointPaths(graph, red, blue) {
  const residual = new Map();
  const add = (a, b, capacity) => {
    if (!residual.has(a)) residual.set(a, new Map());
    if (!residual.has(b)) residual.set(b, new Map());
    residual.get(a).set(b, capacity);
    if (!residual.get(b).has(a)) residual.get(b).set(a, 0);
  };
  for (const [square, neighbors] of graph) {
    add(`${square}:in`, `${square}:out`, 1);
    for (const next of neighbors) add(`${square}:out`, `${next}:in`, 2);
  }
  for (const square of red) add('source', `${square}:in`, 2);
  for (const square of blue) add(`${square}:out`, 'sink', 2);
  let flow = 0;
  // Only need to prove the required minimum of two paths.
  while (flow < 2) {
    const parent = new Map([['source', null]]);
    const queue = ['source'];
    for (let i = 0; i < queue.length && !parent.has('sink'); i++) {
      for (const [next, capacity] of residual.get(queue[i]) || []) {
        if (capacity > 0 && !parent.has(next)) { parent.set(next, queue[i]); queue.push(next); }
      }
    }
    if (!parent.has('sink')) break;
    for (let to = 'sink'; parent.get(to) !== null; to = parent.get(to)) {
      const from = parent.get(to);
      residual.get(from).set(to, residual.get(from).get(to) - 1);
      residual.get(to).set(from, residual.get(to).get(from) + 1);
    }
    flow++;
  }
  return flow;
}

/** Strict versioned map validation, including geometry. Never silently repair input. */
export function validateMap(map) {
  const errors = [];
  if (!map || typeof map !== 'object' || Array.isArray(map)) return { ok: false, errors: ['map must be an object'] };
  const terrainMap = map.schemaVersion === 'map.v2';
  const expected = terrainMap ? { ...fixed, schemaVersion: 'map.v2', rulesVersion: TERRAIN_RULES_VERSION } : fixed;
  const fields = [...Object.keys(fixed), 'id', 'revision', 'bases', 'blocked', ...(terrainMap ? ['terrains'] : [])];
  if (Object.keys(map).some((key) => !fields.includes(key))) errors.push('unknown map field');
  for (const [key, value] of Object.entries(expected)) {
    if (map[key] !== value) errors.push(`invalid ${key}`);
  }
  if (typeof map.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(map.id) || /\s/.test(map.id)) errors.push('invalid id');
  if (!Number.isSafeInteger(map.revision) || map.revision < 1) errors.push('invalid revision');
  if (!map.bases || Object.keys(map.bases).sort().join(',') !== 'blue,red'
    || map.bases.red !== 'a1' || map.bases.blue !== 'i9') errors.push('invalid bases');
  if (!Array.isArray(map.blocked) || map.blocked.length > 79 || !Array.from(map.blocked).every(isSquare)) errors.push('invalid blocked squares');
  if (terrainMap) {
    if (!map.terrains || typeof map.terrains !== 'object' || Array.isArray(map.terrains)
      || Object.entries(map.terrains).some(([square, type]) => !isSquare(square) || !Object.hasOwn(TERRAIN_BLOCKS, type))) {
      errors.push('invalid terrains');
    }
    if (map.blocked?.length) errors.push('map.v2 uses terrains, not blocked');
  }
  if (errors.length) return { ok: false, errors };

  if (terrainMap) {
    for (const [square, type] of Object.entries(map.terrains)) {
      const { col, row } = squareToCoords(square);
      if (square === 'a1' || square === 'i9') errors.push('terrain on base');
      if (map.terrains[coordsToSquare(10 - col, 10 - row)] !== type) errors.push('terrains must be 180-degree symmetric');
    }
    if (errors.length) return { ok: false, errors };
    // Each type needs playable setup cells and connected routes under ITS blockers.
    const reports = {};
    for (const type of ['rock', 'paper', 'scissors']) {
      const blocked = [...blockedForPiece(map, type)];
      const checked = validateMap({ ...EMPTY_MAP, id: map.id, revision: map.revision, blocked });
      reports[type] = checked.report;
      errors.push(...checked.errors.map((error) => `${type}: ${error}`));
    }
    return { ok: errors.length === 0, errors, report: { byPieceType: reports } };
  }

  const blocked = new Set(map.blocked);
  if (blocked.size !== map.blocked.length) errors.push('duplicate blocked squares');
  if (blocked.has('a1') || blocked.has('i9')) errors.push('blocked base');
  for (const square of blocked) {
    const { col, row } = squareToCoords(square);
    if (!blocked.has(coordsToSquare(10 - col, 10 - row))) { errors.push('blocked squares must be 180-degree symmetric'); break; }
  }
  const red = RED_HOME_SQUARES.filter((s) => !blocked.has(s));
  const blue = BLUE_HOME_SQUARES.filter((s) => !blocked.has(s));
  if (red.length < 9 || blue.length < 9) errors.push('at least nine setup squares required per side');
  if (errors.length) return { ok: false, errors };
  const graph = new Map();
  for (let row = 1; row <= 9; row++) {
    for (let col = 1; col <= 9; col++) {
      const square = coordsToSquare(col, row);
      if (!blocked.has(square)) graph.set(square, adjacentSquares(square, blocked));
    }
  }
  const fromRed = reachable('a1', graph), fromBlue = reachable('i9', graph);
  if (red.some((s) => !fromBlue.has(s)) || blue.some((s) => !fromRed.has(s))) errors.push('setup square disconnected from opposing base');
  const disjointPaths = countDisjointPaths(graph, red, blue);
  if (disjointPaths < 2) errors.push('fewer than two vertex-disjoint paths');
  return { ok: errors.length === 0, errors, report: { redSetupSquares: red.length, blueSetupSquares: blue.length, disjointPaths } };
}

export function normalizeMap(map) {
  const validation = validateMap(map);
  if (!validation.ok) throw new Error(`Invalid map: ${validation.errors.join('; ')}`);
  return { ...map, bases: { ...map.bases }, blocked: sortSquares(map.blocked),
    ...(map.schemaVersion === 'map.v2' ? { terrains: Object.fromEntries(sortSquares(Object.keys(map.terrains)).map((s) => [s, map.terrains[s]])) } : {}) };
}
