import test from 'node:test';
import assert from 'node:assert/strict';
import { computeBroadcast } from '../server/shared/publication.js';
import { officialViewerPackage, scheduleOfficialGameBroadcast, officialBroadcastState,
  trimOfficialReplay, replayPlyCount, officialBroadcastView } from '../server/services/officialBroadcasts.js';

const ROUND = '11111111-1111-4111-8111-111111111111';
const GAME = 'semifinal:1:main:1';
const EVENT = '22222222-2222-4222-8222-222222222222';
const PLAYER_A = '33333333-3333-4333-8333-333333333333';
const PLAYER_B = '44444444-4444-4444-8444-444444444444';

const replay = {
  schemaVersion: 'campus-engine-replay.v1', rulesVersion: 'campus-rules.v2',
  config: { id: 'r1', seed: 7, map: { rulesVersion: 'campus-rules.v2' } }, mapHash: 'a'.repeat(64),
  initialStateHash: 'b'.repeat(64),
  events: Array.from({ length: 3 }, (_, index) => ({ seq: index + 1, action: { kind: 'move' },
    resultingStateHash: 'c'.repeat(64) })),
  result: 'red_win', terminationReason: 'BASE_CAPTURE', contentHash: 'd'.repeat(64),
};
const game = { game_key: GAME, stage: 'semifinal', result: 'red_win' };
const row = (extra = {}) => ({ round_pk: ROUND, game_key: GAME, event_id: EVENT, state: 'scheduled',
  starts_at: '2026-10-24T10:00:00.000Z', ply_interval_ms: 1000, release_mode: 'window', ...extra });

test('viewer chỉ thấy ply đã phát và không thấy kết quả trước khi mở', () => {
  const info = computeBroadcast(row(), { now: Date.parse('2026-10-24T10:00:01.000Z'), totalPlies: 3 });
  assert.equal(info.phase, 'broadcasting');
  assert.equal(info.visible_plies, 2);
  const pack = officialViewerPackage({ roundPk: ROUND, gameKey: GAME, game, replay, info });
  assert.equal(pack.events.length, 2, JSON.stringify(pack.events.map((event) => event.seq)));
  assert.equal(pack.reveal_result, false);
  assert.equal(pack.result, undefined);
  assert.equal(pack.replay, undefined);
  assert.equal(pack.phase, 'broadcasting');

  const later = computeBroadcast(row(), { now: Date.parse('2026-10-24T10:00:05.000Z'), totalPlies: 3 });
  assert.equal(later.phase, 'ended');
  assert.equal(later.reveal_result, false, 'release_mode window: hết giờ vẫn không mở kết quả');
});

test('release_mode full mở kết quả + replay đầy đủ khi đã phát xong', () => {
  const info = computeBroadcast(row({ release_mode: 'full' }),
    { now: Date.parse('2026-10-24T10:00:09.000Z'), totalPlies: 3 });
  assert.equal(info.reveal_result, true);
  const pack = officialViewerPackage({ roundPk: ROUND, gameKey: GAME, game, replay, info });
  assert.equal(pack.result, 'red_win');
  assert.equal(pack.replay.events.length, 3);
  assert.equal(pack.replay.contentHash, 'd'.repeat(64), 'bản đầy đủ giữ nguyên hash để client kiểm');
});

test('chưa công bố (hidden) thì viewer nhận 404, không lộ nội dung', () => {
  const info = computeBroadcast(null, { now: Date.now(), totalPlies: 3 });
  assert.throws(() => officialViewerPackage({ roundPk: ROUND, gameKey: GAME, game, replay, info }),
    (error) => error.code === 'broadcast_not_published' && error.status === 404);
});

test('trimOfficialReplay cắt theo visible_plies và bỏ result khi chưa mở', () => {
  const trimmed = trimOfficialReplay(replay, { visiblePlies: 1 });
  assert.equal(trimmed.events.length, 1);
  assert.equal(trimmed.result, null);
  assert.equal(trimmed.terminationReason, null);
  assert.equal(trimmed.contentHash, undefined);
  assert.equal(replayPlyCount(replay), 3);
  assert.equal(replayPlyCount(null), 0);
});

test('officialBroadcastView không chứa nước đi hay kết quả', () => {
  const info = computeBroadcast(row(), { now: Date.parse('2026-10-24T10:00:01.000Z'), totalPlies: 3 });
  const view = officialBroadcastView(row(), info);
  assert.equal(view.game_key, GAME);
  assert.equal(view.total_plies, 3);
  assert.equal(Object.hasOwn(view, 'result'), false);
  assert.equal(Object.hasOwn(view, 'events'), false);
});

const frozen = (extra = {}) => ({ round: { id: ROUND, event_id: EVENT, round_id: 'ko:semifinal:1', frozen: true },
  game, broadcast: null, replay, totalPlies: 3, ...extra });

test('không đặt lịch phát cho ván chưa có kết quả accepted', async () => {
  await assert.rejects(scheduleOfficialGameBroadcast({ roundPk: ROUND, gameKey: GAME,
    account: { id: PLAYER_A, role: 'admin' }, body: {} },
  { load: async () => frozen({ game: { ...game, result: null } }) }),
  (error) => error.code === 'game_not_scored' && error.status === 409);
});

test('đặt lịch phát: insert lần đầu, update lần sau, từ chối state lạ', async () => {
  const calls = [];
  const save = async (existing, patch) => {
    calls.push({ existing: Boolean(existing), patch });
    return { ...row(patch) };
  };
  const first = await scheduleOfficialGameBroadcast({ roundPk: ROUND, gameKey: GAME,
    account: { id: PLAYER_A, role: 'admin' }, body: { starts_at: '2026-10-24T10:00:00.000Z' } },
  { load: async () => frozen(), save });
  assert.equal(calls[0].existing, false);
  assert.equal(first.broadcast.state, 'scheduled');
  assert.equal(first.broadcast.event_id, EVENT, 'event_id lấy từ round, không tin body');
  await scheduleOfficialGameBroadcast({ roundPk: ROUND, gameKey: GAME,
    account: { id: PLAYER_A, role: 'admin' },
    body: { starts_at: '2026-10-24T10:00:00.000Z', state: 'canceled' } },
  { load: async () => frozen({ broadcast: row() }), save });
  assert.equal(calls[1].existing, true);
  assert.equal(calls[1].patch.canceled_at !== null, true);
  await assert.rejects(scheduleOfficialGameBroadcast({ roundPk: ROUND, gameKey: GAME,
    body: { state: 'live' } }, { load: async () => frozen(), save }),
  (error) => error.code === 'bad_state');
});

test('đội chưa được công bố thì không xem được trạng thái, admin thì xem được', async () => {
  await assert.rejects(officialBroadcastState({ roundPk: ROUND, gameKey: GAME,
    account: { role: 'team', participant_id: PLAYER_B } },
  { load: async () => frozen(), member: async () => {} }),
  (error) => error.code === 'broadcast_not_published');
  const admin = await officialBroadcastState({ roundPk: ROUND, gameKey: GAME,
    account: { role: 'admin' }, now: Date.parse('2026-10-24T10:00:05.000Z') },
  { load: async () => frozen({ broadcast: row() }), member: async () => {} });
  assert.equal(admin.broadcast.phase, 'ended');
  assert.equal(admin.round_id, 'ko:semifinal:1');
});
