# Production readiness — 24/10/2026

**Chưa đủ điều kiện mở chấm bot công khai.** Public source repository và vận hành
dịch vụ nhận code không tin cậy là hai mốc riêng biệt. Không bỏ gate Start để demo.

## Mốc đã kiểm tra trong đợt rà soát

### Checkpoint bootstrap tiếp theo — 24/10/2026

Đích `.env` đã đổi sang project mới `ftzockzolisecnyhlwej`. Đã apply **chỉ
foundation** và đọc lại 13 bảng RLS; không được hiểu các kết quả remote project
cũ bên dưới là nghiệm thu project mới. Bộ script DB/Hyper-V đã thêm nhưng VM
chưa tạo, official worker chưa nối, migration runtime/capture còn thiếu.
Chi tiết và lệnh: [Production bootstrap](PRODUCTION-BOOTSTRAP.md).
Audit mới trong checkpoint báo **1 high (multer)**; kết quả 0 vulnerabilities
bên dưới là lịch sử, không còn là trạng thái hiện tại.

- Baseline: 326/326 tests, không skip; build exit 0.
- `npm audit` ban đầu báo 3 dependency high. `npm audit fix --ignore-scripts`
  (không force) cập nhật body-parser 2.4.0, qs 6.16.1, source-map-js 1.2.2,
  Vite 6.4.5 trong lockfile. Kết quả audit fix: 0 vulnerabilities.
- Sau cập nhật: test exit 0, build exit 0, diff check exit 0.
- Ignore thêm các biến thể `.env` và private key/certificate; giữ `.env.example`.
- Kiểm tên file tracked cho `.env*`, key, data, dist chỉ thấy `.env.example`.
  Đây KHÔNG phải quét secret toàn bộ nội dung hoặc lịch sử Git.
- Hyper-V `vmms` Running; phiên hiện tại gọi `Get-VM` bị từ chối quyền.
  Chưa xác minh VM Linux, SSH hoặc sandbox acceptance trên VM.

## Các chặn cần giải quyết theo thứ tự

### Checkpoint sửa cutoff ngày 24/10/2026

- Đã thêm migration `20261025100000_cutoff_capture.sql`, **chưa apply remote**.
  API cutoff mới cần migration này; không triển khai code mới riêng lẻ lên DB cũ.
- Policy `cutoff-first-resolution.v1`: lần resolve thành công đầu tiên sau cutoff;
  lưu thời gian capture thực, không khẳng định HEAD lịch sử tại deadline. Repo/cutoff/
  roster bị khóa từ reservation đầu tiên. Lỗi resolve đợi lease 60 giây rồi retry;
  sau pin không resolve lại HEAD. Hạ tầng download retry theo job SHA hiện có.
- PostgreSQL transaction pin job + receipt + capture; event/team unique, token fence,
  pin lặp idempotent. Reservation chốt repo/branch; không đổi target khi retry.
- Snapshot mới chỉ chọn receipt từ capture chính thức, kiểm SHA/repo/branch/hash/
  submission; không fallback valid lịch sử hoặc tự nhận là offline. Validation hoàn
  thành sau cutoff được nhận khi đúng capture. Receipt lịch sử cùng SHA chỉ dùng nếu
  được capture chính thức chọn; snapshot dùng thời gian capture riêng.
- Trigger mở vòng kiểm lại provenance trong transaction; vẫn đọc được snapshot cũ.
- Worker CLI trả exit 1 nếu job đã nhận nhưng chưa ghi kết quả; không gọi static
  syntax validation là sandbox execution. UI chặn mở vòng khi sync đang chạy.
- Đã chạy smoke PostgreSQL 16 local trên WSL, transaction rollback: reservation,
  reclaim, stale token, idempotency, context locks, thời gian capture, pending receipt,
  provenance giả và quyền private. **Đây không phải nghiệm thu sandbox/VM** và schema
  nền local tối giản không thay thế smoke Supabase thật.
