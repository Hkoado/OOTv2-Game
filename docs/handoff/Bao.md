# Kết quả Bảo — UI / viewer / browser QA

## Trạng thái mới nhất

- Trạng thái: **IN PROGRESS / CHECKPOINT 7** — Hoàn thành module **Chung kết thủ công (Manual Finals Panel)** cho BTC và làm sạch phạm vi nộp bài Online GitHub.
- Phạm vi: B1–B4 và Mục Chung kết thủ công theo quyết định 24/10/2026 trong [phân công Bảo](../assignments/Bao.md).
- Checkpoint: branch `Frontend-UI` (tách từ đỉnh `dev` mới nhất).
- Tổng test suite hiện tại: **357/357 bài kiểm thử PASS** (100% thành công, 0 lỗi, 0 skip).
- Build production: **Vite build sạch** (1653 modules transformed, bundle `dist/` sẵn sàng).

---

## Phân định mức độ thực hiện: FULL / MOCK / PARTIAL

Theo yêu cầu điều lệ bàn giao, các thành phần kỹ thuật được phân định minh bạch như sau:

| Mức độ | Thành phần / Module | Chi tiết & Minh chứng |
| :--- | :--- | :--- |
| **FULL** *(Thực tế 100%)* | **Frontend UI Components** | Toàn bộ giao diện React 19: `OfficialSetupPanel.jsx` (bảo vệ dirty draft, conflict reload), `SubmissionsPage.jsx` (đăng ký repo GitHub, duyệt BTC & thu hồi duyệt Admin, receipt SHA, USB offline fallback), `LivePage.jsx` (xử lý 401, ngắt poll 403, countdown, stream visible_plies), `BroadcastDialog.jsx` (đặt/hủy lịch phát), `EventDetailPage.jsx` (bảng điểm chính thức theo DTO Khoa). |
| **FULL** *(Thực tế 100%)* | **Pure View Adapters** | Các hàm thuần không phụ thuộc DOM: `publicationView.js`, `officialSetupView.js`, `githubSyncState.js` được kiểm thử 100% qua Node built-in test runner. |
| **FULL** *(Thực tế 100%)* | **Tài liệu Runbook Vận Hành** | Đã biên soạn đầy đủ 2 sổ tay thực tế: [`docs/runbook/SINH-VIEN.md`](../runbook/SINH-VIEN.md) (hướng dẫn thí sinh nộp bài GitHub & receipt) và [`docs/runbook/BAN-TO-CHUC.md`](../runbook/BAN-TO-CHUC.md) (hướng dẫn BTC cấu hình giải, duyệt & thu hồi repo, lên lịch phát, và quy trình ứng cứu khẩn cấp). |
| **FULL** *(Thực tế 100%)* | **Build Production Bundle** | `npm run build` đóng gói sạch sẽ toàn bộ mã nguồn frontend tại thư mục `dist/` trong ~3.4s. |
| **MOCK** *(Mô phỏng có kiểm soát)* | **Kịch bản QA người dùng (Scenario QA)** | File [`tests/portalScenarios.test.js`](../../tests/portalScenarios.test.js) (6/6 tests pass): kiểm thử đa vai trò (Team / Admin), cô lập phiên đăng nhập/đăng xuất, bảo vệ dirty draft form, hàng rào bảo mật 401 login_required và 403 scope_denied, vòng đời phát trực tiếp (waiting -> broadcasting -> ended window vs full), và kiểm tra DTO bảng điểm. Chạy trên in-process HTTP mock server của Express. |
| **MOCK** *(Mô phỏng có kiểm soát)* | **Thử nghiệm tải Viewer (Load Testing)** | File [`tests/viewerLoadSimulation.test.js`](../../tests/viewerLoadSimulation.test.js) (3/3 tests pass): đo đạc thực tế độ trễ và thông lượng khi 50, 100, 200 concurrent viewers cùng polling `/api/live/overview` và `/api/local/broadcasts/:matchId`. |
| **PARTIAL / NOT RUN** | **PostgreSQL Remote Supabase** | **POSTGRES APPLIED / DRILL 30/30** — Phía Huy (H4) đã apply 10/10 migration lên Supabase thật và drill 2 worker đạt 30/30. Tuy nhiên đo tải 50–200 viewers trên project Supabase thật từ browser vẫn giữ NOT RUN theo kế hoạch (chờ disposable DB riêng). |
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

