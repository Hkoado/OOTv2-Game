/** K2 pure knockout/ticket contracts. Not wired to the MVP queue or public API. */
import { drawCompetition } from '../../src/game/competition.js';
import { deriveSeed } from '../judge/rng.js';
import { assignNextOfficialGameColor } from './officialColors.js';

/** Call for one pinned series/round. Extra games still require the existing tie gate. */
export function nextOfficialKnockoutGame({ series, results = [], includeExtra = false }) {
  if (includeExtra) {
    const pinned = (games) => games.map((game) => {
      const record = results.find((r) => r.gameId === game.id);
      return record ? { ...game, redParticipantId: record.redParticipantId, blueParticipantId: record.blueParticipantId } : game;
    });
    const outcome = resolveOfficialKnockoutSeries({ series: { ...series, mainGames: pinned(series.mainGames), extraGames: pinned(series.extraGames) }, results });
    if (outcome.reason !== 'extra_pending' && !series.extraGames.every((game) => results.some((r) => r.gameId === game.id))) {
      throw new Error('Extra games require tied completed main');
    }
  }
  return assignNextOfficialGameColor({ games: [...series.mainGames, ...(includeExtra ? series.extraGames : [])],
    results, roundId: series.stage, seed: series.seed });
}

export const OFFICIAL_BRACKET_VERSION = 'campus-bracket.v1';
const text = (value) => typeof value === 'string' && value.trim().length > 0;
function requireSeed(seed) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('Seed must be uint32');
}
function requireIds(ids) {
  if (!Array.isArray(ids) || ids.some((id) => !text(id)) || new Set(ids).size !== ids.length) throw new Error('Invalid participant IDs');
}
const compareText = (a, b) => a < b ? -1 : a > b ? 1 : 0;

/** Exact cross-products, even when products exceed Number.MAX_SAFE_INTEGER. */
export function compareOfficialFractions(aNumerator, aDenominator, bNumerator, bDenominator) {
  if (![aNumerator, aDenominator, bNumerator, bDenominator].every(Number.isSafeInteger)
    || aNumerator < 0 || bNumerator < 0 || aDenominator <= 0 || bDenominator <= 0) throw new Error('Invalid fraction');
  const difference = BigInt(aNumerator) * BigInt(bDenominator) - BigInt(bNumerator) * BigInt(aDenominator);
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}
function gameUnits(points) {
  if (!Number.isSafeInteger(points * 2) || points < 0) throw new Error('Invalid game points');
  return points * 2;
}
function requireStats(row) {
  if (!Number.isSafeInteger(row.seriesPlayed) || row.seriesPlayed <= 0
    || !Number.isSafeInteger(row.seriesPoints) || row.seriesPoints < 0 || row.seriesPoints > 3 * row.seriesPlayed
    || !Number.isSafeInteger(row.gamesPlayed) || row.gamesPlayed !== row.seriesPlayed * 2
    || gameUnits(row.gamePoints) > row.gamesPlayed * 2) throw new Error('Invalid completed qualifier stats');
}
function drawRanks(ids, seed, key) {
  requireSeed(seed); requireIds(ids);
  const order = drawCompetition(ids, deriveSeed(seed, OFFICIAL_BRACKET_VERSION, key)).drawOrder;
  return { order, ranks: new Map(order.map((id, i) => [id, i + 1])) };
}

