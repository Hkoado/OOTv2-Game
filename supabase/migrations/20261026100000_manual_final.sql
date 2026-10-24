-- Chung kết thủ công (manual final intake) — additive, tách khỏi intake GitHub online.
-- CHƯA apply remote trong commit này. Thứ tự đúng: apply migration qua migration history,
-- chạy rehearsal `npm run db:manual` (transaction + rollback) rồi mới bật UI admin.
--
-- Ranh giới:
-- - API chỉ đọc bằng PostgREST; thay đổi cần nguyên tử/fence đi qua SECURITY DEFINER function
--   (`select`/`lock`/`pair`/`cancel`/`claim`/`finish`/`release`).
-- - Column-level grant chặn REST sửa bytes/hash/snapshot/accepted result.
-- - Không có runner thứ hai: job `validate`/`match` dùng chung claim/finish của worker Khoa.
-- - Manual không giả receipt/SHA GitHub; provenance `manual_final` được pin trong snapshot.

create table public.mvp_manual_final_events (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 120),
  level text not null check (level in ('weekly','monthly','semester')),
  round_no integer not null check (round_no between 1 and 20),
  intake_mode text not null default 'manual_final' check (intake_mode = 'manual_final'),
  status text not null default 'draft' check (status in ('draft','intake','locked','closed')),
  map_json jsonb not null check (jsonb_typeof(map_json) = 'object'
    and map_json->>'schemaVersion' = 'map.v2' and map_json->>'rulesVersion' = 'ott-campus.v2'),
  map_hash text not null check (map_hash ~ '^[a-f0-9]{64}$'),
  runtime_json jsonb not null check (jsonb_typeof(runtime_json) = 'object'
    and runtime_json->>'runtimeVersion' = 'campus-runtime.v1'
    and runtime_json->>'rulesVersion' = 'ott-campus.v2'
    and runtime_json->>'protocolVersion' = 'bot.v1'
    and runtime_json->>'runtimeHash' ~ '^[a-f0-9]{64}$'
    and runtime_json->>'budgetHash' ~ '^[a-f0-9]{64}$'),
  seed bigint not null check (seed between 0 and 4294967295),
  created_by uuid not null references public.mvp_accounts(id),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  closed_at timestamptz,
  check ((status = 'closed') = (closed_at is not null))
);

create table public.mvp_manual_final_teams (
  event_id uuid not null references public.mvp_manual_final_events(id) on delete restrict,
  team_id uuid not null references public.mvp_participants(id) on delete restrict,
  seed_order integer not null check (seed_order between 1 and 64),
  created_at timestamptz not null default clock_timestamp(),
  primary key (event_id, team_id),
  unique (event_id, seed_order)
);


create table public.mvp_manual_final_submissions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null,
  round_no integer not null,
  team_id uuid not null,
  source_kind text not null default 'manual_final' check (source_kind = 'manual_final'),
  filename text not null check (length(filename) between 1 and 200),
  storage_path text not null unique check (storage_path ~ '^[0-9a-f-]{36}\.py$'),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  byte_size integer not null check (byte_size between 1 and 262144),
  status text not null default 'pending' check (status in ('pending','valid','invalid','infrastructure')),
  error_code text,
  error_message text,
  received_at timestamptz not null default clock_timestamp(),
  received_by uuid not null references public.mvp_accounts(id),
  selected_at timestamptz,
  selected_by uuid references public.mvp_accounts(id),
  locked_at timestamptz,
  locked_by uuid references public.mvp_accounts(id),
  check ((selected_at is null) = (selected_by is null)),
  check ((locked_at is null) = (locked_by is null)),
  check (locked_at is null or selected_at is not null),
  check ((status in ('invalid','infrastructure')) = (error_code is not null)),
  foreign key (event_id, team_id) references public.mvp_manual_final_teams(event_id, team_id)
);
create unique index mvp_manual_final_one_selected
  on public.mvp_manual_final_submissions(event_id, team_id) where selected_at is not null;
create index mvp_manual_final_submissions_event
  on public.mvp_manual_final_submissions(event_id, team_id, received_at desc, id desc);

