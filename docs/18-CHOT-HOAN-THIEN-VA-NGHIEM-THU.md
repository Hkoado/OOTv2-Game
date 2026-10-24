# Chốt hoàn thiện sản phẩm — Huy / Bảo / Khoa

Ngày quyết định: **24/10/2026**. Người dùng đã duyệt phạm vi và cho phép cập nhật tài liệu.
Đây là **đặc tả giao việc**, không phải báo cáo tính năng đã hoàn thành.

## 1. Hiệu lực và mục tiêu

- Quyết định này thay cách giao việc H1/B1/K1 rồi dừng chờ người dùng review trong docs/16,
  assignments và handoff cũ. Ba người hoàn thành toàn gói, tự kiểm thử/tích hợp liên tục;
  người dùng nghiệm thu **một release candidate tích hợp**, sau đó tự deploy Vercel.
- Chia checkpoint/PR nhỏ để kiểm soát lỗi nội bộ, không yêu cầu người dùng duyệt từng checkpoint.
  Không hiểu yêu cầu này là một patch lớn không test hoặc được bỏ gate an toàn.
- Không tạo app mới, không đổi framework, không viết lại các khối đã có.
- Giữ Campus v2 theo docs/17, Supabase-only, snapshot/replay lịch sử và các ranh giới an toàn.
- Không tự push/deploy, tạo worktree hoặc áp migration remote. Quyền DB/VM phải được cấp
  trước rehearsal; thiếu quyền phải báo sớm, không giấu tới lần nghiệm thu cuối.

## 2. Phạm vi đã chốt

### Online: hoàn thiện đầu-cuối

BTC tạo giải tuần/tháng/kỳ, duyệt đội/repo, công bố map → cutoff capture SHA → intake/receipt
→ khóa snapshot → worker Campus chính thức → lịch/màu, standings, knockout và vé → kết quả kín
→ BTC công bố/phát trận → đội xem đúng quyền. Theo điều lệ và quyết định hiện hành,
không invent scoring hoặc âm thầm đổi policy cutoff `cutoff-first-resolution.v1`.

Bot một file Python, UTF-8, tối đa 256 KiB, thư viện chuẩn; setup kín và tự trả đủ 9 quân.
Budget/runtime dùng identity versioned hiện có; không đổi profile MVP cũ thành Campus.
Không dùng runner MVP fallback, không thực thi bot trên API/Vercel.

### Chung kết thủ công: một mục riêng dành BTC

**Không triển khai hệ thống giải chạy hoàn toàn không Internet trong đợt này.** BTC tự tổ chức
phòng thi/thu USB. Mục “Chung kết thủ công” là chức năng của hệ thống web và vẫn cần
API/Supabase/worker có kết nối; không được quảng cáo là hoạt động khi mất Internet.

| Chức năng | Hành vi bắt buộc |
| --- | --- |
| Tạo đợt | Chọn cấp giải, đội, vòng, map và runtime hiện hành; tách intake mode khỏi online |
| Nạp bot | Chỉ BTC chọn đội và nạp một `.py`, UTF-8, 1..262144 bytes; không ZIP/package |
| Validation | Worker kiểm bài, UI phân biệt pending/valid/invalid/infrastructure; syntax pass không phải sandbox acceptance |
| Phiên bản | Lưu hash, người nạp, thời gian server, trạng thái; BTC chọn rõ bản chính thức |
| Khóa bài | Theo vòng; pin source/map/runtime/budget vào snapshot; sau khóa không thay bytes hoặc đổi bài ngầm |
| Chọn/chấm trận | BTC chọn hai đội và map hợp lệ; dùng cấu hình cặp/luật/màu/điểm chính thức, cùng pipeline worker online |
| Kết quả | Accepted result, điểm, lý do kết thúc, replay; không nhập tay kết quả để thay engine |
| Retry/hủy | Lỗi hạ tầng retry cùng input; hủy/chấm lại có lý do/audit, giữ attempt và kết quả lịch sử |
| Đi tiếp | BTC xác nhận vòng/đội đi tiếp; engine tính kết quả, không yêu cầu tự điều hành toàn buổi |
| Quyền xem | Mặc định BTC; không tự mở cho đội hoặc anonymous |

