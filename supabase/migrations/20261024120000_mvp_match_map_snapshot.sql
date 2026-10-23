-- Additive: snapshot map theo từng ván cho runtime MVP dùng chung (Supabase).
-- Mỗi ván giữ map đã chốt lúc lên lịch; worker đối chiếu `map_hash` trước khi chạy bot.
-- Cột để NULL cho dữ liệu cũ (worker dùng map hiện tại của giải).
-- Do NOT apply remotely without operator approval.

ALTER TABLE public.mvp_matches ADD COLUMN IF NOT EXISTS map_json text;
ALTER TABLE public.mvp_matches ADD COLUMN IF NOT EXISTS map_hash text;

COMMENT ON COLUMN public.mvp_matches.map_json IS 'MapV1 đã chuẩn hoá, chốt khi sinh trận; NULL với ván trước migration.';
COMMENT ON COLUMN public.mvp_matches.map_hash IS 'Hash canonical (bỏ id/revision) dùng đối chiếu setup/move/replay.';

CREATE OR REPLACE FUNCTION public.mvp_stage_commit(p_id uuid,p_expected text,p_next text,p_games jsonb,p_snapshots jsonb DEFAULT '[]') RETURNS boolean
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
 -- Snapshot map là bắt buộc với ván mới; thiếu hoặc hash sai định dạng thì không tạo trận.
 IF jsonb_typeof(item->'map_json') IS DISTINCT FROM 'string'
  OR jsonb_typeof(item->'map_hash') IS DISTINCT FROM 'string'
  OR item->>'map_hash' !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'bad_game_map'; END IF;
 INSERT INTO public.mvp_matches(id,tournament_id,stage,series_id,game_no,red_entry_id,blue_entry_id,seed,status,map_json,map_hash)
 VALUES((item->>'id')::uuid,p_id,item->>'stage',item->>'series_id',(item->>'game_no')::integer,(item->>'red_entry_id')::uuid,(item->>'blue_entry_id')::uuid,(item->>'seed')::bigint,'pending',item->>'map_json',item->>'map_hash');
 END LOOP;
 UPDATE public.mvp_tournaments SET status=p_next,version=version+1,
 started_at=CASE WHEN p_expected='draft' THEN clock_timestamp() ELSE started_at END,
 finished_at=CASE WHEN p_next='finished' THEN clock_timestamp() ELSE finished_at END WHERE id=p_id;
 RETURN true;
END; $$;

REVOKE ALL ON FUNCTION public.mvp_stage_commit(uuid,text,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mvp_stage_commit(uuid,text,text,jsonb,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
