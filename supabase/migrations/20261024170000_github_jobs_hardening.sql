-- H2 hardening cho worker GitHub (đọc kèm docs/handoff/Huy.md mục "H2 contract"):
-- 1) claim: chặn reclaim vô hạn khi worker crash (attempt >= max -> infra_fault, không phát lại).
-- 2) finish: trả envelope idempotent (mất response thì retry nhận already_finished), kiểm
--    submission_id thuộc đúng đội, status='valid' và sha256 = source_hash.
-- 3) release: BẮT BUỘC lease còn hạn; hết hạn/sai token/generation -> lease_lost, không requeue.
-- 4) connection upsert: đổi/thu hồi duyệt repo -> hủy job đang chờ và đóng băng receipt chưa kết thúc.
-- Do NOT apply remotely without operator approval.

-- 0) Nền 20261024160000 đã tạo bản cũ của các hàm này:
--    - mvp_github_finish đổi return type boolean -> jsonb nên CREATE OR REPLACE bị 42P13,
--      phải DROP trước.
--    - mvp_github_claim cũ 2 tham số sẽ che bản 3 tham số (PostgREST chọn overload khớp
--      tên tham số), nên bỏ để worker chỉ thấy contract mới.
DROP FUNCTION IF EXISTS public.mvp_github_finish(uuid,uuid,integer,jsonb);
DROP FUNCTION IF EXISTS public.mvp_github_claim(text,integer);

CREATE OR REPLACE FUNCTION public.mvp_github_claim(
  p_worker text, p_lease_seconds integer DEFAULT 120, p_max_attempts integer DEFAULT 3
) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE j public.mvp_repo_sync_jobs; tok uuid := gen_random_uuid(); v_max integer;
BEGIN
 IF p_worker IS NULL OR length(p_worker) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'bad_worker'; END IF;
 IF p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 10 AND 900 THEN RAISE EXCEPTION 'bad_lease'; END IF;
 v_max := LEAST(GREATEST(COALESCE(p_max_attempts,3),1),10);

 -- Worker crash: lease hết hạn quá số lần -> infra_fault, không phát lại (BTC xử lý tay).
 UPDATE public.mvp_github_receipts r
  SET status='infrastructure', error='worker crash: lease hết hạn quá số lần', error_category='infrastructure',
      updated_at=clock_timestamp()
  FROM public.mvp_repo_sync_jobs job
  WHERE r.job_id=job.id AND job.status IN ('leased','running')
    AND job.lease_until IS NOT NULL AND job.lease_until < clock_timestamp() AND job.attempt >= v_max
    AND r.status IN ('resolving','fetching','checking');
 UPDATE public.mvp_repo_sync_jobs job
  SET status='infra_fault', lease_token=NULL, lease_until=NULL,
      error=COALESCE(job.error,'worker crash: lease hết hạn quá số lần'), error_category='infrastructure',
      updated_at=clock_timestamp()
  WHERE job.status IN ('leased','running') AND job.lease_until IS NOT NULL
    AND job.lease_until < clock_timestamp() AND job.attempt >= v_max;

 SELECT * INTO j FROM public.mvp_repo_sync_jobs
  WHERE attempt < v_max AND (
     (status='queued' AND available_at<=clock_timestamp())
     OR (status IN ('leased','running') AND lease_until IS NOT NULL AND lease_until<clock_timestamp()))
  ORDER BY available_at, created_at FOR UPDATE SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN NULL; END IF;
 UPDATE public.mvp_repo_sync_jobs
  SET status='leased', lease_token=tok,
   lease_until=clock_timestamp()+make_interval(secs=>p_lease_seconds),
   attempt=attempt+1, generation=generation+1, updated_at=clock_timestamp()
  WHERE id=j.id RETURNING * INTO j;
 RETURN jsonb_build_object(
  'job', to_jsonb(j),
  'receipt', (SELECT to_jsonb(r) FROM public.mvp_github_receipts r WHERE r.job_id=j.id),
  'lease', jsonb_build_object('token',j.lease_token,'generation',j.generation,'expires_at',j.lease_until,
   'attempt',j.attempt,'max_attempts',v_max));
END; $$;

-- Finish trả envelope: `{ok, applied, already_finished, job, receipt}` để worker đối soát khi mất response.
CREATE OR REPLACE FUNCTION public.mvp_github_finish(
  p_job uuid, p_token uuid, p_generation integer, p_outcome jsonb
) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE j public.mvp_repo_sync_jobs; r public.mvp_github_receipts; v_sub uuid; v_status text;
  v_hash text; v_note text; v_category text;
