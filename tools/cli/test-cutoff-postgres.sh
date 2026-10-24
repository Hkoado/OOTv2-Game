#!/usr/bin/env bash
# Disposable LOCAL PostgreSQL contract test; not a Supabase integration substitute.
# Run as root on a dev Linux/WSL host with PostgreSQL and runuser installed.
# Existing databases and roles are never dropped; only our random database is removed.
set -euo pipefail
cd "$(dirname "$0")/../.."
DB="ootv2_capture_test_$(date +%s)_$$"
runuser -u postgres -- createdb "$DB"
WORK="$(mktemp -d)"
trap 'runuser -u postgres -- dropdb "$DB"; rm -rf "$WORK"' EXIT
runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 "$DB" <<'SQL'
do $$ begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
end $$;
create extension if not exists pgcrypto;
-- Deliberately minimal base schema: exact production constraints need remote tests,
-- while the three real migrations below provide the contracts under test.
create table mvp_participants(id uuid primary key,name text,name_key text,created_at timestamptz);
create table mvp_tournaments(id uuid primary key,name text,status text,seed bigint,created_at timestamptz);
create table mvp_tournament_entries(id uuid primary key,tournament_id uuid,participant_id uuid,seed_order integer);
create table mvp_official_setups(tournament_id uuid primary key,config jsonb);
create table mvp_submissions(id uuid primary key,participant_id uuid,status text,sha256 text,storage_path text);
SQL
for migration in 20261024130000_github_intake 20261025090000_official_schedule 20261025100000_cutoff_capture; do
  runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 "$DB" -f "supabase/migrations/$migration.sql"
done
runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 "$DB" -f supabase/tests/cutoff_capture.sql
# Two independent PostgreSQL sessions contend for the same event/team. The first
# keeps its transaction open so the second must wait, then observe busy or pinned.
runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 "$DB" <<'SQL'
insert into mvp_participants(id,name,name_key,created_at)
values('00000000-0000-4000-8000-00000000ca01','Race','race',now());
insert into mvp_tournaments(id,name,status,seed,created_at)
values('00000000-0000-4000-8000-00000000ce01','Race','draft',1,now());
insert into mvp_tournament_entries(id,tournament_id,participant_id,seed_order)
values(gen_random_uuid(),'00000000-0000-4000-8000-00000000ce01','00000000-0000-4000-8000-00000000ca01',1);
insert into mvp_official_setups(tournament_id,config)
values('00000000-0000-4000-8000-00000000ce01',jsonb_build_object('cutoff',now()-interval '1 hour','mapsPublished',true));
insert into mvp_repo_connections(id,event_id,team_id,repo_id,repository,branch,approved)
values(gen_random_uuid(),'00000000-0000-4000-8000-00000000ce01','00000000-0000-4000-8000-00000000ca01',992,
 'https://github.com/example/race','main',true);
SQL
cat > "$WORK/writer.sql" <<'SQL'
begin;
do $$ declare r jsonb; begin
  r:=mvp_cutoff_claim('00000000-0000-4000-8000-00000000ce01','00000000-0000-4000-8000-00000000ca01');
  perform pg_sleep(1);
  if r->>'token' is not null then
    r:=mvp_cutoff_pin('00000000-0000-4000-8000-00000000ce01','00000000-0000-4000-8000-00000000ca01',
      (r->>'token')::uuid,repeat('a',40));
    if r->>'ok'<>'true' then raise exception 'pin race failed'; end if;
  elsif coalesce(r->>'busy',r->>'pinned','false')<>'true' then raise exception 'unexpected claim: %',r;
  end if;
end $$;
commit;
SQL
# SQL is non-secret and must be readable by the local postgres OS user.
chmod 755 "$WORK"
chmod 644 "$WORK/writer.sql"
runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 "$DB" -f "$WORK/writer.sql" > "$WORK/one.log" 2>&1 &
ONE=$!
runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 "$DB" -f "$WORK/writer.sql" > "$WORK/two.log" 2>&1 &
TWO=$!
wait "$ONE" || { cat "$WORK/one.log"; exit 1; }
wait "$TWO" || { cat "$WORK/two.log"; exit 1; }
runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 "$DB" <<'SQL'
do $$ begin
  if (select count(*) from mvp_cutoff_captures)<>1
    or (select count(*) from mvp_repo_sync_jobs)<>1
    or (select count(*) from mvp_github_receipts)<>1 then raise exception 'race produced duplicate or missing capture'; end if;
  raise notice 'PASS two independent PostgreSQL sessions: one authoritative pin/job/receipt';
end $$;
SQL
echo POSTGRES_CAPTURE_PASS