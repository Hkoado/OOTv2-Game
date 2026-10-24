-- Huy: publication cho ván official (áp H3 "chấm trước — lưu kín — phát theo lịch").
-- Additive: không đổi bảng/kết quả official đã có, không đổi trigger cutoff.
-- Lịch phát chỉ đặt được cho ván đã có kết quả accepted; viewer chỉ nhận đúng số ply đã phát.

create table if not exists public.mvp_official_broadcasts (
  round_pk uuid not null references public.mvp_official_rounds(id) on delete restrict,
  game_key text not null check (game_key ~ '^[A-Za-z0-9:_-]{1,120}$'),
  event_id uuid not null references public.mvp_tournaments(id) on delete restrict,
  state text not null default 'scheduled' check (state in ('scheduled', 'canceled', 'ended')),
  starts_at timestamptz not null,
  ply_interval_ms integer not null default 2000 check (ply_interval_ms between 250 and 60000),
  release_mode text not null default 'window' check (release_mode in ('window', 'full')),
  created_by uuid,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  canceled_at timestamptz,
  primary key (round_pk, game_key),
  constraint mvp_official_broadcasts_game_fk foreign key (round_pk, game_key)
    references public.mvp_official_games (round_pk, game_key) on delete restrict,
  check ((state = 'canceled') = (canceled_at is not null))
);

create index if not exists mvp_official_broadcasts_event
  on public.mvp_official_broadcasts(event_id, starts_at);
create index if not exists mvp_official_broadcasts_state
  on public.mvp_official_broadcasts(state, starts_at);

/**
 * `event_id` phải khớp round (không cho lịch phát "lạc" sang giải khác) và chỉ ván đã có
 * kết quả accepted mới được đặt lịch: chấm xong mới phát.
 */
create or replace function public.mvp_official_broadcast_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.mvp_official_rounds r
    where r.id = new.round_pk and r.event_id = new.event_id) then
    raise exception 'broadcast_event_mismatch';
  end if;
  if not exists (select 1 from public.mvp_official_games g
    where g.round_pk = new.round_pk and g.game_key = new.game_key and g.result is not null) then
    raise exception 'broadcast_game_not_scored';
  end if;
  new.updated_at := clock_timestamp();
  return new;
end; $$;
revoke all on function public.mvp_official_broadcast_guard() from public, anon, authenticated;

drop trigger if exists mvp_official_broadcast_guard on public.mvp_official_broadcasts;
create trigger mvp_official_broadcast_guard before insert or update on public.mvp_official_broadcasts
  for each row execute function public.mvp_official_broadcast_guard();

alter table public.mvp_official_broadcasts enable row level security;
revoke all on public.mvp_official_broadcasts from public, anon, authenticated;
grant select, insert, update on public.mvp_official_broadcasts to service_role;

notify pgrst, 'reload schema';
