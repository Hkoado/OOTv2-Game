-- K3 official match jobs: queue + lease/generation fencing + accepted-attempt audit.
-- Additive only. Service-role RPCs; RLS on; no trigger/Start/API/UI change in this file.
-- A game result is written by exactly one fenced attempt (`mvp_official_finish_job`); an
-- infrastructure failure never writes a result and never becomes a forfeit.
-- NOT applied remotely: Huy reviews grants/transactions and applies on a disposable project.

create table if not exists public.mvp_official_jobs (
  id uuid primary key default gen_random_uuid(),
  round_pk uuid not null references public.mvp_official_rounds(id) on delete restrict,
  game_key text not null check (game_key ~ '^[A-Za-z0-9:_-]{1,120}$'),
  stage text not null check (stage ~ '^[A-Za-z0-9:_-]{1,40}$'),
  input_hash text not null check (input_hash ~ '^[a-f0-9]{64}$'),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  attempt integer not null default 0 check (attempt between 0 and 20),
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  available_at timestamptz not null default clock_timestamp(),
  lease_token uuid,
  lease_owner text check (lease_owner is null or length(lease_owner) between 1 and 120),
  lease_until timestamptz,
  generation integer not null default 0 check (generation >= 0),
  heartbeat_at timestamptz,
  result text check (result in ('red_win', 'blue_win', 'draw')),
  replay_hash text check (replay_hash is null or replay_hash ~ '^[a-f0-9]{64}$'),
  error text check (error is null or length(error) <= 400),
  error_category text check (error_category is null
    or error_category in ('infrastructure', 'bot', 'input', 'operator')),
  finished_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (round_pk, game_key),
  check (result is null or status = 'succeeded'),
  check (status <> 'succeeded' or (result is not null and replay_hash is not null and finished_at is not null)),
  check (lease_token is null or status = 'running')
);

create index if not exists mvp_official_jobs_claim
  on public.mvp_official_jobs(status, available_at);
create index if not exists mvp_official_jobs_lease
  on public.mvp_official_jobs(lease_until) where status = 'running';

create table if not exists public.mvp_official_job_attempts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.mvp_official_jobs(id) on delete cascade,
  round_pk uuid not null,
  game_key text not null,
  attempt integer not null check (attempt between 1 and 20),
  worker_id text not null check (length(worker_id) between 1 and 120),
  generation integer not null,
  lease_token uuid not null,
  started_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  outcome text check (outcome is null
    or outcome in ('succeeded', 'bot_fault', 'infrastructure', 'input_rejected', 'cancelled', 'lease_expired')),
  error_code text check (error_code is null or length(error_code) <= 160),
  replay jsonb check (replay is null or pg_column_size(replay) <= 262144),
  unique (job_id, attempt)
);

create index if not exists mvp_official_job_attempts_job
  on public.mvp_official_job_attempts(job_id, attempt);

alter table public.mvp_official_jobs enable row level security;
alter table public.mvp_official_job_attempts enable row level security;
revoke all on public.mvp_official_jobs, public.mvp_official_job_attempts from public, anon, authenticated;
grant select, insert, update on public.mvp_official_jobs, public.mvp_official_job_attempts to service_role;

-- Scheduler publishes one pinned game, then enqueues exactly that game.
create or replace function public.mvp_official_enqueue_job(p_round uuid, p_game_key text, p_input_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.mvp_official_rounds; g public.mvp_official_games; j public.mvp_official_jobs;
begin
  if p_round is null or coalesce(p_game_key, '') !~ '^[A-Za-z0-9:_-]{1,120}$'
    or coalesce(p_input_hash, '') !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('ok', false, 'error', 'bad_input');
  end if;
  select * into r from public.mvp_official_rounds where id = p_round for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'round_not_found'); end if;
  if r.frozen then return jsonb_build_object('ok', false, 'error', 'round_frozen'); end if;
  select * into g from public.mvp_official_games where round_pk = p_round and game_key = p_game_key;
  if not found then return jsonb_build_object('ok', false, 'error', 'game_not_found'); end if;
  select * into j from public.mvp_official_jobs where round_pk = p_round and game_key = p_game_key;
  if found then
    -- Never silently resurrect a terminal job or change its pinned input.
    if j.input_hash <> p_input_hash then
      return jsonb_build_object('ok', false, 'error', 'input_mismatch', 'status', j.status);
    end if;
    if g.result is not null and j.status <> 'succeeded' then
      return jsonb_build_object('ok', true, 'created', false, 'status', 'recorded',
        'job_id', j.id, 'game_key', j.game_key);
    end if;
    return jsonb_build_object('ok', true, 'created', false, 'status', j.status,
      'job_id', j.id, 'game_key', j.game_key, 'attempt', j.attempt);
  end if;
  if g.result is not null then
    return jsonb_build_object('ok', true, 'created', false, 'status', 'recorded', 'game_key', g.game_key);
  end if;
  insert into public.mvp_official_jobs (round_pk, game_key, stage, input_hash)
  values (r.id, g.game_key, g.stage, p_input_hash) returning * into j;
  return jsonb_build_object('ok', true, 'created', true, 'status', 'queued',
    'job_id', j.id, 'game_key', j.game_key);