- Đã chạy thêm hai session PostgreSQL độc lập tranh chốt cùng event/team:
  chỉ một capture/job/receipt được tạo; DB test kết thúc xóa DB tạm thành công.
- Kết quả cuối checkpoint: **338/338 Node tests pass**, không skip; Vite build exit 0;
  `git diff --check` exit 0. Bằng chứng local (ignored):
  `data/capture-final-summary.txt`, `data/postgres-capture-full.log`.
- Lệnh lặp lại: `sudo bash tools/cli/test-cutoff-postgres.sh` trên Linux dev có
  PostgreSQL 16 đang chạy; tạo/xóa DB tên ngẫu nhiên, không dùng DB thật.
- Hyper-V session đã gọi được `Get-VM`; không có VM trả về. Chưa tạo/boot VM Linux.
- CLI apply remote dừng vì `.env` thiếu PAT/DB URL; không có migration remote nào
  được áp trong checkpoint này. Không commit/push/deploy/xóa tài liệu.
- Hai drill legacy `db:cutoff`/`db:k2-open` chưa nâng theo capture mới; **không chạy
  chúng sau migration này**: fixture cũ không tạo provenance và cleanup bị context
  lock/FK chặn. Dùng PostgreSQL rollback smoke ở trên; cần sửa drill riêng trước
  rehearsal remote. Không cấp quyền DELETE capture chỉ để phục vụ cleanup legacy.

Danh sách dưới đây là toàn bộ gate còn phải nghiệm thu; các mục 1–2 đã có code và
kiểm thử local nêu trên, **chưa đóng gate tích hợp remote**.

1. Cutoff: authoritative capture event/team trong transaction, chống race;
   không resolve lại SHA đã pin khi retry. Không giả thời điểm resolve bằng cutoff.
   HEAD đọc sau hạn không chứng minh HEAD tại hạn; cần policy capture có version
   và bằng chứng thời gian, không dùng commit timestamp làm bằng chứng push.
2. Snapshot: chọn đúng receipt chính thức; pending/invalid/missing phải chặn,
   không tìm bài valid lịch sử hoặc coi bài thiếu receipt là offline.
   Phân biệt thời điểm pin và thời điểm tải/validation hoàn thành.
3. Worker: retry cùng SHA, báo lỗi/exit code chính xác; validation sandbox;
   hash runtime trước khi chạy; persist replay/result với fencing, crash recovery.
4. Lịch chính thức: runner vòng bảng, standings, knockout, khóa vòng;
   quyền xem lịch/màu và kết quả chỉ khi được công bố; kiểm refresh UI.
5. VM: cấp quyền quản lý Hyper-V cho phiên vận hành hoặc kết nối SSH đến VM
   đã chuẩn bị; chạy preflight/attestation đầy đủ, kiểm escape/resource/cleanup.
   Không thay nghiệm thu VM bằng test WSL hoặc mock.
6. Nghiệm thu DB/Storage, browser, offline rehearsal, backup/restore và vận hành.
   Migration remote/deploy cần thao tác được cho phép riêng.
7. Trước public repo: quét secret cả history, rà giấy phép asset; gom quyết định
   còn hiệu lực vào runbook rồi mới xóa tài liệu chia việc/handoff và sửa link.
   Không xóa migration, regression tests hoặc dữ liệu cá nhân chưa phân loại.

## Đính chính tài liệu cũ

Các tuyên bố “pull một lần” trong OFFICIAL-WEEKLY-FLOW/GITHUB-CONSUMER chưa được
code bảo đảm: sync hiện resolve HEAD trước khi deduplicate theo SHA. Snapshot
hiện có fallback lịch sử/offline và không nhận receipt resolve sau cutoff.
Các pass cũ không kiểm đủ những trường hợp này; không suy ra production-ready.

Chưa push, deploy, apply migration remote hoặc xóa tài liệu chia việc trong đợt này.