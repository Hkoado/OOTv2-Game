import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EMPTY_TERRAIN_MAP } from '../src/game/maps.js';
import { buildGroupSnapshot } from '../server/services/officialRounds.js';
import { OFFICIAL_RUNTIME_VERSION } from '../server/judge/officialRuntime.js';

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
    captures: ids.map((team_id, index) => ({ team_id, receipt_id: `receipt-${index}`,
      cutoff: cutoffAt, policy: 'cutoff-first-resolution.v1', commit_sha: String(index + 1).repeat(40),
      captured_at: '2026-10-24T00:00:01.000Z',
      connection: { repo_id: 100 + index, repository: `https://github.com/example/bot-${index}`, branch: 'main' } })),
    receipts: ids.map((team_id, index) => ({
      id: `receipt-${index}`, team_id, submission_id: team_id, source_hash: bytes(index),
      commit_sha: String(index + 1).repeat(40), repo_id: 100 + index,
      repository: `https://github.com/example/bot-${index}`, branch: 'main', file_path: 'bot.py',
      resolved_at: '2026-10-24T00:00:01.000Z', status: 'valid',
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
                : table === 'mvp_cutoff_captures' ? data.captures : [];
    return new Response(JSON.stringify(values), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  t.after(() => { globalThis.fetch = original; });
}

test('buildGroupSnapshot pins only authoritative receipts completed after cutoff', async (t) => {
  setupFetch(t, fixtures());
  const { snapshot } = await buildGroupSnapshot({ eventId: EVENT, clock: () => now });
  assert.equal(snapshot.eventId, EVENT);
  assert.equal(snapshot.roundId, 'group');
  assert.equal(snapshot.seed, 99);
  assert.equal(snapshot.bots.length, 4);
  assert.equal(snapshot.bots[0].sourceKind, 'github');
  assert.equal(snapshot.bots[0].repositoryId, '100');
  assert.equal(snapshot.bots[0].commitSha, '1'.repeat(40));
  assert.equal(snapshot.bots[2].sourceKind, 'github');
  assert.equal(snapshot.bots[0].receiptId, 'receipt-0');
  assert.match(snapshot.contentHash, /^[a-f0-9]{64}$/);
  assert.equal(snapshot.runtime.runtimeVersion, OFFICIAL_RUNTIME_VERSION);
});

for (const state of ['missing', 'resolving', 'invalid', 'infrastructure', 'wrong_hash', 'wrong_receipt', 'wrong_sha', 'wrong_repo', 'early_capture']) {
  test(`snapshot blocks ${state} official capture despite older valid submissions`, async (t) => {
    const data = fixtures();
    if (state === 'missing') data.captures = data.captures.slice(1);
    else if (state === 'wrong_hash') data.receipts[0].source_hash = bytes(9);
    else if (state === 'wrong_receipt') data.captures[0].receipt_id = 'another-receipt';
    else if (state === 'wrong_sha') data.captures[0].commit_sha = 'f'.repeat(40);
    else if (state === 'wrong_repo') data.receipts[0].repository = 'https://github.com/example/other';
    else if (state === 'early_capture') data.captures[0].captured_at = '2026-10-23T00:00:00.000Z';
    else data.receipts[0].status = state;
    setupFetch(t, data);
    await assert.rejects(buildGroupSnapshot({ eventId: EVENT, clock: () => now }),
      (error) => error.code === 'missing_submission');
  });
}

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