end $$;

-- Claim either a queued job or an expired running job (crash recovery). Generation fences.
create or replace function public.mvp_official_claim_job(p_worker text, p_lease_seconds integer default 120)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare j public.mvp_official_jobs; v_lease integer := least(greatest(coalesce(p_lease_seconds, 120), 30), 3600);
  v_reclaimed boolean := false;
begin
  if coalesce(p_worker, '') = '' or length(p_worker) > 120 then
    return jsonb_build_object('ok', false, 'error', 'bad_worker');
  end if;
  select * into j from public.mvp_official_jobs
   where (status = 'queued' and available_at <= clock_timestamp())
      or (status = 'running' and lease_until < clock_timestamp() and attempt < max_attempts)
   order by available_at asc, created_at asc
   limit 1
   for update skip locked;
  if not found then return null; end if;
  v_reclaimed := j.status = 'running';
  update public.mvp_official_jobs set
    status = 'running',
    attempt = j.attempt + 1,
    generation = j.generation + 1,
    lease_token = gen_random_uuid(),
    lease_owner = p_worker,
    lease_until = clock_timestamp() + make_interval(secs => v_lease),
    heartbeat_at = clock_timestamp(),
    updated_at = clock_timestamp()
   where id = j.id returning * into j;
  if v_reclaimed then
    update public.mvp_official_job_attempts set finished_at = clock_timestamp(),
      outcome = 'lease_expired', error_code = 'lease_expired'
     where job_id = j.id and outcome is null;
  end if;
  insert into public.mvp_official_job_attempts (job_id, round_pk, game_key, attempt, worker_id,
    generation, lease_token)
  values (j.id, j.round_pk, j.game_key, j.attempt, p_worker, j.generation, j.lease_token);
  return jsonb_build_object('ok', true, 'reclaimed', v_reclaimed,
    'job', jsonb_build_object('id', j.id, 'roundId', j.round_pk, 'gameKey', j.game_key,
      'stage', j.stage, 'inputHash', j.input_hash, 'attempt', j.attempt,
      'maxAttempts', j.max_attempts, 'generation', j.generation,
      'leaseToken', j.lease_token, 'leaseUntil', j.lease_until, 'reclaimed', v_reclaimed));
end $$;

create or replace function public.mvp_official_heartbeat_job(p_job uuid, p_token uuid,
  p_generation integer, p_lease_seconds integer default 120)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare j public.mvp_official_jobs; v_lease integer := least(greatest(coalesce(p_lease_seconds, 120), 30), 3600);
begin
  update public.mvp_official_jobs set
    lease_until = clock_timestamp() + make_interval(secs => v_lease),
    heartbeat_at = clock_timestamp(), updated_at = clock_timestamp()
   where id = p_job and lease_token = p_token and generation = p_generation and status = 'running'
   returning * into j;
  if not found then return jsonb_build_object('ok', false, 'error', 'lease_lost'); end if;
  return jsonb_build_object('ok', true, 'lease_until', j.lease_until, 'generation', j.generation);
end $$;