## Chi tiết checkpoint rà soát B1–B4 sau thay đổi phần H (H1–H4)

```text
Ngày / người / milestone / trạng thái:
24/10/2026 | Bảo (Frontend UI / QA) | Rà soát & Đồng bộ B1–B4 với phần H (H1–H4) | READY FOR REVIEW

Branch / commit code / PR / đã merge vào đâu:
dev | commit code hiện tại (tra bằng `git log -1`) | Chưa tạo PR remote | Tích hợp trực tiếp trên branch dev theo quy ước chung

Các nội dung đã rà soát và điều chỉnh:
1. B1 (Setup UX & Draft Protection):
   - Khớp 100% với DTO H1 và migration 20261023160000_official_setup.sql.
   - Nhớ tài khoản (rememberAccount.js) được Huy bổ sung độc lập tại LoginScreen mà không làm ảnh hưởng đến OfficialSetupPanel.
2. B2 (GitHub Intake UI & Approval):
   - Bổ sung hàm `revokeRepositoryConnection` vào `githubApi.js` (gọi DELETE /api/local/events/:id/repository?team=...).
   - Bổ sung nút "Thu hồi phê duyệt" cho Admin trong `SubmissionsPage.jsx` khi repository đã được duyệt, bảo đảm admin có quyền hủy duyệt và hủy job đang chờ theo contract H2 hardening.
   - Ghi nhận việc Huy đã apply 10 migration lên Supabase thật (`cfc7a77`), sửa dứt điểm lỗi thiếu RPC `mvp_repo_connection_upsert` khi lưu repo.
   - Giữ nguyên cơ chế đóng cổng upload HTTP (`403 upload_disabled`), chỉ hiển thị fallback USB cho Admin khi có cờ OOTV2_ALLOW_ONLINE_UPLOAD.
3. B3 (Publication Viewer & Live Stream):
   - Khớp chính sách H3 privacy: Live View đưa vào trong login, xử lý 401 (nhắc login) và 403 (dừng poll chéo giải).
   - Tiến độ visible_plies, countdown waiting, và mở kết quả window vs full đồng bộ 100% với server.
4. B4 (QA Scenarios, Load Testing & Runbooks):
   - Cập nhật tài liệu BAN-TO-CHUC.md bổ sung quy trình Thu hồi duyệt repo (Revoke).
   - Kiểm thử toàn bộ 304 bài test PASS, không có hồi quy nào.

File / export / route / RPC quan trọng:
- src/tournament/portal/githubApi.js (thêm revokeRepositoryConnection)
- src/tournament/portal/SubmissionsPage.jsx (thêm nút Thu hồi phê duyệt cho Admin)
- docs/runbook/BAN-TO-CHUC.md (bổ sung quy trình Revoke)
- tests/portalScenarios.test.js
- tests/viewerLoadSimulation.test.js

Tests: lệnh | môi trường | exit | pass/fail/skip | vị trí log:
- npm test (node --test tests/*.test.js) | Windows local Node v22.13.0 | exit 0 | pass 304/304, fail 0, skip 0 | console stdout
- npm run build (vite build) | Windows local Node v22.13.0 | exit 0 | pass (1650 modules transformed, dist bundle sạch) | console stdout

NOT RUN + lý do:
- Test tải trên DB Supabase thật từ browser: NOT RUN (chờ disposable DB riêng do BTC cấp phép).
- Sandbox worker Linux cấp OS: NOT RUN (thuộc mốc K4 của Khoa, chờ hạ tầng VM độc lập).
- Test headless browser qua mạng LAN/Internet: NOT RUN (chỉ chạy nội bộ loopback 127.0.0.1 theo chính sách bảo mật).
```

