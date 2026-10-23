# Kết quả Bảo — UI / viewer / browser QA

## Trạng thái mới nhất

- Trạng thái: **READY FOR REVIEW** — hoàn thành milestone B1 (Setup + trạng thái chuẩn theo điều lệ).
- Phạm vi: B1 trong [phân công Bảo](../assignments/Bao.md).
- Checkpoint: branch `dev` (trên nền commit `bb9cb4e`).
- Đã hoàn thành và xác minh:
  1. Bảo vệ dirty draft trong `OfficialSetupPanel.jsx`: polling ngầm không ghi đè thay đổi khi người dùng đang chỉnh sửa.
  2. Tự động đồng bộ draft với server khi chưa sửa (`!dirty`).
  3. Cảnh báo và phát hiện xung đột phiên bản (`detectVersionConflict`) khi máy chủ có `event.version > baseVersion`.
  4. Hiển thị múi giờ Cutoff hai chiều: Giờ địa phương máy người dùng (kèm tên múi giờ) và chuỗi ISO chuẩn UTC lưu trên server; cảnh báo thời điểm cutoff đã qua.
  5. Trình bày dự kiến phân bảng động A–H và độ cân bằng bảng (độ lệch tối đa <= 1 đội) theo `competitionPreview`.
  6. Thể thức tháng / kỳ (bracket 8, ngoại lệ 6 đội có 2 bye kỳ 3 tháng) và nhắc nhở xếp hạt giống theo thành tích cấp vé thay vì danh sách đăng ký.
  7. Giữ nguyên `executionReady: false` và thông báo blocker (không có nút start giả mạo khi scheduler/sandbox chưa sẵn sàng).
  8. Xây dựng bộ DTO adapter và 7 fixtures chuẩn theo contract nộp bài GitHub của Huy (`resolving`, `fetching`, `checking`, `valid`, `invalid`, `infrastructure`, `frozen`).

---

## Chi tiết checkpoint B1