create table public.mvp_manual_final_matches (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.mvp_manual_final_events(id),
  round_no integer not null,
  series_id text not null check (series_id ~ '^[A-Za-z0-9:_-]{1,40}$'),
  game_no integer not null check (game_no between 1 and 9),
  red_team_id uuid not null,
  blue_team_id uuid not null,
  red_submission_id uuid not null references public.mvp_manual_final_submissions(id),
  blue_submission_id uuid not null references public.mvp_manual_final_submissions(id),
  map_hash text not null check (map_hash ~ '^[a-f0-9]{64}$'),
  seed bigint not null check (seed between 0 and 4294967295),
  snapshot_hash text not null check (snapshot_hash ~ '^[a-f0-9]{64}$'),
  snapshot_json jsonb not null check (jsonb_typeof(snapshot_json) = 'object'
    and length(snapshot_json::text) <= 65536),
  status text not null default 'queued' check (status in ('queued','running','finished','bot_fault','infra_fault','canceled')),
  result text check (result in ('red_win','blue_win','draw')),
  reason text,
  ply_count integer check (ply_count between 0 and 1000),
  replay_json text check (replay_json is null or length(replay_json) between 2 and 1048576),
  error_code text,
  error_message text,
  requested_by uuid not null references public.mvp_accounts(id),
  requested_at timestamptz not null default clock_timestamp(),
  started_at timestamptz,
  finished_at timestamptz,
  canceled_at timestamptz,
  canceled_by uuid references public.mvp_accounts(id),
  cancel_reason text,
  rerun_of uuid references public.mvp_manual_final_matches(id),
  idempotency_key text not null check (length(idempotency_key) between 8 and 200),
  check (red_team_id <> blue_team_id),
  check ((status = 'finished') = (result is not null and ply_count is not null)),
  check ((canceled_at is null) = (cancel_reason is null) and (canceled_at is null) = (canceled_by is null)),
  check (canceled_at is null or status = 'canceled'),
  unique (event_id, idempotency_key),
  unique (id, event_id),
  foreign key (event_id, red_team_id) references public.mvp_manual_final_teams(event_id, team_id),
  foreign key (event_id, blue_team_id) references public.mvp_manual_final_teams(event_id, team_id)
);
-- Một kết quả được chấp nhận cho mỗi ván lịch; chấm lại phải hủy bản cũ trước.
create unique index mvp_manual_final_one_accepted
  on public.mvp_manual_final_matches(event_id, series_id, game_no) where status = 'finished';
create index mvp_manual_final_matches_event
  on public.mvp_manual_final_matches(event_id, series_id, game_no, requested_at);

create table public.mvp_manual_final_jobs (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.mvp_manual_final_events(id),
  round_no integer not null,
  kind text not null check (kind in ('validate','match')),
  submission_id uuid references public.mvp_manual_final_submissions(id),
  match_id uuid references public.mvp_manual_final_matches(id),
  input_hash text not null check (input_hash ~ '^[a-f0-9]{64}$'),
  status text not null default 'queued' check (status in ('queued','running','completed','bot_fault','infra_fault','canceled')),
  attempt integer not null default 0 check (attempt between 0 and 10),
  generation integer not null default 0 check (generation >= 0),
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  lease_token uuid,
  lease_until timestamptz,
  worker_id text,
  available_at timestamptz not null default clock_timestamp(),
  error_code text,
  error_message text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  check (((kind = 'validate') = (submission_id is not null)) and ((kind = 'match') = (match_id is not null)))
);
-- Retry hạ tầng dùng lại đúng job (attempt tăng) để không đổi input/snapshot.
create unique index mvp_manual_final_job_target
  on public.mvp_manual_final_jobs(kind, coalesce(submission_id, match_id));
create index mvp_manual_final_job_queue
  on public.mvp_manual_final_jobs(status, available_at, lease_until);

create table public.mvp_manual_final_audit (
  id bigint generated always as identity primary key,
  event_id uuid not null references public.mvp_manual_final_events(id),
  entity text not null check (entity in ('event','submission','match','job')),
  entity_id uuid not null,
  action text not null check (action in ('create','status','upload','validate','select','lock','pair','cancel','rerun','finish','retry','close')),
  actor uuid references public.mvp_accounts(id),
  reason text check (reason is null or length(reason) between 3 and 500),
  detail jsonb not null default '{}'::jsonb check (length(detail::text) <= 4096),
  created_at timestamptz not null default clock_timestamp()
);
create index mvp_manual_final_audit_event on public.mvp_manual_final_audit(event_id, created_at desc, id desc);
create index mvp_manual_final_audit_entity on public.mvp_manual_final_audit(entity, entity_id, created_at desc);