BEGIN
 IF p_outcome IS NULL OR jsonb_typeof(p_outcome)<>'object' THEN RAISE EXCEPTION 'bad_outcome'; END IF;
 v_status := p_outcome->>'status';
 IF v_status NOT IN ('valid','invalid','infrastructure') THEN RAISE EXCEPTION 'bad_outcome'; END IF;

 SELECT * INTO j FROM public.mvp_repo_sync_jobs WHERE id=p_job FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','job_not_found'); END IF;

 -- Idempotent: job đã kết thúc (lần trước commit nhưng mất response, hoặc worker khác đã xong).
 IF j.status IN ('completed','bot_fault','infra_fault','canceled') THEN
  SELECT * INTO r FROM public.mvp_github_receipts WHERE job_id=p_job;
  RETURN jsonb_build_object('ok',true,'applied',false,'already_finished',true,
    'job',to_jsonb(j),'receipt',to_jsonb(r));
 END IF;

 IF j.lease_token IS DISTINCT FROM p_token OR j.generation<>p_generation
    OR j.lease_until IS NULL OR j.lease_until<=clock_timestamp()
    OR j.status NOT IN ('leased','running') THEN
  RETURN jsonb_build_object('ok',false,'error','lease_lost');
 END IF;

 SELECT * INTO r FROM public.mvp_github_receipts WHERE job_id=p_job;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','receipt_missing'); END IF;

 v_hash := NULLIF(p_outcome->>'source_hash','');
 v_note := left(NULLIF(p_outcome->>'error',''),400);
 IF p_outcome->>'error_category' IN ('code','infrastructure','repo') THEN v_category := p_outcome->>'error_category'; END IF;

 IF v_status='valid' THEN
  IF v_hash IS NULL OR v_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'bad_outcome'; END IF;
  v_sub := NULLIF(p_outcome->>'submission_id','')::uuid;
  IF v_sub IS NOT NULL THEN
   -- Submission có sẵn: phải cùng đội của job, status valid và cùng sha256 (không tin payload).
   IF NOT EXISTS(SELECT 1 FROM public.mvp_submissions s
                  WHERE s.id=v_sub AND s.participant_id=j.team_id AND s.status='valid' AND s.sha256=v_hash)
    THEN RETURN jsonb_build_object('ok',false,'error','bad_submission'); END IF;
  ELSIF jsonb_typeof(p_outcome->'submission')='object' THEN
   IF (p_outcome->'submission'->>'storage_path') !~ '^[0-9a-f-]{36}\.py$'
    OR (p_outcome->'submission'->>'sha256') !~ '^[0-9a-f]{64}$'
    OR (p_outcome->'submission'->>'sha256') <> v_hash THEN
    RETURN jsonb_build_object('ok',false,'error','bad_submission'); END IF;
   INSERT INTO public.mvp_submissions(id,participant_id,storage_path,sha256,status,validation_error,created_at)
   VALUES(gen_random_uuid(), j.team_id, p_outcome->'submission'->>'storage_path',
     p_outcome->'submission'->>'sha256','valid',NULL,clock_timestamp())
   RETURNING id INTO v_sub;
  ELSE
   RETURN jsonb_build_object('ok',false,'error','missing_submission');
  END IF;
  UPDATE public.mvp_github_receipts SET status='valid', source_hash=v_hash, error=NULL, error_category=NULL,
   submission_id=v_sub, updated_at=clock_timestamp() WHERE job_id=p_job RETURNING * INTO r;
  UPDATE public.mvp_repo_sync_jobs SET status='completed', error=NULL, error_category=NULL,
   lease_token=NULL, lease_until=NULL, updated_at=clock_timestamp() WHERE id=p_job RETURNING * INTO j;
  RETURN jsonb_build_object('ok',true,'applied',true,'already_finished',false,
    'job',to_jsonb(j),'receipt',to_jsonb(r));
 END IF;

 UPDATE public.mvp_github_receipts SET status=v_status, source_hash=v_hash,
  error=COALESCE(v_note, CASE WHEN v_status='invalid' THEN 'bot không vượt qua kiểm tra'
                              ELSE 'lỗi hạ tầng khi tải/kiểm bot' END),
  error_category=COALESCE(v_category, CASE WHEN v_status='invalid' THEN 'code' ELSE 'infrastructure' END),
  updated_at=clock_timestamp() WHERE job_id=p_job RETURNING * INTO r;
 UPDATE public.mvp_repo_sync_jobs SET
  status=CASE WHEN v_status='invalid' THEN 'bot_fault' ELSE 'infra_fault' END,
  error=v_note,
  error_category=COALESCE(v_category, CASE WHEN v_status='invalid' THEN 'code' ELSE 'infrastructure' END),
  lease_token=NULL, lease_until=NULL, updated_at=clock_timestamp() WHERE id=p_job RETURNING * INTO j;
 RETURN jsonb_build_object('ok',true,'applied',true,'already_finished',false,
   'job',to_jsonb(j),'receipt',to_jsonb(r));
