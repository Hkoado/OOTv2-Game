-- Huy review 24/10/2026 — đóng lỗ fencing lease cho worker official (đối chiếu "Chốt schema" với Khoa).
--
-- `20261026090000_official_worker_jobs.sql` chỉ so token/generation/status:
--   * heartbeat vẫn gia hạn được lease ĐÃ hết hạn (hồi sinh lease chết),
--   * finish/fail vẫn ghi kết quả khi lease đã hết nhưng chưa bị worker khác reclaim.
-- `20261026130000_manual_worker_heartbeat.sql` đã áp đúng luật này cho manual; migration additive
-- này áp cùng luật cho official, giữ nguyên mọi điều kiện khác và fail closed nếu thân hàm khác.
--
-- Không đổi bảng/cột/kết quả đã có; không chạm grant (CREATE OR REPLACE giữ nguyên ACL).
do $migration$
declare definition text; original text; replacement text;
begin
  definition := pg_get_functiondef('public.mvp_official_heartbeat_job(uuid,uuid,integer,integer)'::regprocedure);
  original := $old$   where id = p_job and lease_token = p_token and generation = p_generation and status = 'running'$old$;
  replacement := $new$   where id = p_job and lease_token = p_token and generation = p_generation and status = 'running'
     and lease_until is not null and lease_until > clock_timestamp()$new$;
  if position(original in definition) = 0 then raise exception 'official_heartbeat_prerequisite_mismatch'; end if;
  execute replace(definition, original, replacement);

  original := 'if j.lease_token is distinct from p_token or j.generation <> p_generation or j.status <> ''running'' then';
  replacement := 'if j.lease_token is distinct from p_token or j.generation <> p_generation or j.status <> ''running'''
    || ' or j.lease_until is null or j.lease_until <= clock_timestamp() then';

  definition := pg_get_functiondef('public.mvp_official_finish_job(uuid,uuid,integer,text,text,jsonb)'::regprocedure);
  if position(original in definition) = 0 then raise exception 'official_finish_prerequisite_mismatch'; end if;
  execute replace(definition, original, replacement);

  definition := pg_get_functiondef('public.mvp_official_fail_job(uuid,uuid,integer,text,text,boolean)'::regprocedure);
  if position(original in definition) = 0 then raise exception 'official_fail_prerequisite_mismatch'; end if;
  execute replace(definition, original, replacement);
end;
$migration$;
notify pgrst, 'reload schema';
