import test from 'node:test';
import assert from 'node:assert/strict';
import {
  broadcastPhaseMeta,
  calculateCountdown,
  computeViewerProgress,
  formatOfficialStandingsRow,
  formatReleaseMode,
  formatTimeRemaining,
} from '../src/tournament/portal/live/publicationView.js';

test('formatTimeRemaining formats seconds into MM:SS and HH:MM:SS', () => {
  assert.equal(formatTimeRemaining(0), '00:00');
  assert.equal(formatTimeRemaining(-10), '00:00');
  assert.equal(formatTimeRemaining(45), '00:45');
  assert.equal(formatTimeRemaining(125), '02:05');
  assert.equal(formatTimeRemaining(3665), '01:01:05');
  assert.equal(formatTimeRemaining(null), '00:00');
});

test('calculateCountdown computes remaining time and hasStarted flag', () => {
  const now = Date.parse('2026-10-24T00:00:00.000Z');
  const future = '2026-10-24T00:05:30.000Z'; // +330s
  const res = calculateCountdown(future, now);
  assert.equal(res.remainingSeconds, 330);
  assert.equal(res.formatted, '05:30');
  assert.equal(res.hasStarted, false);

  const past = '2026-10-23T23:59:00.000Z';
  const pastRes = calculateCountdown(past, now);
  assert.equal(pastRes.remainingSeconds, 0);
  assert.equal(pastRes.hasStarted, true);

  assert.equal(calculateCountdown(null, now).hasStarted, true);
});

test('broadcastPhaseMeta resolves label, tone and flags correctly', () => {
  const waiting = broadcastPhaseMeta('waiting');
  assert.equal(waiting.label, 'Chờ giờ phát');
  assert.equal(waiting.tone, 'warning');
  assert.equal(waiting.isWaiting, true);

  const broadcasting = broadcastPhaseMeta('broadcasting');
  assert.equal(broadcasting.label, 'Đang phát sóng');
  assert.equal(broadcasting.tone, 'live');
  assert.equal(broadcasting.isBroadcasting, true);

  const endedFull = broadcastPhaseMeta('ended', true);
  assert.equal(endedFull.label, 'Đã phát xong');
  assert.equal(endedFull.tone, 'success');
  assert.equal(endedFull.isEnded, true);

  const endedWindow = broadcastPhaseMeta('ended', false);
  assert.match(endedWindow.label, /kết quả bảo mật/);
  assert.equal(endedWindow.tone, 'neutral');

  const hidden = broadcastPhaseMeta('hidden');
  assert.equal(hidden.label, 'Chưa công bố');
  assert.equal(hidden.tone, 'neutral');
});

test('computeViewerProgress bounds percentage between 0 and 100', () => {
  assert.equal(computeViewerProgress(0, 100), 0);
  assert.equal(computeViewerProgress(50, 100), 50);
  assert.equal(computeViewerProgress(150, 100), 100);
  assert.equal(computeViewerProgress(-5, 100), 0);
  assert.equal(computeViewerProgress(10, 0), 0);
  assert.equal(computeViewerProgress(null, 50), 0);
});

test('formatReleaseMode describes release modes in Vietnamese', () => {
  assert.match(formatReleaseMode('full'), /Mở toàn bộ/);
  assert.match(formatReleaseMode('window'), /theo mốc thời gian/);
  assert.equal(formatReleaseMode(null), 'Chưa xác định');
});

test('formatOfficialStandingsRow preserves series points and game points separately', () => {
  const raw = {
    participantId: 'team-1',
    name: 'Đội 1',
    seriesPlayed: 4,
    seriesWon: 3,
    seriesDrawn: 1,
    seriesLost: 0,
    seriesPoints: 10,
    gamesPlayed: 8,
    gamesWon: 6,
    gamesDrawn: 1,
    gamesLost: 1,
    gamePoints: 6.5,
    miniSeriesPoints: 3,
    miniGamePoints: 2,
  };
  const row = formatOfficialStandingsRow(raw, 1);
  assert.equal(row.rank, 1);
  assert.equal(row.participantId, 'team-1');
  assert.equal(row.seriesPoints, 10);
  assert.equal(row.gamePoints, 6.5);
  assert.equal(row.miniSeriesPoints, 3);
  assert.equal(formatOfficialStandingsRow(null), null);
});
