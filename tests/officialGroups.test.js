import test from 'node:test';
import assert from 'node:assert/strict';
import { createOfficialGroupSchedule, computeOfficialGroupStandings } from '../server/lib/officialGroups.js';

const ids = (count) => Array.from({ length: count }, (_, i) => `team-${String(i + 1).padStart(2, '0')}`);
const config = (count = 4, seed = 0) => ({ participantIds: ids(count), seed, mapHash: 'a'.repeat(64), mapPackVersion: 'week-1' });
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function fixture(count = 4) {
  const input = config(count), schedule = createOfficialGroupSchedule(input), results = [];
  // Add a pair by participant IDs with first team's two game points in color order.
  const pair = (a, b, points) => {
    const series = schedule.series.find((s) => s.participantIds.includes(a) && s.participantIds.includes(b));
    assert.ok(series);
    series.gameIds.forEach((gameId, i) => {
      const game = schedule.games.find((g) => g.id === gameId);
      const winner = points[i] === 1 ? a : b;
      results.push({ gameId, result: points[i] === 0.5 ? 'draw' : winner === game.redParticipantId ? 'red_win' : 'blue_win' });
    });
  };
  return { input, schedule, results, pair, standings: () => computeOfficialGroupStandings({ ...input, results }) };
}

for (const [count, pairs] of [[35, 60], [40, 80], [48, 120], [50, 132]]) {
  test(`K1 ${count} teams: ${pairs} unique pairs / ${pairs * 2} balanced-color games`, () => {
    const input = freeze(config(count, 1234)), before = JSON.stringify(input);
    const schedule = createOfficialGroupSchedule(input);
    assert.equal(schedule.series.length, pairs);
    assert.equal(schedule.games.length, pairs * 2);
    assert.equal(new Set(schedule.games.map((g) => g.id)).size, pairs * 2);
    const seen = new Set();
    for (const group of schedule.groups) {
      assert.equal(schedule.series.filter((s) => s.groupName === group.name).length,
        group.participantIds.length * (group.participantIds.length - 1) / 2);
    }
    for (const pair of schedule.series) {
      const key = [...pair.participantIds].sort().join(':');
      assert.ok(!seen.has(key)); seen.add(key);
      const [a, b] = pair.gameIds.map((id) => schedule.games.find((g) => g.id === id));
      assert.equal(a.redParticipantId, b.blueParticipantId);
      assert.equal(a.blueParticipantId, b.redParticipantId);
      assert.equal(a.seed, b.seed); assert.equal(a.mapHash, b.mapHash);
      assert.equal(a.mapPackVersion, b.mapPackVersion);
      assert.ok(Number.isInteger(a.seed) && a.seed >= 0 && a.seed <= 0xffffffff);
    }
    assert.deepEqual(schedule, createOfficialGroupSchedule({ ...input, participantIds: [...input.participantIds].reverse() }));
    assert.equal(JSON.stringify(input), before);
    const results = freeze(schedule.games.map((g) => ({ gameId: g.id, result: 'draw' })));
    const table = computeOfficialGroupStandings({ ...input, results });
    assert.equal(table.complete, true);
    for (const group of table.groups) for (const row of group.rows) {
      assert.equal(row.seriesPlayed, group.rows.length - 1);
      assert.equal(row.seriesPoints, row.seriesPlayed);
      assert.equal(row.gamesPlayed, row.seriesPlayed * 2);
      assert.equal(row.gamePoints, row.seriesPlayed);
    }
    assert.deepEqual(table, computeOfficialGroupStandings({ ...input, participantIds: [...input.participantIds].reverse(), results: [...results].reverse() }));
  });
}

test('K1 thresholds and balanced groups; under 4 and over 56 fail closed', () => {
  for (const [count, groups] of [[4, 1], [7, 1], [8, 2], [15, 2], [16, 4], [31, 4], [32, 8], [56, 8]]) {
    const schedule = createOfficialGroupSchedule(config(count));
    assert.equal(schedule.groups.length, groups);
    const sizes = schedule.groups.map((g) => g.participantIds.length);
    assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1);
    assert.deepEqual(schedule.groups.flatMap((g) => g.participantIds).sort(), ids(count));
  }
  for (const count of [0, 3, 57]) assert.throws(() => createOfficialGroupSchedule(config(count)));
});

test('K1 separates 1/.5/0 game points and 3/1/0 pair points, including split wins', () => {
  const f = fixture(), [a, b, c, d] = ids(4);
  f.pair(a, b, [1, 0.5]); f.pair(a, c, [1, 0]); f.pair(a, d, [0.5, 0.5]);
  const row = f.standings().groups[0].rows.find((r) => r.participantId === a);
  assert.equal(row.gamePoints, 3.5); assert.equal(row.seriesPoints, 5);
  assert.equal(row.seriesWon, 1); assert.equal(row.seriesDrawn, 2);
  assert.equal(row.gamesWon, 2); assert.equal(row.gamesDrawn, 3); assert.equal(row.gamesLost, 1);
});

