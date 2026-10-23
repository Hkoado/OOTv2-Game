/** K2 schedule persistence client. Postgres RPC owns ordering/freeze/result fencing;
 * this module owns canonical payloads and verifies snapshot + chain on read.
 * No API route, queue runner, bot execution or publication gate change.
 */
import { createHash } from 'node:crypto';
import { rpc, request } from './client.js';
import { HttpError } from '../lib/httpError.js';
import { canonicalJson, contentHash } from '../contracts/canonical.js';
import { verifyOfficialRoundSnapshot } from '../contracts/officialSnapshot.js';
import { createOfficialGroupSchedule } from '../lib/officialGroups.js';
import { assignNextOfficialGameColor, COLOR_POLICY } from '../lib/officialColors.js';

export const OFFICIAL_SCHEDULE_VERSION = 'official-schedule.v1';
export const OFFICIAL_GAME_KEYS = Object.freeze(['seq', 'gameKey', 'stage', 'groupName', 'gameNo',
  'redParticipantId', 'blueParticipantId', 'seed', 'mapSlot', 'mapHash', 'mapPackVersion', 'colorPolicy']);
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const GAME_KEY = /^[A-Za-z0-9:_-]{1,120}$/;
const STAGE = /^[A-Za-z0-9:_-]{1,40}$/;
const fail = (status, code, message) => new HttpError(status, code, message);
const isText = (value) => typeof value === 'string' && value.length > 0;

function assertId(value, name) {
  if (!UUID.test(value ?? '')) throw fail(400, 'bad_id', `${name} không hợp lệ.`);
  return value;
}
function assertHash(value, name) {
  if (!HASH.test(value ?? '')) throw fail(400, 'bad_hash', `${name} phải là sha256 hex.`);
  return value;
}

export function genesisHash({ eventId, roundId, snapshotHash }) {
  if (!isText(eventId) || !STAGE.test(roundId ?? '') || !HASH.test(snapshotHash ?? '')) {
    throw fail(400, 'bad_genesis', 'Genesis cần event/round/snapshotHash hợp lệ.');
  }
  return contentHash({ schemaVersion: OFFICIAL_SCHEDULE_VERSION, eventId, roundId, snapshotHash });
}

export function gameChainHash(prefix, game) {
  assertHash(prefix, 'prefix');
  return createHash('sha256').update(`${prefix}\n${canonicalJson(game)}`, 'utf8').digest('hex');
}

/** Exact key set keeps the persisted payload and the hash unambiguous. */
export function normalizeOfficialGame(game) {
  if (!game || typeof game !== 'object' || Array.isArray(game)) throw fail(400, 'bad_game', 'Game phải là object.');
  const unknown = Object.keys(game).filter((key) => !OFFICIAL_GAME_KEYS.includes(key));
  if (unknown.length) throw fail(400, 'bad_game', `Game có trường lạ: ${unknown.join(',')}.`);
  if (!Number.isInteger(game.seq) || game.seq < 1 || game.seq > 100000) throw fail(400, 'bad_game', 'seq không hợp lệ.');
  if (!GAME_KEY.test(game.gameKey ?? '')) throw fail(400, 'bad_game', 'gameKey không hợp lệ.');
  if (!STAGE.test(game.stage ?? '')) throw fail(400, 'bad_game', 'stage không hợp lệ.');
  if (game.groupName !== undefined && !/^[A-Za-z0-9_-]{1,40}$/.test(game.groupName)) {
    throw fail(400, 'bad_game', 'groupName không hợp lệ.');
  }
  if (game.gameNo !== undefined && ![1, 2].includes(game.gameNo)) throw fail(400, 'bad_game', 'gameNo phải 1 hoặc 2.');
  assertId(game.redParticipantId, 'redParticipantId');
  assertId(game.blueParticipantId, 'blueParticipantId');
  if (game.redParticipantId === game.blueParticipantId) throw fail(400, 'bad_game', 'Hai màu phải khác đội.');
  if (!Number.isInteger(game.seed) || game.seed < 0 || game.seed > 0xffffffff) throw fail(400, 'bad_game', 'seed phải uint32.');
  if (!['primary', 'reserve'].includes(game.mapSlot)) throw fail(400, 'bad_game', 'mapSlot không hợp lệ.');
  assertHash(game.mapHash, 'mapHash');
  if (!isText(game.mapPackVersion) || game.mapPackVersion.length > 80) throw fail(400, 'bad_game', 'mapPackVersion không hợp lệ.');
  if (game.colorPolicy !== COLOR_POLICY) throw fail(400, 'bad_game', `colorPolicy phải ${COLOR_POLICY}.`);
  return Object.freeze({ seq: game.seq, gameKey: game.gameKey, stage: game.stage,
    ...(game.groupName !== undefined ? { groupName: game.groupName } : {}),
    ...(game.gameNo !== undefined ? { gameNo: game.gameNo } : {}),
    redParticipantId: game.redParticipantId, blueParticipantId: game.blueParticipantId,
    seed: game.seed, mapSlot: game.mapSlot, mapHash: game.mapHash,
    mapPackVersion: game.mapPackVersion, colorPolicy: game.colorPolicy });
}