-- Deny-by-default: không policy cho browser; service_role chỉ đọc + insert, cột nhạy cảm
-- (hash/storage/snapshot/result) không được UPDATE qua REST. Bảng mới thừa hưởng default
-- privileges của Supabase nên phải revoke cả service_role trước khi cấp quyền hẹp.
do $$ declare t text; begin
  foreach t in array array['mvp_manual_final_events','mvp_manual_final_teams',
    'mvp_manual_final_submissions','mvp_manual_final_matches','mvp_manual_final_jobs',
    'mvp_manual_final_audit'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public,anon,authenticated,service_role', t);
  end loop;
end $$;
grant select, insert on public.mvp_manual_final_events to service_role;
grant update (status, closed_at, updated_at) on public.mvp_manual_final_events to service_role;
grant select, insert on public.mvp_manual_final_teams to service_role;
grant select, insert on public.mvp_manual_final_submissions to service_role;
grant select, insert on public.mvp_manual_final_matches to service_role;
grant select, insert on public.mvp_manual_final_jobs to service_role;
grant select, insert on public.mvp_manual_final_audit to service_role;
revoke update, delete on public.mvp_manual_final_audit from service_role;
grant usage, select on sequence public.mvp_manual_final_audit_id_seq to service_role;


-- Audit là append-only kể cả với owner của function: sửa/xóa phải tạo bản ghi mới.
create function public.mvp_manual_final_audit_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'manual_final_audit_append_only' using errcode = '23514';
end; $$;
create trigger mvp_manual_final_audit_guard before update or delete on public.mvp_manual_final_audit
for each row execute function public.mvp_manual_final_audit_guard();

-- Đợt: chỉ đi tới theo thứ tự draft → intake → locked → closed, map/runtime không đổi.
create function public.mvp_manual_final_event_guard() returns trigger
language plpgsql set search_path = '' as $$
declare v_old integer; v_new integer; v_missing integer; v_open integer;
begin
  v_old := case old.status when 'draft' then 0 when 'intake' then 1 when 'locked' then 2 else 3 end;
  v_new := case new.status when 'draft' then 0 when 'intake' then 1 when 'locked' then 2 else 3 end;
  if v_new <> v_old and v_new <> v_old + 1 then
    raise exception 'manual_final_status_transition' using errcode = '23514';
  end if;
  if new.map_json is distinct from old.map_json or new.map_hash is distinct from old.map_hash
    or new.runtime_json is distinct from old.runtime_json or new.seed is distinct from old.seed
    or new.level is distinct from old.level or new.round_no is distinct from old.round_no then
    raise exception 'manual_final_event_immutable' using errcode = '23514';
  end if;
  if new.status = 'locked' and old.status <> 'locked' then
    select count(*) into v_missing from public.mvp_manual_final_teams t
      where t.event_id = old.id and not exists (
        select 1 from public.mvp_manual_final_submissions s
        where s.event_id = t.event_id and s.team_id = t.team_id
          and s.locked_at is not null and s.status = 'valid');
    if v_missing > 0 then raise exception 'manual_final_unlocked_teams:%', v_missing using errcode = '23514'; end if;
  end if;
  if new.status = 'closed' and old.status <> 'closed' then
    if old.status <> 'locked' then raise exception 'manual_final_close_requires_lock' using errcode = '23514'; end if;
    select count(*) into v_open from public.mvp_manual_final_jobs j
      where j.event_id = old.id and j.status in ('queued','running');
    if v_open > 0 then raise exception 'manual_final_jobs_pending:%', v_open using errcode = '23514'; end if;
    select count(*) into v_open from public.mvp_manual_final_matches m
      where m.event_id = old.id and m.status in ('queued','running');
    if v_open > 0 then raise exception 'manual_final_matches_pending:%', v_open using errcode = '23514'; end if;
  end if;
  new.updated_at := clock_timestamp();
  return new;
end; $$;
create trigger mvp_manual_final_event_guard before update on public.mvp_manual_final_events
for each row execute function public.mvp_manual_final_event_guard();

-- Đội chỉ được thêm khi đợt còn nháp; không xóa/đổi seed sau khi đã tạo.
create function public.mvp_manual_final_team_guard() returns trigger
language plpgsql set search_path = '' as $$
declare v_status text;
begin
  select status into v_status from public.mvp_manual_final_events where id = new.event_id;
  if v_status is distinct from 'draft' then
    raise exception 'manual_final_teams_frozen' using errcode = '23514';
  end if;
  return new;
end; $$;
create trigger mvp_manual_final_team_guard before insert on public.mvp_manual_final_teams
for each row execute function public.mvp_manual_final_team_guard();

-- Bài mới chỉ vào trạng thái pending; worker chuyển valid/invalid/infrastructure.
create function public.mvp_manual_final_submission_guard() returns trigger
language plpgsql set search_path = '' as $$
declare v_status text; v_round integer;
begin
  select status, round_no into v_status, v_round from public.mvp_manual_final_events where id = new.event_id;
  if v_status is null then raise exception 'manual_final_event_missing' using errcode = '23503'; end if;
  if v_status not in ('draft','intake') then
    raise exception 'manual_final_intake_closed' using errcode = '23514';
  end if;
  if new.status <> 'pending' or new.error_code is not null then
    raise exception 'manual_final_submission_starts_pending' using errcode = '23514';
  end if;
  if new.round_no is distinct from v_round then
    raise exception 'manual_final_round_mismatch' using errcode = '23514';
  end if;
  return new;
end; $$;
create trigger mvp_manual_final_submission_guard before insert on public.mvp_manual_final_submissions
for each row execute function public.mvp_manual_final_submission_guard();


-- Cặp chấm: chỉ nhận bài đã valid + khóa của đúng hai đội trong đợt, đúng map/runtime đã pin.
create function public.mvp_manual_final_match_guard() returns trigger
language plpgsql set search_path = '' as $$
declare e public.mvp_manual_final_events; r public.mvp_manual_final_submissions; b public.mvp_manual_final_submissions;
begin
  select * into e from public.mvp_manual_final_events where id = new.event_id;
  if not found then raise exception 'manual_final_event_missing' using errcode = '23503'; end if;
  if e.status <> 'locked' then raise exception 'manual_final_event_not_locked' using errcode = '23514'; end if;
  if new.round_no is distinct from e.round_no then raise exception 'manual_final_round_mismatch' using errcode = '23514'; end if;
  if new.map_hash is distinct from e.map_hash or e.map_hash is distinct from (new.snapshot_json->>'mapHash')
    or new.snapshot_json->>'map' is distinct from e.map_json::text
    or new.snapshot_json->'runtime'->>'runtimeHash' is distinct from e.runtime_json->>'runtimeHash'
    or new.snapshot_json->'runtime'->>'budgetHash' is distinct from e.runtime_json->>'budgetHash'
    or (new.snapshot_json->>'seed')::bigint is distinct from new.seed then
    raise exception 'manual_final_snapshot_mismatch' using errcode = '23514';
  end if;
  select * into r from public.mvp_manual_final_submissions where id = new.red_submission_id;
  select * into b from public.mvp_manual_final_submissions where id = new.blue_submission_id;
  if r.id is null or b.id is null
    or r.event_id <> new.event_id or b.event_id <> new.event_id
    or r.team_id <> new.red_team_id or b.team_id <> new.blue_team_id
    or r.locked_at is null or b.locked_at is null
    or r.status <> 'valid' or b.status <> 'valid' then
    raise exception 'manual_final_pair_requires_locked_valid' using errcode = '23514';
  end if;
  if new.status <> 'queued' or new.result is not null then
    raise exception 'manual_final_match_starts_queued' using errcode = '23514';
  end if;
  return new;
end; $$;
create trigger mvp_manual_final_match_guard before insert on public.mvp_manual_final_matches
for each row execute function public.mvp_manual_final_match_guard();

-- Job được API tạo (validate) hoặc function pair tạo (match); phải khớp target đang chờ.
create function public.mvp_manual_final_job_guard() returns trigger
language plpgsql set search_path = '' as $$
declare v_status text; v_event uuid;
begin
  if new.status <> 'queued' or new.attempt <> 0 or new.generation <> 0 or new.lease_token is not null then
    raise exception 'manual_final_job_starts_queued' using errcode = '23514';
  end if;
  if new.kind = 'validate' then
    select status, event_id into v_status, v_event from public.mvp_manual_final_submissions where id = new.submission_id;
    if v_event is distinct from new.event_id then raise exception 'manual_final_job_scope' using errcode = '23514'; end if;
  else
    select status, event_id into v_status, v_event from public.mvp_manual_final_matches where id = new.match_id;
    if v_event is distinct from new.event_id or v_status <> 'queued' then
      raise exception 'manual_final_job_scope' using errcode = '23514';
    end if;
  end if;
  return new;
end; $$;
create trigger mvp_manual_final_job_guard before insert on public.mvp_manual_final_jobs
for each row execute function public.mvp_manual_final_job_guard();

create function public.mvp_manual_final_log(p_event uuid, p_entity text, p_entity_id uuid,
  p_action text, p_actor uuid, p_reason text, p_detail jsonb default '{}'::jsonb)
returns void language sql set search_path = '' as $$
  insert into public.mvp_manual_final_audit(event_id, entity, entity_id, action, actor, reason, detail)
  values (p_event, p_entity, p_entity_id, p_action, p_actor, p_reason, coalesce(p_detail, '{}'::jsonb));
$$;
revoke all on function public.mvp_manual_final_log(uuid,text,uuid,text,uuid,text,jsonb) from public,anon,authenticated;


-- Chọn phiên bản: chỉ trong đợt đang intake, bài phải valid và chưa khóa.
create function public.mvp_manual_final_select(p_submission uuid, p_actor uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.mvp_manual_final_submissions; e public.mvp_manual_final_events;
begin
  select * into s from public.mvp_manual_final_submissions where id = p_submission for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'submission_not_found'); end if;
  select * into e from public.mvp_manual_final_events where id = s.event_id for update;
  if e.status <> 'intake' then return jsonb_build_object('ok', false, 'error', 'event_not_open'); end if;
  if exists (select 1 from public.mvp_manual_final_submissions x
      where x.event_id = s.event_id and x.team_id = s.team_id and x.locked_at is not null) then
    return jsonb_build_object('ok', false, 'error', 'submission_locked');
  end if;
  if s.locked_at is not null then return jsonb_build_object('ok', false, 'error', 'submission_locked'); end if;
  if s.status <> 'valid' then return jsonb_build_object('ok', false, 'error', 'submission_not_valid'); end if;
  update public.mvp_manual_final_submissions set selected_at = null, selected_by = null
    where event_id = s.event_id and team_id = s.team_id and selected_at is not null and id <> s.id;
  update public.mvp_manual_final_submissions set selected_at = clock_timestamp(), selected_by = p_actor
    where id = s.id returning * into s;
  perform public.mvp_manual_final_log(s.event_id, 'submission', s.id, 'select', p_actor, null,
    jsonb_build_object('team_id', s.team_id, 'sha256', s.sha256));
  return jsonb_build_object('ok', true, 'submission_id', s.id, 'team_id', s.team_id,
    'sha256', s.sha256, 'selected_at', s.selected_at);
end; $$;

-- Khóa bài theo đội: chỉ khóa bài đã chọn + valid; khóa lặp idempotent.
create function public.mvp_manual_final_lock(p_event uuid, p_team uuid, p_actor uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare e public.mvp_manual_final_events; s public.mvp_manual_final_submissions;
begin
  select * into e from public.mvp_manual_final_events where id = p_event for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'event_not_found'); end if;
  if e.status <> 'intake' then return jsonb_build_object('ok', false, 'error', 'event_not_open'); end if;
  if not exists (select 1 from public.mvp_manual_final_teams where event_id = e.id and team_id = p_team) then
    return jsonb_build_object('ok', false, 'error', 'not_in_event');
  end if;
  select * into s from public.mvp_manual_final_submissions
    where event_id = e.id and team_id = p_team and locked_at is not null;
  if found then
    return jsonb_build_object('ok', true, 'already_locked', true, 'submission_id', s.id,
      'sha256', s.sha256, 'locked_at', s.locked_at);
  end if;
  select * into s from public.mvp_manual_final_submissions
    where event_id = e.id and team_id = p_team and selected_at is not null for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_selected'); end if;
  if s.status <> 'valid' then return jsonb_build_object('ok', false, 'error', 'submission_not_valid'); end if;
  update public.mvp_manual_final_submissions set locked_at = clock_timestamp(), locked_by = p_actor
    where id = s.id returning * into s;
  perform public.mvp_manual_final_log(e.id, 'submission', s.id, 'lock', p_actor, null,
    jsonb_build_object('team_id', s.team_id, 'sha256', s.sha256));
  return jsonb_build_object('ok', true, 'already_locked', false, 'submission_id', s.id,
    'sha256', s.sha256, 'locked_at', s.locked_at);
end; $$;


-- Tạo yêu cầu chấm: pin snapshot + job, idempotent theo key; không đọc "bài mới nhất".
create function public.mvp_manual_final_pair(p_payload jsonb, p_actor uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare e public.mvp_manual_final_events; m public.mvp_manual_final_matches;
  r public.mvp_manual_final_submissions; b public.mvp_manual_final_submissions;
  v_event uuid; v_key text; v_job uuid;
begin
  v_event := nullif(p_payload->>'eventId', '')::uuid;
  v_key := nullif(left(btrim(coalesce(p_payload->>'idempotencyKey', '')), 200), '');
  if v_event is null or v_key is null or length(v_key) < 8 then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;
  select * into e from public.mvp_manual_final_events where id = v_event for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'event_not_found'); end if;
  select * into m from public.mvp_manual_final_matches where event_id = v_event and idempotency_key = v_key;
  if found then
    return jsonb_build_object('ok', true, 'idempotent', true, 'match_id', m.id, 'status', m.status,
      'snapshot_hash', m.snapshot_hash);
  end if;
  if e.status <> 'locked' then return jsonb_build_object('ok', false, 'error', 'event_not_locked'); end if;
  select * into r from public.mvp_manual_final_submissions
    where event_id = v_event and team_id = nullif(p_payload->>'redTeamId', '')::uuid and locked_at is not null;
  if not found then return jsonb_build_object('ok', false, 'error', 'red_submission_not_locked'); end if;
  select * into b from public.mvp_manual_final_submissions
    where event_id = v_event and team_id = nullif(p_payload->>'blueTeamId', '')::uuid and locked_at is not null;
  if not found then return jsonb_build_object('ok', false, 'error', 'blue_submission_not_locked'); end if;
  begin
    insert into public.mvp_manual_final_matches(event_id, round_no, series_id, game_no, red_team_id,
      blue_team_id, red_submission_id, blue_submission_id, map_hash, seed, snapshot_hash, snapshot_json,
      requested_by, rerun_of, idempotency_key)
    values (v_event, e.round_no, p_payload->>'seriesId', (p_payload->>'gameNo')::integer,
      r.team_id, b.team_id, r.id, b.id, p_payload->>'mapHash', (p_payload->>'seed')::bigint,
      p_payload->>'snapshotHash', p_payload->'snapshot', p_actor,
      nullif(p_payload->>'rerunOf', '')::uuid, v_key)
    returning * into m;
  exception when unique_violation then
    select * into m from public.mvp_manual_final_matches where event_id = v_event and idempotency_key = v_key;
    if found then
      return jsonb_build_object('ok', true, 'idempotent', true, 'match_id', m.id, 'status', m.status,
        'snapshot_hash', m.snapshot_hash);
    end if;
    return jsonb_build_object('ok', false, 'error', 'duplicate_game');
  end;
  insert into public.mvp_manual_final_jobs(event_id, round_no, kind, match_id, input_hash)
    values (v_event, e.round_no, 'match', m.id, m.snapshot_hash) returning id into v_job;
  perform public.mvp_manual_final_log(v_event, 'match', m.id, 'pair', p_actor,
    nullif(left(coalesce(p_payload->>'note', ''), 500), ''),
    jsonb_build_object('series_id', m.series_id, 'game_no', m.game_no, 'seed', m.seed,
      'snapshot_hash', m.snapshot_hash, 'red_submission_id', m.red_submission_id,
      'blue_submission_id', m.blue_submission_id, 'rerun_of', m.rerun_of));
  return jsonb_build_object('ok', true, 'idempotent', false, 'match_id', m.id, 'job_id', v_job,
    'status', m.status, 'snapshot_hash', m.snapshot_hash);
end; $$;

-- Hủy trận: bắt buộc lý do, không hủy kết quả đã accepted, giữ nguyên audit + hàng lịch sử.
create function public.mvp_manual_final_cancel(p_match uuid, p_actor uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare m public.mvp_manual_final_matches; v_previous text;
begin
  if p_reason is null or length(btrim(p_reason)) < 5 then
    return jsonb_build_object('ok', false, 'error', 'reason_required');
  end if;
  select * into m from public.mvp_manual_final_matches where id = p_match for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'match_not_found'); end if;
  if m.status = 'finished' then return jsonb_build_object('ok', false, 'error', 'result_conflict'); end if;
  if m.status = 'canceled' then
    return jsonb_build_object('ok', true, 'already_canceled', true, 'match_id', m.id, 'status', m.status);
  end if;
  v_previous := m.status;
  update public.mvp_manual_final_matches set status = 'canceled', canceled_at = clock_timestamp(),
    canceled_by = p_actor, cancel_reason = left(btrim(p_reason), 500)
    where id = m.id returning * into m;
  update public.mvp_manual_final_jobs set status = 'canceled', error_code = 'match_canceled',
    lease_token = null, lease_until = null, updated_at = clock_timestamp()
    where match_id = m.id and status in ('queued','running');
  perform public.mvp_manual_final_log(m.event_id, 'match', m.id, 'cancel', p_actor, m.cancel_reason,
    jsonb_build_object('previous_status', v_previous, 'snapshot_hash', m.snapshot_hash));
  return jsonb_build_object('ok', true, 'already_canceled', false, 'match_id', m.id,
    'status', m.status, 'previous_status', v_previous);
end; $$;


-- Worker claim: lease + generation, bỏ qua job đang bị worker khác giữ.
create function public.mvp_manual_final_claim(p_worker text, p_limit integer default 1, p_lease_seconds integer default 120)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_limit integer; v_lease integer; j record; out_jobs jsonb := '[]'::jsonb;
begin
  if p_worker is null or length(btrim(p_worker)) = 0 then
    return jsonb_build_object('ok', false, 'error', 'bad_worker');
  end if;
  v_limit := least(greatest(coalesce(p_limit, 1), 1), 5);
  v_lease := least(greatest(coalesce(p_lease_seconds, 120), 10), 900);
  update public.mvp_manual_final_jobs set status = 'queued', lease_token = null, updated_at = clock_timestamp()
    where status = 'running' and lease_until <= clock_timestamp();
  for j in select * from public.mvp_manual_final_jobs
      where status = 'queued' and available_at <= clock_timestamp()
      order by created_at, id limit v_limit for update skip locked loop
    update public.mvp_manual_final_jobs set status = 'running', lease_token = gen_random_uuid(),
      lease_until = clock_timestamp() + make_interval(secs => v_lease), generation = generation + 1,
      attempt = attempt + 1, worker_id = left(btrim(p_worker), 120), updated_at = clock_timestamp()
      where id = j.id returning * into j;
    if j.match_id is not null then
      update public.mvp_manual_final_matches set status = 'running',
        started_at = coalesce(started_at, clock_timestamp())
        where id = j.match_id and status = 'queued';
    end if;
    out_jobs := out_jobs || jsonb_build_array(jsonb_build_object(
      'job_id', j.id, 'kind', j.kind, 'event_id', j.event_id, 'round_no', j.round_no,
      'submission_id', j.submission_id, 'match_id', j.match_id, 'input_hash', j.input_hash,
      'token', j.lease_token, 'generation', j.generation, 'attempt', j.attempt,
      'submission', (select jsonb_build_object('id', s.id, 'team_id', s.team_id,
          'storage_path', s.storage_path, 'sha256', s.sha256, 'byte_size', s.byte_size)
        from public.mvp_manual_final_submissions s where s.id = j.submission_id),
      'match', (select jsonb_build_object('id', m.id, 'series_id', m.series_id, 'game_no', m.game_no,
          'red_team_id', m.red_team_id, 'blue_team_id', m.blue_team_id,
          'red_submission_id', m.red_submission_id, 'blue_submission_id', m.blue_submission_id,
          'map_hash', m.map_hash, 'seed', m.seed, 'snapshot_hash', m.snapshot_hash,
          'snapshot', m.snapshot_json)
        from public.mvp_manual_final_matches m where m.id = j.match_id)));
  end loop;
  return jsonb_build_object('ok', true, 'jobs', out_jobs);
end; $$;


-- Ghi kết quả có fence: sai lease/generation thì không ghi; gọi lặp trả already_finished.
create function public.mvp_manual_final_finish(p_job uuid, p_token uuid, p_generation integer, p_outcome jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare j public.mvp_manual_final_jobs; m public.mvp_manual_final_matches;
  s public.mvp_manual_final_submissions; v_status text; v_error text; v_result text; v_ply integer;
begin
  select * into j from public.mvp_manual_final_jobs where id = p_job for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'job_not_found'); end if;
  -- Duplicate finish (mất response) phải trả already_finished, không tạo kết quả thứ hai.
  if j.status in ('completed','bot_fault','infra_fault') then
    return jsonb_build_object('ok', true, 'applied', false, 'already_finished', true,
      'job_status', j.status, 'match_id', j.match_id, 'match_status',
      (select status from public.mvp_manual_final_matches where id = j.match_id),
      'submission_id', j.submission_id,
      'submission_status', (select status from public.mvp_manual_final_submissions where id = j.submission_id));
  end if;
  if j.lease_token is distinct from p_token or j.generation <> p_generation then
    return jsonb_build_object('ok', false, 'error', 'lease_lost');
  end if;
  if j.status = 'canceled' then return jsonb_build_object('ok', false, 'error', 'job_canceled'); end if;
  v_status := p_outcome->>'status';
  if j.kind = 'validate' then
    if v_status is null or v_status not in ('valid','invalid','infrastructure') then
      return jsonb_build_object('ok', false, 'error', 'bad_outcome');
    end if;
    v_error := nullif(left(coalesce(p_outcome->>'error', ''), 200), '');
    if v_status = 'valid' then
      if p_outcome->>'source_hash' is distinct from
        (select sha256 from public.mvp_manual_final_submissions where id = j.submission_id) then
        return jsonb_build_object('ok', false, 'error', 'source_hash_mismatch');
      end if;
    elsif v_error is null then
      v_error := 'bot_validation_failed';
    end if;
    update public.mvp_manual_final_submissions set status = v_status,
      error_code = case when v_status = 'valid' then null else v_error end,
      error_message = case when v_status = 'valid' then null
        else nullif(left(coalesce(p_outcome->>'message', ''), 400), '') end
      where id = j.submission_id returning * into s;
    update public.mvp_manual_final_jobs set status = case v_status when 'valid' then 'completed'
        when 'invalid' then 'bot_fault' else 'infra_fault' end,
      lease_token = null, lease_until = null,
      error_code = case when v_status = 'valid' then null else v_error end,
      error_message = case when v_status = 'valid' then null
        else nullif(left(coalesce(p_outcome->>'message', ''), 400), '') end,
      finished_at = clock_timestamp(), updated_at = clock_timestamp()
      where id = j.id returning * into j;
    perform public.mvp_manual_final_log(j.event_id, 'submission', s.id, 'validate', null, null,
      jsonb_build_object('status', s.status, 'error_code', s.error_code, 'sha256', s.sha256,
        'generation', j.generation, 'attempt', j.attempt));
    return jsonb_build_object('ok', true, 'applied', true, 'already_finished', false,
      'job_status', j.status, 'submission_id', s.id, 'submission_status', s.status);
  end if;
  if j.kind <> 'match' then return jsonb_build_object('ok', false, 'error', 'bad_job_kind'); end if;

  if v_status = 'finished' then
    v_result := p_outcome->>'result';
    v_ply := case when coalesce(p_outcome->>'ply_count', '') ~ '^[0-9]{1,4}$'
      then (p_outcome->>'ply_count')::integer end;
    if v_result is null or v_result not in ('red_win','blue_win','draw')
      or v_ply is null or v_ply < 1
      or jsonb_typeof(p_outcome->'replay') is distinct from 'object'
      or length((p_outcome->'replay')::text) < 2
      or length((p_outcome->'replay')::text) > 1048576 then
      return jsonb_build_object('ok', false, 'error', 'bad_outcome');
    end if;
    update public.mvp_manual_final_matches set status = 'finished', result = v_result,
      reason = nullif(left(coalesce(p_outcome->>'reason', ''), 200), ''), ply_count = v_ply,
      replay_json = (p_outcome->'replay')::text, error_code = null, error_message = null,
      started_at = coalesce(started_at, clock_timestamp()), finished_at = clock_timestamp()
      where id = j.match_id returning * into m;
    update public.mvp_manual_final_jobs set status = 'completed', lease_token = null, lease_until = null,
      finished_at = clock_timestamp(), updated_at = clock_timestamp()
      where id = j.id returning * into j;
    perform public.mvp_manual_final_log(j.event_id, 'match', m.id, 'finish', null, null,
      jsonb_build_object('result', m.result, 'reason', m.reason, 'ply_count', m.ply_count,
        'snapshot_hash', m.snapshot_hash, 'generation', j.generation, 'attempt', j.attempt));
    return jsonb_build_object('ok', true, 'applied', true, 'already_finished', false,
      'job_status', j.status, 'match_id', m.id, 'match_status', m.status,
      'result', m.result, 'ply_count', m.ply_count, 'snapshot_hash', m.snapshot_hash);
  end if;
  if v_status is null or v_status not in ('bot_fault','infra_fault') then
    return jsonb_build_object('ok', false, 'error', 'bad_outcome');
  end if;
  v_error := coalesce(nullif(left(coalesce(p_outcome->>'error', ''), 200), ''), v_status);
  update public.mvp_manual_final_matches set status = v_status, error_code = v_error,
    error_message = nullif(left(coalesce(p_outcome->>'message', ''), 400), ''),
    started_at = coalesce(started_at, clock_timestamp())
    where id = j.match_id returning * into m;
  update public.mvp_manual_final_jobs set status = v_status, lease_token = null, lease_until = null,
    error_code = v_error, finished_at = clock_timestamp(), updated_at = clock_timestamp()
    where id = j.id returning * into j;
  perform public.mvp_manual_final_log(j.event_id, 'match', m.id, 'finish', null, null,
    jsonb_build_object('status', m.status, 'error_code', m.error_code, 'snapshot_hash', m.snapshot_hash,
      'generation', j.generation, 'attempt', j.attempt));
  return jsonb_build_object('ok', true, 'applied', true, 'already_finished', false,
    'job_status', j.status, 'match_id', m.id, 'match_status', m.status);
end; $$;

-- Lỗi hạ tầng: retry cùng input (cùng snapshot) với backoff; quá số lần thì infra_fault.
create function public.mvp_manual_final_release(p_job uuid, p_token uuid, p_generation integer,
  p_error text, p_max_attempts integer default 3)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare j public.mvp_manual_final_jobs; v_max integer; v_error text;
begin
  select * into j from public.mvp_manual_final_jobs where id = p_job for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'job_not_found'); end if;
  if j.lease_token is distinct from p_token or j.generation <> p_generation then
    return jsonb_build_object('ok', false, 'error', 'lease_lost');
  end if;
  if j.status not in ('queued','running') then
    return jsonb_build_object('ok', false, 'error', 'job_not_running', 'job_status', j.status);
  end if;
  v_max := least(greatest(coalesce(p_max_attempts, 3), 1), 10);
  v_error := coalesce(nullif(left(coalesce(p_error, ''), 200), ''), 'manual_final_infrastructure');
  if j.attempt >= v_max or j.attempt >= j.max_attempts then
    update public.mvp_manual_final_jobs set status = 'infra_fault', error_code = v_error,
      lease_token = null, lease_until = null, finished_at = clock_timestamp(), updated_at = clock_timestamp()
      where id = j.id returning * into j;
    if j.match_id is not null then
      update public.mvp_manual_final_matches set status = 'infra_fault', error_code = v_error
        where id = j.match_id;
    end if;
    perform public.mvp_manual_final_log(j.event_id, 'job', j.id, 'retry', null, null,
      jsonb_build_object('status', 'infra_fault', 'error_code', v_error, 'attempt', j.attempt));
    return jsonb_build_object('ok', true, 'applied', true, 'status', 'infra_fault',
      'attempt', j.attempt, 'match_status', (select status from public.mvp_manual_final_matches where id = j.match_id));
  end if;
  update public.mvp_manual_final_jobs set status = 'queued', lease_token = null, lease_until = null,
    available_at = clock_timestamp() + make_interval(secs => least(300, 15 * greatest(j.attempt, 1))),
    error_code = v_error, updated_at = clock_timestamp()
    where id = j.id returning * into j;
  if j.match_id is not null then
    update public.mvp_manual_final_matches set status = 'queued'
      where id = j.match_id and status in ('queued','running');
  end if;
  perform public.mvp_manual_final_log(j.event_id, 'job', j.id, 'retry', null, null,
    jsonb_build_object('status', 'queued', 'error_code', v_error, 'attempt', j.attempt,
      'available_at', j.available_at));
  return jsonb_build_object('ok', true, 'applied', true, 'status', 'queued', 'attempt', j.attempt,
    'available_at', j.available_at);
