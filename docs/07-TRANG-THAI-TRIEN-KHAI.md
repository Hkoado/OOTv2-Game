# Trạng thái triển khai Campus — 23/10/2026

## Hoàn thiện map v2/offline và yêu cầu bot tự setup — 24/10/2026

- Luồng đang mount: offline và thiết lập giải mới dùng v2; API lưu thiết lập chặn map v1
  (`legacy_map_read_only`), đọc map/replay lịch sử vẫn giữ version. Worker MVP tiếp tục từ chối v2.
- 5 mẫu đối xứng: learn-fire, learn-water, learn-bush, learn-chasm, campus-four-terrains;
  menu offline/giải và JSON examples dùng chung nguồn. Có địa hình trong vùng setup hai màu.
- Offline giữ xếp tay/đổi/nhấc quân/Xếp nhanh, kiểm địa hình cả chiều ngược khi swap;
  matching xác định cho quick setup, giữ lựa chọn thủ công. Xác nhận kiểm đủ 9 ID/type/ô hợp lệ.
  Bàn hot-seat ẩn quân đối phương đến khi hai bên xác nhận; không phải bảo mật trước DevTools.
- Bot bắt buộc tự code setup + move. Cổng tải đúng campus_bot.py persistent; test bot mẫu
  tự setup/chơi đủ 5 map, test setup thiếu bị INVALID_SETUP, không có auto-fill/manual substitute.
- Không đổi transport hoặc mở lại LegacyApp/P2P (không mount). Không tuyên bố sealed P2P;
  không deploy/apply remote. Persistence/API/UI phân màu, nghiệm thu Supabase, sandbox và
  scheduler chính thức vẫn chưa hoàn tất, không nằm trong phần map/offline này.
- Validation: toàn bộ 275/275 tests pass, không skip; Vite build pass. Browser Edge headless:
  hai theme, 5 map/download JSON, xếp tay/chặn Bao trên Lửa, ẩn setup Đỏ khi Xanh xếp,
  18 quân khi bắt đầu, nước đi/history/keyboard và 4 kích thước màn hình không tràn ngang.
  Logs cục bộ: data/v2-tests.log, data/v2-build.log, data/ui-smoke-report.json.
  Baseline npm install vẫn báo 2 high vulnerabilities; không tự audit fix/đổi dependency.

## Storage adapter cho consumer GitHub — 24/10/2026

- Thêm `server/shared/artifactUpload.js` (`storeVerifiedSource`): upload bucket private cố định
  `ootv2-bots`, key UUID, `x-upsert:false`, `redirect:'error'`, deadline 20 s/honor abort; **đọc lại**
  qua `downloadStorageArtifact` và chỉ trả `{storage_path,sha256}` khi bytes + SHA-256 khớp.
- Không xoá object sau lỗi/không rõ finish (có thể là bài đã được nhận); orphan cần inventory/GC sau
  đối soát. Không import vào worker/API/UI; consumer vẫn `enabled:false`, không chạy Python.
- Test mock `fetch` + tích hợp `processGithubJob` (7 test mới trong `tests/artifactDownload.test.js`).
  Toàn bộ **282/282 pass**, 0 skip; Vite build 1649 modules pass. Supabase Storage/PostgreSQL/GitHub
  thật, sandbox Linux, browser và offline restore **NOT RUN**. Chi tiết: [Storage adapter](STORAGE-ADAPTER.md).

## Gói offline tự chứa — 24/10/2026

- `server/shared/offlineBundle.js` + CLI `tools/cli/offline-bundle.js` (`npm run offline:bundle`):
  build/verify thư mục gồm `manifest.json`, `snapshot.json` (canonical của `campus-round-snapshot.v1`)
  và `bots/<participantId>.py`. Kiểm contentHash manifest/snapshot, đúng tập bot, hash từng source,
  giới hạn 256 KiB/bot, 16 MiB/tổng, chặn path traversal/extra/duplicate, từ chối symlink.
- Ghi vào thư mục rỗng bằng temp + fsync + rename, manifest cuối; đọc chỉ file trong manifest.
  Test **5/5**; diễn tập CLI 2 bot build/verify pass, sửa 1 byte → fail, phục hồi → pass.
- Chưa xuất từ giải thật/56 đội, chưa restore VM Linux, chưa ký manifest, chưa nhập kết quả offline.
  Chi tiết: [Gói offline](OFFLINE-BUNDLE.md).

## Luật v2 — 24/10/2026

- [Luật địa hình/xếp kín/phân màu](17-LUAT-DIA-HINH-VA-XEP-KIN.md): engine Campus,
  map.v2/hash/replay, bot mẫu, bút địa hình và công bố/khóa pack đã có.
- Phân màu là hàm thuần ván kế tiếp + aggregator theo màu chốt. **Chưa có persistence/API/UI
  công bố màu trước ván** vì runtime chính thức chưa nối; không mở gate worker MVP.
