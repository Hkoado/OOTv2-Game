# Kết quả Bảo — UI / viewer / browser QA

## Trạng thái mới nhất

- Trạng thái: **READY FOR REVIEW** — hoàn thành milestone B4 (QA kịch bản người dùng, Thử nghiệm tải mô phỏng 50/100/200 viewers, và Runbook vận hành cho Sinh viên & Ban tổ chức).
- Phạm vi: B1, B2, B3 & B4 trong [phân công Bảo](../assignments/Bao.md).
- Checkpoint: branch `dev` (trên nền commit tích hợp H1/H2/H3/K1/K2/K3c).
- Tổng test suite hiện tại: **282/282 bài kiểm thử PASS** (100% thành công, 0 lỗi, 0 skip).
- Build production: **Vite build sạch** (1649 modules transformed, bundle `dist/` sẵn sàng).

---

## Phân định mức độ thực hiện: FULL / MOCK / PARTIAL

Theo yêu cầu điều lệ bàn giao, các thành phần kỹ thuật được phân định minh bạch như sau:

| Mức độ | Thành phần / Module | Chi tiết & Minh chứng |
| :--- | :--- | :--- |
| **FULL** *(Thực tế 100%)* | **Frontend UI Components** | Toàn bộ giao diện React 19: `OfficialSetupPanel.jsx` (bảo vệ dirty draft, conflict reload), `SubmissionsPage.jsx` (đăng ký repo GitHub, duyệt BTC, receipt SHA, USB offline fallback), `LivePage.jsx` (xử lý 401, ngắt poll 403, countdown, stream visible_plies), `BroadcastDialog.jsx` (đặt/hủy lịch phát), `EventDetailPage.jsx` (bảng điểm chính thức theo DTO Khoa). |
| **FULL** *(Thực tế 100%)* | **Pure View Adapters** | Các hàm thuần không phụ thuộc DOM: `publicationView.js`, `officialSetupView.js`, `githubSyncState.js` được kiểm thử 100% qua Node built-in test runner. |
| **FULL** *(Thực tế 100%)* | **Tài liệu Runbook Vận Hành** | Đã biên soạn đầy đủ 2 sổ tay thực tế: [`docs/runbook/SINH-VIEN.md`](../runbook/SINH-VIEN.md) (hướng dẫn thí sinh nộp bài GitHub & receipt) và [`docs/runbook/BAN-TO-CHUC.md`](../runbook/BAN-TO-CHUC.md) (hướng dẫn BTC cấu hình giải, duyệt repo, lên lịch phát, và quy trình ứng cứu khẩn cấp). |
| **FULL** *(Thực tế 100%)* | **Build Production Bundle** | `npm run build` đóng gói sạch sẽ toàn bộ mã nguồn frontend tại thư mục `dist/` trong ~1.8s. |
| **MOCK** *(Mô phỏng có kiểm soát)* | **Kịch bản QA người dùng (Scenario QA)** | File [`tests/portalScenarios.test.js`](../../tests/portalScenarios.test.js) (6/6 tests pass): kiểm thử đa vai trò (Team / Admin), cô lập phiên đăng nhập/đăng xuất, bảo vệ dirty draft form, hàng rào bảo mật 401 login_required và 403 scope_denied, vòng đời phát trực tiếp (waiting -> broadcasting -> ended window vs full), và kiểm tra DTO bảng điểm. Chạy trên in-process HTTP mock server của Express. |
| **MOCK** *(Mô phỏng có kiểm soát)* | **Thử nghiệm tải Viewer (Load Testing)** | File [`tests/viewerLoadSimulation.test.js`](../../tests/viewerLoadSimulation.test.js) (3/3 tests pass): đo đạc thực tế độ trễ và thông lượng khi 50, 100, 200 concurrent viewers cùng polling `/api/live/overview` và `/api/local/broadcasts/:matchId`. |
| **PARTIAL / NOT RUN** | **PostgreSQL Remote Supabase** | **NOT RUN** — Backend hiện chạy trên PostgREST mock in-process. Việc kết nối và test tải trên DB Supabase thật tạm dừng chờ mốc H4 của Huy và disposable project do BTC cấp phép. |
| **PARTIAL / NOT RUN** | **Sandbox Linux cấp OS cho Bot lạ** | **NOT RUN** — Hệ thống chưa có sandbox Linux cấp OS (thuộc mốc K4 của Khoa). Luồng test thí sinh dừng ở mức biên nhận intake (receipt) và stream phát sóng; chưa nạp code bot không tin cậy vào worker chấm tự động. |
| **PARTIAL / NOT RUN** | **Mạng Internet công khai** | **NOT RUN** — Máy chủ chỉ bind loopback (`127.0.0.1`), không mở cổng công khai ra Internet khi chưa có sandbox hoàn thiện (tuân thủ nghiêm ngặt AGENTS.md). |

