-- H3: lịch phát riêng cho từng ván. Tách khỏi trạng thái chấm của mvp_matches.
-- hidden (không có row / canceled) -> scheduled -> broadcasting -> ended
-- Do NOT apply remotely without operator approval.

CREATE TABLE public.mvp_match_broadcasts (
  match_id uuid PRIMARY KEY REFERENCES public.mvp_matches(id),
  event_id uuid NOT NULL REFERENCES public.mvp_tournaments(id),
  state text NOT NULL DEFAULT 'scheduled' CHECK(state IN ('scheduled','canceled','ended')),
  starts_at timestamptz NOT NULL,
  ply_interval_ms integer NOT NULL DEFAULT 2000 CHECK(ply_interval_ms BETWEEN 250 AND 60000),
  release_mode text NOT NULL DEFAULT 'window' CHECK(release_mode IN ('window','full')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  canceled_at timestamptz
);
CREATE INDEX mvp_match_broadcasts_event ON public.mvp_match_broadcasts(event_id, starts_at);
CREATE INDEX mvp_match_broadcasts_state ON public.mvp_match_broadcasts(state, starts_at);

ALTER TABLE public.mvp_match_broadcasts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mvp_match_broadcasts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.mvp_match_broadcasts TO service_role;
