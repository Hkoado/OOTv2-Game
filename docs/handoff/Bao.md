# Kết quả Bảo — UI / viewer / browser QA

## Trạng thái mới nhất

- Trạng thái: **IN PROGRESS / CHECKPOINT 11** — Hoàn thành UI Viewer Publication ván official (OfficialGameViewer, OfficialBroadcastDialog) & Chuẩn hóa cấu trúc vé `{ awarded, reserves, vacant }` theo contract §7.
- Phạm vi: B1–B4, Mục Chung kết thủ công, Viewer Replay & Live Broadcast Official theo [phân công Bảo](../assignments/Bao.md) & [docs/19 §7](../19-CONTRACT-TICH-HOP.md).
- Checkpoint: branch `dev` (đồng bộ với commit `aaac3d9` của Huy & `96f6231` của Khoa trên `origin/dev`).
- Tổng test suite hiện tại: **432/432 bài kiểm thử PASS** (100% thành công, 0 lỗi, 0 skip).
- Build production: **Vite build sạch** (1656 modules transformed, bundle `dist/` sẵn sàng trong ~10.8s).

---

## Phân định mức độ thực hiện: FULL / MOCK / PARTIAL

Theo yêu cầu điều lệ bàn giao, các thành phần kỹ thuật được phân định minh bạch như sau:

| Mức độ | Thành phần / Module | Chi tiết & Minh chứng |
| :--- | :--- | :--- |
| **FULL** *(Thực tế 100%)* | **Frontend UI Components** | Toàn bộ giao diện React 19: `OfficialGameViewer.jsx` (viewer phát sóng official theo server_time, countdown, cursor visible_plies, catch-up after_seq, reset/reconnect, 2 theme, không giấu replay), `OfficialBroadcastDialog.jsx` (admin đặt lịch phát sóng starts_at, ply_interval_ms, release_mode window/full), `OfficialRoundPanel.jsx` (bảng điều khiển K2/K3 §7: tiến độ, standings, bracket, tickets chuẩn `{awarded, reserves, vacant}`), `ManualFinalsPanel.jsx` (chung kết thủ công, nạp bot .py, lock snapshot, chấm trận, audit log), `SubmissionsPage.jsx` (đăng ký repo GitHub, duyệt BTC & thu hồi duyệt Admin, receipt SHA, USB offline fallback), `LivePage.jsx` (xử lý 401, ngắt poll 403, countdown, stream visible_plies), `BroadcastDialog.jsx` (đặt/hủy lịch phát MVP), `EventDetailPage.jsx` (bảng điểm chính thức theo DTO Khoa). |
| **FULL** *(Thực tế 100%)* | **Pure View Adapters & API Clients** | Các client/adapter: `officialRoundApi.js` (14 hàm API: progress, standings, bracket, tickets, jobs, broadcast state/scheduling/viewer), `manualFinalApi.js`, `publicationView.js`, `officialSetupView.js`, `githubSyncState.js` được kiểm thử 100% qua Node built-in test runner. |
| **FULL** *(Thực tế 100%)* | **Tài liệu Runbook Vận Hành** | Đã biên soạn đầy đủ 2 sổ tay thực tế: [`docs/runbook/SINH-VIEN.md`](../runbook/SINH-VIEN.md) (hướng dẫn thí sinh nộp bài GitHub & receipt) và [`docs/runbook/BAN-TO-CHUC.md`](../runbook/BAN-TO-CHUC.md) (hướng dẫn BTC cấu hình giải, duyệt & thu hồi repo, lên lịch phát, và quy trình ứng cứu khẩn cấp). |
| **FULL** *(Thực tế 100%)* | **Build Production Bundle** | `npm run build` đóng gói sạch sẽ toàn bộ mã nguồn frontend tại thư mục `dist/` (1,656 modules). |
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

## Lịch sử checkpoint

