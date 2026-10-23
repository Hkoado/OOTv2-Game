# Bàn giao tiếp tục code — 23/10/2026

> **Checkpoint tiếp theo:** người dùng đã yêu cầu thiết lập giải chính thức và chia việc 3 người.
> Xem [docs/16](16-THIET-LAP-CHINH-THUC-VA-CHIA-VIEC.md) cùng prompt Huy/Bảo/Khoa.
> Quyết định làm tuần tự bên dưới là lịch sử, không còn là kế hoạch nhóm mới.
> Profile MVP cũ vẫn giữ 200 plies; setup chính thức không được chạy qua scheduler MVP.

## Bắt đầu phiên mới

Người dùng đã **hủy kế hoạch nhiều agent**. Chỉ dùng một agent, làm tuần tự tại
`D:\OOTv2-Game`, nhánh `dev`; không tạo worktree, không chia ownership hay merge nhánh điều phối.
Đã xóa tài liệu chia việc, hai prompt Codex/Cline và script tạo worktree; không hoàn tác code M1.

Prompt có thể gửi cho phiên mới:

> Đọc AGENTS.md và docs/15-BAN-GIAO-TIEP-TUC.md, kiểm tra git status/code thật rồi tiếp tục M1 tuần tự trong workspace hiện tại. Trước hết xác lập baseline test/build, báo kế hoạch ngắn và chỉ làm một phần việc có thể kiểm chứng. Không tạo kế hoạch nhiều agent, không tự deploy/apply migration remote.

## 1. Mốc Git đã kiểm tra

- Trước đợt dọn tài liệu: `dev` @ `eabb907`, working tree sạch.
- `1369345`: bỏ SQLite, Supabase là DB duy nhất.
- `589173b`: upload intake không chạy bot trên API, validation chuyển worker, entrypoint Vercel.
- `dd785fb`: dọn import.
- `eabb907`: tài liệu chia việc trước đây; **không phải code GitHub intake**. Kế hoạch đó nay hủy.
- `git worktree list` chỉ có `D:/OOTv2-Game`; không có nhánh `parallel/*` ở lần kiểm tra.
- Đợt hiện tại chỉ sửa/xóa tài liệu và script điều phối, chưa triển khai thêm tính năng.

Phiên mới phải kiểm lại HEAD/status; không reset hoặc ghi đè thay đổi chưa commit của người dùng.

## 2. Hướng sản phẩm giữ nguyên

Repo GitHub + branch → API khóa SHA và ghi job/receipt → worker máy BTC tải đúng `bot.py`
→ validate → snapshot bất biến → chấm trước → giữ kín kết quả → BTC đặt lịch công bố
→ thành viên giải xem từng nước đến hạn → mở replay/kết quả sau khi phát xong.

Supabase Postgres + Storage private là nguồn dữ liệu duy nhất. Giữ React/Vite, chế độ phòng cũ,
luật/engine MVP, **256 KiB / 200 plies**. Không tự chuyển Campus 400 plies/persistent protocol.
API request ngắn: không chạy Python/bot, clone repo hoặc worker nền. Chưa có sandbox OS:
**chỉ chạy bot tin cậy**, không mở nhận code lạ công khai. Đọc docs/14, docs/06 và code/schema thật;
những đoạn SQLite trong tài liệu MVP cũ là lịch sử, không khôi phục driver cũ.

## 3. Đã có trong code

| Phần | File chính / hiện trạng |
|---|---|
| Supabase-only | `server/shared/client.js`, `server/config.js`, package/lock đã bỏ better-sqlite3; thiếu credential phải fail fast |
| Upload tương thích | `server/shared/participants.js`: kiểm tĩnh, artifact Storage + SHA-256, `uploaded`/receipt; chưa phải GitHub job |
| Kiểm source | `server/services/botValidation.js`: static inspection và Python validation phía worker |
| Worker | `server/shared/worker.js`: `validatePendingSubmissions()`; worker trận có RPC claim/heartbeat/lease/token fencing |
| Artifact | `server/shared/artifacts.js`: materialize/hash/cache/cleanup |
| Auth/API | `server/shared/accounts.js`, `router.js`: session/CSRF/admin guard; profile repo/branch chỉ là thông tin, chưa nộp GitHub |
| Serverless | `api/[...path].js`, `vercel.json`, `server/app.js`: có entrypoint, VERCEL tắt static Express; chưa nghiệm thu Preview |
| Live | `server/shared/live.js`, `server/routes/live.js`; events/output/heartbeat Supabase, migration `20261023120000_live_stream.sql` |
| Test | `tests/portalAuthApi.test.js` (auth/CSRF/phân quyền qua HTTP + PostgREST giả lập), `tests/liveStream.test.js`, `sharedRuntime.test.js`, `uploadIntake.test.js` cùng các test còn lại |

## 4. Đang dở / rủi ro không được bỏ qua

- **M1 mới một phần**: chưa có nhận repo chính thức, resolve numeric repo ID/full commit SHA,
  transaction cutoff/idempotency, validation-job và receipt theo giải. Form profile repo chưa thay thế các phần đó.
- `validatePendingSubmissions()` chọn bài uploaded rồi update theo id, **chưa có claim/lease/fencing**
  cho validation. Lease trận không bảo vệ validation; nhiều worker có thể chạy trùng. Catch giữ uploaded
  nhưng chưa có backoff/phân loại lỗi hạ tầng đầy đủ; cần test mất mạng/hash/Python unavailable/cleanup.