-- Accepted result: job + game + attempt commit together. Duplicate finish is idempotent,
-- a different second result is a conflict, never an overwrite.
create or replace function public.mvp_official_finish_job(p_job uuid, p_token uuid, p_generation integer,
  p_result text, p_replay_hash text, p_replay jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare j public.mvp_official_jobs; g public.mvp_official_games;
begin
  if p_result not in ('red_win', 'blue_win', 'draw')
    or coalesce(p_replay_hash, '') !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('ok', false, 'error', 'bad_input');
  end if;
  if p_replay is not null and pg_column_size(p_replay) > 262144 then
    return jsonb_build_object('ok', false, 'error', 'replay_too_large');
  end if;
  select * into j from public.mvp_official_jobs where id = p_job for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'job_not_found'); end if;
  if j.status = 'succeeded' then
    if j.result = p_result and j.replay_hash = p_replay_hash then
      return jsonb_build_object('ok', true, 'already_recorded', true, 'result', j.result,
        'replay_hash', j.replay_hash, 'job_id', j.id);
    end if;
    return jsonb_build_object('ok', false, 'error', 'result_conflict');
  end if;
  if j.lease_token is distinct from p_token or j.generation <> p_generation or j.status <> 'running' then
    return jsonb_build_object('ok', false, 'error', 'lease_lost');
  end if;
  perform 1 from public.mvp_official_rounds where id = j.round_pk for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'round_not_found'); end if;
  select * into g from public.mvp_official_games
   where round_pk = j.round_pk and game_key = j.game_key for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'game_not_found'); end if;
  if g.result is not null then
    if g.result = p_result and g.replay_hash = p_replay_hash then
      update public.mvp_official_jobs set status = 'succeeded', result = g.result,
        replay_hash = g.replay_hash, finished_at = coalesce(j.finished_at, clock_timestamp()),
        lease_token = null, lease_until = null, error = null, error_category = null,
        updated_at = clock_timestamp() where id = j.id;
      return jsonb_build_object('ok', true, 'already_recorded', true, 'result', g.result,
        'replay_hash', g.replay_hash, 'job_id', j.id);
    end if;
    return jsonb_build_object('ok', false, 'error', 'result_conflict');
  end if;
  update public.mvp_official_games set result = p_result, replay_hash = p_replay_hash,
    recorded_at = clock_timestamp() where id = g.id;
  update public.mvp_official_jobs set status = 'succeeded', result = p_result,
    replay_hash = p_replay_hash, finished_at = clock_timestamp(), lease_token = null,
    lease_until = null, error = null, error_category = null, updated_at = clock_timestamp()
   where id = j.id;
  update public.mvp_official_job_attempts set finished_at = clock_timestamp(),
    outcome = 'succeeded', replay = p_replay
   where job_id = j.id and attempt = j.attempt;
  return jsonb_build_object('ok', true, 'already_recorded', false, 'result', p_result,
    'replay_hash', p_replay_hash, 'job_id', j.id);
end $$;

-- Failure keeps the same pinned input on retry; no game result is written and no forfeit.
create or replace function public.mvp_official_fail_job(p_job uuid, p_token uuid, p_generation integer,
  p_error text, p_category text default 'infrastructure', p_retryable boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare j public.mvp_official_jobs; v_note text := left(coalesce(p_error, ''), 400);
  v_category text := case when p_category in ('infrastructure', 'bot', 'input', 'operator')
    then p_category else 'infrastructure' end;
begin
  select * into j from public.mvp_official_jobs where id = p_job for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'job_not_found'); end if;
  if j.lease_token is distinct from p_token or j.generation <> p_generation or j.status <> 'running' then
    return jsonb_build_object('ok', false, 'error', 'lease_lost');
  end if;
  if coalesce(p_retryable, true) and v_category = 'infrastructure' and j.attempt < j.max_attempts then
    update public.mvp_official_jobs set status = 'queued', error = v_note, error_category = v_category,
      available_at = clock_timestamp() + make_interval(secs => least(300, 15 * greatest(j.attempt, 1))),
      lease_token = null, lease_until = null, updated_at = clock_timestamp()
     where id = j.id returning * into j;
  else
    update public.mvp_official_jobs set status = 'failed', error = v_note, error_category = v_category,
      finished_at = clock_timestamp(), lease_token = null, lease_until = null,
      updated_at = clock_timestamp() where id = j.id returning * into j;
  end if;
  update public.mvp_official_job_attempts set finished_at = clock_timestamp(),
    outcome = case when v_category = 'bot' then 'bot_fault'
      when v_category = 'input' then 'input_rejected'
      when v_category = 'operator' then 'cancelled'
      else 'infrastructure' end,
    error_code = left(v_note, 160)
   where job_id = j.id and attempt = j.attempt;
  return jsonb_build_object('ok', true, 'status', j.status, 'attempt', j.attempt,
    'available_at', j.available_at, 'terminal', j.status = 'failed');
end $$;

-- Operator cancel/rerun keep the audit trail; a recorded result can never be replaced here.
create or replace function public.mvp_official_cancel_job(p_job uuid, p_actor text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare j public.mvp_official_jobs; g public.mvp_official_games; v_note text := left(coalesce(p_reason, ''), 400);
begin
  if coalesce(p_actor, '') = '' or length(p_actor) > 120 then
    return jsonb_build_object('ok', false, 'error', 'bad_actor');
  end if;
  select * into j from public.mvp_official_jobs where id = p_job for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'job_not_found'); end if;
  if j.status = 'cancelled' then return jsonb_build_object('ok', true, 'already_cancelled', true); end if;
  select * into g from public.mvp_official_games where round_pk = j.round_pk and game_key = j.game_key;
  if (found and g.result is not null) or j.status = 'succeeded' then
    return jsonb_build_object('ok', false, 'error', 'result_exists');
  end if;
  update public.mvp_official_jobs set status = 'cancelled', error = v_note, error_category = 'operator',
    finished_at = clock_timestamp(), lease_token = null, lease_until = null,
    updated_at = clock_timestamp() where id = j.id;
  update public.mvp_official_job_attempts set finished_at = clock_timestamp(), outcome = 'cancelled',
    error_code = left(v_note, 160) where job_id = j.id and outcome is null;
  return jsonb_build_object('ok', true, 'already_cancelled', false, 'actor', p_actor);
