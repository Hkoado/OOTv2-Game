/** K1 pure planning/aggregation only. No DB, queue, bot execution or publication. */
import { drawCompetition } from '../../src/game/competition.js';
import { deriveSeed } from '../judge/rng.js';

export const OFFICIAL_GROUPS_VERSION = 'campus-groups.v1';
export const OFFICIAL_GROUP_TIE_BREAKERS = Object.freeze([
  'seriesPoints', 'miniSeriesPoints', 'gamePoints', 'miniGamePoints', 'drawRank',
]);

/** Map identity must be supplied by the caller, never chosen from observed results. */
export function createOfficialGroupSchedule({ participantIds, seed, mapHash, mapPackVersion }) {
  const draw = drawCompetition(participantIds, seed, 'weekly');
  if (!draw.eligible) throw new Error(draw.reason);
  if (typeof mapHash !== 'string' || !/^[a-f0-9]{64}$/.test(mapHash)) throw new Error('Invalid mapHash');
  if (typeof mapPackVersion !== 'string' || !mapPackVersion.trim() || mapPackVersion.length > 80) {
    throw new Error('Invalid mapPackVersion');
  }
  const series = [], games = [];
  for (const group of draw.groups) {
    // Canonical pair identities and colors do not depend on roster selection order.
    const ids = [...group.participantIds].sort();
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const id = `group:${group.name}:${i + 1}-${j + 1}`;
        const pairSeed = deriveSeed(seed, OFFICIAL_GROUPS_VERSION, id);
        const gameIds = [1, 2].map((gameNo) => `${id}:${gameNo}`);
        series.push({ id, groupName: group.name, participantIds: [ids[i], ids[j]], gameIds });
        for (const gameNo of [1, 2]) {
          games.push({
            id: gameIds[gameNo - 1], seriesId: id, groupName: group.name, gameNo,
            redParticipantId: gameNo === 1 ? ids[i] : ids[j],
            blueParticipantId: gameNo === 1 ? ids[j] : ids[i],
            seed: pairSeed, mapHash, mapPackVersion,
          });
        }
      }
    }
  }
  return {
    schemaVersion: OFFICIAL_GROUPS_VERSION, seed, mapHash, mapPackVersion,
    groups: draw.groups, drawOrder: draw.drawOrder, series, games,
  };
}

/**
 * results = accepted terminal game records [{ gameId, result }]. Missing games
 * remain pending; invalid/duplicate/foreign records throw, never become forfeits.
 * This internal DTO is NOT an API response or permission to publish hidden scores.
 */
export function computeOfficialGroupStandings({ results = [], ...config }) {
  const schedule = createOfficialGroupSchedule(config);
  if (!Array.isArray(results)) throw new Error('Invalid results');
  const byGame = new Map(schedule.games.map((game) => [game.id, game]));
  const accepted = new Map();
  for (const record of results) {
    if (!record || !byGame.has(record.gameId) || accepted.has(record.gameId)
      || !['red_win', 'blue_win', 'draw'].includes(record.result)) throw new Error('Invalid or duplicate game result');
    accepted.set(record.gameId, record.result);
  }
  // Separate seeded draw for standings; never silently use roster/registration order.
  const tieDrawOrder = drawCompetition(config.participantIds,
    deriveSeed(config.seed, OFFICIAL_GROUPS_VERSION, 'standings'), 'weekly').drawOrder;
  const drawRanks = new Map(tieDrawOrder.map((id, index) => [id, index + 1]));
  const scores = new Map(config.participantIds.map((participantId) => [participantId, {
    participantId, seriesPlayed: 0, seriesWon: 0, seriesDrawn: 0, seriesLost: 0, seriesPoints: 0,
    gamesPlayed: 0, gamesWon: 0, gamesDrawn: 0, gamesLost: 0, gamePoints: 0,
    miniSeriesPoints: 0, miniGamePoints: 0, drawRank: drawRanks.get(participantId),
  }]));
  const gamePoints = (game, result, id) => result === 'draw' ? 0.5
    : (result === 'red_win' ? game.redParticipantId : game.blueParticipantId) === id ? 1 : 0;
  for (const [gameId, result] of accepted) {
    const game = byGame.get(gameId);
    for (const id of [game.redParticipantId, game.blueParticipantId]) {
      const row = scores.get(id), points = gamePoints(game, result, id);
      row.gamesPlayed++;
      row.gamePoints += points;
      if (points === 1) row.gamesWon++;
      else if (points === 0.5) row.gamesDrawn++;
      else row.gamesLost++;
    }
  }
  const completedSeries = [];
  for (const pair of schedule.series) {
    if (!pair.gameIds.every((id) => accepted.has(id))) continue;
    const totals = pair.participantIds.map((id) => pair.gameIds.reduce((sum, gameId) =>
      sum + gamePoints(byGame.get(gameId), accepted.get(gameId), id), 0));
    const points = totals.map((total, i) => total > totals[1 - i] ? 3 : total === totals[1 - i] ? 1 : 0);
    pair.participantIds.forEach((id, i) => {
      const row = scores.get(id);
      row.seriesPlayed++;
      row.seriesPoints += points[i];
      if (points[i] === 3) row.seriesWon++;
      else if (points[i] === 1) row.seriesDrawn++;
      else row.seriesLost++;
    });
    completedSeries.push({ ...pair, points });
  }
  const groups = schedule.groups.map((group) => {
    const rows = group.participantIds.map((id) => scores.get(id));
    // Partition ONCE by original seriesPoints. Never recompute after a tie splits.
    const ties = new Map();
    for (const row of rows) {
      if (!ties.has(row.seriesPoints)) ties.set(row.seriesPoints, []);
      ties.get(row.seriesPoints).push(row.participantId);
    }
    for (const ids of ties.values()) {
      if (ids.length < 2) continue;
      const members = new Set(ids);
      for (const pair of completedSeries) {
        if (!pair.participantIds.every((id) => members.has(id))) continue;
        pair.participantIds.forEach((id, i) => { scores.get(id).miniSeriesPoints += pair.points[i]; });
      }
      for (const game of schedule.games) {
        if (!accepted.has(game.id) || !members.has(game.redParticipantId) || !members.has(game.blueParticipantId)) continue;
        for (const id of [game.redParticipantId, game.blueParticipantId]) {
          scores.get(id).miniGamePoints += gamePoints(game, accepted.get(game.id), id);
        }
      }
    }
    rows.sort((a, b) => b.seriesPoints - a.seriesPoints || b.miniSeriesPoints - a.miniSeriesPoints
      || b.gamePoints - a.gamePoints || b.miniGamePoints - a.miniGamePoints || a.drawRank - b.drawRank);
    const groupGames = schedule.games.filter((game) => game.groupName === group.name);
    return {
      name: group.name, complete: groupGames.every((game) => accepted.has(game.id)),
      rows: rows.map((row, index) => ({ ...row, rank: index + 1, tieParticipantIds: [...ties.get(row.seriesPoints)].sort() })),
    };
  });
  return {
    schemaVersion: OFFICIAL_GROUPS_VERSION, seed: config.seed,
    complete: accepted.size === schedule.games.length,
    games: { total: schedule.games.length, finished: accepted.size },
    series: { total: schedule.series.length, finished: completedSeries.length },
    tieBreakers: [...OFFICIAL_GROUP_TIE_BREAKERS], tieDrawOrder, groups,
  };
}