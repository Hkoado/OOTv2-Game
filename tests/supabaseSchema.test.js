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

test('broadcast schedule migration keeps publication private', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261024150000_broadcast_schedule.sql', import.meta.url), 'utf8');
  assert.match(sql, /CREATE TABLE public\.mvp_match_broadcasts/u);
  assert.match(sql, /match_id uuid PRIMARY KEY REFERENCES public\.mvp_matches\(id\)/u);
  assert.match(sql, /state text NOT NULL DEFAULT 'scheduled' CHECK\(state IN \('scheduled','canceled','ended'\)\)/u);
  assert.match(sql, /ply_interval_ms integer NOT NULL DEFAULT 2000 CHECK\(ply_interval_ms BETWEEN 250 AND 60000\)/u);
  assert.match(sql, /release_mode text NOT NULL DEFAULT 'window' CHECK\(release_mode IN \('window','full'\)\)/u);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/u);
  assert.match(sql, /REVOKE ALL ON public\.mvp_match_broadcasts FROM PUBLIC, anon, authenticated/u);
  assert.match(sql, /GRANT SELECT, INSERT, UPDATE ON public\.mvp_match_broadcasts TO service_role/u);
  assert.doesNotMatch(sql, /DROP TABLE|SECURITY DEFINER|ADD COLUMN status/i);
});


test('github jobs migration fixes previous submission and defines lease contract', () => {
  const base = readFileSync(new URL('../supabase/migrations/20261024130000_github_intake.sql', import.meta.url), 'utf8');
  assert.match(base, /SELECT submission_id INTO previous FROM public\.mvp_github_receipts/u);
  assert.match(base, /status='valid' AND submission_id IS NOT NULL/u);

  const sql = readFileSync(new URL('../supabase/migrations/20261024160000_github_jobs_worker.sql', import.meta.url), 'utf8');
  assert.match(sql, /ADD COLUMN IF NOT EXISTS generation integer NOT NULL DEFAULT 0/u);
  const signatures = [
    'mvp_github_intake(uuid,uuid,uuid,text,text,text,bigint,text,integer)',
    'mvp_github_claim(text,integer)',
    'mvp_github_heartbeat(uuid,uuid,integer,integer)',
    'mvp_github_progress(uuid,uuid,integer,text,text)',
    'mvp_github_finish(uuid,uuid,integer,jsonb)',
    'mvp_github_release(uuid,uuid,integer,text,integer)',
  ];
  for (const signature of signatures) {
    assert.ok(sql.includes(`GRANT EXECUTE ON FUNCTION public.${signature} TO service_role`), `grant thiếu: ${signature}`);
    assert.ok(sql.includes(`REVOKE ALL ON FUNCTION public.${signature} FROM PUBLIC,anon,authenticated`), `revoke thiếu: ${signature}`);
  }
  assert.match(sql, /lease_token=p_token AND generation=p_generation/u);
  assert.match(sql, /status IN \('leased','running'\) AND lease_until>clock_timestamp\(\)/u);
  assert.match(sql, /SELECT submission_id INTO previous/u);
  assert.match(sql, /make_interval\(secs=>LEAST\(300, 15\*GREATEST\(attempt,1\)\)\)/u);
  assert.doesNotMatch(sql, /SECURITY DEFINER|DROP TABLE/i);
});


test('github hardening migration: lease expiry, idempotent finish, reclaim cap, revoke', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261024170000_github_jobs_hardening.sql', import.meta.url), 'utf8');

  // release BẮT BUỘC lease còn hạn; claim hủy job crash quá số lần.
  assert.match(sql, /AND status IN \('leased','running'\) AND lease_until>clock_timestamp\(\)/u);
  assert.match(sql, /job\.attempt >= v_max/u);
  // Alias bảng phải khác biến PL/pgSQL `j` trong claim (PostgreSQL 42702 ambiguous);
  // các hàm chỉ khai báo `v`/`c` vẫn dùng alias `j` bình thường.
  assert.match(sql, /FROM public\.mvp_repo_sync_jobs job/u);
  assert.match(sql, /UPDATE public\.mvp_repo_sync_jobs job/u);
  // Nền 20261024160000 đã tạo hàm cũ: finish đổi return type -> phải DROP trước (42P13),
  // claim 2 tham số cũ phải bỏ để PostgREST chỉ thấy bản 3 tham số.
  assert.match(sql, /DROP FUNCTION IF EXISTS public\.mvp_github_finish\(uuid,uuid,integer,jsonb\)/u);
  assert.match(sql, /DROP FUNCTION IF EXISTS public\.mvp_github_claim\(text,integer\)/u);
  assert.match(sql, /status='infra_fault'/u);

  // finish idempotent + kiểm submission có sẵn đúng đội/valid/hash.
  assert.match(sql, /'applied',false,'already_finished',true/u);
  assert.match(sql, /s\.status='valid' AND s\.sha256=v_hash/u);
  assert.match(sql, /IF j\.lease_token IS DISTINCT FROM p_token OR j\.generation<>p_generation/u);

  // thu hồi repo: approved=false, hủy job chờ, đóng băng receipt chưa kết thúc.
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.mvp_repo_connection_revoke/u);
  assert.match(sql, /SET status='canceled'/u);
  assert.match(sql, /SET status='frozen'/u);

  for (const signature of [
    'mvp_github_claim(text,integer,integer)',
    'mvp_github_finish(uuid,uuid,integer,jsonb)',
    'mvp_github_release(uuid,uuid,integer,text,integer)',
    'mvp_repo_connection_upsert(uuid,uuid,text,bigint,text,text,boolean,uuid)',
    'mvp_repo_connection_revoke(uuid,uuid,uuid)',
  ]) {
    assert.ok(sql.includes(`GRANT EXECUTE ON FUNCTION public.${signature} TO service_role`), `grant thiếu: ${signature}`);
    assert.ok(sql.includes(`REVOKE ALL ON FUNCTION public.${signature} FROM PUBLIC,anon,authenticated`), `revoke thiếu: ${signature}`);
  }
  assert.doesNotMatch(sql, /SECURITY DEFINER|DROP TABLE|DROP COLUMN/i);
});

