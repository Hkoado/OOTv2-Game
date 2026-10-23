-- GitHub intake/job contract — smoke test PostgreSQL (disposable project ONLY).
-- Chạy: psql "$OOTV2_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/github_intake.sql
-- Toàn bộ nằm trong transaction và ROLLBACK; không seed dữ liệu thật, không in token.
-- Bao phủ: hai worker claim, stale token/generation, duplicate finish, crash/retry, cutoff, revoke repo.
BEGIN;

DO $$ BEGIN
 IF to_regclass('public.mvp_repo_sync_jobs') IS NULL OR to_regclass('public.mvp_github_receipts') IS NULL
  THEN RAISE EXCEPTION 'missing migration 20261024130000/160000/170000'; END IF;
END $$;

INSERT INTO public.mvp_participants(id,name,name_key,created_at)
VALUES ('00000000-0000-4000-8000-00000000a001','PG Đội A','pg đội a',now()),
       ('00000000-0000-4000-8000-00000000a002','PG Đội B','pg đội b',now());
INSERT INTO public.mvp_tournaments(id,name,status,seed,created_at)
VALUES ('00000000-0000-4000-8000-00000000b001','PG Event','draft',7,now()),
       ('00000000-0000-4000-8000-00000000b002','PG Event cutoff','draft',8,now());
INSERT INTO public.mvp_tournament_entries(id,tournament_id,participant_id,seed_order)
VALUES ('00000000-0000-4000-8000-00000000c001','00000000-0000-4000-8000-00000000b001','00000000-0000-4000-8000-00000000a001',1),
       ('00000000-0000-4000-8000-00000000c002','00000000-0000-4000-8000-00000000b001','00000000-0000-4000-8000-00000000a002',2),
       ('00000000-0000-4000-8000-00000000c003','00000000-0000-4000-8000-00000000b002','00000000-0000-4000-8000-00000000a001',1);

-- 1) Đăng ký + duyệt repo, intake tạo job/receipt, hai worker claim.
DO $$
DECLARE res jsonb; jid uuid; tok uuid; gen integer;
BEGIN
 res := public.mvp_repo_connection_upsert('00000000-0000-4000-8000-00000000b001','00000000-0000-4000-8000-00000000a001',
   'https://github.com/team-a/bot', 111, 'main','bot.py', true, '00000000-0000-4000-8000-00000000d001');
 IF (res->>'ok')::boolean IS NOT TRUE OR (res->'connection'->>'approved')::boolean IS NOT TRUE
  THEN RAISE EXCEPTION 'connection approve failed: %', res; END IF;

 res := public.mvp_github_intake('00000000-0000-4000-8000-00000000b001','00000000-0000-4000-8000-00000000a001',NULL,
   'https://github.com/team-a/bot','main','bot.py',111, repeat('a',40), 10);
 IF (res->>'ok')::boolean IS NOT TRUE OR (res->>'created')::boolean IS NOT TRUE
  THEN RAISE EXCEPTION 'intake failed: %', res; END IF;
 IF res->'receipt'->>'status' <> 'resolving' THEN RAISE EXCEPTION 'receipt status must be resolving'; END IF;

 -- Cùng SHA: idempotent, không tạo job thứ hai.
 res := public.mvp_github_intake('00000000-0000-4000-8000-00000000b001','00000000-0000-4000-8000-00000000a001',NULL,
   'https://github.com/team-a/bot','main','bot.py',111, repeat('a',40), 10);
 IF (res->>'created')::boolean IS NOT FALSE THEN RAISE EXCEPTION 'same SHA must not create new job'; END IF;

 res := public.mvp_github_claim('pg-worker-1', 60, 3);
 IF res IS NULL THEN RAISE EXCEPTION 'worker1 must claim'; END IF;
 jid := (res->'job'->>'id')::uuid; tok := (res->'lease'->>'token')::uuid; gen := (res->'lease'->>'generation')::int;
 IF public.mvp_github_claim('pg-worker-2', 60, 3) IS NOT NULL THEN RAISE EXCEPTION 'worker2 must not double-claim'; END IF;

 IF (public.mvp_github_finish(jid, tok, gen + 5,
      jsonb_build_object('status','invalid','error','stale'))->>'error') <> 'lease_lost'
  THEN RAISE EXCEPTION 'stale generation must be lease_lost'; END IF;
 IF (public.mvp_github_finish(jid, gen_random_uuid(), gen,
      jsonb_build_object('status','invalid','error','stale'))->>'error') <> 'lease_lost'
  THEN RAISE EXCEPTION 'wrong token must be lease_lost'; END IF;

 IF public.mvp_github_progress(jid, tok, gen, 'fetching', 'tải bot.py') IS NOT TRUE THEN RAISE EXCEPTION 'progress failed'; END IF;
