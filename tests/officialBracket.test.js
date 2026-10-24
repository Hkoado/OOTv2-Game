import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compareOfficialFractions, seedOfficialQualifiers, seedOfficialTicketHolders, createOfficialBracket,
  createOfficialKnockoutSeries, resolveOfficialKnockoutSeries, officialBracketEntrants,
  allocateOfficialTickets, rankOfficialKnockout,
} from '../server/lib/officialBracket.js';
import { createOfficialGroupSchedule, computeOfficialGroupStandings } from '../server/lib/officialGroups.js';
import { createOfficialRoundSnapshot, verifyOfficialRoundSnapshot } from '../server/contracts/officialSnapshot.js';
import { EMPTY_MAP } from '../src/game/maps.js';

const entrants = (count = 8) => Array.from({ length: count }, (_, i) => ({ participantId: `t${i + 1}`, seed: i + 1,
  groupName: String.fromCharCode(65 + i % (count / 2)) }));
const map = { mapHash: 'a'.repeat(64), mapPackVersion: 'w1' };
const series = (stage = 'quarterfinal', sides = entrants().slice(0, 2)) => createOfficialKnockoutSeries({ id: 'test:1', stage,
  entrants: sides, seed: 0, primaryMap: map, reserveMap: { ...map, mapHash: 'b'.repeat(64) } });
const results = (games, winner = null) => games.map((game) => ({ gameId: game.id,
  result: winner === null ? 'draw' : winner === game.redParticipantId ? 'red_win' : 'blue_win' }));

test('K2 exact fraction cross-products and invalid denominators', () => {
  const n = Number.MAX_SAFE_INTEGER;
  assert.equal(compareOfficialFractions(n - 1, n, n - 2, n - 1), 1);
  assert.equal(compareOfficialFractions(2, 3, 4, 6), 0);
  assert.throws(() => compareOfficialFractions(1, 0, 1, 2));
});

for (const count of [4, 7, 8, 15, 16, 31, 32, 35, 40, 48, 50, 56]) {
  test(`K2 complete ${count}-team qualifier seeds/bracket preserve winners first and fixed edges`, () => {
    const config = { participantIds: Array.from({ length: count }, (_, i) => `team-${i}`), seed: 0, ...map };
    const schedule = createOfficialGroupSchedule(config);
    const table = computeOfficialGroupStandings({ ...config, results: results(schedule.games) });
    const seeds = seedOfficialQualifiers(table, 123);
    assert.deepEqual(seeds, seedOfficialQualifiers(structuredClone(table), 123));
    assert.ok(seeds.entrants.every((row, i, rows) => i === 0 || rows[i - 1].rank <= row.rank));
    const bracket = createOfficialBracket(seeds);
    assert.equal(bracket.slots.length, seeds.entrants.length);
    assert.equal(bracket.rounds.at(-1).stage, 'final');
    assert.equal(bracket.thirdPlace.sources.length, 2);
    for (const match of bracket.rounds[0].matches) {
      const sides = officialBracketEntrants(match, {}, bracket.entrants);
      if (table.groups.length > 1) assert.notEqual(sides[0].groupName, sides[1].groupName);
    }
    assert.ok(bracket.rounds.slice(1).every((r) => r.matches.every((m) => m.sources.every((s) => s.kind === 'winner'))));
  });
}

test('K2 seed ratios outrank raw totals; incomplete qualifier rejected', () => {
  const row = (id, rank, played, points, gamePoints) => ({ participantId: id, rank, seriesPlayed: played,
    seriesPoints: points, gamesPlayed: played * 2, gamePoints });
  const group = (name, n, points) => ({ name, complete: true, rows: Array.from({ length: n }, (_, i) =>
    row(`${name}${i}`, i + 1, n - 1, points, n - 1)) });
  const table = { complete: true, groups: [group('A', 4, 9), group('B', 5, 10)] };
  assert.equal(seedOfficialQualifiers(table, 0).entrants[0].participantId, 'A0');
  assert.throws(() => seedOfficialQualifiers({ ...table, complete: false }, 0));
});

