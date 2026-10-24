-- Publication locks only map content/pack, not roster or other draft settings.
-- Apply by operator after review; never run remotely from the coding agent.
CREATE FUNCTION public.mvp_lock_published_maps() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF OLD.config->>'mapsPublished' = 'true' AND (
    NEW.config->>'mapsPublished' IS DISTINCT FROM 'true'
    OR NEW.config->'primaryMap' IS DISTINCT FROM OLD.config->'primaryMap'
    OR NEW.config->'reserveMap' IS DISTINCT FROM OLD.config->'reserveMap'
    OR NEW.config->'mapPackVersion' IS DISTINCT FROM OLD.config->'mapPackVersion'
 ) THEN RAISE EXCEPTION 'map_pack_locked'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER lock_published_maps BEFORE UPDATE ON public.mvp_official_setups
FOR EACH ROW EXECUTE FUNCTION public.mvp_lock_published_maps();
REVOKE ALL ON FUNCTION public.mvp_lock_published_maps() FROM PUBLIC,anon,authenticated;