end $$;

create or replace function public.mvp_official_requeue_job(p_job uuid, p_actor text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare j public.mvp_official_jobs; g public.mvp_official_games; v_note text := left(coalesce(p_reason, ''), 400);
begin
  if coalesce(p_actor, '') = '' or length(p_actor) > 120 then
    return jsonb_build_object('ok', false, 'error', 'bad_actor');
  end if;
  select * into j from public.mvp_official_jobs where id = p_job for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'job_not_found'); end if;
  if j.status not in ('failed', 'cancelled') then
    return jsonb_build_object('ok', false, 'error', 'job_not_terminal', 'status', j.status);
  end if;
  select * into g from public.mvp_official_games where round_pk = j.round_pk and game_key = j.game_key;
  if found and g.result is not null then return jsonb_build_object('ok', false, 'error', 'result_exists'); end if;
  update public.mvp_official_jobs set status = 'queued', attempt = 0, available_at = clock_timestamp(),
    error = v_note, error_category = 'operator', finished_at = null, lease_token = null,
    lease_until = null, updated_at = clock_timestamp() where id = j.id;
  return jsonb_build_object('ok', true, 'status', 'queued', 'actor', p_actor);
end $$;

-- Crash with attempts exhausted: mark terminal so it is not reclaimed forever.
create or replace function public.mvp_official_reap_jobs(p_limit integer default 50)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_count integer := 0;
begin
  with expired as (
    select id from public.mvp_official_jobs
     where status = 'running' and lease_until < clock_timestamp() and attempt >= max_attempts
     order by lease_until asc
     limit least(greatest(coalesce(p_limit, 50), 1), 500)
     for update skip locked
  ), failed as (
    update public.mvp_official_jobs j set status = 'failed', error = 'lease_expired',
      error_category = 'infrastructure', finished_at = clock_timestamp(),
      lease_token = null, lease_until = null, updated_at = clock_timestamp()
     from expired where j.id = expired.id returning j.id
  )
  select count(*) into v_count from failed;
  update public.mvp_official_job_attempts set finished_at = clock_timestamp(),
    outcome = 'lease_expired', error_code = 'lease_expired'
   where outcome is null and job_id in (select id from public.mvp_official_jobs
     where status = 'failed' and error = 'lease_expired');
  return jsonb_build_object('ok', true, 'reaped', v_count);
end $$;

revoke all on function public.mvp_official_enqueue_job(uuid, text, text) from public, anon, authenticated;
revoke all on function public.mvp_official_claim_job(text, integer) from public, anon, authenticated;
revoke all on function public.mvp_official_heartbeat_job(uuid, uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.mvp_official_finish_job(uuid, uuid, integer, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.mvp_official_fail_job(uuid, uuid, integer, text, text, boolean) from public, anon, authenticated;
revoke all on function public.mvp_official_cancel_job(uuid, text, text) from public, anon, authenticated;
revoke all on function public.mvp_official_requeue_job(uuid, text, text) from public, anon, authenticated;
revoke all on function public.mvp_official_reap_jobs(integer) from public, anon, authenticated;
grant execute on function public.mvp_official_enqueue_job(uuid, text, text) to service_role;
grant execute on function public.mvp_official_claim_job(text, integer) to service_role;
grant execute on function public.mvp_official_heartbeat_job(uuid, uuid, integer, integer) to service_role;
grant execute on function public.mvp_official_finish_job(uuid, uuid, integer, text, text, jsonb) to service_role;
grant execute on function public.mvp_official_fail_job(uuid, uuid, integer, text, text, boolean) to service_role;
grant execute on function public.mvp_official_cancel_job(uuid, text, text) to service_role;
grant execute on function public.mvp_official_requeue_job(uuid, text, text) to service_role;
grant execute on function public.mvp_official_reap_jobs(integer) to service_role;
notify pgrst, 'reload schema';

-- Rollback only before real data exists:
--   drop function public.mvp_official_reap_jobs(integer);
--   drop function public.mvp_official_requeue_job(uuid, text, text);
--   drop function public.mvp_official_cancel_job(uuid, text, text);
--   drop function public.mvp_official_fail_job(uuid, uuid, integer, text, text, boolean);
--   drop function public.mvp_official_finish_job(uuid, uuid, integer, text, text, jsonb);
--   drop function public.mvp_official_heartbeat_job(uuid, uuid, integer, integer);
--   drop function public.mvp_official_claim_job(text, integer);
--   drop function public.mvp_official_enqueue_job(uuid, text, text);
--   drop table public.mvp_official_job_attempts, public.mvp_official_jobs;
