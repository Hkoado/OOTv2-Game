-- Huy review 24/10/2026 — siết quyền bảng cho hàng đợi/lịch chính thức.
--
-- Bối cảnh: `20261025090000_official_schedule.sql` và `20261026090000_official_worker_jobs.sql`
-- cấp `select, insert, update` (bảng) cho `service_role`. Mọi ghi hợp lệ đều đi qua RPC
-- `SECURITY DEFINER` (fence lease/generation), nên quyền UPDATE/INSERT qua PostgREST vừa thừa
-- vừa cho phép bỏ qua fence (ví dụ PATCH thẳng `status='succeeded' + result + replay_hash`).
--
-- Migration additive này chỉ thu hẹp quyền, không đổi schema/dữ liệu và không đổi RPC:
-- - jobs/attempts: `service_role` chỉ SELECT (worker ghi qua `mvp_official_*_job`).
-- - rounds/games: `service_role` chỉ SELECT (scheduler ghi qua `mvp_official_open_round`,
--   `append_game`, `record_result`, `freeze_round`).
-- Browser (`anon`/`authenticated`) vẫn không có quyền gì.

revoke all on public.mvp_official_jobs, public.mvp_official_job_attempts
  from public, anon, authenticated, service_role;
grant select on public.mvp_official_jobs, public.mvp_official_job_attempts to service_role;

revoke insert, update on public.mvp_official_rounds, public.mvp_official_games from service_role;
grant select on public.mvp_official_rounds, public.mvp_official_games to service_role;

alter table public.mvp_official_jobs enable row level security;
alter table public.mvp_official_job_attempts enable row level security;
alter table public.mvp_official_rounds enable row level security;
alter table public.mvp_official_games enable row level security;

comment on table public.mvp_official_jobs is
  'Official game queue. service_role chỉ SELECT; mọi chuyển trạng thái/lease/result đi qua RPC có fence.';
comment on table public.mvp_official_job_attempts is
  'Accepted-attempt audit cho official jobs. service_role chỉ SELECT; ghi bởi RPC claim/finish/fail.';

notify pgrst, 'reload schema';
