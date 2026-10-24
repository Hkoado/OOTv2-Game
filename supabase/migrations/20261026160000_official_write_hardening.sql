-- Huy review 24/10/2026 — siết quyền xoá của service_role trên dữ liệu official.
--
-- `20261026110000` đã bỏ UPDATE trực tiếp trên jobs/rounds/games, nhưng service_role vẫn còn
-- DELETE trên `mvp_official_rounds`/`mvp_official_games` (kiểm bằng REST DELETE = 204 trong
-- worker-schema-drill). Xoá ván/vòng là đường vòng qua fence ghi kết quả, nên thu hồi.
-- Lịch phát đã huỷ bằng `state='canceled'`, không cần DELETE.
-- Việc dọn dữ liệu drill/test dùng owner hoặc Management API, không dùng service key.
revoke delete on table public.mvp_official_rounds from service_role;
revoke delete on table public.mvp_official_games from service_role;
revoke delete on table public.mvp_official_broadcasts from service_role;
notify pgrst, 'reload schema';
