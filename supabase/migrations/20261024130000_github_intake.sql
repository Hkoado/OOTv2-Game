-- GitHub intake (H1): repo approval + sync job + receipt. Additive, private by default.
-- API chỉ resolve metadata/SHA và ghi job/receipt; KHÔNG clone, KHÔNG tải source, KHÔNG chạy Python.
-- Do NOT apply remotely without operator approval.

CREATE TABLE public.mvp_repo_connections (
  id uuid PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES public.mvp_tournaments(id),
  team_id uuid NOT NULL REFERENCES public.mvp_participants(id),
  repo_id bigint NOT NULL CHECK(repo_id > 0),
  repository text NOT NULL CHECK(repository ~ '^https://github\.com/[A-Za-z0-9-]+/[A-Za-z0-9_.-]+$'),
  branch text NOT NULL CHECK(length(branch) BETWEEN 1 AND 120),
  file_path text NOT NULL DEFAULT 'bot.py' CHECK(file_path = 'bot.py'),
  approved boolean NOT NULL DEFAULT false,
  approved_by text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(event_id, team_id),
  UNIQUE(event_id, repo_id)
);

CREATE TABLE public.mvp_repo_sync_jobs (
  id uuid PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES public.mvp_tournaments(id),
  team_id uuid NOT NULL REFERENCES public.mvp_participants(id),
  repo_id bigint NOT NULL CHECK(repo_id > 0),
  repository text NOT NULL,
  branch text NOT NULL,
  file_path text NOT NULL DEFAULT 'bot.py' CHECK(file_path = 'bot.py'),
  commit_sha text NOT NULL CHECK(commit_sha ~ '^[0-9a-f]{40}$'),
  status text NOT NULL DEFAULT 'queued'
    CHECK(status IN ('queued','leased','running','completed','bot_fault','infra_fault','canceled')),
  attempt integer NOT NULL DEFAULT 0 CHECK(attempt >= 0),
  lease_token uuid,
  lease_until timestamptz,
  available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  error text,
  error_category text CHECK(error_category IS NULL OR error_category IN ('code','infrastructure','repo')),
  requested_by uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(event_id, team_id, repo_id, commit_sha, file_path)
);

CREATE TABLE public.mvp_github_receipts (
  id uuid PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES public.mvp_repo_sync_jobs(id),
  event_id uuid NOT NULL REFERENCES public.mvp_tournaments(id),
  team_id uuid NOT NULL REFERENCES public.mvp_participants(id),
  repo_id bigint NOT NULL CHECK(repo_id > 0),
  repository text NOT NULL,
  branch text NOT NULL,
  file_path text NOT NULL DEFAULT 'bot.py' CHECK(file_path = 'bot.py'),
  commit_sha text NOT NULL CHECK(commit_sha ~ '^[0-9a-f]{40}$'),
  status text NOT NULL
    CHECK(status IN ('resolving','fetching','checking','valid','invalid','infrastructure','frozen')),
  source_hash text CHECK(source_hash IS NULL OR source_hash ~ '^[0-9a-f]{64}$'),
  error text,
  error_category text CHECK(error_category IS NULL OR error_category IN ('code','infrastructure','repo')),
  submission_id uuid REFERENCES public.mvp_submissions(id),
  previous_valid_submission_id uuid REFERENCES public.mvp_submissions(id),
  resolved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(event_id, team_id, repo_id, commit_sha, file_path)
);

CREATE INDEX mvp_repo_sync_jobs_queue ON public.mvp_repo_sync_jobs(status, available_at);
CREATE INDEX mvp_github_receipts_latest ON public.mvp_github_receipts(event_id, team_id, created_at DESC);

ALTER TABLE public.mvp_repo_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mvp_repo_sync_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mvp_github_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mvp_repo_connections FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.mvp_repo_sync_jobs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.mvp_github_receipts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.mvp_repo_connections TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.mvp_repo_sync_jobs TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.mvp_github_receipts TO service_role;

-- Đăng ký/duyệt repo: chỉ admin set approved=true; đổi repo/branch phải duyệt lại.
CREATE FUNCTION public.mvp_repo_connection_upsert(
  p_event uuid, p_team uuid, p_repository text, p_repo_id bigint,
  p_branch text, p_file_path text, p_approved boolean, p_actor uuid
) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE v public.mvp_tournaments; c public.mvp_repo_connections;
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
  IF c.repo_id<>p_repo_id OR c.repository<>p_repository OR c.branch<>p_branch THEN
   UPDATE public.mvp_repo_connections SET repo_id=p_repo_id,repository=p_repository,branch=p_branch,
    approved=p_approved,approved_by=CASE WHEN p_approved THEN p_actor::text ELSE NULL END,
    updated_at=clock_timestamp() WHERE id=c.id RETURNING * INTO c;
  ELSE
   UPDATE public.mvp_repo_connections SET approved=(c.approved OR p_approved),
    approved_by=CASE WHEN p_approved THEN p_actor::text ELSE approved_by END,
    updated_at=clock_timestamp() WHERE id=c.id RETURNING * INTO c;
  END IF;
 ELSE
  INSERT INTO public.mvp_repo_connections(id,event_id,team_id,repo_id,repository,branch,file_path,approved,approved_by)
  VALUES(gen_random_uuid(),p_event,p_team,p_repo_id,p_repository,p_branch,p_file_path,p_approved,
   CASE WHEN p_approved THEN p_actor::text ELSE NULL END) RETURNING * INTO c;
 END IF;
 RETURN jsonb_build_object('ok',true,'connection',to_jsonb(c));
END; $$;

-- Intake: idempotency theo (event,team,repo,sha,path), cutoff/freeze/quota bằng clock DB.
CREATE FUNCTION public.mvp_github_intake(
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

 -- Chỉ lấy submission của receipt hợp lệ (FK trỏ mvp_submissions(id), KHÔNG phải receipt id).
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

REVOKE ALL ON FUNCTION public.mvp_repo_connection_upsert(uuid,uuid,text,bigint,text,text,boolean,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.mvp_github_intake(uuid,uuid,uuid,text,text,text,bigint,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mvp_repo_connection_upsert(uuid,uuid,text,bigint,text,text,boolean,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.mvp_github_intake(uuid,uuid,uuid,text,text,text,bigint,text,integer) TO service_role;
NOTIFY pgrst,'reload schema';


