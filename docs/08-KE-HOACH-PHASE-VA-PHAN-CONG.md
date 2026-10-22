# Campus portal — kế hoạch và milestone UI nền

## Quyết định sản phẩm

- Một đội dùng một tài khoản do BTC cấp; thành viên chỉ là thông tin hồ sơ.
- Chỉ hai vai trò ứng dụng: team và admin. Không đăng ký công khai hoặc mời thành viên.
- Backend quản lý xác thực/session; Supabase lưu dữ liệu online phía server. Không dùng key Supabase trong frontend.
- SQLite legacy/offline giữ riêng; migration có version, không sửa kết quả/replay cũ.
- GitHub lưu source chính. Lưu URL không đồng nghĩa có quyền đọc hoặc đã nhận bài.

## Roadmap và phân công

| Phase | Phạm vi | Owner đề xuất | Điều kiện bàn giao |
| --- | --- | --- | --- |
| 0 | Contract dữ liệu/API/quyền, ADR Supabase | Lead + backend | DTO/error/status và migration được review |
| 1 | Shell/component/theme, danh mục màn hình | Frontend nền | Build/test, không phá room/MVP |
| 2 | Chi tiết UI đội/admin, viewer/editor preview | Hai frontend | Đủ state và kiểm tra trình duyệt hai theme |
| 3 | Auth/session, CRUD đội, Supabase | Backend | Kiểm quyền team/admin, test chéo đội, secret chỉ backend |
| 4 | Giải/map/tài liệu/repository metadata | Backend + frontend | Lưu thật, kiểm quyền và validation |
| 5A | Resolve SHA, bounded fetch/hash/cache | GitHub/runner | Không execute project, quota/credential isolation |
| 5B | Persistent protocol + Linux sandbox | Runner | Host preflight, kiểm thử giới hạn/cleanup trên Linux |
| 5C | Candidate/cutoff/freeze | Backend + runner | Snapshot bất biến, receipt, lỗi hạ tầng riêng |
| 6 | Scheduler/queue/kết quả/vé/viewer | Backend + frontend | E2E Campus, ACL đúng vòng, không tính đôi |
| 7 | Offline/export/import/backup/QA | QA + operator | Diễn tập restore, không mạng, regression multiplayer |

Mỗi PR một milestone. Lead điều phối App.jsx, contract, schema/migrations. Không yêu cầu hoàn thành cả roadmap trong một PR.

## Đợt hiện tại: UI nền, chưa production

> **Đã thay thế (22/10/2026):** cổng giải đấu là entry duy nhất; không còn tab `Campus · UI`,
> `?view=campus` hay màn hình preview không xác thực. Đăng nhập thật qua `/api/local`,
> điều hướng theo vai trò đội/admin, bảng đấu và replay nằm trong `src/tournament/portal/`.
> Các ghi chú bên dưới chỉ còn giá trị lịch sử.

- Tab mới `Campus · UI`, URL `?view=campus`, tách khỏi Tournament MVP và room.
- Login placeholder không gửi mật khẩu; preview team/admin chỉ state trong bộ nhớ, không phải quyền thật.
- Sáu module đội và chín module admin; form đội/GitHub/giải, bảng rỗng, trạng thái chưa có backend.
- Kiểm tra URL GitHub chỉ là định dạng, không xác minh sở hữu hoặc truy cập mạng.
- Theme scoped trên portal, dùng style tokens có sẵn, không tải font/CDN mới.
- Không kết nối Supabase, GitHub, worker hoặc sửa file .env. Không có lưu dữ liệu thật.

### Việc chưa có

Contract API chi tiết và ADR chưa hoàn chỉnh; auth/session/hash mật khẩu/RLS/migration chưa triển khai.
Viewer/editor, dialog phân xử, receipt và biểu mẫu quản trị nâng cao mới có vị trí UI, chưa có implementation.
Chưa nghiệm thu trình duyệt, desktop viewport, focus, multiplayer hai máy, sandbox hoặc offline.

### Chạy và kiểm tra

Từ root repository: `npm run dev`, mở tab Campus · UI; chọn xem trước đội hoặc admin.
Kiểm tra mọi module, thoát preview, theme sáng/tối; quay lại game/MVP.
Chạy `npm run build`, `npm test`; test catalog/URL dùng Node built-in runner.

Milestone kế tiếp: contract API/schema và auth + quản lý đội trên backend, sau khi review UI nền.

## Kết quả kiểm tra đợt UI nền

- Baseline build thành công, cảnh báo chunk >500 KiB đã có sẵn.
- Baseline full suite: 44/50 pass, 6 lỗi legacy (gồm upload `submission_not_found`).
- Sau thay đổi: build thành công; full suite 47/53 pass, vẫn 6 lỗi legacy.
- Chạy riêng navigation + Campus engine + legacy game adapter: 30/30 pass.
- Ba test mới kiểm catalog role/module và định dạng URL GitHub; không thay thế test tương tác UI.
- Không sửa backend/test legacy để che lỗi baseline. Không cài thêm dependency.