# Prompt thực thi — Codex / M1 GitHub intake

Bạn là agent triển khai lát cắt **M1-GitHub-intake**, không phải toàn bộ roadmap.

## Khởi động bắt buộc

1. Resolve root tuyệt đối, đọc AGENTS.md, docs/README.md, docs/07, docs/14, **docs/15-DIEU-PHOI-HAI-AGENT.md** (ownership + hợp đồng là bắt buộc), docs/06 và bộ MVP theo AGENTS. Đọc code/schema thật trước khi thiết kế.
2. Xác nhận nhánh `parallel/m1-github-intake`, worktree riêng, status sạch, base chung từ file manifest ở thư mục cha. Sai nhánh hoặc thấy sửa đổi lạ: dừng, không checkout/reset giúp người dùng.
3. Trình bày kế hoạch ngắn. Chạy `npm.cmd install`, baseline `npm.cmd test` và `npm.cmd run build`; ghi log/exit code. Không coi output rỗng là pass. Không đổi package/lock; nếu install đổi lock phải báo/dừng xử lý, không ghi đè thay đổi có sẵn.

## Công việc

Thực hiện đúng hợp đồng mục 5 docs/15: nhận repository/branch cho đội thuộc giải; resolve numeric repo ID + full commit SHA bằng request có timeout/giới hạn; transaction DB kiểm cutoff/freeze và idempotency rồi tạo job/receipt; API không clone/download/execute bot. GET receipt kiểm ownership/admin và whitelist output. Dùng route đang đăng nhập/CSRF, giữ upload cũ tương thích.

Đọc schema migrations hiện có, `shared/router.js`, participants/accounts/client/tournaments và test conventions. Chỉ sửa file được cấp ở bảng ownership docs/15. Thêm đúng migration `20261023140000_github_intake.sql` (nếu tên đã tồn tại thì dừng xin điều phối, không ghi đè). Không chỉnh app/config/accounts/worker/client/artifacts/src/package hay docs chung. Module GitHub không import worker hoặc subprocess. Dùng Node fetch, không thêm SDK/framework.

Không lấy latest HEAD khi worker chạy; không dựa commit timestamp để lách cutoff. Request không giữ transaction DB trong lúc chờ mạng: resolve metadata trước, transaction nhận job kiểm giờ DB/cutoff lại. Không tin permission chỉ vì đọc được public repo. Nếu chưa đủ quyền verify ownership/private repo thì gate BTC approval/fail closed và ghi giới hạn rõ; không fabricate endpoint/capability. Không áp migration remote, không dùng DB thật để test tự động.

## Test/Done

- Mock GitHub + PostgREST/RPC bằng Node built-in; không kết nối mạng thật trong test mặc định.
- Repo URL/token/SSRF/ref sai, auth/CSRF, đội khác giải/khác owner, 404/403/429/timeout, malformed response.
- SHA chỉ resolve một lần; force-push sau receipt không đổi SHA; cutoff kiểm lại tại DB; commit timestamp sớm không cứu SHA nhận muộn.
- Idempotency đồng thời và event isolation; freeze/cutoff/membership nằm trong RPC transaction, không chỉ check JS rồi INSERT.
- Job/receipt không chứa token/source/private internal errors; API hoạt động không có Python/git/cache ghi local.
- Mock RPC không chứng minh SQL concurrency: cung cấp cách integration test an toàn trên project Supabase test riêng, ghi `NOT RUN` nếu chưa có môi trường. Không nói migration đã apply.
- Chạy targeted tests, full `npm.cmd test`, build; review diff không sửa ngoài ownership. Không xóa test để đạt pass.

Viết `docs/agents/reports/CODEX-M1.md`: base/HEAD, files, bảng/RPC/arguments/HTTP/status/SQL migration và rollback giới hạn, env token đề xuất (để integrator bổ sung `.env.example`), lệnh/exit code, mock vs integration, lỗi baseline, phần thiếu. Stage đúng files mình sở hữu và commit local nếu test pass; không push/merge/cherry-pick. Nếu blocker, ghi report với bằng chứng và dừng, không tự mở rộng scope. Kết thúc tiếng Việt, nêu commit và **M1 chưa Done toàn tuyến cho đến integration**. Không tự làm M2.