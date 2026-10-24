-- H1 (fix + worker contract): lease/generation cho job GitHub và sửa previous_valid_submission_id.
-- - Bugfix: `previous_valid_submission_id` phải là `submission_id` của receipt valid (không phải receipt id).
--   File `20261024130000_github_intake.sql` đã được sửa tại chỗ vì migration CHƯA apply remote.
--   Nếu ai đã apply bản nháp trước đó: chạy lại file cũ (DROP FUNCTION mvp_github_intake rồi apply lại)
--   hoặc apply migration này sau khi đã `CREATE OR REPLACE` bên dưới.
-- - Worker contract: claim → heartbeat/progress → finish | release (retry có backoff), mọi bước so
--   lease token + generation để worker cũ không ghi đè kết quả mới.
-- Do NOT apply remotely without operator approval.

ALTER TABLE public.mvp_repo_sync_jobs ADD COLUMN IF NOT EXISTS generation integer NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS mvp_repo_sync_jobs_lease ON public.mvp_repo_sync_jobs(status, lease_until);

-- Sửa lại intake cho DB đã lỡ apply bản nháp (giữ nguyên chữ ký hàm).
CREATE OR REPLACE FUNCTION public.mvp_github_intake(
  p_event uuid, p_team uuid, p_account uuid, p_repository text, p_branch text,
  p_file_path text, p_repo_id bigint, p_commit_sha text, p_daily_quota integer DEFAULT 10
) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE v public.mvp_tournaments; cfg jsonb; conn public.mvp_repo_connections;
  j public.mvp_repo_sync_jobs; r public.mvp_github_receipts; cutoff_at timestamptz;
  used integer; previous uuid; new_job uuid := gen_random_uuid(); new_receipt uuid := gen_random_uuid();
