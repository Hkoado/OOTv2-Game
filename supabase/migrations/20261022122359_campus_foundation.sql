-- Campus foundation v1. Additive; does not migrate or replace the local SQLite DB.
-- Remote migration version: 20261022122359 (Management API assigned).
-- Apply once through migration history. Deliberately fail on conflicting objects.
CREATE TABLE public.players (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_code text NOT NULL UNIQUE CHECK (student_code = btrim(student_code) AND length(student_code) BETWEEN 1 AND 50),
  display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 100),
  email text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
  github_repo text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','inactive')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX teams_name_key ON public.teams (lower(btrim(name)));
CREATE TABLE public.team_members (
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE RESTRICT,
  player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE RESTRICT,
  period_month date NOT NULL CHECK (extract(day FROM period_month) = 1),
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('captain','member')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, player_id, period_month),
  UNIQUE (player_id, period_month)
);
CREATE UNIQUE INDEX team_members_one_captain ON public.team_members(team_id, period_month) WHERE role = 'captain';
CREATE TABLE public.tournaments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  level text NOT NULL CHECK (level IN ('weekly','monthly','semester')),
  period_month date NOT NULL CHECK (extract(day FROM period_month) = 1),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','registration','running','finished','cancelled')),
  rules_version text NOT NULL DEFAULT 'ott-campus.v1',
  seed bigint NOT NULL CHECK (seed BETWEEN 0 AND 4294967295),
  registration_deadline timestamptz,
  starts_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (registration_deadline IS NULL OR starts_at IS NULL OR registration_deadline <= starts_at),
  CHECK (finished_at IS NULL OR starts_at IS NULL OR finished_at >= starts_at)
);
CREATE TABLE public.tournament_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL REFERENCES public.tournaments(id) ON DELETE RESTRICT,
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','withdrawn','disqualified')),
  seed_order integer CHECK (seed_order > 0),
  roster_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(roster_snapshot) = 'array'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tournament_id, team_id),
  UNIQUE (tournament_id, seed_order),
  UNIQUE (id, tournament_id, team_id)
);
CREATE TABLE public.submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE RESTRICT,
  source text NOT NULL CHECK (source IN ('github','upload','offline')),
  repository text,
  commit_sha text CHECK (commit_sha ~ '^[0-9a-f]{40}$'),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  byte_size integer NOT NULL CHECK (byte_size BETWEEN 1 AND 262144),
  artifact_key text,
  protocol_version text NOT NULL DEFAULT 'bot.v1',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','valid','invalid')),
  validation_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (source <> 'github' OR (repository IS NOT NULL AND commit_sha IS NOT NULL)),
  UNIQUE (id, team_id)
);
CREATE INDEX submissions_team_created ON public.submissions(team_id, created_at DESC);
CREATE TABLE public.rounds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL REFERENCES public.tournaments(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
  stage text NOT NULL CHECK (stage IN ('group','round_of_16','quarterfinal','semifinal','third_place','final')),
  round_order integer NOT NULL CHECK (round_order > 0),
  mode text NOT NULL CHECK (mode IN ('online','offline')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','frozen','running','finished','cancelled')),
  submission_deadline timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tournament_id, round_order),
  UNIQUE (id, tournament_id)
);
CREATE TABLE public.round_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id uuid NOT NULL,
  tournament_id uuid NOT NULL,
  entry_id uuid NOT NULL,
  team_id uuid NOT NULL,
  submission_id uuid,
  group_name text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ready','withdrawn','disqualified','no_submission')),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (round_id, tournament_id) REFERENCES public.rounds(id, tournament_id) ON DELETE RESTRICT,
  FOREIGN KEY (entry_id, tournament_id, team_id) REFERENCES public.tournament_entries(id, tournament_id, team_id) ON DELETE RESTRICT,
  FOREIGN KEY (submission_id, team_id) REFERENCES public.submissions(id, team_id) ON DELETE RESTRICT,
  CHECK (status <> 'ready' OR submission_id IS NOT NULL),
  UNIQUE (round_id, entry_id),
  UNIQUE (id, round_id)
);
CREATE INDEX round_entries_entry ON public.round_entries(entry_id);
CREATE INDEX round_entries_submission ON public.round_entries(submission_id, team_id);
CREATE TABLE public.maps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
  revision integer NOT NULL CHECK (revision > 0),
  schema_version text NOT NULL DEFAULT 'map.v1',
  definition jsonb NOT NULL CHECK (jsonb_typeof(definition) = 'object'),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (name, revision)
);
CREATE TABLE public.round_maps (
  round_id uuid NOT NULL REFERENCES public.rounds(id) ON DELETE RESTRICT,
  map_id uuid NOT NULL REFERENCES public.maps(id) ON DELETE RESTRICT,
  role text NOT NULL CHECK (role IN ('primary','backup')),
  map_order integer NOT NULL CHECK (map_order > 0),
  PRIMARY KEY (round_id, map_id),
  UNIQUE (round_id, map_order)
);
CREATE INDEX round_maps_map ON public.round_maps(map_id);
CREATE TABLE public.matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id uuid NOT NULL REFERENCES public.rounds(id) ON DELETE RESTRICT,
  match_no integer NOT NULL CHECK (match_no > 0),
  entry_a_id uuid NOT NULL,
  entry_b_id uuid,
  winner_entry_id uuid,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','finished','cancelled')),
  outcome text CHECK (outcome IN ('played','bye','walkover','double_disqualification','draw')),
  decision_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (entry_a_id, round_id) REFERENCES public.round_entries(id, round_id) ON DELETE RESTRICT,
  FOREIGN KEY (entry_b_id, round_id) REFERENCES public.round_entries(id, round_id) ON DELETE RESTRICT,
  CHECK (entry_b_id IS NULL OR entry_a_id <> entry_b_id),
  CHECK (winner_entry_id IS NULL OR winner_entry_id = entry_a_id OR (entry_b_id IS NOT NULL AND winner_entry_id = entry_b_id)),
  CHECK ((status = 'finished') = (outcome IS NOT NULL)),
  CHECK (outcome IS NULL OR
    (outcome = 'bye' AND entry_b_id IS NULL AND winner_entry_id IS NOT NULL AND winner_entry_id = entry_a_id) OR
    (outcome IN ('played','walkover') AND entry_b_id IS NOT NULL AND winner_entry_id IS NOT NULL) OR
    (outcome IN ('draw','double_disqualification') AND entry_b_id IS NOT NULL AND winner_entry_id IS NULL)),
  CHECK (status <> 'running' OR entry_b_id IS NOT NULL),
  CHECK (outcome IS NULL OR outcome NOT IN ('bye','walkover','double_disqualification') OR length(btrim(decision_reason)) > 0 AND decision_reason IS NOT NULL),
  UNIQUE (round_id, match_no),
  UNIQUE (id, round_id)
);
CREATE INDEX matches_a ON public.matches(entry_a_id, round_id);
CREATE INDEX matches_b ON public.matches(entry_b_id, round_id);
CREATE TABLE public.games (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL,
  round_id uuid NOT NULL,
  game_no integer NOT NULL CHECK (game_no > 0),
  red_entry_id uuid NOT NULL,
  blue_entry_id uuid NOT NULL,
  map_id uuid NOT NULL,
  seed bigint NOT NULL CHECK (seed BETWEEN 0 AND 4294967295),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','finished','void')),
  result text CHECK (result IN ('red_win','blue_win','draw')),
  reason text,
  ply_count integer CHECK (ply_count >= 0),
  replay_json jsonb CHECK (jsonb_typeof(replay_json) = 'object'),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (match_id, round_id) REFERENCES public.matches(id, round_id) ON DELETE RESTRICT,
  FOREIGN KEY (red_entry_id, round_id) REFERENCES public.round_entries(id, round_id) ON DELETE RESTRICT,
  FOREIGN KEY (blue_entry_id, round_id) REFERENCES public.round_entries(id, round_id) ON DELETE RESTRICT,
  FOREIGN KEY (round_id, map_id) REFERENCES public.round_maps(round_id, map_id) ON DELETE RESTRICT,
  CHECK (red_entry_id <> blue_entry_id),
  CHECK ((status = 'finished') = (result IS NOT NULL)),
  CHECK (status <> 'finished' OR (finished_at IS NOT NULL AND reason IS NOT NULL AND length(btrim(reason)) > 0)),
  CHECK (finished_at IS NULL OR started_at IS NULL OR finished_at >= started_at),
  UNIQUE (match_id, game_no)
);
CREATE INDEX games_queue ON public.games(status, created_at);
CREATE INDEX games_round ON public.games(round_id, status);
CREATE INDEX games_red ON public.games(red_entry_id, round_id);
CREATE INDEX games_blue ON public.games(blue_entry_id, round_id);
CREATE INDEX games_map ON public.games(round_id, map_id);
CREATE TABLE public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_ref text NOT NULL CHECK (length(btrim(actor_ref)) > 0),
  action text NOT NULL CHECK (length(btrim(action)) > 0),
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_entity ON public.audit_logs(entity_type, entity_id, created_at DESC);