const RPC_STATUS = Object.freeze({ round_not_found: 404, game_not_found: 404, round_exists: 409,
  stale_prefix: 409, round_frozen: 409, duplicate_game: 409, map_mismatch: 409, result_conflict: 409,
  incomplete_schedule: 409, pending_results: 409, invalid_snapshot: 409,
  snapshot_identity_mismatch: 409, event_closed: 409 });
function rejected(result, fallback) {
  if (!result || typeof result !== 'object') throw fail(503, 'bad_rpc_response', 'DB không trả kết quả hợp lệ.');
  if (result.ok === false) {
    const code = typeof result.error === 'string' ? result.error : fallback;
    throw fail(RPC_STATUS[code] ?? 400, code, `DB từ chối thao tác: ${code}.`);
  }
  return result;
}

export async function openOfficialRound({ snapshot } = {}) {
  if (!verifyOfficialRoundSnapshot(snapshot)) throw fail(409, 'invalid_snapshot', 'Snapshot không hợp lệ hoặc đã bị sửa.');
  assertId(snapshot.eventId, 'eventId');
  if (!STAGE.test(snapshot.roundId ?? '')) throw fail(400, 'bad_round', 'roundId không hợp lệ.');
  const genesis = genesisHash({ eventId: snapshot.eventId, roundId: snapshot.roundId, snapshotHash: snapshot.contentHash });
  const result = rejected(await rpc('mvp_official_open_round', {
    p_event: snapshot.eventId, p_round: snapshot.roundId, p_snapshot: snapshot, p_genesis: genesis,
  }), 'open_rejected');
  if (!UUID.test(result.round_id ?? '')) throw fail(503, 'bad_rpc_response', 'round_id trả về không hợp lệ.');
  return { roundId: result.round_id, genesisHash: result.genesis_hash ?? genesis };
}

/** Append exactly the next pinned game. `expectedPrefix` fences concurrent/duplicate writers. */
export async function appendOfficialGame({ roundId, expectedPrefix, game } = {}) {
  assertId(roundId, 'roundId');
  assertHash(expectedPrefix, 'expectedPrefix');
  const payload = normalizeOfficialGame(game);
  const chainHash = gameChainHash(expectedPrefix, payload);
  const result = rejected(await rpc('mvp_official_append_game', {
    p_round: roundId, p_expected_prefix: expectedPrefix, p_game: { ...payload, chainHash },
  }), 'append_rejected');
  if (result.seq !== payload.seq || result.chain_hash !== chainHash) {
    throw fail(503, 'bad_rpc_response', 'DB trả seq/chain không khớp payload.');
  }
  return { seq: payload.seq, chainHash };
}

/** Records one accepted terminal result; a different second result is a conflict, not an overwrite. */
export async function recordOfficialResult({ roundId, gameKey, result, replayHash } = {}) {
  assertId(roundId, 'roundId');
  if (!GAME_KEY.test(gameKey ?? '')) throw fail(400, 'bad_game', 'gameKey không hợp lệ.');
  if (!['red_win', 'blue_win', 'draw'].includes(result)) throw fail(400, 'bad_result', 'result không hợp lệ.');
  assertHash(replayHash, 'replayHash');
  const response = rejected(await rpc('mvp_official_record_result', {
    p_round: roundId, p_game_key: gameKey, p_result: result, p_replay_hash: replayHash,
  }), 'result_rejected');
  return { alreadyRecorded: response.already_recorded === true, result: response.result ?? result };
}

export async function freezeOfficialRound({ roundId, expectedGames } = {}) {
  assertId(roundId, 'roundId');
  if (!Number.isInteger(expectedGames) || expectedGames < 1 || expectedGames > 100000) {
    throw fail(400, 'bad_count', 'expectedGames không hợp lệ.');
  }
  const response = rejected(await rpc('mvp_official_freeze_round', {
    p_round: roundId, p_expected_games: expectedGames,
  }), 'freeze_rejected');
  return { alreadyFrozen: response.already_frozen === true };
}

