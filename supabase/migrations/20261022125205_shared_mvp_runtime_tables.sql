-- Versioned legacy profile: preserve the existing MVP API/rules without coercing
-- historical records into Campus rounds/matches. All runtime data is shared.
CREATE TABLE public.mvp_participants (
 id uuid PRIMARY KEY, name text NOT NULL, name_key text NOT NULL UNIQUE, created_at timestamptz NOT NULL
);
CREATE TABLE public.mvp_submissions (
 id uuid PRIMARY KEY, participant_id uuid NOT NULL REFERENCES public.mvp_participants(id),
 storage_path text NOT NULL, sha256 text NOT NULL CHECK(sha256 ~ '^[0-9a-f]{64}$'),
 status text NOT NULL CHECK(status IN ('uploaded','valid','invalid')), validation_error text,
 created_at timestamptz NOT NULL
);
CREATE INDEX mvp_submissions_team ON public.mvp_submissions(participant_id,created_at DESC,id);
CREATE TABLE public.mvp_tournaments (
 id uuid PRIMARY KEY, name text NOT NULL,
 status text NOT NULL CHECK(status IN ('draft','group_running','semifinal_running','final_running','finished')),
 seed bigint NOT NULL CHECK(seed BETWEEN 0 AND 4294967295), created_at timestamptz NOT NULL,
 started_at timestamptz, finished_at timestamptz, map_json text, version integer NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX mvp_one_running ON public.mvp_tournaments((true)) WHERE status IN ('group_running','semifinal_running','final_running');
CREATE TABLE public.mvp_tournament_entries (
 id uuid PRIMARY KEY, tournament_id uuid NOT NULL REFERENCES public.mvp_tournaments(id),
 participant_id uuid NOT NULL REFERENCES public.mvp_participants(id), submission_id uuid REFERENCES public.mvp_submissions(id),
 seed_order integer NOT NULL CHECK(seed_order BETWEEN 1 AND 8), group_name text CHECK(group_name IN ('A','B')),
 UNIQUE(tournament_id,participant_id), UNIQUE(tournament_id,seed_order), UNIQUE(id,tournament_id)
);
CREATE TABLE public.mvp_matches (
 id uuid PRIMARY KEY, tournament_id uuid NOT NULL REFERENCES public.mvp_tournaments(id),
 stage text NOT NULL CHECK(stage IN ('group','semifinal','final')), series_id text NOT NULL,
 game_no integer NOT NULL CHECK(game_no IN (1,2)), red_entry_id uuid NOT NULL, blue_entry_id uuid NOT NULL,
 seed bigint NOT NULL CHECK(seed BETWEEN 0 AND 4294967295),
 status text NOT NULL CHECK(status IN ('pending','running','finished')), result text CHECK(result IN ('red_win','blue_win','draw')),
 reason text, ply_count integer CHECK(ply_count>=0), replay_json text, started_at timestamptz, finished_at timestamptz,
 worker_id text, lease_token uuid, lease_until timestamptz, available_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(red_entry_id,tournament_id) REFERENCES public.mvp_tournament_entries(id,tournament_id),
 FOREIGN KEY(blue_entry_id,tournament_id) REFERENCES public.mvp_tournament_entries(id,tournament_id),
 CHECK(red_entry_id<>blue_entry_id), CHECK((status='finished')=(result IS NOT NULL)),
 UNIQUE(tournament_id,stage,series_id,game_no)
);
CREATE INDEX mvp_matches_queue ON public.mvp_matches(status,available_at,lease_until);
CREATE INDEX mvp_matches_event ON public.mvp_matches(tournament_id,stage,status);
CREATE TABLE public.mvp_accounts (
 id uuid PRIMARY KEY, username text NOT NULL UNIQUE, password_hash text NOT NULL,
 role text NOT NULL CHECK(role IN ('admin','team')), participant_id uuid UNIQUE REFERENCES public.mvp_participants(id),
 members text NOT NULL DEFAULT '', contact text NOT NULL DEFAULT '', repository text NOT NULL DEFAULT '',
 branch text NOT NULL DEFAULT 'main', created_at timestamptz NOT NULL,
 CHECK((role='admin' AND participant_id IS NULL) OR (role='team' AND participant_id IS NOT NULL))
);
CREATE TABLE public.mvp_sessions (
 token_hash text PRIMARY KEY, account_id uuid NOT NULL REFERENCES public.mvp_accounts(id),
 csrf text NOT NULL, expires_at bigint NOT NULL
);
CREATE INDEX mvp_sessions_expiry ON public.mvp_sessions(expires_at);
CREATE TABLE public.mvp_attempts (
 token uuid PRIMARY KEY, match_id uuid NOT NULL REFERENCES public.mvp_matches(id), worker_id text NOT NULL,
 status text NOT NULL CHECK(status IN ('running','expired','released','accepted')),
 started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz, error_code text
);
CREATE TABLE public.mvp_imports (fingerprint text PRIMARY KEY, imported_at timestamptz NOT NULL DEFAULT now(), counts jsonb NOT NULL);

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['mvp_participants','mvp_submissions','mvp_tournaments','mvp_tournament_entries','mvp_matches','mvp_accounts','mvp_sessions','mvp_attempts','mvp_imports'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);
 EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON public.%I TO service_role',t);
 END LOOP;
END; $$;

