import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeCompetition, drawCompetition, competitionPreview } from '../src/game/competition.js';
import { EMPTY_MAP } from '../src/game/maps.js';

const ids = (count) => Array.from({ length: count }, (_, i) => `10000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const configured = { cutoff: '2026-11-01T20:00:00+07:00', mapPackVersion: 'week-1' };

for (const [count, pairs] of [[35, 60], [40, 80], [48, 120], [50, 132]]) {
  test(`official weekly ${count}: balanced 8 groups, ${pairs * 2} games, no missing/duplicate team`, () => {
    const roster = ids(count), before = [...roster];
    const preview = competitionPreview(roster, 1234, configured);
    assert.equal(preview.groupCount, 8);
    assert.equal(preview.qualifierPairs, pairs);
    assert.equal(preview.qualifierGames, pairs * 2);
    assert.equal(preview.finalists, 16);
    assert.equal(preview.setupReady, true);
    assert.equal(preview.executionReady, false);
    assert.deepEqual(preview.groups.flatMap((group) => group.participantIds).sort(), [...roster].sort());
    const sizes = preview.groups.map((group) => group.participantIds.length);
    assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1);
    assert.deepEqual(preview, competitionPreview([...roster].reverse(), 1234, configured));
    assert.deepEqual(roster, before);
  });
}

test('official count thresholds, bounds and explicit friendly event', () => {
  for (const [count, groups, finalists] of [[4, 1, 4], [7, 1, 4], [8, 2, 4], [15, 2, 4], [16, 4, 8], [31, 4, 8], [32, 8, 16], [56, 8, 16]]) {
    const result = drawCompetition(ids(count), 0);
    assert.equal(result.groupCount, groups); assert.equal(result.finalists, finalists);
  }
  assert.equal(drawCompetition(ids(3), 1).eligible, false);
  assert.throws(() => drawCompetition(ids(57), 1), /56/);
  assert.throws(() => drawCompetition(['a', 'a'], 1), /trùng/);
  assert.throws(() => drawCompetition(ids(4), -1), /uint32/);
  assert.notDeepEqual(drawCompetition(ids(50), 1).drawOrder, drawCompetition(ids(50), 2).drawOrder);
});

test('monthly/semester setup does not invent ticket seeds or fake bye games', () => {
  const monthly = competitionPreview(ids(8), 1, { ...configured, level: 'monthly' });
  assert.equal(monthly.bracketSize, 8); assert.equal(monthly.groupCount, 0);
  assert.equal(monthly.seeding, 'ticket-achievement-required');
  const semester = competitionPreview(ids(6), 1, { ...configured, level: 'semester', monthsPerSemester: 3 });
  assert.equal(semester.byes, 2); assert.equal(semester.qualifierGames, 0);
  assert.equal(semester.knockout.finalGames, 6); assert.equal(semester.knockout.extraGamesIfTied, 2);
  assert.equal(semester.executionReady, false);
  assert.equal(competitionPreview(ids(6), 1, { ...configured, level: 'monthly' }).setupReady, false);
});

test('official contract validates dates, maps, level and calendar', () => {
  const normalized = normalizeCompetition(configured);
  assert.equal(normalized.cutoff, '2026-11-01T13:00:00.000Z');
  assert.deepEqual(normalized.primaryMap, EMPTY_MAP);
  assert.throws(() => normalizeCompetition({ cutoff: '2026-11-01T20:00' }), /múi giờ/);
  assert.throws(() => normalizeCompetition({ level: 'mvp' }), /Cấp giải/);
  assert.throws(() => normalizeCompetition({ monthsPerSemester: 5 }), /3 hoặc 4/);
  assert.throws(() => normalizeCompetition({ primaryMap: { bad: true } }));
  assert.equal(competitionPreview(ids(4), 1, {}).setupReady, false);
});

test('Supabase official setup API persists 50 teams; legacy start fails closed before enqueue', async (t) => {
  const oldFetch = globalThis.fetch, oldUrl = process.env.SUPABASE_URL, oldKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = 'https://example.invalid'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only';
  t.after(() => {
    globalThis.fetch = oldFetch;
    if (oldUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = oldKey;
  });
  const config = normalizeCompetition(configured), calls = [];
  let saved;
  globalThis.fetch = async (url, options = {}) => {
    const target = new URL(url);
    assert.equal(target.origin, 'https://example.invalid');
    calls.push(target.pathname);
    if (target.pathname.endsWith('/rpc/mvp_official_draft_save')) {
      saved = JSON.parse(options.body);
      return new Response('null');
    }
    const table = target.pathname.replace('/rest/v1/mvp_', '');
    const data = {
      official_setups: [{ tournament_id: ids(1)[0], config }],
      tournaments: [{ id: ids(1)[0], name: 'Week', status: 'draft', version: 0, seed: 42, map_json: JSON.stringify(EMPTY_MAP) }],
      tournament_entries: ids(50).map((id, i) => ({ id, participant_id: id, seed_order: i + 1 })),
      participants: ids(50).map((id) => ({ id, name: id })), matches: [], submissions: [],
    };
    assert.ok(Object.hasOwn(data, table), `unexpected ${table}`);
    return new Response(JSON.stringify(data[table]));
  };
  const { saveOfficialSetup } = await import('../server/shared/officialSetup.js');
  const { getTournament, startTournament, updateTournamentDraft } = await import('../server/shared/tournaments.js');
  await saveOfficialSetup({ name: 'Week', participantIds: ids(50), competition: configured });
  assert.equal(saved.p_entries.length, 50);
  assert.equal(saved.p_config.schemaVersion, 'campus-setup.v1');
  const event = await getTournament(ids(1)[0]);
  assert.equal(event.setup_preview.qualifierGames, 264);
  await assert.rejects(updateTournamentDraft(ids(1)[0], { participantIds: ids(40), competition: configured, expectedVersion: 1 }), { code: 'event_conflict' });
  await updateTournamentDraft(ids(1)[0], { participantIds: ids(40), competition: configured, expectedVersion: 0 });
  assert.equal(saved.p_expected, 0); assert.equal(saved.p_entries.length, 40);
  await assert.rejects(startTournament(ids(1)[0]), { code: 'official_scheduler_not_ready' });
  assert.ok(!calls.some((path) => path.endsWith('/mvp_stage_commit')));
});

test('official migration is additive, private and blocks MVP execution', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261023160000_official_setup.sql', import.meta.url), 'utf8');
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /BETWEEN 1 AND 56/);
  assert.match(sql, /FOR UPDATE/);
  assert.match(sql, /v.version<>p_expected/);
  assert.match(sql, /official_scheduler_not_ready/);
  assert.doesNotMatch(sql, /DROP TABLE|SECURITY DEFINER|INSERT INTO public\.mvp_matches/);
});