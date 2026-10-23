# AGENTS.md — Chỉ dẫn bắt buộc cho AI coding agent (OOTv2 Tournament MVP)

## Tài liệu mở rộng và thứ tự ưu tiên (22/10/2026)

### Quyết định hiện hành ngày 23/10/2026

- **Yêu cầu tiếp theo ngày 23/10:** chuyển thiết lập giải mới sang điều lệ chính thức, không tạo giải MVP 8 đội. Đọc `docs/16-THIET-LAP-CHINH-THUC-VA-CHIA-VIEC.md` và `docs/assignments/{Huy,Bao,Khoa}.md`. Người dùng đã cho phép chia việc 3 thành viên; thay quyết định làm tuần tự bên dưới đối với kế hoạch mới. Không tự tạo worktree hay deploy.
- `campus-setup.v1` chỉ là cấu hình/dự kiến (400 plies là profile đích); chưa được chấm bằng worker MVP. Giữ nguyên profile/replay cũ 256 KiB / 200 plies. Không tuyên bố scheduler chính thức, GitHub intake hoặc sandbox đã xong.
- Supabase là DB duy nhất; các mục SQLite bên dưới là lịch sử, không phục hồi driver cũ.
- Đợt chấm trước/phát trận theo `docs/14-KIEN-TRUC-CHAM-TRUOC-VA-PHAT-TRAN.md` giữ profile MVP 256 KiB / 200 plies; không tự đổi sang Campus 400 plies/persistent protocol.
- GitHub repo + SHA/job/receipt là luồng online mục tiêu; một file `bot.py`, không clone/execute trên API. Upload hiện tại chỉ là đường tương thích trusted-dev, không phải M1 đã hoàn tất.
- Làm tuần tự bằng một agent trong workspace hiện tại. Đọc `docs/15-BAN-GIAO-TIEP-TUC.md` để tiếp tục M1; kế hoạch nhiều agent đã hủy theo yêu cầu người dùng. Không tự tạo worktree/nhánh điều phối, deploy hoặc apply migration remote.
- Chưa có sandbox cấp OS: chỉ chạy bot tin cậy. Serverless entrypoint không đồng nghĩa đủ điều kiện mở nhận bài công khai.

Đọc [mục lục docs mới](docs/README.md) và [trạng thái code](docs/07-TRANG-THAI-TRIEN-KHAI.md)
trước danh sách MVP bên dưới. Với tính năng Campus, ưu tiên bộ `00-` đến `06-` mới;
docs dùng `_` mô tả profile MVP lịch sử. Các quyết định mới về GitHub, 256 KiB/400 plies,
protocol persistent, map, thể thức và quyền xem thay thế yêu cầu MVP tương ứng, có version/migration.
Giữ nguyên nguyên tắc bảo toàn app/game phòng, framework và không mở thực thi code lạ khi thiếu sandbox.
Mỗi đợt làm một milestone; không báo hoàn tất các tính năng mới chỉ vì đã có docs.

UI tham chiếu [tích hợp repo](docs/05-TICH-HOP-UI-VA-REPO.md) và
[style kit](docs/ui-style/README.md). Nền tảng M1 nằm ở `server/judge/campusEngine.js`,
độc lập với runner/replay MVP; đọc trạng thái trước khi nối vào API hoặc worker.

> Mục đích: phát triển **tiếp trên repository đang mở trong VS Code**, không tạo project mới.
> Đây là quy ước công việc dành cho DeepSeek / các code agent. Đọc toàn bộ tài liệu trước khi chỉnh code.

## 1. Đọc đúng thứ tự

1. `docs/01_MVP_SCOPE_ARCHITECTURE.md`: mục tiêu, hiện trạng repo, phạm vi và kiến trúc.
2. `docs/02_BOT_WORKER_PROTOCOL.md`: giao thức Python bot, judge, giới hạn thời gian và lưu ý cô lập.
3. `docs/03_API_DATABASE_UI.md`: dữ liệu, API, giao diện.
4. `docs/04_IMPLEMENTATION_CHECKLIST.md`: từng giai đoạn, kiểm thử, điều kiện hoàn thành.
5. `docs/05_AGENT_PROMPTS.md`: các prompt dùng khi triển khai từng giai đoạn.
6. `examples/sample_bot.py`: ví dụ bot hợp lệ theo giao thức.

## 2. Quy tắc không được vi phạm

