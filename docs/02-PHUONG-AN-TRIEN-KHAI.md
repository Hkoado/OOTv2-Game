# Các phương án triển khai để BTC lựa chọn

Ngày 22/10/2026. Dùng cùng điều lệ tại `01-THE-THUC-GIAI.md`: 35–50 đội Python; chung kết tuần/tháng/kỳ offline nhận lại bot cũ và tự do dùng/sửa trước cutoff; map cụ thể được BTC công bố trước mỗi giải. Online đội xem trận trong vòng mình tham gia; offline chỉ BTC xem.

## 1. Kết luận đề xuất

Chọn **B: website gọn + bộ chấm Linux chạy theo đợt + gói chung kết offline** nếu có ít nhất khoảng 3 tuần chuẩn bị và một thành viên biết vận hành Linux. Nếu thời gian rất gấp, làm A trước rồi nâng lên B. Phần khó nhất là sandbox, luật có map và vận hành offline; giao diện đẹp hoặc Elo không thay thế được ba phần đó.

Không cần máy chủ lớn hay bật bot 24/7. Với 50 đội, vòng loại chỉ cần 264 ván; khởi chạy bot khi có ván, kết thúc thì dọn sạch. Nhu cầu CPU phụ thuộc số ván và ngân sách suy nghĩ, không phải 100 sinh viên kết nối cùng lúc.

## 2. Hiện trạng đã kiểm tra trong repository

Đã clone vào `source-game/`, checkout nhánh mặc định `Ex2`, commit `0a0b6b5c2992aa8973c6a052da6eff026800e897`. Đồng thời đã đọc nhánh `origin/tournament/initial`, commit `78cb8e20e83bf9d42445f3f166d42c09f95a7247`, bằng `git show`. Bản clone dùng để tham chiếu; chưa sửa mã game. Bảng dưới mô tả Ex2; nhánh tournament có nhiều phần triển khai bổ sung như đoạn kế tiếp.

| Thành phần | Hiện trạng | Hướng xử lý |
| --- | --- | --- |
| UI | React 19, Vite, các component bàn/quân/lịch sử | Tái sử dụng phần render cho replay và trình chiếu |
| Luật | `src/game/constants.js`, `rules.js`, `gameState.js` | Tách engine thuần; thêm validation, map, hòa, version |
| Đồng bộ | `usePlayRoom.js`: BroadcastChannel, PeerJS, playhtml; nhận whole-state từ client | Không dùng làm nguồn kết quả chính thức; engine/runner quyết định |
| Setup | Hàm hoàn tất setup có auto-place dùng `Math.random()` | Giải bot phải kiểm tra đủ 9 quân và từ chối bài sai, không cứu ngẫu nhiên |
| Map | Kích thước/vùng/nhà hardcode, chưa có obstacle schema | Thêm map registry, validator, editor và hash |
| Backend tại Ex2 | Không có API, DB, worker hay quản lý giải trong checkout này | Lấy phần sẵn có từ nhánh tournament, bổ sung phần thiếu |
| Triển khai | Cấu hình frontend Vercel | Có thể dùng cho web online; không dùng làm Linux bot worker hoặc nền tảng offline |

Đã chạy probe bằng Node, không cần cài dependency: vùng 28/28/25 đúng; nhưng `completeSetupRed()` vẫn nhận đủ 9 quân Đỏ đặt ở sân Xanh và chuyển `setup_blue`. Đây là kiểm tra ở tầng hàm, không khẳng định UI cho phép thao tác đó. Vì vậy không được dựa vào validation của giao diện để chấm bài.

**Phần đã có ở `tournament/initial`:** Express + `better-sqlite3`, upload một file Python, validation ở adapter, Python subprocess theo từng request, worker tuần tự, giải 8 bot/30 ván, standings/bracket/replay, UI `src/tournament/` và bộ test Node. `AGENTS.md` của nhánh yêu cầu phát triển tiếp, giữ game chơi tay, không đổi framework tùy ý. `IMPLEMENTATION_NOTES.md` ghi đây là local-dev trusted-only, chưa có sandbox OS, login thật hay multi-worker. Thiết kế mới kế thừa nhánh này; không coi toàn bộ backend là chưa tồn tại và không coi MVP hiện tại đã sẵn sàng chạy code lạ. Các con số/luật cũ 8 đội, 200 plies, 2 ván knockout và protocol stateless cần migration rõ ràng.

## 3. So sánh phương án

