# Local core và bàn giao bốn người

## Phạm vi chạy được

Đợt này là một milestone: tổ chức giải MVP local cho bot nội bộ tin cậy, không phải Campus production.
Một đội một tài khoản; admin cấp tài khoản, team lưu hồ sơ/repo, nộp file fallback, admin chọn đúng 8 đội có bot hợp lệ,
tạo/start giải, worker tuần tự chạy 30 ván, đội xem standings và replay theo vòng đã tham gia.
Password scrypt có salt; session ngẫu nhiên lưu hash, cookie HttpOnly/SameSite strict, CSRF header, giới hạn login.
Logout và reset password thu hồi session. Supabase/GitHub source sync CHƯA kết nối; metadata lưu SQLite local.
Không có sandbox OS, không nhận bot của người lạ, không mở API Internet/LAN.

API legacy không auth bị tắt ở server mặc định; test legacy bật riêng. Tab Giải đấu bot cũ không dùng để vận hành nữa.
Tab Campus UI mở core local mặc định; nút xem bản thiết kế vẫn cho khám phá phần chưa có backend.
Profile MVP: 8 đội, 64 KiB, stateless, 200 plies, 30 ván; không lẫn Campus 400 plies/persistent/map mới.

## Khởi chạy

Từ root `D:\OOTv2-Game`:

```powershell
node tools/cli/create-admin.js
npm.cmd run build
node tools/cli/start-local.js
```

- Trình duyệt: `http://127.0.0.1:3000/` — mở lên luôn là màn hình đăng nhập giải đấu.
- API health: `http://127.0.0.1:3001/api/health`.
- Admin đầu tiên: xem `D:\OOTv2-Game\data\local-admin-credentials.txt`. Không commit/chia sẻ file này.
- Tiến trình/log: `D:\OOTv2-Game\data\local-processes.json`, `local-api.log`, `local-worker.log`, `local-web.log`.
- Không chạy hai worker; launcher từ chối khởi chạy nếu PID cũ còn sống.
- Dừng: kiểm tra PID/name/log trong manifest, rồi dừng đúng tiến trình do launcher tạo bằng Task Manager/Stop-Process.
- Sau sửa code: dừng ba tiến trình, build lại, chạy launcher lại. Không cần tạo lại admin.
- SQLite và bot nằm trong data private; dừng API/worker trước khi sao chép cả thư mục để backup local.

## Demo tổ chức

1. Admin đăng nhập, tạo 8 đội và mật khẩu riêng (>=12 ký tự).
2. BTC bàn giao mật khẩu qua kênh riêng; đội đăng nhập, nhập thành viên/liên hệ/repo.
3. Đội hoặc BTC nộp bot mẫu MVP hoặc bot đã được tin cậy; xem trạng thái valid/invalid.
4. Admin tick 8 đội, đặt tên giải, tạo nháp, bắt đầu. Snapshot được chốt khi start.
5. Giữ worker chạy; bảng cập nhật mỗi 3 giây. Bot mẫu có thể chạy lâu do Python process mỗi lượt.
6. Khi trận xong bấm xem replay. Đội chưa vào knockout không được đọc replay vòng sau.

Localhost chỉ cùng máy, KHÔNG đồng nghĩa các máy khác trong phòng truy cập được.
Muốn chơi tay cùng nhau: dùng chế độ room/spectator hiện có; vẫn cần nghiệm thu PeerJS/playhtml trên mạng thực tế.
Muốn mở server cho máy đội: chưa làm cho bot untrusted; chỉ mở sau sandbox và review bảo mật.

## Chia việc đúng bốn người

| Người | Phạm vi sở hữu | File/thư mục | Dependency và nghiệm thu |
| --- | --- | --- | --- |
| 1 — Backend/dữ liệu | Supabase Postgres migration, adapter repository thay SQLite online, auth hardening, audit, reset password UI | server/services/localAccounts.js, server/routes/localPortal.js, supabase/migrations, server storage adapter | Chốt schema với người 2; không secret trong frontend; test đội A không đọc/sửa B; backup/restore; thu hồi phiên và test tải login |
| 2 — GitHub/runner | Repo private permission, SHA/blob bounded fetch/hash/cache, persistent bot.v1, Linux jail/cgroups và preflight | server/judge, server/services/github, sandbox, runtime/python | Không execute untrusted trước kiểm chứng jail; test timeout/flood/network/filesystem/cleanup; credential không vào bot; cutoff/freeze đúng SHA |
| 3 — Frontend/sản phẩm | Hoàn thiện UI thật thay preview, module repo/sync, map preview/editor, viewer Campus, thông báo/quên mật khẩu/cấp lại tài khoản | src/tournament/portal, ReplayBoard, components | Dùng DTO người 1/2; loading/error/denied, xóa dữ liệu khi logout; kiểm bàn phím/hai theme/viewport, không gọi legacy bypass |
| 4 — Tournament/QA/vận hành | Scheduler Campus 35–50 đội, điểm cặp/knockout/vé, ACL round, offline receipt/bundle, rehearsal và automation | server/services/tournaments, server/worker, tools/cli, tests, docs/runbooks | Người 2 cung cấp runner và snapshot; version legacy riêng; E2E count/seed/retry không tính đôi; lỗi máy không quy đội thua; restore/offline/test tải thật |

Thứ tự tích hợp: schema/DTO → GitHub metadata/fetch → sandbox → snapshot → Campus scheduler → viewer/ACL → offline/rehearsal.
Mỗi PR một milestone, lead review App/config/schema, không merge nhiều người sửa file tích hợp cùng lúc.

## Những gì vẫn phải làm trước mở giải thật

- Thực thi bot lạ: sandbox Linux thật và host preflight, không gọi subprocess là sandbox.
- Supabase online chưa triển khai; service key đã chia sẻ phải thay, chỉ backend nhận key mới qua env.
- GitHub private App/token read-only, sync/quota/cutoff/receipt; hiện tại chỉ lưu URL, chưa kéo code.
- Campus protocol/map/replay và scheduler mới chưa nối vào core này. Không dùng rule MVP làm kết quả Campus.
- Viewer live/events/reconnect, phân quyền mọi artifact, audit/finalize hai người, vé không trùng.
- Admin reset password endpoint/UI đã có; chưa có tự đổi password/team disable.
- Chống đồng thời login/job tốt hơn, session lifecycle, secure cookies/TLS khi deploy thật; hiện cookie cho HTTP loopback.
- Offline bundle/seal/backup consistency, retention, giám sát worker và diễn tập mất máy.
- Kiểm thử trình duyệt thực, multiplayer nhiều máy, load 50 đội, bảo mật dependency và vận hành.

Không tuyên bố hoàn tất production bằng các placeholder còn lại. Dữ liệu test không được seed vào DB vận hành.

## Kết quả kiểm chứng đợt này

- Build Vite thành công, còn cảnh báo chunk >500 KiB.
- Full suite 54/54 pass, gồm test HTTP auth/CSRF/đội chéo/repo/reset/logout và worker hoàn tất 30 ván fixture.
- Đã sửa cô lập OOTV2_DB_PATH của test: trước đó .env trỏ DB chung gây lỗi submission_not_found giữa test process.
- Sửa truy vấn danh sách matches legacy dùng cột m.created_at không tồn tại.
- Đã khởi chạy bản build, API và worker loopback; HTTP smoke health/web/proxy/login/me/logout thành công.
- File admin/.env/PID/log nằm trong vùng gitignored. Không in mật khẩu/secret trong báo cáo.
- Chưa chạy kiểm thử tương tác trình duyệt/screenshot, multiplayer hai máy, tải thực tế hoặc sandbox Linux.