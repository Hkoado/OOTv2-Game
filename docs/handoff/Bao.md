# Kết quả Bảo — UI / viewer / browser QA

## Trạng thái mới nhất

- Trạng thái: **READY FOR REVIEW** — hoàn thành milestone B3 (Viewer lịch phát: nối publication API H3, đếm ngược, nhịp phát theo server_time/visible_plies, afterSeq, bảng điều khiển đặt lịch Admin và bảng xếp hạng chính thức theo DTO Khoa).
- Phạm vi: B1, B2 & B3 trong [phân công Bảo](../assignments/Bao.md).
- Checkpoint: branch `dev` (trên nền commit `d0ad705` của Huy/Khoa).
- Đã hoàn thành và xác minh:
  1. Xây dựng module client API `src/tournament/portal/live/publicationApi.js` kết nối các endpoints H3 của Huy: `fetchViewerPackage`, `fetchEventBroadcasts`, `scheduleBroadcast`, `cancelBroadcast`.
  2. Xây dựng module pure helpers `src/tournament/portal/live/publicationView.js`: tính countdown thời gian thực, format MM:SS/HH:MM:SS, phân loại phase (`waiting`, `broadcasting`, `ended`, `hidden`), thanh tiến độ `computeViewerProgress`, và format bảng điểm chính thức theo điều lệ.
  3. Cập nhật `LivePage.jsx`:
     - Xử lý bắt buộc đăng nhập 401 `login_required` (thay thế chế độ ẩn danh cũ theo chính sách bảo mật H3).
     - Hiển thị thẻ Countdown đếm ngược chính xác tới `starts_at` khi `phase === 'waiting'`.
     - Stream nước đi theo `visible_plies` dựa trên giờ server, không tải sẵn replay để lộ trước kết quả; chỉ hiển thị kết quả và người thắng khi `reveal_result === true`.
     - Cơ chế dừng polling khi `next_poll_ms === null` hoặc khi ván phát xong; backoff khi tab ẩn (`document.visibilityState === 'hidden'`).
  4. Xây dựng `BroadcastDialog.jsx` và nâng cấp `EventDetailPage.jsx`:
     - Bảng điều khiển cho Admin đặt lịch phát ván đấu đã chấm (`starts_at` kèm timezone UTC/local, `ply_interval_ms`, `release_mode`).
     - Admin có thể hủy lịch phát trước giờ bắt đầu.
     - Bảng xếp hạng hỗ trợ động các bảng A–H, phân tách rõ ràng Điểm cặp (3/1/0) và Điểm ván (1/0.5/0) theo chuẩn DTO Khoa.
  5. Viết 7 bài kiểm thử đơn vị mới: `tests/publicationView.test.js` (6 tests) và `tests/publicationClientApi.test.js` (1 test mock).

---

## Chi tiết checkpoint B3

