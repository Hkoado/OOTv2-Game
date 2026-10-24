-- Additive official SETUP only. Existing MVP records/results remain untouched.
-- Do not apply remotely without operator approval. Runtime must not start this profile yet.
CREATE TABLE public.mvp_official_setups (
 tournament_id uuid PRIMARY KEY REFERENCES public.mvp_tournaments(id),
 config jsonb NOT NULL CHECK (config->>'schemaVersion' = 'campus-setup.v1'),
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.mvp_official_setups ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mvp_official_setups FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.mvp_official_setups TO service_role;

ALTER TABLE public.mvp_tournament_entries DROP CONSTRAINT mvp_tournament_entries_seed_order_check;
ALTER TABLE public.mvp_tournament_entries ADD CONSTRAINT mvp_tournament_entries_seed_order_check CHECK(seed_order BETWEEN 1 AND 56);

CREATE FUNCTION public.mvp_official_draft_save(p_event jsonb,p_entries jsonb,p_config jsonb,p_expected integer DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE v public.mvp_tournaments; item jsonb; eid uuid := (p_event->>'id')::uuid;
BEGIN
 IF p_config->>'schemaVersion' IS DISTINCT FROM 'campus-setup.v1'
 OR p_config->>'level' NOT IN ('weekly','monthly','semester')
 OR jsonb_typeof(p_entries) IS DISTINCT FROM 'array'
 OR jsonb_array_length(p_entries)>56 THEN RAISE EXCEPTION 'bad_official_setup'; END IF;
 IF p_expected IS NULL THEN
  INSERT INTO public.mvp_tournaments(id,name,status,seed,created_at,map_json)
  VALUES(eid,p_event->>'name','draft',(p_event->>'seed')::bigint,(p_event->>'created_at')::timestamptz,p_event->>'map_json');
 ELSE
  SELECT * INTO v FROM public.mvp_tournaments WHERE id=eid FOR UPDATE;
  IF NOT FOUND OR v.status<>'draft' OR v.version<>p_expected
   OR NOT EXISTS(SELECT 1 FROM public.mvp_official_setups WHERE tournament_id=eid)
   THEN RAISE EXCEPTION 'event_conflict' USING ERRCODE='40001'; END IF;
  DELETE FROM public.mvp_tournament_entries WHERE tournament_id=eid;
  UPDATE public.mvp_tournaments SET map_json=p_event->>'map_json',version=version+1 WHERE id=eid;
 END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_entries) LOOP
  INSERT INTO public.mvp_tournament_entries(id,tournament_id,participant_id,seed_order)
  VALUES((item->>'id')::uuid,eid,(item->>'participant_id')::uuid,(item->>'seed_order')::integer);
 END LOOP;
 INSERT INTO public.mvp_official_setups(tournament_id,config) VALUES(eid,p_config)
 ON CONFLICT(tournament_id) DO UPDATE SET config=EXCLUDED.config,updated_at=clock_timestamp();
END; $$;
REVOKE ALL ON FUNCTION public.mvp_official_draft_save(jsonb,jsonb,jsonb,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mvp_official_draft_save(jsonb,jsonb,jsonb,integer) TO service_role;

-- Defense in depth: even a direct service RPC cannot feed an official setup to MVP.
CREATE FUNCTION public.mvp_official_setup_guard() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.mvp_official_setups WHERE tournament_id=NEW.id)
  AND NEW.status IS DISTINCT FROM OLD.status THEN RAISE EXCEPTION 'official_scheduler_not_ready'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER official_setup_no_mvp_start BEFORE UPDATE OF status ON public.mvp_tournaments
FOR EACH ROW EXECUTE FUNCTION public.mvp_official_setup_guard();
REVOKE ALL ON FUNCTION public.mvp_official_setup_guard() FROM PUBLIC,anon,authenticated;
NOTIFY pgrst,'reload schema';