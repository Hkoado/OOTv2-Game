# Thể thức đề xuất: OTTv2 Campus Bot League

Ngày soạn: 22/10/2026. Trạng thái: bản đề xuất để BTC phê duyệt trước khi công bố.

## 1. Phạm vi và các quyết định đã nhận từ người tổ chức

- Khoảng 100 sinh viên năm nhất, đội 2–3 người, dự kiến 35–50 bot. 100 người tương ứng tối thiểu 34 đội nếu mọi đội tối đa 3; số đội thực tế quyết định lịch.
- Ngôn ngữ thi: Python, chỉ thư viện chuẩn trong mùa đầu.
- Hệ thống giải gồm tuần → tháng → kỳ. Chung kết cả ba cấp đều offline không mạng; thu bài bằng USB do BTC quản lý. Offline chỉ BTC cần xem trận, không cấp UI xem trận cho máy đội.
- Đội được phát lại bot cũ của chính mình, được dùng nguyên bản, sao chép, chỉnh sửa, thử nghiệm hoặc thay bot theo ý muốn trước hạn khóa bài. Không bắt buộc viết lại từ đầu.
- Map thi tuần, tháng và kỳ được BTC công bố trước giải, gồm cả bố trí cụ thể và map dự phòng. Có thể đổi bộ map theo tuần; lịch/map áp dụng từng vòng được công bố trước hạn nộp bài liên quan.
- Ở mọi vòng online, đội được xem hai bot thi đấu trên bàn cờ. Chỉ đội tham gia vòng đó được xem các trận của vòng đó; BTC và trọng tài có quyền theo nhiệm vụ. Offline chỉ BTC cần xem.

## 2. Tại sao điều chỉnh đề xuất ban đầu

Tài liệu nguồn nêu giải ngày 48 bot, mỗi ngày lấy 3 đội, tuần có 18 đội; phương án khác dùng Elo và cửa sổ cập nhật buổi tối. Với 35–50 đội cho toàn bộ giải, 48 bot/ngày không đồng nghĩa có 288 đội khác nhau/tuần. Suất đi tiếp theo ngày cũng phụ thuộc ngày có đối thủ mạnh hay yếu và khối lượng hỗ trợ lặp lại rất lớn.

Đề xuất giữ cấu trúc tuần/tháng/kỳ, dùng practice trong tuần và vòng loại có khóa phiên bản vào cuối tuần. Elo nếu làm sau chỉ phục vụ luyện tập. Vé chung kết dựa vào vòng loại chính thức, không dựa vào số lượt yêu cầu chạy bot hoặc tần suất cập nhật.

## 3. Tư cách dự thi và bài nộp

Một sinh viên chỉ thuộc một đội trong một giai đoạn tháng. Một đội có một bot chính thức tại mỗi mốc khóa bài; được có nhiều phiên bản nháp. BTC duyệt danh sách thành viên và cấp tài khoản đội. Đội tự do xử lý bot của mình trong phạm vi Python, thư viện và giới hạn tài nguyên đã công bố; không có quy định gõ lại hoặc cấm copy/paste code của chính đội. Thi offline vẫn không truy cập Internet hoặc can thiệp máy chấm, bài đối thủ và kết quả. Không bổ sung điều kiện AI/tài liệu riêng khi BTC chưa công bố.

Bài online lấy từ GitHub repo đội đã đăng ký: một file `bot.py` ở root, UTF-8, tối đa 256 KiB, chỉ thư viện chuẩn. Đội push code, hệ thống tự đồng bộ trong cửa sổ nhận bài hoặc theo nút “Cập nhật bot từ GitHub”. BTC chốt commit SHA và hash file; không chạy cả project, Dockerfile hoặc script cài đặt. Bot chạy JSON Lines và đọc map đầu vào. GitHub lưu source chính, máy chấm cache tạm; xem [luồng GitHub và lưu trữ](06-GITHUB-NOP-BOT-VA-LUU-TRU.md).

Online tối đa 10 commit mới được kiểm tra/đội/ngày; polling cùng SHA không tạo bài hoặc trừ quota. Practice tối đa 5 cặp/đội/ngày, chạy local không giới hạn. Mức ban đầu phải công bố và áp dụng đồng đều. Bản đang tải/check không thay bản hợp lệ trước. Upload file có thể là fallback BTC bật; offline vẫn thu file qua USB.