BEGIN
 IF p_file_path IS DISTINCT FROM 'bot.py' OR p_repo_id IS NULL OR p_repo_id<=0
  OR p_commit_sha IS NULL OR p_commit_sha !~ '^[0-9a-f]{40}$' THEN
  RETURN jsonb_build_object('ok',false,'error','bad_request'); END IF;
 SELECT * INTO v FROM public.mvp_tournaments WHERE id=p_event FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','event_not_found'); END IF;
 IF v.status<>'draft' THEN RETURN jsonb_build_object('ok',false,'error','event_frozen'); END IF;
 SELECT config INTO cfg FROM public.mvp_official_setups WHERE tournament_id=p_event;
 IF cfg IS NOT NULL AND cfg->>'cutoff' IS NOT NULL THEN
  BEGIN cutoff_at := (cfg->>'cutoff')::timestamptz; EXCEPTION WHEN others THEN cutoff_at := NULL; END;
  IF cutoff_at IS NOT NULL AND cutoff_at<=clock_timestamp()
   THEN RETURN jsonb_build_object('ok',false,'error','past_cutoff'); END IF;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.mvp_tournament_entries WHERE tournament_id=p_event AND participant_id=p_team)
  THEN RETURN jsonb_build_object('ok',false,'error','not_in_event'); END IF;
 SELECT * INTO conn FROM public.mvp_repo_connections WHERE event_id=p_event AND team_id=p_team;
 IF NOT FOUND OR NOT conn.approved THEN RETURN jsonb_build_object('ok',false,'error','repo_not_approved'); END IF;
 IF conn.repo_id<>p_repo_id OR conn.repository<>p_repository OR conn.branch<>p_branch
  THEN RETURN jsonb_build_object('ok',false,'error','repository_changed'); END IF;

 SELECT * INTO r FROM public.mvp_github_receipts
  WHERE event_id=p_event AND team_id=p_team AND repo_id=p_repo_id
   AND commit_sha=p_commit_sha AND file_path=p_file_path;
 IF FOUND THEN
  SELECT * INTO j FROM public.mvp_repo_sync_jobs WHERE id=r.job_id;
  RETURN jsonb_build_object('ok',true,'created',false,'receipt',to_jsonb(r),'job',to_jsonb(j));
 END IF;

 SELECT count(DISTINCT commit_sha) INTO used FROM public.mvp_repo_sync_jobs
  WHERE event_id=p_event AND team_id=p_team AND created_at>clock_timestamp()-interval '24 hours';
 IF used>=COALESCE(p_daily_quota,10) THEN RETURN jsonb_build_object('ok',false,'error','quota_exceeded'); END IF;

 -- FIX: FK trỏ mvp_submissions(id) nên phải lấy submission_id, bỏ receipt chưa có submission.
 SELECT submission_id INTO previous FROM public.mvp_github_receipts
  WHERE event_id=p_event AND team_id=p_team AND status='valid' AND submission_id IS NOT NULL
  ORDER BY created_at DESC LIMIT 1;

 BEGIN
  INSERT INTO public.mvp_repo_sync_jobs(id,event_id,team_id,repo_id,repository,branch,file_path,commit_sha,status,requested_by)
  VALUES(new_job,p_event,p_team,p_repo_id,p_repository,p_branch,p_file_path,p_commit_sha,'queued',p_account);
  INSERT INTO public.mvp_github_receipts(id,job_id,event_id,team_id,repo_id,repository,branch,file_path,commit_sha,status,previous_valid_submission_id)
  VALUES(new_receipt,new_job,p_event,p_team,p_repo_id,p_repository,p_branch,p_file_path,p_commit_sha,'resolving',previous);
 EXCEPTION WHEN unique_violation THEN
  SELECT * INTO r FROM public.mvp_github_receipts
   WHERE event_id=p_event AND team_id=p_team AND repo_id=p_repo_id
    AND commit_sha=p_commit_sha AND file_path=p_file_path;
  SELECT * INTO j FROM public.mvp_repo_sync_jobs WHERE id=r.job_id;
  RETURN jsonb_build_object('ok',true,'created',false,'receipt',to_jsonb(r),'job',to_jsonb(j));
 END;

 SELECT * INTO r FROM public.mvp_github_receipts WHERE id=new_receipt;
 SELECT * INTO j FROM public.mvp_repo_sync_jobs WHERE id=new_job;
 RETURN jsonb_build_object('ok',true,'created',true,'receipt',to_jsonb(r),'job',to_jsonb(j));
END; $$;

-- Claim: job `queued` tới hạn hoặc lease đã hết; mỗi lần claim tăng attempt + generation.
CREATE FUNCTION public.mvp_github_claim(p_worker text, p_lease_seconds integer DEFAULT 120)
RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE j public.mvp_repo_sync_jobs; tok uuid := gen_random_uuid();
BEGIN
 IF p_worker IS NULL OR length(p_worker) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'bad_worker'; END IF;
 IF p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 10 AND 900 THEN RAISE EXCEPTION 'bad_lease'; END IF;
 SELECT * INTO j FROM public.mvp_repo_sync_jobs
  WHERE (status='queued' AND available_at<=clock_timestamp())
     OR (status IN ('leased','running') AND lease_until IS NOT NULL AND lease_until<clock_timestamp())
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
   'attempt',j.attempt,'max_attempts',3));
END; $$;

-- Gia hạn lease; sai token/generation hoặc lease đã mất => false (worker phải dừng ghi).
CREATE FUNCTION public.mvp_github_heartbeat(p_job uuid,p_token uuid,p_generation integer,p_lease_seconds integer DEFAULT 120)
RETURNS boolean LANGUAGE plpgsql SET search_path='' AS $$ BEGIN
 IF p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 10 AND 900 THEN RAISE EXCEPTION 'bad_lease'; END IF;
 UPDATE public.mvp_repo_sync_jobs SET lease_until=clock_timestamp()+make_interval(secs=>p_lease_seconds),
  updated_at=clock_timestamp()
  WHERE id=p_job AND lease_token=p_token AND generation=p_generation
   AND status IN ('leased','running') AND lease_until>clock_timestamp();
 RETURN FOUND;
