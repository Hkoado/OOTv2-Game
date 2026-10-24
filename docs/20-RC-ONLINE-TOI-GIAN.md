# RC online tối giản — phân công 3 người

Quyết định ngày **25/10/2026** theo yêu cầu mới của người dùng. Đây là kế hoạch,
không phải bằng chứng đã hoàn thành. Ưu tiên tài liệu này về phạm vi và ownership
so với assignments/checklist ngày 24/10; giữ nguyên luật, bảo mật và contract dữ liệu.

## 1. Mục tiêu và phần hoãn

- Một bản tích hợp online để người dùng review rồi tự deploy Vercel; không để lại việc nối code.
- Người dùng xác nhận đã thử bot chạy và trả kết quả OK. Ghi nhận là user-reported;
  chưa biết mode/môi trường/attempt, không tự suy ra sandbox hoặc recovery đã PASS.
- Tạm hoãn nghiệm thu/test Chung kết thủ công, giữ code và ACL admin-only, không mở rộng.
  Không công bố module này đã nghiệm thu; giải hoàn toàn không Internet tiếp tục hoãn.
- Không redesign, đổi engine/luật/framework, thêm hệ thống monitoring/test lớn hoặc refactor rộng.

## 2. Ba gói làm song song

| Owner | Chỉ làm trong đợt này | Đầu ra nghiệm thu |
| --- | --- | --- |
| **Huy — API/dữ liệu** | API kết quả đã công bố cho đội (standings/bracket/vé/danh sách ván), membership/ACL; cutoff batch có tiến độ/retry giữ SHA; login throttle dùng chung qua Supabase. Tái sử dụng services tính điểm sẵn có. | API thật + DTO/fixture cho Bảo, test tập trung không lộ kết quả kín/cross-event, danh sách migration và thứ tự áp được phép. |
| **Bảo — UI online** | Trang kết quả cho đội và đường mở viewer; nối cutoff batch; hoàn thiện nút điều hành và loading/error/401/403/409/logout/refresh. Tự nối API thật, không chờ Huy làm UI. | UI giữ style cũ, không tính điểm client; một kịch bản review online admin/đội/khác giải; hướng dẫn đội. |
| **Khoa — triển khai/worker** | Guard chặn trusted-dev ở production, tách env; xác minh/vá dependency; health nhẹ/readiness được bảo vệ, header/proxy/Vercel; tận dụng health/log sẵn có để phát hiện worker/queue kẹt, không dựng monitoring mới. | Cấu hình triển khai, health không lộ secret, runbook deploy/rollback/backup DB + artifact; tổng hợp một RC và blocker. |

### Ownership để không sửa chồng

- Huy: routes/auth/shared/services nghiệp vụ online, login throttle, migration mới và
  `docs/19-CONTRACT-TICH-HOP.md`. Không sửa UI hoặc runner.
- Bảo: `src/tournament/portal/`, tests/adapters frontend và `docs/runbook/SINH-VIEN.md`.
- Khoa: `package.json`, `package-lock.json`, `vercel.json`, `server/app.js`,
  sandbox factory/worker health, tools VM/provision, `docs/runbook/BAN-TO-CHUC.md`
  và checklist RC chung. **Chuyển ownership config/package/Vercel từ Huy sang Khoa đợt này.**
- Tests thuộc owner của phần code tương ứng; mỗi người chỉ sửa handoff của mình.
- Engine/scoring/orchestration đã có: không làm lại. Bug thật ở các module này do Khoa sửa;
  Huy tiếp tục làm qua adapter/fixture, không đợi toàn bộ runtime hoàn thiện.
- Không cho ba agent cùng ghi một working tree. Dùng checkout riêng đã được chuẩn bị;
  không tự tạo worktree/nhánh, không ghi đè thay đổi chưa commit.

## 3. Contract nhỏ, không chờ backend xong mới làm UI

Ngay đầu đợt, Huy ghi route/request/response/error và fixture versioned vào docs/19,
Bảo xác nhận. Khoa chỉ cung cấp health nếu UI cần; chưa cần thì dùng CLI/runbook,
không tạo dependency UI mới.

1. **Kết quả công bố:** tái sử dụng DTO hiện có; xác định rõ dữ liệu chưa công bố và
   danh sách ván được xem. Chỉ công bố tổng hợp khi giai đoạn đủ điều kiện, không để
   standings/bracket/vé suy ra kết quả còn kín. API admin giữ riêng.
2. **Cutoff batch:** giới hạn batch, tiến độ, còn việc hay đã xong, retry và lỗi từng đội;
   không đổi policy hoặc SHA đã pin. Không giả thời điểm HEAD tại cutoff.

Bảo làm bằng fixture trong test/dev rồi tự nối API; production không fallback dữ liệu giả.
Không đổi contract âm thầm. Lỗi boundary có bước tái hiện và owner; người còn lại tiếp tục việc độc lập.

## 4. Tích hợp và kiểm tra tối thiểu

- Ghép sớm lát cắt API kết quả → UI đội; sau đó ghép cutoff. Không đợi ba gói xong mới tích hợp.
- Mỗi owner chạy test liên quan phần mình sửa; không full suite sau từng patch, không
  thêm framework E2E. Khoa chạy **một lượt full tests/build/diff cuối** trên bản tích hợp.
- Bảo chạy một smoke browser online admin/đội/khác giải: trạng thái bài/vòng → kết quả
  → công bố → standings/bracket/vé/viewer → refresh/logout. Không lặp thử bot đã OK
  trừ khi thay boundary liên quan; không chạy manual E2E trong đợt này.
- Không báo PASS cho lệnh không quan sát được exit hoặc test chưa chạy.

## 5. Bàn giao để người dùng review và deploy

- [ ] Huy: API/ACL/cutoff/throttle xong, không còn consumer dùng fixture; schema đích và
  migration mới có trạng thái thực, quyền áp remote thiếu phải báo trước review.
- [ ] Bảo: UI nối thật, review script ngắn và lỗi quyền/refresh được kiểm.
- [ ] Khoa: guard/env/dependency/health/header xong; ghi **tên biến**, nơi đặt
  (Vercel hoặc VM), thứ tự schema → worker/API tương thích và rollback, không ghi secret.
- [ ] Cả ba ký phần mình: một RC SHA xác định, full tests/build/diff và smoke có evidence;
  không để lại việc sửa/nối code cho người dùng. Khoa tổng hợp, không ký thay người khác.
- [ ] Runbook nêu backup DB + artifact, restore và worker recovery; chứng cứ sandbox,
  2-worker/crash/rollback/restore còn thiếu ghi NOT RUN/BLOCKED và xử lý trước khi mở
  chấm code không tin cậy. Không dùng lượt thử bot thành công để bỏ gate an toàn.
- [ ] Người dùng review RC rồi tự deploy. Sau deploy kiểm HTTPS/cookie Secure,
  login/CSRF, `/api/*`, health và một màn kết quả. Đây là smoke môi trường sau deploy,
  không được đánh PASS trước deployment.

**Hai mốc riêng:** RC online sẵn sàng review/deploy không đồng nghĩa đã đủ điều kiện mở giải.
Thiếu gate an toàn/hạ tầng phải nêu blocker và không mở nhận/chấm bot không tin cậy.
Không tự push/deploy/apply remote hoặc hứa deploy chắc chắn thành công khi chưa kiểm môi trường.

Mỗi handoff chỉ cần: commit/files, việc đã xong, lệnh + exit + evidence,
migration/env thay đổi, blocker/NOT RUN. Không yêu cầu người dùng duyệt từng checkpoint.