/**
 * Test M3 — vòng đời giải: chia bảng, 24 trận vòng bảng, standings, bracket,
 * knockout và chống sinh trận trùng. Kết quả match được ghi thẳng vào DB
 * (giả lập worker) để test logic tiến vòng tách khỏi Python.
 * Chạy: `node --test tests/tournamentFlow.test.js`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { startTestEnv } from './helpers/testEnv.js';

/** Tạo 8 đội, mỗi đội upload `examples/sample_bot.py`, trả về mảng participant theo seed. */
async function seedEightTeams(env) {
  const participants = [];
  for (let index = 1; index <= 8; index += 1) {
    const { participant } = await env.createParticipantWithBot(`Đội ${index}`);
    participants.push(participant);
  }
  return participants;
}

/** Ghi kết quả cho mọi match chưa xong của một stage: đội seed nhỏ hơn thắng. */
function finishStageLowerSeedWins(env, tournamentId, stage) {
  const matches = env.tournamentsService.listMatches(tournamentId, stage);
  assert.ok(matches.length > 0, `không có match nào ở stage ${stage}`);
  for (const match of matches) {
    if (match.status === 'finished') continue;
    env.finishMatchLowerSeedWins(match.id);
  }
  return matches.length;
}

test('M3 giải đấu: tạo -> start -> vòng bảng -> knockout -> vô địch', async (t) => {
  const env = await startTestEnv();
  t.after(() => env.cleanup());

  const participants = await seedEightTeams(env);

  const created = await env.api('/api/tournaments', {
    method: 'POST',
    admin: true,
    body: { name: 'Giải thử nghiệm', participantIds: participants.map((p) => p.id) },
  });
  assert.equal(created.status, 201);
  const tournamentId = created.body.id;
  assert.equal(created.body.status, 'draft');
  assert.equal(created.body.match_counts.total, 0);
  assert.equal(created.body.entries.length, 8);
  assert.deepEqual(
    created.body.entries.map((entry) => entry.seed_order),
    [1, 2, 3, 4, 5, 6, 7, 8]
  );

  const list = await env.api('/api/tournaments');
  assert.equal(list.status, 200);
  assert.equal(list.body.tournaments.length, 1);

  // Chưa start: bracket rỗng, chưa có match.
  const emptyBracket = await env.api(`/api/tournaments/${tournamentId}/bracket`);
  assert.equal(emptyBracket.status, 200);
  assert.deepEqual(emptyBracket.body.semifinals, []);
  assert.equal(emptyBracket.body.final, null);
  assert.equal(emptyBracket.body.champion, null);
});

test('M3 giải đấu: start, 24 trận vòng bảng, standings 3/1/0', async (t) => {
  const env = await startTestEnv();
  t.after(() => env.cleanup());

  const participants = await seedEightTeams(env);
  const created = await env.api('/api/tournaments', {
    method: 'POST',
    admin: true,
    body: { name: 'Giải vòng bảng', participantIds: participants.map((p) => p.id) },
  });
  assert.equal(created.status, 201);
  const tournamentId = created.body.id;

  const started = await env.api(`/api/tournaments/${tournamentId}/start`, {
    method: 'POST',
    admin: true,
  });
  assert.equal(started.status, 200);
  assert.equal(started.body.status, 'group_running');
  assert.equal(started.body.match_counts.total, 24);

  const startAgain = await env.api(`/api/tournaments/${tournamentId}/start`, {
    method: 'POST',
    admin: true,
  });
  assert.equal(startAgain.status, 409);
  assert.equal(startAgain.body.error, 'already_started');

  const second = await env.api('/api/tournaments', {
    method: 'POST',
    admin: true,
    body: { name: 'Giải thứ hai', participantIds: participants.map((p) => p.id) },
  });
  assert.equal(second.status, 201);
  const secondStart = await env.api(`/api/tournaments/${second.body.id}/start`, {
    method: 'POST',
    admin: true,
  });
  assert.equal(secondStart.status, 409);
  assert.equal(secondStart.body.error, 'tournament_running');

  const groupMatches = await env.api(`/api/tournaments/${tournamentId}/matches?stage=group`);
  assert.equal(groupMatches.status, 200);
  assert.equal(groupMatches.body.matches.length, 24);
  for (const match of groupMatches.body.matches) {
    assert.match(match.series_id, /^g[AB]_\d+-\d+$/, `series_id lạ: ${match.series_id}`);
    assert.equal(match.status, 'pending');
    assert.equal(match.reason, null);
  }

  const badStage = await env.api(`/api/tournaments/${tournamentId}/matches?stage=chungkết`);
  assert.equal(badStage.status, 400);
  assert.equal(badStage.body.error, 'bad_stage');

  const standingsBefore = await env.api(`/api/tournaments/${tournamentId}/standings`);
  assert.equal(standingsBefore.status, 200);
  assert.equal(standingsBefore.body.group_stage_complete, false);
  assert.deepEqual(
    standingsBefore.body.groups.A.map((row) => row.seed_order),
    [1, 4, 5, 8]
  );
  assert.deepEqual(
    standingsBefore.body.groups.B.map((row) => row.seed_order),
    [2, 3, 6, 7]
  );
  assert.equal(standingsBefore.body.groups.A[0].points, 0);

  // Đội seed nhỏ hơn thắng mọi trận => thứ hạng trùng thứ tự seed, điểm 3/0.
  finishStageLowerSeedWins(env, tournamentId, 'group');
  const standingsAfter = await env.api(`/api/tournaments/${tournamentId}/standings`);
  assert.equal(standingsAfter.body.group_stage_complete, true);
  assert.equal(standingsAfter.body.matches.finished, 24);
  assert.deepEqual(
    standingsAfter.body.groups.A.map((row) => [
      row.seed_order,
      row.played,
      row.wins,
      row.losses,
      row.points,
      row.win_loss_difference,
    ]),
    [
      [1, 6, 6, 0, 18, 6],
      [4, 6, 4, 2, 12, 2],
      [5, 6, 2, 4, 6, -2],
      [8, 6, 0, 6, 0, -6],
    ]
  );
  assert.equal(standingsAfter.body.groups.B[0].seed_order, 2);
});

