-- Chung kết thủ công — PostgreSQL drill (chạy SAU khi migration đã apply).
--
-- Cách chạy:
--   psql "$SUPABASE_DB_URL" -f supabase/tests/manual_final.sql
--   hoặc `npm run db:manual` (rehearsal: áp migration + drill trong MỘT transaction rồi ROLLBACK).
--
-- Toàn bộ nằm trong một transaction và kết thúc bằng ROLLBACK: không để lại dữ liệu.
-- Mỗi check hỏng sẽ RAISE với tên `drill_*` để biết chính xác luật nào bị phá.

begin;

do $$
declare
  v_admin uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_team1 uuid := gen_random_uuid();
  v_team2 uuid := gen_random_uuid();
  v_sub1 uuid := gen_random_uuid();
  v_sub1b uuid := gen_random_uuid();
  v_sub2 uuid := gen_random_uuid();
  v_sha1 text := repeat('a', 64);
  v_sha1b text := repeat('b', 64);
  v_sha2 text := repeat('c', 64);
  v_map_hash text := repeat('f', 64);
  v_map jsonb := jsonb_build_object(
    'schemaVersion', 'map.v2', 'rulesVersion', 'ott-campus.v2',
    'id', 'drill-map', 'revision', 1, 'width', 9, 'height', 9,
    'bases', jsonb_build_object('red', 'a1', 'blue', 'i9'),
    'blocked', '[]'::jsonb, 'terrains', '{}'::jsonb);
  v_runtime jsonb := jsonb_build_object(
    'runtimeVersion', 'campus-runtime.v1', 'rulesVersion', 'ott-campus.v2',
    'protocolVersion', 'bot.v1', 'runtimeHash', repeat('d', 64),
    'budgetHash', repeat('e', 64),
    'budget', jsonb_build_object('maxPlies', 400, 'setupWallMs', 5000));
  v_res jsonb;
  v_claim jsonb;
  v_job jsonb;
  v_token uuid;
  v_generation integer;
  v_match uuid;
  v_match2 uuid;
  v_job_id uuid;
  v_payload jsonb;
  v_count integer;