- Không sửa phòng P2P/gameState/điều kiện thắng; không thêm ảnh hoặc dependency.
- Migration khóa pack chưa apply; mock publication không thay Postgres integration thật.

## Checkpoint mới — thiết lập giải chính thức và chia việc Huy/Bảo/Khoa

Yêu cầu mới thay kế hoạch một agent: đọc [docs/16](16-THIET-LAP-CHINH-THUC-VA-CHIA-VIEC.md)
và prompt trong `docs/assignments/`. Chưa đóng GitHub intake M1 hoặc runtime chính thức.

- Tạo giải mới `campus-setup.v1` tuần/tháng/kỳ, roster đến 56 đội, cutoff UTC,
  map chính/dự phòng và map pack version; dự kiến chia bảng xác định bằng seed.
- Counts 35/40/48/50 đội: 120/160/240/264 ván qualifier. Điểm cặp/knockout hiển thị
  theo điều lệ, **chưa thực thi scheduler/standings/vé**. API start/SQL trigger fail closed.
- File chính mới: `src/game/competition.js`, `server/shared/officialSetup.js`,
  `src/tournament/portal/OfficialSetupPanel.jsx`, `tests/officialSetup.test.js`.
  Giữ nguyên dữ liệu/replay/runner MVP lịch sử; không tạo giải mới theo lịch 8 đội.
- Migration additive `20261023160000_official_setup.sql` **chưa apply**. Cần schema trước
  code rollout vì chi tiết giải đọc thêm bảng setup. Không tự deploy hoặc apply remote.
- Đã fetch origin exit 0: live `7676a51` và logs `0112cc1` đã là ancestor;
  Backend mới `8540d2f` không merge vì dependency SQLite và clone HTTP/cutoff sai hướng.
- Baseline `npm.cmd install` / `npm.cmd test` / `npm.cmd run build`: exit 0, 82 tests.
- Sau chỉnh: `npm.cmd test` **91/91 pass**, 0 fail/skip (2,72 s), exit 0;
  `npm.cmd run build` exit 0 (1638 modules, 4,23 s); `git diff --check` exit 0.
  Exit code được thu bằng child process và lưu log riêng do shell integration lỗi.
- Install báo 2 high severity vulnerabilities và cảnh báo esbuild approval; chưa tự audit fix.
- NOT RUN: apply/integration PostgreSQL thật, browser tương tác setup, Preview HTTPS,
  GitHub intake, Linux sandbox, tải viewer, offline bot/restore. Test setup dùng mock PostgREST,
  SQL test chỉ static; không gọi DB thật. UI/DB migration chưa được coi là E2E đã nghiệm thu.
- Giữ nguyên thay đổi chưa commit có trước phiên, gồm test HTTP auth và xóa kế hoạch hai agent;
  không commit/push thay người dùng. Không restore các file đã xóa.

## Bàn giao tiếp tục M1 — 23/10/2026

Xem [bàn giao code dang dở cho phiên mới](15-BAN-GIAO-TIEP-TUC.md).
Người dùng đã hủy kế hoạch nhiều agent; tiếp tục tuần tự trong workspace hiện tại, không cần worktree/merge điều phối.
M1 vẫn **một phần**: upload intake không chạy Python và có Vercel entrypoint, nhưng chưa có
luồng GitHub SHA/job/receipt; validation upload chưa có lease; Preview HTTPS và integration
Supabase chưa nghiệm thu. Live hiện anonymous/immediate, chưa giữ kín và phát lịch M3–M4.
Các số test/build phía dưới là bằng chứng của từng đợt cũ, không cộng dồn hay coi là chạy lại.
Các mục SQLite phía dưới là lịch sử trước Supabase-only, không phải hướng triển khai hiện tại.

## M1 — Baseline và hồi quy HTTP auth/CSRF/phân quyền (23/10/2026)

Phần việc nhỏ, **chưa đóng M1** (GitHub intake vẫn thiếu).

- Nhánh `dev` @ `eabb907`; giữ nguyên thay đổi chưa commit về tài liệu/dọn kế hoạch nhiều agent.
- Baseline trước khi sửa: `npm.cmd install` exit 0 (chỉ cảnh báo `allow-scripts` của esbuild; binary
  `@esbuild/win32-x64` có mặt, `esbuild.transform` chạy được), `npm.cmd test` exit 0,
  `npm.cmd run build` exit 0 (1636 modules, 9,39 s).
- Thêm `tests/portalAuthApi.test.js` (5 test, Node built-in runner): dựng Express app thật trên
  loopback + PostgREST giả lập ở lớp `fetch`; mọi URL khác `https://example.invalid` bị ném lỗi
  nên test không thể chạm Supabase cấu hình trong `.env`.
