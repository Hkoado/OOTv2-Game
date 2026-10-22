import test from 'node:test';
import assert from 'node:assert/strict';
import {
  botState,
  eligibleTeams,
  eventProgress,
  eventTone,
  formatDateTime,
  formatDuration,
  initials,
  matchOutcome,
  parseHashRoute,
  reasonLabel,
  routeHash,
  stageSummary,
  standingFor,
  submissionFreeze,
  teamBotState,
  tournamentNavigation,
  validateRepository,
} from '../src/tournament/portal/tournamentView.js';

test('role navigation exposes separate team/admin catalogs without privileged fallback', () => {
  assert.deepEqual(tournamentNavigation('team').map((item) => item.id), ['overview', 'team', 'bot', 'events', 'guide']);
  assert.deepEqual(tournamentNavigation('admin').map((item) => item.id), ['overview', 'teams', 'bot', 'events', 'judge', 'guide']);
  for (const role of [null, '', 'operator', '__proto__', 'constructor']) {
    assert.deepEqual(tournamentNavigation(role), []);
  }
});

test('hash routes never grant a page outside the role catalog', () => {
  assert.deepEqual(parseHashRoute('#/events', 'team'), { page: 'events', eventId: null });
  assert.deepEqual(parseHashRoute('#/events/abc_123-XYZ', 'admin'), { page: 'events', eventId: 'abc_123-XYZ' });
  assert.deepEqual(parseHashRoute('#/teams', 'team'), { page: 'overview', eventId: null });
  assert.deepEqual(parseHashRoute('#/team', 'admin'), { page: 'overview', eventId: null });
  assert.deepEqual(parseHashRoute('#/judge', 'admin'), { page: 'judge', eventId: null });
  assert.deepEqual(parseHashRoute('#/judge', 'team'), { page: 'overview', eventId: null });
  assert.deepEqual(parseHashRoute('#/events/%3Cscript%3E', 'admin'), { page: 'events', eventId: null });
  assert.deepEqual(parseHashRoute('#/events/ok/nested', 'admin'), { page: 'overview', eventId: null });
  assert.deepEqual(parseHashRoute('#/bot', 'admin'), { page: 'bot', eventId: null });
  assert.deepEqual(parseHashRoute('#/events', null), { page: 'overview', eventId: null });
  assert.deepEqual(parseHashRoute(undefined, 'team'), { page: 'overview', eventId: null });
});

test('judge labels keep unknown reasons visible and durations readable', () => {
  assert.equal(reasonLabel('forfeit_move'), 'Bot đi nước không hợp lệ (xử thua)');
  assert.equal(reasonLabel(null), '—');
  assert.equal(reasonLabel('future_reason'), 'future_reason');
  assert.equal(formatDuration(950), '950 ms');
  assert.equal(formatDuration(4200), '4.2 s');
  assert.equal(formatDuration(65000), '1 ph 5 s');
  assert.equal(formatDuration(null), '—');
});


test('routeHash round-trips the supported shapes', () => {
  assert.equal(routeHash({ page: 'events', eventId: 'abc' }), '#/events/abc');
  assert.equal(routeHash({ page: 'overview', eventId: null }), '#/overview');
  assert.equal(routeHash(null), '#/overview');
});

test('event progress is bounded and tolerant of partial polling payloads', () => {
  assert.equal(eventProgress({ match_total: 30, match_finished: 15 }), 50);
  assert.equal(eventProgress({ match_total: 30, match_finished: 40 }), 100);
  assert.equal(eventProgress({ match_total: 0, match_finished: 0 }), 0);
  assert.equal(eventProgress({}), 0);
  assert.equal(eventProgress({ match_total: 'x', match_finished: 3 }), 0);
  assert.equal(eventTone('finished'), 'success');
  assert.equal(eventTone('group_running'), 'live');
  assert.equal(eventTone('draft'), 'neutral');
});

