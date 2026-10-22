# ĐỀ XUẤT: HỖ TRỢ BẢN ĐỒ CÓ Ô CẢN (BLOCKED MAPS) CHO WORKER VÀ MATCH RUNNER

> **LƯU Ý QUAN TRỌNG**: Nhánh `Worker-Fix` này được tách ra từ nhánh `Backend` và **CHỈ MANG TÍNH ĐỀ XUẤT (Proposal / Proof-of-Concept)**. Nhánh này không thay thế cấu hình mặc định của phiên bản thi đấu MVP mà cung cấp giải pháp kỹ thuật hoàn chỉnh để hệ thống giải đấu có thể vận hành các bản đồ chiến thuật có ô cản (`twin-gates`, `four-pillars`, v.v.).

---

## 1. Bối cảnh & Vấn đề hiện tại
- **Ở phiên bản MVP gốc**: Hệ thống giải đấu chỉ cho phép chạy các giải với bản đồ mở (`EMPTY_MAP`, `blocked: []`).
- Tại `server/services/tournaments.js`, hàm `startTournament` chủ động chặn các bản đồ có ô cản với mã lỗi `map_runner_unavailable`.
- Match Runner (`server/judge/matchRunner.js`) và Game Adapter (`server/judge/gameAdapter.js`) chỉ chạy luật cờ mặc định mà chưa truyền đối tượng `map` vào hàm `getValidMoves` và `executeMove`.

---

## 2. Các thay đổi đề xuất trong nhánh `Worker-Fix`

### 2.1. Nâng cấp Game Adapter (`server/judge/gameAdapter.js`)
1. **Hỗ trợ `homeSquaresFor(player, map)`**: Tự động loại trừ các ô `blocked` nếu chướng ngại vật nằm trong 28 ô sân nhà của mỗi bên.
2. **Hỗ trợ `validatePlacements(player, placements, map)`**: Bổ sung kiểm tra lỗi `blocked_square` để ngăn bot xếp quân vào các ô cản.
3. **Truyền `map` vào `listAllLegalMoves`**: Chuyển đối tượng `map` xuống `getValidMoves(state.pieces, piece.id, activeMap)` để tính toán chính xác việc chặn di chuyển ngang, dọc, chéo và cắt góc qua ô cản.
4. **Truyền `map` vào `applyValidatedMove`**: Gọi `executeMove(state, player, pieceId, to, activeMap)` để cập nhật trạng thái hợp lệ theo luật cờ OOTv2.

### 2.2. Nâng cấp Match Runner (`server/judge/matchRunner.js`)
1. Nhận tham số `map` (mặc định fallback về `EMPTY_MAP` để tương thích 100% với các trận đấu cũ).
2. Lưu thông tin `map` vào cấu trúc `replay` (bao gồm `id`, `blocked` squares).
3. Truyền `map` xuống từng lượt gọi `setup` và từng lượt đi trong `playLoop`.

### 2.3. Nâng cấp Worker Process (`server/worker.js`)
1. Cập nhật hàm `loadMatch`: JOIN với bảng `tournaments` để đọc `map_json`.
2. Khi thực thi `processOneMatch`: Parse `map_json` của giải và truyền trực tiếp vào `runMatch({ ..., map })`.

### 2.4. Khả năng tương thích ngược & Cờ kích hoạt (`server/services/tournaments.js`)
- Để không phá vỡ kiểm thử MVP và hợp đồng ban đầu, hệ thống giữ nguyên hành vi trả về lỗi `map_runner_unavailable` khi chưa bật tính năng đề xuất.
- Khi cần kích hoạt hỗ trợ ô cản cho giải đấu thực tế, quản trị viên có thể bật biến môi trường `OOTV2_ALLOW_BLOCKED_MAPS=1`.

---

## 3. Kết quả kiểm thử trên nhánh `Worker-Fix`
- Đã bổ sung bộ kiểm thử `tests/workerMapSupport.test.js`:
  - **Test 1**: Chạy trận đấu thực tế giữa 2 bot mẫu trên bản đồ có ô cản `twin-gates` (`['e4', 'e6']`). Kết quả: trận đấu diễn ra thông suốt, không lỗi, replay lưu đầy đủ thông tin ô cản.
  - **Test 2**: Bắt đầu giải đấu 8 đội với bản đồ `four-pillars` (`['d4', 'f4', 'd6', 'f6']`) và cho Worker chấm ván thành công.
- Kiểm thử hồi quy: `tests/localPortal.test.js` và `tests/gitSync.test.js` tiếp tục pass 100%.