test('K1 partial pairs count game points but do not award pair points', () => {
  const input = config(), game = createOfficialGroupSchedule(input).games[0];
  const table = computeOfficialGroupStandings({ ...input, results: [{ gameId: game.id, result: 'red_win' }] });
  assert.equal(table.complete, false); assert.equal(table.series.finished, 0);
  const row = table.groups[0].rows.find((r) => r.participantId === game.redParticipantId);
  assert.equal(row.gamePoints, 1); assert.equal(row.seriesPoints, 0); assert.equal(row.seriesPlayed, 0);
});

test('K1 direct mini-table points precede total game points', () => {
  const f = fixture(), [a, b, c, d] = ids(4);
  f.pair(a, b, [1, 0.5]); f.pair(a, c, [0, 0]); f.pair(a, d, [0, 0]);
  f.pair(b, c, [1, 1]); f.pair(b, d, [0, 0]); f.pair(c, d, [1, 1]);
  const rows = f.standings().groups[0].rows;
  assert.deepEqual(rows.map((r) => r.participantId), [c, d, a, b]);
  assert.ok(rows[2].gamePoints < rows[3].gamePoints);
  assert.equal(rows[2].miniSeriesPoints, 3); assert.equal(rows[3].miniSeriesPoints, 0);
});

test('K1 three-way cycle: total game points before mini game points; original tie is retained', () => {
  const f = fixture(), [a, b, c, d] = ids(4);
  f.pair(a, b, [1, 0.5]); f.pair(b, c, [1, 1]); f.pair(c, a, [1, 0.5]);
  f.pair(a, d, [1, 1]); f.pair(b, d, [1, 0.5]); f.pair(c, d, [1, 1]);
  const rows = f.standings().groups[0].rows;
  assert.deepEqual(rows.map((r) => r.participantId), [b, a, c, d]);
  for (const row of rows.slice(0, 3)) {
    assert.equal(row.seriesPoints, 6); assert.equal(row.miniSeriesPoints, 3);
    assert.deepEqual(row.tieParticipantIds, [a, b, c]);
  }
  // A/B both have 4 total game points. Original mini game points pick B (2.5 > 2),
  // despite A beating B directly: recursively rebuilding the A/B mini-table is wrong.
  assert.equal(rows[0].gamePoints, 4); assert.equal(rows[1].gamePoints, 4);
  assert.equal(rows[0].miniGamePoints, 2.5); assert.equal(rows[1].miniGamePoints, 2);
});

test('K1 final tie is a reproducible seeded draw, not registration order or ambient RNG', () => {
  const input = config(7, 0), saved = Math.random;
  Math.random = () => { throw new Error('Ambient randomness forbidden'); };
  try {
    const table = computeOfficialGroupStandings(input);
    assert.deepEqual(table.groups[0].rows.map((r) => r.participantId), table.tieDrawOrder);
    assert.notDeepEqual(table.tieDrawOrder, computeOfficialGroupStandings(config(7, 1)).tieDrawOrder);
    assert.deepEqual(table, computeOfficialGroupStandings(freeze({ ...input, participantIds: [...input.participantIds].reverse() })));
  } finally { Math.random = saved; }
});

test('K1 rejects corrupt seeds, roster, map identity and terminal records without mutating input', () => {
  const input = config(), gameId = createOfficialGroupSchedule(input).games[0].id;
  for (const seed of [-1, 1.5, NaN, 0x100000000]) assert.throws(() => createOfficialGroupSchedule({ ...input, seed }));
  assert.throws(() => createOfficialGroupSchedule({ ...input, participantIds: ['a', 'a', 'b', 'c'] }));
  for (const mapHash of ['', 'latest', null]) assert.throws(() => createOfficialGroupSchedule({ ...input, mapHash }));
  assert.throws(() => createOfficialGroupSchedule({ ...input, mapPackVersion: ' ' }));
  for (const results of [null, [{ gameId: 'foreign', result: 'draw' }], [{ gameId, result: 'infrastructure' }],
    [{ gameId, result: 'draw' }, { gameId, result: 'draw' }]]) {
    assert.throws(() => computeOfficialGroupStandings({ ...input, results }));
  }
  const frozen = freeze({ ...input, results: [{ gameId, result: 'draw' }] }), before = JSON.stringify(frozen);
  const table = computeOfficialGroupStandings(frozen);
  table.groups[0].rows[0].tieParticipantIds.push('unrelated');
  assert.equal(JSON.stringify(frozen), before);
});