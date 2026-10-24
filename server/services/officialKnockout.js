/**
 * K3 knockout/vé: reuse the pure bracket contracts, persist each series as its own
 * official round (same chain/queue/worker as the group stage) and resolve only from
 * accepted results. Nothing here invents a winner, a forfeit or a future color.
 */
import { HttpError } from '../lib/httpError.js';
import { loadOfficialRound, findOfficialRound, openOfficialRound, appendOfficialGame } from '../shared/officialSchedule.js';
import { createOfficialRoundSnapshot } from '../contracts/officialSnapshot.js';
import { seedOfficialQualifiers, createOfficialBracket, createOfficialKnockoutSeries,
  officialBracketEntrants, resolveOfficialKnockoutSeries, rankOfficialKnockout,
  allocateOfficialTickets, nextOfficialKnockoutGame } from '../lib/officialBracket.js';
import { computeOfficialGroupStandings } from '../lib/officialGroups.js';
import { COLOR_POLICY } from '../lib/officialColors.js';
import { officialGameInputHash, enqueueOfficialJob } from '../shared/officialJobs.js';

export const OFFICIAL_KNOCKOUT_VERSION = 'campus-knockout.v1';
const fail = (status, code, message) => new HttpError(status, code, message);
const STAGES = Object.freeze(['round16', 'quarterfinal', 'semifinal', 'third_place', 'final']);

/** Series rounds are named `ko:<stage>:<matchNo>`; stable and inside the DB check. */
export function seriesRoundId(stage, matchId) {
  if (!STAGES.includes(stage)) throw fail(400, 'bad_stage', 'stage knockout không hợp lệ.');
  const match = /^[a-z_]+:(\d{1,2})$/.exec(matchId ?? '');
  if (!match) throw fail(400, 'bad_match', 'matchId không hợp lệ.');
  return `ko:${stage}:${match[1]}`;
}

function acceptedResults(round) {
  return round.games.filter((game) => game.result !== null).map((game) => ({
    gameId: game.gameKey, result: game.result,
    redParticipantId: game.redParticipantId, blueParticipantId: game.blueParticipantId,
  }));
}

function requireGroupComplete(round) {
  const results = acceptedResults(round);
  if (results.length !== round.games.length) throw fail(409, 'group_incomplete', 'Vòng bảng chưa chấm xong.');
  return results;
}

/** Qualifiers + bracket from a completed group round; DTO only. */
export async function knockoutPlan({ groupRoundId, level = 'weekly' } = {},
  { loadRound = loadOfficialRound } = {}) {
  if (!/^[a-f0-9-]{36}$/i.test(groupRoundId ?? '')) throw fail(400, 'bad_round_id', 'groupRoundId không hợp lệ.');
  const round = await loadRound({ roundId: groupRoundId });
  const results = requireGroupComplete(round);
  const rings = computeOfficialGroupStandings({
    participantIds: round.snapshot.bots.map((bot) => bot.participantId), seed: round.snapshot.seed,
    mapHash: round.snapshot.maps.primary.hash, mapPackVersion: round.snapshot.mapPackVersion,
    results, colorPolicy: COLOR_POLICY,
  });
  if (!rings.complete) throw fail(409, 'group_incomplete', 'Vòng bảng chưa đủ kết quả để seed.');
  let seeded;
  let bracket;
  try {
    seeded = seedOfficialQualifiers(rings, round.snapshot.seed);
    bracket = createOfficialBracket({ entrants: seeded.entrants, level });
  } catch (error) {
    throw fail(409, 'bracket_invalid', `Không tạo được nhánh: ${error.message}`);
  }
  return { schemaVersion: OFFICIAL_KNOCKOUT_VERSION, level, bracket, qualifiers: seeded.entrants,
    seed: round.snapshot.seed, groupRoundId };
}

/** Resolves one persisted series, or reports why it is not complete yet. */
export async function knockoutSeriesOutcome({ series, roundId } = {},
  { loadRound = loadOfficialRound } = {}) {
  if (!segmentsValid(series)) throw fail(400, 'bad_series', 'Series không hợp lệ.');
  if (!roundId) return { complete: false, reason: 'not_opened', seriesId: series.id };
  let round;
  try {
    round = await loadRound({ roundId });
  } catch (error) {
    if (error?.code === 'round_not_found') return { complete: false, reason: 'not_opened', seriesId: series.id };
    throw error;
  }
  try {
    return { ...resolveOfficialKnockoutSeries({ series, results: acceptedResults(round), colorPolicy: COLOR_POLICY }),
      seriesId: series.id, roundId };
  } catch (error) {
    throw fail(409, 'series_invalid', `Không giải được series: ${error.message}`);
  }
}

function segmentsValid(series) {
  return series && Array.isArray(series.mainGames) && Array.isArray(series.extraGames)
    && typeof series.id === 'string' && STAGES.includes(series.stage);
}