- Phạm vi bảo vệ: whitelist account, cookie `HttpOnly` + `SameSite=Strict`, session lưu hash;
  401 khi thiếu/sai session và sau logout; 403 khi thiếu/sai CSRF hoặc origin lạ (và không ghi DB);
  team bị chặn route admin, không nộp bài thay đội khác; chặn repository không phải GitHub HTTPS,
  có token hoặc path lạ; branch chứa khoảng trắng.
- Sau thay đổi: `npm.cmd test` **82/82 pass** (77 cũ + 5 mới, 0 fail), `npm.cmd run build` exit 0
  (1636 modules, 6,18 s).
- **Chưa kiểm (NOT RUN):** Supabase thật, Preview/Vercel HTTPS/cookie `Secure`, upload thành công
  lên Storage, và bản thân luồng GitHub SHA/job/receipt.
- Bước tiếp: đọc `docs/06-GITHUB-NOP-BOT-VA-LUU-TRU.md` + `docs/14`, chốt contract nhỏ cho API
  nhận repo/branch (resolve SHA một lần, cutoff, idempotency, receipt) trước khi viết code.

## M0 — Baseline và chốt hướng chấm trước / phát trận (23/10/2026)

Đợt này **chỉ xác lập baseline và chốt hướng**, chưa thêm tính năng chấm trước hay phát trận.

- Nhánh hiện tại `testkhoa` @ `7676a51` (= `origin/live` + commit quan sát chấm bài), working tree sạch.
- Baseline trên máy: `npm.cmd run build` **pass** (3,94 s); `npm.cmd test` **93/93 pass**
  (42,6 s, exit 0), gồm worker hoàn tất giải 30 ván, local portal auth/CSRF, live events, schema Supabase.
- **Không merge nguyên** `Backend` và `Worker-Fix`: `Backend` gắn SQLite và lấy HEAD tại/qua cutoff
  (không khóa đúng commit trước hạn); `Worker-Fix` chỉ cho worker SQLite và cờ map kiểm truthy.
  Phần dùng được sẽ **port chọn lọc** sang đường Supabase/shared ở M2.
- Chốt mô hình: worker máy BTC chấm và ghi kết quả/replay **kín** vào Supabase; BTC công bố theo lịch;
  API chỉ trả các nước đã đến mốc giờ phát; client tự dựng bàn cờ. Không chấm bot trên web/trình duyệt.
- Chính sách xem đổi thành **theo giải**: đội xem mọi trận đã công bố trong giải mình tham gia.
- Tài liệu quyết định: [kiến trúc chấm trước và phát trận](14-KIEN-TRUC-CHAM-TRUOC-VA-PHAT-TRAN.md)
  (nhịp phát mặc định 2 s/nước, mục tiêu đo 100 viewer, milestone M1–M6, hình dạng API, deploy).

Chưa làm ở M0: bảng công bố/lịch phát, API cắt theo mốc, viewer từng nước, chuyển validation khỏi API host,
cách ly cấp OS cho bot sinh viên, đo tải thật.

## Supabase là DB duy nhất — bỏ SQLite (23/10/2026)

Quyết định: chỉ còn **một** đường dữ liệu (Supabase Postgres + Storage) để thao tác dev/prod giống nhau.

- Bỏ hẳn: `server/db.js` (schema SQLite), `server/routes/{localPortal,participants,tournaments,matches}.js`,
  `server/services/{localAccounts,participants,tournaments,matches,liveEvents,eventFolder,judgeMonitor}.js`,
  `server/middleware/adminKey.js`, `tools/cli/{live-demo,reset-live-demo,migrate-shared-db}.js`,
  dependency `better-sqlite3`, các biến `OOTV2_DB_DRIVER`/`OOTV2_DB_PATH`/`OOTV2_ADMIN_KEY`.
- Giữ và port: `/api/live` chạy trên bảng mới `mvp_match_events`, `mvp_match_bot_output`,
  `mvp_worker_state` (migration `20261023120000_live_stream.sql`). Worker ghi event qua hàng đợi tuần tự;
  API trả `503 live_not_ready` khi chưa chạy migration thay vì 500 mơ hồ.
- Hàm thuần tách khỏi SQLite: `server/lib/names.js`, `server/lib/tournamentFormat.js`;
  `requireLocalAdmin` chuyển vào `server/shared/accounts.js`.
- Worker: `server/worker.js` chỉ còn entry → `shared/worker.js` (claim/lease 60 s + heartbeat 10 s + token fencing).
- Test offline: **77/77 pass** (`npm test`). Chín bộ test cũ chạy trên SQLite/`testEnv`
  (`api`, `tournamentFlow`, `workerE2E`, `liveApi`, `liveEvents`, `localPortal`, `judgeMonitor`,
  `publicHardening`, `staticServing`) đã bị xoá vì đường API mà chúng kiểm tra không còn tồn tại.
  Bù lại có `tests/liveStream.test.js` (4 test) kiểm tra snapshot whitelist, seq/upsert/terminal,
  log L2 và overview bằng PostgREST giả lập.