export function seedOfficialQualifiers(standings, seed) {
  if (!standings?.complete || !Array.isArray(standings.groups)
    || ![1, 2, 4, 8].includes(standings.groups.length)) throw new Error('Qualifier is not complete');
  const allIds = [], names = new Set(), candidates = [];
  for (const group of standings.groups) {
    if (!group.complete || !text(group.name) || names.has(group.name) || !Array.isArray(group.rows)
      || group.rows.length < 4 || group.rows.length > 8) throw new Error('Invalid completed group');
    names.add(group.name);
    const ordered = [...group.rows].sort((a, b) => a.rank - b.rank);
    ordered.forEach((row, i) => {
      if (row.rank !== i + 1 || row.seriesPlayed !== ordered.length - 1) throw new Error('Invalid group rank');
      requireStats(row); allIds.push(row.participantId);
    });
    const take = standings.groups.length === 1 ? 4 : 2;
    candidates.push(...ordered.slice(0, take).map((row) => ({ ...row, groupName: group.name })));
  }
  requireIds(allIds);
  const draw = drawRanks(candidates.map((row) => row.participantId), seed, 'qualifier-seeds');
  candidates.sort((a, b) => a.rank - b.rank
    || -compareOfficialFractions(a.seriesPoints, 3 * a.seriesPlayed, b.seriesPoints, 3 * b.seriesPlayed)
    || -compareOfficialFractions(gameUnits(a.gamePoints), 2 * a.gamesPlayed, gameUnits(b.gamePoints), 2 * b.gamesPlayed)
    || draw.ranks.get(a.participantId) - draw.ranks.get(b.participantId));
  return { schemaVersion: OFFICIAL_BRACKET_VERSION, seed, drawOrder: draw.order,
    entrants: candidates.map((row, i) => ({ ...row, seed: i + 1 })) };
}

/** Each ticket must carry actual rank/stats, not the nominal slot it replaced. */
export function seedOfficialTicketHolders(tickets, seed) {
  if (!Array.isArray(tickets) || !tickets.length || tickets.length > 56) throw new Error('Invalid tickets');
  const best = new Map();
  for (const ticket of tickets) {
    if (!text(ticket.participantId) || !text(ticket.eventId) || !Number.isSafeInteger(ticket.rank) || ticket.rank < 1
      || !Number.isSafeInteger(ticket.gamesPlayed) || ticket.gamesPlayed <= 0
      || gameUnits(ticket.gamePoints) > 2 * ticket.gamesPlayed) throw new Error('Invalid ticket achievement');
    const previous = best.get(ticket.participantId);
    const compare = previous ? ticket.rank - previous.rank
      || -compareOfficialFractions(gameUnits(ticket.gamePoints), ticket.gamesPlayed, gameUnits(previous.gamePoints), previous.gamesPlayed)
      || compareText(ticket.eventId, previous.eventId) : -1;
    if (compare < 0) best.set(ticket.participantId, { ...ticket });
  }
  const draw = drawRanks([...best.keys()], seed, 'ticket-seeds');
  const entrants = [...best.values()].sort((a, b) => a.rank - b.rank
    || -compareOfficialFractions(gameUnits(a.gamePoints), a.gamesPlayed, gameUnits(b.gamePoints), b.gamesPlayed)
    || draw.ranks.get(a.participantId) - draw.ranks.get(b.participantId));
  return { schemaVersion: OFFICIAL_BRACKET_VERSION, seed, drawOrder: draw.order,
    entrants: entrants.map((row, i) => ({ ...row, groupName: null, seed: i + 1 })) };
}

/** Memoized assignment: minimum displacement first; numeric lexicographic tie-break. */
function opponentPermutation(entrants, avoidSameGroup) {
  const size = entrants.length, half = size / 2, memo = new Map();
  function solve(slot, used) {
    if (slot === half) return { cost: 0, permutation: [] };
    if (memo.has(used)) return memo.get(used);
    const originalSeed = half + 1 + slot, opponent = entrants[size - originalSeed];
    let best = null;
    for (let i = 0; i < half; i++) {
      if (used & (1 << i)) continue;
      const candidate = entrants[half + i];
      if (avoidSameGroup && opponent.groupName && opponent.groupName === candidate.groupName) continue;
      const tail = solve(slot + 1, used | (1 << i));
      if (!tail) continue;
      const next = { cost: Math.abs(candidate.seed - originalSeed) + tail.cost, permutation: [candidate.seed, ...tail.permutation] };
      // Candidates are visited by ascending seed: first minimum is lexicographically smallest.
      if (!best || next.cost < best.cost) best = next;
    }
    memo.set(used, best);
    return best;
  }
  const result = solve(0, 0);
  if (!result) throw new Error('No valid first-round permutation');
  return result;
}