| Tiêu chí | A — BTC điều phối bằng CLI | B — Web gọn + runner (khuyến nghị) | C — Nền tảng league đầy đủ |
| --- | --- | --- | --- |
| Nộp online | CLI sync repo đội, chốt SHA; import file dự phòng | Repo GitHub đăng ký, tự sync `bot.py`/check/chốt SHA, UI trạng thái | GitHub App/webhook sâu hơn, nhiều runtime |
| Practice | Bộ chạy local; BTC chạy vài đợt | Local + quota practice có queue | Matchmaking/Elo liên tục |
| Kết quả | Export HTML/JSON, replay | Bảng đấu, BXH, vé, replay, audit | Rating, thống kê chuyên sâu, nhiều mùa |
| Offline | CLI + player cục bộ cho BTC | Dashboard/player BTC, thu bài USB | Cũng phải có bản offline độc lập |
| Đổi map | File JSON + validator CLI | Editor có lưới + duyệt/khóa pack | Generator, nhiều terrain, nhiều luật |
| Điều hành vé | CSV có kiểm tra trùng | DB và cấp vé theo quy tắc | Tự động hóa nhiều mùa |
| Công sức dự kiến | 7–12 ngày công | 18–30 ngày công | 40–70+ ngày công |
| Người phù hợp | 1 người kỹ thuật vững + BTC nhận bài | 2–3 sinh viên phát triển, 1 người vận hành | Đội có thời gian bảo trì lâu dài |
| Rủi ro chính | Nhầm file và thao tác tay | Auth, queue, gói offline và khôi phục | Quá tải phạm vi trước mùa đầu |

Ước lượng ngày công gồm viết, kiểm thử và diễn tập tối thiểu; không phải cam kết tiến độ. B vẫn cần tối thiểu 1 buổi diễn tập đông đội và 1 lần thử mất mạng/mất worker. Công sức có thể tăng đáng kể nếu chưa có kinh nghiệm sandbox Linux.

## 4. Kiến trúc B

```text
ONLINE
Trình duyệt đội/BTC -> HTTPS -> API + SQLite + kho file snapshot
                                      |
                             jobs có lease trong DB
                                      |
                            runner Linux chuyên dụng
                                      |
                        engine tin cậy -> 2 nsjail độc lập
                                      |
                              kết quả + replay

OFFLINE
Máy chuẩn bị có mạng -> export bundle có checksum -> phương tiện BTC
                                                        |
                             máy điều phối offline + DB cục bộ
                              /                         \
                  nhận file từ máy đội          runner Linux offline
                                                       |
                                             player/replay BTC local
```

Giữ Node.js JavaScript ESM + Express, React/Vite, `better-sqlite3` trên đĩa cục bộ coordinator và filesystem cho artifact như nhánh tournament. Không đổi sang framework khác hoặc monorepo trong mùa đầu. Chọn một phiên bản Node LTS và Python stable còn hỗ trợ tại thời điểm triển khai, pin patch và rootfs digest sau kiểm tra; không dùng `latest`. Runner là process tin cậy trên Linux, chỉ chạy bot trong nsjail. Không cần Redis/Postgres/Kubernetes cho quy mô này.