```text
Ngày / người / milestone / trạng thái:
24/10/2026 | Bảo (Frontend UI / QA) | Milestone B3: Viewer lịch phát & Publication UI | READY FOR REVIEW

Branch / commit code / PR / đã merge vào đâu:
dev | commit code hiện tại (tra bằng `git log -1`) | Chưa tạo PR remote | Tích hợp trực tiếp trên branch dev theo quy ước chung

Đã làm:
- Xây dựng module client API src/tournament/portal/live/publicationApi.js:
  + fetchViewerPackage: gọi GET /api/local/broadcasts/:matchId?afterSeq=
  + fetchEventBroadcasts: gọi GET /api/local/events/:id/broadcasts
  + scheduleBroadcast: gọi POST /api/local/admin/broadcasts kèm CSRF token
  + cancelBroadcast: gọi POST /api/local/admin/broadcasts/:matchId/cancel kèm CSRF token
- Xây dựng module helpers src/tournament/portal/live/publicationView.js:
  + calculateCountdown & formatTimeRemaining: tính số giây còn lại và hiển thị MM:SS hoặc HH:MM:SS
  + broadcastPhaseMeta: phân giải nhãn và tone cho các pha waiting, broadcasting, ended, hidden
  + computeViewerProgress: tính tỷ lệ % tiến độ phát sóng (visible_plies / total_plies)
  + formatReleaseMode: giải thích chế độ mở toàn bộ (full) vs mốc thời gian (window)
  + formatOfficialStandingsRow: adapter chuẩn cho bảng điểm chính thức theo DTO Khoa
- Cập nhật src/tournament/portal/live/LivePage.jsx:
  + Bắt lỗi 401 login_required và hiển thị banner thông báo đăng nhập có nút chuyển trang.
  + Thẻ đếm ngược thời gian thực (Countdown Card) khi ván đấu ở pha waiting.
  + Thanh tiến độ phát sóng và diễn hoạt nước cờ gia tăng khi broadcasting.
  + Chỉ hiển thị kết quả trận và cúp vô địch khi reveal_result = true.
  + Tự động dừng polling khi kết thúc hoặc ván không còn lịch phát (next_poll_ms = null).
- Xây dựng src/tournament/portal/BroadcastDialog.jsx:
  + Modal đặt lịch phát sóng ván đấu dành cho Admin (giờ phát, nhịp 500ms..5000ms, chế độ release full/window).
- Cập nhật src/tournament/portal/EventDetailPage.jsx:
  + Bổ sung cột "Lịch phát sóng" và nút Đặt lịch / Hủy lịch cho Admin trên bảng MatchTable.
  + Cập nhật StandingsTable: hiển thị động tất cả các bảng A–H, phân tách Điểm cặp (3/1/0) và Điểm ván (1/0.5/0) khi isOfficial = true.
- Viết 7 tests mới:
  + tests/publicationView.test.js (6 tests)
  + tests/publicationClientApi.test.js (1 test)

File / export / route / RPC quan trọng:
- src/tournament/portal/live/publicationApi.js
- src/tournament/portal/live/publicationView.js
- src/tournament/portal/live/LivePage.jsx
- src/tournament/portal/BroadcastDialog.jsx
- src/tournament/portal/EventDetailPage.jsx
- tests/publicationView.test.js
- tests/publicationClientApi.test.js

Contract thực hiện + ví dụ JSON không secret:
- Gói Viewer Package (GET /api/local/broadcasts/:matchId?afterSeq=):
  {
    "match_id": "match-uuid",
    "phase": "broadcasting",
    "server_time": "2026-10-24T01:50:00.000Z",
    "starts_at": "2026-10-24T01:45:00.000Z",
    "ply_interval_ms": 2000,
    "release_mode": "full",
    "visible_plies": 25,
    "total_plies": 48,
    "reveal_result": false,
    "next_poll_ms": 2000,
    "events": [{ "seq": 24, "kind": "move", "payload_json": "..." }]
  }

Migration thứ tự / applied chưa / env mới:
- Không có migration mới phía UI. Phụ thuộc migration 20261024150000_broadcast_schedule.sql của Huy. Không có biến môi trường mới.

Tests: lệnh | môi trường | exit | pass/fail/skip | vị trí log:
- npm test (node --test tests/*.test.js) | Windows local Node v22.13.0 | exit 0 | pass 219/219, fail 0, skip 0 | console stdout
- npm run build (vite build) | Windows local Node v22.13.0 | exit 0 | pass (1644 modules transformed, dist bundle sạch) | console stdout

NOT RUN + lý do:
- Test tải 50-200 concurrent viewer thực tế trên network: NOT RUN (thuộc milestone B4 QA).
- Headless browser automation E2E: NOT RUN (thuộc milestone B4 QA).

Giới hạn / bug còn lại / gate đang tắt / rủi ro:
- Kết quả ván chỉ mở khi release_mode = 'full' và phase = 'ended'. Nếu đặt 'window', kết quả luôn được giữ kín trên UI.
- Trang Live yêu cầu đăng nhập tài khoản hợp lệ thuộc giải (hoặc admin); người xem ẩn danh được hướng dẫn đăng nhập.

Dependency người khác + phần chưa tích hợp:
- Đã tích hợp hoàn tất với publication backend H3 của Huy và DTO thể thức K1 của Khoa.

Cách chạy demo và rollback:
- Demo Viewer và Lịch phát:
  + Chạy `npm run dev:api` và `npm run dev`.
  + Đăng nhập tài khoản admin -> mở chi tiết một giải đấu -> cuộn xuống Danh sách ván.
  + Với ván đã chấm xong (finished), bấm nút "Đặt lịch" -> chọn giờ phát -> Lưu.
  + Mở trang Live (`#/live`) -> quan sát thẻ Countdown đếm ngược hoặc xem nước phát trực tiếp theo tiến độ server.
- Rollback:
  + `git checkout HEAD~1 -- src/tournament/portal/live/LivePage.jsx src/tournament/portal/EventDetailPage.jsx`

Bước tiếp theo nhỏ nhất:
- Chuyển sang milestone B4: QA tổng thể sản phẩm, runbook vận hành giải đấu và kiểm thử tải viewer.
```

---

## Lịch sử checkpoint

- 24/10/2026 (Checkpoint 3): Hoàn thành B3 (Viewer lịch phát: nối publication API H3, countdown thời gian thực, server_time/visible_plies, sauSeq, đặt lịch phát Admin và bảng điểm chuẩn DTO Khoa). Tests: 219/219 pass.
- 24/10/2026 (Checkpoint 2): Hoàn thành B2 (GitHub UI thật: kết nối API intake H1, duyệt quyền, receipt, đồng bộ commit và USB fallback cho Admin). Tests: 122/122 pass.
- 24/10/2026 (Checkpoint 1): Hoàn thành B1 (Setup UX, dirty draft guard, timezone clarity UTC/local, dynamic groups A–H preview, 7 GitHub intake fixtures & adapters). Tests: 100/100 pass.
- 23/10/2026: Tạo khung bàn giao ban đầu.