export function createOfficialBracket({ entrants, level = 'weekly', monthsPerSemester = 4 }) {
  if (!Array.isArray(entrants) || ![4, 6, 8, 16].includes(entrants.length)) throw new Error('Invalid bracket size');
  requireIds(entrants.map((row) => row.participantId));
  if (!['weekly', 'monthly', 'semester'].includes(level)) throw new Error('Invalid event level');
  const sorted = [...entrants].sort((a, b) => a.seed - b.seed).map((row) => ({ ...row }));
  if (sorted.some((row, i) => row.seed !== i + 1)) throw new Error('Seeds must be contiguous');
  const six = sorted.length === 6;
  if ((six && !(level === 'semester' && monthsPerSemester === 3))
    || (level !== 'weekly' && ![6, 8].includes(sorted.length))) throw new Error('Six teams require a three-month semester');
  // Single-group Top 4 necessarily rematches: the avoidance rule only applies across groups.
  const groupNames = new Set(sorted.map((row) => row.groupName).filter(Boolean));
  if (level === 'weekly' && (groupNames.size === 0 || sorted.some((row) => !text(row.groupName)))) throw new Error('Missing qualifier group');
  const size = six ? 8 : sorted.length;
  const assignment = six ? { cost: 0, permutation: [5, 6, 7, 8] }
    : opponentPermutation(sorted, level === 'weekly' && groupNames.size > 1);
  let positions = [1, 2];
  for (let n = 4; n <= size; n *= 2) positions = positions.flatMap((seed) => [seed, n + 1 - seed]);
  const slots = positions.map((slotSeed) => {
    const entrantSeed = slotSeed <= size / 2 ? slotSeed : assignment.permutation[slotSeed - size / 2 - 1];
    const entrant = sorted[entrantSeed - 1];
    return { slotSeed, entrant: entrant ? { ...entrant } : null };
  });
  const rounds = [];
  let sources = slots.map((slot) => ({ kind: 'participant', participantId: slot.entrant?.participantId ?? null }));
  for (let width = size; width >= 2; width /= 2) {
    const stage = width === 2 ? 'final' : width === 4 ? 'semifinal' : width === 8 ? 'quarterfinal' : 'round16';
    const matches = Array.from({ length: width / 2 }, (_, i) => ({
      id: `${stage}:${i + 1}`, stage, sources: sources.slice(i * 2, i * 2 + 2),
    }));
    rounds.push({ stage, matches });
    sources = matches.map((match) => ({ kind: 'winner', matchId: match.id }));
  }
  const semis = rounds.find((round) => round.stage === 'semifinal').matches;
  return { schemaVersion: OFFICIAL_BRACKET_VERSION, size, entrants: sorted, permutation: assignment.permutation,
    displacement: assignment.cost, slots, rounds,
    thirdPlace: { id: 'third_place:1', stage: 'third_place', sources: semis.map((match) => ({ kind: 'loser', matchId: match.id })) } };
}

function requireMapIdentity(value) {
  if (!value || !/^[a-f0-9]{64}$/.test(value.mapHash) || !text(value.mapPackVersion)) throw new Error('Invalid map identity');
}
export function createOfficialKnockoutSeries({ id, stage, entrants, seed, primaryMap, reserveMap }) {
  requireSeed(seed); requireMapIdentity(primaryMap); requireMapIdentity(reserveMap);
  if (!text(id) || !['round16', 'quarterfinal', 'semifinal', 'final', 'third_place'].includes(stage)
    || !Array.isArray(entrants) || entrants.length !== 2) throw new Error('Invalid series');
  const active = entrants.filter((row) => row !== null);
  requireIds(active.map((row) => row.participantId));
  if (active.some((row) => !Number.isSafeInteger(row.seed) || row.seed < 1)
    || (active.length === 2 && active[0].seed === active[1].seed)) throw new Error('Invalid entrant seed');
  const mainCount = stage === 'final' ? 6 : 4;
  function games(count, phase, map) {
    if (active.length < 2) return [];
    return Array.from({ length: count }, (_, i) => {
      const block = Math.floor(i / 2), redIndex = (block + i % 2) % 2;
      return { id: `${id}:${phase}:${i + 1}`, gameNo: i + 1, phase, block: block + 1,
        redParticipantId: entrants[redIndex].participantId, blueParticipantId: entrants[1 - redIndex].participantId,
        seed: deriveSeed(seed, OFFICIAL_BRACKET_VERSION, id, phase, block + 1),
        mapHash: map.mapHash, mapPackVersion: map.mapPackVersion };
    });
  }
  return { schemaVersion: OFFICIAL_BRACKET_VERSION, id, stage, seed,
    entrants: entrants.map((row) => row ? { ...row } : null),
    mainGames: games(mainCount, 'main', primaryMap), extraGames: games(2, 'extra', reserveMap) };
}

