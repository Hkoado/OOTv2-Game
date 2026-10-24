import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { EMPTY_TERRAIN_MAP } from '../src/game/maps.js';
import { TERRAIN_RULES_VERSION } from '../src/game/terrain.js';
import { createOfficialRoundSnapshot } from '../server/contracts/officialSnapshot.js';
import { createOfficialGroupSchedule } from '../server/lib/officialGroups.js';
import { assignNextOfficialGameColor, COLOR_POLICY } from '../server/lib/officialColors.js';
import { canonicalJson } from '../server/contracts/canonical.js';
import { genesisHash, gameChainHash, normalizeOfficialGame, openOfficialRound, appendOfficialGame,
  recordOfficialResult, freezeOfficialRound, loadOfficialRound,
  nextPinnedGroupGame } from '../server/shared/officialSchedule.js';

process.env.SUPABASE_URL = 'https://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only';
const ROUND_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const EVENT_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444'];
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

function snapshot() {
  return createOfficialRoundSnapshot({
    eventId: EVENT_ID, roundId: 'group', seed: 77, cutoff: '2026-10-30T00:00:00Z',
    mapPackVersion: 'week-1', primaryMap: EMPTY_TERRAIN_MAP, reserveMap: EMPTY_TERRAIN_MAP,
    runtime: { rulesVersion: TERRAIN_RULES_VERSION, protocolVersion: 'bot.v1',
      runtimeVersion: 'campus-runtime.v1', runtimeHash: 'a'.repeat(64), budgetHash: 'b'.repeat(64) },
    bots: ids.map((participantId, index) => ({ participantId, submissionId: `sub-${index}`,
      artifactKey: `${participantId}.py`, sourceSha256: sha(Buffer.from(`bot-${index}`)), sourceKind: 'offline_file' })),
  });
}
const genesisFor = (snap) => genesisHash({ eventId: snap.eventId, roundId: snap.roundId, snapshotHash: snap.contentHash });
function setup(t, handler) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => handler(new URL(url), options);
  t.after(() => { globalThis.fetch = original; });
}
const json = (data, status = 200) => new Response(JSON.stringify(data), { status,
  headers: { 'content-type': 'application/json' } });
const dbRow = (game) => ({ seq: game.seq, game_key: game.gameKey, stage: game.stage,
  group_name: game.groupName ?? null, game_no: game.gameNo ?? null,
  red_participant_id: game.redParticipantId, blue_participant_id: game.blueParticipantId,
  seed: game.seed, map_slot: game.mapSlot, map_hash: game.mapHash,
  map_pack_version: game.mapPackVersion, color_policy: game.colorPolicy });

/** Builds a chained prefix using the same policy the scheduler uses. */
function buildPrefix(snap, count, { withResults = false, tamper = null } = {}) {
  const schedule = createOfficialGroupSchedule({ participantIds: snap.bots.map((bot) => bot.participantId),
    seed: snap.seed, mapHash: snap.maps.primary.hash, mapPackVersion: snap.mapPackVersion });
  let chain = genesisFor(snap);
  const history = [], rows = [];
  for (let index = 0; index < count; index++) {
    const next = assignNextOfficialGameColor({ games: schedule.games, roundId: 'group',
      seed: snap.seed, results: history });
    const game = { seq: index + 1, gameKey: next.id, stage: 'group', groupName: next.groupName,
      gameNo: next.gameNo, redParticipantId: next.redParticipantId, blueParticipantId: next.blueParticipantId,
      seed: next.seed, mapSlot: 'primary', mapHash: next.mapHash,
      mapPackVersion: next.mapPackVersion, colorPolicy: COLOR_POLICY };
    const chainHash = gameChainHash(chain, normalizeOfficialGame(game));
    const result = withResults ? ['red_win', 'draw', 'blue_win'][index % 3] : null;
    rows.push({ ...dbRow(game), round_pk: ROUND_ID, chain_hash: chainHash,
      result, replay_hash: result ? sha(Buffer.from(`replay-${index}`)) : null,
      recorded_at: result ? '2026-10-25T00:00:00Z' : null });
    chain = chainHash;
    if (result) history.push({ gameId: next.id, result, redParticipantId: next.redParticipantId,
      blueParticipantId: next.blueParticipantId });
  }
  if (tamper) tamper(rows);
  return { rows, chain, schedule };
}
const roundRow = (snap, count, chain) => ({ id: ROUND_ID, event_id: EVENT_ID, round_id: snap.roundId,
  snapshot: snap, snapshot_hash: snap.contentHash, genesis_hash: genesisFor(snap),
  chain_hash: chain, game_count: count, frozen: false });

