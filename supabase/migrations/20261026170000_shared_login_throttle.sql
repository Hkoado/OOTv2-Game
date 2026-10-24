-- Huy: Login throttle dùng chung qua Supabase (RC online tối giản).
-- Chặn brute-force đăng nhập phân tán trên môi trường serverless (nhiều lambda/container).
-- Bảng và RPC được bảo vệ: chỉ service_role/RPC nội bộ, anon/authenticated không có quyền.

create table if not exists public.mvp_login_attempts (
  key text not null primary key check (length(key) between 3 and 200),
  hits integer not null default 1 check (hits >= 1),
  reset_at timestamptz not null
);

alter table public.mvp_login_attempts enable row level security;
revoke all on table public.mvp_login_attempts from public, anon, authenticated;
grant select, insert, update, delete on table public.mvp_login_attempts to service_role;

create index if not exists mvp_login_attempts_reset_idx on public.mvp_login_attempts (reset_at);

/** Ghi nhận một lượt thử đăng nhập, trả về { allowed, retryAfter, hits } theo nguyên tử. */
create or replace function public.mvp_login_throttle_hit(
  p_key text,
  p_max integer,
  p_window_ms integer default 60000
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz := clock_timestamp();
  v_window_interval interval := (greatest(1000, coalesce(p_window_ms, 60000)) || ' milliseconds')::interval;
  v_reset_at timestamptz;
  v_hits integer;
  v_allowed boolean;
  v_retry_after integer;
begin
  if p_key is null or length(p_key) < 3 or length(p_key) > 200 then
    return jsonb_build_object('allowed', false, 'retryAfter', 60, 'hits', p_max + 1);
  end if;

  -- Dọn dẹp key đã hết hạn định kỳ
  delete from public.mvp_login_attempts where reset_at < v_now - interval '5 minutes';

  insert into public.mvp_login_attempts (key, hits, reset_at)
  values (p_key, 1, v_now + v_window_interval)
  on conflict (key) do update
  set
    hits = case when public.mvp_login_attempts.reset_at <= v_now then 1 else public.mvp_login_attempts.hits + 1 end,
    reset_at = case when public.mvp_login_attempts.reset_at <= v_now then v_now + v_window_interval else public.mvp_login_attempts.reset_at end
  returning hits, reset_at into v_hits, v_reset_at;

  v_allowed := (v_hits <= p_max);
  v_retry_after := greatest(1, ceil(extract(epoch from (v_reset_at - v_now))))::integer;

  return jsonb_build_object('allowed', v_allowed, 'retryAfter', v_retry_after, 'hits', v_hits);
end; $$;

revoke all on function public.mvp_login_throttle_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.mvp_login_throttle_hit(text, integer, integer) to service_role;

/** Xoá bộ đếm của key (ví dụ khi đăng nhập thành công). */
create or replace function public.mvp_login_throttle_reset(
  p_key text
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_key is not null then
    delete from public.mvp_login_attempts where key = p_key;
  end if;
end; $$;

revoke all on function public.mvp_login_throttle_reset(text) from public, anon, authenticated;
grant execute on function public.mvp_login_throttle_reset(text) to service_role;