END; $$;

-- Báo tiến độ (fetching/checking) cho UI; chỉ worker đang giữ lease mới ghi được.
CREATE FUNCTION public.mvp_github_progress(p_job uuid,p_token uuid,p_generation integer,p_status text,p_note text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SET search_path='' AS $$ BEGIN
 IF p_status NOT IN ('fetching','checking') THEN RAISE EXCEPTION 'bad_progress'; END IF;
 UPDATE public.mvp_repo_sync_jobs SET status='running', updated_at=clock_timestamp()
  WHERE id=p_job AND lease_token=p_token AND generation=p_generation
   AND status IN ('leased','running') AND lease_until>clock_timestamp();
 IF NOT FOUND THEN RETURN false; END IF;
 UPDATE public.mvp_github_receipts
  SET status=p_status, error=left(NULLIF(p_note,''),400), error_category=NULL, updated_at=clock_timestamp()
  WHERE job_id=p_job;
 RETURN true;
END; $$;

-- Kết thúc: ghi submission (nếu valid) + receipt + job trong CÙNG transaction.
-- Worker cũ (sai token/generation hoặc lease hết) nhận false và không được ghi gì.
CREATE FUNCTION public.mvp_github_finish(p_job uuid,p_token uuid,p_generation integer,p_outcome jsonb)
RETURNS boolean LANGUAGE plpgsql SET search_path='' AS $$
DECLARE j public.mvp_repo_sync_jobs; v_rid uuid; v_sub uuid; v_status text;
  v_hash text; v_note text; v_category text;
BEGIN
 IF p_outcome IS NULL OR jsonb_typeof(p_outcome)<>'object' THEN RAISE EXCEPTION 'bad_outcome'; END IF;
 v_status := p_outcome->>'status';
 IF v_status NOT IN ('valid','invalid','infrastructure') THEN RAISE EXCEPTION 'bad_outcome'; END IF;
 UPDATE public.mvp_repo_sync_jobs SET status='running', updated_at=clock_timestamp()
  WHERE id=p_job AND lease_token=p_token AND generation=p_generation
   AND status IN ('leased','running') AND lease_until>clock_timestamp()
  RETURNING * INTO j;
 IF NOT FOUND THEN RETURN false; END IF;
 SELECT id INTO v_rid FROM public.mvp_github_receipts WHERE job_id=p_job;
 IF v_rid IS NULL THEN RETURN false; END IF;

 v_hash := NULLIF(p_outcome->>'source_hash','');
 v_note := left(NULLIF(p_outcome->>'error',''),400);
 IF p_outcome->>'error_category' IN ('code','infrastructure','repo') THEN v_category := p_outcome->>'error_category'; END IF;

 IF v_status='valid' THEN
  IF v_hash IS NULL OR v_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'bad_outcome'; END IF;
  v_sub := NULLIF(p_outcome->>'submission_id','')::uuid;
  IF v_sub IS NULL AND jsonb_typeof(p_outcome->'submission')='object' THEN
   IF (p_outcome->'submission'->>'storage_path') !~ '^[0-9a-f-]{36}\.py$'
    OR (p_outcome->'submission'->>'sha256') !~ '^[0-9a-f]{64}$'
    OR (p_outcome->'submission'->>'sha256') <> v_hash THEN RAISE EXCEPTION 'bad_submission'; END IF;
   INSERT INTO public.mvp_submissions(id,participant_id,storage_path,sha256,status,validation_error,created_at)
   VALUES(gen_random_uuid(), j.team_id, p_outcome->'submission'->>'storage_path',
     p_outcome->'submission'->>'sha256','valid',NULL,clock_timestamp())
   RETURNING id INTO v_sub;
  END IF;
  IF v_sub IS NULL THEN RAISE EXCEPTION 'missing_submission'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.mvp_submissions WHERE id=v_sub AND participant_id=j.team_id)
   THEN RAISE EXCEPTION 'bad_submission'; END IF;
  UPDATE public.mvp_github_receipts SET status='valid', source_hash=v_hash, error=NULL, error_category=NULL,
   submission_id=v_sub, updated_at=clock_timestamp() WHERE job_id=p_job;
  UPDATE public.mvp_repo_sync_jobs SET status='completed', error=NULL, error_category=NULL,
   lease_token=NULL, lease_until=NULL, updated_at=clock_timestamp() WHERE id=p_job;
  RETURN true;
 END IF;

 UPDATE public.mvp_github_receipts SET status=v_status, source_hash=v_hash,
  error=COALESCE(v_note, CASE WHEN v_status='invalid' THEN 'bot không vượt qua kiểm tra'
                              ELSE 'lỗi hạ tầng khi tải/kiểm bot' END),
  error_category=COALESCE(v_category, CASE WHEN v_status='invalid' THEN 'code' ELSE 'infrastructure' END),
  updated_at=clock_timestamp() WHERE job_id=p_job;
 UPDATE public.mvp_repo_sync_jobs SET
  status=CASE WHEN v_status='invalid' THEN 'bot_fault' ELSE 'infra_fault' END,
  error=v_note,
  error_category=COALESCE(v_category, CASE WHEN v_status='invalid' THEN 'code' ELSE 'infrastructure' END),
  lease_token=NULL, lease_until=NULL, updated_at=clock_timestamp() WHERE id=p_job;
 RETURN true;