## 4. Chu kỳ tuần

| Thời điểm, giờ Việt Nam | Hoạt động |
| --- | --- |
| Đầu tuần | Công bố luật, giao thức, phiên bản engine, toàn bộ map thi/map dự phòng và lịch áp dụng của tuần |
| Trong tuần | Workshop, sửa bot, practice; bảng practice chỉ tham khảo |
| Thứ Sáu 20:00 | Khóa đăng ký, nhận bài vòng loại; chọn bản hợp lệ mới nhất nhận trước hạn |
| Tối thứ Sáu / sáng thứ Bảy | Chạy vòng bảng; đội thuộc vòng bảng được xem trực tiếp/xem lại và kết quả tạm |
| Thứ Bảy | Cửa sổ khiếu nại tối thiểu 2 giờ sau kết quả; xác nhận 16 đội và dự bị |
| Chủ nhật | Chung kết tuần offline, phát bot cũ, cho chỉnh/thử bot và thi Top 16 |

Đây là lịch tương đối, chưa đặt ngày khai mạc. BTC giữ đủ thời gian khiếu nại/chấm lại. Với GitHub, chỉ candidate đã được server xác nhận commit SHA trước cutoff mới được xét; push/commit timestamp không thay receipt của BTC. Bản đã chốt SHA có thể tải/check xong sau hạn; freeze đợi check hoặc quyết định hạ tầng. Push sát giờ nhưng chưa sync không được tính. Với upload fallback tính lúc nhận đủ byte; offline tính seal của giám thị.

### Vòng loại: 8 bảng, lấy 2 đội mỗi bảng

Áp dụng cho 32–56 đội hợp lệ. Chia bảng chênh nhau tối đa một đội, bốc thăm công khai bằng seed và danh sách đã khóa. Mùa đầu bốc thăm hoàn toàn; các tuần sau có thể chia rổ theo kết quả tuần trước nhưng phải công bố trước tuần mới. Mỗi bảng vòng tròn một lượt theo cặp, mỗi cặp có 2 ván đổi màu, cùng map và seed cặp.

| Số đội | Cỡ bảng | Số cặp vòng loại | Số ván |
| --- | --- | ---: | ---: |
| 35 | 3 bảng × 5; 5 bảng × 4 | 60 | 120 |
| 40 | 8 bảng × 5 | 80 | 160 |
| 48 | 8 bảng × 6 | 120 | 240 |
| 50 | 2 bảng × 7; 6 bảng × 6 | 132 | 264 |

Điểm ván: thắng 1, hòa 0,5, thua 0. Điểm cặp: thắng tổng điểm ván được 3 điểm bảng, hòa được 1, thua 0. Không dùng hiệu số thời gian chạy hoặc số quân còn lại để thưởng lối chơi câu giờ.

Xếp bảng theo: điểm bảng → điểm đối đầu trong nhóm đồng điểm → tổng điểm ván trong toàn bảng → tổng điểm ván đối đầu trong nhóm đồng điểm → bốc thăm có seed công khai. Tạo nhóm đồng điểm một lần từ điểm bảng; không lặp tính mini-table khi nhóm bị tách, tránh cách hiểu khác nhau. Không phát sinh ván phụ vòng bảng.

Nếu dưới 32 đội: 16–31 đội chia 4 bảng cân bằng, lấy 2 đội/bảng để chung kết Top 8; 8–15 đội chia 2 bảng lấy 2 để Top 4; 4–7 đội một bảng lấy Top 4; dưới 4 đội chuyển thành giao lưu và công bố lại giải thưởng. Trên 56 đội phải điều chỉnh điều lệ trước khi mở tuần, không tự ý loại đội theo thứ tự đăng ký.

### Chung kết tuần: Top 16 loại trực tiếp

Vòng 1/8, tứ kết, bán kết và tranh ba: mỗi cặp 4 ván. Chung kết tranh nhất: 6 ván. Đấu đủ số ván chính, không dừng sớm, để phân tích và công bố nhất quán. Mỗi block 2 ván đổi màu trên cùng map/seed; màu ván đầu luân phiên giữa các block.

