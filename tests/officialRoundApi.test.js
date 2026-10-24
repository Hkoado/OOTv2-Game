import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchOfficialRound,
  openOfficialRound,
  syncGithubCutoff,
  fetchOfficialCutoffStatus,
  fetchOfficialProgress,
  fetchOfficialStandings,
  publishNextOfficialGame,
  freezeOfficialRound,
  fetchOfficialBracket,
  openNextKnockoutSeries,
  fetchOfficialTickets,
  cancelOfficialJob,
  requeueOfficialJob,
  fetchOfficialBroadcastState,
  scheduleOfficialBroadcast,
  fetchOfficialGameViewer,
  fetchOfficialPublishedStandings,
  fetchOfficialPublishedBracket,
  fetchOfficialPublishedTickets,
  fetchOfficialPublishedGames,
} from '../src/tournament/portal/officialRoundApi.js';

test('officialRoundApi input validations', async () => {
  // Missing eventId returns null for fetch or throws for mutation
  assert.equal(await fetchOfficialRound(''), null);
  assert.equal(await fetchOfficialCutoffStatus(''), null);
  assert.equal(await fetchOfficialProgress(''), null);
  assert.equal(await fetchOfficialStandings(''), null);
  assert.equal(await fetchOfficialBracket(''), null);
  assert.equal(await fetchOfficialTickets(''), null);
  assert.equal(await fetchOfficialPublishedStandings(''), null);
  assert.equal(await fetchOfficialPublishedBracket(''), null);
  assert.equal(await fetchOfficialPublishedTickets(''), null);
  assert.equal(await fetchOfficialPublishedGames(''), null);
  assert.equal(await fetchOfficialBroadcastState('', 'game-1'), null);
  assert.equal(await fetchOfficialBroadcastState('round-1', ''), null);
  assert.equal(await fetchOfficialGameViewer('', 'game-1'), null);
  assert.equal(await fetchOfficialGameViewer('round-1', ''), null);

  await assert.rejects(() => openOfficialRound(''), /Cần mã giải/);
  await assert.rejects(() => syncGithubCutoff(''), /Cần mã giải/);
  await assert.rejects(() => publishNextOfficialGame(''), /Cần mã giải/);
  await assert.rejects(() => freezeOfficialRound(''), /Cần mã giải/);
  await assert.rejects(() => openNextKnockoutSeries(''), /Cần mã giải/);
  await assert.rejects(() => scheduleOfficialBroadcast('', 'game-1', {}), /Cần mã vòng/);
  await assert.rejects(() => scheduleOfficialBroadcast('round-1', '', {}), /Cần mã vòng/);

  // Job operations require jobId and reason 5..400 chars
  await assert.rejects(() => cancelOfficialJob('', 'valid reason'), /Cần mã job/);
  await assert.rejects(() => cancelOfficialJob('job-1', 'four'), /5 đến 400 ký tự/);
  await assert.rejects(() => cancelOfficialJob('job-1', 'a'.repeat(401)), /5 đến 400 ký tự/);

  await assert.rejects(() => requeueOfficialJob('', 'valid reason'), /Cần mã job/);
  await assert.rejects(() => requeueOfficialJob('job-1', '123'), /5 đến 400 ký tự/);
  await assert.rejects(() => requeueOfficialJob('job-1', 'a'.repeat(401)), /5 đến 400 ký tự/);
});

