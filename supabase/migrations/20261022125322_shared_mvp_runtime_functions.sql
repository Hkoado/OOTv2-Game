CREATE FUNCTION public.mvp_account_create(p_account jsonb,p_participant jsonb DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SET search_path='' AS $$ BEGIN
 IF p_participant IS NOT NULL THEN
 INSERT INTO public.mvp_participants SELECT * FROM jsonb_populate_record(NULL::public.mvp_participants,p_participant);
 END IF;
 INSERT INTO public.mvp_accounts SELECT * FROM jsonb_populate_record(NULL::public.mvp_accounts,p_account);
END; $$;
CREATE FUNCTION public.mvp_password_reset(p_id uuid,p_hash text) RETURNS boolean
LANGUAGE plpgsql SET search_path='' AS $$ BEGIN
 UPDATE public.mvp_accounts SET password_hash=p_hash WHERE id=p_id;
 IF NOT FOUND THEN RETURN false; END IF;
 DELETE FROM public.mvp_sessions WHERE account_id=p_id;
 RETURN true;
END; $$;

CREATE FUNCTION public.mvp_draft_save(p_event jsonb,p_entries jsonb,p_expected integer DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE v public.mvp_tournaments; item jsonb; eid uuid := (p_event->>'id')::uuid;
BEGIN
 IF p_expected IS NULL THEN
 INSERT INTO public.mvp_tournaments(id,name,status,seed,created_at,map_json)
 VALUES(eid,p_event->>'name','draft',(p_event->>'seed')::bigint,(p_event->>'created_at')::timestamptz,p_event->>'map_json');
 ELSE
 SELECT * INTO v FROM public.mvp_tournaments WHERE id=eid FOR UPDATE;
 IF NOT FOUND OR v.status<>'draft' OR v.version<>p_expected THEN RAISE EXCEPTION 'event_conflict' USING ERRCODE='40001'; END IF;
 DELETE FROM public.mvp_tournament_entries WHERE tournament_id=eid;
 UPDATE public.mvp_tournaments SET map_json=p_event->>'map_json',version=version+1 WHERE id=eid;
 END IF;
 IF jsonb_array_length(p_entries)>8 THEN RAISE EXCEPTION 'too_many_entries'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_entries) LOOP
 INSERT INTO public.mvp_tournament_entries(id,tournament_id,participant_id,seed_order)
 VALUES((item->>'id')::uuid,eid,(item->>'participant_id')::uuid,(item->>'seed_order')::integer);
 END LOOP;
END; $$;

CREATE FUNCTION public.mvp_stage_commit(p_id uuid,p_expected text,p_next text,p_games jsonb,p_snapshots jsonb DEFAULT '[]') RETURNS boolean
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE v public.mvp_tournaments; item jsonb; oldstage text; expected_count integer;
BEGIN
 SELECT * INTO v FROM public.mvp_tournaments WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR v.status<>p_expected THEN RETURN false; END IF;
 IF NOT ((p_expected='draft' AND p_next='group_running') OR (p_expected='group_running' AND p_next='semifinal_running') OR
 (p_expected='semifinal_running' AND p_next='final_running') OR (p_expected='final_running' AND p_next='finished')) THEN RAISE EXCEPTION 'bad_stage'; END IF;
 IF p_expected='draft' THEN
 IF (SELECT count(*) FROM public.mvp_tournament_entries WHERE tournament_id=p_id)<>8 THEN RAISE EXCEPTION 'need_eight_entries'; END IF;
 IF jsonb_array_length(p_snapshots)<>8 THEN RAISE EXCEPTION 'need_eight_snapshots'; END IF;
 IF EXISTS(SELECT 1 FROM public.mvp_tournaments WHERE id<>p_id AND status IN ('group_running','semifinal_running','final_running')) THEN RAISE EXCEPTION 'tournament_running' USING ERRCODE='23505'; END IF;
 IF jsonb_array_length(COALESCE(v.map_json::jsonb->'blocked','[]'::jsonb))>0 THEN RAISE EXCEPTION 'map_runner_unavailable'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_snapshots) LOOP
 UPDATE public.mvp_tournament_entries e SET submission_id=(item->>'submission_id')::uuid,group_name=item->>'group_name'
 WHERE e.id=(item->>'id')::uuid AND e.tournament_id=p_id AND EXISTS(
 SELECT 1 FROM public.mvp_submissions s WHERE s.id=(item->>'submission_id')::uuid AND s.participant_id=e.participant_id AND s.status='valid');
 IF NOT FOUND THEN RAISE EXCEPTION 'bad_snapshot'; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM public.mvp_tournament_entries WHERE tournament_id=p_id AND (submission_id IS NULL OR group_name IS NULL)) THEN RAISE EXCEPTION 'bad_snapshot'; END IF;
 expected_count:=24;
 ELSE
 oldstage:=CASE p_expected WHEN 'group_running' THEN 'group' WHEN 'semifinal_running' THEN 'semifinal' ELSE 'final' END;
 expected_count:=CASE oldstage WHEN 'group' THEN 24 WHEN 'semifinal' THEN 4 ELSE 2 END;
 IF (SELECT count(*) FROM public.mvp_matches WHERE tournament_id=p_id AND stage=oldstage AND status='finished')<>expected_count THEN RETURN false; END IF;
 expected_count:=CASE p_next WHEN 'semifinal_running' THEN 4 WHEN 'final_running' THEN 2 ELSE 0 END;
 END IF;
 IF jsonb_array_length(p_games)<>expected_count THEN RAISE EXCEPTION 'bad_game_count'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_games) LOOP
 IF item->>'stage'<>(CASE p_next WHEN 'group_running' THEN 'group' WHEN 'semifinal_running' THEN 'semifinal' ELSE 'final' END) THEN RAISE EXCEPTION 'bad_game_stage'; END IF;
 INSERT INTO public.mvp_matches(id,tournament_id,stage,series_id,game_no,red_entry_id,blue_entry_id,seed,status)
 VALUES((item->>'id')::uuid,p_id,item->>'stage',item->>'series_id',(item->>'game_no')::integer,(item->>'red_entry_id')::uuid,(item->>'blue_entry_id')::uuid,(item->>'seed')::bigint,'pending');
 END LOOP;
 UPDATE public.mvp_tournaments SET status=p_next,version=version+1,
 started_at=CASE WHEN p_expected='draft' THEN clock_timestamp() ELSE started_at END,
 finished_at=CASE WHEN p_next='finished' THEN clock_timestamp() ELSE finished_at END WHERE id=p_id;
 RETURN true;
