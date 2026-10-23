-- K2 official schedule persistence (snapshot + pinned next game + accepted result).
-- Additive, service-role only, NOT applied remotely. Rollback is documented in docs/OFFICIAL-SCHEDULE.md.
-- The official scheduler gate stays closed: no trigger change, no Start/API/UI change here.

create table if not exists mvp_official_rounds (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references mvp_tournaments(id) on delete restrict,
  round_id text not null check (round_id ~ '^[A-Za-z0-9:_-]{1,80}$'),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  snapshot_hash text not null check (snapshot_hash ~ '^[a-f0-9]{64}$'),
  genesis_hash text not null check (genesis_hash ~ '^[a-f0-9]{64}$'),
  chain_hash text not null check (chain_hash ~ '^[a-f0-9]{64}$'),
  game_count integer not null default 0 check (game_count between 0 and 100000),
  frozen boolean not null default false,
  created_at timestamptz not null default clock_timestamp(),
  unique (event_id, round_id),
  check (snapshot->>'schemaVersion' = 'campus-round-snapshot.v1'),
  check (snapshot->>'contentHash' = snapshot_hash),
  check (coalesce(snapshot->>'eventId', '') = event_id::text),
  check (coalesce(snapshot->>'roundId', '') = round_id)
);

create table if not exists mvp_official_games (
  id uuid primary key default gen_random_uuid(),
  round_pk uuid not null references mvp_official_rounds(id) on delete restrict,
  seq integer not null check (seq between 1 and 100000),
  game_key text not null check (game_key ~ '^[A-Za-z0-9:_-]{1,120}$'),
  stage text not null check (stage ~ '^[A-Za-z0-9:_-]{1,40}$'),
  group_name text check (group_name is null or group_name ~ '^[A-Za-z0-9_-]{1,40}$'),
  game_no integer check (game_no is null or game_no between 1 and 2),
  red_participant_id uuid not null,
  blue_participant_id uuid not null,
  seed bigint not null check (seed between 0 and 4294967295),
  map_slot text not null check (map_slot in ('primary', 'reserve')),
  map_hash text not null check (map_hash ~ '^[a-f0-9]{64}$'),
  map_pack_version text not null check (length(map_pack_version) between 1 and 80),
  color_policy text not null default 'alternate-loss-priority.v1'
    check (color_policy = 'alternate-loss-priority.v1'),
  chain_hash text not null check (chain_hash ~ '^[a-f0-9]{64}$'),
  result text check (result in ('red_win', 'blue_win', 'draw')),
  replay_hash text check (replay_hash ~ '^[a-f0-9]{64}$'),
  recorded_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  unique (round_pk, seq),
  unique (round_pk, game_key),
  check (red_participant_id <> blue_participant_id),
  check ((result is null and replay_hash is null and recorded_at is null)
    or (result is not null and replay_hash is not null and recorded_at is not null))
);

alter table mvp_official_rounds enable row level security;
alter table mvp_official_games enable row level security;
revoke all on mvp_official_rounds, mvp_official_games from public, anon, authenticated;
grant select, insert, update on mvp_official_rounds, mvp_official_games to service_role;

