# Sổ Tay Hướng Dẫn Sinh Viên / Đội Thi (OOTv2 Tournament)

Tài liệu hướng dẫn dành cho các đội tham gia Giải Đấu Cờ OOTv2 Campus. Hướng dẫn quy trình chuẩn bị mã nguồn bot, khai báo repository GitHub, đồng bộ bài nộp, kiểm tra biên nhận (receipt) và xử lý sự cố.

---

## 1. Quy chuẩn mã nguồn Bot

Mỗi đội thi đấu phát triển một thuật toán bot bằng ngôn ngữ **Python 3** tuân thủ các quy tắc nghiêm ngặt sau:

- **Tên file & Vị trí**: Duy nhất một file tên là **`bot.py`** đặt ngay tại **thư mục gốc** (root directory) của repository. Không chấp nhận file đặt trong thư mục con, file nén ZIP, tarball hay package.
- **Dung lượng tối đa**: Không vượt quá **256 KiB** ($262,144\text{ bytes}$).
- **Bảng mã**: Định dạng văn bản UTF-8 hợp lệ, không chứa ký tự binary, không dùng BOM (`\ufeff`).
- **Thư viện**: Chỉ sử dụng thư viện chuẩn của Python (`sys`, `json`, `math`, `random`, v.v.). **Tuyệt đối không sử dụng thư viện ngoài** (`numpy`, `torch`, `pip install`, v.v.).
- **Giao thức Standard I/O (JSON Line)**:
  - Nhận yêu cầu từ `sys.stdin` (1 dòng JSON kết thúc bằng `\n`).
  - Xuất phản hồi ra `sys.stdout` (đúng 1 dòng JSON kết thúc bằng `\n` và `sys.stdout.flush()`).
  - Không in rác debug ra `sys.stdout` (sử dụng `sys.stderr` cho log debug nếu cần).

---

## 2. Khai báo Repository trên Cổng giải đấu

1. Tạo một repository công khai (**Public**) trên GitHub, ví dụ: `https://github.com/team-alpha/ootv2-bot`.
2. Đẩy file `bot.py` lên nhánh thi đấu chính (thường là `main`).
3. Đăng nhập vào Cổng giải đấu OOTv2 (`#/overview`) bằng tài khoản đội do Ban tổ chức cấp.
4. Truy cập trang **Nộp bài** (`#/submissions`).
5. Nhập URL HTTPS của repository và tên nhánh:
   - Ví dụ: `https://github.com/team-alpha/ootv2-bot`, nhánh: `main`.
   - Bấm **"Lưu cấu hình GitHub"**.
6. **Chờ Ban tổ chức duyệt**:
   - Trạng thái ban đầu sẽ là **`Chờ BTC duyệt`** (`pending_approval`).
   - Sau khi Ban tổ chức xác nhận tính hợp lệ của repository, trạng thái chuyển sang **`Đã được duyệt`** (`approved`). Bạn mới có thể gửi yêu cầu đồng bộ commit.

> [!IMPORTANT]
> Cổng giải đấu chỉ lưu trữ metadata công khai (URL repo và tên nhánh). Hệ thống không yêu cầu và tuyệt đối không bao giờ hỏi mã khóa cá nhân (Personal Access Token - PAT) của bạn.

---

## 3. Quy trình nộp bài & Đồng bộ Commit

Mỗi khi đội đẩy commit mới lên GitHub, thực hiện đồng bộ như sau:

1. Đảm bảo commit đã được đẩy lên GitHub thành công.
2. Tại trang **Nộp bài** (`#/submissions`), bấm nút **"Đồng bộ commit mới từ GitHub"**.
3. Cổng giải đấu sẽ gửi yêu cầu và nhận mã biên nhận tiếp nhận (HTTP 202 Accepted).
4. Hệ thống tự động kích hoạt tiến trình kiểm tra (Polling Job) theo 4 bước:
   - `resolving`: Xác định commit SHA mới nhất trên nhánh.
   - `fetching`: Tải nội dung file `bot.py` tương ứng với commit SHA.
   - `checking`: Kiểm tra dung lượng $\le 256\text{ KiB}$, bảng mã UTF-8 và smoke test cú pháp.
   - `valid` / `invalid`: Ghi nhận kết quả kiểm tra.

---

## 4. Đọc Thẻ Biên Nhận (Receipt Card) & Tra Cứu Lỗi

Khi hoàn tất, thẻ Biên nhận sẽ hiển thị chi tiết:

