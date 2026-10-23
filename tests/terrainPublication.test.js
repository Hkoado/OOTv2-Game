import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCompetition } from '../src/game/competition.js';

test('published terrain maps are saved with hashes, locked against changes and never call real Supabase', async (t) => {
  const previous = { fetch: globalThis.fetch, url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };
  process.env.SUPABASE_URL = 'https://example.invalid'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'test';
  t.after(() => {
    globalThis.fetch = previous.fetch;
    for (const [key, value] of [['SUPABASE_URL', previous.url], ['SUPABASE_SERVICE_ROLE_KEY', previous.key]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  let current = normalizeCompetition({ mapPackVersion: 'week-1' }), saved;
  globalThis.fetch = async (url, options = {}) => {
    const target = new URL(url); assert.equal(target.origin, 'https://example.invalid');
    if (target.pathname.endsWith('/rpc/mvp_official_draft_save')) {
      saved = JSON.parse(options.body); current = saved.p_config; return new Response('null');
    }
    assert.ok(target.pathname.endsWith('/mvp_official_setups'));
    return new Response(JSON.stringify([{ config: current }]));
  };
  const { saveOfficialSetup, officialView } = await import('../server/shared/officialSetup.js');
  const id = '10000000-0000-4000-8000-000000000001';
  await saveOfficialSetup({ id, name: 'Week', competition: { ...current, mapsPublished: true }, expected: 0 });
  assert.equal(saved.p_config.mapsPublished, true);
  assert.equal(saved.p_config.primaryMap.rulesVersion, 'ott-campus.v2');
  assert.match(officialView({ seed: 1, entries: [] }, current).map_publication.primaryHash, /^[a-f0-9]{64}$/);
  for (const competition of [{ ...current, mapsPublished: false }, { ...current, mapPackVersion: 'changed' },
    { ...current, primaryMap: { ...current.primaryMap, revision: 2 } }]) {
    await assert.rejects(saveOfficialSetup({ id, name: 'Week', competition, expected: 1 }), { code: 'map_pack_locked' });
  }
});