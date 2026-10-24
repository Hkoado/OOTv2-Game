-- Additive runtime hardening. Apply before deploying the manual heartbeat consumer.
-- Does not change source/snapshot identities or rewrite historical results.
create function public.mvp_manual_final_heartbeat(p_job uuid, p_token uuid,
  p_generation integer, p_lease_seconds integer default 120)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_until timestamptz;
begin
  if p_lease_seconds is null or p_lease_seconds not between 10 and 900 then
    return jsonb_build_object('ok', false, 'error', 'bad_lease');
  end if;
  update public.mvp_manual_final_jobs
    set lease_until = clock_timestamp() + make_interval(secs => p_lease_seconds),
        updated_at = clock_timestamp()
    where id = p_job and status = 'running' and lease_token = p_token
      and generation = p_generation and lease_until > clock_timestamp()
    returning lease_until into v_until;
  if not found then return jsonb_build_object('ok', false, 'error', 'lease_lost'); end if;
  return jsonb_build_object('ok', true, 'lease_until', v_until);
end; $$;
revoke all on function public.mvp_manual_final_heartbeat(uuid,uuid,integer,integer) from public,anon,authenticated;
grant execute on function public.mvp_manual_final_heartbeat(uuid,uuid,integer,integer) to service_role;

-- Preserve the reviewed RPC bodies and fail closed if their prerequisite definition
-- differs. This is an additive replacement, never an edit to an applied migration.
do $migration$
declare definition text; original text; replacement text;
begin
  definition := pg_get_functiondef('public.mvp_manual_final_claim(text,integer,integer)'::regprocedure);
  original := $old$  update public.mvp_manual_final_jobs set status = 'queued', lease_token = null, updated_at = clock_timestamp()
    where status = 'running' and lease_until <= clock_timestamp();$old$;
  replacement := $new$  for j in select * from public.mvp_manual_final_jobs
      where (status = 'running' and lease_until <= clock_timestamp())
         or (status = 'queued' and attempt >= max_attempts)
      order by created_at, id for update skip locked loop
    if j.attempt >= j.max_attempts then
      update public.mvp_manual_final_jobs set status = 'infra_fault',
        error_code = 'lease_expired_max_attempts', lease_token = null, lease_until = null,
        finished_at = clock_timestamp(), updated_at = clock_timestamp() where id = j.id;
      if j.match_id is not null then
        update public.mvp_manual_final_matches set status = 'infra_fault',
          error_code = 'lease_expired_max_attempts' where id = j.match_id and status in ('queued','running');
      else
        update public.mvp_manual_final_submissions set status = 'infrastructure',
          error_code = 'lease_expired_max_attempts' where id = j.submission_id and status = 'pending';
      end if;
    else
      update public.mvp_manual_final_jobs set status = 'queued', lease_token = null, lease_until = null,
        updated_at = clock_timestamp() where id = j.id;
    end if;
    perform public.mvp_manual_final_log(j.event_id, 'job', j.id, 'retry', null, null,
      jsonb_build_object('attempt', j.attempt, 'generation', j.generation, 'reason', 'lease_expired'));
  end loop;$new$;
  if position(original in definition) = 0 then raise exception 'manual_claim_prerequisite_mismatch'; end if;
  execute replace(definition, original, replacement);

  original := 'if j.lease_token is distinct from p_token or j.generation <> p_generation then';
  replacement := 'if j.lease_token is distinct from p_token or j.generation <> p_generation'
    || ' or j.status <> ''running'' or j.lease_until is null or j.lease_until <= clock_timestamp() then';
  definition := pg_get_functiondef('public.mvp_manual_final_finish(uuid,uuid,integer,jsonb)'::regprocedure);
  if position(original in definition) = 0 then raise exception 'manual_finish_prerequisite_mismatch'; end if;
  definition := replace(definition, original, replacement);
  if position('or v_ply is null or v_ply < 1' in definition) = 0 then raise exception 'manual_ply_prerequisite_mismatch'; end if;
  execute replace(definition, 'or v_ply is null or v_ply < 1', 'or v_ply is null or v_ply < 0 or v_ply > 1000');
  definition := pg_get_functiondef('public.mvp_manual_final_release(uuid,uuid,integer,text,integer)'::regprocedure);
  if position(original in definition) = 0 then raise exception 'manual_release_prerequisite_mismatch'; end if;
  execute replace(definition, original, replacement);
end;
$migration$;
notify pgrst, 'reload schema';