/** No early stop. extraGames is a conditional plan, never enqueue it before tied main. */
export function resolveOfficialKnockoutSeries({ series, results = [], withdrawnIds = [], disqualifiedIds = [], colorPolicy = null }) {
  if (colorPolicy === 'alternate-loss-priority.v1') {
    const games = [...series.mainGames, ...series.extraGames], prefix = [];
    const pinned = new Map();
    for (const game of games) {
      const record = results.find((r) => r.gameId === game.id);
      if (!record) break;
      const assigned = assignNextOfficialGameColor({ games, results: prefix, roundId: series.stage, seed: series.seed });
      if (record.redParticipantId !== assigned.redParticipantId || record.blueParticipantId !== assigned.blueParticipantId) throw new Error('Invalid pinned colors');
      pinned.set(game.id, { ...game, redParticipantId: assigned.redParticipantId, blueParticipantId: assigned.blueParticipantId });
      prefix.push(record);
    }
    if (prefix.length !== results.length) throw new Error('Results must be a completed prefix');
    series = { ...series, mainGames: series.mainGames.map((g) => pinned.get(g.id) || g), extraGames: series.extraGames.map((g) => pinned.get(g.id) || g) };
  } else if (colorPolicy !== null) throw new Error('Unsupported color policy');
  requireIds(withdrawnIds); requireIds(disqualifiedIds);
  if (!Array.isArray(results)) throw new Error('Invalid results');
  const sides = series.entrants.filter(Boolean), ids = sides.map((row) => row.participantId);
  if ([...withdrawnIds, ...disqualifiedIds].some((id) => !ids.includes(id))) throw new Error('Foreign administrative decision');
  const plans = [...series.mainGames, ...series.extraGames], byId = new Map(plans.map((game) => [game.id, game]));
  const accepted = new Map();
  for (const record of results) {
    if (!record || !byId.has(record.gameId) || accepted.has(record.gameId)
      || !['red_win', 'blue_win', 'draw'].includes(record.result)) throw new Error('Invalid or duplicate game result');
    accepted.set(record.gameId, record.result);
  }
  const eligible = sides.filter((row) => !withdrawnIds.includes(row.participantId) && !disqualifiedIds.includes(row.participantId));
  if (eligible.length < 2) return {
    complete: true, reason: eligible.length === 0 ? 'double_absence' : sides.length < 2 ? 'bye' : 'walkover',
    winnerParticipantId: eligible[0]?.participantId ?? null, loserParticipantId: null,
    administrative: true, gamesPlayed: accepted.size, points: null, nextGames: [],
  };
  function tally(games) {
    const points = Object.fromEntries(ids.map((id) => [id, 0]));
    for (const game of games) {
      const result = accepted.get(game.id);
      if (!result) continue;
      if (result === 'draw') for (const id of ids) points[id] += 0.5;
      else points[result === 'red_win' ? game.redParticipantId : game.blueParticipantId]++;
    }
    return points;
  }
  const mainComplete = series.mainGames.every((game) => accepted.has(game.id));
  const main = tally(series.mainGames), mainTied = main[ids[0]] === main[ids[1]];
  const hasExtra = series.extraGames.some((game) => accepted.has(game.id));
  if (hasExtra && (!mainComplete || !mainTied)) throw new Error('Extra games require tied completed main');
  const needsExtra = mainComplete && mainTied;
  const required = needsExtra ? plans : series.mainGames;
  const complete = mainComplete && (!needsExtra || series.extraGames.every((game) => accepted.has(game.id)));
  const points = tally(required);
  const winner = complete ? [...sides].sort((a, b) => points[b.participantId] - points[a.participantId] || a.seed - b.seed)[0] : null;
  return { complete, reason: !complete ? needsExtra ? 'extra_pending' : 'main_pending'
    : points[ids[0]] === points[ids[1]] ? 'seed' : 'score',
    winnerParticipantId: winner?.participantId ?? null,
    loserParticipantId: winner ? ids.find((id) => id !== winner.participantId) : null,
    administrative: false, gamesPlayed: accepted.size, points,
    nextGames: complete ? [] : required.filter((game) => !accepted.has(game.id)).map((game) => ({ ...game })) };
}