END; $$;

-- Retry hạ tầng: trả job về `queued` với backoff (15s × attempt, tối đa 300s);
-- vượt `p_max_attempts` thì `infra_fault`. Receipt hiện `infrastructure` nhưng bản valid cũ vẫn giữ.
CREATE FUNCTION public.mvp_github_release(p_job uuid,p_token uuid,p_generation integer,p_error text DEFAULT NULL,p_max_attempts integer DEFAULT 3)
RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE j public.mvp_repo_sync_jobs; v_max integer := LEAST(GREATEST(COALESCE(p_max_attempts,3),1),10);
  v_note text := left(NULLIF(p_error,''),400);
BEGIN
 UPDATE public.mvp_repo_sync_jobs SET
  status=CASE WHEN attempt>=v_max THEN 'infra_fault' ELSE 'queued' END,
  available_at=CASE WHEN attempt>=v_max THEN available_at
                    ELSE clock_timestamp()+make_interval(secs=>LEAST(300, 15*GREATEST(attempt,1))) END,
  error=v_note, error_category='infrastructure', lease_token=NULL, lease_until=NULL, updated_at=clock_timestamp()
  WHERE id=p_job AND lease_token=p_token AND generation=p_generation AND status IN ('leased','running')
  RETURNING * INTO j;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'reason','lease_lost'); END IF;
 UPDATE public.mvp_github_receipts SET status='infrastructure', error=v_note, error_category='infrastructure',
  updated_at=clock_timestamp() WHERE job_id=p_job;
 RETURN jsonb_build_object('ok',true,'status',j.status,'attempt',j.attempt,'available_at',j.available_at);
END; $$;

REVOKE ALL ON FUNCTION public.mvp_github_intake(uuid,uuid,uuid,text,text,text,bigint,text,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.mvp_github_claim(text,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.mvp_github_heartbeat(uuid,uuid,integer,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.mvp_github_progress(uuid,uuid,integer,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.mvp_github_finish(uuid,uuid,integer,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.mvp_github_release(uuid,uuid,integer,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mvp_github_intake(uuid,uuid,uuid,text,text,text,bigint,text,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.mvp_github_claim(text,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.mvp_github_heartbeat(uuid,uuid,integer,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.mvp_github_progress(uuid,uuid,integer,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.mvp_github_finish(uuid,uuid,integer,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.mvp_github_release(uuid,uuid,integer,text,integer) TO service_role;
NOTIFY pgrst,'reload schema';