test('genesis and game normalization are deterministic and strict', () => {
  const snap = snapshot();
  const genesis = genesisFor(snap);
  assert.match(genesis, /^[a-f0-9]{64}$/);
  assert.equal(genesisFor(snapshot()), genesis);
  assert.notEqual(genesisHash({ eventId: EVENT_ID, roundId: 'final', snapshotHash: snap.contentHash }), genesis);
  assert.throws(() => genesisHash({ eventId: '', roundId: 'group', snapshotHash: snap.contentHash }), { code: 'bad_genesis' });
  const first = buildPrefix(snap, 1).rows[0];
  const game = { seq: 1, gameKey: first.game_key, stage: 'group', groupName: first.group_name,
    gameNo: first.game_no, redParticipantId: first.red_participant_id, blueParticipantId: first.blue_participant_id,
    seed: first.seed, mapSlot: 'primary', mapHash: first.map_hash,
    mapPackVersion: first.map_pack_version, colorPolicy: COLOR_POLICY };
  const normalized = normalizeOfficialGame(game);
  assert.ok(Object.isFrozen(normalized));
  assert.equal(gameChainHash(genesis, normalized), gameChainHash(genesis, normalizeOfficialGame(game)));
  for (const bad of [{ ...game, extra: true }, { ...game, seed: -1 }, { ...game, seed: 2 ** 32 },
    { ...game, redParticipantId: game.blueParticipantId }, { ...game, mapSlot: 'other' },
    { ...game, colorPolicy: 'legacy' }, { ...game, gameKey: 'bad key' }, { ...game, stage: '' }]) {
    assert.throws(() => normalizeOfficialGame(bad), { code: 'bad_game' });
  }
});

test('openOfficialRound verifies the snapshot before the RPC and pins genesis', async (t) => {
  const snap = snapshot();
  let body;
  setup(t, async (url, options) => {
    assert.equal(url.pathname, '/rest/v1/rpc/mvp_official_open_round');
    body = JSON.parse(options.body);
    return json({ ok: true, round_id: ROUND_ID, genesis_hash: body.p_genesis });
  });
  const opened = await openOfficialRound({ snapshot: snap });
  assert.equal(opened.genesisHash, genesisFor(snap));
  assert.equal(body.p_event, EVENT_ID); assert.equal(body.p_round, 'group');
  assert.equal(body.p_snapshot.contentHash, snap.contentHash);
  setup(t, () => assert.fail('invalid snapshot must not call the network'));
  await assert.rejects(openOfficialRound({ snapshot: { ...snap, contentHash: 'c'.repeat(64) } }),
    { status: 409, code: 'invalid_snapshot' });
});

