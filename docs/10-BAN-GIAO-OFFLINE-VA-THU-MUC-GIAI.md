# Bàn giao: chơi offline và thư mục giải

Ngày 22/10/2026. Milestone chuẩn bị giải local và chơi thử không đăng nhập.
Không phải nghiệm thu toàn bộ Campus hoặc điều kiện mở nhận bot công khai.

## Đã triển khai

- Login có Chơi offline: hai người cùng máy, không tài khoản/API/Python.
- Đỏ xếp trước, Xanh thấy Đỏ; chọn/đổi/nhấc quân, xếp nhanh xác định, xác nhận đủ 9 quân.
- Tái sử dụng bàn OTT-v2 và constants/rules/executeMove; không thay room sync.
- Offline: ô cản/cắt góc theo rules; hết nước thua, lặp thế 3 lần/400 nước hòa.
- Ba map mẫu: open-arena, twin-gates, four-pillars; JSON ở examples/maps.
- Màn đăng nhập dùng bàn cờ component runtime và asset `public/logo.png`; không
  giữ snapshot hình tĩnh trong `public/`.
- Admin tạo giải chỉ cần tên; thêm/bỏ tối đa 8 đội sau, chọn map mẫu hoặc nhập map.v1 JSON.
- Server kiểm quyền admin/CSRF, map, đội trùng/không tồn tại và trạng thái draft.
- Start cần đủ 8 đội có bot hợp lệ; sau start khóa đội/map, giữ lịch MVP 24+4+2.
- Nút chính màu thành công, lưu/offline màu thông tin, nguy hiểm màu danger theo token.
- Rút gọn login và tạo giải; không còn bắt chọn đủ 8 đội khi tạo.

## Dữ liệu mỗi giải và migration

```text
data/events/<uuid-server>/
  event.json
  maps/selected.json
  teams/roster.json
```

Tên giải chỉ là label, không đưa vào đường dẫn. Không xuất mật khẩu/token/source bot.
SQLite vẫn authoritative. Thư mục là preparation snapshot có thể tái tạo, ghi khi tạo/lưu/start;
không tự cập nhật kết quả khi worker tiến vòng và không dùng một mình để restore giải.
Ghi file qua temporary + rename, nhưng DB và filesystem chưa có transaction chung.
Không sửa JSON trực tiếp để đổi API. Nếu filesystem lỗi, kiểm DB rồi tái xuất qua lưu draft;
chưa có CLI reconcile. Không serve data/events như static/public.

initDb thêm tournaments.map_json nếu thiếu; giải cũ NULL dùng open-arena.
Create nhận 0–8 đội; điều kiện đủ đội/bot chuyển sang start.
PUT /api/local/events/:id thay roster/map trong transaction khi draft; đã chạy trả 409.

## Giới hạn quan trọng

- Worker vẫn MVP stateless, 64 KiB/200 plies; chưa chạy map có ô cản.
  Map có ô cản lưu/preview/offline được nhưng start trả map_runner_unavailable.
  Chọn open-arena để demo giải MVP. Không chạy ngầm map khác.
- Offline chỉ chơi tay cùng máy, không AI/Python, không kết quả giải chính thức.
  Chưa có lưu/tiếp tục sau refresh, undo, import/export replay.
- Chưa có service worker/PWA: cần tải app từ localhost; không hứa mở URL mới khi server tắt.
- Campus M1 chưa nối runner/protocol/scheduler mới. Chỉ local/trusted; subprocess không phải sandbox.

## Chia việc tiếp theo

| Người/nhóm | Việc | Phụ thuộc | Done |
| --- | --- | --- | --- |
| A — runner | M2 bot.v1 persistent, Python SDK, Linux nsjail/cgroups/preflight | Campus M1 | Fault đúng bên, CPU/RAM/timeout/output/process tree; test mã phá trong VM sạch |
| B — backend giải | Map snapshot cho từng game/attempt; scheduler 35–50 đội, tuần/tháng/kỳ, cutoff | A + docs 01/03 | Hash map xuyên setup/move/replay; 400 plies; test 35/40/48/50, tie/bye/retry không tính đôi |
| C — UI | Folder tabs Đội/Map/Lịch/Kết quả, map editor/version/publish, readiness từng lỗi | Contract B | Không mất draft do polling; freeze bất biến; mobile/bàn phím/light/dark; không thao tác giả |
| D — GitHub/auth | SHA/cache/quota/cutoff receipt, role/round ACL, rotation Supabase key | A trước khi chạy bot lạ | SHA idempotent; mọi endpoint kiểm round; test IDOR/cache/logout; không leak token/source |
| D — ops | Bundle manifest bot/map/runtime pin, SQLite WAL backup/restore, reconcile folder | B | Restore máy dự phòng, mất điện, import hai lần; không nhầm snapshot hiện tại với backup |
| QA phối hợp | E2E đội/admin, room 2 máy/spectator, USB offline, load 50 đội | Luồng tương ứng | Báo pass/fail thật + screenshot; P95/CPU/RAM/disk; ghi blocker thay vì suy từ unit test |

Ưu tiên A → B; C và GitHub metadata làm song song theo contract, không bật chạy bot công khai.
Supabase key rotation cần người quản trị thực hiện, không ghi key vào repo/handoff.

## Chạy và demo

```powershell
npm.cmd run build
npm.cmd test
node tools/cli/start-local.js
```

Launcher từ chối khi PID cũ còn chạy: kiểm data/local-processes.json, dừng đúng process repo,
không bật worker thứ hai. localhost:3000 → Chơi offline → chọn map → xếp/đi.
Admin → Giải đấu → tạo bằng tên → mở → lưu đội/map → đủ điều kiện mới bắt đầu.

## Tham khảo tổ chức UI

## Kết quả kiểm chứng đợt này

- npm test: **65/65 pass**, không skip; gồm worker hoàn tất giải MVP 30 ván, API/admin/CSRF/freeze và offline/map.
- npm run build: thành công; kiểm tra git diff --check không có lỗi whitespace.
- Edge headless: login bàn runtime, 81 ô, xếp hai bên/đi một nước khi network bị chặn, mobile 390px không tràn ngang, không exception JS.
- Ảnh kiểm tra local: data/screenshots/login.png, offline-light.png, offline-mobile.png (gitignored).
- Chưa nghiệm thu thao tác trình duyệt admin/đội trên bản mới, cả hai theme, map editor/import qua trình duyệt,
  room hai máy/spectator, sandbox Linux hoặc load/offline bundle. Test API không thay cho các kiểm tra này.

### Nguồn tham khảo

Chess.com Help Center: “How do I invite people to my Live tournament?” (article 8705938),
“How do I create a Daily tournament?” (article 8598292). Tham khảo tạo giải trước/mời sau,
phân tách chuẩn bị/đăng ký/bắt đầu; không sao chép luật cờ vua hoặc asset.