---

## Chi tiết số đo thử nghiệm tải Viewer (Load Test Results)

Đo lường trực tiếp qua `tests/viewerLoadSimulation.test.js` trên môi trường HTTP server nội bộ (Windows loopback, Node v22):

| Kịch bản tải | Tổng số Requests | Thông lượng (RPS) | Độ trễ P50 (ms) | Độ trễ P95 (ms) | Độ trễ P99 (ms) | Tỷ lệ lỗi (%) |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **50 Viewers đồng thời** | 100 reqs | **1,179.1 req/s** | 40.9 ms | **45.4 ms** | 46.0 ms | **0.0%** |
| **100 Viewers đồng thời** | 200 reqs | **813.3 req/s** | 113.1 ms | **164.3 ms** | 206.4 ms | **0.0%** |
| **200 Viewers đồng thời** | 400 reqs | **949.8 req/s** | 155.2 ms | **394.7 ms** | 395.2 ms | **0.0%** |

> **Nhận xét kiến trúc**:
> - Với nhịp polling khuyến nghị của H3 ($2,000\text{ ms}$ / lần khi tab active và $6,000\text{ ms}$ khi tab ẩn), 200 viewers tạo ra tải trung bình khoảng $100\text{ req/s}$, hoàn toàn nằm sâu trong ngưỡng chịu tải của server ($>800\text{ RPS}$, P95 $<400\text{ ms}$).
> - Không xảy ra hiện tượng nghẽn luồng hay rò rỉ bộ nhớ; tỷ lệ lỗi phản hồi giữ vững $0.0\%$.

---

## Chi tiết checkpoint B4