-- Cross-table pair validation. Lock parent against concurrent participant changes.
CREATE FUNCTION public.campus_validate_game_pair() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE a uuid; b uuid;
BEGIN
  SELECT entry_a_id, entry_b_id INTO a, b FROM public.matches WHERE id = NEW.match_id FOR SHARE;
  IF NOT FOUND OR b IS NULL OR NOT (
    (NEW.red_entry_id = a AND NEW.blue_entry_id = b) OR
    (NEW.red_entry_id = b AND NEW.blue_entry_id = a)
  ) THEN
    RAISE EXCEPTION 'Game colors must match the two match participants' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER games_pair BEFORE INSERT OR UPDATE ON public.games
FOR EACH ROW EXECUTE FUNCTION public.campus_validate_game_pair();

-- Keep references stable once consumed; corrections require new version records.
CREATE FUNCTION public.campus_guard_references() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_TABLE_NAME = 'matches' THEN
    IF (NEW.round_id, NEW.entry_a_id, NEW.entry_b_id) IS DISTINCT FROM
       (OLD.round_id, OLD.entry_a_id, OLD.entry_b_id) AND
       EXISTS (SELECT 1 FROM public.games WHERE match_id = OLD.id) THEN
      RAISE EXCEPTION 'Cannot change participants after games exist' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'round_entries' THEN
    IF (NEW.submission_id, NEW.team_id, NEW.entry_id, NEW.round_id) IS DISTINCT FROM
       (OLD.submission_id, OLD.team_id, OLD.entry_id, OLD.round_id) AND
       EXISTS (SELECT 1 FROM public.matches WHERE entry_a_id = OLD.id OR entry_b_id = OLD.id) THEN
      RAISE EXCEPTION 'Cannot change entry snapshot after pairing' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'submissions' THEN
    IF NEW IS DISTINCT FROM OLD AND EXISTS (SELECT 1 FROM public.round_entries WHERE submission_id = OLD.id) THEN
      RAISE EXCEPTION 'Referenced submission is immutable; create a new version' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'maps' THEN
    IF NEW IS DISTINCT FROM OLD AND EXISTS (SELECT 1 FROM public.round_maps WHERE map_id = OLD.id) THEN
      RAISE EXCEPTION 'Referenced map is immutable; create a new revision' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER matches_guard BEFORE UPDATE ON public.matches FOR EACH ROW EXECUTE FUNCTION public.campus_guard_references();