/** Reads the round and verifies snapshot identity plus the whole game chain before use. */
export async function loadOfficialRound({ roundId } = {}) {
  assertId(roundId, 'roundId');
  const roundQuery = new URLSearchParams({ select: '*', id: `eq.${roundId}`, limit: '1' });
  const rounds = await request(`/rest/v1/mvp_official_rounds?${roundQuery}`);
  if (!Array.isArray(rounds) || rounds.length === 0) throw fail(404, 'round_not_found', 'Không tìm thấy vòng.');
  const round = rounds[0];
  const snapshot = round?.snapshot;
  if (!verifyOfficialRoundSnapshot(snapshot) || snapshot.contentHash !== round.snapshot_hash) {
    throw fail(409, 'snapshot_invalid', 'Snapshot lưu trong DB không hợp lệ hoặc bị sửa.');
  }
  const expectedGenesis = genesisHash({ eventId: snapshot.eventId, roundId: snapshot.roundId,
    snapshotHash: snapshot.contentHash });
  if (round.genesis_hash !== expectedGenesis) throw fail(409, 'chain_invalid', 'Genesis không khớp snapshot.');
  const gameQuery = new URLSearchParams({ select: '*', round_pk: `eq.${roundId}`, order: 'seq.asc' });
  const rows = await request(`/rest/v1/mvp_official_games?${gameQuery}`);
  if (!Array.isArray(rows) || rows.length !== round.game_count) {
    throw fail(409, 'chain_invalid', 'Số ván không khớp game_count.');
  }
  let chain = expectedGenesis;
  const games = rows.map((row, index) => {
    const game = normalizeOfficialGame({ seq: row.seq, gameKey: row.game_key, stage: row.stage,
      ...(row.group_name ? { groupName: row.group_name } : {}),
      ...(row.game_no ? { gameNo: row.game_no } : {}),
      redParticipantId: row.red_participant_id, blueParticipantId: row.blue_participant_id,
      seed: Number(row.seed), mapSlot: row.map_slot, mapHash: row.map_hash,
      mapPackVersion: row.map_pack_version, colorPolicy: row.color_policy });
    if (game.seq !== index + 1) throw fail(409, 'chain_invalid', 'Thứ tự ván bị đứt.');
    const expected = gameChainHash(chain, game);
    if (row.chain_hash !== expected) throw fail(409, 'chain_invalid', 'Chain hash không khớp.');
    chain = expected;
    return { ...game, chainHash: expected,
      ...(row.result === null ? { result: null, replayHash: null, recordedAt: null }
        : { result: row.result, replayHash: row.replay_hash, recordedAt: row.recorded_at }) };
  });
  if (chain !== round.chain_hash) throw fail(409, 'chain_invalid', 'Head chain không khớp.');
  return { roundId: round.id, eventId: round.event_id, snapshot, games,
    frozen: round.frozen === true, genesisHash: expectedGenesis, chainHash: chain };
}

/** Next group game with pinned colors. Requires a fully completed persisted prefix. */
export function nextPinnedGroupGame({ snapshot, games } = {}) {
  if (!verifyOfficialRoundSnapshot(snapshot)) throw fail(400, 'invalid_snapshot', 'Snapshot không hợp lệ.');
  if (!Array.isArray(games) || games.length > 100000) throw fail(400, 'bad_games', 'Danh sách ván không hợp lệ.');
  const participantIds = snapshot.bots.map((bot) => bot.participantId);
  const schedule = createOfficialGroupSchedule({ participantIds, seed: snapshot.seed,
    mapHash: snapshot.maps.primary.hash, mapPackVersion: snapshot.mapPackVersion });
  const planned = new Map(schedule.games.map((game) => [game.id, game]));
  const pick = (game) => Object.fromEntries(OFFICIAL_GAME_KEYS
    .filter((key) => game[key] !== undefined).map((key) => [key, game[key]]));
  const committed = games.map((game, index) => {
    const payload = normalizeOfficialGame(pick(game));
    if (payload.seq !== index + 1) throw fail(409, 'schedule_mismatch', 'Thứ tự ván đã lưu không liên tục.');
    if (payload.stage !== 'group' || payload.mapSlot !== 'primary') {
      throw fail(409, 'schedule_mismatch', 'Ván đã lưu không thuộc vòng bảng/map chính.');
    }
    const expected = planned.get(payload.gameKey);
    if (!expected || expected.seed !== payload.seed || expected.mapHash !== payload.mapHash
      || expected.mapPackVersion !== payload.mapPackVersion || expected.groupName !== payload.groupName
      || expected.gameNo !== payload.gameNo) {
      throw fail(409, 'schedule_mismatch', 'Ván đã lưu lệch lịch chuẩn của snapshot.');
    }
    if (!['red_win', 'blue_win', 'draw'].includes(game.result)) {
      throw fail(409, 'result_pending', 'Chỉ tính ván kế tiếp khi mọi ván trước đã có kết quả.');
    }
    return payload;
  });
  const next = assignNextOfficialGameColor({ games: schedule.games, roundId: 'group', seed: snapshot.seed,
    results: committed.map((game, index) => ({ gameId: game.gameKey, result: games[index].result,
      redParticipantId: game.redParticipantId, blueParticipantId: game.blueParticipantId })) });
  if (!next) return null;
  return normalizeOfficialGame({ seq: committed.length + 1, gameKey: next.id, stage: 'group',
    groupName: next.groupName, gameNo: next.gameNo, redParticipantId: next.redParticipantId,
    blueParticipantId: next.blueParticipantId, seed: next.seed, mapSlot: 'primary',
    mapHash: next.mapHash, mapPackVersion: next.mapPackVersion, colorPolicy: COLOR_POLICY });
}


