import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchOfficialPublishedStandings,
  fetchOfficialPublishedBracket,
  fetchOfficialPublishedTickets,
  fetchOfficialPublishedGames,
  fetchOfficialCutoffStatus,
  syncGithubCutoff,
} from '../src/tournament/portal/officialRoundApi.js';

test('portalOfficialResults: team access restricted to published routes and handles unpublished 409', async () => {
  const originalFetch = globalThis.fetch;
  const queriedUrls = [];

  globalThis.fetch = async (url) => {
    queriedUrls.push(url);

    if (url.includes('/official/published/standings')) {
      return {
        ok: false,
        status: 409,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify({ error: { code: 'round_not_published', message: 'Vòng chưa công bố' } }),
      };
    }

    if (url.includes('/official/published/tickets')) {
      return {
        ok: false,
        status: 409,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify({ error: { code: 'tickets_not_published', message: 'Vé chưa công bố' } }),
      };
    }

    if (url.includes('/official/published/bracket')) {
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify({
          ok: true,
          bracket: {
            round_id: 'rnd-1',
            status: 'in_progress',
            series: [{ series_id: 's-1', stage: 'quarter_final', state: 'ready' }],
          },
        }),
      };
    }

    if (url.includes('/official/published/games')) {
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify({
          ok: true,
          games: [
            {
              game_key: 'g1',
              round_id: 'rnd-1',
              stage: 'quarter_final',
              red_team: { id: 't1', name: 'Đội 1' },
              blue_team: { id: 't2', name: 'Đội 2' },
              state: 'scheduled',
              is_published: true,
              broadcast_state: 'scheduled',
              starts_at: '2026-10-25T12:00:00Z',
            },
          ],
        }),
      };
    }

    return {
      ok: false,
      status: 403,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => JSON.stringify({ error: { code: 'scope_denied', message: 'Forbidden' } }),
    };
  };

  try {
    // 1. Published Standings returns published: false when 409
    const std = await fetchOfficialPublishedStandings('evt-101');
    assert.equal(std.published, false);
    assert.equal(std.error, 'round_not_published');

    // 2. Published Tickets returns published: false when 409
    const tkt = await fetchOfficialPublishedTickets('evt-101');
    assert.equal(tkt.published, false);
    assert.equal(tkt.error, 'tickets_not_published');

    // 3. Published Bracket succeeds
    const brk = await fetchOfficialPublishedBracket('evt-101');
    assert.equal(brk.ok, true);
    assert.equal(brk.bracket.round_id, 'rnd-1');

    // 4. Published Games succeeds
    const gms = await fetchOfficialPublishedGames('evt-101');
    assert.equal(gms.ok, true);
    assert.equal(gms.games.length, 1);
    assert.equal(gms.games[0].game_key, 'g1');

    // Verify all requested URLs are under /official/published/ (never calling internal admin endpoints)
    for (const url of queriedUrls) {
      assert.match(url, /\/events\/evt-101\/official\/published\//);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('portalOfficialResults: tickets structure conform to contract { awarded, reserves, vacant }', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    text: async () => JSON.stringify({
      ok: true,
      tickets: {
        awarded: [
          { ticket_id: 'tkt-1', team_id: 't-a', team_name: 'Đội A', seed: 1, rank: 1 },
          { ticket_id: 'tkt-2', team_id: 't-b', team_name: 'Đội B', seed: 2, rank: 2 },
        ],
        reserves: [
          { ticket_id: 'tkt-3', team_id: 't-c', team_name: 'Đội C', seed: 3, rank: 3 },
        ],
        vacant: 1,
      },
    }),
  });

  try {
    const res = await fetchOfficialPublishedTickets('evt-test');
    assert.equal(res.ok, true);
    assert.ok(res.tickets);
    assert.equal(Array.isArray(res.tickets.awarded), true);
    assert.equal(res.tickets.awarded.length, 2);
    assert.equal(Array.isArray(res.tickets.reserves), true);
    assert.equal(res.tickets.reserves.length, 1);
    assert.equal(res.tickets.vacant, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('portalOfficialResults: cutoff batch status and targeted retry for teams without pinned SHA', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });

    if (url.includes('/github-cutoff-status')) {
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify({
          ok: true,
          total_teams: 3,
          pinned_teams: 1,
          pending_teams: 2,
          teams: [
            { team_id: 't-1', team_name: 'Team One', pinned_commit_sha: 'abc1234', repo_url: 'https://github.com/org/repo1' },
            { team_id: 't-2', team_name: 'Team Two', pinned_commit_sha: null, repo_url: 'https://github.com/org/repo2' },
            { team_id: 't-3', team_name: 'Team Three', pinned_commit_sha: null, repo_url: 'https://github.com/org/repo3' },
          ],
        }),
      };
    }

    if (url.includes('/github-cutoff-sync')) {
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify({
          ok: true,
          requested_count: 2,
          synced_count: 2,
        }),
      };
    }

    return { ok: false, status: 500, text: async () => '{}' };
  };

  try {
    const status = await fetchOfficialCutoffStatus('evt-cutoff');
    assert.equal(status.ok, true);
    assert.equal(status.total_teams, 3);
    assert.equal(status.pinned_teams, 1);
    assert.equal(status.pending_teams, 2);

    // Identify teams that need targeted retry
    const pendingIds = status.teams.filter((t) => !t.pinned_commit_sha).map((t) => t.team_id);
    assert.deepEqual(pendingIds, ['t-2', 't-3']);

    // Perform targeted sync
    const syncRes = await syncGithubCutoff('evt-cutoff', { teamIds: pendingIds });
    assert.equal(syncRes.ok, true);
    assert.equal(syncRes.synced_count, 2);

    const postCall = calls.find((c) => c.url.includes('/github-cutoff-sync'));
    assert.ok(postCall);
    const body = JSON.parse(postCall.options.body);
    assert.deepEqual(body.team_ids, ['t-2', 't-3']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
