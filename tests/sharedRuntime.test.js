import test from 'node:test';
import assert from 'node:assert/strict';
import { rows, request, sharedEnabled } from '../server/shared/client.js';
import { hashBuffer, materialize } from '../server/shared/artifacts.js';
import { standingsFrom, seriesFrom } from '../server/shared/tournaments.js';

test('shared client: test mode stays offline; pagination keeps one select', async () => {
  assert.equal(sharedEnabled, false);
  const original = globalThis.fetch;
  const oldUrl = process.env.SUPABASE_URL, oldKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = 'https://example.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only';
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify(calls.length === 1 ? Array.from({ length: 1000 }, (_, id) => ({ id })) : [{ id: 1000 }]));
  };
  try {
    assert.equal((await rows('matches', 'select=id&order=id')).length, 1001);
    assert.equal(new URL(calls[0].url).searchParams.getAll('select').length, 1);
    assert.equal(calls[1].options.headers.Range, '1000-1999');
    globalThis.fetch = async () => { throw new Error('offline'); };
    await assert.rejects(request('/rest/v1/mvp_imports'), { status: 503, code: 'database_unavailable' });
    const bytes = Buffer.from('print("trusted test")\n');
    globalThis.fetch = async () => new Response(bytes);
    await assert.rejects(materialize({ storage_path: '00000000-0000-0000-0000-000000000001.py', sha256: '0'.repeat(64) }), /integrity/);
    assert.equal(hashBuffer(bytes).length, 64);
  } finally {
    globalThis.fetch = original;
    if (oldUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = oldKey;
  }
});

test('shared standings and knockout preserve MVP scoring and seed tie-break', () => {
  const entries = [1, 2].map((n) => ({ id: `e${n}`, participant_id: `p${n}`, participant_name: `Team ${n}`, seed_order: n, group_name: 'A' }));
  const matches = [1, 2].map((n) => ({ id: `m${n}`, stage: 'group', series_id: 's1', game_no: n, red_entry_id: 'e1', blue_entry_id: 'e2', status: 'finished', result: n === 1 ? 'red_win' : 'blue_win' }));
  const data = { event: { id: 'event', status: 'group_running' }, entries, matches };
  const standings = standingsFrom(data);
  assert.equal(standings.groups.A[0].entry_id, 'e1');
  assert.equal(standings.groups.A[0].points, 3);
  assert.equal(standings.group_stage_complete, true);
  assert.equal(seriesFrom({ ...data, matches: matches.map((m) => ({ ...m, stage: 'final' })) }, 'final')[0].winner_entry_id, 'e1');
});