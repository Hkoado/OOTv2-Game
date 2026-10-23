# Prompt thực thi — Cline / M1 serverless + regression

Bạn là agent triển khai lát cắt **M1-serverless-regression**, chạy song song Codex intake.

## Khởi động bắt buộc

1. Resolve root tuyệt đối, đọc AGENTS.md, docs/README.md, docs/07, docs/14, **docs/15-DIEU-PHOI-HAI-AGENT.md**, bộ MVP theo AGENTS; xem code thật. Ownership/hợp đồng docs/15 là bắt buộc.
2. Xác nhận nhánh `parallel/m1-serverless-regression`, worktree riêng, status sạch và base chung trong manifest thư mục cha. Sai nhánh/thay đổi lạ: dừng, không reset/chuyển nhánh hộ.
3. Trình bày kế hoạch. `npm.cmd install`, baseline test/build và log exit code. Không coi terminal trống/lệnh chưa completion là pass; không đổi package/lock hoặc xóa suite.

## Công việc

Phục hồi coverage đường Supabase và kiểm serverless, không làm GitHub intake hoặc worker:

- Đọc app/config/origin/accounts/router/api/vercel và migrations để mock đúng PostgREST. Node built-in test + HTTP loopback, fixture fetch fake; không gọi DB thật trong test mặc định. Env giả, khôi phục fetch/env/server/temp file ở finally; cẩn thận config nạp lúc import.
- Thêm regression login/logout/session expiry/CSRF/origin, admin/team scope, error shape/không lộ secret, upload không execute Python. Test hiện trạng trước; không mock thành hành vi lý tưởng chưa có trên code.
- Kiểm `/api/health` JSON, `/api/does-not-exist` JSON 404, sample-bot, local static vs VERCEL không đọc dist; SPA không nuốt API. Fixture static trong temp dir, không ghi đè dist dùng chung.
- Kiểm HTTPS cookie Secure/HttpOnly/SameSite/path, clear cookie, trust proxy/IP và header giả mạo; sửa config/app/accounts/origin nếu cần, không bật trust mọi proxy vô điều kiện. Rate limiter Map hiện tại chỉ per-instance: ghi rõ giới hạn serverless, không gọi đó là distributed quota. Nếu phải sửa `shared/router.js` (Codex sở hữu), ghi patch đề nghị trong report, không sửa.
- Rà routing Vercel bằng tài liệu chính thức hiện hành khi cần; không kết luận rewrite precedence chỉ từ comment. Không thêm CLI dependency hoặc auto deploy. Viết `tools/cli/check-serverless.mjs` dùng Node fetch nhận base URL qua argv, timeout, exit nonzero khi health/unknown API không phải JSON; chỉ GET endpoint an toàn, không log credential hay đổi DB. Preview thật chưa có thì `NOT RUN`.
- `.env.example` chỉ placeholder, không sao `.env`; không deploy, apply SQL, reset database hay mở public untrusted bot. Không sửa privacy live ở M3 trong đợt này; ghi blocker phát hành vì `/api/live` hiện anonymous/immediate.

Chỉ sửa danh sách ownership docs/15. Không sửa shared/router/participants/client/worker/artifacts, migrations/module github, src, package/lock, docs chung; không tạo wrapper né ownership. Các test mới mang prefix serverless/sharedAuth/sharedApi, helper tests/helpers/shared*.js. Không khôi phục SQLite harness. Bộ integration Supabase thật chỉ tài liệu/kế hoạch trong report nếu chưa được cấp project test disposable, không dùng credential repo mặc định.

## Test/Done và bàn giao

Chạy targeted tests, full `npm.cmd test`, `npm.cmd run build`; kiểm cú pháp CLI và test smoke CLI bằng mock/local HTTP với ca pass/fail/content-type/timeout. Offline test pass không thay chứng cứ Preview HTTPS. Đọc lại tất cả file sửa, kiểm diff/path ownership, không xóa test để pass.

Viết `docs/agents/reports/CLINE-M1.md`: base/HEAD/files, lệnh/exit code, matrix auth/CSRF/static/proxy, hành vi sửa, diff đề nghị file ngoài quyền, lệnh kiểm Preview + kết quả hoặc NOT RUN, project test/migration chưa apply, nợ coverage worker/E2E, blocker public readiness. Stage đúng files sở hữu, commit local nếu tests pass; không push/merge/cherry-pick, không làm M2/M3. Kết thúc tiếng Việt với commit và giới hạn.