/** Resolve a fixed edge; a completed double-DQ propagates null, not a fabricated winner. */
export function officialBracketEntrants(match, outcomes, entrants) {
  const byId = new Map(entrants.map((row) => [row.participantId, row]));
  return match.sources.map((source) => {
    let id;
    if (source.kind === 'participant') id = source.participantId;
    else {
      if (!['winner', 'loser'].includes(source.kind) || !Object.hasOwn(outcomes, source.matchId)
        || !outcomes[source.matchId].complete) throw new Error('Previous round incomplete');
      id = outcomes[source.matchId][source.kind === 'winner' ? 'winnerParticipantId' : 'loserParticipantId'];
    }
    if (id === null) return null;
    if (!byId.has(id)) throw new Error('Unknown bracket participant');
    return { ...byId.get(id) };
  });
}

export function allocateOfficialTickets({ ranking, existingHolderIds = [], withdrawnIds = [], count = 2 }) {
  if (!Array.isArray(ranking) || !Number.isSafeInteger(count) || count < 0) throw new Error('Invalid ticket allocation');
  requireIds(existingHolderIds); requireIds(withdrawnIds); requireIds(ranking.map((row) => row.participantId));
  const ordered = [...ranking].sort((a, b) => a.rank - b.rank);
  if (ordered.some((row, i) => row.rank !== i + 1)) throw new Error('Invalid full ranking');
  const excluded = new Set([...existingHolderIds, ...withdrawnIds]);
  const eligible = ordered.filter((row) => !excluded.has(row.participantId));
  return { awarded: eligible.slice(0, count).map((row) => ({ ...row })),
    reserves: eligible.slice(count).map((row) => ({ ...row })), vacant: Math.max(0, count - eligible.length) };
}

/** Administrative non-finishers cannot receive tickets without a referee ranking decision. */
export function rankOfficialKnockout({ bracket, outcomes }) {
  const requireOutcome = (match) => {
    if (!Object.hasOwn(outcomes, match.id) || !outcomes[match.id].complete) throw new Error('Bracket incomplete');
    return outcomes[match.id];
  };
  const final = requireOutcome(bracket.rounds.at(-1).matches[0]), third = requireOutcome(bracket.thirdPlace);
  const byId = new Map(bracket.entrants.map((row) => [row.participantId, row]));
  const order = [final.winnerParticipantId, final.loserParticipantId, third.winnerParticipantId, third.loserParticipantId].filter(Boolean);
  for (const round of [...bracket.rounds].reverse().slice(2)) {
    const losers = round.matches.map(requireOutcome).map((outcome) => outcome.loserParticipantId).filter(Boolean);
    if (losers.some((id) => !byId.has(id))) throw new Error('Unknown loser');
    losers.sort((a, b) => byId.get(a).seed - byId.get(b).seed);
    order.push(...losers);
  }
  requireIds(order);
  if (order.some((id) => !byId.has(id))) throw new Error('Unknown finalist');
  const unranked = bracket.entrants.filter((row) => !order.includes(row.participantId)).map((row) => ({ ...row }));
  return { complete: unranked.length === 0,
    ranking: order.map((id, index) => ({ ...byId.get(id), rank: index + 1 })), unranked };
}