test('appendOfficialGame hashes the exact payload and surfaces stale-prefix fencing', async (t) => {
  const snap = snapshot();
  const genesis = genesisFor(snap);
  const first = buildPrefix(snap, 1).rows[0];
  const game = { seq: 1, gameKey: first.game_key, stage: 'group', groupName: first.group_name,
    gameNo: first.game_no, redParticipantId: first.red_participant_id, blueParticipantId: first.blue_participant_id,
    seed: first.seed, mapSlot: 'primary', mapHash: first.map_hash,
    mapPackVersion: first.map_pack_version, colorPolicy: COLOR_POLICY };
  let sent;
  setup(t, async (url, options) => {
    sent = JSON.parse(options.body);
    assert.equal(url.pathname, '/rest/v1/rpc/mvp_official_append_game');
    return json({ ok: true, seq: 1, chain_hash: sent.p_game.chainHash });
  });
  const appended = await appendOfficialGame({ roundId: ROUND_ID, expectedPrefix: genesis, game });
  assert.equal(sent.p_round, ROUND_ID); assert.equal(sent.p_expected_prefix, genesis);
  assert.equal(appended.chainHash, gameChainHash(genesis, normalizeOfficialGame(game)));
  setup(t, async (url) => {
    assert.equal(url.pathname, '/rest/v1/rpc/mvp_official_append_game');
    return json({ ok: false, error: 'stale_prefix' });
  });
  await assert.rejects(appendOfficialGame({ roundId: ROUND_ID, expectedPrefix: genesis, game }),
    { status: 409, code: 'stale_prefix' });
  await assert.rejects(appendOfficialGame({ roundId: 'not-a-uuid', expectedPrefix: genesis, game }),
    { code: 'bad_id' });
});

test('result recording is idempotent and refuses a second different result', async (t) => {
  const replayHash = 'd'.repeat(64);
  setup(t, async (url, options) => {
    assert.equal(url.pathname, '/rest/v1/rpc/mvp_official_record_result');
    const body = JSON.parse(options.body);
    assert.equal(body.p_game_key, 'group:A:1-2:1'); assert.equal(body.p_replay_hash, replayHash);
    return json({ ok: true, already_recorded: true, result: body.p_result });
  });
  assert.deepEqual(await recordOfficialResult({ roundId: ROUND_ID, gameKey: 'group:A:1-2:1',
    result: 'red_win', replayHash }), { alreadyRecorded: true, result: 'red_win' });
  setup(t, async () => json({ ok: false, error: 'result_conflict' }));
  await assert.rejects(recordOfficialResult({ roundId: ROUND_ID, gameKey: 'group:A:1-2:1',
    result: 'draw', replayHash }), { status: 409, code: 'result_conflict' });
  setup(t, () => assert.fail('invalid result must not call the network'));
  await assert.rejects(recordOfficialResult({ roundId: ROUND_ID, gameKey: 'group:A:1-2:1',
    result: 'forfeit', replayHash }), { code: 'bad_result' });
});

test('freezeOfficialRound refuses an incomplete schedule', async (t) => {
  setup(t, async (url, options) => {
    assert.equal(url.pathname, '/rest/v1/rpc/mvp_official_freeze_round');
    assert.equal(JSON.parse(options.body).p_expected_games, 12);
    return json({ ok: false, error: 'incomplete_schedule' });
  });
  await assert.rejects(freezeOfficialRound({ roundId: ROUND_ID, expectedGames: 12 }),
    { status: 409, code: 'incomplete_schedule' });
  setup(t, async () => json({ ok: true, already_frozen: false }));
  assert.deepEqual(await freezeOfficialRound({ roundId: ROUND_ID, expectedGames: 12 }),
    { alreadyFrozen: false });
});

