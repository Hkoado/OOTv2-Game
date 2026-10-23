-- Xem trực tiếp (L1 công khai / L2 nội bộ) trên DB chung thay cho SQLite.
-- Chỉ service_role đọc/ghi; API là cửa duy nhất ra ngoài và tự gate quyền.
CREATE TABLE public.mvp_match_events (
  match_id uuid NOT NULL REFERENCES public.mvp_matches(id) ON DELETE CASCADE,
  seq integer NOT NULL CHECK(seq>=0),
  kind text NOT NULL CHECK(kind IN ('initial','move','terminal')),
  payload_json text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY(match_id,seq)
);
CREATE TABLE public.mvp_match_bot_output (
  id bigserial PRIMARY KEY,
  match_id uuid NOT NULL REFERENCES public.mvp_matches(id) ON DELETE CASCADE,
  side text NOT NULL CHECK(side IN ('red','blue')),
  stream text NOT NULL CHECK(stream IN ('stdout','stderr')),
  line text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX mvp_match_bot_output_tail ON public.mvp_match_bot_output(match_id,side,id);
CREATE TABLE public.mvp_worker_state (
  worker_id text PRIMARY KEY,
  heartbeat_at timestamptz NOT NULL,
  match_id uuid REFERENCES public.mvp_matches(id) ON DELETE SET NULL
);
CREATE INDEX mvp_worker_state_beat ON public.mvp_worker_state(heartbeat_at DESC);

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['mvp_match_events','mvp_match_bot_output','mvp_worker_state'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON public.%I TO service_role',t);
 END LOOP;
END; $$;
-- bigserial cần sequence riêng: cấp quyền dùng sequence cho service_role.
GRANT USAGE,SELECT ON SEQUENCE public.mvp_match_bot_output_id_seq TO service_role;
