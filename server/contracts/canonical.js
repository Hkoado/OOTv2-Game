import { createHash } from 'node:crypto';
import { normalizeMap } from '../../src/game/maps.js';

/** Canonical JSON for contracts: UTF-8, sorted object keys, finite JSON values only. */
export function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${Array.from(value, canonicalJson).join(',')}]`;
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  throw new Error('Canonical JSON requires finite JSON values');
}

export const contentHash = (value) => createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');

/** Labels/revisions identify a map record; geometry/rules identify its playable content. */
export function mapHash(map) {
  const { id, revision, ...content } = normalizeMap(map);
  return contentHash(content);
}