- Không thay thế ứng dụng Vite/React hiện tại; KHÔNG viết lại UI/game engine từ đầu.
- Không dùng Docker, Docker Compose, Kubernetes, Redis, RabbitMQ, microservices, ORM lớn hoặc CI/CD phức tạp cho MVP.
- Giữ nguyên chế độ 2 người chơi / phòng / spectator đang hoạt động qua `src/sync/usePlayRoom.js`.
- Tái sử dụng logic có sẵn của `src/game/constants.js`, `src/game/rules.js`, `src/game/gameState.js` cho tournament server. **Server là nguồn xác thực cuối cùng**; bot không được tự tuyên bố thắng hoặc tự sửa state.
- Phải giữ đúng luật OOTv2: bàn 9x9; 9 quân mỗi bên (3 rock, 3 paper, 3 scissors); Đỏ xếp trước, Xanh xếp sau và được biết vị trí xếp của Đỏ; Đỏ đi trước; 8 hướng; căn cứ thắng là chiếm nhà chính hoặc diệt sạch một loại quân đối thủ.
- Chỉ nhận **một file Python `.py`**, dùng Python 3.12+ và thư viện chuẩn; không nhận ZIP, Python package, yêu cầu `pip install`, source URL hoặc file thực thi.
- Worker chạy bot bằng tiến trình con riêng (không dùng `eval`, `exec`, `vm` của Node để thực thi file bot, không import code bot vào API/worker).
- **KHÔNG gọi subprocess là sandbox an toàn.** Chế độ MVP `local-dev` chạy code của thành viên nhóm được tin tưởng trên máy thử nghiệm/VM riêng, API chỉ bind loopback; không cho phép người lạ upload qua Internet. Việc triển khai công khai là OUT OF SCOPE cho đến khi có cô lập cấp hệ điều hành đã kiểm thử.
- Không dùng `shell: true`; không đưa filename người dùng vào đường dẫn thực thi; có timeout, giới hạn stdout/stderr, giới hạn kích thước file, cleanup process; xử lý exception không làm chết worker.
- Không dùng `Math.random()` hoặc `Date.now()` để quyết định kết quả bốc thăm/fallback mà không lưu lại seed. Replay phải có `seed`, trạng thái ban đầu và danh sách nước đi.
- Ưu tiên giải pháp đơn giản, dễ test; không tự ý mở rộng scope, không đổi framework nếu không bắt buộc.

## 3. Quy ước làm việc với repo hiện tại

1. **Kiểm tra nhánh/git status trước**; không ghi đè thay đổi chưa commit của người dùng.
2. Mở file thật để đối chiếu API/export, không giả định README luôn phản ánh 100% code.
3. Chạy `npm install`, `npm run build` để xác lập baseline; nếu baseline lỗi, báo rõ trước khi sửa.
4. Mỗi lần **chỉ triển khai 1 milestone**, sửa ít file nhất có thể, báo file đã đổi và lệnh test.
5. Không xóa các components gốc. Thêm UI Tournament bằng tab/route nhẹ phù hợp cấu trúc App đang có.
6. Nếu cần sửa hàm trong gameState.js, đảm bảo các chế độ chơi cũ vẫn chạy; thêm kiểm thử hồi quy.
7. Viết kiểm thử Node built-in test runner (`node --test`) để hạn chế dependency.
8. Không thêm tính năng trước khi milestone hiện tại chạy được end-to-end.

## 4. Công nghệ được chốt cho MVP

- Frontend: giữ React 19 + Vite + CSS hiện tại.
- Backend: **Node.js 22+**, JavaScript ESM, Express.
- DB: SQLite, đề xuất `better-sqlite3` (kiểm tra tương thích Node/máy thật trước khi cài).
- Upload: `multer` với giới hạn kích thước; lưu file ngoài `public/`, `src/`, `dist/`.
- Worker: một tiến trình Node.js riêng, tuần tự xử lý 1 trận, polling SQLite; Python bot = process mới cho từng request.
- Realtime MVP: frontend `fetch` polling 2–3 giây; không tạo WebSocket mới.
- Chạy local: frontend Vite, backend API và worker là ba tiến trình dev. Không yêu cầu chạy trên Vercel cho API/worker.

## 5. Cách trả lời sau mỗi milestone

Báo cáo bằng tiếng Việt, ngắn gọn nhưng đủ thông tin:
- Đã thực hiện gì? Các file nào thay đổi?
- Lệnh đã chạy và kết quả? Có test nào chưa chạy?
- Có vi phạm hoặc thay đổi quyết định thiết kế không?
- Milestone kế tiếp là gì? **Dừng tại đó**, chờ lệnh tiếp theo, không tự làm tràn scope.

## 6. Tiêu chuẩn Done

- Có demo thao tác được bằng trình duyệt + bot mẫu.
- Có test rule / protocol / worker / standings / knockout ở mức cần thiết.
- Chế độ game cũ vẫn hoạt động.
- Không để người chưa được tin cậy upload code vào server công khai.
- Có hướng dẫn chạy cụ thể tại README (bổ sung, không xóa nội dung cũ).
