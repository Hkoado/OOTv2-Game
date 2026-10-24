import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchOfficialRound,
  openOfficialRound,
  syncGithubCutoff,
  fetchOfficialProgress,
  fetchOfficialStandings,
  publishNextOfficialGame,
  freezeOfficialRound,
  fetchOfficialBracket,
  openNextKnockoutSeries,
  fetchOfficialTickets,
  cancelOfficialJob,
  requeueOfficialJob,
} from '../src/tournament/portal/officialRoundApi.js';

test('officialRoundApi input validations', async () => {
  // Missing eventId returns null for fetch or throws for mutation
  assert.equal(await fetchOfficialRound(''), null);
  assert.equal(await fetchOfficialProgress(''), null);
  assert.equal(await fetchOfficialStandings(''), null);
  assert.equal(await fetchOfficialBracket(''), null);
  assert.equal(await fetchOfficialTickets(''), null);

  await assert.rejects(() => openOfficialRound(''), /Cần mã giải/);
  await assert.rejects(() => syncGithubCutoff(''), /Cần mã giải/);
  await assert.rejects(() => publishNextOfficialGame(''), /Cần mã giải/);
  await assert.rejects(() => freezeOfficialRound(''), /Cần mã giải/);
  await assert.rejects(() => openNextKnockoutSeries(''), /Cần mã giải/);

  // Job operations require jobId and reason 5..400 chars
  await assert.rejects(() => cancelOfficialJob('', 'valid reason'), /Cần mã job/);
  await assert.rejects(() => cancelOfficialJob('job-1', 'four'), /5 đến 400 ký tự/);
  await assert.rejects(() => cancelOfficialJob('job-1', 'a'.repeat(401)), /5 đến 400 ký tự/);

  await assert.rejects(() => requeueOfficialJob('', 'valid reason'), /Cần mã job/);
  await assert.rejects(() => requeueOfficialJob('job-1', '123'), /5 đến 400 ký tự/);
  await assert.rejects(() => requeueOfficialJob('job-1', 'a'.repeat(401)), /5 đến 400 ký tự/);
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
        text: async () => JSON.stringify({ error: { code: 'conflict', message: 'Incomplete' } }),
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
  } finally {
    globalThis.fetch = originalFetch;
  }
});