- 24/10/2026 (Checkpoint 11): **UI Viewer Publication ván official (OfficialGameViewer, OfficialBroadcastDialog) & Khớp DTO Vé `{ awarded, reserves, vacant }`**:
  - Tạo [`OfficialGameViewer.jsx`](../../src/tournament/portal/OfficialGameViewer.jsx):
    - Đồng bộ nghiêm ngặt theo `server_time`, countdown tới `starts_at` (tính delta từ server clock).
    - Render bàn cờ động solely từ mảng `events` thực tế server trả về qua cursor `after_seq` (catch-up liên tục).
    - **Không tải replay đầy đủ rồi giấu bằng UI**: Bàn cờ chỉ dựng đúng số nước `visible_plies` đã được công bố.
    - Kết quả trận đấu (`result`, `terminationReason`) chỉ hiển thị khi `reveal_result = true`.
    - Hỗ trợ nút Reconnect/Reset tải lại từ đầu, bắt chuẩn mã lỗi 401 (`login_required`), 403 (`scope_denied`), 404 (`broadcast_not_published`).
  - Tạo [`OfficialBroadcastDialog.jsx`](../../src/tournament/portal/OfficialBroadcastDialog.jsx): Admin đặt lịch phát sóng ván official (`starts_at`, `ply_interval_ms`, `release_mode`: window/full, `state`: scheduled/canceled).
  - Nâng cấp [`officialRoundApi.js`](../../src/tournament/portal/officialRoundApi.js) (thêm `fetchOfficialBroadcastState`, `scheduleOfficialBroadcast`, `fetchOfficialGameViewer`).
  - Sửa đổi Tab **Vé chung kết** trong [`OfficialRoundPanel.jsx`](../../src/tournament/portal/OfficialRoundPanel.jsx): Khớp cấu trúc object `{ awarded: [...], reserves: [...], vacant: number }` và `ranking`, tích hợp các nút Live Stream / Broadcast trực tiếp vào giao diện.
  - Thêm unit tests [`tests/officialBroadcastView.test.js`](../../tests/officialBroadcastView.test.js) (2/2 pass).
  - Kết quả kiểm thử: **432/432 tests PASS** (100%), Vite build sạch 1,656 modules.

- 24/10/2026 (Checkpoint 10): **Nối Panel vòng chính thức K2/K3 với §7 (docs/19)**:
  - Tạo và nâng cấp `officialRoundApi.js` (11 hàm API bọc trọn vẹn spec §7: `fetchOfficialProgress`, `fetchOfficialStandings`, `publishNextOfficialGame`, `freezeOfficialRound`, `fetchOfficialBracket`, `openNextKnockoutSeries`, `fetchOfficialTickets`, `cancelOfficialJob`, `requeueOfficialJob`).
  - Nâng cấp toàn diện `OfficialRoundPanel.jsx`: Sub-tab Tiến độ, Bảng xếp hạng (chỉ hiển thị, không tính điểm client), Nhánh Knockout, Vé chung kết, Modal lý do hủy/chấm lại job 5..400 ký tự.
  - Bổ sung unit test `tests/officialRoundApi.test.js` (2 tests).
  - Kết quả kiểm thử: **401/401 tests PASS** (100%), Vite build sạch 1,654 modules.

- 24/10/2026 (Checkpoint 9): **Khắc phục P1 — Tách callback mở Replay payload & Hỗ trợ Replay Campus Engine v2**:
  - Tách bạch hai luồng mở replay trong `LocalCore.jsx`: `onOpenReplay(matchId)` và `onOpenReplayPayload(data)`.
  - Nâng cấp `src/tournament/replay.js` (`buildReplayFrames`): hỗ trợ phân giải toàn diện cấu trúc Replay Campus v2 (`campus-engine-replay.v1`), gộp 2 setup kín thành frame 0 khởi đầu, diễn hoạt nước đi với địa hình map v2 và bắt sự kiện `bot_fault`.
  - Thêm bài test mới `tests/replayViewerCampus.test.js` (4 tests). Tests: 381/381 tests PASS.

- 24/10/2026 (Checkpoint 8): **Nối API thật cho Chung kết thủ công & Mở rộng phạm vi Cookie Session**:
  - Tạo client API `manualFinalApi.js` (10 hàm gọi API `/api/local/manual-finals/*`).
  - Nối toàn bộ UI `ManualFinalsPanel.jsx` với backend.
  - Mở rộng phạm vi cookie phiên `oot_local_session` sang `path: '/api'` tại `server/shared/router.js`. Tests: 372/372 tests PASS.

- 24/10/2026 (Checkpoint 7): **Chung kết thủ công (Manual Finals) & Bỏ CTA Upload Online sai scope**. Tests: 357/357 tests PASS.
- 24/10/2026 (Checkpoint 6): **Phân định rõ trạng thái xác thực trên Live View (LivePage.jsx)**. Tests: 317/317 pass.
- 24/10/2026 (Checkpoint 5): **Rà soát & Đồng bộ B1–B4 với phần H (H1–H4)**. Tests: 304/304 pass.
- 24/10/2026 (Checkpoint 4): Hoàn thành B4 (QA kịch bản, Load Testing 50/100/200 viewers, Runbooks). Tests: 256/256 pass.
- 24/10/2026 (Checkpoint 3): Hoàn thành B3 (Viewer lịch phát: publication API H3). Tests: 233/233 pass.
- 24/10/2026 (Checkpoint 2): Hoàn thành B2 (GitHub UI thật: kết nối API intake H1). Tests: 122/122 pass.
- 24/10/2026 (Checkpoint 1): Hoàn thành B1 (Setup UX, dirty draft guard). Tests: 100/100 pass.
- 23/10/2026: Tạo khung bàn giao ban đầu.