test('cutoff sync completion and remaining fields are surfaced by the API client', async () => {
  const originalFetch = globalThis.fetch;
  let call = 0;
  globalThis.fetch = async (url) => {
    call++;
    if (url.includes('github-cutoff-sync')) {
      return new Response(JSON.stringify({ queued: 5, skipped: 0, failed: [], remaining: 3, complete: false, budget_exhausted: true }),
        { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ pinned_count: 5, total_approved: 8, pending_count: 3, busy_count: 0, complete: false }),
      { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const sync = await syncGithubCutoff('evt-progress');
    assert.equal(sync.complete, false);
    assert.equal(sync.remaining, 3);
    assert.equal(sync.budget_exhausted, true);
    const status = await fetchOfficialCutoffStatus('evt-progress');
    assert.equal(status.complete, false);
    assert.equal(status.pending_count, 3);
    assert.equal(call, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('officialRoundApi mocked endpoints and error handling', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url.includes('/404')) {
      return {
        ok: false,
        status: 404,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify({ error: { code: 'not_found', message: 'Not found' } }),
      };
    }
    if (url.includes('/409')) {
      return {
        ok: false,
        status: 409,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify({ error: { code: 'round_not_published', message: 'Not published yet' } }),
      };
    }
    return {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => JSON.stringify({ ok: true, url, csrfToken: 'mock-csrf' }),
    };
  };

  try {
    // 1. fetchOfficialProgress
    const prog = await fetchOfficialProgress('evt-1');
    assert.equal(prog.ok, true);
    assert.match(calls.at(-1).url, /\/events\/evt-1\/official\/progress$/);

    // 404 gracefully returns null
    const prog404 = await fetchOfficialProgress('404');
    assert.equal(prog404, null);

    // 2. fetchOfficialStandings
    const std = await fetchOfficialStandings('evt-1');
    assert.equal(std.ok, true);
    assert.match(calls.at(-1).url, /\/events\/evt-1\/official\/standings$/);

    // 3. publishNextOfficialGame
    const pub = await publishNextOfficialGame('evt-1');
    assert.equal(pub.ok, true);
    assert.equal(calls.at(-1).options.method, 'POST');
    assert.match(calls.at(-1).url, /\/events\/evt-1\/official\/publish$/);

    // 4. freezeOfficialRound
    const frz = await freezeOfficialRound('evt-1', { expectedGames: 12 });
    assert.equal(frz.ok, true);
    assert.equal(calls.at(-1).options.method, 'POST');
    assert.equal(JSON.parse(calls.at(-1).options.body).expected_games, 12);
    assert.match(calls.at(-1).url, /\/events\/evt-1\/official\/freeze$/);

    // 5. fetchOfficialBracket
    const brk = await fetchOfficialBracket('evt-1');
    assert.equal(brk.ok, true);
    assert.match(calls.at(-1).url, /\/events\/evt-1\/official\/bracket$/);

    // 409 returns null safely
    const brk409 = await fetchOfficialBracket('409');
    assert.equal(brk409, null);

    // 6. openNextKnockoutSeries
    const brkOpen = await openNextKnockoutSeries('evt-1');
    assert.equal(brkOpen.ok, true);
    assert.equal(calls.at(-1).options.method, 'POST');
    assert.match(calls.at(-1).url, /\/events\/evt-1\/official\/bracket\/open$/);

    // 7. fetchOfficialTickets
    const tkt = await fetchOfficialTickets('evt-1');
    assert.equal(tkt.ok, true);
    assert.match(calls.at(-1).url, /\/events\/evt-1\/official\/tickets$/);

    // 8. cancelOfficialJob & requeueOfficialJob
    const cancelRes = await cancelOfficialJob('job-99', 'Worker node out of memory');
    assert.equal(cancelRes.ok, true);
    assert.equal(calls.at(-1).options.method, 'POST');
    assert.equal(JSON.parse(calls.at(-1).options.body).reason, 'Worker node out of memory');
    assert.match(calls.at(-1).url, /\/official\/jobs\/job-99\/cancel$/);

    const requeueRes = await requeueOfficialJob('job-99', 'Retrying on healthy node');
    assert.equal(requeueRes.ok, true);
    assert.equal(calls.at(-1).options.method, 'POST');
    assert.equal(JSON.parse(calls.at(-1).options.body).reason, 'Retrying on healthy node');
    assert.match(calls.at(-1).url, /\/official\/jobs\/job-99\/requeue$/);

    // 9. Official Broadcast State & Scheduling & Viewer
    const bState = await fetchOfficialBroadcastState('round-uuid', 'g1');
    assert.equal(bState.ok, true);
    assert.match(calls.at(-1).url, /\/official\/rounds\/round-uuid\/games\/g1\/broadcast$/);

    const bSched = await scheduleOfficialBroadcast('round-uuid', 'g1', {
      startsAt: '2026-10-24T12:00:00.000Z',
      plyIntervalMs: 1500,
      releaseMode: 'full',
      state: 'scheduled',
    });
    assert.equal(bSched.ok, true);
    assert.equal(calls.at(-1).options.method, 'PUT');
    assert.equal(JSON.parse(calls.at(-1).options.body).ply_interval_ms, 1500);
    assert.match(calls.at(-1).url, /\/official\/rounds\/round-uuid\/games\/g1\/broadcast$/);

    const bViewer = await fetchOfficialGameViewer('round-uuid', 'g1', 5);
    assert.equal(bViewer.ok, true);
    assert.match(calls.at(-1).url, /\/official\/rounds\/round-uuid\/games\/g1\/viewer\?after_seq=5$/);

    // 10. Cutoff Status & Targeted Sync
    const cutoffStat = await fetchOfficialCutoffStatus('evt-1');
    assert.equal(cutoffStat.ok, true);
    assert.match(calls.at(-1).url, /\/events\/evt-1\/github-cutoff-status$/);

    const cutoffSync = await syncGithubCutoff('evt-1', { teamIds: ['team-1', 'team-2'], limit: 5 });
    assert.equal(cutoffSync.ok, true);
    assert.equal(calls.at(-1).options.method, 'POST');
    const syncBody = JSON.parse(calls.at(-1).options.body);
    assert.deepEqual(syncBody.team_ids, ['team-1', 'team-2']);
    assert.equal(syncBody.limit, 5);
    assert.match(calls.at(-1).url, /\/events\/evt-1\/github-cutoff-sync$/);

    // 11. Published APIs for Team / Members
    const pubStd = await fetchOfficialPublishedStandings('evt-1');
    assert.equal(pubStd.ok, true);
    assert.match(calls.at(-1).url, /\/events\/evt-1\/official\/published\/standings$/);

    const pubStd409 = await fetchOfficialPublishedStandings('409');
    assert.equal(pubStd409.published, false);
    assert.equal(pubStd409.error, 'round_not_published');

    const pubBrk = await fetchOfficialPublishedBracket('evt-1');
    assert.equal(pubBrk.ok, true);
    assert.match(calls.at(-1).url, /\/events\/evt-1\/official\/published\/bracket$/);

    const pubTkt = await fetchOfficialPublishedTickets('evt-1');
    assert.equal(pubTkt.ok, true);
    assert.match(calls.at(-1).url, /\/events\/evt-1\/official\/published\/tickets$/);

    const pubGames = await fetchOfficialPublishedGames('evt-1');
    assert.equal(pubGames.ok, true);
    assert.match(calls.at(-1).url, /\/events\/evt-1\/official\/published\/games$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
