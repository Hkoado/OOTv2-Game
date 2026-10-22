# Tích hợp component OTT-v2 UI Kit — 22/10/2026

## Nguồn và runtime

Kit bàn giao được đưa vào `src/ui/ott-v2-ui-kit/`: component DOM/React,
CSS/token/generator, atlas PNG, manuscript SVG, font và giấy phép OFL.
Không import catalog, fixtures, showcase hoặc server demo vào ứng dụng.
Không còn phụ thuộc đường dẫn Desktop hoặc thư mục kit ngoài repository.
Token runtime lấy từ kit; `docs/ui-style` là tài liệu phong cách lịch sử.

## Tích hợp

- `src/ui/boardAdapter.js`: chuyển snapshot thật, vùng sân nhà, bases,
  nước hợp lệ, selection và map sang props kit. Bỏ quân chết/chưa xếp.
- `src/ui/GameBoard.jsx`: điểm dùng chung của bàn chơi, replay, map preview,
  và preview đăng nhập (state được tạo bằng engine offline thật).
- `src/components/Board.jsx`: giữ handler xếp/chuyển/nhấc/đi quân hiện có,
  thay grid cũ bằng kit; Xanh xem theo orientation blue.
- Replay chỉ xem, không có callback đi quân. Server ACL không thay đổi.
- Ô cản dùng hình `chasm` (vực) như ký hiệu không thể đi vào. Không thêm
  luật lửa/nước/bụi cây hoặc đổi key rock/paper/scissors.
- Thẻ đội/nút chọn quân offline và phòng cũ dùng wrapper kit.
- Bỏ font CDN; Vite bundle font/atlas nội bộ. CSS ngoài component giữ layout
  sản phẩm, chuyển theme/token, bỏ gradient/shadow của thiết kế trước.

Không xóa engine, sync room, API, worker hoặc code đang sửa của người dùng
theo tuổi commit. Component tương thích cũ được giữ để không phá import;
board/replay production không còn render grid Square/Piece cũ.
Không tự commit, reset hay xóa thư mục kit gốc.

## Kiểm tra

Chạy từ root repository:

```powershell
npm.cmd run build
npm.cmd test
node --test src/ui/ott-v2-ui-kit/board.test.mjs
node src/ui/ott-v2-ui-kit/build-tokens.mjs
node tools/cli/smoke-ui-kit.mjs
```

Smoke script dùng Edge cài sẵn trên Windows, CDP và Node WebSocket, không
thêm dependency. Khởi chạy preview loopback riêng, kiểm đăng nhập render
81 ô, hai theme/font/ảnh, callback xếp quân, setup đủ 18 quân, đi quân,
bàn phím và overflow desktop/mobile. Report/screenshot ở `data/ui-*`.
Không chạy smoke cùng worker E2E: test worker kiểm thư mục data không đổi.
Chưa kiểm lại phòng P2P hai máy, toàn bộ màn admin bằng trình duyệt, hoặc
replay đầy đủ bằng UI trong đợt này; unit/API/engine tests không thay QA đó.