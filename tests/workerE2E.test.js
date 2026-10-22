/**
 * Test M4 — worker chạy thật (Python + SQLite): hết giải 8 đội = 30 game, có bot phạm luật.
 * Bao phủ T1/T5/T6/T7/T9/T10 trong `docs/04_IMPLEMENTATION_CHECKLIST.md`.
 * Chạy: `node --test tests/workerE2E.test.js`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import path from 'node:path';

import { startTestEnv, example, forfeitAfterFirstPlyBotPath } from './helpers/testEnv.js';

const REPO_DATA_DIR = path.resolve(process.cwd(), 'data');

/** Ảnh chụp `data/` của repo để chắc test chỉ ghi vào thư mục tạm. */
function snapshotDataDir() {
  try {
    return readdirSync(REPO_DATA_DIR).sort().join('|');
  } catch {
    return null; // data/ chưa tồn tại => test không được tạo ra nó
  }
}

/** Tạo 8 đội: 7 bot mẫu + 1 bot phạm luật ở nước đi sau setup (nhưng setup hợp lệ). */
async function seedEightBots(env) {
  const participants = [];
  for (let index = 1; index <= 7; index += 1) {
    const { participant } = await env.createParticipantWithBot(`Bot ${index}`, example('sample_bot.py'));
    participants.push(participant);
  }
  const { participant: cheater } = await env.createParticipantWithBot(
    'Bot phạm luật',
    forfeitAfterFirstPlyBotPath()
  );
  participants.push(cheater);
  return { participants, cheater };
}

/** Tạo giải qua API rồi start (trả về tournamentId). */
async function createAndStartTournament(env, participants, name) {
  const created = await env.api('/api/tournaments', {
    method: 'POST',
    admin: true,
    body: { name, participantIds: participants.map((participant) => participant.id) },
  });
  assert.equal(created.status, 201);
  const tournamentId = created.body.id;
  const started = await env.api(`/api/tournaments/${tournamentId}/start`, {
    method: 'POST',
    admin: true,
  });
  assert.equal(started.status, 200);
  return tournamentId;
}

test('M4 worker: chạy hết giải 8 bot (30 game) và tìm ra vô địch', { timeout: 600000 }, async (t) => {
  const dataBefore = snapshotDataDir();
  const env = await startTestEnv();
  t.after(() => env.cleanup());

  const { participants, cheater } = await seedEightBots(env);
  const tournamentId = await createAndStartTournament(env, participants, 'Giải worker');

  // Worker thật: drain chạy tới khi hết việc.
  await env.worker.runWorker({ drain: true });

  const detail = env.tournamentsService.getTournament(tournamentId);
  assert.equal(detail.status, 'finished');
  assert.equal(detail.match_counts.total, 30);
  assert.equal(detail.match_counts.finished, 30);

  // T7: mỗi đội đúng 6 game vòng bảng, tổng 24 game.
  const groupMatches = env.tournamentsService.listMatches(tournamentId, 'group');
  assert.equal(groupMatches.length, 24);
  for (const participant of participants) {
    const played = groupMatches.filter(
      (match) =>
        match.red.participant_id === participant.id || match.blue.participant_id === participant.id
    );
    assert.equal(played.length, 6, `${participant.name} phải đá đúng 6 game vòng bảng`);
    assert.equal(played.filter((match) => match.status === 'finished').length, 6);
  }

  // Mọi game đều có kết quả + replay đọc được; ply_count khớp số event đã lưu.
  const allMatches = env.tournamentsService.listMatches(tournamentId);
  assert.equal(allMatches.length, 30);
  let engineDecided = 0;
  for (const match of allMatches) {
    assert.ok(match.result, `match ${match.id} thiếu result`);
    const replay = env.matchesService.getMatchReplay(match.id);
    assert.equal(replay.match_id, match.id);
    assert.equal(replay.result, match.result);
    assert.equal(replay.events.length, match.ply_count, `ply_count lệch ở match ${match.id}`);
    if (['base_capture', 'type_eliminated', 'move_limit'].includes(match.reason)) {
      engineDecided += 1;
      assert.equal(replay.replay_consistent, true, `replay lệch kết quả ở match ${match.id}`);
    }
  }
  assert.ok(engineDecided > 0, 'phải có game do luật engine quyết định, không chỉ forfeit');

  // T5/T6: bot phạm luật thua cả 6 game vòng bảng, worker vẫn chạy tới vô địch.
  const cheaterMatches = allMatches.filter(
    (match) => match.red.participant_id === cheater.id || match.blue.participant_id === cheater.id
  );
  assert.equal(cheaterMatches.length, 6);
  for (const match of cheaterMatches) {
    const cheaterIsRed = match.red.participant_id === cheater.id;
    assert.equal(match.reason, 'forfeit_move');
    assert.equal(match.result, cheaterIsRed ? 'blue_win' : 'red_win');
  }

  // T8: standings 3/1/0 — bot phạm luật 0 điểm nên không thể vào bán kết.
  const standings = env.tournamentsService.computeStandings(tournamentId);
  assert.equal(standings.group_stage_complete, true);
  assert.equal(standings.matches.finished, 24);
  const cheaterRow = [...standings.groups.A, ...standings.groups.B].find(
    (row) => row.name === 'Bot phạm luật'
  );
  assert.equal(cheaterRow.played, 6);
  assert.equal(cheaterRow.wins, 0);
  assert.equal(cheaterRow.points, 0);
  for (const group of ['A', 'B']) {
    assert.equal(standings.groups[group].length, 4);
    const totalPlayed = standings.groups[group].reduce((sum, row) => sum + row.played, 0);
    assert.equal(totalPlayed, 24, `bảng ${group}: 12 trận x 2 đội = 24 lượt tham dự`);
  }

  // T9: bán kết 4 game + chung kết 2 game, luôn xác định được vô địch.
  assert.equal(env.tournamentsService.listMatches(tournamentId, 'semifinal').length, 4);
  assert.equal(env.tournamentsService.listMatches(tournamentId, 'final').length, 2);
  const bracket = env.tournamentsService.computeBracket(tournamentId);
  assert.equal(bracket.semifinals.length, 2);
  assert.equal(bracket.semifinals.every((series) => series.complete), true);
  assert.equal(bracket.final.complete, true);
  assert.ok(bracket.champion, 'phải có vô địch');
  assert.notEqual(bracket.champion.name, 'Bot phạm luật');
  assert.ok(participants.some((participant) => participant.name === bracket.champion.name));

  // Mức 2: mỗi ván đã chấm có nhật ký, nhãn worker, không lưu đường dẫn file bot.
  const logs = env.getDb().prepare('SELECT notes_json, worker FROM match_logs').all();
  assert.equal(logs.length, 30, 'phải có nhật ký cho đủ 30 ván');
  assert.ok(logs.every((row) => row.worker && row.worker.includes(':')), 'mỗi nhật ký phải có nhãn worker');
  assert.ok(logs.every((row) => Array.isArray(JSON.parse(row.notes_json))));
  assert.ok(logs.every((row) => !row.notes_json.includes('submissions')), 'không lưu đường dẫn file bot');

  // Không đụng dữ liệu thật của repo: mọi thứ nằm trong thư mục tạm.
  assert.equal(snapshotDataDir(), dataBefore, 'test không được ghi vào data/ của repo');
});