CREATE TRIGGER round_entries_guard BEFORE UPDATE ON public.round_entries FOR EACH ROW EXECUTE FUNCTION public.campus_guard_references();
CREATE TRIGGER submissions_guard BEFORE UPDATE ON public.submissions FOR EACH ROW EXECUTE FUNCTION public.campus_guard_references();
CREATE TRIGGER maps_guard BEFORE UPDATE ON public.maps FOR EACH ROW EXECUTE FUNCTION public.campus_guard_references();

-- Deny-by-default: no browser policies until backend/auth integration is implemented.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['players','teams','team_members','tournaments','tournament_entries','submissions','rounds','round_entries','maps','round_maps','matches','games','audit_logs'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated, service_role', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO service_role', t);
  END LOOP;
END;
$$;
REVOKE UPDATE, DELETE ON public.audit_logs FROM service_role;
REVOKE ALL ON FUNCTION public.campus_validate_game_pair() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.campus_guard_references() FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE public.audit_logs IS 'Backend-written administrative decisions. Never store secrets/source. Append-only for service_role; not tamper-proof against DB owner.';
COMMENT ON TABLE public.tournament_entries IS 'roster_snapshot is captured and validated by the future registration service before approval.';
COMMENT ON TABLE public.games IS 'Each row is one scheduled game, not a retry attempt. Infrastructure retry ledger is a future milestone.';