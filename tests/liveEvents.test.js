/**
 * Test lớp dữ liệu xem trực tiếp: ghi event theo `seq`, snapshot công khai chỉ chứa
 * field whitelist, log bot L2 được lọc/giới hạn, dọn lịch sử và khôi phục sau crash.
 *
 * Chạy: `node --test tests/liveEvents.test.js`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { startTestEnv } from './helpers/testEnv.js';

let counter = 0;

/** Tạo participants/giải/entries/match trực tiếp bằng SQL để test độc lập service giải. */
function seedMatch(env, { status = 'running', tournamentStatus = 'group_running', finishedAt = null } = {}) {
  counter += 1;
  const db = env.getDb();
  const now = new Date().toISOString();
  const ids = {
    tournament: `t-live-${counter}`,
    redEntry: `e-red-${counter}`,
    blueEntry: `e-blue-${counter}`,
    redParticipant: `p-red-${counter}`,
    blueParticipant: `p-blue-${counter}`,
    match: `m-live-${counter}`,
    redName: `Red ${counter}`,
    blueName: `Blue ${counter}`,
  };

  db.prepare('INSERT INTO participants (id, name, name_key, created_at) VALUES (?, ?, ?, ?)').run(
    ids.redParticipant, ids.redName, ids.redName.toLowerCase(), now
  );
  db.prepare('INSERT INTO participants (id, name, name_key, created_at) VALUES (?, ?, ?, ?)').run(
    ids.blueParticipant, ids.blueName, ids.blueName.toLowerCase(), now
  );
  db.prepare(
    `INSERT INTO tournaments (id, name, status, seed, created_at, started_at, finished_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(ids.tournament, `Live Event ${counter}`, tournamentStatus, 7, now, now, finishedAt);
  db.prepare(
    `INSERT INTO tournament_entries (id, tournament_id, participant_id, seed_order, group_name)
     VALUES (?, ?, ?, ?, 'A')`
  ).run(ids.redEntry, ids.tournament, ids.redParticipant, 1);
  db.prepare(
    `INSERT INTO tournament_entries (id, tournament_id, participant_id, seed_order, group_name)
     VALUES (?, ?, ?, ?, 'A')`
  ).run(ids.blueEntry, ids.tournament, ids.blueParticipant, 2);
  db.prepare(
    `INSERT INTO matches (id, tournament_id, stage, series_id, game_no, red_entry_id, blue_entry_id,
                          seed, status, started_at, finished_at)
     VALUES (?, ?, 'group', 'A', 1, ?, ?, 7, ?, ?, ?)`
  ).run(ids.match, ids.tournament, ids.redEntry, ids.blueEntry, status, now, finishedAt);

  return ids;
}

function samplePieces() {
  return [
    { id: 'r1', player: 'red', type: 'rock', square: 0, alive: true },
    { id: 'b1', player: 'blue', type: 'scissors', square: 80, alive: true },
  ];
}

test('liveEvents: ghi initial/move/terminal và đọc theo afterSeq', async (t) => {
  const env = await startTestEnv({ withServer: false });
  t.after(() => env.cleanup());
  const ids = seedMatch(env);
  const live = await import('../server/services/liveEvents.js');

  live.startLiveMatch(ids.match, { initialPieces: samplePieces(), seed: 42 });
  live.recordLiveMove(ids.match, {
    ply: 1,
    event: { player: 'red', piece_id: 'r1', from: 0, to: 9, captured_piece_id: null },
  });
  // Ghi lại cùng ply (worker retry) không được tạo event trùng.
  live.recordLiveMove(ids.match, {
    ply: 1,
    event: { player: 'red', piece_id: 'r1', from: 0, to: 9, captured_piece_id: null },
  });

  const first = live.listLiveEvents(ids.match, { afterSeq: 0 });
  assert.deepEqual(first.events.map((event) => event.kind), ['initial', 'move']);
  assert.equal(first.latest_seq, 1);
  assert.equal(first.reset, false);

  const polled = live.listLiveEvents(ids.match, { afterSeq: 1 });
  assert.deepEqual(polled.events, [], 'afterSeq = 1 không trả lại nước đã xem');

  const rewound = live.listLiveEvents(ids.match, { afterSeq: 99 });
  assert.equal(rewound.reset, true, 'client tụt lại phải biết để tải lại snapshot');

  assert.equal(live.recordLiveTerminal(ids.match, { result: 'red_win', reason: 'base_capture', ply_count: 1 }), true);
  assert.equal(live.recordLiveTerminal(ids.match, { result: 'red_win', reason: 'base_capture', ply_count: 1 }), false);

  const snapshot = live.getLiveMatchSnapshot(ids.match);
  assert.equal(snapshot.match.red.name, ids.redName);
  assert.equal(snapshot.match.blue.name, ids.blueName);
  assert.equal(snapshot.live.has_initial, true);
  assert.equal(snapshot.live.latest_seq, 2);
  assert.equal(snapshot.live.initial_pieces.length, 2);

  // Không được lộ dữ liệu nội bộ qua API công khai.
  const serialized = JSON.stringify(snapshot);
  assert.ok(!serialized.includes('storage_path'));
  assert.ok(!serialized.includes('replay_json'));
  assert.ok(!serialized.includes('notes'));

test('liveEvents: log bot L2 được lọc ký tự điều khiển và giới hạn số dòng', async (t) => {
  const env = await startTestEnv({ withServer: false });
  t.after(() => env.cleanup());
  const ids = seedMatch(env);
  const live = await import('../server/services/liveEvents.js');
  live.startLiveMatch(ids.match, { initialPieces: samplePieces(), seed: 1 });

  live.recordBotOutput(ids.match, 'red', 'stderr', '\u001b[31mboom\u001b[0m\r\nhello\n\n');
  const saved = live.listBotOutput(ids.match, { side: 'red' });
  assert.equal(saved.lines.length, 2);
  assert.ok(!saved.lines.some((line) => line.line.includes('\u001b')));
  assert.deepEqual(saved.lines.map((line) => line.side), ['red', 'red']);
  assert.deepEqual(saved.lines.map((line) => line.stream), ['stderr', 'stderr']);

  const original = env.config.live.botOutputLinesPerMatch;
  env.config.live.botOutputLinesPerMatch = 3;
  try {
    live.recordBotOutput(ids.match, 'blue', 'stdout', 'a\nb\nc\nd\ne\n');
    const capped = live.listBotOutput(ids.match);
    assert.equal(capped.lines.length, 3, 'không vượt hạn mức dòng mỗi trận');
    assert.equal(capped.lines[2].side, 'blue');
  } finally {
    env.config.live.botOutputLinesPerMatch = original;
  }

  // Side không hợp lệ bị bỏ (không có đường ghi log lạ).
  assert.equal(live.recordBotOutput(ids.match, 'green', 'stdout', 'x'), 0);
});

test('liveEvents: dọn lịch sử chỉ đụng giải đã kết thúc lâu ngày', async (t) => {
  const env = await startTestEnv({ withServer: false });
  t.after(() => env.cleanup());
  const live = await import('../server/services/liveEvents.js');

  const old = seedMatch(env, {
    status: 'finished',
    tournamentStatus: 'finished',
    finishedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
  });
  const running = seedMatch(env);

  for (const ids of [old, running]) {
    live.startLiveMatch(ids.match, { initialPieces: samplePieces(), seed: 1 });
    live.recordLiveMove(ids.match, { ply: 1, event: { player: 'red', piece_id: 'r1', from: 0, to: 9 } });
    live.recordBotOutput(ids.match, 'red', 'stderr', 'log line');
  }

  const removed = live.pruneLiveHistory({ keepDays: 2 });
  assert.equal(removed.events >= 2, true);
  assert.equal(live.listLiveEvents(old.match).events.length, 0);
  assert.equal(live.listBotOutput(old.match).lines.length, 0);
  assert.equal(live.listLiveEvents(running.match).events.length, 2, 'giải đang chạy phải giữ nguyên');
});

test('liveEvents: khôi phục match running xoá event cũ để ván chạy lại sạch', async (t) => {
  const env = await startTestEnv({ withServer: false });
  t.after(() => env.cleanup());
  const ids = seedMatch(env);
  const live = await import('../server/services/liveEvents.js');

  live.startLiveMatch(ids.match, { initialPieces: samplePieces(), seed: 1 });
  live.recordLiveMove(ids.match, { ply: 1, event: { player: 'red', piece_id: 'r1', from: 0, to: 9 } });

  assert.equal(env.db.recoverUnfinishedMatches(), 1);
  const row = env.getDb().prepare('SELECT status, started_at FROM matches WHERE id = ?').get(ids.match);
  assert.equal(row.status, 'pending');
  assert.equal(row.started_at, null);
  assert.equal(live.listLiveEvents(ids.match).events.length, 0);
});

});