- **Mã Commit SHA**: Hiển thị 7 ký tự đầu (ví dụ: `a1b2c3d`) kèm mã đầy đủ 40 hex để đối chiếu lịch sử `git log`.
- **Thời điểm chốt nhận**: Mốc thời gian chính xác server ghi nhận bài thi.
- **Trạng thái**:
  - `valid` (Màu xanh): Bot hợp lệ và đã sẵn sàng làm ứng viên thi đấu cho vòng đấu.
  - `invalid` (Màu đỏ): Bot bị lỗi mã nguồn. Thí sinh cần sửa code và commit lại.
  - `infrastructure` (Màu vàng/đỏ): Sự cố kết nối hoặc lỗi hạ tầng của server. Bản bot hợp lệ trước đó (nếu có) vẫn được bảo toàn nguyên vẹn, **không bị tính là lỗi của đội**.
  - `frozen` (Màu xám): Giải đấu đã bắt đầu hoặc đã qua hạn chót (Cutoff). Không thể cập nhật thêm commit mới.

### Bảng tra cứu mã lỗi thường gặp

| Mã lỗi | Ý nghĩa | Cách khắc phục |
| :--- | :--- | :--- |
| `repo_not_approved` | Repo chưa được Ban tổ chức phê duyệt. | Liên hệ Ban tổ chức / giám thị phòng thi để được duyệt repo. |
| `past_cutoff` | Đã quá hạn chót nộp bài của giải. | Hệ thống đã khóa nộp bài; liên hệ Ban tổ chức nếu có sự cố bất khả kháng. |
| `quota_exceeded` | Vượt quá số lần yêu cầu đồng bộ trong ngày. | Chờ hết thời gian giới hạn tần suất (rate limit) trước khi thử lại. |
| `invalid_file_size` | File `bot.py` vượt quá 256 KiB. | Tối ưu mã nguồn, xóa bỏ dữ liệu tĩnh hoặc bảng tra cứu quá lớn trong file. |
| `syntax_error` | Lỗi cú pháp Python khi biên dịch. | Chạy thử `python -m py_compile bot.py` trên máy cá nhân trước khi commit. |

---

## 5. Quy trình nộp USB dự phòng tại phòng thi (Offline Fallback)

Trong trường hợp mất kết nối Internet hoặc sự cố GitHub diện rộng tại địa điểm thi đấu:

1. Chép duy nhất một file `bot.py` vào thư mục gốc của USB được giám thị kiểm tra.
2. Báo cáo với Giám thị / Ban tổ chức tại phòng thi.
3. Ban tổ chức sử dụng quyền Quản trị viên để nạp trực tiếp file `bot.py` qua cổng USB Fallback trên Cổng giải đấu.
4. Giám thị và đội thi cùng ký biên bản xác nhận mốc thời gian và mã băm SHA256 của file nộp.

---

## 6. Theo dõi Kết Quả & Xem Trực Tiếp Vòng Đấu Chính Thức

Sau khi Ban tổ chức kích hoạt vòng đấu chính thức, các đội thi có thể theo dõi tiến độ và kết quả trực tiếp từ giao diện:

1. **Bảng xếp hạng (Standings)**:
   - Hiển thị đầy đủ số trận thắng, hòa, thua, điểm số và hiệu số đối đầu theo từng bảng.
   - Nếu vòng đấu đang diễn ra hoặc chưa công bố, hệ thống sẽ thông báo *"Bảng xếp hạng vòng đấu chưa được công bố"*.

2. **Nhánh thi đấu Knockout & Vé Chung kết**:
   - Thí sinh theo dõi các cặp đấu vòng loại trực tiếp và tiến trình từng trận.
   - Thẻ Vé Chung kết (`Tickets`) phân định rõ:
     - **Vé chính thức (`awarded`)**: Các đội đủ điều kiện vào vòng chung kết kèm hạt giống (`seed`).
     - **Vé dự bị (`reserves`)**: Đội xếp thứ tự ưu tiên tiếp theo khi có đội bỏ cuộc hoặc phạm quy.
     - **Suất trống (`vacant`)**: Số suất còn trống nếu vòng đấu chưa đủ điều kiện phân bổ.

3. **Xem trực tiếp diễn biến ván đấu (Official Game Viewer)**:
   - Tại tab *Trực tiếp & Phát sóng*, chọn nút **"Xem luồng"** tại ván đấu mong muốn.
   - Hệ thống phát lại luồng trận đấu theo thời gian thực đồng bộ từ server (`server_time`), hiển thị từng nước đi (`plies`) theo nhịp phát sóng đã định.
   - Kết quả ván đấu chỉ được hé lộ khi ván đấu hoàn tất chu kỳ phát sóng (`reveal_result = true`). Thí sinh không thể tải trước replay để biết trước kết quả.


