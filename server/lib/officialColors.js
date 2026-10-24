import { deriveSeed } from '../judge/rng.js';

export const COLOR_POLICY = 'alternate-loss-priority.v1';

/** History is chronological, accepted and scoped to one round. No future results. */
export function assignOfficialColors({ participantIds, roundId, gameId, seed, history = [] }) {
  if (!Array.isArray(participantIds) || participantIds.length !== 2 || new Set(participantIds).size !== 2
    || participantIds.some((id) => typeof id !== 'string' || !id)
    || !roundId || !gameId || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff || !Array.isArray(history)) {
    throw new Error('Invalid color assignment');
  }
  const ids = [...participantIds].sort();
  const stats = new Map(ids.map((id) => [id, { last: null, won: 0, lost: 0 }]));
  const seen = new Set();
  for (const game of history) {
    if (game.roundId !== roundId) continue;
    if (!game.gameId || seen.has(game.gameId) || game.gameId === gameId
      || !game.redParticipantId || !game.blueParticipantId || game.redParticipantId === game.blueParticipantId
      || !['red_win', 'blue_win', 'draw'].includes(game.result)) throw new Error('Invalid color history');
    seen.add(game.gameId);
    for (const [id, color] of [[game.redParticipantId, 'red'], [game.blueParticipantId, 'blue']]) {
      const row = stats.get(id);
      if (!row) continue;
      row.last = color;
      if (game.result !== 'draw') row[game.result === `${color}_win` ? 'won' : 'lost']++;
    }
  }
  const [a, b] = ids.map((id) => stats.get(id));
  // Minimize the number of repeated colors before consulting results.
  const cost = (red, blue) => Number(red.last === 'red') + Number(blue.last === 'blue');
  let redIndex, reason;
  const difference = cost(a, b) - cost(b, a);
  if (difference) { redIndex = difference < 0 ? 0 : 1; reason = 'alternate'; }
  else if (a.lost !== b.lost) { redIndex = a.lost > b.lost ? 0 : 1; reason = 'more_losses'; }
  else if (a.won !== b.won) { redIndex = a.won < b.won ? 0 : 1; reason = 'fewer_wins'; }
  else { redIndex = deriveSeed(seed, COLOR_POLICY, roundId, gameId, ...ids) % 2; reason = 'seed'; }
  return { policy: COLOR_POLICY, roundId, gameId, redParticipantId: ids[redIndex],
    blueParticipantId: ids[1 - redIndex], reason };
}

/** Assign only the NEXT game, then pin/publish this DTO before execution. */
export function assignNextOfficialGameColor({ games, results = [], roundId, seed }) {
  const byId = new Map(games.map((game) => [game.id, game]));
  if (byId.size !== games.length || !Array.isArray(results)) throw new Error('Invalid color schedule');
  const accepted = new Map();
  for (const record of results) {
    if (!byId.has(record.gameId) || accepted.has(record.gameId) || !['red_win', 'blue_win', 'draw'].includes(record.result)) {
      throw new Error('Invalid color result');
    }
    accepted.set(record.gameId, record);
  }
  const history = [];
  for (const game of games) {
    const record = accepted.get(game.id);
    if (!record) {
      if (accepted.size !== history.length) throw new Error('Results must be a completed prefix');
      return { ...game, ...assignOfficialColors({ participantIds: [game.redParticipantId, game.blueParticipantId],
        roundId, gameId: game.id, seed, history }) };
    }
    const assignment = assignOfficialColors({ participantIds: [game.redParticipantId, game.blueParticipantId], roundId, gameId: game.id, seed, history });
    if (record.redParticipantId !== assignment.redParticipantId || record.blueParticipantId !== assignment.blueParticipantId) {
      throw new Error('Result does not match pinned colors');
    }
    history.push({ ...assignment, result: record.result });
  }
  return null;
}