test('M4 worker: recovery match running + ghi kết quả không đúp điểm', async (t) => {
  const env = await startTestEnv();
  t.after(() => env.cleanup());

  const { participants } = await seedEightBots(env);
  const tournamentId = await createAndStartTournament(env, participants, 'Giải recovery');

  // Worker claim 1 match => match chuyển 'running' như đang chạy dở.
  const tournament = env.worker.currentRunningTournament();
  assert.equal(tournament.id, tournamentId);
  const claimed = env.worker.claimNextMatch(tournament);
  assert.ok(claimed, 'phải claim được match đầu tiên');
  assert.equal(claimed.stage, 'group');
  assert.equal(
    env.tournamentsService.listMatches(tournamentId, 'group').filter((m) => m.status === 'running').length,
    1
  );

  // Restart worker: match 'running' chưa có kết quả phải về 'pending' đúng 1 lần.
  assert.equal(env.db.recoverUnfinishedMatches(), 1);
  assert.equal(
    env.tournamentsService.listMatches(tournamentId, 'group').filter((m) => m.status === 'running').length,
    0
  );

  // Claim lại phải trúng đúng match cũ (cùng seed/submission snapshot) => chạy lại không lệch kết quả.
  const reclaimed = env.worker.claimNextMatch(env.worker.currentRunningTournament());
  assert.equal(reclaimed.id, claimed.id);
  assert.equal(reclaimed.seed, claimed.seed);

  const outcome = {
    result: 'red_win',
    reason: 'base_capture',
    ply_count: 4,
    replay: {
      protocol_version: 1,
      match_id: reclaimed.id,
      seed: reclaimed.seed,
      initial_pieces: [],
      events: [],
      result: 'red_win',
      reason: 'base_capture',
    },
  };
  assert.equal(env.worker.recordResult(reclaimed.id, outcome), true);
  // Ghi lần hai bị chặn vì match không còn 'running' => không đúp điểm.
  assert.equal(env.worker.recordResult(reclaimed.id, outcome), false);
  const detail = env.matchesService.getMatchDetail(reclaimed.id);
  assert.equal(detail.result, 'red_win');
  assert.equal(detail.ply_count, 4);
  assert.equal(
    env.tournamentsService.getTournament(tournamentId).match_counts.finished,
    1,
    'chỉ được tính 1 game đã xong'
  );

  // `--once`: chạy đúng 1 trận thật bằng Python rồi dừng.
  const once = await env.worker.processOneMatch({ verbose: false });
  assert.equal(once.processed, true);
  assert.equal(once.recorded, true);
  assert.ok(once.match.id !== reclaimed.id, '--once phải lấy match pending kế tiếp');
  assert.equal(env.tournamentsService.getTournament(tournamentId).match_counts.finished, 2);
  // Nhật ký vẫn ghi đủ cho ván ghi trực tiếp (worker=null) và ván do worker chấm.
  const recoveryLogs = env.getDb().prepare('SELECT worker FROM match_logs').all();
  assert.equal(recoveryLogs.length, 2);
  assert.ok(recoveryLogs.some((row) => row.worker && row.worker.includes(':')));
});
