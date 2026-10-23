import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchEventRepositories,
  fetchLatestGithubSubmission,
  fetchRepositoryConnection,
  fetchRepoSyncJob,
  requestGithubSubmission,
  saveRepositoryConnection,
} from '../src/tournament/portal/githubApi.js';
import { humanizeIntakeError } from '../src/tournament/portal/githubSyncState.js';
import { setCsrfToken, resetApiState } from '../src/tournament/portal/portalApi.js';

test('humanizeIntakeError maps all standard intake error codes to Vietnamese messages', () => {
  assert.match(humanizeIntakeError('repo_not_approved'), /chưa được BTC phê duyệt/);
  assert.match(humanizeIntakeError('repo_taken'), /đội khác/);
  assert.match(humanizeIntakeError('past_cutoff'), /quá thời hạn/);
  assert.match(humanizeIntakeError('quota_exceeded'), /hạn mức/);
  assert.match(humanizeIntakeError('github_rate_limited'), /rate limit/);
  assert.equal(humanizeIntakeError('unknown_code'), 'Lỗi không xác định khi đồng bộ từ GitHub.');
  assert.equal(humanizeIntakeError(null), 'Lỗi không xác định khi đồng bộ từ GitHub.');
});

test('githubApi client functions call correct /api/local endpoints and parse responses', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
    resetApiState();
  });

  setCsrfToken('test-csrf-token-123');
  const calls = [];

  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (url.includes('/repository?team=team_beta')) {
      return new Response(JSON.stringify({ connection: { id: 'c1', approved: true } }));
    }
    if (url.endsWith('/repository') && options.method === 'GET') {
      return new Response(JSON.stringify({ connection: { id: 'c0', approved: false } }));
    }
    if (url.endsWith('/repository') && options.method === 'PUT') {
      return new Response(JSON.stringify({ connection: { id: 'c0', approved: true } }));
    }
    if (url.endsWith('/repositories')) {
      return new Response(JSON.stringify({ connections: [{ id: 'c1' }, { id: 'c2' }] }));
    }
    if (url.endsWith('/submissions/from-github') && options.method === 'POST') {
      return new Response(JSON.stringify({ created: true, job: { id: 'j1' }, receipt: { id: 'r1', status: 'resolving' } }));
    }
    if (url.includes('/submissions/from-github') && options.method === 'GET') {
      return new Response(JSON.stringify({ event: { id: 'ev1' }, receipt: { id: 'r1', status: 'valid' } }));
    }
    if (url.includes('/repo-sync-jobs/j1')) {
      return new Response(JSON.stringify({ job: { id: 'j1', status: 'completed' }, receipt: { id: 'r1', status: 'valid' } }));
    }
    return new Response('{}');
  };

  // 1. fetchRepositoryConnection
  const connTeam = await fetchRepositoryConnection('ev1');
  assert.equal(connTeam.id, 'c0');
  assert.equal(connTeam.approved, false);

  const connBeta = await fetchRepositoryConnection('ev1', 'team_beta');
  assert.equal(connBeta.id, 'c1');
  assert.equal(connBeta.approved, true);

  // 2. saveRepositoryConnection
  const saved = await saveRepositoryConnection('ev1', {
    repository: 'https://github.com/team-alpha/bot',
    branch: 'dev',
    team: 't1',
  });
  assert.equal(saved.id, 'c0');
  const lastPut = calls.find((c) => c.options.method === 'PUT');
  assert.equal(lastPut.options.headers['x-csrf-token'], 'test-csrf-token-123');
  const putBody = JSON.parse(lastPut.options.body);
  assert.equal(putBody.repository, 'https://github.com/team-alpha/bot');
  assert.equal(putBody.branch, 'dev');
  assert.equal(putBody.team, 't1');

  // 3. fetchEventRepositories
  const repos = await fetchEventRepositories('ev1');
  assert.equal(repos.length, 2);

  // 4. requestGithubSubmission
  const submitRes = await requestGithubSubmission('ev1', { team: 't1' });
  assert.equal(submitRes.created, true);
  assert.equal(submitRes.job.id, 'j1');
  assert.equal(submitRes.receipt.status, 'resolving');

  // 5. fetchLatestGithubSubmission
  const latest = await fetchLatestGithubSubmission('ev1', 't1');
  assert.equal(latest.receipt.status, 'valid');

  // 6. fetchRepoSyncJob
  const jobStatus = await fetchRepoSyncJob('j1');
  assert.equal(jobStatus.job.status, 'completed');
  assert.equal(jobStatus.receipt.status, 'valid');

  // Edge cases
  assert.equal(await fetchRepositoryConnection(null), null);
  assert.deepEqual(await fetchEventRepositories(null), []);
  assert.equal(await fetchLatestGithubSubmission(null), null);
  assert.equal(await fetchRepoSyncJob(null), null);
  await assert.rejects(() => saveRepositoryConnection(null), /Cần mã giải đấu/);
  await assert.rejects(() => requestGithubSubmission(null), /Cần mã giải đấu/);
});
