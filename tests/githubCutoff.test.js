import test from 'node:test';
import assert from 'node:assert/strict';
import { syncAllAtCutoff } from '../server/services/githubCutoff.js';

process.env.SUPABASE_URL = 'https://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only';

const EVENT = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const TEAM_A = '11111111-1111-4111-8111-111111111111';
const TEAM_B = '22222222-2222-4222-8222-222222222222';
const cutoff = '2026-10-24T00:00:00.000Z';
const now = Date.parse('2026-10-25T00:00:00.000Z');
const sha = 'a'.repeat(40);

function setupFetch(t, state) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const target = new URL(url);
    const table = target.pathname.split('/').pop();
    const method = options.method || 'GET';
    if (method !== 'GET') {
      state.inserted.push({ table, body: JSON.parse(options.body) });
      return new Response(JSON.stringify(JSON.parse(options.body)), { status: 201,
        headers: { 'content-type': 'application/json' } });
    }
    const query = target.search;
    let values = [];
    if (table === 'mvp_tournaments') values = [{ id: EVENT, status: 'draft' }];
    else if (table === 'mvp_official_setups') values = [{ config: { cutoff, mapsPublished: true } }];
    else if (table === 'mvp_repo_connections') values = state.connections;
    else if (table === 'mvp_github_receipts') values = query.includes(`team_id=eq.${TEAM_A}`) ? state.receipts : [];
    else if (table === 'mvp_submissions') values = [{ id: 'previous-submission' }];
    return new Response(JSON.stringify(values), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  t.after(() => { globalThis.fetch = original; });
}

const connection = (teamId, repoId, name) => ({ event_id: EVENT, team_id: teamId, repo_id: repoId,
  repository: `https://github.com/example/${name}`, branch: 'main', file_path: 'bot.py', approved: true });

test('cutoff sync queues one pinned job per approved repo only', async (t) => {
  const state = { connections: [connection(TEAM_A, 11, 'a'), connection(TEAM_B, 12, 'b')],
    receipts: [], inserted: [] };
  setupFetch(t, state);
  const getHead = async (fullName) => fullName.endsWith('/a') ? sha : 'b'.repeat(40);
  const summary = await syncAllAtCutoff({ eventId: EVENT, actor: { id: null }, clock: () => now, getHead });
  assert.deepEqual(summary, { cutoff, queued: 2, skipped: 0, failed: [] });
  assert.equal(state.inserted.filter((item) => item.table === 'mvp_repo_sync_jobs').length, 2);
  assert.equal(state.inserted.filter((item) => item.table === 'mvp_github_receipts').length, 2);
  const job = state.inserted.find((item) => item.table === 'mvp_repo_sync_jobs').body[0];
  assert.equal(job.commit_sha, sha);
  assert.equal(job.status, 'queued');
});

test('cutoff sync skips an already pinned SHA and reports pull failures', async (t) => {
  const state = { connections: [connection(TEAM_A, 11, 'a'), connection(TEAM_B, 12, 'b')],
    receipts: [{ id: 'existing', status: 'valid' }], inserted: [] };
  setupFetch(t, state);
  const getHead = async (fullName) => {
    if (fullName.endsWith('/b')) throw Object.assign(new Error('offline'), { code: 'github_unavailable' });
    return sha;
  };
  const summary = await syncAllAtCutoff({ eventId: EVENT, actor: { id: null }, clock: () => now, getHead });
  assert.equal(summary.queued, 0);
  assert.equal(summary.skipped, 1);
  assert.equal(summary.failed.length, 1);
  assert.equal(summary.failed[0].error, 'github_unavailable');
});
