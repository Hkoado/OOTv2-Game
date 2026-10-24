import test from 'node:test';
import assert from 'node:assert/strict';
import { createOfficialKnockoutSeries } from '../server/lib/officialBracket.js';
import { publishNextSeriesGame, knockoutSeriesOutcome } from '../server/services/officialKnockout.js';

const MAP = 'a'.repeat(64);
const RESERVE = 'b'.repeat(64);
const RED = '11111111-1111-4111-8111-111111111111';
const BLUE = '22222222-2222-4222-8222-222222222222';

/** Round store in memory: đúng shape `loadOfficialRound`/`appendOfficialGame` mà service dùng. */
function fakeRound() {
  const series = createOfficialKnockoutSeries({
    id: 'semifinal:1', stage: 'semifinal', seed: 7,
    entrants: [{ participantId: RED, seed: 1 }, { participantId: BLUE, seed: 4 }],
    primaryMap: { mapHash: MAP, mapPackVersion: 'e2e-pack-1' },
    reserveMap: { mapHash: RESERVE, mapPackVersion: 'e2e-pack-1' },
  });
  let round = {
    roundId: 'ko:semifinal:1', frozen: false, chainHash: 'chain-0',
    snapshot: { contentHash: 'c'.repeat(64),
      runtime: { runtimeVersion: 'campus-runtime.v1', rulesVersion: 'campus-rules.v2',
        protocolVersion: 'campus-protocol.v1', runtimeHash: 'd'.repeat(64), budgetHash: 'e'.repeat(64) } },
    games: [],
  };
  return {
    series,
    get games() { return round.games; },
    deps: {
      loadRound: async () => ({ ...round, games: round.games.map((game) => ({ ...game })) }),
      appendGame: async ({ game }) => {
        round = { ...round, chainHash: `chain-${round.games.length + 1}`,
          games: [...round.games, { ...game, result: null, replayHash: null }] };
      },
      enqueue: async ({ gameKey }) => ({ jobId: `job-${gameKey}`, status: 'queued' }),
    },
    /** Ghi kết quả như worker: chỉ ván đang chờ mới nhận kết quả. */
    record(gameKey, result) {
      round = { ...round, games: round.games.map((game) => (game.gameKey === gameKey ? { ...game, result } : game)) };
    },
  };
}

test('series knockout toàn hòa: pin đủ 4 ván chính + 2 ván phụ rồi thắng theo seed', async () => {
  const fake = fakeRound();
  const published = [];
  for (let step = 0; step < 10; step += 1) {
    const result = await publishNextSeriesGame({ roundId: 'ko:semifinal:1', series: fake.series }, fake.deps);
    if (result.status === 'complete') break;
    assert.equal(result.status, 'published', JSON.stringify(result));
    published.push(result.game.gameKey);
    fake.record(result.game.gameKey, 'draw');
  }
  assert.equal(published.length, 6, `phải pin 6 ván (4 chính + 2 phụ), thực tế ${published.join(',')}`);
  const outcome = await knockoutSeriesOutcome({ series: fake.series, roundId: 'ko:semifinal:1' }, fake.deps);
  assert.equal(outcome.complete, true);
  assert.equal(outcome.reason, 'seed');
  assert.equal(outcome.winnerParticipantId, RED, 'hòa toàn bộ ⇒ seed 1 đi tiếp, không bịa thêm ván');
  assert.equal(outcome.loserParticipantId, BLUE);
  assert.equal(outcome.gamesPlayed, 6);
});