/** Pins colors per persisted prefix; extra games only after a tied completed main. */
function nextSeriesGame({ series, results }) {
  const main = nextOfficialKnockoutGame({ series, results });
  if (main) return { game: main, phase: 'main' };
  if (!series.mainGames.every((game) => results.some((record) => record.gameId === game.id))) return null;
  try {
    const extra = nextOfficialKnockoutGame({ series, results, includeExtra: true });
    return extra ? { game: extra, phase: 'extra' } : null;
  } catch {
    // Tied gate not satisfied (or already resolved): no extra game is invented.
    return null;
  }
}

function seriesSnapshot(base, roundId, series) {
  const wanted = series.entrants.filter(Boolean).map((row) => row.participantId);
  const bots = wanted.map((participantId) => {
    const bot = base.snapshot.bots.find((entry) => entry.participantId === participantId);
    if (!bot) throw fail(409, 'bot_not_pinned', `Thiếu pin nguồn cho ${participantId}.`);
    return bot;
  });
  if (new Set(wanted).size !== wanted.length || bots.length < 2) {
    throw fail(409, 'series_incomplete', 'Series cần hai đội đã được pin nguồn.');
  }
  return createOfficialRoundSnapshot({
    eventId: base.snapshot.eventId, roundId, seed: base.snapshot.seed, cutoff: base.snapshot.cutoff,
    mapPackVersion: base.snapshot.mapPackVersion,
    primaryMap: base.snapshot.maps.primary.map, reserveMap: base.snapshot.maps.reserve.map,
    runtime: base.snapshot.runtime, bots,
  });
}

/** Opens the series round (idempotent per round id) and publishes its first game. */
export async function openSeriesRound({ baseRound, series } = {},
  { openRound = openOfficialRound, loadRound = loadOfficialRound } = {}) {
  const roundId = seriesRoundId(series.stage, series.id);
  const snapshot = seriesSnapshot(baseRound, roundId, series);
  const opened = await openRound({ snapshot });
  return publishNextSeriesGame({ roundId: opened.roundId ?? roundId, series }, { loadRound });
}

/** Appends/enqueues exactly the next pinned game of one series. */
export async function publishNextSeriesGame({ roundId, series } = {},
  { loadRound = loadOfficialRound, appendGame = appendOfficialGame, enqueue = enqueueOfficialJob } = {}) {
  if (!segmentsValid(series)) throw fail(400, 'bad_series', 'Series không hợp lệ.');
  const round = await loadRound({ roundId });
  if (round.frozen) return { status: 'frozen', roundId, game: null };
  const pending = round.games.find((game) => game.result === null);
  if (pending) {
    const inputHash = officialGameInputHash({ snapshotHash: round.snapshot.contentHash,
      game: pending, runtime: round.snapshot.runtime });
    const job = await enqueue({ roundId, gameKey: pending.gameKey, inputHash });
    return { status: 'pending', roundId, game: { gameKey: pending.gameKey, jobId: job.jobId,
      jobStatus: job.status } };
  }
  const results = acceptedResults(round);
  let picked;
  try {
    picked = nextSeriesGame({ series, results });
  } catch (error) {
    throw fail(409, 'series_invalid', `Không pin được ván kế tiếp: ${error.message}`);
  }
  if (!picked) {
    const resolved = resolveOfficialKnockoutSeries({ series, results, colorPolicy: COLOR_POLICY });
    return { status: resolved.complete ? 'complete' : 'waiting', roundId,
      game: null, outcome: resolved.complete ? resolved : null };
  }
  const game = picked.game;
  const payload = {
    seq: round.games.length + 1, gameKey: game.id, stage: series.stage,
    redParticipantId: game.redParticipantId, blueParticipantId: game.blueParticipantId,
    seed: game.seed, mapSlot: picked.phase === 'extra' ? 'reserve' : 'primary',
    mapHash: game.mapHash, mapPackVersion: game.mapPackVersion, colorPolicy: COLOR_POLICY,
  };
  await appendGame({ roundId, expectedPrefix: round.chainHash, game: payload });
  const persisted = await loadRound({ roundId });
  const appended = persisted.games.find((entry) => entry.gameKey === game.id);
  if (!appended) throw fail(503, 'append_not_visible', 'Ván vừa pin chưa đọc lại được.');
  const inputHash = officialGameInputHash({ snapshotHash: persisted.snapshot.contentHash,
    game: appended, runtime: persisted.snapshot.runtime });
  const job = await enqueue({ roundId, gameKey: appended.gameKey, inputHash });
  return { status: 'published', roundId, game: { gameKey: appended.gameKey, seq: appended.seq,
    mapSlot: appended.mapSlot, jobId: job.jobId, jobStatus: job.status } };
}

function mapIdentities(groupRound) {
  return {
    primaryMap: { mapHash: groupRound.snapshot.maps.primary.hash,
      mapPackVersion: groupRound.snapshot.mapPackVersion },
    reserveMap: { mapHash: groupRound.snapshot.maps.reserve.hash,
      mapPackVersion: groupRound.snapshot.mapPackVersion },
    seed: groupRound.snapshot.seed,
  };
}

