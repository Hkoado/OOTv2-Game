# OTTv2 — Thể thức và luồng tham gia trong 3 phút

**Ý tưởng:** sinh viên lập đội, viết bot Python để đấu tự động. Trong tuần luyện và nộp bài online; cuối tuần các đội vượt vòng loại đến thi offline. Thành tích tuần cấp vé tháng, thành tích tháng cấp vé kỳ.

**Quy mô:** khoảng 100 sinh viên → đội 2–3 người → 35–50 bot. Đây là bản tóm tắt **phương án đề xuất**, chưa phải điều lệ đã công bố. Map được công bố trước; offline đội nhận lại bot cũ và tự do dùng/sửa, không phải viết lại từ đầu. Các mốc thời gian chuẩn bị cần BTC chốt trước giải.

## 1. Chơi gì, thắng thế nào?

| Nội dung | Luật chính |
| --- | --- |
| Bàn và quân | Bàn 9×9; mỗi bên có 9 quân: 3 Búa, 3 Bao, 3 Kéo |
| Xếp quân | Đỏ xếp trước trong sân mình; Xanh xếp sau và nhìn thấy quân Đỏ |
| Di chuyển | Đỏ đi trước; mỗi lượt đi một quân, tối đa một ô theo 8 hướng |
| Ăn quân | Búa ăn Kéo, Kéo ăn Bao, Bao ăn Búa; không vào ô quân cùng phe, quân địch cùng loại hoặc mạnh hơn |
| Thắng | Đến nhà chính đối phương, ăn hết một loại quân đối phương, hoặc khiến đối phương không còn nước đi |
| Hòa | Lặp trạng thái bàn và bên đến lượt lần thứ ba, hoặc đủ 400 nước đi mà chưa có bên thắng |
| Map | BTC thay bố trí ô cản; bot phải đọc map được cấp. Ô cản không được đặt quân hoặc đi vào |

**Một ván** là một lần hai bot đấu trên bàn. **Một cặp đấu** gồm nhiều ván đổi màu Đỏ/Xanh để cân bằng lợi thế xếp quân và đi trước.

## 2. Giải đi từ tuần đến kỳ như thế nào?

| Cấp giải | Cách chọn đội | Chung kết offline | Vé lên cấp tiếp theo |
| --- | --- | --- | --- |
| Tuần | 35–50 đội chia 8 bảng online, vòng tròn, lấy 2 đội/bảng | Top 16 loại trực tiếp, có tranh ba | 2 vé tháng/tuần |
| Tháng | Nhận vé từ 4 tuần | Top 8 loại trực tiếp, có tranh ba | 2 vé kỳ/tháng |
| Kỳ | Nhận vé từ 4 tháng thi đấu | Top 8 loại trực tiếp, có tranh ba | Xác định vô địch kỳ |

Số tuần/tháng và tháng/kỳ là cấu hình lịch giải, có thể điều chỉnh theo lịch trường. Nếu ít đội hơn, thu gọn vòng bảng và số đội chung kết theo điều lệ.

- **Vòng bảng:** mỗi cặp 2 ván đổi màu. Điểm ván thắng/hòa/thua = 1/0,5/0; thắng tổng điểm cặp được 3 điểm bảng, hòa được 1, thua 0.
- **Loại trực tiếp:** mỗi cặp 4 ván; trận tranh nhất 6 ván. Hòa thì thêm 2 ván đổi màu; vẫn hòa thì đội có thứ tự hạt giống tốt hơn đi tiếp. Thứ tự này được xác định trước chung kết.
- **Vé không trùng:** đội đã có vé vẫn được thi và giành danh hiệu; vé mới chuyển xuống đội có thứ hạng cao nhất chưa có vé ở cấp đó.

## 3. Luồng của người chơi

**Lập đội → nhận tài khoản → viết và luyện bot → nộp bài → đấu vòng loại → chung kết offline → nhận danh hiệu/vé → tiếp tục tháng/kỳ.**

| Bước | Đội thi làm gì? |
| --- | --- |
| 1. Đăng ký | Lập đội 2–3 người, xác nhận thành viên và nhận tài khoản đội |
| 2. Chuẩn bị | Đọc luật/API, lấy bot mẫu và map luyện tập; viết một file `bot.py` bằng Python, chỉ dùng thư viện chuẩn |
| 3. Luyện và nộp | Push `bot.py` lên repo GitHub đã đăng ký; hệ thống tự lấy/check. Kiểm tra SHA được BTC xác nhận và bản hợp lệ trước hạn; push chưa sync chưa là bài đã nhận. Lịch mẫu: thứ Sáu 20:00 khóa bài |
| 4. Vòng loại | Hệ thống tự chạy bot đã khóa; đội xem bảng điểm, xem lại trận và khiếu nại nếu có lỗi |
| 5. Đến chung kết | Nếu đủ điều kiện, đến địa điểm thi; được phát lại bot cũ của **chính đội mình** và map đã công bố từ trước |
| 6. Chuẩn bị offline | Máy thi không có mạng. Đội được dùng nguyên bản, sao chép, sửa, thử hoặc thay bot theo ý muốn trước hạn; đề xuất 30 phút kiểm tra/chỉnh đầu buổi |
| 7. Thi từng vòng | Xác nhận map đã công bố → có **15 phút chỉnh bot** theo lịch chung → nộp và khóa bài → bot tự đấu. Không sửa bài dùng cho vòng đang chạy, kể cả ván phụ |
| 8. Đi tiếp | Thắng thì sang vòng mới và có cửa sổ chỉnh bot mới; đạt thứ hạng đủ điều kiện thì nhận vé tháng/kỳ |