- Smoke thật với `.env` hiện tại: `GET /api/health` → 200 (`driver=supabase`),
  `GET /api/live/overview` → 200. Build Vite pass (1636 modules, 4,3 s).
- **Nợ kỹ thuật phải trả**: chưa có bộ test end-to-end trên Supabase thật (cần project test riêng);
  ở mốc Supabase-only validation còn chạy trên API; phần M1 ngay bên dưới đã chuyển sang worker,
  nhưng chưa có lease cho validation và chưa hoàn tất GitHub intake/job/receipt.

## M1 (một phần) — Tách API khỏi SQLite/filesystem/Python (23/10/2026)

Đã xong trong đợt này:

- **API không còn chạy code bot**: upload chỉ kiểm tra tĩnh (`inspectSourceBuffer`: kích thước,
  NUL byte, UTF-8) rồi lưu `status='uploaded'` + receipt (`id`, `sha256`, `status`) và upload
  artifact lên Storage. Không spawn Python, không smoke test trên API host.
- **Worker chấm thử bài mới**: `validatePendingSubmissions()` tải artifact (kiểm hash/kích thước),
  chạy `validateBotFile` rồi ghi `valid`/`invalid` + `validation_error`. Lỗi hạ tầng giữ nguyên
  `uploaded` để poll sau thử lại (không oan cho đội).
- **Entrypoint Vercel**: `api/[...path].js` export Express app; function **không** chạy worker/Python/git;
  `app.js` bỏ phục vụ `dist/` khi `process.env.VERCEL` (CDN phục vụ web).
- **`vercel.json`**: thêm `functions` (`maxDuration` 30, `includeFiles` cho bot mẫu),
  `headers` no-store cho `/api/*`; rewrite SPA giữ nguyên — Vercel ưu tiên file trong `api/`
  nên `/api/*` không bị nuốt. **Cần xác nhận trên deployment thật** (`GET /api/health` phải trả JSON).

Còn lại của M1 (chưa làm):

- Kiểm thử cookie `Secure`/CSRF/origin trên deployment HTTPS thật (code đã có, chưa nghiệm thu từ xa).
- Rate limit theo IP thật sau proxy trên Vercel (`trust proxy` của Vercel khác loopback).
- Đo tải 50/100/200 viewer (M5) và bộ test end-to-end trên project Supabase riêng.

## Cập nhật runtime shared MVP

API/worker MVP đã nối Supabase qua các bảng `mvp_*`, độc lập 13 bảng Campus.
Đã import 9 đội/2 tài khoản/1 giải/7 entries, giữ hash mật khẩu, không nhập session.
Bucket bot private; DB lease/heartbeat/token fencing cho nhiều worker.
Đây không phải hoàn tất Campus M2–M7, sandbox hay đồng bộ offline.
Xem `d:\OOTv2-Game\docs\12-SUPABASE-DATABASE.md` cho hướng dẫn và giới hạn kiểm chứng.
Các ghi chú SQLite bên dưới mô tả mốc lịch sử/legacy.

## Hardening trước khi mở web công khai (22/10/2026)

Đã sửa 4 điểm chặn code để API chạy được sau reverse proxy HTTPS:

- Guard same-origin (`server/lib/origin.js`) dùng chung cho `/api/local`: chấp nhận localhost (dev),
  origin HTTPS trùng `Host`/`X-Forwarded-Host`, và origin khai báo trong `OOTV2_PUBLIC_ORIGIN`.
- `trust proxy` cấu hình qua `OOTV2_TRUST_PROXY` (mặc định `loopback`) để rate limit login dùng IP thật
  và `req.secure` phản ánh HTTPS.
- Cookie session thêm `Secure` khi request đã qua HTTPS; dev HTTP vẫn đăng nhập được.
- Giới hạn upload nâng 64 KiB → **256 KiB** (`bot.v1`) ở config, multer, artifact, UI và CLI;
  `node tools/cli/setup-shared-storage.js` tự nâng bucket private `ootv2-bots` từ 65536 lên 262144.

Chưa làm: rate limit toàn cục/WAF ở tầng Caddy, sandbox cấp OS, GitHub sync, queue Campus.
API vẫn chỉ bind loopback; chỉ mở qua Caddy/Nginx cùng máy.

## Quan sát chấm bài cho admin — Mức 1 + Mức 2 (22/10/2026)

Cổng admin có thêm trang **Chấm bài** (`#/judge`): mặt quan sát **chỉ đọc**, không đổi kết quả
trận, không mở thêm đường chạy code bot. Vẫn dùng session cookie + CSRF và `requireLocalAdmin`.

- `GET /api/local/admin/judge[?event=<id>]`: tổng ván theo trạng thái (chờ/đang/xong/sự cố),
  tiến độ 3 vòng, ván đang chấm kèm thời gian, 8 ván vừa xong, tối đa 12 ván có sự cố,
  nhịp tim worker và giới hạn judge (`max_plies`, timeout, 256 KiB).
