-- Run as postgres in Supabase SQL Editor. All fixtures are rolled back.
BEGIN;
DO $$
DECLARE
  p uuid; a uuid; b uuid; t uuid; t2 uuid; r uuid; r2 uuid;
  ea uuid; eb uuid; ra uuid; rb uuid; sa uuid; sb uuid; m uuid; g uuid; mp uuid;
  rejected integer := 0;
BEGIN
  INSERT INTO public.players(student_code, display_name) VALUES ('test-' || gen_random_uuid(), 'Test player') RETURNING id INTO p;
  INSERT INTO public.teams(name) VALUES ('Test A ' || gen_random_uuid()) RETURNING id INTO a;
  INSERT INTO public.teams(name) VALUES ('Test B ' || gen_random_uuid()) RETURNING id INTO b;
  INSERT INTO public.team_members(team_id, player_id, period_month, role) VALUES (a,p,'2026-10-01','captain');
  BEGIN
    INSERT INTO public.team_members(team_id, player_id, period_month) VALUES (b,p,'2026-10-01');
    RAISE EXCEPTION 'Duplicate membership accepted';
  EXCEPTION WHEN unique_violation THEN rejected := rejected + 1; END;
  INSERT INTO public.tournaments(name, level, period_month, seed) VALUES ('Test','weekly','2026-10-01',42) RETURNING id INTO t;
  INSERT INTO public.tournaments(name, level, period_month, seed) VALUES ('Other','weekly','2026-10-01',43) RETURNING id INTO t2;
  INSERT INTO public.tournament_entries(tournament_id,team_id) VALUES (t,a) RETURNING id INTO ea;
  INSERT INTO public.tournament_entries(tournament_id,team_id) VALUES (t,b) RETURNING id INTO eb;
  BEGIN
    INSERT INTO public.tournament_entries(tournament_id,team_id) VALUES (t,a);
    RAISE EXCEPTION 'Duplicate registration accepted';
  EXCEPTION WHEN unique_violation THEN rejected := rejected + 1; END;
  INSERT INTO public.submissions(team_id,source,sha256,byte_size,status) VALUES (a,'offline',repeat('a',64),100,'valid') RETURNING id INTO sa;
  INSERT INTO public.submissions(team_id,source,sha256,byte_size,status) VALUES (b,'offline',repeat('b',64),100,'valid') RETURNING id INTO sb;
  INSERT INTO public.rounds(tournament_id,name,stage,round_order,mode) VALUES (t,'Group','group',1,'online') RETURNING id INTO r;
  INSERT INTO public.rounds(tournament_id,name,stage,round_order,mode) VALUES (t2,'Other','group',1,'online') RETURNING id INTO r2;
  BEGIN
    INSERT INTO public.round_entries(round_id,tournament_id,entry_id,team_id,submission_id) VALUES (r,t,ea,a,sb);
    RAISE EXCEPTION 'Foreign team bot accepted';
  EXCEPTION WHEN foreign_key_violation THEN rejected := rejected + 1; END;
  BEGIN
    INSERT INTO public.round_entries(round_id,tournament_id,entry_id,team_id) VALUES (r2,t2,ea,a);
    RAISE EXCEPTION 'Foreign tournament entry accepted';
  EXCEPTION WHEN foreign_key_violation THEN rejected := rejected + 1; END;
  INSERT INTO public.round_entries(round_id,tournament_id,entry_id,team_id,submission_id,status) VALUES (r,t,ea,a,sa,'ready') RETURNING id INTO ra;
  INSERT INTO public.round_entries(round_id,tournament_id,entry_id,team_id,submission_id,status) VALUES (r,t,eb,b,sb,'ready') RETURNING id INTO rb;
  INSERT INTO public.maps(name,revision,definition,sha256) VALUES ('Test ' || gen_random_uuid(),1,'{}',repeat('c',64)) RETURNING id INTO mp;
  INSERT INTO public.round_maps(round_id,map_id,role,map_order) VALUES (r,mp,'primary',1);
  BEGIN
    INSERT INTO public.matches(round_id,match_no,entry_a_id,entry_b_id) VALUES (r,99,ra,ra);
    RAISE EXCEPTION 'Self match accepted';
  EXCEPTION WHEN check_violation THEN rejected := rejected + 1; END;
  INSERT INTO public.matches(round_id,match_no,entry_a_id,entry_b_id) VALUES (r,1,ra,rb) RETURNING id INTO m;
  INSERT INTO public.games(match_id,round_id,game_no,red_entry_id,blue_entry_id,map_id,seed) VALUES (m,r,1,ra,rb,mp,42) RETURNING id INTO g;
  INSERT INTO public.games(match_id,round_id,game_no,red_entry_id,blue_entry_id,map_id,seed) VALUES (m,r,2,rb,ra,mp,43);
  BEGIN
    INSERT INTO public.games(match_id,round_id,game_no,red_entry_id,blue_entry_id,map_id,seed) VALUES (m,r,3,ra,gen_random_uuid(),mp,44);
    RAISE EXCEPTION 'Foreign match participant accepted';
  EXCEPTION WHEN check_violation THEN rejected := rejected + 1; END;
  BEGIN
    UPDATE public.round_entries SET submission_id = NULL WHERE id = ra;
    RAISE EXCEPTION 'Snapshot mutation accepted';
  EXCEPTION WHEN check_violation THEN rejected := rejected + 1; END;
  BEGIN
    UPDATE public.maps SET definition = '{"changed":true}' WHERE id = mp;
    RAISE EXCEPTION 'Map mutation accepted';
  EXCEPTION WHEN check_violation THEN rejected := rejected + 1; END;
  BEGIN
    UPDATE public.submissions SET sha256 = repeat('d',64) WHERE id = sa;
    RAISE EXCEPTION 'Source mutation accepted';
  EXCEPTION WHEN check_violation THEN rejected := rejected + 1; END;
  BEGIN
    UPDATE public.games SET status = 'finished' WHERE id = g;
    RAISE EXCEPTION 'Missing result accepted';
  EXCEPTION WHEN check_violation THEN rejected := rejected + 1; END;
  BEGIN
    DELETE FROM public.teams WHERE id = a;
    RAISE EXCEPTION 'Historical team deleted';
  EXCEPTION WHEN foreign_key_violation THEN rejected := rejected + 1; END;
  UPDATE public.games SET status='finished',result='red_win',reason='base_capture',finished_at=now(),ply_count=10,replay_json='{"version":"test"}' WHERE id=g;
  UPDATE public.matches SET status='finished',outcome='played',winner_entry_id=ra WHERE id=m;
  INSERT INTO public.audit_logs(actor_ref,action,entity_type,entity_id,reason) VALUES ('test-admin','finalize','match',m,'Smoke test');
  IF rejected <> 11 THEN RAISE EXCEPTION 'Expected 11 rejected cases, got %', rejected; END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename IN ('players','teams','team_members','tournaments','tournament_entries','submissions','rounds','round_entries','maps','round_maps','matches','games','audit_logs') AND NOT rowsecurity) THEN
    RAISE EXCEPTION 'RLS missing';
  END IF;
  IF has_table_privilege('anon','public.players','SELECT') OR has_table_privilege('authenticated','public.games','SELECT') OR has_table_privilege('service_role','public.audit_logs','DELETE') THEN
    RAISE EXCEPTION 'Unexpected permissions';
  END IF;
END;
$$;
SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN
    PERFORM 1 FROM public.players;
    RAISE EXCEPTION 'Anonymous read succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END; $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN
    PERFORM 1 FROM public.games;
    RAISE EXCEPTION 'Authenticated read succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END; $$;
RESET ROLE;
ROLLBACK;
SELECT 'foundation smoke passed; fixtures rolled back' AS result;