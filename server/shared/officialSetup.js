import { randomUUID } from 'node:crypto';
import { rows, rpc, uuid } from './client.js';
import { HttpError } from '../lib/httpError.js';
import { randomSeed } from '../judge/rng.js';
import { normalizeCompetition, competitionPreview, OFFICIAL_PROFILE, MAX_OFFICIAL_TEAMS } from '../../src/game/competition.js';
import { canonicalJson, mapHash } from '../contracts/canonical.js';

export async function setupFor(id) {
  const [setup] = await rows('official_setups', `tournament_id=eq.${uuid(id)}`);
  return setup?.config ?? null;
}

export async function saveOfficialSetup({ id, name, participantIds = [], competition = {}, expected = null }) {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 80) throw new HttpError(400, 'bad_name', 'Tên giải từ 1 đến 80 ký tự.');
  if (!Array.isArray(participantIds) || participantIds.length > MAX_OFFICIAL_TEAMS || new Set(participantIds).size !== participantIds.length) {
    throw new HttpError(400, 'bad_participants', 'Chọn tối đa 56 đội không trùng.');
  }
  participantIds.forEach(uuid);
  let config;
  try { config = normalizeCompetition(competition); } catch (error) { throw new HttpError(400, 'bad_competition', error.message); }
  if (id) {
    const previous = await setupFor(id);
    if (previous?.mapsPublished && (!config.mapsPublished || previous.mapPackVersion !== config.mapPackVersion
      || canonicalJson(previous.primaryMap) !== canonicalJson(config.primaryMap)
      || canonicalJson(previous.reserveMap) !== canonicalJson(config.reserveMap))) {
      throw new HttpError(409, 'map_pack_locked', 'Map đã công bố không được sửa hoặc thu hồi. Tạo giải/pack mới.');
    }
  }
  if (config.mapsPublished && (!config.mapPackVersion || config.primaryMap.rulesVersion !== config.reserveMap.rulesVersion)) {
    throw new HttpError(400, 'bad_map_publication', 'Cần version pack và hai map cùng phiên bản luật.');
  }
  const eventId = id ? uuid(id) : randomUUID();
  await rpc('mvp_official_draft_save', {
    p_event: { id: eventId, name: name.trim(), seed: randomSeed(), created_at: new Date().toISOString(), map_json: JSON.stringify(config.primaryMap) },
    p_entries: participantIds.map((participant_id, i) => ({ id: randomUUID(), participant_id, seed_order: i + 1 })),
    p_config: config, p_expected: expected,
  });
  return eventId;
}

export function officialView(event, config) {
  return { profile: OFFICIAL_PROFILE, competition: config,
    map_publication: config.mapsPublished ? { mapPackVersion: config.mapPackVersion,
      primaryHash: mapHash(config.primaryMap), reserveHash: mapHash(config.reserveMap) } : null,
    setup_preview: competitionPreview(event.entries.map((entry) => entry.participant_id), Number(event.seed), config) };
}