---

## Lịch sử checkpoint

- 24/10/2026 (Checkpoint 7): **Chung kết thủ công (Manual Finals) & Bỏ CTA Upload Online sai scope**:
  - Tạo nhánh `Frontend-UI` độc lập từ `dev`.
  - Xây dựng component mới [`ManualFinalsPanel.jsx`](../../src/tournament/portal/ManualFinalsPanel.jsx): Quản lý vòng đấu chung kết, 5 bản đồ Campus v2, BTC nạp bot theo đội ($\le 256\text{ KiB}$ .py), tính toán băm SHA-256, khóa bài thi đấu (Lock snapshot immutability), kích hoạt máy chấm Worker, hiển thị kết quả chính thức từ engine OOTv2, xem Replay và hủy/chấm lại bắt buộc có lý do kiểm toán (Audit reason).
  - Tích hợp tab **"Chung kết thủ công"** trong [`EventDetailPage.jsx`](../../src/tournament/portal/EventDetailPage.jsx) cho Ban tổ chức.
  - Làm sạch [`SubmissionsPage.jsx`](../../src/tournament/portal/SubmissionsPage.jsx): Bỏ CTA nộp USB gây hiểu nhầm sang mục Chung kết thủ công chuẩn scope.
  - Thêm bài test tự động [`tests/manualFinals.test.js`](../../tests/manualFinals.test.js) (4 tests).
  - Kết quả kiểm thử: **357/357 tests PASS**, `npm run build` thành công 1653 modules.
- 24/10/2026 (Checkpoint 6): **Phân định rõ trạng thái xác thực trên Live View (LivePage.jsx)**:
  - Kiểm tra `account`: chỉ hiển thị cảnh báo chính sách H3 và nút *"Đăng nhập ngay"* khi người dùng **chưa đăng nhập** (`!account`).
  - Khi đã đăng nhập (`account`): ẩn cảnh báo yêu cầu đăng nhập, hiển thị thông tin tài khoản và đưa ra chỉ dẫn rõ ràng kèm nút *"Quay về trang tài khoản"*.
  - Đồng bộ điều hướng linh hoạt giữa `LocalCore.jsx` và `LivePage.jsx`. Tests: 317/317 pass, build pass.
- 24/10/2026 (Checkpoint 5): **Rà soát & Đồng bộ B1–B4 với phần H (H1–H4)**: Thêm nút Thu hồi phê duyệt repo cho Admin (`DELETE /repository`), đồng bộ DTO, cập nhật Runbook BTC và xác nhận lỗi RPC DB thật đã được Huy giải quyết qua 10 migration. Tests: 304/304 pass, build pass.
- 24/10/2026 (Checkpoint 4): Hoàn thành B4 (QA kịch bản người dùng, Thử nghiệm tải mô phỏng 50/100/200 viewers, và Runbook vận hành cho Sinh viên & Ban tổ chức; phân định rõ FULL / MOCK / PARTIAL). Tests: 256/256 pass.
- 24/10/2026 (Checkpoint 3): Hoàn thành B3 (Viewer lịch phát: nối publication API H3, countdown thời gian thực, server_time/visible_plies, sauSeq, đặt lịch phát Admin và bảng điểm chuẩn DTO Khoa). Tests: 233/233 pass.
- 24/10/2026 (Checkpoint 2): Hoàn thành B2 (GitHub UI thật: kết nối API intake H1, duyệt quyền, receipt, đồng bộ commit và USB fallback cho Admin). Tests: 122/122 pass.
- 24/10/2026 (Checkpoint 1): Hoàn thành B1 (Setup UX, dirty draft guard, timezone clarity UTC/local, dynamic groups A–H preview, 7 GitHub intake fixtures & adapters). Tests: 100/100 pass.
- 23/10/2026: Tạo khung bàn giao ban đầu.
