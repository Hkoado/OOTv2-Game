# Sổ Tay Vận Hành Dành Cho Ban Tổ Chức (OOTv2 Tournament Operator Runbook)

Tài liệu quy trình vận hành kỹ thuật dành cho Ban tổ chức (BTC), Trọng tài và Quản trị viên hệ thống Giải Đấu Cờ OOTv2 Campus.

---

## 1. Thiết lập giải đấu chính thức (Setup Panel)

Truy cập trang Cấu hình (`#/setup`) bằng tài khoản Quản trị viên (`admin`):

1. **Khung thời gian & Múi giờ**:
   - Nhập thời điểm bắt đầu giải và hạn chót nộp bài (`Cutoff`).
   - Giao diện hỗ trợ chuyển đổi 2 chiều: múi giờ địa phương (trình duyệt) và chuẩn UTC ISO string. Đảm bảo thông báo rõ giờ thi đấu theo giờ Việt Nam (UTC+7).
2. **Chia bảng đấu động A–H (35–50 đội)**:
   - Chọn thể thức chia từ 4 đến 8 bảng đấu (A đến H).
   - Kiểm tra thông báo cân bằng bảng (`formatGroupSummary`): nếu chênh lệch giữa bảng nhiều nhất và ít nhất lớn hơn 1 đội, hệ thống sẽ phát cảnh báo để BTC điều chỉnh số hạt giống.
3. **Cơ chế bảo vệ bản nháp (Dirty Draft Protection)**:
   - Trong khi BTC đang chỉnh sửa form, polling nền tự động tạm dừng để tránh ghi đè dữ liệu.
   - Nếu có quản trị viên khác vừa lưu thay đổi trên server, hệ thống sẽ bật cảnh báo xung đột phiên bản (`Version Conflict`). BTC bấm "Tải lại dữ liệu" sau khi xác nhận để đồng bộ.
4. **Chốt an toàn Execution Ready**:
   - Thuộc tính `executionReady` luôn giữ giá trị `false` trong giai đoạn thiết lập cho đến khi toàn bộ worker và sandbox được nghiệm thu sẵn sàng.

---

## 2. Quản lý & Phê duyệt Kho mã GitHub

1. Truy cập trang **Nộp bài** (`#/submissions`) bằng tài khoản Admin.
2. Chọn đội cần thao tác từ bộ lọc **Chọn đội thi đấu**.
3. **Tiêu chí duyệt**:
   - URL repository đúng định dạng HTTPS GitHub công khai (`https://github.com/owner/repo`).
   - Nhánh thi đấu chính xác (`main` hoặc `master`).
   - Mỗi repository chỉ được đại diện cho một đội duy nhất trong cùng một giải đấu.
4. **Phê duyệt**: Bấm nút **"Phê duyệt repository này"** để cấp quyền đồng bộ commit cho đội.
5. **Thu hồi phê duyệt (Admin Revoke)**:
   - Nếu phát hiện đội vi phạm quy chế hoặc đội yêu cầu đổi repository khác trước hạn cutoff, Admin bấm **"Thu hồi phê duyệt"**.
   - Hệ thống sẽ gọi lệnh hủy duyệt (`DELETE /api/local/events/:id/repository?team=...`), tự động hủy mọi job đang xếp hàng (`canceled`) và đóng băng thẻ biên nhận đang xử lý dở dang (`frozen: repository_revoked`). Bản bot hợp lệ trước đó vẫn được giữ nguyên an toàn.

---

## 3. Lên lịch phát sóng ván đấu (Broadcast Scheduling)

Hệ thống áp dụng nguyên tắc **Chấm trước — Lưu kín — Phát theo lịch** (H3 publication architecture):

