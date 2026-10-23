import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EMPTY_TERRAIN_MAP } from '../src/game/maps.js';
import { buildGroupSnapshot } from '../server/services/officialRounds.js';

process.env.SUPABASE_URL = 'https://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only';

const EVENT = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444'];
const sha = (text) => createHash('sha256').update(text).digest('hex');
const bytes = (index) => sha(`bot-${index}`);
const cutoff = '2026-10-24T00:00:00.000Z';
const now = Date.parse('2026-10-25T00:00:00.000Z');

function fixtures({ cutoffAt = cutoff } = {}) {
  const submissions = ids.map((participant_id, index) => ({
    id: participant_id, participant_id, storage_path: `${participant_id}.py`,
    sha256: bytes(index), status: 'valid', created_at: '2026-10-23T00:00:00.000Z',
  }));
  return {
    event: { id: EVENT, name: 'Weekly', status: 'draft', seed: 99 },
    entries: ids.map((participant_id, index) => ({ id: `entry-${index}`, participant_id, seed_order: index + 1 })),
    setup: { config: { cutoff: cutoffAt, mapsPublished: true, mapPackVersion: 'week-1',
      primaryMap: EMPTY_TERRAIN_MAP, reserveMap: EMPTY_TERRAIN_MAP } },
    participants: ids.map((id, index) => ({ id, name: `Team ${index + 1}` })),
    submissions,
    receipts: ids.slice(0, 2).map((team_id, index) => ({
      team_id, submission_id: team_id, source_hash: bytes(index),
      commit_sha: String(index + 1).repeat(40), repo_id: 100 + index,
      resolved_at: '2026-10-23T23:00:00.000Z', status: 'valid',
    })),
  };
}

function setupFetch(t, data) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const target = new URL(url);
    const table = target.pathname.split('/').pop();
    const values = table === 'mvp_tournaments' ? [data.event]
      : table === 'mvp_tournament_entries' ? data.entries
        : table === 'mvp_official_setups' ? [data.setup]
          : table === 'mvp_submissions' ? data.submissions
            : table === 'mvp_github_receipts' ? data.receipts
              : table === 'mvp_participants' ? data.participants
                : [];
    return new Response(JSON.stringify(values), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  t.after(() => { globalThis.fetch = original; });
}

test('buildGroupSnapshot pins one valid bot per team, GitHub + offline', async (t) => {
  setupFetch(t, fixtures());
  const { snapshot } = await buildGroupSnapshot({ eventId: EVENT, clock: () => now });
  assert.equal(snapshot.eventId, EVENT);
  assert.equal(snapshot.roundId, 'group');
  assert.equal(snapshot.seed, 99);
  assert.equal(snapshot.bots.length, 4);
  assert.equal(snapshot.bots[0].sourceKind, 'github');
  assert.equal(snapshot.bots[0].repositoryId, '100');
  assert.equal(snapshot.bots[0].commitSha, '1'.repeat(40));
  assert.equal(snapshot.bots[2].sourceKind, 'offline_file');
  assert.match(snapshot.contentHash, /^[a-f0-9]{64}$/);
  assert.equal(snapshot.runtime.runtimeVersion, 'campus-runtime.v1');
});

test('buildGroupSnapshot refuses before cutoff or with a missing bot', async (t) => {
  setupFetch(t, fixtures({ cutoffAt: '2026-10-26T00:00:00.000Z' }));
  await assert.rejects(buildGroupSnapshot({ eventId: EVENT, clock: () => now }),
    (error) => error.code === 'cutoff_not_reached');

  const data = fixtures();
  data.submissions = data.submissions.slice(0, 3);
  setupFetch(t, data);
  await assert.rejects(buildGroupSnapshot({ eventId: EVENT, clock: () => now }),
    (error) => error.code === 'missing_submission' && error.message.includes('Team 4'));
});
