import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cancelBroadcast,
  fetchEventBroadcasts,
  fetchViewerPackage,
  scheduleBroadcast,
} from '../src/tournament/portal/live/publicationApi.js';
import { setCsrfToken, resetApiState } from '../src/tournament/portal/portalApi.js';

test('publicationApi client functions call correct /api/local broadcast routes', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
    resetApiState();
  });

  setCsrfToken('test-csrf-token-broadcast');
  const calls = [];

  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (url.includes('/broadcasts/m1?afterSeq=5')) {
      return new Response(JSON.stringify({
        match_id: 'm1',
        phase: 'broadcasting',
        visible_plies: 10,
        events: [{ seq: 6 }],
      }));
    }
    if (url.includes('/events/ev1/broadcasts')) {
      return new Response(JSON.stringify({
        broadcasts: [{ match_id: 'm1', state: 'scheduled' }],
      }));
    }
    if (url.endsWith('/admin/broadcasts') && options.method === 'POST') {
      return new Response(JSON.stringify({
        broadcast: { match_id: 'm1', state: 'scheduled' },
      }));
    }
    if (url.includes('/admin/broadcasts/m1/cancel') && options.method === 'POST') {
      return new Response(JSON.stringify({
        broadcast: { match_id: 'm1', state: 'canceled' },
      }));
    }
    return new Response('{}');
  };

  // 1. fetchViewerPackage
  const pkg = await fetchViewerPackage('m1', 5);
  assert.equal(pkg.match_id, 'm1');
  assert.equal(pkg.phase, 'broadcasting');
  assert.equal(pkg.events.length, 1);

  // 2. fetchEventBroadcasts
  const list = await fetchEventBroadcasts('ev1');
  assert.equal(list.length, 1);
  assert.equal(list[0].match_id, 'm1');

  // 3. scheduleBroadcast
  const scheduled = await scheduleBroadcast({
    matchId: 'm1',
    startsAt: '2026-10-24T12:00:00.000Z',
    plyIntervalMs: 1500,
    releaseMode: 'full',
  });
  assert.equal(scheduled.broadcast.match_id, 'm1');
  const postCall = calls.find((c) => c.url.endsWith('/admin/broadcasts'));
  assert.equal(postCall.options.headers['x-csrf-token'], 'test-csrf-token-broadcast');
  const postBody = JSON.parse(postCall.options.body);
  assert.equal(postBody.match_id, 'm1');
  assert.equal(postBody.ply_interval_ms, 1500);

  // 4. cancelBroadcast
  const canceled = await cancelBroadcast('m1');
  assert.equal(canceled.broadcast.state, 'canceled');

  // Edge cases
  assert.equal(await fetchViewerPackage(null), null);
  assert.deepEqual(await fetchEventBroadcasts(null), []);
  await assert.rejects(() => scheduleBroadcast({ matchId: null }), /Cần mã ván đấu/);
  await assert.rejects(() => cancelBroadcast(null), /Cần mã ván đấu/);
});