Không dùng upload chung kết để thay submission online. Không giả receipt/SHA GitHub cho upload.
Không bật cổng upload online toàn cục để lách việc làm API scoped theo đợt/vòng.
Tái sử dụng adapter upload/Storage nếu phù hợp, nhưng kiểm quyền, size/type, CSRF và scope ở server.
File từ USB cũng là code không tin cậy: phải qua cùng sandbox, không được miễn gate.

### Hoãn / không mở rộng

- Bundle tổ chức giải không Internet đầu-cuối, local DB/SQLite fallback, sync offline hai chiều.
- Tự phát source cho đội, tự thu USB, điều phối phòng thi, tự động toàn bộ buổi offline.
- Module offline-bundle đã có giữ nguyên; không xóa, không coi build/verify là nghiệm thu thi offline.
- Không thêm practice/Elo hoặc quy trình khiếu nại mới ngoài chức năng đã chốt; giữ hướng dẫn
  báo BTC, audit và cơ chế xử lý kết quả cần cho phạm vi chính thức.

## 3. UI bắt buộc

Đọc [UI-GUIDE](ui-style/UI-GUIDE.md), style kit và UI đang mount trước khi code.
Quyết định mới này **không yêu cầu thiết kế lại bố cục** dù UI-GUIDE cho phép đề xuất cấu trúc.
Tái sử dụng `TournamentUi`, portal, token, font, icon và asset hiện có. Chỉ thêm/bố trí control
cần thiết theo ngôn ngữ UI sẵn có; không tạo phong cách/theme/font/thư viện UI mới.
Giữ hai theme, keyboard/focus, trạng thái lỗi/loading/rỗng. Desktop theo viewport UI-GUIDE;
không tự mở rộng thành dự án redesign mobile; kích thước nhỏ có fallback không tràn ngang.

## 4. Ba ownership, không gói thứ tư

| Người | Sở hữu triển khai | Trách nhiệm xuyên suốt |
| --- | --- | --- |
| [Huy](assignments/Huy.md) | API/auth/intake/publication, DB/Storage, backend chung kết thủ công, cấu hình phát hành chung | Migration/security review, tổng hợp release candidate; không nhận làm thay UI/runtime |
| [Bảo](assignments/Bao.md) | Portal/adapters, UI chung kết thủ công, viewer, browser/load harness, hướng dẫn | Tự nối UI vào API thật, browser E2E và kịch bản nghiệm thu |
| [Khoa](assignments/Khoa.md) | Worker/runner/scheduler/engine/sandbox, bộ cài Windows/guest, job chung kết thủ công | Tự nối runtime/persistence, VM thật, recovery và benchmark |

Huy sở hữu router/client/config/package/lock/Vercel; Khoa cung cấp service/runtime logic và SQL
file mới riêng, Huy review grants/transaction; Bảo sở hữu frontend. Tests riêng theo module.
Không ai sửa cùng file chung mà chưa thống nhất. Không dùng chung một working tree đang dirty;
nhóm tự bố trí checkout/branch, agent không tự tạo worktree/nhánh điều phối.

## 5. Contract trước, tích hợp sớm, không chặn cả đội

1. Bảo toàn baseline chung từ working tree hiện tại trước khi chia checkout; không giả mọi file
   chưa commit là thay đổi của người nhận việc. Nhóm chỉ định baseline SHA khi đã checkpoint.
2. Đọc code và [contract phối hợp](19-CONTRACT-TICH-HOP.md). Huy ghi API/DB, Khoa ghi job/runtime,
   Bảo xác nhận DTO/UI; đóng mapping concrete trước khi mỗi boundary được implement.
   Chọn tên kỹ thuật tương thích code là trách nhiệm nhóm, không thêm vòng xin user duyệt.
3. Bảo dùng fixture contract không có secret để làm UI ngay; Khoa dùng adapter contract/test doubles
   để làm runner ngay; Huy làm API/schema. Fixture không phải bằng chứng hoàn thành.
