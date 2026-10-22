# Brief dùng với repo OOTv2-Game đã có

Đây là prompt giao việc về sau. Bộ docs không tự yêu cầu agent thực thi tất cả milestone hoặc publish. Thay `[MILESTONE]` bằng nhiệm vụ cụ thể trước gửi.

---

Hãy thực hiện **[MILESTONE]** trong repository OOTv2-Game hiện có, phát triển tiếp `tournament/initial` theo quy ước nhóm và AGENTS.md. Kiểm tra nhánh/status, giữ thay đổi người dùng; không tạo app thay thế, đổi framework hoặc chép code từ demo-ui.

Đọc:

1. AGENTS.md, README, docs/code/test MVP thực tế trong repo.
2. `docs/README.md`, `docs/00-TOM-TAT-DOC-NHANH.md`.
3. `docs/01-THE-THUC-GIAI.md`, `docs/03-DAC-TA-KY-THUAT.md`, `docs/04-HUONG-DAN-AGENT-CODE.md`.
4. `docs/05-TICH-HOP-UI-VA-REPO.md`.
5. `docs/ui-style/UI-GUIDE.md`, `ASSET-GUIDE.md`, `tokens.json`, `build-tokens.mjs` và `references/README.md`.
6. `docs/06-GITHUB-NOP-BOT-VA-LUU-TRU.md`: online tự sync repo đã đăng ký, SHA trước cutoff, cache tạm, UI kết nối/cập nhật/trạng thái. Không thay bằng upload bắt buộc; offline chuẩn bị source trước ngắt mạng.

## Phạm vi cố định

- Giữ React/Vite/JavaScript ESM/Express/SQLite và các chế độ chơi tay/room/spectator. UI tournament có thể thay phong cách, không thay luật qua hình minh họa.
- Dùng giấy da light/hầm ngục dark, hình 2D phẳng, nét mực rõ, tiêu đề serif và nội dung sans tiếng Việt. Không copy layout demo; thiết kế cấu trúc theo tác vụ.
- Giữ key luật rock/paper/scissors; hình đá/thuyền/song kiếm chỉ mapping hình. Terrain v1 chỉ ô cản; lửa/nước/bụi cây trong reference không cấp luật mới.
- Giải tuần/tháng/kỳ, map chính/dự phòng công bố từ trước. Offline phát bot cũ, dùng nguyên/sửa/thay trước cutoff, không bắt viết lại. Offline không mạng, thu USB, chỉ BTC xem trên localhost.
- Online đội chỉ xem trận thuộc round mình tham gia, kể cả replay; API/state/event/file đều kiểm quyền. Snapshot+event từ server dựng viewer readonly; không chạy bot mới cho mỗi viewer, không dùng UI chấm thắng.
- Giữ giới hạn sandbox/production trong AGENTS và file 03/04; thiếu backend thì nêu trạng thái chưa hỗ trợ, không fake workflow thành công.

## Cách tích hợp

`tokens.json` là nguồn duy nhất. Chạy `node docs/ui-style/build-tokens.mjs`, dùng CSS sinh ra, không sửa CSS/report bằng tay hoặc duy trì bảng màu thứ hai. Import token một lần từ entry tournament và scope style trong `.ott-tournament`, theo file05. Kiểm cascade CSS cũ, portal, stacking context, root color-scheme và compatibility game cũ.

Font-family đã khai báo nhưng kit chưa chứa font binaries; self-host đủ tiếng Việt/license khi bổ sung, fallback khi thiếu. Không thêm font/CDN mạng cho offline. Reference là hình phong cách, không atlas runtime có sẵn; không đưa cả demo/assets hoặc logic demo vào app.

Trước code ghi ngắn tác vụ, thứ tự thông tin và cấu trúc chọn. Tiếp tục làm milestone đã giao, không tự tạo vòng xin duyệt layout. Không mở thêm scope backend/asset generation/publish nếu không được giao.

## Bàn giao

Nêu màn hình/hành vi đã làm, file chính và lý do bố cục phục vụ tác vụ; kiểm token/build/chức năng thật, light/dark ở 1280×720 và 1366×768, focus/tiếng Việt/assets/overflow. Có screenshot thực khi đã render. Liệt kê thiếu backend/Linux/offline nào và test chưa chạy; không dùng mock/contrast report để khẳng định UI production hoàn tất.

Làm đúng một milestone, báo kết quả và dependency tiếp theo theo quy ước AGENTS.md. Không publish/force push/xóa dữ liệu thật hoặc đổi luật ngoài yêu cầu.

---