test('loadOfficialRound verifies snapshot identity and the whole game chain', async (t) => {
  const snap = snapshot();
  const built = buildPrefix(snap, 4);
  const rows = built.rows;
  const serve = (round, games) => setup(t, async (url) => {
    if (url.pathname === '/rest/v1/mvp_official_rounds') return json(round ? [round] : []);
    if (url.pathname === '/rest/v1/mvp_official_games') return json(games);
    assert.fail(`unexpected ${url.pathname}`);
  });
  serve(roundRow(snap, rows.length, built.chain), rows);
  const loaded = await loadOfficialRound({ roundId: ROUND_ID });
  assert.equal(loaded.games.length, 4); assert.equal(loaded.chainHash, built.chain);
  assert.equal(loaded.games[0].gameKey, rows[0].game_key);
  assert.equal(loaded.frozen, false);

  const seeded = structuredClone(rows); seeded[2].seed += 1;
  serve(roundRow(snap, rows.length, built.chain), seeded);
  await assert.rejects(loadOfficialRound({ roundId: ROUND_ID }), { status: 409, code: 'chain_invalid' });

  const badHash = { ...roundRow(snap, rows.length, built.chain), snapshot_hash: 'c'.repeat(64) };
  serve(badHash, rows);
  await assert.rejects(loadOfficialRound({ roundId: ROUND_ID }), { status: 409, code: 'snapshot_invalid' });

  const badGenesis = { ...roundRow(snap, rows.length, built.chain), genesis_hash: 'c'.repeat(64) };
  serve(badGenesis, rows);
  await assert.rejects(loadOfficialRound({ roundId: ROUND_ID }), { status: 409, code: 'chain_invalid' });

  serve(roundRow(snap, rows.length, built.chain), rows.slice(0, 3));
  await assert.rejects(loadOfficialRound({ roundId: ROUND_ID }), { status: 409, code: 'chain_invalid' });

  serve(undefined, []);
  await assert.rejects(loadOfficialRound({ roundId: ROUND_ID }), { status: 404, code: 'round_not_found' });
});

test('nextPinnedGroupGame derives the next pinned color from a completed prefix only', () => {
  const snap = snapshot();
  const toGame = (row) => ({ seq: row.seq, gameKey: row.game_key, stage: row.stage,
    groupName: row.group_name, gameNo: row.game_no, redParticipantId: row.red_participant_id,
    blueParticipantId: row.blue_participant_id, seed: row.seed, mapSlot: row.map_slot,
    mapHash: row.map_hash, mapPackVersion: row.map_pack_version, colorPolicy: row.color_policy,
    result: row.result });
  const prefix = buildPrefix(snap, 6, { withResults: true }).rows.map(toGame);
  const predicted = nextPinnedGroupGame({ snapshot: snap, games: prefix });
  const expected = buildPrefix(snap, 7, { withResults: true }).rows[6];
  assert.equal(predicted.seq, 7);
  assert.equal(predicted.gameKey, expected.game_key);
  assert.equal(predicted.redParticipantId, expected.red_participant_id);
  assert.equal(predicted.blueParticipantId, expected.blue_participant_id);
  assert.equal(predicted.seed, expected.seed);
  assert.equal(predicted.mapHash, expected.map_hash);

  const pending = structuredClone(prefix); pending[5].result = null;
  assert.throws(() => nextPinnedGroupGame({ snapshot: snap, games: pending }), { code: 'result_pending' });
  const drifted = structuredClone(prefix); drifted[0].seed += 1;
  assert.throws(() => nextPinnedGroupGame({ snapshot: snap, games: drifted }), { code: 'schedule_mismatch' });
  const complete = buildPrefix(snap, 12, { withResults: true }).rows.map(toGame);
  assert.equal(nextPinnedGroupGame({ snapshot: snap, games: complete }), null);
});

test('migration keeps schedule tables private and results single-shot', () => {
  const sql = readFileSync('supabase/migrations/20261025090000_official_schedule.sql', 'utf8');
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on mvp_official_rounds, mvp_official_games from public, anon, authenticated/);
  assert.match(sql, /unique \(round_pk, seq\)/);
  assert.match(sql, /unique \(round_pk, game_key\)/);
  assert.match(sql, /stale_prefix/);
  assert.match(sql, /result_conflict/);
  assert.match(sql, /round_frozen/);
  assert.match(sql, /grant execute on function mvp_official_append_game\(uuid, text, jsonb\) to service_role/);
  assert.equal((sql.match(/\$\$/g) || []).length % 2, 0);
  assert.equal((sql.match(/create or replace function/g) || []).length, 4);
  assert.match(sql, /security definer/);
  assert.doesNotMatch(sql, /grant .* to anon/i);
  assert.doesNotMatch(sql, /^\s*(begin|commit)\s*;/im);
});