Nếu coordinator và runner trên hai máy: runner claim/heartbeat/report qua API riêng có token giới hạn; không mount DB SQLite qua mạng. Nếu một máy: cùng API loopback. Chỉ một coordinator ghi DB; SQLite WAL không dành cho filesystem mạng theo [tài liệu SQLite](https://www.sqlite.org/wal.html).

## 5. Thiết bị và ngân sách

Đề xuất mượn một máy Linux 4 core/8 GB RAM/SSD cho điều phối + chấm, một máy Linux dự phòng đã cài giống hệt, phòng máy cho 35–50 đội hoặc chia bàn 2–3 người dùng chung một máy. Đây là cấu hình mục tiêu để benchmark, chưa phải cấu hình đã chứng minh. Nếu không mượn được phòng máy, chi phí thiết bị và kiểm soát thi có thể lớn hơn hosting nhiều lần.

Online: có thể chạy website/API trên máy BTC có kết nối được cấu hình đúng hoặc thuê VPS nhỏ cho điều phối, còn worker chỉ bật khi chấm. Offline: chuyển hoàn toàn sang máy BTC, không phụ thuộc VPS, Google login, CDN, font mạng, GitHub hoặc tín hiệu PeerJS. Chạy nsjail trong Linux thật hoặc Linux VM đã diễn tập; không coi chạy trực tiếp PowerShell là sandbox tương đương.

Ngân sách mẫu để xin tài trợ, không phải báo giá thị trường: hạ tầng trực tuyến 0,3–1 triệu đồng/tháng; vật tư/USB BTC/dây mạng/adapter 0,3–0,8 triệu cho lần đầu; giải thưởng tuần 0,3–0,6 triệu × 4; tháng 0,8–1,5 triệu. Tổng tháng mẫu khoảng 2,6–5,7 triệu gồm vật tư lần đầu, chưa tính giải kỳ, thuê phòng/máy, ăn uống hay nhân công. Có thể giảm tiền thưởng và mượn hạ tầng để hạ ngân sách. Cần lấy báo giá thực tế trước mua; không có yêu cầu phải chi đúng khoản này.

## 6. Công suất tính toán

`T ≈ số_ván × thời_gian_ván / số_slot × 1,3`, hệ số 1,3 là dự phòng scheduling/log/khởi động, không phải số đo. Dùng thời gian P95 đã benchmark cho kế hoạch bình thường, đồng thời tính hạn cứng cho dự phòng.

| Đợt | Ván chính | Ván phụ tối đa | Thời gian với 2 slot, 120s/ván và hệ số 1,3 |
| --- | ---: | ---: | ---: |
| Vòng loại 50 đội | 264 | 0 | khoảng 5 giờ 43 phút |
| CK tuần Top 16, có tranh ba | 66 | 32 | khoảng 2 giờ 7 phút nếu tất cả chạm hạn |
| CK tháng/kỳ Top 8, có tranh ba | 34 | 16 | khoảng 65 phút nếu tất cả chạm hạn |

Số tính trên là lượng công việc, chưa phản ánh phụ thuộc giữa các vòng. Phải mô phỏng stage barrier và lịch chỉnh bot; slot không luôn kín. Không còn 90 phút viết lại bắt buộc: đề xuất đặt phòng 5 giờ cho Top 16, gồm 30 phút đầu dùng/kiểm tra/chỉnh bot cũ, khoảng 130 phút chạy và 60 phút thu bài/dự phòng/trao giải. Nếu diễn tập không đạt phải tăng giờ hoặc chọn Top 8 trước tuần. Không đổi số ván sau khi biết kết quả.

Ví dụ nếu đo P95 20 giây/ván: 264 ván / 2 slot × 20 × 1,3 ≈ 57 phút. Đây chỉ là minh họa; chưa benchmark bot Python/sandbox. Bốn slot chỉ bật sau kiểm tra CPU/RAM và sai số timeout, không coi máy 4 core tự động đủ.

## 7. Đổi map: phần cần làm thật

Editor cho BTC chỉnh ô cản trên lưới, tự phản chiếu 180°, xem nhà/vùng xếp/lối đi, chạy validator và bot mẫu. Trạng thái map `draft -> validated -> approved -> published -> locked`; sửa map đã công bố/khóa phải tạo phiên bản mới, thông báo và cho thời gian chuẩn bị trước cutoff. Draft nội bộ tách quyền khỏi map đã công bố; không xây cơ chế pack thi bí mật.

Đầu tuần công bố toàn bộ map thi/map dự phòng và lịch áp dụng; tháng/kỳ công bố pack của mình từ trước sự kiện, trước cutoff. Phát file JSON, preview, phiên bản/hash và quy tắc gán map theo vòng/slot cặp. Đội được luyện và tối ưu bot trên map đã biết. Tại buổi thi có cửa sổ chỉnh bot chung, không phải chờ tiết lộ map mới. Cả hai màu dùng cùng map, seed tương ứng; engine vẫn đọc map runtime. Tái sử dụng Board để preview; validator nằm ở engine.

Pack đã công bố được đưa vào bộ luyện và gói offline của từng đội. Chỉ draft chưa duyệt, source/log đội và thông tin vận hành là riêng tư. Có thể tái sử dụng map hoặc đổi theo tuần; không gán lại map có lợi cho một đội sau khi khóa bài.

## 8. Offline: chọn cách chuyển file

**Offline không mạng:** phát bot cũ có thể sửa và toàn bộ map đã công bố cho đúng đội trước khi ngắt mạng. Giám thị thu `bot.py` bằng USB BTC theo mã đội, xác nhận hash và biên nhận. Đội có thể nộp nguyên bản cũ hoặc bản đã sửa. Dashboard/replay chỉ chạy trên máy BTC; máy đội không cần player xem trận. Chung kết mặc định 16 đội/8 đội, không phải toàn bộ 35–50 đội, nên diễn tập thu bài theo số đội thực sự dự offline.

**Xem trận online:** cho phép mọi đội thuộc cùng vòng xem các trận của vòng đó. Khuyến nghị truyền snapshot ban đầu + từng nước đi đã được server xác nhận xuống client để UI tự vẽ hai bot, không stream video hoặc tạo một game runner cho mỗi người xem. Có thể bắt đầu bằng polling event theo sequence, nâng SSE khi cần. Chỉ tải trạng thái đầy đủ khi mở trận hoặc khôi phục mất event; giới hạn tốc độ cập nhật/catch-up để chịu tải. Server kiểm quyền vòng trên list/state/event/stream/replay, không chỉ UI.

Offline không cần LAN hoặc live tới client. BTC xem trực tiếp từ kết quả engine/replay cục bộ; đồng bộ kết quả sau sự kiện không tự cấp quyền xem trận offline cho thí sinh. Quản lý người xem và chấm bot là hai tải khác nhau: giảm payload xem trận không thay thế benchmark CPU của runner.

Giới hạn nộp đúng hạn offline: giám thị đánh dấu đội đã yêu cầu nộp trước tiếng khóa giờ, ngăn sửa file tại máy ngay lúc đó, thu bản đã hash vào danh sách tiếp nhận. Giờ import muộn do BTC không làm đội bị trễ. Không dùng mtime file hay thời điểm cắm USB làm bằng chứng giờ nộp.

## 9. Lộ trình làm B có điểm dừng

1. Engine thuần + schema map + luật hòa/lỗi + CLI replay. Chưa đúng luật thì chưa làm dashboard.
2. Python protocol + bộ mẫu + sandbox + cleanup + đo công suất. Chưa vượt kiểm tra mã độc mẫu thì không nhận code sinh viên để chạy.
3. Scheduler vòng bảng/bracket, khóa snapshot, cấp vé tuần/tháng/kỳ, audit.
4. Web upload, practice quota, BXH, map editor/duyệt; authentication do BTC cấp, tránh phụ thuộc email/SSO.
5. Bundle offline phát lại bot, chỉnh/khóa/thu bài, player BTC, quyền xem online theo vòng, máy dự phòng và rehearsal.
6. GitHub sync repo được duyệt là luồng nộp online chính theo [file06](06-GITHUB-NOP-BOT-VA-LUU-TRU.md); polling + nút cập nhật trước, webhook tùy chọn sau. Sau mùa đầu mới cân nhắc Elo, đa ngôn ngữ, terrain phức tạp. Source chính trên GitHub, cache BTC ngắn hạn, kết quả/replay vẫn lưu.

MVP có thể bỏ lịch sử rating, trang profile đẹp, live stream Internet và import Git tự động; không bỏ validation, sandbox, khóa bài, đổi màu, map version, replay và khôi phục.

## 10. Mục cần BTC chốt trước khi công bố

- Lịch thực tế: số tuần/tháng, số tháng/kỳ; ngày offline và phòng máy; có đủ 5 giờ cho Top 16 hay chọn Top 8.
- Mốc công bố toàn bộ map; 30 phút đầu buổi dùng/chỉnh bot cũ và 15 phút chỉnh trước mỗi vòng, hoặc lịch khác được công bố trước.
- Mức giới hạn tài nguyên sau benchmark; cơ chế seed giải thắng khi hòa kéo dài.
- Người kiểm duyệt/công bố pack, nhân sự thu bài, phân quyền vòng online; thưởng và điều kiện dự giải.

Đây là những quyết định vận hành trước công bố giải, không phải lý do dừng soạn thiết kế. Hai tài liệu kỹ thuật còn lại đã dùng B với mặc định cụ thể để agent có thể triển khai và BTC có thể rà soát.

## Tài liệu tham khảo kỹ thuật

- [nsjail](https://github.com/google/nsjail): Linux namespaces, cgroups, rlimits, seccomp. Cần cấu hình và test đúng máy đích.
- [Docker security](https://docs.docker.com/engine/security/): Docker daemon và quyền mount làm tăng bề mặt tấn công; container mặc định không thay cho profile chạy code lạ.
- [Python command line](https://docs.python.org/3/using/cmdline.html): chế độ `-I` hỗ trợ cô lập môi trường Python nhưng không phải sandbox hệ điều hành.
- [SQLite WAL](https://www.sqlite.org/wal.html): giới hạn một host cho các tiến trình dùng chung DB WAL.