test('M3 giải đấu: bán kết -> chung kết -> vô địch, không sinh trận trùng', async (t) => {
  const env = await startTestEnv();
  t.after(() => env.cleanup());

  const participants = await seedEightTeams(env);
  const created = await env.api('/api/tournaments', {
    method: 'POST',
    admin: true,
    body: { name: 'Giải knockout', participantIds: participants.map((p) => p.id) },
  });
  const tournamentId = created.body.id;
  env.tournamentsService.startTournament(tournamentId);

  // Xong vòng bảng: mọi đội seed nhỏ hơn thắng.
  finishStageLowerSeedWins(env, tournamentId, 'group');
  const advanced = env.tournamentsService.advanceTournament(tournamentId);
  assert.equal(advanced.advanced, true);
  assert.equal(advanced.status, 'semifinal_running');

  // SF1 = A1 vs B2 (seed 1 vs 3), SF2 = B1 vs A2 (seed 2 vs 4). Mỗi series 2 lượt đổi màu.
  const semifinals = env.tournamentsService.listMatches(tournamentId, 'semifinal');
  assert.equal(semifinals.length, 4);
  const sf1 = semifinals.filter((match) => match.series_id === 'sf1');
  const sf2 = semifinals.filter((match) => match.series_id === 'sf2');
  assert.deepEqual(sf1.map((match) => match.red.seed_order).sort(), [1, 3]);
  assert.deepEqual(sf2.map((match) => match.red.seed_order).sort(), [2, 4]);

  // Gọi lại advance khi bán kết chưa xong: không sinh trận trùng.
  const idle = env.tournamentsService.advanceTournament(tournamentId);
  assert.equal(idle.advanced, false);
  assert.equal(env.tournamentsService.listMatches(tournamentId, 'semifinal').length, 4);
  assert.equal(env.tournamentsService.listMatches(tournamentId, 'final').length, 0);

  // SF1: đội seed lớn hơn (3) thắng cả 2 lượt (mỗi lượt đổi màu) => 2-0.
  for (const match of sf1) {
    env.finishMatch(match.id, match.red.seed_order < match.blue.seed_order ? 'blue_win' : 'red_win', 'base_capture');
  }
  // SF2: mỗi đội thắng lượt mình đi Đỏ => hoà 1-1, đội seed nhỏ hơn (2) đi tiếp.
  for (const match of sf2) env.finishMatch(match.id, 'red_win', 'type_eliminated');

  const bracket = await env.api(`/api/tournaments/${tournamentId}/bracket`);
  assert.equal(bracket.status, 200);
  const sf1View = bracket.body.semifinals.find((series) => series.series_id === 'sf1');
  const sf2View = bracket.body.semifinals.find((series) => series.series_id === 'sf2');
  const entryOfSeed = (series, seed) => series.sides.find((side) => side.seed_order === seed).entry_id;
  assert.equal(sf1View.complete, true);
  assert.equal(sf1View.winner_entry_id, entryOfSeed(sf1View, 3));
  assert.deepEqual(sf1View.games_won, {
    [entryOfSeed(sf1View, 1)]: 0,
    [entryOfSeed(sf1View, 3)]: 2,
  });
  assert.equal(sf2View.complete, true);
  assert.deepEqual(sf2View.games_won, {
    [entryOfSeed(sf2View, 2)]: 1,
    [entryOfSeed(sf2View, 4)]: 1,
  });
  assert.equal(sf2View.winner_entry_id, entryOfSeed(sf2View, 2), 'hoà series: seed nhỏ hơn đi tiếp');

  const toFinal = env.tournamentsService.advanceTournament(tournamentId);
  assert.equal(toFinal.status, 'final_running');
  const finals = env.tournamentsService.listMatches(tournamentId, 'final');
  assert.equal(finals.length, 2);
  const finalFirst = finals.find((match) => match.game_no === 1);
  assert.equal(finalFirst.red.seed_order, 2, 'đội seed nhỏ hơn đi Đỏ ở lượt 1');
  assert.equal(finalFirst.blue.seed_order, 3);

  // Chung kết: seed 2 thắng 2-0.
  for (const match of finals) env.finishMatchLowerSeedWins(match.id);
  const finished = env.tournamentsService.advanceTournament(tournamentId);
  assert.equal(finished.advanced, true);
  assert.equal(finished.status, 'finished');

  const finalBracket = await env.api(`/api/tournaments/${tournamentId}/bracket`);
  assert.equal(finalBracket.body.champion.name, 'Đội 2');
  assert.equal(finalBracket.body.final.complete, true);

  const detail = await env.api(`/api/tournaments/${tournamentId}`);
  assert.equal(detail.body.status, 'finished');
  assert.equal(detail.body.match_counts.total, 30);
  assert.equal(detail.body.match_counts.finished, 30);
  assert.equal(detail.body.entries.every((entry) => entry.submission_status === 'valid'), true);

  // Idempotent: gọi lại sau khi đã finished không đổi gì.
  const afterFinish = env.tournamentsService.advanceTournament(tournamentId);
  assert.equal(afterFinish.advanced, false);
  assert.equal(afterFinish.status, 'finished');
});

