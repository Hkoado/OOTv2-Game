import test from 'node:test';
import assert from 'node:assert/strict';
import { createOfficialGroupSchedule } from '../server/lib/officialGroups.js';
import { freezeGroupRound, roundProgress } from '../server/services/officialOrchestration.js';
import { EMPTY_TERRAIN_MAP } from '../src/game/maps.js';
import { mapHash } from '../server/contracts/canonical.js';

const ROUND_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const EVENT_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const participantIds = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444',
];
const snapshot = {
  roundId: 'group', eventId: EVENT_ID, seed: 42, mapPackVersion: 'week-1',
  maps: { primary: { hash: mapHash(EMPTY_TERRAIN_MAP) } },
  bots: participantIds.map((participantId) => ({ participantId })),
};
const roundWith = (games) => ({ roundId: ROUND_ID, eventId: EVENT_ID, frozen: false, snapshot, games });

test('freezeGroupRound rejects a partial pinned schedule before invoking the database', async () => {
  const planned = createOfficialGroupSchedule({ participantIds, seed: snapshot.seed,
    mapHash: snapshot.maps.primary.hash, mapPackVersion: snapshot.mapPackVersion });
  let freezeCalls = 0;
  await assert.rejects(freezeGroupRound({ roundId: ROUND_ID }, {
    loadRound: async () => roundWith(planned.games.slice(0, -1)),
    freeze: async () => { freezeCalls += 1; return {}; },
  }), { code: 'incomplete_schedule', status: 409 });
  assert.equal(freezeCalls, 0);
});

test('freezeGroupRound derives the canonical full schedule count, not a client-supplied count', async () => {
  const planned = createOfficialGroupSchedule({ participantIds, seed: snapshot.seed,
    mapHash: snapshot.maps.primary.hash, mapPackVersion: snapshot.mapPackVersion });
  let input;
  const actual = await freezeGroupRound({ roundId: ROUND_ID }, {
    loadRound: async () => roundWith(planned.games),
    freeze: async (value) => { input = value; return { alreadyFrozen: false }; },
  });
  assert.equal(input.expectedGames, planned.games.length);
  assert.equal(actual.expectedGames, planned.games.length);
});

test('freezeGroupRound rejects a client expected count that differs from the canonical schedule', async () => {
  const planned = createOfficialGroupSchedule({ participantIds, seed: snapshot.seed,
    mapHash: snapshot.maps.primary.hash, mapPackVersion: snapshot.mapPackVersion });
  await assert.rejects(freezeGroupRound({ roundId: ROUND_ID, expectedGames: planned.games.length - 1 }, {
    loadRound: async () => roundWith(planned.games),
    freeze: async () => assert.fail('freeze must not be called with a mismatched client count'),
  }), { code: 'bad_expected_games', status: 400 });
});

test('roundProgress includes the database job ID in failed-job DTOs', async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const target = new URL(url);
    if (target.pathname.endsWith('/mvp_official_jobs')) {
      return new Response(JSON.stringify([{ id: '99999999-9999-4999-8999-999999999999',
        game_key: 'group:A:1:1', status: 'failed', attempt: 2,
        error: 'worker_error', error_category: 'infrastructure' }]), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify([]), { status: 200,
      headers: { 'content-type': 'application/json' } });
  };
  t.after(() => { globalThis.fetch = original; });
  const round = roundWith([]);
  const result = await roundProgress({ roundId: ROUND_ID }, {
    loadRound: async () => round,
  });
  assert.equal(result.jobs.failed[0].jobId, '99999999-9999-4999-8999-999999999999');
  assert.equal(result.jobs.failed[0].gameKey, 'group:A:1:1');
});