Nếu hòa tổng điểm: thêm đúng 2 ván đổi màu trên một map dự phòng đã được BTC cam kết trước, cùng phiên bản bot đã khóa; nếu vẫn hòa, đội có seed giải tốt hơn đi tiếp. Quy tắc hữu hạn này tránh kéo dài sự kiện; ưu thế seed phải được công bố trước vòng loại. Không dùng một ván sudden death vì hai màu bất đối xứng. BTC muốn loại ưu thế seed có thể chọn bốc thăm công khai thay thế, nhưng phải chốt trước mùa.

Seed Top 16: các đội nhất bảng xếp trước các đội nhì. Trong mỗi nhóm so tỷ lệ điểm bảng `points/(3*seriesPlayed)`, rồi tỷ lệ điểm ván `gamePoints/gamesPlayed`, rồi bốc thăm có seed. So phân số chính xác, không làm tròn. Đây là cách phân seed, không phải thay thế xếp hạng trong bảng khác cỡ.

Ghép seed 1–16, 2–15, 3–14, … trên bracket chuẩn có nhánh cố định. Nếu trùng đối thủ cùng bảng ở vòng đầu, hoán đổi có tính xác định trong nhóm seed 9–16: chọn hoán vị hợp lệ có tổng độ lệch seed nhỏ nhất, hòa chọn thứ tự từ điển. Lưu permutation, không cho admin kéo thả sau khi map được mở. Seed giải của đội giữ nguyên khi đổi vị trí nhánh. Không reseed giữa vòng.

## 5. Chung kết tháng và kỳ

Mặc định một tháng thi đấu có 4 tuần: mỗi tuần cấp 2 vé tháng, tạo Top 8 offline tháng. Mặc định kỳ có 4 tháng thi đấu: mỗi tháng cấp 2 vé kỳ, tạo Top 8 offline kỳ. Đây là lịch giải, không khẳng định học kỳ của trường dài 4 tháng; BTC nhập lịch thực tế trước khai mạc.

Đội đã có vé vẫn được thi, giành danh hiệu và nhận giải thưởng ở cấp dưới. Vé được chuyển cho đội đứng cao nhất chưa có vé của cùng đợt cấp vé. Không cấm đội mạnh luyện tập hoặc vô địch lần nữa; một đội chỉ giữ một vé ở mỗi cấp đích. Không chuyển vé từ kết quả practice.

Mỗi sự kiện xuất bảng xếp hạng đầy đủ: vô địch, á quân, ba, tư; nhóm bị loại tứ kết xếp 5–8 theo seed giải; nhóm bị loại vòng 1/8 xếp 9–16 theo seed giải. Xếp thứ tự này được dùng để cấp bù vé và dự bị, không coi là kết quả đối đầu trực tiếp.

BTC giữ danh sách dự bị theo thứ tự xét vé của đợt. Đội rút trước khi khóa danh sách được thay bằng đội dự bị; sau khóa bracket thì xử lý walkover, không thay đội khi map đã công bố. Thiếu 2 ứng viên mới trong một đợt thì để vé trống, cuối giai đoạn mở vòng tranh vé còn lại cùng luật vòng loại; không tự cấp vé trùng. Chuyển vé sau quyết định kỷ luật phải có nhật ký và thông báo.

Tháng/kỳ có 8 đội: tứ kết, bán kết, tranh ba 4 ván/cặp, chung kết 6 ván. Nếu lịch có 3 tháng thì có 6 vé kỳ, dùng bracket 8 với 2 bye cho seed 1–2; bye không tạo ván giả hay điểm ván. Seed tháng/kỳ theo thành tích cấp vé tốt nhất: vô địch trước á quân, sau đó tỷ lệ điểm ván tại đợt cấp vé, rồi bốc thăm có seed. Đội nhận vé chuyển dùng thứ hạng thực tế, không được gán thành tích á quân. Bảng đăng ký phải nêu số tuần/tháng và số vé trước mùa giải.

Giải tháng/kỳ có thể bố trí cuối tuần riêng. Nếu dùng ngày chung phải có lịch, thời gian chỉnh bot và snapshot độc lập cho từng sự kiện. Map tháng/kỳ cũng được công bố trước sự kiện, không chờ đến giờ thi mới tiết lộ.

## 6. Quy trình chung kết offline và sử dụng bot cũ

