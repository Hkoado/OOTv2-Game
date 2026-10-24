# Huy — Backend, dữ liệu, bảo mật và release integration

## Phân công hiện hành — 25/10/2026

Ưu tiên [RC online tối giản](../20-RC-ONLINE-TOI-GIAN.md). Chỉ thực hiện:

1. API kết quả **đã công bố** cho đội: standings/bracket/vé/danh sách ván, membership/ACL;
   giữ API admin riêng, không lộ kết quả kín. Tái sử dụng scoring/services có sẵn.
2. Cutoff batch có tiến độ/retry giữ SHA/policy; login throttle dùng chung Supabase.
3. Chốt DTO + fixture sớm với Bảo trong docs/19; tự kiểm backend, ghi migration/env/evidence.

Không làm UI, runner, cấu hình package/Vercel hoặc nghiệm thu manual đợt này.
**Khoa sở hữu config/package/lock/Vercel và tổng hợp RC**, không còn dồn vào Huy.
Test tập trung phần sửa, không chạy full suite mỗi patch. Không tự apply remote/push/deploy.
Đọc tài liệu chung để biết ownership, kiểm tra tối thiểu và điều kiện mở giải.

---

## Lịch sử ngày 24/10 — không dùng làm checklist giao việc đợt này

## Nhiệm vụ hiện hành — 24/10/2026

Đọc AGENTS.md, docs/18-CHOT-HOAN-THIEN-VA-NGHIEM-THU.md,
docs/19-CONTRACT-TICH-HOP.md, docs/17, PRODUCTION-READINESS và code thật.
Thay prompt cũ chỉ làm H1 rồi dừng: hoàn thiện **toàn gói** dưới đây, checkpoint/test nội bộ;
không đợi người dùng review từng PR. Người dùng chỉ nghiệm thu một RC đã tích hợp.

## Ownership và đầu ra

- API/router/auth/client/intake/publication, schema nền và Storage; backend chung kết thủ công.
- File config/package/lock/Vercel dùng chung: bạn quản lý thay đổi, nhận yêu cầu từ Bảo/Khoa.
- Khoa sở hữu runner/scheduler và SQL runtime file mới; bạn review transaction/grants và tích hợp.
- Không sửa UI hoặc viết runner thay hai người kia. Mỗi người tự nối/test phần mình.

## Phải hoàn thành

1. GitHub approval → cutoff capture → receipt/artifact → immutable snapshot đúng SHA/hash/provenance.
   Race/retry/revoke/quota/pending không nhận nhầm latest hoặc valid lịch sử. API không chạy bot/git/Python.
2. API readiness, vòng/trận/lịch/màu, standings/bracket/vé theo module Khoa; kết quả kín,
   publication/replay whitelist; role/membership/CSRF/IDOR ở mọi endpoint/download, không chỉ UI.
3. Chung kết thủ công: admin-only scoped event/round/team upload một `.py` UTF-8 1..262144 bytes,
   private artifact/hash/server time/actor, validation job, chọn phiên bản, khóa snapshot transaction.
   Provenance manual riêng, không giả GitHub receipt và không nới online capture policy.
   API yêu cầu chấm/đọc kết quả/audit cancel-rerun; Khoa thực hiện chấm bằng pipeline chung.
4. Không dùng cờ bật upload online toàn cục làm chức năng chung kết; team online vẫn chỉ GitHub.
   Pending/invalid không khóa; không thay bài sau khóa; job không lookup latest toàn đội.
5. Đối chiếu history/object project đích, review migration additive, backup và smoke nâng cấp.
   Không reset DB, không chạy fresh bundle trên project đã có foundation; không tự apply remote.
6. Kiểm backend Vercel: route/session/cookie/CSRF/no-store/timeout; worker chạy ngoài Vercel.
   Rà dependency/security/secrets/license với cả nhóm; không audit-fix mù hoặc ghi credential vào docs.
7. Tích hợp tăng dần, tổng hợp RC và biên bản chung; phối hợp sửa boundary, không đợi cuối mới merge.
   Không ôm toàn bộ QA thay Bảo/Khoa. Không tự push/deploy hoặc seed tài khoản thật.

## Contract và kiểm thử

Điền mapping API/DB thực tế trong docs/19 trước nối từng boundary, Khoa xác nhận runtime,
Bảo xác nhận DTO. Fixture có version để hai người làm song song; tên kỹ thuật không cần user duyệt lại.
Không tự sửa luật/budget/cutoff đã chốt. Contract đổi phải có producer/consumer/test đồng bộ.

Node built-in tests mặc định mock, không chạm DB thật. Integration được cấp phép phải kiểm
RLS/grants/Storage/cutoff/lock/concurrency/idempotency thật; anonymous/team/cross-event, CSRF,
source/log/replay secrecy, manual vs online provenance. Restore backup phải có rehearsal.
Test/build/diff cuối trên bản tích hợp; kết quả dự án cũ không thay chứng cứ project đích mới.

## Done và bàn giao

- Gate API/DB/security và phần backend của hai E2E trong docs/18 đạt; không để user nối code.
- Cập nhật `docs/handoff/Huy.md`: SHA, exports/routes/RPC, DTO, migration applied/project,
  tên env, commands/exit/evidence, mock vs thật, NOT RUN/blocker. Không ghi secret.
- Tổng hợp `docs/handoff/SAU-TICH-HOP.md`, nhận bằng chứng Bảo/Khoa; RC một commit xác định,
  deployment checklist Vercel + smoke sau user deploy, backup/recovery và giới hạn trung thực.
- Thiếu quyền DB/hardware báo ngay; không nhận `NOT RUN` thành PASS để đóng RC.

## Prompt giao Huy

> Bạn là Huy. Đọc AGENTS.md, docs/18, docs/19 và toàn bộ file phân công này, kiểm git/status/code thật.
> Hoàn thiện toàn gói API/DB/security/Chung kết thủ công và phối hợp RC, không chỉ H1 rồi dừng.
> Bảo toàn working tree và baseline chung; không làm lại phần đã có. Chốt API/DB contract với Khoa/Bảo
> trước boundary, làm song song qua fixture, tích hợp sớm và tự xử lý lỗi phần mình tới khi RC đạt.
> Giữ Campus v2, Supabase-only, online GitHub capture; manual final provenance riêng/admin-only.
> Không thực thi bot trên API, không mở gate khi runtime/privacy chưa đạt, không tự apply remote/push/deploy.
> Chạy tests và integration được phép, cập nhật handoff + bằng chứng và checklist chung. Không báo
> hoàn thiện nếu gate DB/VM/browser bắt buộc chưa chạy; user chỉ review RC cuối và tự deploy Vercel.