END $$;

-- 2) Finish valid + duplicate finish + release sau khi xong.
DO $$
DECLARE res jsonb; jid uuid; tok uuid; gen integer;
BEGIN
 SELECT j.id, j.lease_token, j.generation INTO jid, tok, gen
  FROM public.mvp_repo_sync_jobs j
  WHERE j.event_id='00000000-0000-4000-8000-00000000b001' ORDER BY j.created_at DESC LIMIT 1;

 res := public.mvp_github_finish(jid, tok, gen, jsonb_build_object(
   'status','valid','source_hash',repeat('b',64),
   'submission', jsonb_build_object('storage_path','00000000-0000-4000-8000-00000000e001.py','sha256',repeat('b',64))));
 IF (res->>'applied')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'finish must apply: %', res; END IF;
 IF res->'receipt'->>'status' <> 'valid' OR res->'job'->>'status' <> 'completed'
  THEN RAISE EXCEPTION 'finish must set valid/completed: %', res; END IF;
 IF (SELECT count(*) FROM public.mvp_submissions WHERE id=(res->'receipt'->>'submission_id')::uuid
      AND participant_id='00000000-0000-4000-8000-00000000a001' AND sha256=repeat('b',64)) <> 1
  THEN RAISE EXCEPTION 'submission not created correctly'; END IF;

 -- Duplicate finish (mất response): already_finished, KHÔNG tạo submission lần 2.
 res := public.mvp_github_finish(jid, tok, gen, jsonb_build_object(
   'status','valid','source_hash',repeat('b',64),
   'submission', jsonb_build_object('storage_path','00000000-0000-4000-8000-00000000e002.py','sha256',repeat('b',64))));
 IF (res->>'already_finished')::boolean IS NOT TRUE OR (res->>'applied')::boolean IS NOT FALSE
  THEN RAISE EXCEPTION 'duplicate finish must be idempotent: %', res; END IF;
 IF (SELECT count(*) FROM public.mvp_submissions WHERE participant_id='00000000-0000-4000-8000-00000000a001') <> 1
  THEN RAISE EXCEPTION 'duplicate finish must not create submission'; END IF;

 IF (public.mvp_github_release(jid, tok, gen, 'x', 3)->>'error') <> 'lease_lost'
  THEN RAISE EXCEPTION 'release on finished job must be lease_lost'; END IF;
END $$;

-- 3) Submission có sẵn phải đúng đội/valid/hash; release requeue rồi lease cũ bị từ chối.
DO $$
DECLARE res jsonb; jid uuid; tok uuid; gen integer; sub uuid;
BEGIN
 SELECT (j.id)::uuid INTO jid FROM public.mvp_repo_sync_jobs j
  WHERE j.event_id='00000000-0000-4000-8000-00000000b001' AND j.status='queued' LIMIT 1;
 IF jid IS NULL THEN
  res := public.mvp_github_intake('00000000-0000-4000-8000-00000000b001','00000000-0000-4000-8000-00000000a001',NULL,
    'https://github.com/team-a/bot','main','bot.py',111, repeat('c',40), 10);
  res := public.mvp_github_claim('pg-worker-1', 60, 3);
  jid := (res->'job'->>'id')::uuid; tok := (res->'lease'->>'token')::uuid; gen := (res->'lease'->>'generation')::int;
 ELSE
  res := public.mvp_github_claim('pg-worker-1', 60, 3);
  jid := (res->'job'->>'id')::uuid; tok := (res->'lease'->>'token')::uuid; gen := (res->'lease'->>'generation')::int;
 END IF;

 SELECT id INTO sub FROM public.mvp_submissions LIMIT 1;
 IF (public.mvp_github_finish(jid, tok, gen, jsonb_build_object(
      'status','valid','source_hash',repeat('d',64),'submission_id', sub))->>'error') <> 'bad_submission'
  THEN RAISE EXCEPTION 'mismatched submission must be bad_submission'; END IF;

 IF public.mvp_github_progress(jid, tok, gen, 'checking', NULL) IS NOT TRUE THEN RAISE EXCEPTION 'progress failed'; END IF;
 res := public.mvp_github_release(jid, tok, gen, 'github timeout', 3);
 IF (res->>'ok')::boolean IS NOT TRUE OR res->>'status' <> 'queued'
  THEN RAISE EXCEPTION 'release must requeue: %', res; END IF;
 IF (public.mvp_github_release(jid, tok, gen, 'again', 3)->>'error') <> 'lease_lost'
  THEN RAISE EXCEPTION 'release with old lease must be lease_lost'; END IF;