1. Trước buổi thi, BTC nhận snapshot hợp lệ của từng đội; nếu qua GitHub thì khóa commit SHA và tải trên máy BTC có mạng. Đội xác nhận hash file của mình. Không dùng `git pull` một nhánh đang thay đổi tại giờ thi.
2. Phát đúng bot cũ cho đội, dưới dạng file có thể sao chép/chỉnh sửa; BTC giữ bản gốc để đối soát. Lấy code xong mới ngắt Internet. Trong phiên thi không pull qua Internet.
3. Máy thi có Python, tài liệu, simulator và đầy đủ map đã công bố. Đội được dùng nguyên bot cũ, chỉnh, thử hoặc thay bot. Không kiểm tra “viết lại từ đầu”, không chặn clipboard cho code của đội.
4. Máy đội không kết nối mạng. Giám thị thu `bot.py` bằng USB BTC, ghi biên nhận và đưa vào máy chấm. BTC xem diễn biến/replay trên máy điều phối; không phải truyền trận đến máy đội hoặc cung cấp player cho đội offline.
5. Đề xuất 30 phút đầu buổi để nhận/kiểm tra/chỉnh bot; đây là thời gian BTC có thể điều chỉnh trước giải, không phải thời gian viết lại bắt buộc. Đội muốn dùng nguyên bot cũ phải xác nhận nộp chính file đó; không có bài hợp lệ được chốt thì xử lý thiếu bài theo điều lệ.
6. Trước mỗi vòng đấu, xác nhận map đã công bố và cho mọi đội còn thi 15 phút chỉnh bot. Thu và khóa bài cả vòng cùng một thời điểm, kể cả cặp sẽ chạy sau. Việc xem các trận đang chạy không cho phép cập nhật lại bài của vòng đã khóa. BTC không mở mã nguồn đối thủ cho đội.
7. Mỗi đội chỉ dùng một snapshot đã khóa cho cả vòng, kể cả ván phụ. Các cặp chạy theo hàng đợi; đội không được cập nhật bài giữa hai ván trong một cặp.
8. Đội đi tiếp được chỉnh bài ở cửa sổ vòng tiếp theo. Tháng/kỳ phát lại bot đội chọn từ các snapshot chính thức đã gửi trước buổi thi; được sử dụng và sửa tiếp, không phải bắt đầu từ thư mục rỗng.

Phần mềm ghi nhận đúng đội, phiên bản, thời điểm và hash bài đã khóa. Giám thị theo dõi thời hạn nộp, không Internet và không can thiệp bài đối thủ; không chấm tính hợp lệ dựa vào độ khác nhau giữa bot cũ và bot mới.

Đề xuất 10 phút kiểm tra/giải thích bot cho nhóm đạt giải trong lúc BTC kiểm chứng kết quả; không chấm điểm phong cách code để thay đổi thắng thua. Vi phạm cần chứng cứ và cơ hội giải trình.

## 7. Map và công bằng

Mỗi giải tuần/tháng/kỳ có `mapPackVersion`, chứa đầy đủ map chính và dự phòng. BTC công bố cả file map, preview và lịch áp dụng trước sự kiện, đủ sớm để đội luyện/chỉnh bot trước hạn khóa bài. Mốc công bố cụ thể phải ghi trong lịch; tuần công bố đầu tuần, tháng/kỳ công bố khi mở sự kiện và trước cutoff. Không ra luật mới hoặc đổi map đột ngột tại chung kết. Bot vẫn nhận đầy đủ map trong mỗi request.

Mùa đầu giữ bàn 9×9, nhà a1/i9, vùng xếp Đỏ/Xanh 28 ô và vùng trung tâm 25 ô. Vùng trung tâm hiện chỉ cấm xếp quân, không cấm di chuyển. Bổ sung một loại địa hình duy nhất: ô cản không được đặt hoặc đi vào. Sông ngang/chéo chỉ là cách bố trí ô cản, chưa có nhảy sông, bơi hay luật quân riêng.

