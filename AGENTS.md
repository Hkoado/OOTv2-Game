# Quy tắc bảo trì OOTv2

## Đọc trước khi sửa

1. README gốc, docs/README.md và runbook liên quan.
2. Kiểm branch/git status, đọc code/test thật; không ghi đè thay đổi chưa commit của người dùng.
3. Đặc tả MVP là lịch sử, không dùng để khôi phục SQLite hoặc luật v1 cho ván mới.

## Kiến trúc và tương thích

- Giữ React/Vite, JavaScript ESM, Express, Supabase PostgreSQL/Storage là DB duy nhất. Không viết lại dự án hoặc thêm framework/hạ tầng không cần thiết.
- Ván mới dùng map.v2 / ott-campus.v2, setup kín; bot tự trả đủ 9 vị trí. Lửa cản Bao, Nước cản Kéo, Bụi cản Búa, Vực cản tất cả.
- Giữ protocol/replay/map v1, room/P2P và regression lịch sử; không đổi luật/runtime snapshot đã pin.
- App chỉ mount CampusPortal; không tự mở LegacyApp hoặc redesign.
- Engine/server quyết định kết quả. RNG ảnh hưởng lịch/trận phải có seed được lưu, không dùng clock/random không lưu.
- Python một file UTF-8 <=256 KiB, thư viện chuẩn. Không clone/thực thi bot trên API/Vercel.
- Review version/hash khi đổi runtime files. Campus 400 plies không thay MVP 200 plies.

## An toàn

- Subprocess không phải sandbox. Trusted-dev chỉ code tin cậy, cấm production; không bỏ gate để demo.
- Không shell:true, eval/exec bot; timeout, output/file cap, cleanup process và exception bắt buộc.
- Write kiểm session/CSRF/role/scope server; DTO không lộ source/storage key/secret/lease token/kết quả kín.
- Giữ fencing, lease/generation, idempotency; retry cùng SHA/map/runtime/seed đã pin.
- Không tự push/deploy/apply remote/tạo worktree hoặc sửa production khi chưa được yêu cầu rõ.
- Không log/commit secret, env, private artifact, backup. Giữ license font; không tự gán license asset.
- Manual finals cần API/Supabase/worker có mạng, không quảng cáo giải hoàn toàn offline.

## Kiểm chứng

- Sửa phạm vi nhỏ, dùng conventions/dependency có sẵn, Node built-in tests; thêm regression cho bug.
- Chạy test liên quan, full suite/build/diff cuối đợt nếu có thể; kiểm lại file đã sửa.
- PowerShell chặn npm.ps1 thì dùng npm.cmd, không đổi execution policy toàn máy.
- Phân biệt mock/local/DB/VM/browser/production; không coi NOT RUN/service active/health DB là sandbox acceptance.
- Báo tiếng Việt: thay đổi, file, lệnh/kết quả, lỗi còn lại, giới hạn; không tuyên bố production-ready từ test/build.