- `GET /api/local/admin/judge/matches/:id`: nhật ký của một ván (ghi chú, lỗi, thời gian, worker).
- Mức 2 lưu nhật ký vào bảng mới `match_logs` (SQLite) / `mvp_match_logs` (Supabase):
  ghi chú của worker, lỗi đầu tiên, `elapsed_ms` và nhãn worker `hostname:pid`.
  Bản SQLite ghi **trong cùng transaction** với `recordResult` nên kết quả và nhật ký không lệch.
- Ghi chú bị lọc đường dẫn tuyệt đối (`C:\...`, `/tmp/...` → `[path]`), gộp xuống dòng,
  cắt 400 ký tự, tối đa 20 dòng. API không trả source code, SHA-256 hay storage path.
- Nhịp tim: `worker_state` cập nhật mỗi vòng poll; UI cảnh báo khi còn ván chờ mà nhịp tim
  cũ hơn 5 chu kỳ (tối thiểu 10 s). Chế độ Supabase dùng `worker_id` + `lease_until` (lease 60 s).
- Supabase: chạy thêm `supabase/migrations/20261022150000_judge_monitor.sql`. Chưa chạy migration
  thì trang vẫn hiển thị tiến độ, chỉ trả `logs_available: false` thay vì làm sập màn hình.
- UI polling 3 s, tạm dừng khi tab ẩn; ván chấm trước bản này không có nhật ký (UI nói rõ).
- Giới hạn đã biết: chưa huỷ/retry ván từ UI, chỉ trích tối đa 400 ký tự stderr trong thông điệp lỗi,
  và vẫn không phải sandbox cấp OS.

Phát triển tiếp `tournament/initial` trên nhánh `codex/campus-engine-foundation`.
Bộ đặc tả mới là đích sản phẩm; bảng dưới phân biệt code chạy được và phần chưa triển khai.
Đợt này triển khai milestone M1 nền tảng engine theo `04-HUONG-DAN-AGENT-CODE.md`.

## Tài liệu đã chỉnh lý

Các file mới bị lệch tên so với nội dung, không đơn thuần có hậu tố `(1)`.
Đã xác định theo tiêu đề và loại dữ liệu thực:

| Tên nhận vào | Tên đúng |
| --- | --- |
| `01-THE-THUC-GIAI (1).md` | `00-TOM-TAT-DOC-NHANH.md` |
| `02-PHUONG-AN-TRIEN-KHAI (1).md` | `01-THE-THUC-GIAI.md` |
| `03-DAC-TA-KY-THUAT (1).md` | `02-PHUONG-AN-TRIEN-KHAI.md` |
| `04-HUONG-DAN-AGENT-CODE (1).md` | `03-DAC-TA-KY-THUAT.md` |
| `05-TICH-HOP-UI-VA-REPO (1).md` | `04-HUONG-DAN-AGENT-CODE.md` |
| `06-GITHUB-NOP-BOT-VA-LUU-TRU (1).md` | `05-TICH-HOP-UI-VA-REPO.md` |
| `OTT-v2-ui-style-kit (1).zip` (thực chất Markdown) | `06-GITHUB-NOP-BOT-VA-LUU-TRU.md` |
| `AGENT-BRIEF (1).md` | `README.md` |
| `build-tokens (1).mjs` | `ui-style/AGENT-BRIEF.md` |
| `contrast-report (1).json` | `ui-style/ASSET-GUIDE.md` |
| `README (1) (1).md` | `ui-style/build-tokens.mjs` |
| `README (2) (1).md` | `ui-style/tokens.json` |
| `REPO-INTEGRATION-BRIEF (1).md` | `ui-style/contrast-report.json` |
| `style-elements (1).png` | `ui-style/UI-GUIDE.md` |
| `tokens (1).css` | `ui-style/README.md` |
| `tokens (1).json` | `ui-style/REPO-INTEGRATION-BRIEF.md` |
| `UI-GUIDE (1).md` | `ui-style/tokens.css` |

`README (3).md` là ZIP thật: đã lấy các asset/hướng dẫn còn thiếu vào `ui-style/`,
đối chiếu các file trùng và bỏ ZIP dư. README style kit bản rời có thêm liên kết tích hợp,
được giữ nguyên. Các docs MVP dùng `_` vẫn ở đường dẫn cũ, được gắn nhãn lịch sử.

## Code hiện có và migration

