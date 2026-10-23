# Kết quả Bảo — UI / viewer / browser QA

## Trạng thái mới nhất

- Trạng thái: **READY FOR REVIEW** — hoàn thành milestone B2 (GitHub UI thật: kết nối API intake H1, quản lý repo/branch, duyệt quyền, receipt và đồng bộ commit).
- Phạm vi: B1 & B2 trong [phân công Bảo](../assignments/Bao.md).
- Checkpoint: branch `dev` (trên nền commit `a25d024` của Huy).
- Đã hoàn thành và xác minh:
  1. Thay thế CTA upload file online bằng luồng nộp bài qua GitHub chính thức trên `SubmissionsPage.jsx`.
  2. Kết nối đầy đủ các API intake của Huy qua `githubApi.js`: đăng ký repository, lấy connection, danh sách repositories cho admin, gửi yêu cầu đồng bộ (202), tra cứu receipt mới nhất và poll tiến độ job qua `GET /api/local/repo-sync-jobs/:id`.
  3. Quản lý trạng thái duyệt quyền repository: `pending_approval` vs `approved`. Admin có nút phê duyệt 1-click trực tiếp trên giao diện.
  4. Hiển thị thẻ biên nhận đồng bộ (Receipt Card) chi tiết: Short SHA (7 ký tự hex), full commit SHA, nhánh, thời điểm resolved, trạng thái bot (`syncStatusInfo`), phân biệt rõ lỗi mã nguồn bot (`invalid`) và sự cố hạ tầng (`infrastructure` - bảo toàn bản valid cũ).
  5. Tự động poll tiến độ khi job đang xử lý (`resolving`, `fetching`, `checking`) và dừng khi có kết quả.
  6. Giữ lại panel nộp file `.py` trực tiếp dành riêng cho **Giám thị / Admin** khi thi đấu offline (USB import).
  7. Cập nhật `TeamProfilePage.jsx` định hướng đội sang trang nộp bài để đồng bộ GitHub.
  8. Viết bài kiểm thử đơn vị `tests/githubApi.test.js` kiểm tra gọi đúng endpoint `/api/local`, headers CSRF, body và dịch mã lỗi tiếng Việt.

---

## Chi tiết checkpoint B2