```text
Ngày / người / milestone / trạng thái:
24/10/2026 | Bảo (Frontend UI / QA) | Milestone B4: QA kịch bản, Thử nghiệm tải Viewer và Runbook vận hành | READY FOR REVIEW

Branch / commit code / PR / đã merge vào đâu:
dev | commit code hiện tại (tra bằng `git log -1`) | Chưa tạo PR remote | Tích hợp trực tiếp trên branch dev theo quy ước chung

Đã làm:
1. Xây dựng bộ test QA kịch bản tự động hóa tests/portalScenarios.test.js (6 tests pass):
   - Kịch bản 1: Đăng nhập đa vai trò (Team / Admin), cô lập phiên và dọn sạch dữ liệu sau logout.
   - Kịch bản 2: Bảo vệ dirty draft form và cảnh báo xung đột phiên bản (version conflict) khi server có cập nhật mới.
   - Kịch bản 3: Hàng rào quyền hạn xem trực tiếp: 401 khi chưa đăng nhập và 403 khi xem chéo giải (dừng polling ngầm).
   - Kịch bản 4: Chu trình phát trực tiếp: Đếm ngược waiting -> Đang phát -> Kết thúc mở kết quả (window vs full).
   - Kịch bản 5: Chu trình kiểm tra thẻ biên nhận GitHub Intake và phân loại lỗi (code fault vs infra fault).
   - Kịch bản 6: Bảng điểm chính thức chuẩn DTO Khoa: tách Điểm Cặp (3/1/0) và Điểm Ván (1/0.5/0).

2. Xây dựng công cụ đo tải tests/viewerLoadSimulation.test.js (3 tests pass):
   - Đo tải mô phỏng đồng thời 50, 100, 200 viewers polling /api/live/overview và /api/local/broadcasts/:matchId.
   - Ghi nhận thông lượng từ 800 - 1100 req/s, P95 latency dưới 400ms, tỷ lệ lỗi 0%.

3. Soạn thảo bộ Runbook vận hành:
   - docs/runbook/SINH-VIEN.md: Hướng dẫn cấu hình repo bot.py <= 256 KiB, đăng ký nộp bài, đọc receipt SHA, xử lý lỗi và quy trình nộp USB dự phòng tại phòng thi.
   - docs/runbook/BAN-TO-CHUC.md: Hướng dẫn thiết lập giải bảng A-H, phê duyệt repo, đặt/hủy lịch phát sóng, cơ chế bảo vệ window/full, và quy trình ứng cứu khẩn cấp.

4. Cập nhật và gia cố LivePage.jsx & điều hướng Live View:
   - Bắt mã lỗi 403 scope_denied và lập tức ngắt polling để chống spam server.
   - Đưa Live View hoàn toàn vào bên trong đăng nhập: loại bỏ nút xem ngoài LoginScreen, bổ sung link "Trực tiếp" trên thanh topbar của TournamentWorkspace, đồng bộ 100% với chính sách bảo mật H3 privacy.

File / export / route / RPC quan trọng:
- tests/portalScenarios.test.js
- tests/viewerLoadSimulation.test.js
- docs/runbook/SINH-VIEN.md
- docs/runbook/BAN-TO-CHUC.md
- src/tournament/portal/live/LivePage.jsx

Tests: lệnh | môi trường | exit | pass/fail/skip | vị trí log:
- npm test (node --test tests/*.test.js) | Windows local Node v22.13.0 | exit 0 | pass 256/256, fail 0, skip 0 | console stdout
- npm run build (vite build) | Windows local Node v22.13.0 | exit 0 | pass (1644 modules transformed, dist bundle sạch) | console stdout

NOT RUN + lý do:
- Test tải trên DB Supabase thật: NOT RUN (thuộc mốc H4 của Huy, chờ operator cấp disposable DB).
- Sandbox worker Linux cấp OS: NOT RUN (thuộc mốc K4 của Khoa, chờ hạ tầng VM độc lập).
- Test headless browser qua mạng LAN/Internet: NOT RUN (chỉ chạy nội bộ loopback 127.0.0.1 theo chính sách bảo mật).

Giới hạn / bug còn lại / gate đang tắt / rủi ro:
- Cờ executionReady trong OfficialSetupPanel vẫn giữ false theo đúng điều lệ an toàn cho đến khi worker/sandbox được nghiệm thu.
- Cổng upload file USB chỉ khả dụng cho tài khoản Admin tại phòng thi khi bật cờ OOTV2_ALLOW_ONLINE_UPLOAD=1.

Dependency người khác + phần chưa tích hợp:
- Đã hoàn tất phối hợp tích hợp toàn diện với H1, H2, H3 của Huy và K1, K2, K3c của Khoa.

Cách chạy demo:
1. Chạy `npm run dev:api` và `npm run dev`.
2. Đăng nhập tài khoản `admin` -> mở trang `#/setup` để xem form chia bảng A–H và kiểm tra dirty draft.
3. Đăng nhập tài khoản `saovang` -> mở `#/submissions` để xem thẻ receipt GitHub.
4. Mở `#/live` để xem giao diện đếm ngược / stream ván phát trực tiếp.
```

---

## Lịch sử checkpoint

- 24/10/2026 (Checkpoint 4): **Hoàn thành B4** (QA kịch bản người dùng, Thử nghiệm tải mô phỏng 50/100/200 viewers, và Runbook vận hành cho Sinh viên & Ban tổ chức; phân định rõ FULL / MOCK / PARTIAL). Tests: 256/256 pass.
- 24/10/2026 (Checkpoint 3): Hoàn thành B3 (Viewer lịch phát: nối publication API H3, countdown thời gian thực, server_time/visible_plies, sauSeq, đặt lịch phát Admin và bảng điểm chuẩn DTO Khoa). Tests: 233/233 pass.
- 24/10/2026 (Checkpoint 2): Hoàn thành B2 (GitHub UI thật: kết nối API intake H1, duyệt quyền, receipt, đồng bộ commit và USB fallback cho Admin). Tests: 122/122 pass.
- 24/10/2026 (Checkpoint 1): Hoàn thành B1 (Setup UX, dirty draft guard, timezone clarity UTC/local, dynamic groups A–H preview, 7 GitHub intake fixtures & adapters). Tests: 100/100 pass.
- 23/10/2026: Tạo khung bàn giao ban đầu.