create or replace function mvp_official_open_round(p_event uuid, p_round text, p_snapshot jsonb, p_genesis text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_status text;
begin
  if p_event is null or p_round is null or p_round !~ '^[A-Za-z0-9:_-]{1,80}$'
    or p_genesis is null or p_genesis !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('ok', false, 'error', 'bad_input');
  end if;
  if p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object'
    or p_snapshot->>'schemaVersion' <> 'campus-round-snapshot.v1'
    or coalesce(p_snapshot->>'contentHash', '') !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('ok', false, 'error', 'invalid_snapshot');
  end if;
  if coalesce(p_snapshot->>'eventId', '') <> p_event::text
    or coalesce(p_snapshot->>'roundId', '') <> p_round then
    return jsonb_build_object('ok', false, 'error', 'snapshot_identity_mismatch');
  end if;
  select status into v_status from mvp_tournaments where id = p_event;
  if not found then return jsonb_build_object('ok', false, 'error', 'event_not_found'); end if;
  if v_status is null or v_status in ('finished', 'canceled', 'archived') then
    return jsonb_build_object('ok', false, 'error', 'event_closed');
  end if;
  insert into mvp_official_rounds(event_id, round_id, snapshot, snapshot_hash, genesis_hash, chain_hash)
  values (p_event, p_round, p_snapshot, p_snapshot->>'contentHash', p_genesis, p_genesis)
  on conflict (event_id, round_id) do nothing
  returning id into v_id;
  if v_id is null then return jsonb_build_object('ok', false, 'error', 'round_exists'); end if;
  return jsonb_build_object('ok', true, 'round_id', v_id, 'genesis_hash', p_genesis);
end $$;

create or replace function mvp_official_append_game(p_round uuid, p_expected_prefix text, p_game jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r mvp_official_rounds%rowtype; v_red uuid; v_blue uuid; v_seed bigint; v_map text; v_hash text;
begin
  if p_round is null or coalesce(p_expected_prefix, '') !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('ok', false, 'error', 'bad_input');
  end if;
  select * into r from mvp_official_rounds where id = p_round for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'round_not_found'); end if;
  if r.frozen then return jsonb_build_object('ok', false, 'error', 'round_frozen'); end if;
  if r.chain_hash <> p_expected_prefix then return jsonb_build_object('ok', false, 'error', 'stale_prefix'); end if;
  if p_game is null or jsonb_typeof(p_game) <> 'object'
    or p_game->>'seq' is distinct from (r.game_count + 1)::text then
    return jsonb_build_object('ok', false, 'error', 'bad_sequence');
  end if;
  if coalesce(p_game->>'gameKey', '') !~ '^[A-Za-z0-9:_-]{1,120}$'
    or coalesce(p_game->>'stage', '') !~ '^[A-Za-z0-9:_-]{1,40}$'
    or p_game->>'colorPolicy' is distinct from 'alternate-loss-priority.v1'
    or coalesce(p_game->>'chainHash', '') !~ '^[a-f0-9]{64}$'
    or coalesce(p_game->>'mapPackVersion', '') !~ '^.{1,80}$' then
    return jsonb_build_object('ok', false, 'error', 'bad_input');
  end if;
  if p_game ? 'gameNo' and (p_game->>'gameNo') !~ '^[12]$' then
    return jsonb_build_object('ok', false, 'error', 'bad_input');
  end if;
  if p_game ? 'groupName' and (p_game->>'groupName') !~ '^[A-Za-z0-9_-]{1,40}$' then
    return jsonb_build_object('ok', false, 'error', 'bad_input');
  end if;
  begin
    v_red := (p_game->>'redParticipantId')::uuid;
    v_blue := (p_game->>'blueParticipantId')::uuid;
    v_seed := (p_game->>'seed')::bigint;
  exception when others then
    return jsonb_build_object('ok', false, 'error', 'bad_input');
  end;
  if v_red = v_blue or v_seed < 0 or v_seed > 4294967295 then
    return jsonb_build_object('ok', false, 'error', 'bad_input');
  end if;
  v_map := p_game->>'mapSlot';
  if v_map = 'primary' then v_hash := r.snapshot->'maps'->'primary'->>'hash';
  elsif v_map = 'reserve' then v_hash := r.snapshot->'maps'->'reserve'->>'hash';
  else return jsonb_build_object('ok', false, 'error', 'bad_input'); end if;
  if p_game->>'mapHash' is distinct from v_hash
    or p_game->>'mapPackVersion' is distinct from r.snapshot->>'mapPackVersion' then
    return jsonb_build_object('ok', false, 'error', 'map_mismatch');
  end if;
  begin
    insert into mvp_official_games(round_pk, seq, game_key, stage, group_name, game_no,
      red_participant_id, blue_participant_id, seed, map_slot, map_hash, map_pack_version,
      color_policy, chain_hash)
    values (r.id, r.game_count + 1, p_game->>'gameKey', p_game->>'stage',
      nullif(p_game->>'groupName', ''), nullif(p_game->>'gameNo', '')::integer, v_red, v_blue,
      v_seed, v_map, p_game->>'mapHash', p_game->>'mapPackVersion',
      p_game->>'colorPolicy', p_game->>'chainHash');
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'duplicate_game');
  end;
  update mvp_official_rounds set game_count = r.game_count + 1, chain_hash = p_game->>'chainHash'
  where id = r.id;
  return jsonb_build_object('ok', true, 'seq', r.game_count + 1, 'chain_hash', p_game->>'chainHash');
