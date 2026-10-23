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
test('map snapshot migration freezes map per match and keeps RPC private', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261024120000_mvp_match_map_snapshot.sql', import.meta.url), 'utf8');
  assert.match(sql, /ALTER TABLE public\.mvp_matches ADD COLUMN IF NOT EXISTS map_json text/);
  assert.match(sql, /ALTER TABLE public\.mvp_matches ADD COLUMN IF NOT EXISTS map_hash text/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.mvp_stage_commit/);
  assert.match(sql, /THEN RAISE EXCEPTION 'bad_game_map'/);
  assert.match(sql, /\^\[0-9a-f\]\{64\}\$/);
  assert.match(sql, /INSERT INTO public\.mvp_matches\([^)]*map_json,map_hash\)/s);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.mvp_stage_commit\(uuid,text,text,jsonb,jsonb\) FROM PUBLIC,anon,authenticated/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.mvp_stage_commit\(uuid,text,text,jsonb,jsonb\) TO service_role/);
  assert.doesNotMatch(sql, /DROP TABLE|DROP COLUMN|SECURITY DEFINER/i);
});

});

test('GitHub intake migration keeps jobs/receipts private and idempotent', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261024130000_github_intake.sql', import.meta.url), 'utf8');
  for (const table of ['mvp_repo_connections', 'mvp_repo_sync_jobs', 'mvp_github_receipts']) {
    assert.match(sql, new RegExp(`CREATE TABLE public\\.${table}`, 'u'));
    assert.match(sql, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`, 'u'));
    assert.match(sql, new RegExp(`REVOKE ALL ON public\\.${table} FROM PUBLIC, anon, authenticated`, 'u'));
    assert.match(sql, new RegExp(`GRANT SELECT, INSERT, UPDATE ON public\\.${table} TO service_role`, 'u'));
  }
  assert.match(sql, /commit_sha text NOT NULL CHECK\(commit_sha ~ '\^\[0-9a-f\]\{40\}\$'\)/u);
  assert.match(sql, /UNIQUE\(event_id, team_id, repo_id, commit_sha, file_path\)/u);
  assert.match(sql, /status IN \('resolving','fetching','checking','valid','invalid','infrastructure','frozen'\)/u);
  assert.match(sql, /CREATE FUNCTION public\.mvp_repo_connection_upsert/u);
  assert.match(sql, /CREATE FUNCTION public\.mvp_github_intake/u);
  assert.match(sql, /'error','repo_not_approved'/u);
  assert.match(sql, /'error','quota_exceeded'/u);
  assert.match(sql, /clock_timestamp\(\)-interval '24 hours'/u);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.mvp_github_intake/u);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.mvp_github_intake\(uuid,uuid,uuid,text,text,text,bigint,text,integer\) TO service_role/u);
  assert.doesNotMatch(sql, /DROP TABLE|DROP COLUMN|SECURITY DEFINER/i);
});