END; $$;

CREATE FUNCTION public.mvp_claim(p_worker text) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE m public.mvp_matches; tok uuid := gen_random_uuid();
BEGIN
 IF length(p_worker) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'bad_worker'; END IF;
 SELECT g.* INTO m FROM public.mvp_matches g JOIN public.mvp_tournaments t ON t.id=g.tournament_id
 WHERE g.stage=CASE t.status WHEN 'group_running' THEN 'group' WHEN 'semifinal_running' THEN 'semifinal' WHEN 'final_running' THEN 'final' ELSE '' END
 AND ((g.status='pending' AND g.available_at<=clock_timestamp()) OR (g.status='running' AND g.lease_until<clock_timestamp()))
 ORDER BY g.available_at,g.series_id,g.game_no FOR UPDATE OF g SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF m.lease_token IS NOT NULL THEN UPDATE public.mvp_attempts SET status='expired',finished_at=clock_timestamp() WHERE token=m.lease_token AND status='running'; END IF;
 UPDATE public.mvp_matches SET status='running',worker_id=p_worker,lease_token=tok,
 lease_until=clock_timestamp()+interval '60 seconds',started_at=clock_timestamp() WHERE id=m.id RETURNING * INTO m;
 INSERT INTO public.mvp_attempts(token,match_id,worker_id,status) VALUES(tok,m.id,p_worker,'running');
 RETURN to_jsonb(m);
END; $$;
CREATE FUNCTION public.mvp_heartbeat(p_id uuid,p_token uuid) RETURNS boolean LANGUAGE plpgsql SET search_path='' AS $$ BEGIN
 UPDATE public.mvp_matches SET lease_until=clock_timestamp()+interval '60 seconds'
 WHERE id=p_id AND status='running' AND lease_token=p_token AND lease_until>clock_timestamp();
 RETURN FOUND;
END; $$;
CREATE FUNCTION public.mvp_finish(p_id uuid,p_token uuid,p_outcome jsonb) RETURNS boolean LANGUAGE plpgsql SET search_path='' AS $$ BEGIN
 IF p_outcome->>'result' NOT IN ('red_win','blue_win','draw') OR p_outcome->>'reason' IS NULL OR p_outcome->>'reason'='internal_error' OR jsonb_typeof(p_outcome->'replay')<>'object' THEN RAISE EXCEPTION 'bad_outcome'; END IF;
 UPDATE public.mvp_matches SET status='finished',result=p_outcome->>'result',reason=p_outcome->>'reason',
 ply_count=(p_outcome->>'ply_count')::integer,replay_json=(p_outcome->'replay')::text,finished_at=clock_timestamp(),lease_until=NULL
 WHERE id=p_id AND status='running' AND lease_token=p_token AND lease_until>clock_timestamp();
 IF NOT FOUND THEN RETURN false; END IF;
 UPDATE public.mvp_attempts SET status='accepted',finished_at=clock_timestamp() WHERE token=p_token;
 RETURN true;