function bracketOrder(bracket) {
  return [...bracket.rounds, { stage: 'third_place', matches: [bracket.thirdPlace] }];
}

/**
 * Walks the bracket in order and returns resolved outcomes plus the first series that
 * still needs work. Previous stages must be complete before entrants are derived.
 */
export async function bracketProgress({ groupRoundId, level = 'weekly' } = {},
  { loadRound = loadOfficialRound, findRound = findOfficialRound } = {}) {
  const plan = await knockoutPlan({ groupRoundId, level }, { loadRound });
  const groupRound = await loadRound({ roundId: groupRoundId });
  const maps = mapIdentities(groupRound);
  const outcomes = {};
  let next = null;
  let waiting = null;
  for (const stageInfo of bracketOrder(plan.bracket)) {
    for (const match of stageInfo.matches) {
      let entrants;
      try {
        entrants = officialBracketEntrants(match, outcomes, plan.bracket.entrants);
      } catch (error) {
        waiting = waiting ?? { matchId: match.id, stage: match.stage, reason: error.message };
        continue;
      }
      let series;
      try {
        series = createOfficialKnockoutSeries({ id: match.id, stage: match.stage, entrants,
          seed: plan.seed, primaryMap: maps.primaryMap, reserveMap: maps.reserveMap });
      } catch (error) {
        waiting = waiting ?? { matchId: match.id, stage: match.stage, reason: error.message };
        continue;
      }
      if (entrants.filter(Boolean).length < 2) {
        // Bye/walkover is an administrative outcome from the pure contract, never a fake game.
        outcomes[match.id] = resolveOfficialKnockoutSeries({ series, results: [],
          colorPolicy: COLOR_POLICY });
        continue;
      }
      const roundId = seriesRoundId(match.stage, match.id);
      const found = await findRound({ eventId: groupRound.snapshot.eventId, roundId });
      if (!found) {
        next = next ?? { matchId: match.id, stage: match.stage, series, roundId, opened: false };
        continue;
      }
      const outcome = await knockoutSeriesOutcome({ series, roundId }, { loadRound });
      if (outcome.complete) outcomes[match.id] = outcome;
      else next = next ?? { matchId: match.id, stage: match.stage, series, roundId, opened: true };
    }
  }
  const expected = bracketOrder(plan.bracket).reduce((count, stageInfo) => count + stageInfo.matches.length, 0);
  return { plan, groupRound, maps, outcomes, next, waiting, expected,
    resolved: Object.keys(outcomes).length };
}

/** Opens/publishes the first series that still needs work; never two at a time. */
export async function openNextKnockoutSeries({ groupRoundId, level = 'weekly' } = {},
  { loadRound = loadOfficialRound, findRound = findOfficialRound, openRound = openOfficialRound } = {}) {
  const progress = await bracketProgress({ groupRoundId, level }, { loadRound, findRound });
  if (!progress.next) {
    return { status: progress.waiting ? 'blocked' : 'bracket_complete',
      resolved: progress.resolved, expected: progress.expected, waiting: progress.waiting,
      outcomes: progress.outcomes };
  }
  if (progress.next.opened) {
    const game = await publishNextSeriesGame({ roundId: progress.next.roundId, series: progress.next.series },
      { loadRound });
    return { status: 'advanced', matchId: progress.next.matchId, roundId: progress.next.roundId, game };
  }
  const game = await openSeriesRound({ baseRound: progress.groupRound, series: progress.next.series },
    { openRound, loadRound });
  return { status: 'opened', matchId: progress.next.matchId, roundId: progress.next.roundId,
    seriesId: progress.next.series.id, game };
}

/** Final ranking + vé; unavailable until every bracket series is accepted. */
export async function knockoutTickets({ groupRoundId, level = 'weekly', count = 2,
  existingHolderIds = [], withdrawnIds = [] } = {},
  { loadRound = loadOfficialRound, findRound = findOfficialRound } = {}) {
  const progress = await bracketProgress({ groupRoundId, level }, { loadRound, findRound });
  if (progress.waiting || progress.resolved !== progress.expected) {
    throw fail(409, 'bracket_incomplete', 'Nhánh knockout chưa hoàn tất; không cấp vé trước khi có kết quả.');
  }
  let ranked;
  try {
    ranked = rankOfficialKnockout({ bracket: progress.plan.bracket, outcomes: progress.outcomes });
  } catch (error) {
    throw fail(409, 'bracket_incomplete', `Không xếp hạng được: ${error.message}`);
  }
  if (!ranked.complete) throw fail(409, 'ranking_incomplete', 'Còn đội chưa có thứ hạng chính thức.');
  const tickets = allocateOfficialTickets({ ranking: ranked.ranking,
    existingHolderIds, withdrawnIds, count });
  return { ranking: ranked.ranking, tickets };
}