END; $$;

-- Release: bắt buộc lease CÒN HẠN; hết hạn/sai token/generation => lease_lost (không requeue, không ghi đè).
CREATE OR REPLACE FUNCTION public.mvp_github_release(
  p_job uuid, p_token uuid, p_generation integer, p_error text DEFAULT NULL, p_max_attempts integer DEFAULT 3
) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE j public.mvp_repo_sync_jobs; r public.mvp_github_receipts;
  v_max integer := LEAST(GREATEST(COALESCE(p_max_attempts,3),1),10);
  v_note text := left(NULLIF(p_error,''),400);
BEGIN
 UPDATE public.mvp_repo_sync_jobs SET
  status=CASE WHEN attempt>=v_max THEN 'infra_fault' ELSE 'queued' END,
  available_at=CASE WHEN attempt>=v_max THEN available_at
                    ELSE clock_timestamp()+make_interval(secs=>LEAST(300, 15*GREATEST(attempt,1))) END,
  error=v_note, error_category='infrastructure', lease_token=NULL, lease_until=NULL, updated_at=clock_timestamp()
  WHERE id=p_job AND lease_token=p_token AND generation=p_generation
    AND status IN ('leased','running') AND lease_until>clock_timestamp()
  RETURNING * INTO j;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','lease_lost','applied',false); END IF;
 UPDATE public.mvp_github_receipts SET status='infrastructure', error=v_note, error_category='infrastructure',
  updated_at=clock_timestamp() WHERE job_id=p_job
  AND status IN ('resolving','fetching','checking') RETURNING * INTO r;
 RETURN jsonb_build_object('ok',true,'applied',true,'status',j.status,'attempt',j.attempt,
   'available_at',j.available_at,'receipt',to_jsonb(r));
END; $$;

-- Đăng ký/duyệt/thu hồi repo. Đổi repo/branch hoặc thu hồi duyệt => hủy job đang chờ và
-- đóng băng receipt chưa kết thúc (receipt đã valid giữ nguyên, snapshot đã khóa không đổi).
CREATE OR REPLACE FUNCTION public.mvp_repo_connection_upsert(
  p_event uuid, p_team uuid, p_repository text, p_repo_id bigint,
  p_branch text, p_file_path text, p_approved boolean, p_actor uuid
) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE v public.mvp_tournaments; c public.mvp_repo_connections;
  v_keep boolean := false; v_canceled integer := 0;