begin
  insert into public.mvp_participants(id, name, name_key, created_at) values
    (v_team1, 'Drill Alpha', 'drill alpha ' || v_team1, clock_timestamp()),
    (v_team2, 'Drill Beta', 'drill beta ' || v_team2, clock_timestamp());
  insert into public.mvp_accounts(id, username, password_hash, role, participant_id, created_at)
    values (v_admin, 'drill-' || v_admin, 'x:0', 'admin', null, clock_timestamp());
  insert into public.mvp_manual_final_events(id, name, level, round_no, status, map_json, map_hash,
    runtime_json, seed, created_by)
    values (v_event, 'Drill manual final', 'semester', 1, 'draft', v_map, v_map_hash, v_runtime, 7, v_admin);
  insert into public.mvp_manual_final_teams(event_id, team_id, seed_order)
    values (v_event, v_team1, 1), (v_event, v_team2, 2);
  insert into public.mvp_manual_final_submissions(id, event_id, round_no, team_id, filename,
    storage_path, sha256, byte_size, status, received_by)
    values
      (v_sub1, v_event, 1, v_team1, 'bot.py', v_sub1 || '.py', v_sha1, 120, 'pending', v_admin),
      (v_sub2, v_event, 1, v_team2, 'bot.py', v_sub2 || '.py', v_sha2, 120, 'pending', v_admin);
  insert into public.mvp_manual_final_jobs(event_id, round_no, kind, submission_id, input_hash)
    values (v_event, 1, 'validate', v_sub1, v_sha1), (v_event, 1, 'validate', v_sub2, v_sha2);

  -- 1) Worker claim validate rồi finish valid (fence đúng lease/generation).
  v_claim := public.mvp_manual_final_claim('drill-intake', 5, 120);
  if jsonb_array_length(v_claim->'jobs') <> 2 then
    raise exception 'drill_claim_two_validate_jobs_expected:%', jsonb_array_length(v_claim->'jobs');
  end if;
  for v_job in select value from jsonb_array_elements(v_claim->'jobs') loop
    v_res := public.mvp_manual_final_finish(
      (v_job->>'job_id')::uuid, (v_job->>'token')::uuid, (v_job->>'generation')::integer,
      jsonb_build_object('status', 'valid',
        'source_hash', (select sha256 from public.mvp_manual_final_submissions
          where id = (v_job->>'submission_id')::uuid)));
    if (v_res->>'applied')::boolean is not true then
      raise exception 'drill_validate_finish_failed:%', v_res::text;
    end if;
  end loop;
  if exists (select 1 from public.mvp_manual_final_submissions
      where event_id = v_event and status <> 'valid') then
    raise exception 'drill_submission_not_valid';
  end if;

  -- 2) Chọn + khóa: pending không khóa được, khóa lặp idempotent, chọn bài khác sau khóa bị chặn.
  update public.mvp_manual_final_events set status = 'intake' where id = v_event;
  insert into public.mvp_manual_final_submissions(id, event_id, round_no, team_id, filename,
    storage_path, sha256, byte_size, status, received_by)
    values (v_sub1b, v_event, 1, v_team1, 'bot.py', v_sub1b || '.py', v_sha1b, 130, 'pending', v_admin);
  v_res := public.mvp_manual_final_select(v_sub1b, v_admin);
  if v_res->>'error' is distinct from 'submission_not_valid' then
    raise exception 'drill_pending_select_should_fail:%', v_res::text;
  end if;
  v_res := public.mvp_manual_final_lock(v_event, v_team1, v_admin);
  if v_res->>'error' is distinct from 'not_selected' then
    raise exception 'drill_lock_without_select_should_fail:%', v_res::text;
  end if;

  v_res := public.mvp_manual_final_select(v_sub1, v_admin);
  if (v_res->>'ok')::boolean is not true then raise exception 'drill_select_failed:%', v_res::text; end if;
  v_res := public.mvp_manual_final_lock(v_event, v_team1, v_admin);
  if (v_res->>'already_locked')::boolean is not false
    or (v_res->>'sha256') is distinct from v_sha1 then
    raise exception 'drill_lock_failed:%', v_res::text;
  end if;
  v_res := public.mvp_manual_final_lock(v_event, v_team1, v_admin);
  if (v_res->>'already_locked')::boolean is not true then
    raise exception 'drill_lock_not_idempotent:%', v_res::text;
  end if;

  -- Còn đội chưa khóa: update status=locked phải bị trigger chặn.
  begin
    update public.mvp_manual_final_events set status = 'locked' where id = v_event;
    raise exception 'drill_round_lock_should_fail';
  exception when check_violation then null;
  end;

  v_res := public.mvp_manual_final_select(v_sub2, v_admin);
  if (v_res->>'ok')::boolean is not true then raise exception 'drill_select2_failed:%', v_res::text; end if;
  v_res := public.mvp_manual_final_lock(v_event, v_team2, v_admin);
  if (v_res->>'ok')::boolean is not true then raise exception 'drill_lock2_failed:%', v_res::text; end if;
  update public.mvp_manual_final_events set status = 'locked' where id = v_event;
  if (select status from public.mvp_manual_final_events where id = v_event) <> 'locked' then
    raise exception 'drill_round_not_locked';
  end if;

  -- Sau khóa: không nhận bài mới, chọn bài khác cũng bị chặn.
  begin
    insert into public.mvp_manual_final_submissions(id, event_id, round_no, team_id, filename,
      storage_path, sha256, byte_size, status, received_by)
      values (gen_random_uuid(), v_event, 1, v_team1, 'bot.py', gen_random_uuid() || '.py',
        repeat('9', 64), 100, 'pending', v_admin);
    raise exception 'drill_upload_after_lock_should_fail';
  exception when check_violation then null;
  end;
  v_res := public.mvp_manual_final_select(v_sub1b, v_admin);
  if v_res->>'error' is distinct from 'event_not_open' then
    raise exception 'drill_reselect_after_lock_should_fail:%', v_res::text;
  end if;


  -- 3) Pair: idempotent theo key, snapshot pin đúng map/runtime/bài đã khóa.
  v_payload := jsonb_build_object(
    'eventId', v_event, 'seriesId', 'sf1', 'gameNo', 1,
    'redTeamId', v_team1, 'blueTeamId', v_team2, 'seed', 7,
    'mapHash', v_map_hash, 'snapshotHash', repeat('1', 64),
    'snapshot', jsonb_build_object(
      'schemaVersion', 'manual-final-match.v1', 'provenance', 'manual_final',
      'eventId', v_event, 'roundNo', 1, 'seriesId', 'sf1', 'gameNo', 1, 'seed', 7,
      'mapHash', v_map_hash, 'map', v_map, 'runtime', v_runtime,
      'colorPolicy', 'manual-final.red-first.v1',
      'red', jsonb_build_object('teamId', v_team1, 'submissionId', v_sub1, 'sha256', v_sha1),
      'blue', jsonb_build_object('teamId', v_team2, 'submissionId', v_sub2, 'sha256', v_sha2)),
    'idempotencyKey', 'manual-final.v1:drill:sf1:1');
  v_res := public.mvp_manual_final_pair(v_payload, v_admin);
  if (v_res->>'ok')::boolean is not true then raise exception 'drill_pair_failed:%', v_res::text; end if;
  v_match := (v_res->>'match_id')::uuid;
  v_res := public.mvp_manual_final_pair(v_payload, v_admin);
  if (v_res->>'idempotent')::boolean is not true or (v_res->>'match_id')::uuid <> v_match then
    raise exception 'drill_pair_not_idempotent:%', v_res::text;
  end if;
  if exists (select 1 from public.mvp_manual_final_matches m
      where m.event_id = v_event and m.snapshot_json->>'provenance' <> 'manual_final') then
    raise exception 'drill_pair_provenance_wrong';
  end if;

  -- 4) Finish match có fence: stale generation -> lease_lost; duplicate -> already_finished.
  v_claim := public.mvp_manual_final_claim('drill-judge', 5, 120);
  select value into v_job from jsonb_array_elements(v_claim->'jobs') where value->>'kind' = 'match';
  if v_job is null then raise exception 'drill_match_job_not_claimed'; end if;
  v_job_id := (v_job->>'job_id')::uuid;
  v_token := (v_job->>'token')::uuid;
  v_generation := (v_job->>'generation')::integer;

  v_res := public.mvp_manual_final_finish(v_job_id, v_token, v_generation + 1,
    jsonb_build_object('status', 'finished', 'result', 'red_win', 'ply_count', 10,
      'replay', jsonb_build_object('schemaVersion', 'campus-replay.v1')));
  if v_res->>'error' is distinct from 'lease_lost' then
    raise exception 'drill_stale_finish_should_fail:%', v_res::text;
  end if;
  if (select status from public.mvp_manual_final_matches where id = v_match) <> 'running' then
    raise exception 'drill_stale_finish_wrote_result';
  end if;

  v_res := public.mvp_manual_final_finish(v_job_id, v_token, v_generation,
    jsonb_build_object('status', 'finished', 'result', 'red_win', 'ply_count', 42, 'reason', 'king_capture',
      'replay', jsonb_build_object('schemaVersion', 'campus-replay.v1', 'moves', '[]'::jsonb)));
  if (v_res->>'applied')::boolean is not true or (v_res->>'result') is distinct from 'red_win' then
    raise exception 'drill_finish_failed:%', v_res::text;
  end if;
  v_res := public.mvp_manual_final_finish(v_job_id, v_token, v_generation,
    jsonb_build_object('status', 'finished', 'result', 'blue_win', 'ply_count', 42,
      'replay', jsonb_build_object('schemaVersion', 'campus-replay.v1')));
  if (v_res->>'already_finished')::boolean is not true then
    raise exception 'drill_duplicate_finish_not_idempotent:%', v_res::text;
  end if;
  select count(*) into v_count from public.mvp_manual_final_matches
    where event_id = v_event and status = 'finished' and result = 'red_win';
  if v_count <> 1 then raise exception 'drill_duplicate_result_count:%', v_count; end if;

  -- 5) Không hủy kết quả đã accepted; hủy trận khác cần lý do; rerun giữ nguyên input.
  v_res := public.mvp_manual_final_cancel(v_match, v_admin, 'Muốn đổi kết quả đã accepted');
  if v_res->>'error' is distinct from 'result_conflict' then
    raise exception 'drill_cancel_finished_should_fail:%', v_res::text;
  end if;
  v_payload := jsonb_set(jsonb_set(v_payload, '{gameNo}', '2'::jsonb),
    '{idempotencyKey}', '"manual-final.v1:drill:sf1:2"'::jsonb);
  v_payload := jsonb_set(v_payload, '{snapshot}',
    jsonb_set(jsonb_set(v_payload->'snapshot', '{gameNo}', '2'::jsonb),
      '{snapshotHash}', to_jsonb(repeat('2', 64))));
  v_res := public.mvp_manual_final_pair(v_payload, v_admin);
  if (v_res->>'ok')::boolean is not true then raise exception 'drill_pair_game2_failed:%', v_res::text; end if;
  v_match2 := (v_res->>'match_id')::uuid;
  v_res := public.mvp_manual_final_cancel(v_match2, v_admin, 'x');
  if v_res->>'error' is distinct from 'reason_required' then
    raise exception 'drill_cancel_without_reason_should_fail:%', v_res::text;
  end if;
  v_res := public.mvp_manual_final_cancel(v_match2, v_admin, 'Sai cặp đội do BTC chọn nhầm');
  if (v_res->>'ok')::boolean is not true or v_res->>'status' is distinct from 'canceled' then
    raise exception 'drill_cancel_failed:%', v_res::text;
  end if;
  if exists (select 1 from public.mvp_manual_final_jobs
      where match_id = v_match2 and status <> 'canceled') then
    raise exception 'drill_cancel_left_job_open';
  end if;


  -- 6) Rerun: trận mới giữ đúng snapshot/bài đã khóa, trận cũ vẫn còn trong lịch sử.
  v_payload := jsonb_set(v_payload, '{idempotencyKey}',
    to_jsonb('manual-final.v1:drill:sf1:2:rerun:' || v_match2::text));
  v_payload := jsonb_set(v_payload, '{rerunOf}', to_jsonb(v_match2::text));
  v_payload := jsonb_set(v_payload, '{note}', '"Chấm lại sau khi hủy nhầm cặp"'::jsonb);
  v_res := public.mvp_manual_final_pair(v_payload, v_admin);
  if (v_res->>'ok')::boolean is not true then raise exception 'drill_rerun_failed:%', v_res::text; end if;
  if (select rerun_of from public.mvp_manual_final_matches where id = (v_res->>'match_id')::uuid)
      is distinct from v_match2 then
    raise exception 'drill_rerun_link_missing';
  end if;
  if (select status from public.mvp_manual_final_matches where id = v_match2) <> 'canceled' then
    raise exception 'drill_rerun_mutated_history';
  end if;

  -- 7) Còn job chờ thì không chốt đợt; hủy xong mới chốt được.
  begin
    update public.mvp_manual_final_events set status = 'closed', closed_at = clock_timestamp() where id = v_event;
    raise exception 'drill_close_with_pending_job_should_fail';
  exception when check_violation then null;
  end;
  perform public.mvp_manual_final_cancel((v_res->>'match_id')::uuid, v_admin, 'Không cần chấm lại nữa');
  update public.mvp_manual_final_events set status = 'closed', closed_at = clock_timestamp() where id = v_event;
  if (select status from public.mvp_manual_final_events where id = v_event) <> 'closed' then
    raise exception 'drill_close_failed';
  end if;

  -- 8) Quyền: service_role không sửa bytes/hash/result; audit append-only; anon không đọc.
  if not has_table_privilege('service_role', 'public.mvp_manual_final_submissions', 'INSERT') then
    raise exception 'drill_service_insert_missing';
  end if;
  if has_table_privilege('service_role', 'public.mvp_manual_final_submissions', 'UPDATE') then
    raise exception 'drill_submission_update_grant_leaked';
  end if;
  if has_column_privilege('service_role', 'public.mvp_manual_final_matches', 'result', 'UPDATE') then
    raise exception 'drill_match_result_update_grant_leaked';
  end if;
  if has_column_privilege('service_role', 'public.mvp_manual_final_submissions', 'sha256', 'UPDATE') then
    raise exception 'drill_submission_hash_update_grant_leaked';
  end if;
  if has_table_privilege('anon', 'public.mvp_manual_final_events', 'SELECT')
    or has_table_privilege('authenticated', 'public.mvp_manual_final_submissions', 'SELECT') then
    raise exception 'drill_browser_read_grant_leaked';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.mvp_manual_final_submissions'::regclass) then
    raise exception 'drill_rls_not_enabled';
  end if;
  begin
    update public.mvp_manual_final_audit set reason = 'tamper';
    raise exception 'drill_audit_update_should_fail';
  exception when check_violation then null;
  end;

  -- 9) Một ván lịch chỉ có một kết quả accepted (unique partial index).
  if not exists (select 1 from pg_indexes where schemaname = 'public'
      and indexname = 'mvp_manual_final_one_accepted') then
    raise exception 'drill_one_accepted_index_missing';
  end if;

  raise notice 'manual_final drill: all checks passed (transaction rolled back)';
end $$;

rollback;