end $$;

create or replace function mvp_official_record_result(p_round uuid, p_game_key text, p_result text, p_replay_hash text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare g mvp_official_games%rowtype;
begin
  if p_round is null or coalesce(p_game_key, '') = '' or p_result not in ('red_win', 'blue_win', 'draw')
    or coalesce(p_replay_hash, '') !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('ok', false, 'error', 'bad_input');
  end if;
  select * into g from mvp_official_games where round_pk = p_round and game_key = p_game_key for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'game_not_found'); end if;
  if g.result is null then
    update mvp_official_games set result = p_result, replay_hash = p_replay_hash,
      recorded_at = clock_timestamp() where id = g.id;
    return jsonb_build_object('ok', true, 'already_recorded', false, 'result', p_result);
  end if;
  if g.result = p_result and g.replay_hash = p_replay_hash then
    return jsonb_build_object('ok', true, 'already_recorded', true, 'result', g.result);
  end if;
  return jsonb_build_object('ok', false, 'error', 'result_conflict');
end $$;

create or replace function mvp_official_freeze_round(p_round uuid, p_expected_games integer)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare r mvp_official_rounds%rowtype;
begin
  if p_round is null or p_expected_games is null or p_expected_games < 1 then
    return jsonb_build_object('ok', false, 'error', 'bad_input');
  end if;
  select * into r from mvp_official_rounds where id = p_round for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'round_not_found'); end if;
  if r.frozen then return jsonb_build_object('ok', true, 'already_frozen', true); end if;
  if r.game_count <> p_expected_games then
    return jsonb_build_object('ok', false, 'error', 'incomplete_schedule');
  end if;
  if exists (select 1 from mvp_official_games where round_pk = r.id and result is null) then
    return jsonb_build_object('ok', false, 'error', 'pending_results');
  end if;
  update mvp_official_rounds set frozen = true where id = r.id;
  return jsonb_build_object('ok', true, 'already_frozen', false, 'game_count', r.game_count);
end $$;

revoke all on function mvp_official_open_round(uuid, text, jsonb, text) from public, anon, authenticated;
revoke all on function mvp_official_append_game(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function mvp_official_record_result(uuid, text, text, text) from public, anon, authenticated;
revoke all on function mvp_official_freeze_round(uuid, integer) from public, anon, authenticated;
grant execute on function mvp_official_open_round(uuid, text, jsonb, text) to service_role;
grant execute on function mvp_official_append_game(uuid, text, jsonb) to service_role;
grant execute on function mvp_official_record_result(uuid, text, text, text) to service_role;
grant execute on function mvp_official_freeze_round(uuid, integer) to service_role;

-- Rollback only before real data exists:
--   drop function mvp_official_freeze_round(uuid, integer);
--   drop function mvp_official_record_result(uuid, text, text, text);
--   drop function mvp_official_append_game(uuid, text, jsonb);
--   drop function mvp_official_open_round(uuid, text, jsonb, text);
--   drop table mvp_official_games, mvp_official_rounds;


