import { createHash, randomUUID } from 'node:crypto';
import '../../server/config.js';
import { insert, remove, rows } from '../../server/shared/client.js';
import { openGroupRound, getGroupRound } from '../../server/services/officialRounds.js';
import { EMPTY_TERRAIN_MAP } from '../../src/game/maps.js';

const runId = randomUUID().slice(0, 8);
const sha = (text) => createHash('sha256').update(`k2-open-${runId}-${text}`).digest('hex');
const state = { eventId: null, teamIds: [], submissionIds: [], roundId: null };
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

async function cleanup() {
  if (state.roundId) {
    await remove('official_games', `round_pk=eq.${state.roundId}`).catch(() => {});
    await remove('official_rounds', `id=eq.${state.roundId}`).catch(() => {});
  }
  if (state.eventId) {
    await remove('official_rounds', `event_id=eq.${state.eventId}`).catch(() => {});
    await remove('submissions', `id=in.(${state.submissionIds.join(',')})`).catch(() => {});
    await remove('tournament_entries', `tournament_id=eq.${state.eventId}`).catch(() => {});
    await remove('official_setups', `tournament_id=eq.${state.eventId}`).catch(() => {});
    await remove('tournaments', `id=eq.${state.eventId}`).catch(() => {});
  }
  for (const id of state.teamIds) await remove('participants', `id=eq.${id}`).catch(() => {});
}

try {
  // This legacy fixture lacks official receipts/captures. Stop before inserting
  // any fixture rows on a database using the new capture contract.
  let capturesAvailable = false;
  try { await rows('cutoff_captures', 'limit=1&select=event_id'); capturesAvailable = true; }
  catch (error) { if (error.code !== 'shared_db_error') throw error; }
  if (capturesAvailable) throw Object.assign(new Error('legacy_drill_requires_capture_upgrade'),
    { code: 'legacy_drill_requires_capture_upgrade' });
  const now = new Date().toISOString();
  const cutoff = new Date(Date.now() - 3600_000).toISOString();
  state.teamIds = Array.from({ length: 4 }, () => randomUUID());
  for (const [index, id] of state.teamIds.entries()) {
    await insert('participants', [{ id, name: `K2 open ${runId} ${index}`, name_key: `k2 open ${runId} ${index}`, created_at: now }]);
  }
  state.eventId = randomUUID();
  await insert('tournaments', [{ id: state.eventId, name: `K2 open ${runId}`, status: 'draft', seed: 4321,
    created_at: now, map_json: JSON.stringify(EMPTY_TERRAIN_MAP) }]);
  for (const [index, participantId] of state.teamIds.entries()) {
    await insert('tournament_entries', [{ id: randomUUID(), tournament_id: state.eventId,
      participant_id: participantId, seed_order: index + 1, group_name: 'A', submission_id: null }]);
  }
  await insert('official_setups', [{ tournament_id: state.eventId, config: {
    schemaVersion: 'campus-setup.v1', level: 'weekly', cutoff, mapPackVersion: `k2-open-${runId}`,
    weeksPerMonth: 4, monthsPerSemester: 4, mapsPublished: true,
    primaryMap: EMPTY_TERRAIN_MAP, reserveMap: EMPTY_TERRAIN_MAP,
  } }]);
  state.submissionIds = state.teamIds.map(() => randomUUID());
  for (const [index, participantId] of state.teamIds.entries()) {
    await insert('submissions', [{ id: state.submissionIds[index], participant_id: participantId,
      storage_path: `${state.submissionIds[index]}.py`, sha256: sha(`bot-${index}`), status: 'valid',
      validation_error: null, created_at: new Date(Date.now() - 7200_000).toISOString() }]);
  }

  const opened = await openGroupRound({ eventId: state.eventId });
  state.roundId = opened.round.roundId;
  check('mở vòng bảng từ setup + submission thật', opened.alreadyOpen === false && state.roundId);
  check('snapshot đủ 4 bot', opened.round.snapshot.teamCount === 4);
  check('lịch 4 đội = 12 ván', opened.round.games.total === 12, `total=${opened.round.games.total}`);
  check('ván đầu có hai màu + tên đội', Boolean(opened.round.next?.red?.name && opened.round.next?.blue?.name),
    `${opened.round.next?.red?.name} vs ${opened.round.next?.blue?.name}`);

  const again = await openGroupRound({ eventId: state.eventId });
  check('mở lặp idempotent', again.alreadyOpen === true && again.round.roundId === state.roundId);
  const loaded = await getGroupRound({ eventId: state.eventId });
  check('GET round trả cùng snapshot', loaded.snapshot.contentHash === opened.round.snapshot.contentHash);
} catch (error) {
  check('open round hoàn tất không lỗi', false, error.code || error.message);
} finally {
  await cleanup();
}

const failed = results.filter((item) => !item.ok);
console.log(`RESULT pass=${results.length - failed.length} fail=${failed.length} round=${state.roundId ?? 'none'}`);
process.exit(failed.length === 0 ? 0 : 1);