Map phải đối xứng quay 180°, không chặn nhà chính; sau khi trừ ô cản mỗi bên có ít nhất 9 ô xếp, và mọi ô xếp có đường đi địa hình đến nhà địch. Không coi những điều kiện này là bằng chứng cân bằng chiến thuật: BTC còn phải test bot mẫu và kiểm tra thủ công trước khi khóa pack. Giữ tối thiểu 2 lối vượt vùng giữa để tránh map chỉ có một cổ chai; bộ kiểm tra đồ thị cần xét đúng 8 hướng của engine. Cấm cắt góc qua khe chéo chỉ khi hai ô kề cạnh cùng bị cản; quy tắc này là luật bổ sung phải có test và công bố trước giải.

BTC khóa và công bố nội dung pack, hash và quy tắc phân map trước giải. Có thể gán map theo vòng hoặc theo vị trí cặp đấu; khi chưa biết tên đội thì công bố theo slot bracket. Sau khi bốc thăm, công bố bảng ghép cặp–map trước cutoff tương ứng. Không chọn lại theo phong cách bot hoặc kết quả đã thấy. Trong một cặp mọi block chính dùng cùng map và đổi màu; map dự phòng cũng được công bố từ trước. Seed bốc thăm/seed bot được lưu để kiểm tra, không cần cơ chế giữ kín map.

Hai đội được biết map từ trước và có cùng cửa sổ chỉnh bot tại buổi thi. Hai ván của block dùng cùng seed cho đội đó khi đổi màu; seed do BTC cấp. Map không đổi giữa hai ván của block. Đội được chuẩn bị chiến thuật riêng cho các map đã công bố. Có thể tái sử dụng map đã công bố hoặc thay pack tuần mới; mọi thay đổi sau công bố phải có thông báo, phiên bản mới và thời gian chuẩn bị đồng đều trước khóa bài.

## 8. Luật ván và phân xử lỗi

Giữ luật gốc: Đỏ xếp trước; Xanh thấy cách xếp Đỏ; Đỏ đi trước; 9 quân/bên, mỗi loại 3; đi một ô theo 8 hướng; chỉ ăn loại yếu hơn; không vào quân đồng đội, quân cùng loại đối phương hoặc loại mạnh hơn. Thắng khi tới nhà địch hoặc ăn hết một loại quân địch. Áp dụng ô cản/cắt góc theo mục 7.

Bot trả cả 9 vị trí xếp trong một response. Không dùng 30 giây xếp quân của UI cho bot. Không tự xếp ngẫu nhiên cứu bot sai trong giải chính thức. Đến lượt mà không có nước hợp lệ thì thua vì bị khóa; bot không có hành động pass.

Hòa khi cùng một trạng thái bàn + bên đến lượt xuất hiện lần thứ ba, hoặc đủ 400 lượt đơn mà chưa thắng; một lượt đơn là một nước của một bên, không phải hai nước. Kiểm tra thắng trước khi xét hòa sau nước thứ 400. Không thêm luật đếm quân phân thắng khi hết lượt.

Thông số dự kiến để benchmark rồi khóa trước tuần đầu: RAM 256 MiB/bot; CPU tổng 30 giây/bot/ván; thời gian phản hồi 1 giây thực/lượt di chuyển; xếp quân tối đa 5 giây thực; tổng thời gian được tính cho các request đang chờ bot 45 giây/bot/ván; hạn cứng một ván 120 giây. Chính sách chi tiết về CPU và khởi động trong đặc tả kỹ thuật; không dùng CPU quota như đồng nghĩa CPU budget.

| Tình huống | Kết quả |
| --- | --- |
| Bot quá giờ, quá RAM, crash, JSON sai, xếp sai, nước sai, spam output | Thua ván; ghi lý do riêng, vẫn chạy ván sau với process mới |
| Một đội không có snapshot hợp lệ của vòng | Thua tất cả ván trong cặp, không chạy code cũ tự động |
| Cả hai đội không có snapshot hợp lệ | Cả hai bị loại; nhánh sau nhận bye, không chọn tùy ý một đội |
| Mất điện, engine lỗi, worker chết, thiết bị BTC lỗi | Ván vô hiệu, giữ artifact để điều tra; chạy lại cùng snapshot/map/seed sau khắc phục |
| Hạn cứng ván bị chạm nhưng không quy trách nhiệm được cho bot | Lỗi hạ tầng; không tự gán hòa hay thua |
| Đội rút sau khóa bracket | Walkover; kết quả hành chính tách khỏi ván thật |
| Nghi mã độc/gian lận | Dừng bài liên quan, lưu chứng cứ, trọng tài quyết định theo điều lệ |