end; $$;


-- Helper trigger không cấp quyền; chỉ function điều phối được EXECUTE cho service_role.
do $$ declare fn text; begin
  foreach fn in array array[
    'public.mvp_manual_final_audit_guard()',
    'public.mvp_manual_final_event_guard()',
    'public.mvp_manual_final_team_guard()',
    'public.mvp_manual_final_submission_guard()',
    'public.mvp_manual_final_match_guard()',
    'public.mvp_manual_final_job_guard()'
  ] loop
    execute format('revoke all on function %s from public,anon,authenticated', fn);
  end loop;
end $$;
do $$ declare fn text; begin
  foreach fn in array array[
    'public.mvp_manual_final_select(uuid,uuid)',
    'public.mvp_manual_final_lock(uuid,uuid,uuid)',
    'public.mvp_manual_final_pair(jsonb,uuid)',
    'public.mvp_manual_final_cancel(uuid,uuid,text)',
    'public.mvp_manual_final_claim(text,integer,integer)',
    'public.mvp_manual_final_finish(uuid,uuid,integer,jsonb)',
    'public.mvp_manual_final_release(uuid,uuid,integer,text,integer)'
  ] loop
    execute format('revoke all on function %s from public,anon,authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $$;

comment on table public.mvp_manual_final_submissions is
  'Manual final versions: server-side hash/time/actor, private storage_path never returned to UI; bytes immutable after insert.';
comment on table public.mvp_manual_final_matches is
  'One row per BTC judging request; accepted result only via fenced mvp_manual_final_finish. Manual provenance, no fake GitHub receipt.';
comment on table public.mvp_manual_final_audit is
  'Append-only BTC actions for manual finals (select/lock/pair/cancel/finish/retry). Never store source or secrets.';
notify pgrst, 'reload schema';