```text
Ngày / người / milestone / trạng thái:
24/10/2026 | Bảo (Frontend UI / QA) | Milestone B2: GitHub UI thật | READY FOR REVIEW

Branch / commit code / PR / đã merge vào đâu:
dev | commit code hiện tại (tra bằng `git log -1`) | Chưa tạo PR remote | Tích hợp trực tiếp trên branch dev theo quy ước chung

Đã làm:
- Xây dựng module client API src/tournament/portal/githubApi.js:
  + fetchRepositoryConnection: gọi GET /api/local/events/:id/repository(?team=)
  + saveRepositoryConnection: gọi PUT /api/local/events/:id/repository kèm CSRF token
  + fetchEventRepositories: gọi GET /api/local/events/:id/repositories (Admin)
  + requestGithubSubmission: gọi POST /api/local/events/:id/submissions/from-github (nhận 202 {created, job, receipt})
  + fetchLatestGithubSubmission: gọi GET /api/local/events/:id/submissions/from-github(?team=)
  + fetchRepoSyncJob: gọi GET /api/local/repo-sync-jobs/:id
- Cập nhật src/tournament/portal/githubSyncState.js:
  + GITHUB_INTAKE_ERROR_MESSAGES & humanizeIntakeError: dịch toàn bộ mã lỗi RPC của Huy sang tiếng Việt dễ hiểu.
- Viết lại src/tournament/portal/SubmissionsPage.jsx:
  + Đổi CTA chính: form đăng ký HTTPS GitHub repo + branch (mặc định main), validate qua validateRepository.
  + Hiển thị badge trạng thái duyệt: Đã duyệt (approved) vs Chờ BTC duyệt (pending_approval).
  + Nút "Đồng bộ commit mới từ GitHub" gửi yêu cầu nộp bài, nhận 202 receipt và kích hoạt polling job.
  + Polling tự động mỗi 2.5s qua fetchRepoSyncJob cho đến khi trạng thái chuyển sang valid, invalid, infrastructure hoặc completed.
  + Thẻ Receipt hiển thị chi tiết commit SHA rút gọn 7 ký tự, full SHA, trạng thái, thời điểm và thông báo lỗi.
  + Admin console: chọn đội, xem connection, duyệt repository, và đồng bộ hộ đội.
  + Giữ nguyên Panel nộp file offline (USB) cho Giám thị / Admin (chỉ hiển thị khi isAdmin=true).
- Cập nhật src/tournament/portal/TeamProfilePage.jsx:
  + Cập nhật hướng dẫn về repository mặc định và điều hướng sang Bot & bài nộp.
- Viết test tests/githubApi.test.js:
  + Kiểm thử humanizeIntakeError cho tất cả mã lỗi tiêu chuẩn.
  + Kiểm thử mock fetch cho 6 API methods, xác minh URL, method, headers và payload.

File / export / route / RPC quan trọng:
- src/tournament/portal/githubApi.js
- src/tournament/portal/githubSyncState.js
- src/tournament/portal/SubmissionsPage.jsx
- src/tournament/portal/TeamProfilePage.jsx
- tests/githubApi.test.js

Contract thực hiện + ví dụ JSON không secret:
- Yêu cầu đồng bộ (POST /events/:id/submissions/from-github):
  Request: {} hoặc { "team": "team-uuid" }
  Response 202:
  {
    "created": true,
    "job": { "id": "job-uuid", "status": "queued", "attempt": 0 },
    "receipt": {
      "id": "rcpt-uuid",
      "event_id": "ev-uuid",
      "team_id": "team-uuid",
      "repo_id": 987654321,
      "repository": "https://github.com/team/bot",
      "branch": "main",
      "commit_sha": "a1b2c3d4e5f60718293a4b5c6d7e8f901234567b",
      "status": "resolving"
    }
  }

Migration thứ tự / applied chưa / env mới:
- Phía UI không có migration mới. Phụ thuộc migration 20261024130000_github_intake.sql của Huy (chưa apply remote). Không có env mới.

Tests: lệnh | môi trường | exit | pass/fail/skip | vị trí log:
- npm test (node --test tests/*.test.js) | Windows local Node v22.13.0 | exit 0 | pass 122/122, fail 0, skip 0 | console stdout
- npm run build (vite build) | Windows local Node v22.13.0 | exit 0 | pass (1641 modules transformed, dist bundle sạch) | console stdout

NOT RUN + lý do:
- Test E2E tự động trình duyệt với GitHub thật: NOT RUN (không dùng credential thật / không gọi network ngoài sandbox).
- Worker process job thực tế: NOT RUN (phụ thuộc worker runtime H2 của Huy/Khoa để chuyển status từ resolving sang checking/valid).

Giới hạn / bug còn lại / gate đang tắt / rủi ro:
- Quá trình chuyển trạng thái từ `resolving` sang `valid`/`invalid` cần worker backend H2/Khoa tiêu thụ job; hiện tại API trả về biên nhận ban đầu ở trạng thái `resolving`.
- Giao diện nộp file offline chỉ cấp quyền cho vai trò Admin/Giám thị.

Dependency người khác + phần chưa tích hợp:
- Phụ thuộc Huy/Khoa: Triển khai worker H2 xử lý job tải blob GitHub tại commit SHA và chạy smoke test để cập nhật receipt sang `valid`/`invalid`.
- Phụ thuộc Khoa: Scheduler chính thức K1/K2 và DTO standings để phục vụ B3 (Viewer).

Cách chạy demo và rollback:
- Demo UI GitHub:
  + Chạy `npm run dev:api` và `npm run dev`.
  + Đăng nhập tài khoản đội (hoặc admin chọn đội) -> vào mục "Bot & bài nộp".
  + Nhập repository GitHub và bấm "Lưu & Đăng ký repository".
  + Đăng nhập tài khoản admin để duyệt quyền hoặc quan sát trạng thái `pending_approval`.
  + Bấm "Đồng bộ commit mới từ GitHub" và quan sát thẻ Receipt hiển thị SHA và trạng thái.
- Rollback:
  + `git checkout HEAD~1 -- src/tournament/portal/SubmissionsPage.jsx src/tournament/portal/TeamProfilePage.jsx`

Bước tiếp theo nhỏ nhất:
- Chờ Khoa/Huy hoàn thiện scheduler K1 hoặc tiến hành milestone B3 (Viewer lịch phát: đếm ngược, catch-up, server_time, afterSeq và bảng điểm theo điều lệ mới).
```

---

## Lịch sử checkpoint

- 24/10/2026 (Checkpoint 2): Hoàn thành B2 (GitHub UI thật: kết nối API intake H1, duyệt quyền, receipt, đồng bộ commit và USB fallback cho Admin). Tests: 122/122 pass.
- 24/10/2026 (Checkpoint 1): Hoàn thành B1 (Setup UX, dirty draft guard, timezone clarity UTC/local, dynamic groups A–H preview, 7 GitHub intake fixtures & adapters). Tests: 100/100 pass.
- 23/10/2026: Tạo khung bàn giao ban đầu.