| Thành phần | Trạng thái và ranh giới |
| --- | --- |
| Game chơi tay, room, spectator | Giữ API mặc định và sync hiện có. Chưa kiểm thử thao tác trình duyệt hai máy trong đợt này. |
| Giải MVP 8 bot/30 ván | Giữ scheduler, DB, runner stateless, replay cũ và giới hạn 200 plies. Không đổi kết quả cũ sang luật Campus. |
| `map.v1` | Có JSON Schema và validator JS, tọa độ/vùng/base cố định, đối xứng 180°, không trùng ô, đủ sân xếp, connectivity và max-flow node splitting ≥2 đường vertex-disjoint. |
| `ott-campus.v1` | Adapter riêng dùng chung primitive di chuyển/ăn quân/thắng của `src/game`. Setup server kiểm đủ ID/sân/ô cản/phase, không auto-place; Đỏ trước Xanh; hòa lặp lần 3/400 plies; thua khi bị khóa. |
| Tính xác định | Seed uint32 được lưu. Clock có injection, mặc định engine Campus là 0; engine không dùng RNG/clock toàn cục cho quyết định. M1 không có bốc thăm hoặc fallback ngẫu nhiên. |
| Hash | Canonical JSON UTF-8, key object sort; blocked sort `(row,col)`. Map hash bỏ `id/revision` (nhãn bản ghi), giữ toàn bộ luật/hình học. Từ chối unknown fields, hash tự tham chiếu và ô trùng. |
| Replay engine | `campus-engine-replay.v1`: config/map/seed, setup/move/bot-fault, seq, từng state hash và hash toàn record; CLI dựng lại qua engine để đối chiếu. Hash kiểm toàn vẹn, không chứng minh người phát hành. |
| Replay production `replay.v1` | Chưa có. Cần runtime/source provenance, transcript riêng tư, bằng chứng fault và runner M2. CLI M1 từ chối replay legacy/unknown; decoder legacy hiện có vẫn giữ riêng. |
| UI/GitHub/auth/queue/offline | Cổng giải đấu local-first đã có đăng nhập thật (`/api/local`), điều hướng theo vai trò, bảng đấu và replay. GitHub sync, queue Campus, offline bundle và Supabase vẫn chưa nối. |

Thứ tự kết thúc Campus: thắng nhà/diệt loại → chuyển lượt/kiểm bị khóa → lặp lần 3 → 400 plies.
Repetition key chỉ gồm map hash, bên đến lượt và bộ `(player,type,square)` của quân sống;
không gồm ID, thời gian, seed. Đếm thế trận đủ setup là lần 1.
Fault bot được adjudicate riêng cho bên đang hoạt động; `INFRA_ERROR`/`ADMIN_CANCEL`
không được dùng làm fault để tính điểm trong adapter Campus. Runner MVP cũ vẫn có hành vi lịch sử;
việc chuyển worker sang attempt hạ tầng nằm ở các milestone sau.

## Chạy thử nền tảng M1

```powershell
npm.cmd run test:engine
npm.cmd run map:validate -- examples/maps/campus-arena.json
npm.cmd run demo:campus -- examples/maps/campus-arena.json "$env:TEMP/oot-campus-demo.json"
npm.cmd run replay:verify -- "$env:TEMP/oot-campus-demo.json"
node docs/ui-style/build-tokens.mjs
```

Trên shell khác dùng `npm` thay cho `npm.cmd`. Demo chọn nước hợp lệ đầu tiên, không chạy Python;
đầu ra phải là đường dẫn chưa tồn tại để tránh ghi đè replay. Engine-only transcript có thể là
ván chưa kết thúc; verifier trả `finished:false` cùng trạng thái đã kiểm chứng, không coi đó là kết quả giải.

## Môi trường và kiểm chứng

- Windows, Node 24.18.0, Python 3.14.2, SQLite 3.53.4.
- `npm install` ban đầu lỗi khi build native `better-sqlite3` vì thiếu Visual Studio C++.
  Sau `npm.cmd install --ignore-scripts`, đã mở SQLite in-memory thật và chạy được bộ test DB/API/worker.
  Không thay version dependency hoặc lockfile để né lỗi. Máy khác cần kiểm tra native module riêng;
  không coi `--ignore-scripts` là bảo đảm SQLite sẽ hoạt động.
- Kiểm tra cuối: `npm.cmd run build` thành công (main 323.65 kB, `ReplayBoard` tách chunk 12.21 kB),
  `npm.cmd test` đạt **63/63**, bao gồm worker hoàn tất giải MVP 30 ván, local portal auth/CSRF/team isolation,
  kiểm tra UI thuần và CLI validate/demo/verify. Generator tokens đạt 44 cặp màu; không có liên kết docs tương đối bị hỏng.
- Chưa nghiệm thu trình duyệt multiplayer, sandbox Linux, tải thật 50 đội/100 viewer hoặc offline USB.

## Cổng giải đấu tournament-first (22/10/2026)