END $$;



-- 4) Worker crash: lease hết hạn + attempt chạm max => infra_fault, không phát lại.
DO $$
DECLARE res jsonb; jid uuid;
BEGIN
 res := public.mvp_github_intake('00000000-0000-4000-8000-00000000b001','00000000-0000-4000-8000-00000000a001',NULL,
   'https://github.com/team-a/bot','main','bot.py',111, repeat('e',40), 10);
 IF (res->>'ok')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'intake for crash test failed: %', res; END IF;
 res := public.mvp_github_claim('pg-worker-crash', 30, 3);
 jid := (res->'job'->>'id')::uuid;
 UPDATE public.mvp_repo_sync_jobs SET lease_until=clock_timestamp()-interval '1 minute',
   attempt=3, status='running' WHERE id=jid;
 IF public.mvp_github_claim('pg-worker-2', 30, 3) IS NOT NULL
  THEN RAISE EXCEPTION 'exhausted job must not be reclaimed'; END IF;
 IF (SELECT status FROM public.mvp_repo_sync_jobs WHERE id=jid) <> 'infra_fault'
  THEN RAISE EXCEPTION 'exhausted job must be infra_fault'; END IF;
 IF (SELECT status FROM public.mvp_github_receipts WHERE job_id=jid) <> 'infrastructure'
  THEN RAISE EXCEPTION 'receipt of crashed job must be infrastructure'; END IF;
END $$;

-- 5) Cutoff dùng clock DB: cutoff đã qua => past_cutoff.
INSERT INTO public.mvp_official_setups(tournament_id, config)
VALUES ('00000000-0000-4000-8000-00000000b002',
        jsonb_build_object('schemaVersion','campus-setup.v1','cutoff','2020-01-01T00:00:00Z'));
DO $$
DECLARE res jsonb;
BEGIN
 res := public.mvp_repo_connection_upsert('00000000-0000-4000-8000-00000000b002','00000000-0000-4000-8000-00000000a001',
   'https://github.com/team-a/bot', 222,'main','bot.py', true, '00000000-0000-4000-8000-00000000d001');
 IF (res->>'ok')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'approve cutoff event failed: %', res; END IF;
 res := public.mvp_github_intake('00000000-0000-4000-8000-00000000b002','00000000-0000-4000-8000-00000000a001',NULL,
   'https://github.com/team-a/bot','main','bot.py',222, repeat('f',40), 10);
 IF res->>'error' <> 'past_cutoff' THEN RAISE EXCEPTION 'intake must be past_cutoff: %', res; END IF;
END $$;

-- 6) Revoke repo: approved=false, job chờ canceled, receipt chưa kết thúc frozen; receipt valid giữ nguyên.
DO $$
DECLARE res jsonb; jid uuid;
BEGIN
 res := public.mvp_github_intake('00000000-0000-4000-8000-00000000b001','00000000-0000-4000-8000-00000000a001',NULL,
   'https://github.com/team-a/bot','main','bot.py',111, repeat('1',40), 10);
 jid := (res->'job'->>'id')::uuid;
 res := public.mvp_repo_connection_revoke('00000000-0000-4000-8000-00000000b001','00000000-0000-4000-8000-00000000a001',
   '00000000-0000-4000-8000-00000000d001');
 IF (res->>'ok')::boolean IS NOT TRUE OR (res->'connection'->>'approved')::boolean IS NOT FALSE
  THEN RAISE EXCEPTION 'revoke failed: %', res; END IF;
 IF (res->>'canceled_jobs')::int < 1 THEN RAISE EXCEPTION 'revoke must cancel queued job'; END IF;
 IF (SELECT status FROM public.mvp_repo_sync_jobs WHERE id=jid) <> 'canceled'
  THEN RAISE EXCEPTION 'pending job must be canceled'; END IF;
 IF (SELECT status FROM public.mvp_github_receipts WHERE job_id=jid) <> 'frozen'
  THEN RAISE EXCEPTION 'pending receipt must be frozen'; END IF;
 IF (SELECT count(*) FROM public.mvp_github_receipts WHERE status='valid') < 1
  THEN RAISE EXCEPTION 'valid receipt must stay valid'; END IF;
END $$;

\echo 'github_intake.sql: PASS — transaction sẽ ROLLBACK'
ROLLBACK;