test('manual final migration: 6 bảng RLS, quyền hẹp, RPC nguyên tử và không phá dữ liệu', () => {
  const manual = readFileSync(new URL('../supabase/migrations/20261026100000_manual_final.sql', import.meta.url), 'utf8');
  const tables = ['mvp_manual_final_events', 'mvp_manual_final_teams', 'mvp_manual_final_submissions',
    'mvp_manual_final_matches', 'mvp_manual_final_jobs', 'mvp_manual_final_audit'];
  const found = [...manual.matchAll(/create table public\.(\w+)/gu)].map((match) => match[1]);
  assert.deepEqual(found.sort(), [...tables].sort());
  assert.match(manual, /create unique index/iu);
  assert.doesNotMatch(manual, /drop table|on delete cascade/iu);

  // Đợt mới chỉ dùng map v2 + runtime chính thức; manual có intake_mode riêng.
  assert.match(manual, /intake_mode text not null default 'manual_final'/u);
  assert.match(manual, /map_json->>'schemaVersion' = 'map\.v2'/u);
  assert.match(manual, /runtime_json->>'runtimeVersion' = 'campus-runtime\.v1'/u);
  assert.match(manual, /byte_size between 1 and 262144/iu);
  assert.match(manual, /storage_path text not null unique/iu);

  // RLS + deny-by-default cho cả service_role (bảng mới thừa hưởng default privileges Supabase).
  for (const table of tables) assert.ok(manual.includes(`'${table}'`), `${table} phải nằm trong vòng RLS/grant`);
  assert.match(manual, /alter table public\.%I enable row level security/iu);
  assert.match(manual, /revoke all on table public\.%I from public,anon,authenticated,service_role/iu);

  // Không UPDATE toàn bảng trên bài/trận; chỉ đợt mới được đổi cột trạng thái.
  assert.doesNotMatch(manual, /grant (select, )?insert,? update on public\.mvp_manual_final_(submissions|matches)/iu);
  assert.doesNotMatch(manual, /update on public\.mvp_manual_final_submissions/iu);
  assert.match(manual, /grant update \(status, closed_at, updated_at\) on public\.mvp_manual_final_events/iu);
  assert.match(manual, /revoke update, delete on public\.mvp_manual_final_audit from service_role/iu);
  assert.match(manual, /manual_final_audit_append_only/u);

  // Khóa/chọn/chấm/claim đều qua RPC SECURITY DEFINER có search_path rỗng.
  const signatures = [
    'public.mvp_manual_final_select(uuid,uuid)',
    'public.mvp_manual_final_lock(uuid,uuid,uuid)',
    'public.mvp_manual_final_pair(jsonb,uuid)',
    'public.mvp_manual_final_cancel(uuid,uuid,text)',
    'public.mvp_manual_final_claim(text,integer,integer)',
    'public.mvp_manual_final_finish(uuid,uuid,integer,jsonb)',
    'public.mvp_manual_final_release(uuid,uuid,integer,text,integer)',
  ];
  // Grant/revoke đi qua vòng lặp `foreach fn in array [...]` với format(%s).
  assert.match(manual, /foreach fn in array array\[/iu);
  for (const signature of signatures) {
    assert.ok(manual.includes(`'${signature}'`), `thiếu khai báo grant/revoke: ${signature}`);
  }
  assert.match(manual, /grant execute on function %s to service_role/iu);
  assert.match(manual, /revoke all on function %s from public,anon,authenticated/iu);
  assert.match(manual, /security definer set search_path = ''/iu);
  assert.match(manual, /for update skip locked/iu);
  assert.match(manual, /mvp_manual_final_one_accepted/u);
  assert.match(manual, /mvp_manual_final_job_target/u);

  // finish: duplicate (already_finished) phải trả trước khi kiểm lease để retry không ghi lần 2.
  const finish = manual.slice(manual.indexOf('create function public.mvp_manual_final_finish'));
  const already = finish.indexOf('already_finished');
  const lease = finish.indexOf("'lease_lost'");
  assert.ok(already > -1 && lease > -1 && already < lease, 'already_finished phải được kiểm trước lease');

  // Lỗi hạ tầng retry cùng input; hủy không xóa audit; một ván chỉ một kết quả accepted.
  assert.match(manual, /available_at = clock_timestamp\(\) \+ make_interval/iu);
  assert.match(manual, /status = 'canceled', canceled_at = clock_timestamp\(\)/iu);
  assert.match(manual, /where status = 'finished'/iu);
});