- `src/App.jsx` chỉ mount `CampusPortal`; mở ứng dụng luôn vào màn hình đăng nhập, không auto-restore phiên.
- UI phòng chơi/spectator/Tournament MVP cũ giữ nguyên trong `src/LegacyApp.jsx`, không được import vào bundle chính.
- Vai trò đội: Tổng quan, Đội của tôi, Bot & bài nộp, Giải đấu, Luật & hướng dẫn.
- Vai trò admin: Tổng quan, Đội & tài khoản, Bài nộp, Quản lý giải, Chấm bài, Luật & vận hành.
- Điều hướng bằng hash (`#/events/:id`), kiểm lại theo vai trò ở client; server vẫn là nguồn quyền cuối cùng.
- Polling 4 giây không chồng request, tạm dừng khi tab ẩn; ReplayBoard tách chunk và tải khi mở replay.
- Theme sáng/tối dùng token trong `docs/ui-style/tokens.json`, lưu lựa chọn ở `localStorage`.
- Đã kiểm bằng Edge headless: login render, đăng nhập admin thật, shell + 5 mục điều hướng, không có lỗi console.



## Công việc tiếp theo

### Bổ sung offline và giải nháp — 22/10/2026

- Login có chơi tay offline không tài khoản/API; ba map mẫu và snapshot SVG.
- Tạo giải trống, sửa đội/map sau qua admin API; map_json migration additive.
- data/events/<id> chứa preparation snapshot đội/map riêng, SQLite vẫn authoritative; chưa phải backup.
- Worker MVP chưa hỗ trợ ô cản: server chặn start map có ô cản, không chạy ngầm map khác.
- Xem [bàn giao/chia việc](10-BAN-GIAO-OFFLINE-VA-THU-MUC-GIAI.md) cho giới hạn/tiêu chí Done.

M2: protocol `bot.v1` persistent + SDK Python + Linux supervisor/nsjail/cgroups và host preflight
theo đặc tả mới. Sau đó M3 scheduler/standings/vé, M4 auth/snapshot/GitHub/queue,
M5 UI hai theme/map editor/viewer, M6 offline bundles và M7 diễn tập tải.
Không dùng subprocess legacy để tuyên bố đã đạt sandbox production.

### UI Kit runtime — 22/10/2026

Đã tích hợp component bàn cờ có sẵn, adapter state thật cho chơi tay/replay/map/login, font offline và theme kit.
Build pass; regression 70/70, kit tests 4/4 và adapter tests 5/5 (5 adapter tests đã tính trong 70).
Token generator: 44 cặp màu. Edge smoke: 81 ô, hai theme, setup, move, bàn phím, responsive desktop/mobile.
Chưa nghiệm thu lại P2P hai máy hoặc toàn bộ màn admin/replay bằng trình duyệt.
Xem [bàn giao UI](11-TICH-HOP-UI-KIT.md); đây không phải hoàn tất M2–M7 Campus.

### Map snapshot theo ván — runtime shared (24/10/2026)

- `mvp_matches` có thêm `map_json` + `map_hash` (migration `20261024120000_mvp_match_map_snapshot.sql`);
  `mvp_stage_commit` chặn ván không có snapshot hợp lệ (`bad_game_map`).
- Snapshot chốt lúc lên lịch trận cho cả 30 ván (vòng bảng, bán kết, chung kết); sửa map của giải sau
  đó không làm lệch ván đã tạo. Ván cũ `NULL` dùng map hiện tại của giải.
- `runMatch({ map })` dùng **cùng** `map`/`map_hash` cho setup, move và replay; worker tính lại hash và
  coi snapshot hỏng/lệch hash là lỗi hạ tầng (release lease, không chạy bot) thay vì ghi kết quả.
- Test: `node --test tests/matchMapSnapshot.test.js` 4/4 pass. Xem
  [Supabase database](12-SUPABASE-DATABASE.md) cho chi tiết migration.
- Giới hạn: runner MVP vẫn 200 plies và chưa chạy map có ô cản (`map_runner_unavailable`); 400 plies là
  profile Campus (`CAMPUS_MAX_PLIES`, đã có test riêng).


### GitHub intake H1 — 24/10/2026

- Đã có API thật cho B2: `PUT/GET /api/local/events/:id/repository` (đăng ký/duyệt repo),
  `GET /events/:id/repositories` (admin duyệt), `POST/GET /events/:id/submissions/from-github`
  (yêu cầu đồng bộ + trạng thái mới nhất), `GET /repo-sync-jobs/:id` (owner/admin).
- Migration additive `20261024130000_github_intake.sql` (3 bảng private + 2 RPC) **chưa apply remote**;
  API chỉ resolve repo ID + commit SHA qua `api.github.com`, không clone/tải source/chạy Python.
- Receipt/job view là whitelist (không token/storage path/lease), trạng thái khớp fixtures
  `githubSyncState.js`; ghi `frozen` khi giải đã bắt đầu. Xem [bàn giao Huy](handoff/Huy.md).
- Test: `githubRepo` 5/5, `githubIntakeApi` 6/6, `githubJobs` 5/5, `publication` 9/9, schema guardrail;
  tổng **247/247**, build pass.