Chỉ bot đang được yêu cầu phản hồi mới có thể nhận lỗi lượt. Nếu lỗi khởi động của cả hai bot thì kiểm tra tuần tự theo màu ván: bot đầu lỗi nhận thua; hai ván đổi màu cân bằng trường hợp cả hai hỏng. Không lấy thứ tự event hệ điều hành để chọn bên thua. Lỗi đã ghi trong một ván không xóa kết quả các ván khác trừ quyết định kỷ luật có chứng cứ.

## 9. Lịch một buổi chung kết

Đề xuất đặt phòng 5 giờ cho Top 16: 20 phút check-in/kiểm tra máy, 30 phút nhận/kiểm tra/chỉnh bot cũ, 15 phút chỉnh/khóa bài mỗi vòng × 4, khoảng 130 phút chạy và bình luận, 60 phút dự phòng/xác minh/trao giải. Tổng 300 phút. Với Top 8 dự kiến 3–4 giờ. Lịch phải được diễn tập cả thu bài và phụ thuộc giữa vòng; nếu không đạt thì tăng thời gian hoặc chốt Top 8 trước mở đăng ký.

Chạy đồng thời tối đa 2 ván ở mùa đầu. Thứ tự cặp công khai, các đội cùng vòng đã khóa bài. Offline chỉ BTC xem bàn cờ, diễn biến và replay trên máy điều phối để theo dõi, phân xử và công bố kết quả; không yêu cầu máy đội xem hoặc kết nối server. Không kéo thời gian suy nghĩ của bot để dễ xem; player BTC có tốc độ phát riêng. Cần 1 trưởng giải/trọng tài, 1 vận hành kỹ thuật và 2 giám thị/hỗ trợ.

### Quyền xem online theo vòng

“Vòng” là một `roundId` cụ thể trong một sự kiện: vòng bảng, vòng 1/8, tứ kết, bán kết, tranh ba hoặc chung kết; không phải toàn mùa giải. Đội thuộc vòng nào được xem tất cả trận của vòng đó, không chỉ trận của mình. Đội bị loại vẫn xem lại vòng đã tham gia, không tự có quyền xem vòng sau hoặc sự kiện tháng/kỳ chưa được nhận vé. Tranh ba và trận nhất là hai vòng riêng. Đội luyện tập chỉ xem practice của mình.

Server kiểm quyền cho danh sách trận, trạng thái bàn, từng nước đi, stream và replay/file tải về; ẩn nút trên UI là chưa đủ. Không mở link xem trận chính thức công khai cho người không thuộc vòng. BTC xem theo nhiệm vụ; judge chỉ xem vòng được giao. Xem trận không bao gồm xem source hoặc log riêng của đối thủ. Quyền này áp dụng phần thi online; replay trận offline mặc định chỉ BTC/trọng tài, không tự mở cho đội khi đồng bộ lên online.

## 10. Khiếu nại và công bố

Vòng loại có ít nhất 2 giờ khiếu nại; offline 10 phút từ lúc kết quả cặp được công bố, phải giải quyết trước vòng kế tiếp. Chỉ xét đúng luật, sai snapshot, map, thời gian và vận hành; không cho thay code sau khi biết kết quả. Hai người BTC xác nhận quyết định đổi kết quả; lưu lý do, artifact cũ và mới, thời điểm, người duyệt. Công bố tên đội, kết quả và replay; không công bố mã nguồn, thông tin sinh viên hoặc log riêng nếu chưa có chính sách đồng ý.

## Nguồn và ranh giới

- [Tài liệu đề xuất của nhóm](https://docs.google.com/document/d/18dIiYvJgU5WNyXqWZ96JbX-64nBJq6MqnXaCY2gZKG0/edit?tab=t.0), tab chung, đọc ngày 22/10/2026; có nội dung đang ở dạng suggestion, được xem là đề xuất, không phải điều lệ đã duyệt.
- [Mã nguồn game](https://github.com/Hkoado/OOTv2-Game/tree/0a0b6b5c2992aa8973c6a052da6eff026800e897), commit đã đọc. Quy định map, giới hạn bot, hòa, bị khóa, điểm và cấp vé trong tài liệu này là phần bổ sung đề xuất.