Tuần/tháng/kỳ đều áp dụng cách nhận lại và dùng/sửa bot cũ. Code phải được lấy về **trước khi ngắt mạng**; không pull GitHub trong giờ thi. **Online:** đội được xem trực tiếp/xem lại tất cả trận thuộc vòng mình tham gia. **Offline:** chỉ BTC cần xem trên máy BTC; máy đội không cần kết nối hoặc xem trận.

## 4. Luồng của admin/BTC

**Tạo giải → chuẩn bị map và máy → mở đăng ký/nộp bài → khóa và chấm vòng loại → tổ chức offline → xác nhận kết quả → cấp vé, lưu và công bố.**

| Giai đoạn | Admin/BTC làm gì? |
| --- | --- |
| Trước giải | Tạo lịch/giải, duyệt đội; kiểm tra và công bố đầy đủ map chính/map dự phòng trước cutoff; kiểm tra máy chấm và máy dự phòng |
| Trong tuần | Cấp tài khoản, tài liệu/bot mẫu; theo dõi bài nộp, hỗ trợ lỗi giao thức và luyện tập |
| Khóa vòng loại | Chốt bản hợp lệ nhận trước hạn; bốc thăm bảng; cho hệ thống chạy, kiểm tra lỗi và công bố kết quả tạm |
| Trước offline | Giải quyết khiếu nại, xác nhận đội dự thi; chuẩn bị riêng code tham khảo từng đội, máy sạch, tài liệu offline và phương tiện thu bài |
| Đầu buổi thi | Phát đúng bot cũ cho đội, ngắt mạng; cho dùng/sửa/thử bot và kiểm tra bài nộp |
| Trước mỗi vòng | Khóa nhánh đấu, xác nhận map đã công bố; cho cùng 15 phút chỉnh; khóa bài toàn vòng và thu file bằng USB BTC |
| Khi chấm | Kiểm đúng đội/đúng bản bài; chạy bot trong môi trường cách ly, lưu diễn biến. Online cấp quyền xem theo vòng; offline chỉ BTC xem để theo dõi/phân xử |
| Cuối sự kiện | Xử lý khiếu nại, xác nhận thứ hạng, cấp vé không trùng, sao lưu và đồng bộ kết quả online sau buổi thi |

Admin quản lý trên hệ thống; **giám thị** kiểm soát máy và thu bài; **trọng tài** giải quyết tranh chấp. Không nên để một người vừa sửa kết quả vừa tự duyệt quyết định đó.

## 5. Bốn điểm phải hiểu đúng

1. **Đổi map có kiểm soát:** có bộ map mới theo tuần, map cụ thể phân cho từng cặp. Trong cặp, các ván chính dùng cùng map và đổi màu; ván phụ dùng map dự phòng đã chuẩn bị. Không đổi map tùy ý sau khi thấy đội nào thắng.
2. **Map công bố trước:** tuần, tháng và kỳ đều có đầy đủ map/bố trí cụ thể từ trước sự kiện, kể cả map dự phòng. Đội được luyện và tối ưu bot theo map; không phải chờ đến giờ thi để biết map.
3. **Offline không mạng:** BTC phát bot cũ, đội tự do dùng/sửa trước hạn, thu bài bằng USB. Chỉ BTC cần xem hai bot đấu trên máy điều phối. Không có yêu cầu viết lại từ đầu hoặc stream tới máy đội.
4. **Lỗi bot khác lỗi BTC:** bot sai luật/quá giờ/crash thì thua ván; lỗi máy chấm/mất điện thì dừng và chạy lại ván theo quy trình, không tự tính đội thua. Kết quả cần được xác nhận trước khi cấp vé.

**Xem trận online theo vòng:** đội thuộc vòng bảng được xem các trận vòng bảng; vào tứ kết mới có quyền xem tứ kết. Đội bị loại vẫn xem lại vòng đã tham gia, không tự xem được vòng sau. Nếu cần giảm tải, server gửi từng nước đi cho UI tự vẽ bàn cờ; quyền xem vẫn được server kiểm tra. Không chia sẻ source hoặc log riêng của đối thủ.

**Thời lượng dự kiến:** khoảng **5 giờ cho Top 16**, **3–4 giờ cho Top 8**, có diễn tập trước. Không còn 90 phút viết lại bắt buộc. Nếu không đủ thời gian hoặc nhân sự, BTC chọn Top 8 và công bố trước khi mở đăng ký.

## Đọc tiếp khi cần chi tiết

- [Điều lệ và cách xếp hạng đầy đủ](01-THE-THUC-GIAI.md).
- [Phương án triển khai, thiết bị và ngân sách](02-PHUONG-AN-TRIEN-KHAI.md).
- [Đặc tả kỹ thuật](03-DAC-TA-KY-THUAT.md).
- [Bộ hướng dẫn cho agent lập trình](04-HUONG-DAN-AGENT-CODE.md).
- [UI và cách tích hợp vào repo](05-TICH-HOP-UI-VA-REPO.md); [mục lục toàn bộ docs](README.md).
- [Nộp bot tự động từ GitHub và cache tạm](06-GITHUB-NOP-BOT-VA-LUU-TRU.md).

Bản tóm tắt ngày 22/10/2026; các ngoại lệ về số đội, đồng điểm, dự bị và cấp bù vé xem điều lệ đầy đủ.