- Chưa làm: worker tải blob/validate (H2, Khoa), tắt upload HTTP; Postgres integration trên project thật.

### H3 lịch phát + privacy, H1 worker contract (24/10/2026)

- `mvp_match_broadcasts` + `server/shared/publication.js`: admin đặt/hủy lịch, viewer nhận
  `phase/visible_plies/next_poll_ms` theo giờ server; `release_mode=full` mới mở result/replay.
- `/api/live` **bắt buộc đăng nhập** và chỉ trả ván đã công bố; đội chỉ thấy ván đã mở trong
  `GET /events/:id` (standings/bracket tính lại), replay và log bot bị chặn tới khi mở.
  Ẩn danh nhận `401 login_required`; đội giải khác `403 scope_denied`.
- H1: sửa `previous_valid_submission_id` (dùng `submission_id` của receipt valid) và thêm
  `generation` + `mvp_github_claim/heartbeat/progress/finish/release` với lease token, chống stale worker.
  Client cho Khoa: `server/shared/githubJobs.js`.
- Migration mới: `20261024150000_broadcast_schedule.sql`, `20261024160000_github_jobs_worker.sql`
  (đều **chưa apply remote**). Test: 247/247 pass, build pass; Postgres integration NOT RUN.
- UI Live của Bảo cần xử lý 401 khi chưa đăng nhập và dùng gói phát thay vì đọc trực tiếp event.

### H2 — ACL + đóng cổng upload file (24/10/2026)

- `POST /api/local/submissions/:team` **mặc định trả `403 upload_disabled`** cho cả đội và admin; chỉ admin
  upload được khi `OOTV2_ALLOW_ONLINE_UPLOAD=1` (trusted-dev/import offline). Đội nộp bằng GitHub.
- Thêm `requireEventMember` cho connection/receipt/intake: đội khác giải nhận `403 scope_denied` trước khi
  gọi GitHub/DB (không lộ giải có tồn tại).
- Checklist H2 đạt ở mức mock: receipt whitelist, unique `(event,team,repo_id,sha,path)`, clock DB cho
  cutoff/quota, pending-before-cutoff, giữ bản valid cũ, repo phải BTC duyệt.
- Test: `uploadDisabled` 2/2, `uploadTrustedDev` 1/1; tổng 247/247 pass. Postgres integration NOT RUN.
- UI Bảo: nút "Nộp file USB" chỉ dành admin và cần cờ trên; đội dùng luồng GitHub.


### H2 — contract worker hardening (24/10/2026)

- Migration `20261024170000_github_jobs_hardening.sql` (CHƯA apply): `release` **bắt buộc lease còn hạn**;
  `finish` trả envelope `{applied, already_finished, lease_lost, receipt}` để worker đối soát khi mất
  response/duplicate finish và kiểm submission có sẵn đúng đội/`valid`/`sha256`; `claim` chặn reclaim vô
  hạn khi worker crash (`attempt >= max` → `infra_fault`); thêm `mvp_repo_connection_revoke`.
- Route: `DELETE /events/:id/repository?team=` (admin) thu hồi duyệt → hủy job chờ + receipt `frozen`,
  receipt valid/snapshot đã khóa giữ nguyên; `POST /events/:id/start` trả `409 repo_sync_pending` khi còn
  job intake chưa xong (freeze phải đợi, không chọn HEAD mới).
- Quy tắc cutoff: kiểm bằng `clock_timestamp()` trong transaction; job nhận trước hạn vẫn chấm sau hạn;
  start chọn latest `valid` theo `(created_at desc, id desc)`; lỗi hạ tầng/bot không thay bản valid cũ.
- Test: `githubJobs` 5/5, `githubIntakeApi` 7/7, `supabaseSchema` 9/9; tổng **247/247**, build pass.
- PostgreSQL: script `supabase/tests/github_intake.sql` (BEGIN/ROLLBACK) phủ 2 worker, stale
  token/generation, duplicate finish, crash/retry, cutoff, revoke — **NOT RUN** vì chưa có project test.
- Consumer Khoa (`14ff30b`) chưa có trong repo: contract đã chốt, cần rebase và dùng `githubJobs.js`.


### Tích hợp consumer Khoa (24/10/2026)

- `14ff30b` (opt-in fenced consumer) đã có trên `dev`; Huy nối contract H2: `processGithubJob` coi
  `applied || alreadyFinished` là đã ghi, `leaseLost` → `lease_lost`, còn lại `completion_unknown`;
  comment "release SQL thiếu lease" đã gỡ vì `20261024170000` chặn lease hết hạn.
- `githubConsumer` 12/12, toàn bộ **247/247** pass, build pass. Consumer vẫn `enabled=false`; chưa chạy
  Python/polling, chưa mở Start/deploy.
- PostgreSQL vẫn **NOT RUN**: cần project disposable để chạy `supabase/tests/github_intake.sql` trước khi
  bật consumer thật.
