import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../supabase/migrations/20261022122359_campus_foundation.sql', import.meta.url), 'utf8');
const smoke = readFileSync(new URL('../supabase/tests/foundation.sql', import.meta.url), 'utf8');
const tables = ['players', 'teams', 'team_members', 'tournaments', 'tournament_entries', 'submissions', 'rounds', 'round_entries', 'maps', 'round_maps', 'matches', 'games', 'audit_logs'];

// Static guardrails only. Actual PostgreSQL validation is supabase/tests/foundation.sql.
test('Supabase migration creates exactly the 13 documented tables', () => {
  const found = [...sql.matchAll(/CREATE TABLE public\.(\w+)/g)].map((match) => match[1]);
  assert.deepEqual(found.sort(), [...tables].sort());
  for (const table of tables) assert.ok(sql.includes(`'${table}'`), `${table} must be in the RLS/grant loop`);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /REVOKE ALL ON TABLE public\.%I FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(sql, /REVOKE UPDATE, DELETE ON public\.audit_logs FROM service_role/);
  assert.doesNotMatch(sql, /DROP TABLE|ON DELETE CASCADE|SECURITY DEFINER/i);
});

test('Supabase migration preserves cross-team and cross-round constraints', () => {
  assert.match(sql, /FOREIGN KEY \(submission_id, team_id\)/);
  assert.match(sql, /FOREIGN KEY \(entry_id, tournament_id, team_id\)/);
  assert.match(sql, /FOREIGN KEY \(round_id, map_id\)/);
  assert.match(sql, /CREATE TRIGGER games_pair/);
  assert.match(sql, /CREATE TRIGGER round_entries_guard/);
  assert.match(sql, /BETWEEN 1 AND 262144/);
});

test('judge monitor migration keeps match logs private and bounded', () => {
  const judge = readFileSync(new URL('../supabase/migrations/20261022150000_judge_monitor.sql', import.meta.url), 'utf8');
  assert.match(judge, /CREATE TABLE public\.mvp_match_logs/);
  assert.match(judge, /match_id\s+uuid PRIMARY KEY REFERENCES public\.mvp_matches\(id\)/);
  assert.match(judge, /ENABLE ROW LEVEL SECURITY/);
  assert.match(judge, /REVOKE ALL ON public\.mvp_match_logs FROM PUBLIC, anon, authenticated/);
  assert.match(judge, /GRANT SELECT, INSERT, UPDATE ON public\.mvp_match_logs TO service_role/);
  assert.match(judge, /length\(notes_json\) BETWEEN 2 AND 16384/);
  assert.match(judge, /elapsed_ms integer CHECK\(elapsed_ms IS NULL OR elapsed_ms >= 0\)/);
});

test('Postgres smoke tests are transactional and test actual client roles', () => {
  assert.match(smoke, /BEGIN;/);
  assert.match(smoke, /ROLLBACK;/);
  assert.match(smoke, /SET LOCAL ROLE anon;/);
  assert.match(smoke, /SET LOCAL ROLE authenticated;/);
  assert.match(smoke, /rejected <> 11/);
  assert.doesNotMatch(smoke, /\bCOMMIT\s*;/);
});