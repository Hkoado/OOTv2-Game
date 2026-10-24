import { contentHash, mapHash } from './canonical.js';
import { normalizeMap, RULES_VERSION } from '../../src/game/maps.js';
import { TERRAIN_RULES_VERSION } from '../../src/game/terrain.js';

export const OFFICIAL_SNAPSHOT_VERSION = 'campus-round-snapshot.v1';
const hash = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const label = (value) => typeof value === 'string' && value.trim().length > 0 && value.length <= 160;
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

/** No lookup of latest submission: caller must supply each round's pinned provenance. */
export function createOfficialRoundSnapshot({ eventId, roundId, seed, cutoff, mapPackVersion, primaryMap, reserveMap, runtime, bots }) {
  if (![eventId, roundId, mapPackVersion].every(label) || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff
    || typeof cutoff !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(cutoff)
    || !Number.isFinite(Date.parse(cutoff))) throw new Error('Invalid snapshot identity/cutoff');
  if (!runtime || ![RULES_VERSION, TERRAIN_RULES_VERSION].includes(runtime.rulesVersion) || runtime.protocolVersion !== 'bot.v1'
    || !label(runtime.runtimeVersion) || !hash(runtime.runtimeHash) || !hash(runtime.budgetHash)) throw new Error('Unpinned runtime');
  if (!Array.isArray(bots) || bots.length < 1 || bots.length > 56
    || new Set(bots.map((bot) => bot.participantId)).size !== bots.length) throw new Error('Invalid snapshot bots');
  const pinnedBots = bots.map((bot) => {
    if (![bot.participantId, bot.submissionId, bot.artifactKey].every(label)
      || !/^[a-zA-Z0-9][a-zA-Z0-9/_-]*\.py$/.test(bot.artifactKey)
      || !hash(bot.sourceSha256)
      || !['github', 'offline_file', 'upload_fallback'].includes(bot.sourceKind)) throw new Error('Unpinned bot');
    if (bot.sourceKind === 'github' && (!/^[a-f0-9]{40}$/.test(bot.commitSha)
      || !/^[1-9]\d*$/.test(bot.repositoryId) || typeof bot.resolvedAt !== 'string'
      || !/(?:Z|[+-]\d{2}:\d{2})$/.test(bot.resolvedAt) || !Number.isFinite(Date.parse(bot.resolvedAt))
      || (bot.capturePolicy !== 'cutoff-first-resolution.v1'
        && Date.parse(bot.resolvedAt) > Date.parse(cutoff)))) throw new Error('Invalid GitHub receipt/cutoff');
    if (bot.capturePolicy !== undefined && (bot.sourceKind !== 'github'
      || bot.capturePolicy !== 'cutoff-first-resolution.v1'
      || !label(bot.receiptId)
      || Date.parse(bot.resolvedAt) < Date.parse(cutoff))) throw new Error('Invalid capture provenance');
    return { participantId: bot.participantId, submissionId: bot.submissionId, sourceKind: bot.sourceKind,
      sourceSha256: bot.sourceSha256, artifactKey: bot.artifactKey,
      ...(bot.sourceKind === 'github' ? { commitSha: bot.commitSha, repositoryId: bot.repositoryId,
        resolvedAt: new Date(bot.resolvedAt).toISOString(),
        ...(bot.capturePolicy ? { capturePolicy: bot.capturePolicy, receiptId: bot.receiptId } : {}) } : {}) };
  }).sort((a, b) => a.participantId < b.participantId ? -1 : a.participantId > b.participantId ? 1 : 0);
  const primary = normalizeMap(primaryMap), reserve = normalizeMap(reserveMap);
  if ([primary, reserve].some((map) => map.rulesVersion !== runtime.rulesVersion)) throw new Error('Map/runtime rules mismatch');
  const snapshot = {
    schemaVersion: OFFICIAL_SNAPSHOT_VERSION, eventId, roundId, seed, cutoff: new Date(cutoff).toISOString(),
    mapPackVersion, maps: { primary: { map: primary, hash: mapHash(primary) }, reserve: { map: reserve, hash: mapHash(reserve) } },
    runtime: { rulesVersion: runtime.rulesVersion, protocolVersion: runtime.protocolVersion,
      runtimeVersion: runtime.runtimeVersion, runtimeHash: runtime.runtimeHash, budgetHash: runtime.budgetHash }, bots: pinnedBots,
  };
  return freeze({ ...snapshot, contentHash: contentHash(snapshot) });
}

export function verifyOfficialRoundSnapshot(snapshot) {
  try {
    if (snapshot.schemaVersion !== OFFICIAL_SNAPSHOT_VERSION) return false;
    const rebuilt = createOfficialRoundSnapshot({ ...snapshot,
      primaryMap: snapshot.maps.primary.map, reserveMap: snapshot.maps.reserve.map });
    const { contentHash: expected, ...body } = snapshot;
    return expected === contentHash(body) && contentHash(rebuilt) === contentHash(snapshot);
  } catch { return false; }
}