test('K2 permutation minimizes total displacement then numeric lexicographic order', () => {
  const sides = entrants(8), bracket = createOfficialBracket({ entrants: sides });
  const permutations = (arr) => arr.length ? arr.flatMap((item) => permutations(arr.filter((n) => n !== item)).map((tail) => [item, ...tail])) : [[]];
  const valid = permutations([5, 6, 7, 8]).filter((p) => p.every((seed, i) => sides[seed - 1].groupName !== sides[3 - i].groupName));
  const cost = (p) => p.reduce((sum, seed, i) => sum + Math.abs(seed - (5 + i)), 0);
  valid.sort((a, b) => cost(a) - cost(b) || a.find((n, i) => n !== b[i]) - b[a.findIndex((n, i) => n !== b[i])]);
  assert.deepEqual(bracket.permutation, valid[0]);
  assert.equal(bracket.displacement, cost(valid[0]));
  assert.throws(() => createOfficialBracket({ entrants: sides.map((e, i) => ({ ...e, groupName: i === 0 ? 'B' : 'A' })) }));
});

test('K2 six-team three-month semester has exactly two byes for seeds 1/2 and no fake games', () => {
  const bracket = createOfficialBracket({ entrants: entrants(6), level: 'semester', monthsPerSemester: 3 });
  const byes = [];
  for (const match of bracket.rounds[0].matches) {
    const sides = officialBracketEntrants(match, {}, bracket.entrants);
    const planned = series('quarterfinal', sides);
    if (sides.includes(null)) {
      byes.push(sides.find(Boolean).seed);
      assert.equal(planned.mainGames.length, 0); assert.equal(planned.extraGames.length, 0);
      assert.equal(resolveOfficialKnockoutSeries({ series: planned }).reason, 'bye');
    }
  }
  assert.deepEqual(byes.sort(), [1, 2]);
  assert.throws(() => createOfficialBracket({ entrants: entrants(6), level: 'monthly' }));
});

test('K2 main 4/final 6, alternating blocks, reserve extra exactly two, no early stop', () => {
  for (const stage of ['round16', 'quarterfinal', 'semifinal', 'third_place', 'final']) {
    const planned = series(stage), count = stage === 'final' ? 6 : 4;
    assert.equal(planned.mainGames.length, count); assert.equal(planned.extraGames.length, 2);
    for (let i = 0; i < count; i += 2) {
      assert.equal(planned.mainGames[i].redParticipantId, planned.mainGames[i + 1].blueParticipantId);
      assert.equal(planned.mainGames[i].seed, planned.mainGames[i + 1].seed);
      if (i > 0) assert.notEqual(planned.mainGames[i].redParticipantId, planned.mainGames[i - 2].redParticipantId);
    }
    let outcome = resolveOfficialKnockoutSeries({ series: planned, results: results(planned.mainGames.slice(0, count - 1), 't1') });
    assert.equal(outcome.complete, false);
    outcome = resolveOfficialKnockoutSeries({ series: planned, results: results(planned.mainGames) });
    assert.equal(outcome.reason, 'extra_pending'); assert.equal(outcome.nextGames.length, 2);
    assert.ok(outcome.nextGames.every((g) => g.mapHash === 'b'.repeat(64)));
    outcome = resolveOfficialKnockoutSeries({ series: planned, results: results([...planned.mainGames, ...planned.extraGames]) });
    assert.equal(outcome.reason, 'seed'); assert.equal(outcome.winnerParticipantId, 't1');
    const upset = resolveOfficialKnockoutSeries({ series: planned,
      results: [...results(planned.mainGames), ...results(planned.extraGames, 't2')] });
    assert.equal(upset.winnerParticipantId, 't2');
    assert.throws(() => resolveOfficialKnockoutSeries({ series: planned, results: results(planned.extraGames) }));
  }
});

test('K2 walkover/double-DQ propagate administrative outcomes, not invented game points', () => {
  const planned = series();
  const walkover = resolveOfficialKnockoutSeries({ series: planned, withdrawnIds: ['t1'] });
  assert.equal(walkover.winnerParticipantId, 't2'); assert.equal(walkover.points, null); assert.equal(walkover.gamesPlayed, 0);
  const dq = resolveOfficialKnockoutSeries({ series: planned, disqualifiedIds: ['t1', 't2'] });
  assert.equal(dq.winnerParticipantId, null); assert.equal(dq.gamesPlayed, 0);
  const match = { sources: [{ kind: 'winner', matchId: 'dq' }, { kind: 'participant', participantId: 't3' }] };
  assert.deepEqual(officialBracketEntrants(match, { dq }, entrants()), [null, entrants()[2]]);
  assert.throws(() => officialBracketEntrants(match, {}, entrants()));
});