```text
Ngày / người / milestone / trạng thái:
24/10/2026 | Bảo (Frontend UI / QA) | Milestone B1: Setup + trạng thái chuẩn | READY FOR REVIEW

Branch / commit code / PR / đã merge vào đâu:
dev | commit code hiện tại (tra bằng `git log -1`) | Chưa tạo PR remote | Làm việc trực tiếp trên branch dev theo quy ước bàn giao

Đã làm:
- Nâng cấp OfficialSetupPanel:
  + useEffect bảo vệ dirty draft: chỉ cập nhật form từ polling ngầm khi !dirty; nếu đang dirty và server có version mới hơn, hiển thị Alert tone="danger" cảnh báo xung đột kèm nút nạp lại bản server.
  + Thêm chức năng nạp lại bản server (reloadFromServer) có hộp thoại xác nhận nếu có thay đổi chưa lưu.
  + Bắt lỗi khi saveEvent thất bại (xung đột expectedVersion hoặc lỗi mạng) và hiển thị thông báo lỗi rõ ràng.
- Xây dựng module src/tournament/portal/officialSetupView.js:
  + toLocalDatetimeInput: chuyển đổi UTC ISO sang định dạng YYYY-MM-DDTHH:mm an toàn theo timezone máy local.
  + parseCutoffDetails: phân tích datetime, xuất ra đồng thời localDisplay (Intl vi-VN), timeZone, utcIso và cờ isPast.
  + detectVersionConflict: kiểm tra baseVersion vs serverVersion khi isDirty.
  + formatGroupSummary: tóm tắt số bảng A–H, số đội mỗi bảng và xác minh tính cân bằng bảng (độ lệch tối đa 1 đội).
- Xây dựng module src/tournament/portal/githubSyncState.js:
  + Chuẩn hóa 7 trạng thái intake GitHub theo contract Huy: resolving, fetching, checking, valid, invalid, infrastructure, frozen.
  + formatReceipt, syncStatusInfo, formatCommitSha.
  + GITHUB_SYNC_FIXTURES: 7 fixtures mẫu chuẩn DTO không chứa secret, phục vụ mock test và B2 UI.
- Viết 9 bài kiểm thử đơn vị mới:
  + tests/officialSetupView.test.js: 4 bài test (datetime input, cutoff details, version conflict, group summary).
  + tests/githubSyncState.test.js: 5 bài test (7 statuses coverage, syncStatusInfo, formatCommitSha, formatReceipt, fixtures validity).

File / export / route / RPC quan trọng:
- src/tournament/portal/OfficialSetupPanel.jsx (default component)
- src/tournament/portal/officialSetupView.js:
  + toLocalDatetimeInput
  + parseCutoffDetails
  + detectVersionConflict
  + formatGroupSummary
- src/tournament/portal/githubSyncState.js:
  + GITHUB_SYNC_STATUSES
  + SYNC_STATUS_METADATA
  + syncStatusInfo
  + formatCommitSha
  + formatReceipt
  + GITHUB_SYNC_FIXTURES
- tests/officialSetupView.test.js
- tests/githubSyncState.test.js

Contract thực hiện + ví dụ JSON không secret:
- DTO Receipt GitHub (theo Huy contract):
  {
    "id": "rcpt_val_004",
    "event_id": "ev_campus_week_01",
    "team_id": "10000000-0000-4000-8000-000000000004",
    "repo_id": 987654324,
    "repository": "https://github.com/team-delta/ootv2-bot",
    "branch": "main",
    "commit_sha": "a1b2c3d4e5f60718293a4b5c6d7e8f901234567b",
    "resolved_at": "2026-10-24T00:10:00.000Z",
    "status": "valid",
    "source_kind": "github",
    "file_path": "bot.py",
    "source_hash": "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
  }
- Lỗi hạ tầng (status="infrastructure"):
  {
    "status": "infrastructure",
    "error": "GitHub API rate limit exceeded. Retry later.",
    "error_category": "infrastructure",
    "previous_valid_submission_id": "sub_prev_valid_001"
  }

Migration thứ tự / applied chưa / env mới:
- Không có migration mới trong B1 (chỉ frontend UI/adapters/fixtures).
- Giữ nguyên migration 20261023160000_official_setup.sql chưa apply remote của Huy. Không có env mới.

Tests: lệnh | môi trường | exit | pass/fail/skip | vị trí log:
- npm test (node --test tests/*.test.js) | Windows local Node v22.13.0 | exit 0 | pass 100/100, fail 0, skip 0 | console stdout
- npm run build (vite build) | Windows local Node v22.13.0 | exit 0 | pass (1639 modules, dist bundle sạch) | console stdout

NOT RUN + lý do:
- Browser E2E automation bằng Playwright/Puppeteer: NOT RUN (chưa cài dependency headless browser, nằm trong B4 QA).
- Test tải 50-200 concurrent viewers: NOT RUN (thuộc milestone B4 QA).
- Kiểm thử tích hợp Supabase remote thật: NOT RUN (không có disposable Supabase credentials được cấp; dùng mock tests).

Giới hạn / bug còn lại / gate đang tắt / rủi ro:
- executionReady luôn là false (đây là gate có chủ ý; chưa nối scheduler/worker chính thức).
- Nút Start cho giải chính thức tiếp tục bị chặn (fails closed) theo điều lệ.
- Intake GitHub thực tế ở backend (H1/H2) chưa triển khai; B1 chuẩn bị sẵn fixtures và DTO formatters cho B2 nối khi H1 sẵn sàng.

Dependency người khác + phần chưa tích hợp:
- Phụ thuộc Huy (H1/H2): Sau khi Huy hoàn thành route nộp GitHub và lưu receipt vào Supabase, Bảo sẽ nối UI thật ở B2.
- Phụ thuộc Khoa (K1/K2): DTO standings bảng và bracket knockout chính thức để render B3.

Cách chạy demo và rollback:
- Demo UI thiết lập:
  + Chạy `npm run dev:api` và `npm run dev`.
  + Đăng nhập tài khoản admin (admin / admin).
  + Vào Quản lý giải -> Mở một giải chính thức (có `campus-setup.v1`).
  + Thử chỉnh sửa trường Cutoff -> quan sát giờ địa phương + giờ UTC hiển thị ngay bên dưới.
  + Thử tick thêm/bớt đội trong roster -> quan sát tóm tắt cân bằng bảng A–H cập nhật tức thì.
  + Thử click "Nạp bản server" khi có thay đổi chưa lưu để thấy hộp thoại xác nhận.
- Rollback:
  + `git checkout HEAD~1 -- src/tournament/portal/OfficialSetupPanel.jsx`

Bước tiếp theo nhỏ nhất:
- Chờ Huy hoàn thiện H1 (Schema/route GitHub intake DTO) hoặc tiếp tục B2 (dựng khung giao diện GitHub UI cho đội thi đấu trên TeamProfilePage / SubmissionsPage dùng GITHUB_SYNC_FIXTURES).
```

---

## Lịch sử checkpoint

- 24/10/2026: Hoàn thành B1 (Setup UX, dirty draft guard, timezone clarity UTC/local, dynamic groups A–H preview, 7 GitHub intake fixtures & adapters). Tests: 100/100 pass.
- 23/10/2026: Tạo khung bàn giao ban đầu.
