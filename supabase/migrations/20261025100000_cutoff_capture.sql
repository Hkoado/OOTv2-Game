-- Single authoritative capture. Actual resolution time is retained, not backdated.
create table public.mvp_cutoff_captures (
  event_id uuid not null references public.mvp_tournaments(id),
  team_id uuid not null references public.mvp_participants(id),
  cutoff timestamptz not null,
  policy text not null default 'cutoff-first-resolution.v1' check (policy='cutoff-first-resolution.v1'),
  connection jsonb not null,
  token uuid not null,
  lease_until timestamptz not null,
  receipt_id uuid references public.mvp_github_receipts(id),
  commit_sha text check(commit_sha ~ '^[a-f0-9]{40}$'),
  captured_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  primary key(event_id,team_id),
  check ((receipt_id is null and commit_sha is null and captured_at is null)
    or (receipt_id is not null and commit_sha is not null and captured_at is not null and captured_at>=cutoff))
);
alter table public.mvp_cutoff_captures enable row level security;
revoke all on public.mvp_cutoff_captures from public,anon,authenticated;
grant select on public.mvp_cutoff_captures to service_role;

create function public.mvp_cutoff_claim(p_event uuid,p_team uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare c mvp_cutoff_captures; r mvp_repo_connections; s jsonb; v_status text; v_cutoff timestamptz;
begin
  select status into v_status from mvp_tournaments where id=p_event for update;
  if not found then return jsonb_build_object('ok',false,'error','event_not_found'); end if;
  if v_status<>'draft' or exists(select 1 from mvp_official_rounds where event_id=p_event) then
    return jsonb_build_object('ok',false,'error','event_frozen'); end if;
  select config into s from mvp_official_setups where tournament_id=p_event;
  v_cutoff:=(s->>'cutoff')::timestamptz;
  if v_cutoff is null or clock_timestamp()<v_cutoff or (s->>'mapsPublished') is distinct from 'true' then
    return jsonb_build_object('ok',false,'error','cutoff_not_ready'); end if;
  select * into c from mvp_cutoff_captures where event_id=p_event and team_id=p_team for update;
  if found then
    if c.receipt_id is not null then return jsonb_build_object('ok',true,'pinned',true); end if;
    if c.lease_until>clock_timestamp() then return jsonb_build_object('ok',true,'busy',true); end if;
    update mvp_cutoff_captures set token=gen_random_uuid(),lease_until=clock_timestamp()+interval '60 seconds'
      where event_id=p_event and team_id=p_team returning * into c;
  else
    select * into r from mvp_repo_connections where event_id=p_event and team_id=p_team and approved for update;
    if not found or not exists(select 1 from mvp_tournament_entries where tournament_id=p_event and participant_id=p_team) then
      return jsonb_build_object('ok',false,'error','repository_not_approved'); end if;
    insert into mvp_cutoff_captures(event_id,team_id,cutoff,connection,token,lease_until)
      values(p_event,p_team,v_cutoff,to_jsonb(r),gen_random_uuid(),clock_timestamp()+interval '60 seconds') returning * into c;
  end if;
  return jsonb_build_object('ok',true,'token',c.token,'connection',c.connection);
end $$;

create function public.mvp_cutoff_pin(p_event uuid,p_team uuid,p_token uuid,p_sha text,p_actor uuid default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare c mvp_cutoff_captures; j uuid; r uuid; t timestamptz;
begin
  perform 1 from mvp_tournaments where id=p_event and status='draft' for update;
  if not found then return jsonb_build_object('ok',false,'error','event_frozen'); end if;
  select * into c from mvp_cutoff_captures where event_id=p_event and team_id=p_team for update;
  if not found then return jsonb_build_object('ok',false,'error','capture_missing'); end if;
  t:=date_trunc('milliseconds',clock_timestamp());
  if c.receipt_id is not null then return jsonb_build_object('ok',true,'already_pinned',true,'receipt_id',c.receipt_id); end if;
  if c.token is distinct from p_token or c.lease_until<=t then
    return jsonb_build_object('ok',false,'error','capture_lease_lost'); end if;
  if p_sha is null or p_sha !~ '^[a-f0-9]{40}$' then return jsonb_build_object('ok',false,'error','bad_sha'); end if;
  if exists(select 1 from mvp_official_rounds where event_id=p_event) then
    return jsonb_build_object('ok',false,'error','event_frozen'); end if;
  select id into j from mvp_repo_sync_jobs where event_id=p_event and team_id=p_team
    and repo_id=(c.connection->>'repo_id')::bigint and commit_sha=p_sha and file_path='bot.py';
  if j is null then
    j:=gen_random_uuid();
    insert into mvp_repo_sync_jobs(id,event_id,team_id,repo_id,repository,branch,file_path,commit_sha,requested_by)
      values(j,p_event,p_team,(c.connection->>'repo_id')::bigint,c.connection->>'repository',c.connection->>'branch','bot.py',p_sha,p_actor);
  end if;
  select id into r from mvp_github_receipts where job_id=j;
  if r is null then
    r:=gen_random_uuid();
    insert into mvp_github_receipts(id,job_id,event_id,team_id,repo_id,repository,branch,file_path,commit_sha,status,resolved_at)
      values(r,j,p_event,p_team,(c.connection->>'repo_id')::bigint,c.connection->>'repository',c.connection->>'branch','bot.py',p_sha,'resolving',t);
  end if;
  update mvp_cutoff_captures set receipt_id=r,commit_sha=p_sha,captured_at=t
    where event_id=p_event and team_id=p_team;
  return jsonb_build_object('ok',true,'already_pinned',false,'receipt_id',r);
end $$;

-- All paths changing capture context serialize on the same event row.
create function public.mvp_cutoff_lock_context() returns trigger language plpgsql
set search_path=public,pg_temp as $$
declare e uuid;
begin
  if TG_TABLE_NAME='mvp_repo_connections' then
    if TG_OP='UPDATE' and (old.event_id<>new.event_id or old.team_id<>new.team_id) then
      raise exception 'capture_context_identity_immutable' using errcode='40001'; end if;
    if TG_OP='INSERT' then e:=new.event_id; else e:=old.event_id; end if;
  else
    if TG_OP='UPDATE' and old.tournament_id<>new.tournament_id then
      raise exception 'capture_context_identity_immutable' using errcode='40001'; end if;
    if TG_OP='INSERT' then e:=new.tournament_id; else e:=old.tournament_id; end if;
  end if;
  perform 1 from mvp_tournaments where id=e for update;
  if exists(select 1 from mvp_cutoff_captures where event_id=e) then
    raise exception 'cutoff_capture_locked' using errcode='40001'; end if;
  if TG_OP='DELETE' then return old; else return new; end if;
end $$;
create trigger cutoff_setup_lock before insert or update or delete on public.mvp_official_setups
  for each row execute function public.mvp_cutoff_lock_context();
create trigger cutoff_roster_lock before insert or update or delete on public.mvp_tournament_entries
  for each row execute function public.mvp_cutoff_lock_context();
create trigger cutoff_repository_lock before insert or update or delete on public.mvp_repo_connections
  for each row execute function public.mvp_cutoff_lock_context();

-- Opening a captured round serializes with capture/context changes, and rechecks
-- exact provenance inside the write transaction (the API's reads are not a lock).
create function public.mvp_cutoff_verify_round() returns trigger language plpgsql
set search_path=public,pg_temp as $$
declare b jsonb; c mvp_cutoff_captures; r mvp_github_receipts; s mvp_submissions;
begin
  perform 1 from mvp_tournaments where id=new.event_id for update;
  if not exists(select 1 from mvp_cutoff_captures where event_id=new.event_id)
    and not exists(select 1 from jsonb_array_elements(new.snapshot->'bots') bot
      where bot->>'capturePolicy'='cutoff-first-resolution.v1') then return new; end if;
  if (select count(*) from mvp_tournament_entries where tournament_id=new.event_id)
    <>jsonb_array_length(new.snapshot->'bots') then raise exception 'capture_roster_mismatch'; end if;
  for b in select * from jsonb_array_elements(new.snapshot->'bots') loop
    select * into c from mvp_cutoff_captures where event_id=new.event_id and team_id=(b->>'participantId')::uuid;
    if not found or c.receipt_id is null or c.policy is distinct from b->>'capturePolicy'
      or c.cutoff is distinct from (new.snapshot->>'cutoff')::timestamptz
      or c.captured_at is distinct from (b->>'resolvedAt')::timestamptz
      or c.commit_sha is distinct from b->>'commitSha'
      or c.receipt_id::text is distinct from b->>'receiptId' then raise exception 'capture_mismatch'; end if;
    select * into r from mvp_github_receipts where id=c.receipt_id for share;
    if not found or r.status<>'valid' or r.team_id<>c.team_id or r.event_id<>c.event_id
      or r.commit_sha<>c.commit_sha or r.repo_id::text is distinct from b->>'repositoryId'
      or r.submission_id::text is distinct from b->>'submissionId'
      or r.source_hash is distinct from b->>'sourceSha256' then raise exception 'receipt_mismatch'; end if;
    select * into s from mvp_submissions where id=r.submission_id for share;
    if not found or s.status<>'valid' or s.participant_id<>c.team_id
      or s.sha256 is distinct from r.source_hash or s.storage_path is distinct from b->>'artifactKey'
      then raise exception 'submission_mismatch'; end if;
    if not exists(select 1 from mvp_tournament_entries where tournament_id=new.event_id and participant_id=c.team_id)
      then raise exception 'capture_roster_mismatch'; end if;
  end loop;
  return new;
end $$;
create trigger cutoff_verify_round before insert on public.mvp_official_rounds
  for each row execute function public.mvp_cutoff_verify_round();

revoke all on function public.mvp_cutoff_claim(uuid,uuid) from public,anon,authenticated;
revoke all on function public.mvp_cutoff_pin(uuid,uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.mvp_cutoff_claim(uuid,uuid) to service_role;
grant execute on function public.mvp_cutoff_pin(uuid,uuid,uuid,text,uuid) to service_role;
notify pgrst,'reload schema';