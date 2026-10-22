# Trạng thái triển khai Campus — 22/10/2026

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