1. **Thời điểm đặt lịch**: Chỉ những ván đấu đã chấm xong hoàn tất (`status === 'finished'`) mới được đặt lịch phát. Ván chưa chấm xong sẽ bị hệ thống từ chối (`409 match_not_graded`).
2. **Thao tác đặt lịch**:
   - Trên bảng ván đấu (`MatchTable`), tìm ván cần phát và bấm **"Đặt lịch"**.
   - Hộp thoại `BroadcastDialog` mở ra:
     - **Thời điểm bắt đầu phát (`starts_at`)**: Chọn ngày giờ bắt đầu chiếu trực tiếp.
     - **Nhịp phát (`ply_interval_ms`)**: Chọn từ $250\text{ ms}$ đến $60,000\text{ ms}$ (mặc định $2,000\text{ ms}$ / nước đi).
     - **Chế độ công bố (`release_mode`)**:
       - `full`: Sau khi phát hết toàn bộ nước đi, server sẽ tự động công bố kết quả chung cuộc, vinh danh đội thắng và mở link xem lại replay.
       - `window`: Sau khi chiếu hết, kết quả vẫn được bảo mật (dành cho các vòng đấu loại trực tiếp cần bảo mật điểm số đến lễ bế mạc).
3. **Hủy lịch phát**:
   - Nếu cần hoãn hoặc đổi giờ, BTC có thể bấm nút **"Hủy lịch"** trước thời điểm `starts_at`.
   - Nếu ván đấu đã bắt đầu phát sóng (`broadcasting`), hệ thống sẽ khóa nút hủy (`409 broadcast_started`) để bảo đảm tính toàn vẹn của luồng xem trực tiếp.

---

## 4. Quản lý Trang Trực Tiếp (Live Stream Page)

Trang `#/live` phục vụ các đội thi và khán giả có tài khoản trong giải:

- **Bảo mật thành viên (H3 Privacy)**: Chỉ tài khoản thành viên thuộc giải đấu mới được cấp quyền xem ván đấu (`assertEventMember`). Người xem ẩn danh hoặc xem chéo giải khác sẽ nhận thông báo yêu cầu đăng nhập (401) hoặc từ chối quyền truy cập (403).
- **Trạng thái Chờ (`waiting`)**: Hiển thị thẻ Countdown đếm ngược chính xác theo giờ server tới mốc giờ phát sóng.
- **Trạng thái Đang phát (`broadcasting`)**: Client nhận các nước đi gia tăng giới hạn bởi `visible_plies` từ máy chủ theo đúng nhịp đồng hồ, tuyệt đối không tải trước toàn bộ replay để bảo vệ nước đi tương lai.
- **Tiến độ**: Thanh tiến độ hiển thị trực quan tỷ lệ % số nước cờ đã chiếu trên tổng số nước cờ của ván đấu.

---

## 5. Kế hoạch ứng cứu & Khôi phục sự cố khẩn cấp (Incident Response)

### A. Mất kết nối Internet diện rộng tại phòng thi
- Kích hoạt chế độ **Offline Fallback**:
  - Đội thi chép file `bot.py` qua USB.
  - Quản trị viên kích hoạt cờ môi trường `OOTV2_ALLOW_ONLINE_UPLOAD=1` trên máy chủ cục bộ và sử dụng cổng USB nạp bài tại `#/submissions`.
  - Giám sát kích thước file $\le 256\text{ KiB}$ và kiểm tra bảng mã UTF-8.

### B. Worker gặp sự cố khi đang chấm
- Các ván đấu bị gián đoạn do lỗi hạ tầng (`infrastructure_fault`) không bao giờ tự động xử thua bot thí sinh.
- Kiểm tra trạng thái worker tại bảng trạng thái `worker_state`. Khởi động lại worker bằng lệnh:
  ```bash
  npm run start:worker
  ```

### C. Khôi phục ván đấu đấu tay / 2 máy (Spectator Recovery)
- Chế độ phòng chơi đối kháng 2 người qua WebRTC/PeerJS (`usePlayRoom.js`) luôn sẵn sàng độc lập với tournament backend, cho phép trọng tài tổ chức đánh lại ván đấu trực tiếp giữa 2 máy thí sinh khi hệ thống tự động gặp sự cố bất khả kháng.

