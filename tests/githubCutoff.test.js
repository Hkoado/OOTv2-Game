import test from 'node:test';
import assert from 'node:assert/strict';
import { syncAllAtCutoff } from '../server/services/githubCutoff.js';

process.env.SUPABASE_URL = 'https://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only';
const EVENT = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const TEAM = '11111111-1111-4111-8111-111111111111';
const cutoff = '2026-10-24T00:00:00.000Z';
const connection = { event_id: EVENT, team_id: TEAM, repo_id: 11,
  repository: 'https://github.com/example/bot', branch: 'main' };

function fixture(t) {
  const original = globalThis.fetch;
  const state = { pinned: null, busy: false, pins: 0, failPinResponse: false };
  globalThis.fetch = async (url, options = {}) => {
    const name = new URL(url).pathname.split('/').pop();
    const body = options.body ? JSON.parse(options.body) : {};
    let value;
    if (name === 'mvp_tournaments') value = [{ id: EVENT, status: 'draft' }];
    else if (name === 'mvp_official_setups') value = [{ config: { cutoff, mapsPublished: true } }];
    else if (name === 'mvp_repo_connections') value = [connection];
    else if (name === 'mvp_cutoff_claim') {
      value = state.pinned ? { ok: true, pinned: true } : state.busy ? { ok: true, busy: true }
        : { ok: true, token: 'token', connection };
      state.busy = true;
    } else if (name === 'mvp_cutoff_pin') {
      state.pinned = body.p_sha;
      state.pins++;
      if (state.failPinResponse) throw new Error('response_lost');
      value = { ok: true, already_pinned: false };
    } else throw new Error(`Unexpected request ${name}`);
    return new Response(JSON.stringify(value), { status: 200 });
  };
  t.after(() => { globalThis.fetch = original; });
  return state;
}
const run = (getHead) => syncAllAtCutoff({ eventId: EVENT,
  clock: () => Date.parse(cutoff) + 1000, getHead });

test('repeated sync never resolves changed HEAD after authoritative pin', async (t) => {
  const state = fixture(t);
  let calls = 0;
  const getHead = async () => (++calls === 1 ? 'a' : 'b').repeat(40);
  assert.equal((await run(getHead)).queued, 1);
  assert.equal((await run(getHead)).skipped, 1);
  assert.equal(calls, 1);
  assert.equal(state.pinned, 'a'.repeat(40));
});

test('concurrent sync respects busy reservation before GitHub request', async (t) => {
  const state = fixture(t);
  let calls = 0;
  const values = await Promise.all([run(async () => { calls++; return 'a'.repeat(40); }),
    run(async () => { calls++; return 'b'.repeat(40); })]);
  assert.equal(calls, 1);
  assert.equal(state.pins, 1);
  assert.equal(values.reduce((sum, item) => sum + item.skipped, 0), 1);
});

test('interrupted resolution retries after lease expiry without creating a fake pin', async (t) => {
  const state = fixture(t);
  const failed = await run(async () => { throw Object.assign(new Error('private detail'), { code: 'github_unavailable' }); });
  assert.equal(failed.failed[0].error, 'github_unavailable');
  assert.equal(state.pinned, null);
  state.busy = false; // Simulate DB lease expiry, not client-side release.
  assert.equal((await run(async () => 'c'.repeat(40))).queued, 1);
});

test('lost pin response reconciles on retry without resolving a second HEAD', async (t) => {
  const state = fixture(t);
  state.failPinResponse = true;
  assert.equal((await run(async () => 'd'.repeat(40))).failed.length, 1);
  assert.equal((await run(async () => { throw new Error('must not resolve'); })).skipped, 1);
  assert.equal(state.pins, 1);
});

test('before cutoff rejects without contacting GitHub', async (t) => {
  fixture(t);
  await assert.rejects(syncAllAtCutoff({ eventId: EVENT, clock: () => 0,
    getHead: async () => { throw new Error('must not resolve'); } }),
  (error) => error.code === 'cutoff_not_reached');
});