4. Ghép sớm một giải nhỏ **bằng runtime chính thức**; không tạo MVP thứ hai. Lỗi boundary do hai
   owner cùng sửa và thêm regression. Tích hợp tăng dần, không đợi ba nhánh xong mới ghép.
5. Thay contract phải cập nhật producer/consumer/tests cùng đợt; không đổi rule/budget/policy
   đã chốt dưới danh nghĩa chi tiết kỹ thuật. Mâu thuẫn sản phẩm/an toàn báo ngay.
6. Review/test nội bộ liên tục. Ba người còn trách nhiệm xử lý lỗi tích hợp đến khi RC đạt.
   Huy tổng hợp bằng chứng, không là người duy nhất chạy mọi test hoặc người dùng phải ghép nốt.

Không thể loại mọi dependency hoặc bảo đảm tiến độ bằng lời hứa. Blocker quyền/hardware/contract
ghi owner, ảnh hưởng và đường xử lý sớm trong handoff; không biến `NOT RUN` thành PASS.

## 6. Gate nghiệm thu cuối

| Gate | Người chịu trách nhiệm bằng chứng | Điều kiện |
| --- | --- | --- |
| API/DB/security | Huy | Migration đích đúng history, RLS/grants/Storage private, auth/CSRF/IDOR, cutoff/provenance/concurrency thật |
| Online E2E | Cả ba | Repo → snapshot → chấm → standings/knockout/vé → publication/viewer, không sửa DB thủ công |
| Chung kết thủ công | Cả ba | BTC nạp bot → validation → chọn/khóa → chấm → điểm/replay; team/cross-event bị chặn |
| Runtime | Khoa | Sandbox VM thật, hash/budget, 2 worker, stale writes/crash/retry/duplicate finish không tính đôi |
| Bộ cài | Khoa | Windows khác không chạy API; cài/start/stop/reboot/update lỗi/rollback có rehearsal, SSH verified |
| UI | Bảo | UI cũ nhất quán, hai theme/desktop/keyboard, không nút giả, browser role/privacy/reconnect thật |
| Quy mô | Khoa + Bảo, Huy hỗ trợ DB | Counts 35/40/48/50 đúng; benchmark worker và viewer 50/100/200, ghi môi trường/P95/error/tài nguyên |
| Regression/recovery | Cả ba | Full tests/build/diff, replay cũ, backup/restore DB/artifact và phục hồi worker đã thử |
| Release | Huy tổng hợp, mỗi người ký phần mình | Security/dependency/secret/license review, runbook, không còn blocker trong phạm vi |

Các gate bắt buộc chưa chạy môi trường thật thì RC chưa đạt. Test count cũ 353/353 chỉ là baseline,
không phải target hoặc thay nghiệm thu. Không buộc mở lại UI LegacyApp/P2P đã không mount;
giữ regression luật/replay cũ và báo đúng ranh giới sản phẩm hiện hành.

## 7. Bàn giao một lần cho người dùng

- Một commit tích hợp RC xác định, không ba nhánh rời hoặc working tree chưa checkpoint.
- Mỗi người cập nhật handoff của mình: code thực, contract, migration/env, command/exit/evidence,
  mock vs DB vs VM/browser thật, lỗi/NOT RUN và giới hạn. Không commit secret/log nhạy cảm.
- Huy lập biên bản chung theo `handoff/SAU-TICH-HOP.md`; chỉ đánh PASS có bằng chứng.
- Bảo cung cấp kịch bản review online + chung kết thủ công, tài khoản demo cấp an toàn và hướng dẫn.
- Khoa cung cấp worker runbook, version/config/health, update/rollback và recovery đã thử.
- Huy cung cấp thứ tự schema/code, tên env, checklist tự deploy Vercel và smoke production sau deploy.

Vercel chỉ là web/API; Supabase và VM worker phải sẵn sàng trước bàn giao. Cấp quyền áp DB và
đối chiếu SSH console là prerequisite vận hành, không thể thay bằng code. Người dùng tự deploy;
kiểm HTTPS/cookie/routing production sau deploy là checkpoint xác minh môi trường, không được
tuyên bố đã chạy trước deployment. Không để lại việc viết code/tích hợp cho lần review của user.