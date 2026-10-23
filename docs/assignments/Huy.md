# Huy — Backend GitHub intake và bảo mật dữ liệu công bố

## Đọc và hiện trạng

Đọc AGENTS.md, docs/16, docs/01-THE-THUC-GIAI.md, docs/06, docs/14, docs/07 và code thật.
Setup `campus-setup.v1` đã có nhưng migration chưa apply; runtime chính thức chưa chạy.
Supabase-only, không merge nguyên Backend `8540d2f`; live/log nhánh cũ đã có trên dev.

## Ownership

`server/shared/router.js`, `accounts.js`, `client.js`, `participants.js`, services GitHub metadata,
schema/RPC intake và publication. Không sửa React (Bảo), scheduler/worker (Khoa).
SQL scheduler Khoa sở hữu file riêng, bạn review grants/transaction. Config/package cần phối hợp.

## Các PR theo thứ tự (mỗi lượt chỉ một PR nhỏ)

1. **H1 — Contract + GitHub intake:** schema additive repo approval/job/receipt; resolve numeric repo ID/full SHA
   đúng một lần trước transaction kiểm cutoff/freeze/membership/quota/idempotency. API không clone/source/Python.
   Chốt DTO với Bảo/Khoa trước nối UI/consumer; đọc route đề xuất docs/16, không coi tên route là đã có.
2. **H2 — Hoàn thiện transaction/ACL/intake:** whitelist receipt, cross-team denial, clock DB,
   unique event/team/repo/SHA/path, pending-before-cutoff, giữ valid cũ; quyền repo chưa verify phải BTC duyệt.
   Disable upload online team; fallback opt-in admin/trusted-dev, không loại offline import file.
3. **H3 — Privacy/publication:** bảng lịch phát riêng, admin schedule/cancel, server_time/visible_plies,
   member giải được xem ván đã công bố kể cả vòng sau; chặn anonymous live hiện tại và mọi leak qua
   result/standings/bracket/replay/log/Storage. Không lấy trạng thái finished làm công bố.
4. **H4 — Integration/ops:** project DB test riêng được phép, hai worker claim/retry và stale writes cùng Khoa;
   review security/SQL, phối hợp Bảo load harness/Preview. Không tự apply remote hoặc seed tài khoản thật.

## Test và Done

Node built-in tests mock không chạm `.env` DB thật; HTTP session/CSRF/admin/team/membership,
GitHub host/URL/token/redirect/rate limit, cutoff race, duplicate receipt/quota, 403 đoán ID.
SQL integration phải chạy thật trên disposable project khi được cấp, ghi mock/integration tách biệt.
Publication không trả tương lai/kết quả kín dù client sửa afterSeq; cache private/no-store.
Không PAT sinh viên trong form/URL/log; service role backend-only. Sandbox chưa có thì trusted-only.
Chạy full test/build, `git diff --check`, bàn giao DTO + migration ordering/rollback/recovery.

## Prompt tiếp tục

> Tôi là Huy. Đọc AGENTS.md, docs/16-THIET-LAP-CHINH-THUC-VA-CHIA-VIEC.md và docs/assignments/Huy.md.
> Kiểm branch/status, giữ thay đổi người dùng, xác lập baseline. Chỉ triển khai H1: contract và GitHub intake
> Supabase-only, API resolve metadata/SHA không clone/tải source/chạy bot, transaction cutoff/idempotency/
> membership, receipt private. Đọc code/schema thật; trước code nêu DTO và ownership cho Bảo/Khoa.
> Không merge nguyên Backend, không sửa worker/UI, không tự deploy/apply SQL/seed remote. Thêm tests chặn
> mạng thật mặc định, test/build cuối và báo chính xác phần chưa nghiệm thu. Dừng sau H1 để review.