test('K2 fixed bracket completes third place, ranks early losses by original seed, no duplicate tickets', () => {
  const bracket = createOfficialBracket({ entrants: entrants(16) }), outcomes = {};
  for (const round of bracket.rounds) for (const match of round.matches) {
    const sides = officialBracketEntrants(match, outcomes, bracket.entrants);
    const planned = createOfficialKnockoutSeries({ id: match.id, stage: match.stage, entrants: sides, seed: 0, primaryMap: map, reserveMap: map });
    outcomes[match.id] = resolveOfficialKnockoutSeries({ series: planned, results: results(planned.mainGames, sides[0].participantId) });
  }
  const thirdSides = officialBracketEntrants(bracket.thirdPlace, outcomes, bracket.entrants);
  const third = series('third_place', thirdSides);
  outcomes[bracket.thirdPlace.id] = resolveOfficialKnockoutSeries({ series: third, results: results(third.mainGames, thirdSides[0].participantId) });
  const ranked = rankOfficialKnockout({ bracket, outcomes });
  assert.equal(ranked.complete, true); assert.equal(ranked.ranking.length, 16);
  for (const [start, end] of [[4, 8], [8, 16]]) {
    const seeds = ranked.ranking.slice(start, end).map((r) => r.seed);
    assert.deepEqual(seeds, [...seeds].sort((a, b) => a - b));
  }
  const awarded = allocateOfficialTickets({ ranking: ranked.ranking, existingHolderIds: ranked.ranking.slice(0, 2).map((r) => r.participantId) });
  assert.deepEqual(awarded.awarded.map((r) => r.rank), [3, 4]);
  assert.equal(allocateOfficialTickets({ ranking: ranked.ranking, existingHolderIds: entrants(16).map((r) => r.participantId) }).vacant, 2);
  assert.throws(() => rankOfficialKnockout({ bracket, outcomes: {} }));
});

test('K2 ticket seeding retains actual transferred rank, best achievement and exact ratio', () => {
  const tickets = [
    { participantId: 'a', eventId: 'w1', rank: 3, gamesPlayed: 4, gamePoints: 4 },
    { participantId: 'b', eventId: 'w1', rank: 2, gamesPlayed: 6, gamePoints: 1 },
    { participantId: 'a', eventId: 'w2', rank: 1, gamesPlayed: 4, gamePoints: 2 },
    { participantId: 'c', eventId: 'w2', rank: 1, gamesPlayed: 6, gamePoints: 4 },
  ];
  const seeded = seedOfficialTicketHolders(tickets, 0);
  assert.deepEqual(seeded.entrants.map((r) => r.participantId), ['c', 'a', 'b']);
  assert.deepEqual(seeded, seedOfficialTicketHolders([...tickets].reverse(), 0));
});

test('K2 snapshot pins round bot SHA/hash/map/runtime and is deeply immutable/tamper evident', () => {
  const config = { eventId: 'e1', roundId: 'quarterfinal', seed: 0, cutoff: '2026-10-24T20:00:00+07:00',
    mapPackVersion: 'w1', primaryMap: structuredClone(EMPTY_MAP), reserveMap: structuredClone(EMPTY_MAP),
    runtime: { rulesVersion: 'ott-campus.v1', protocolVersion: 'bot.v1', runtimeVersion: 'test-only', runtimeHash: 'a'.repeat(64), budgetHash: 'b'.repeat(64) },
    bots: [{ participantId: 'a', submissionId: 's1', artifactKey: 'a.py', sourceKind: 'github', sourceSha256: 'c'.repeat(64),
      repositoryId: '123', commitSha: 'd'.repeat(40), resolvedAt: '2026-10-24T12:00:00Z' }] };
  const snapshot = createOfficialRoundSnapshot(config);
  assert.equal(verifyOfficialRoundSnapshot(snapshot), true);
  assert.throws(() => { snapshot.bots[0].sourceSha256 = 'e'.repeat(64); });
  config.bots[0].submissionId = 'latest'; assert.equal(snapshot.bots[0].submissionId, 's1');
  const changed = structuredClone(snapshot); changed.bots[0].submissionId = 's2';
  assert.equal(verifyOfficialRoundSnapshot(changed), false);
  assert.notEqual(snapshot.contentHash, createOfficialRoundSnapshot({ ...config, roundId: 'final' }).contentHash);
  assert.throws(() => createOfficialRoundSnapshot({ ...config, bots: [{ ...config.bots[0], resolvedAt: '2026-10-25T00:00:00Z' }] }));
  assert.throws(() => createOfficialRoundSnapshot({ ...config, runtime: { ...config.runtime, protocolVersion: 'mvp' } }));
});