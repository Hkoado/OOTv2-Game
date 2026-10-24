/**
 * k2-schedule-drill.js — K2 persistence drill trên Supabase THẬT.
 *
 * Tạo event/2 đội tạm, mở vòng bằng snapshot hợp lệ, rồi kiểm:
 * open idempotent, 2 writer tranh append (một thắng/một stale_prefix), chain load,
 * result một lần + conflict, freeze khi thiếu ván, freeze đủ, next pinned color.
 * Dọn sạch dữ liệu drill trong `finally`; không đụng event/đội thật.
 *
 * Chạy: npm run db:k2     (cần .env có SUPABASE_URL + SERVICE_ROLE_KEY)
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { EMPTY_TERRAIN_MAP } from '../../src/game/maps.js';
import { createOfficialRoundSnapshot } from '../../server/contracts/officialSnapshot.js';
import { createOfficialGroupSchedule } from '../../server/lib/officialGroups.js';
import { createOfficialRuntimeIdentity } from '../../server/judge/officialRuntime.js';
import { genesisHash, openOfficialRound, appendOfficialGame, recordOfficialResult,
  freezeOfficialRound, loadOfficialRound, nextPinnedGroupGame } from '../../server/shared/officialSchedule.js';

const runId = randomBytes(4).toString('hex');
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Thiếu SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY trong .env');
  process.exit(2);
}
const headers = { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' };
const sha256 = (text) => createHash('sha256').update(`k2-${runId}-${text}`).digest('hex');
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}
async function rest(path, options = {}) {
  const response = await fetch(`${url}${path}`, { headers, ...options });
  const text = await response.text();
  if (!response.ok) throw new Error(`${path} HTTP ${response.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}
const insert = (table, rows) => rest(`/rest/v1/${table}`, {
  method: 'POST', headers: { ...headers, Prefer: 'return=representation' }, body: JSON.stringify(rows),
});
const remove = (table, query) => rest(`/rest/v1/${table}?${query}`, { method: 'DELETE' });

const state = { eventId: null, teamIds: [], roundId: null };
async function cleanup() {
  try {
    if (state.eventId) {
      if (state.roundId) await remove('mvp_official_games', `round_pk=eq.${state.roundId}`).catch(() => {});
      await remove('mvp_official_rounds', `event_id=eq.${state.eventId}`).catch(() => {});
      await remove('mvp_tournament_entries', `tournament_id=eq.${state.eventId}`).catch(() => {});
      await remove('mvp_tournaments', `id=eq.${state.eventId}`).catch(() => {});
    }
    for (const id of state.teamIds) await remove('mvp_participants', `id=eq.${id}`).catch(() => {});
  } catch (error) {
    console.error('cleanup:', error.message);
  }
}

try {
  const eventId = randomUUID(); state.eventId = eventId;
  const teams = Array.from({ length: 4 }, () => randomUUID()); state.teamIds = teams;
  const now = new Date().toISOString();
  for (const [index, id] of teams.entries()) {
    await insert('mvp_participants', [{ id, name: `K2 drill ${runId} ${index}`, name_key: `k2 drill ${runId} ${index}`, created_at: now }]);
  }
  await insert('mvp_tournaments', [{ id: eventId, name: `K2 drill ${runId}`, status: 'draft', seed: 1234, created_at: now }]);
  for (const [index, participantId] of teams.entries()) {
    await insert('mvp_tournament_entries', [{ id: randomUUID(), tournament_id: eventId,
      participant_id: participantId, seed_order: index + 1, group_name: 'A', submission_id: null }]);
  }
  const snapshot = createOfficialRoundSnapshot({ eventId, roundId: 'group', seed: 4321,
    cutoff: new Date(Date.now() + 24 * 3600_000).toISOString(), mapPackVersion: `k2-${runId}`,
    primaryMap: EMPTY_TERRAIN_MAP, reserveMap: EMPTY_TERRAIN_MAP,
    runtime: createOfficialRuntimeIdentity(),
    bots: teams.map((participantId, index) => ({ participantId, submissionId: `sub-${runId}-${index}`,
      artifactKey: `${participantId}.py`, sourceSha256: sha256(`bot-${index}`), sourceKind: 'offline_file' })) });
  const genesis = genesisHash({ eventId, roundId: 'group', snapshotHash: snapshot.contentHash });
  const opened = await openOfficialRound({ snapshot });
  state.roundId = opened.roundId;
  check('open round trên DB thật', opened.genesisHash === genesis, opened.roundId);
  await openOfficialRound({ snapshot }).then(() => check('open lặp bị từ chối', false))
    .catch((error) => check('open lặp bị từ chối', error.code === 'round_exists', error.code));

  let round = await loadOfficialRound({ roundId: opened.roundId });
  check('load khớp snapshot + genesis', round.chainHash === genesis && round.games.length === 0);
  const first = nextPinnedGroupGame({ snapshot: round.snapshot, games: [] });
  check('ván đầu có màu pinned', Boolean(first?.redParticipantId && first.blueParticipantId)
    && first.colorPolicy === 'alternate-loss-priority.v1');


  // Hai writer cùng prefix: DB chỉ cho một append qua FOR UPDATE + chain head.
  const raced = await Promise.allSettled([
    appendOfficialGame({ roundId: opened.roundId, expectedPrefix: genesis, game: first }),
    appendOfficialGame({ roundId: opened.roundId, expectedPrefix: genesis, game: first }),
  ]);
  const won = raced.filter((item) => item.status === 'fulfilled');
  const lost = raced.filter((item) => item.status === 'rejected');
  check('2 writer: đúng một append thắng', won.length === 1 && lost.length === 1,
    won.length === 1 ? `seq=${won[0].value.seq}` : 'none');
  check('writer thua trả stale_prefix', lost[0]?.reason?.code === 'stale_prefix', lost[0]?.reason?.code ?? 'n/a');

  round = await loadOfficialRound({ roundId: opened.roundId });
  const g1 = round.games[0];
  check('chain sau append khớp seq 1', g1?.seq === 1 && round.chainHash === g1.chainHash);
  await recordOfficialResult({ roundId: opened.roundId, gameKey: g1.gameKey, result: 'red_win',
    replayHash: sha256('replay-1') });
  await recordOfficialResult({ roundId: opened.roundId, gameKey: g1.gameKey, result: 'red_win',
    replayHash: sha256('replay-1') }).then((out) => check('record lặp idempotent', out.alreadyRecorded === true));
  await recordOfficialResult({ roundId: opened.roundId, gameKey: g1.gameKey, result: 'draw',
    replayHash: sha256('replay-1') }).then(() => check('record kết quả khác bị chặn', false))
    .catch((error) => check('record kết quả khác bị chặn', error.code === 'result_conflict', error.code));

  const expectedGames = createOfficialGroupSchedule({ participantIds: teams, seed: 4321,
    mapHash: snapshot.maps.primary.hash, mapPackVersion: snapshot.mapPackVersion }).games.length;
  await freezeOfficialRound({ roundId: opened.roundId, expectedGames })
    .then(() => check('freeze thiếu ván bị chặn', false))
    .catch((error) => check('freeze thiếu ván bị chặn', error.code === 'incomplete_schedule', error.code));

  round = await loadOfficialRound({ roundId: opened.roundId });
  let next = nextPinnedGroupGame({ snapshot: round.snapshot, games: round.games });
  check('ván 2 tái tạo đúng lịch + màu', next?.seq === 2 && next.gameKey !== g1.gameKey);
  let appended = 0;
  while (next) {
    await appendOfficialGame({ roundId: opened.roundId, expectedPrefix: round.chainHash, game: next });
    const result = ['red_win', 'blue_win', 'draw'][next.seq % 3];
    await recordOfficialResult({ roundId: opened.roundId, gameKey: next.gameKey, result,
      replayHash: sha256(`replay-${next.seq}`) });
    round = await loadOfficialRound({ roundId: opened.roundId });
    next = nextPinnedGroupGame({ snapshot: round.snapshot, games: round.games });
    if (++appended > expectedGames) throw new Error('schedule_overrun');
  }
  check('load xác minh toàn bộ chain', round.games.length === expectedGames
    && round.games.every((game) => game.result !== null) && round.chainHash !== genesis,
    `games=${round.games.length}`);
  const frozen = await freezeOfficialRound({ roundId: opened.roundId, expectedGames });
  round = await loadOfficialRound({ roundId: opened.roundId });
  check('freeze đủ ván + frozen=true', frozen.alreadyFrozen === false && round.frozen === true);
  await freezeOfficialRound({ roundId: opened.roundId, expectedGames })
    .then((out) => check('freeze lặp idempotent', out.alreadyFrozen === true))
    .catch((error) => check('freeze lặp idempotent', false, error.code));
} catch (error) {
  check('drill hoàn tất không lỗi', false, error.code || error.message);
} finally {
  await cleanup();
}

const failed = results.filter((item) => !item.ok);
console.log(`RESULT pass=${results.length - failed.length} fail=${failed.length} round=${state.roundId ?? 'none'}`);
process.exit(failed.length === 0 ? 0 : 1);