test('M3 API match: chi tiết an toàn và replay chỉ có khi match kết thúc', async (t) => {
  const env = await startTestEnv();
  t.after(() => env.cleanup());

  const participants = await seedEightTeams(env);
  const created = await env.api('/api/tournaments', {
    method: 'POST',
    admin: true,
    body: { name: 'Giải replay', participantIds: participants.map((p) => p.id) },
  });
  const tournamentId = created.body.id;
  env.tournamentsService.startTournament(tournamentId);

  const all = env.matchesService.listMatches({ tournamentId });
  assert.equal(all.length, 24);
  const first = all[0];

  const detail = await env.api(`/api/matches/${first.id}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.replay_url, `/api/matches/${first.id}/replay`);
  assert.equal(detail.body.tournament_id, tournamentId);
  assert.equal('storage_path' in detail.body, false);
  assert.equal('seed' in detail.body, true);

  const notReady = await env.api(`/api/matches/${first.id}/replay`);
  assert.equal(notReady.status, 404);
  assert.equal(notReady.body.error, 'replay_not_ready');

  const listByQuery = await env.api(`/api/matches?tournament_id=${tournamentId}`);
  assert.equal(listByQuery.status, 200);
  assert.equal(listByQuery.body.matches.length, 24);

  env.finishMatchLowerSeedWins(first.id);
  const replay = await env.api(`/api/matches/${first.id}/replay`);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.match_id, first.id);

  const unknownMatch = await env.api('/api/matches/khong-ton-tai');
  assert.equal(unknownMatch.status, 404);
  assert.equal(unknownMatch.body.error, 'match_not_found');
});


test('M4 API giải đấu: tạo nháp thiếu đội/bot, chặn start khi chưa sẵn sàng (T3)', async (t) => {
  const env = await startTestEnv();
  t.after(() => env.cleanup());

  // Draft được phép chưa đủ đội; start vẫn phải đủ tám.
  const seven = [];
  for (let index = 1; index <= 7; index += 1) {
    seven.push(env.participantsService.createParticipant(`Đội ${index}`));
  }
  const tooFew = await env.api('/api/tournaments', {
    method: 'POST',
    admin: true,
    body: { name: 'Giải 7 đội', participantIds: seven.map((participant) => participant.id) },
  });
  assert.equal(tooFew.status, 201);
  assert.equal((await env.api(`/api/tournaments/${tooFew.body.id}/start`, { method: 'POST', admin: true })).body.error, 'need_eight_entries');

  // Bot được bổ sung sau khi tạo, nhưng không thể start khi thiếu bot.
  const eighth = env.participantsService.createParticipant('Đội 8');
  const missingBot = await env.api('/api/tournaments', {
    method: 'POST',
    admin: true,
    body: {
      name: 'Giải thiếu bot',
      participantIds: [...seven, eighth].map((participant) => participant.id),
    },
  });
  assert.equal(missingBot.status, 201);
  assert.equal((await env.api(`/api/tournaments/${missingBot.body.id}/start`, { method: 'POST', admin: true })).body.error, 'missing_valid_submission');

  // Start khi mới có 7 đội (draft 7 entry) phải bị chặn bởi guard `need_eight_entries`.
  const db = env.db.getDb();
  const draftId = 'draft-bay-doi';
  db.prepare(
    "INSERT INTO tournaments (id, name, status, seed, created_at) VALUES (?, 'Draft 7 đội', 'draft', 1, ?)"
  ).run(draftId, env.db.nowIso());
  const insertEntry = db.prepare(
    `INSERT INTO tournament_entries (id, tournament_id, participant_id, submission_id, seed_order, group_name)
     VALUES (?, ?, ?, NULL, ?, NULL)`
  );
  seven.forEach((participant, index) => {
    insertEntry.run(`entry-${index + 1}`, draftId, participant.id, index + 1);
  });
  assert.throws(
    () => env.tournamentsService.startTournament(draftId),
    (error) => error.code === 'need_eight_entries'
  );
  assert.equal(env.tournamentsService.getTournament(draftId).status, 'draft');
});