END; $$;
CREATE FUNCTION public.mvp_release(p_id uuid,p_token uuid,p_error text) RETURNS boolean LANGUAGE plpgsql SET search_path='' AS $$ BEGIN
 UPDATE public.mvp_matches SET status='pending',lease_token=NULL,lease_until=NULL,worker_id=NULL,
 available_at=clock_timestamp()+interval '30 seconds' WHERE id=p_id AND status='running' AND lease_token=p_token AND lease_until>clock_timestamp();
 IF NOT FOUND THEN RETURN false; END IF;
 UPDATE public.mvp_attempts SET status='released',finished_at=clock_timestamp(),error_code=left(p_error,80) WHERE token=p_token;
 RETURN true;
END; $$;

CREATE FUNCTION public.mvp_import(p_fingerprint text,p_bundle jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE counts jsonb; t text;
BEGIN
 PERFORM pg_advisory_xact_lock(728032244);
 SELECT i.counts INTO counts FROM public.mvp_imports i WHERE fingerprint=p_fingerprint;
 IF FOUND THEN RETURN counts; END IF;
 IF EXISTS(SELECT 1 FROM public.mvp_participants) OR EXISTS(SELECT 1 FROM public.mvp_tournaments) OR EXISTS(SELECT 1 FROM public.mvp_accounts) THEN RAISE EXCEPTION 'target_not_empty'; END IF;
 INSERT INTO public.mvp_participants SELECT * FROM jsonb_populate_recordset(NULL::public.mvp_participants,p_bundle->'participants');
 INSERT INTO public.mvp_submissions SELECT * FROM jsonb_populate_recordset(NULL::public.mvp_submissions,p_bundle->'submissions');
 INSERT INTO public.mvp_tournaments SELECT * FROM jsonb_populate_recordset(NULL::public.mvp_tournaments,p_bundle->'tournaments');
 INSERT INTO public.mvp_tournament_entries SELECT * FROM jsonb_populate_recordset(NULL::public.mvp_tournament_entries,p_bundle->'tournament_entries');
 INSERT INTO public.mvp_accounts SELECT * FROM jsonb_populate_recordset(NULL::public.mvp_accounts,p_bundle->'accounts');
 -- Sessions intentionally not imported. Unfinished jobs resume with fresh leases.
 FOR t IN SELECT value->>'id' FROM jsonb_array_elements(p_bundle->'matches') WHERE value->>'status'='running' LOOP
 p_bundle:=jsonb_set(p_bundle,'{matches}',(SELECT jsonb_agg(CASE WHEN value->>'id'=t THEN value || '{"status":"pending","started_at":null}'::jsonb ELSE value END) FROM jsonb_array_elements(p_bundle->'matches')));
 END LOOP;
 INSERT INTO public.mvp_matches(id,tournament_id,stage,series_id,game_no,red_entry_id,blue_entry_id,seed,status,result,reason,ply_count,replay_json,started_at,finished_at)
 SELECT id,tournament_id,stage,series_id,game_no,red_entry_id,blue_entry_id,seed,status,result,reason,ply_count,replay_json,started_at,finished_at FROM jsonb_populate_recordset(NULL::public.mvp_matches,p_bundle->'matches');
 counts:=jsonb_build_object('participants',jsonb_array_length(p_bundle->'participants'),'accounts',jsonb_array_length(p_bundle->'accounts'),'tournaments',jsonb_array_length(p_bundle->'tournaments'),'submissions',jsonb_array_length(p_bundle->'submissions'),'entries',jsonb_array_length(p_bundle->'tournament_entries'),'matches',jsonb_array_length(p_bundle->'matches'));
 INSERT INTO public.mvp_imports(fingerprint,counts) VALUES(p_fingerprint,counts);
 RETURN counts;
END; $$;

DO $$ DECLARE fn regprocedure; BEGIN
 FOR fn IN SELECT oid::regprocedure FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'mvp\_%' ESCAPE '\' LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',fn);
 EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',fn);
 END LOOP;
END; $$;
NOTIFY pgrst,'reload schema';