BEGIN
 IF p_file_path IS DISTINCT FROM 'bot.py' OR p_branch IS NULL OR length(p_branch)<1 THEN
  RETURN jsonb_build_object('ok',false,'error','bad_request'); END IF;
 SELECT * INTO v FROM public.mvp_tournaments WHERE id=p_event FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','event_not_found'); END IF;
 IF v.status<>'draft' THEN RETURN jsonb_build_object('ok',false,'error','event_frozen'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.mvp_tournament_entries WHERE tournament_id=p_event AND participant_id=p_team)
  THEN RETURN jsonb_build_object('ok',false,'error','not_in_event'); END IF;
 IF EXISTS(SELECT 1 FROM public.mvp_repo_connections WHERE event_id=p_event AND repo_id=p_repo_id AND team_id<>p_team)
  THEN RETURN jsonb_build_object('ok',false,'error','repo_taken'); END IF;
 SELECT * INTO c FROM public.mvp_repo_connections WHERE event_id=p_event AND team_id=p_team FOR UPDATE;
 IF FOUND THEN
  v_keep := (c.repo_id=p_repo_id AND c.repository=p_repository AND c.branch=p_branch AND c.approved);
  UPDATE public.mvp_repo_connections SET repo_id=p_repo_id,repository=p_repository,branch=p_branch,
   approved=(p_approved OR v_keep),
   approved_by=CASE WHEN p_approved THEN p_actor::text WHEN v_keep THEN approved_by ELSE NULL END,
   updated_at=clock_timestamp() WHERE id=c.id RETURNING * INTO c;
 ELSE
  INSERT INTO public.mvp_repo_connections(id,event_id,team_id,repo_id,repository,branch,file_path,approved,approved_by)
  VALUES(gen_random_uuid(),p_event,p_team,p_repo_id,p_repository,p_branch,p_file_path,p_approved,
   CASE WHEN p_approved THEN p_actor::text ELSE NULL END) RETURNING * INTO c;
 END IF;

 IF c.approved IS NOT TRUE THEN
  UPDATE public.mvp_github_receipts r
   SET status='frozen', error=COALESCE(r.error,'repository_changed'), error_category='repo',
       updated_at=clock_timestamp()
   FROM public.mvp_repo_sync_jobs j
   WHERE r.job_id=j.id AND j.event_id=p_event AND j.team_id=p_team
     AND j.status IN ('queued','leased','running')
     AND r.status IN ('resolving','fetching','checking');
  UPDATE public.mvp_repo_sync_jobs
   SET status='canceled', lease_token=NULL, lease_until=NULL,
       error='repository_changed', error_category='repo', updated_at=clock_timestamp()
   WHERE event_id=p_event AND team_id=p_team AND status IN ('queued','leased','running');
  GET DIAGNOSTICS v_canceled = ROW_COUNT;
 END IF;
 RETURN jsonb_build_object('ok',true,'connection',to_jsonb(c),'canceled_jobs',v_canceled);
END; $$;

-- Admin thu hồi duyệt repo (khác với team gửi lại cùng repo): luôn approved=false,
-- hủy job đang chờ và đóng băng receipt chưa kết thúc.
CREATE OR REPLACE FUNCTION public.mvp_repo_connection_revoke(
  p_event uuid, p_team uuid, p_actor uuid
) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE v public.mvp_tournaments; c public.mvp_repo_connections; v_canceled integer := 0;
BEGIN
 SELECT * INTO v FROM public.mvp_tournaments WHERE id=p_event FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','event_not_found'); END IF;
 IF v.status<>'draft' THEN RETURN jsonb_build_object('ok',false,'error','event_frozen'); END IF;
 UPDATE public.mvp_repo_connections SET approved=false, approved_by=NULL, updated_at=clock_timestamp()
  WHERE event_id=p_event AND team_id=p_team RETURNING * INTO c;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','repository_not_registered'); END IF;

 UPDATE public.mvp_github_receipts r
  SET status='frozen', error=COALESCE(r.error,'repository_revoked'), error_category='repo',
      updated_at=clock_timestamp()
  FROM public.mvp_repo_sync_jobs j
  WHERE r.job_id=j.id AND j.event_id=p_event AND j.team_id=p_team
    AND j.status IN ('queued','leased','running')
    AND r.status IN ('resolving','fetching','checking');
 UPDATE public.mvp_repo_sync_jobs
  SET status='canceled', lease_token=NULL, lease_until=NULL,
      error='repository_revoked', error_category='repo', updated_at=clock_timestamp()
  WHERE event_id=p_event AND team_id=p_team AND status IN ('queued','leased','running');
 GET DIAGNOSTICS v_canceled = ROW_COUNT;

 RETURN jsonb_build_object('ok',true,'connection',to_jsonb(c),'canceled_jobs',v_canceled);
END; $$;

REVOKE ALL ON FUNCTION public.mvp_github_claim(text,integer,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.mvp_github_finish(uuid,uuid,integer,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.mvp_github_release(uuid,uuid,integer,text,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.mvp_repo_connection_upsert(uuid,uuid,text,bigint,text,text,boolean,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.mvp_repo_connection_revoke(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mvp_github_claim(text,integer,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.mvp_github_finish(uuid,uuid,integer,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.mvp_github_release(uuid,uuid,integer,text,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.mvp_repo_connection_upsert(uuid,uuid,text,bigint,text,text,boolean,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.mvp_repo_connection_revoke(uuid,uuid,uuid) TO service_role;
NOTIFY pgrst,'reload schema';