test('submission state helpers only trust a valid latest submission', () => {
  const teams = [
    { id: 'a', latest_valid_submission_id: 's1', latest_submission: { status: 'invalid' } },
    { id: 'b', latest_valid_submission_id: null, latest_submission: { status: 'invalid' } },
    { id: 'c', latest_valid_submission_id: null, latest_submission: null },
    { id: 'd', latest_valid_submission_id: null, latest_submission: { status: 'uploaded' } },
  ];
  assert.deepEqual(eligibleTeams(teams).map((team) => team.id), ['a']);
  assert.equal(teamBotState(teams[0]).hasValid, true);
  assert.equal(teamBotState(teams[0]).tone, 'success');
  assert.equal(teamBotState(teams[1]).label, 'Bài nộp lỗi');
  assert.equal(teamBotState(teams[2]).label, 'Chưa nộp bot');
  assert.equal(teamBotState(teams[3]).label, 'Đang kiểm tra');
  assert.deepEqual(eligibleTeams(null), []);
});

test('botState summarises submission history in server order', () => {
  const state = botState([
    { id: 'new', status: 'valid' },
    { id: 'old', status: 'invalid' },
  ]);
  assert.equal(state.latest.id, 'new');
  assert.equal(state.total, 2);
  assert.equal(state.validCount, 1);
  assert.equal(state.failedCount, 1);
  assert.equal(state.hasValid, true);
  assert.deepEqual(botState(undefined), { latest: null, total: 0, validCount: 0, failedCount: 0, hasValid: false });
});

test('submissionFreeze finds only a running tournament', () => {
  assert.equal(submissionFreeze([{ id: 1, status: 'finished' }]), null);
  assert.equal(submissionFreeze([{ id: 1, status: 'draft' }, { id: 2, status: 'semifinal_running' }]).id, 2);
  assert.equal(submissionFreeze(null), null);
});

test('standings helper locates the signed-in team across both groups', () => {
  const standings = {
    groups: {
      A: [{ participant_id: 'p1', points: 6 }],
      B: [{ participant_id: 'p2', points: 4 }],
    },
  };
  assert.deepEqual(standingFor(standings, 'p2'), { group: 'B', row: { participant_id: 'p2', points: 4 } });
  assert.equal(standingFor(standings, 'p3'), null);
  assert.equal(standingFor(null, 'p1'), null);
  assert.equal(standingFor(standings, undefined), null);
});

test('match outcome labels both live and finished games', () => {
  assert.equal(matchOutcome({ status: 'pending' }).label, 'Chờ chạy');
  assert.equal(matchOutcome({ status: 'running' }).tone, 'live');
  assert.equal(matchOutcome({ status: 'finished', result: 'red_win' }).label, 'Đỏ thắng');
  assert.equal(matchOutcome({ status: 'finished', result: 'draw' }).tone, 'neutral');
});

test('stage summary counts only known stages', () => {
  const summary = stageSummary([
    { stage: 'group', status: 'finished' },
    { stage: 'group', status: 'pending' },
    { stage: 'final', status: 'finished' },
    { stage: 'unknown', status: 'finished' },
  ]);
  assert.deepEqual(summary.group, { total: 2, finished: 1 });
  assert.deepEqual(summary.semifinal, { total: 0, finished: 0 });
  assert.deepEqual(summary.final, { total: 1, finished: 1 });
  assert.deepEqual(stageSummary(null).group, { total: 0, finished: 0 });
});

test('display helpers stay safe with missing data', () => {
  assert.equal(initials('Rùa Thép'), 'RT');
  assert.equal(initials('Bot'), 'BO');
  assert.equal(initials('   '), '?');
  assert.equal(formatDateTime(null), '—');
  assert.equal(formatDateTime('not-a-date'), '—');
  assert.notEqual(formatDateTime('2026-10-22T09:00:00.000Z'), '—');
});

test('repository format accepts only bounded GitHub HTTPS repository URLs', () => {
  assert.equal(validateRepository('https://github.com/team/bot'), '');
  assert.equal(validateRepository('https://github.com/team/bot.git/'), '');
  for (const url of [
    '',
    'http://github.com/team/bot',
    'https://evil.test/team/bot',
    'https://github.com.evil.test/team/bot',
    'https://token@github.com/team/bot',
    'https://github.com/team/bot?token=secret',
    'https://github.com/team/bot#readme',
    'https://github.com/team/bot/tree/main',
    'https://github.com:444/team/bot',
  ]) {
    assert(validateRepository(url), url);
  }
});