- Chín suite tích hợp SQLite đã bị xóa: api, tournamentFlow, workerE2E, liveApi, liveEvents,
  localPortal, judgeMonitor, publicHardening, staticServing. Mock live mới chỉ bù một phần coverage.
- `/api/live` vẫn public/anonymous/immediate; replay/result/standings/bracket chưa được audit theo lịch.
  **Chưa có giữ kín và phát theo lịch M3–M4**, chưa được công khai dữ liệu giải thật.
- Chưa xác nhận migration remote đã apply, chưa xác nhận Vercel deployment. Không suy ra API health JSON
  chỉ từ comment rewrite precedence; phải thử routing Preview, HTTPS cookie Secure/CSRF/origin/trust proxy/IP.
- Rate limit dùng Map chỉ trong instance, không phải quota phân tán cho serverless.
- Chưa có sandbox OS, tải thật 50/100/200 viewer hoặc E2E trên project Supabase test riêng.

## 5. Thứ tự làm tiếp (tuần tự)

1. **Baseline + hồi quy**: kiểm git/code/schema; chạy `npm.cmd test`, `npm.cmd run build`, lưu exit code.
   Phục hồi tests Node built-in cho Supabase auth/CSRF/role scope/upload/static/serverless bằng mock;
   không gọi DB thật mặc định, không xóa test để pass, không khôi phục SQLite harness.
2. **Đóng M1 GitHub intake**: đọc docs/06 và docs/14, chốt contract nhỏ trước khi code. API chỉ nhận
   repo/branch, resolve một lần thành SHA, ghi giờ server/DB và job/receipt, không tải/chạy source.
   Guard session/CSRF/membership, private receipt whitelist. Repo URL không token/SSRF;
   không dùng commit timestamp để vượt cutoff. Transaction nhận job kiểm lại cutoff/freeze/uniqueness
   theo giải/đội/repo/SHA/path. Giữ upload là trusted-dev fallback, không báo luồng GitHub đã có chỉ vì có docs.
   Migration mới additive, không sửa migration cũ; quyền repo public không chứng minh ownership,
   chưa verify quyền phải gate BTC approval/fail closed. Không nhận token sinh viên qua form/log/bot.
3. **Nghiệm thu M1**: API không cần Python/git; login → repo → job/receipt; test/build + project DB test
   riêng khi được cấp; Preview routing/HTTPS khi có môi trường. Ghi rõ mock vs integration/NOT RUN.
4. **M2 riêng sau đó**: claim/lease/fencing/retry/backoff validation job, bounded blob fetch đúng SHA,
   size/hash/timeout/redirect/rate limit, giữ valid cũ, pin snapshot/cache/map worker, E2E nhiều worker.
5. **M3 → M4 → M5/M6**: privacy/publication + ACL và cắt nước theo giờ → viewer catch-up/countdown
   → đo tải/hồi quy/deploy/vận hành. Sandbox OS là gate độc lập trước code không tin cậy.

Mỗi phiên chỉ làm một phần nhỏ có test và báo cáo; không cần triển khai toàn bộ danh sách cùng lúc.
Không tự apply SQL/deploy/reset/seed DB thật. Khi cần integration, xác nhận project disposable riêng.

## 6. Bằng chứng kiểm thử đã có (không giả là mới chạy)

- Đợt code M1 trước báo cáo 77/77 tests, build exit 0.
- Lần rà soát viết tài liệu trước: log ghi 77 pass / 0 fail, Vite 1636 modules, hoàn tất 4,43 s;
  shell integration không thu được exit code hai lệnh nên chưa phải nghiệm thu exit 0 mới.
- Smoke HTTP/Supabase từ báo cáo cũ không thay cho kiểm lại schema, auth và deployment hiện tại.
- Đợt hủy kế hoạch này chỉ sửa docs/xóa script, không đổi runtime; không cần cài dependency hay chạy bot.
  Kiểm diff/link/tham chiếu kế hoạch cũ, không dùng terminal output rỗng làm bằng chứng pass.

Không commit secret, `.env`, source bot sinh viên hoặc log nhạy cảm. Cuối mỗi phần việc ghi file sửa,
lệnh/exit code, phần chưa test và bước kế tiếp vào docs/07 hoặc cập nhật tài liệu bàn giao này.

## 7. Checkpoint gần nhất — baseline + hồi quy HTTP (23/10/2026)

Chi tiết đầy đủ ở `docs/07`, mục “M1 — Baseline và hồi quy HTTP auth/CSRF/phân quyền”.

- `dev` @ `eabb907`; không reset/không ghi đè thay đổi tài liệu chưa commit.
- Baseline: `npm.cmd install` / `npm.cmd test` / `npm.cmd run build` đều exit 0
  (build 1636 modules, 9,39 s).
- Thêm `tests/portalAuthApi.test.js` (5 test) — Express thật trên loopback, Supabase giả lập ở
  lớp `fetch`, chặn mọi origin ngoài `https://example.invalid`.
- Sau thay đổi: `npm.cmd test` **82/82 pass** (0 fail), `npm.cmd run build` exit 0 (1636 modules, 6,18 s).
- **NOT RUN:** Supabase thật, Storage upload thật, Preview/Vercel HTTPS, GitHub SHA/job/receipt.
- **Bước kế tiếp:** chốt contract nhỏ cho GitHub intake (đọc `docs/06`, `docs/14`) rồi mới code;
  vẫn giữ upload là trusted-dev fallback và chưa đóng M1.