# OTTv2 — Bộ tài liệu giải đấu và giao diện

**Ưu tiên hiện hành 25/10/2026:** [RC online tối giản — ba người làm song song](20-RC-ONLINE-TOI-GIAN.md).
Huy API/ACL/cutoff/throttle; Bảo UI online/review; Khoa cấu hình/worker health/tổng hợp RC.
User đã thử bot trả kết quả OK; tạm hoãn nghiệm thu Chung kết thủ công. Không bỏ gate an toàn.
Các quyết định 24/10 bên dưới giữ làm nền tảng; phạm vi/ownership đợt này theo docs/20.

**Quyết định mới 24/10/2026:** [Phạm vi hoàn thiện và một RC nghiệm thu](18-CHOT-HOAN-THIEN-VA-NGHIEM-THU.md),
[contract phối hợp](19-CONTRACT-TICH-HOP.md), assignments [Huy](assignments/Huy.md),
[Bảo](assignments/Bao.md), [Khoa](assignments/Khoa.md). Nhóm tự tích hợp toàn gói, không chờ
user sau H1/B1/K1. UI giữ hiện có theo UI-GUIDE. Offline hoàn toàn không Internet hoãn;
chỉ làm Chung kết thủ công BTC nạp/chọn/khóa/chấm qua hệ thống có kết nối.
Đây là kế hoạch đã duyệt, không phải tuyên bố triển khai xong.

**Trạng thái nghiệm thu hiện hành:** [Production readiness](PRODUCTION-READINESS.md).
**Rà soát deploy và kịch bản sửa RC (25/10):** [biên bản findings](DEPLOY-REVIEW-2026-10-25.md),
[kịch bản sửa/verify cho Huy và Bảo](21-KICH-BAN-SUA-VA-VERIFY-RC.md).
**Gate trước chấm bot không tin cậy (25/10):** [kế hoạch và blocker](WORKER-UNTRUSTED-READINESS.md).
**DB mới / bộ dựng Hyper-V đang triển khai:** [Production bootstrap](PRODUCTION-BOOTSTRAP.md).
**Máy Windows khác pull repo chạy worker:** [Đóng gói worker](WORKER-PACKAGING.md).
**Worker manual + drill 2 worker/VM:** [Drill worker Chung kết thủ công](DRILL-MANUAL-WORKER.md).
Phân biệt code/test local, migration remote và sandbox thật; các handoff/drill cũ
không phải tuyên bố hệ thống đã production-ready.

**Luật mới 24/10/2026:** [Địa hình, setup kín và phân màu Campus v2](17-LUAT-DIA-HINH-VA-XEP-KIN.md).
Thay phần v1 chỉ ô cản và Xanh thấy setup Đỏ cho giải mới; giữ replay/phòng cũ.

Cập nhật 23/10/2026. Dành để bổ sung vào repository [Hkoado/OOTv2-Game](https://github.com/Hkoado/OOTv2-Game), phát triển tiếp nhánh `tournament/initial`. Đây là thiết kế/handoff, không phải tuyên bố các tính năng đã được triển khai.

**Code hiện tại:** xem [trạng thái triển khai và migration](07-TRANG-THAI-TRIEN-KHAI.md).
**Kết quả ba thành viên và việc còn lại:** [thư mục bàn giao chung](handoff/README.md),
[checklist hoàn thiện sau tích hợp](handoff/SAU-TICH-HOP.md). Báo cáo khởi tạo chưa có nghĩa công việc đã xong.
**Yêu cầu tiếp theo 23/10:** [thiết lập giải chính thức và kế hoạch 3 thành viên](16-THIET-LAP-CHINH-THUC-VA-CHIA-VIEC.md),
prompt riêng cho [Huy](assignments/Huy.md), [Bảo](assignments/Bao.md), [Khoa](assignments/Khoa.md).
Setup mới không còn giới hạn 8 đội; chưa phải runtime giải chính thức đã nghiệm thu.
Hướng đang triển khai (chấm trước → công bố → phát từng nước): [kiến trúc chấm trước và phát trận](14-KIEN-TRUC-CHAM-TRUOC-VA-PHAT-TRAN.md).
Tiếp tục ở phiên mới: [bàn giao code dang dở và bước tiếp theo](15-BAN-GIAO-TIEP-TUC.md) — làm tuần tự trong workspace hiện tại.
Xem trực tiếp + triển khai công khai (đã chạy được): [live và Cloudflare Tunnel](13-LIVE-VA-TRIEN-KHAI.md).
Đợt offline/thư mục giải: [bàn giao và chia việc còn thiếu](10-BAN-GIAO-OFFLINE-VA-THU-MUC-GIAI.md).
Nền tảng engine Campus M1 có CLI riêng; API/worker/UI hiện tại vẫn dùng profile MVP.
Sandbox code lạ: [kế hoạch production, chọn công cụ và ngân sách phần cứng](SANDBOX-PRODUCTION.md);
dev acceptance WSL: [bằng chứng và giới hạn](SANDBOX-WSL.md).
Runtime fingerprint cho snapshot: [cần chốt gì](OFFICIAL-RUNTIME.md).
Luồng giải tuần online hiện tại: [cutoff → GitHub pull → mở vòng](OFFICIAL-WEEKLY-FLOW.md).

## Đọc gì trước?

| Người đọc | Tài liệu nên đọc |
| --- | --- |
| Người tổ chức, thành viên mới | [Tóm tắt trong 3 phút](00-TOM-TAT-DOC-NHANH.md) |
| BTC chốt điều lệ | [Thể thức đầy đủ](01-THE-THUC-GIAI.md) |
| Người chọn phương án triển khai | [Phương án, công sức, thiết bị và ngân sách](02-PHUONG-AN-TRIEN-KHAI.md) |
| Backend/runner agent | [Đặc tả kỹ thuật](03-DAC-TA-KY-THUAT.md), [hướng dẫn agent](04-HUONG-DAN-AGENT-CODE.md) |
| Frontend/UI agent | [Tích hợp UI vào repo](05-TICH-HOP-UI-VA-REPO.md), [UI guide](ui-style/UI-GUIDE.md), [asset guide](ui-style/ASSET-GUIDE.md) |
| Nộp bot qua GitHub | [Tự lấy code, cutoff và cache tối thiểu](06-GITHUB-NOP-BOT-VA-LUU-TRU.md) |
| Chấm trước, công bố, phát trận trên Vercel | [Kiến trúc chấm trước và phát trận](14-KIEN-TRUC-CHAM-TRUOC-VA-PHAT-TRAN.md) |
| Agent bắt đầu công việc | [Brief tích hợp](ui-style/REPO-INTEGRATION-BRIEF.md), rồi AGENTS.md và code thật trong repo |

## Các quyết định sản phẩm hiện hành

- Khoảng 100 sinh viên, đội 2–3 người, 35–50 bot Python; giải tuần → tháng → kỳ.
- Vòng loại online, chung kết offline không mạng. Offline đội nhận lại bot cũ và tự do dùng nguyên/sao chép/sửa/thay trước cutoff; không bắt buộc viết lại.
- BTC công bố đầy đủ map chính/dự phòng từ trước sự kiện, có version và lịch áp dụng.
- Online đội được xem **mọi trận đã được BTC công bố thuộc giải mình tham gia** (kể cả vòng sau khi đã bị loại); server kiểm quyền trên state/events/replay/file. Offline chỉ BTC cần xem trên máy điều phối. Chi tiết: [chấm trước và phát trận](14-KIEN-TRUC-CHAM-TRUOC-VA-PHAT-TRAN.md).
- Kết quả chấm được giữ kín cho tới khi BTC công bố; web chỉ phát các nước đã đến mốc giờ phát, client tự dựng bàn cờ, không chấm bot trong trình duyệt.
- Engine quyết định kết quả; viewer dùng snapshot và từng nước đi server gửi. Code sinh viên phải được cách ly trước khi mở nhận bài không tin cậy.
- Online lấy bot tự động từ GitHub repo đội tại commit đã chốt; source chính ở GitHub, BTC chỉ cache chạy ngắn hạn và lưu metadata/kết quả/replay. Offline tải sẵn trước khi ngắt mạng.
- UI theo **giấy da sáng/hầm ngục tối**, hình 2D và quân đơn sắc, hai theme. Phong cách không tự thay đổi luật hoặc yêu cầu xây lại project.

## Phân biệt đặc tả sản phẩm và tài liệu phong cách

Yêu cầu trực tiếp mới nhất của người tổ chức quyết định hành vi sản phẩm. File01–04 mô tả điều lệ/kiến trúc, file05 ánh xạ vào UI và repo; `ui-style/` mô tả thị giác, token và cách dùng asset. Brief trong style kit là nội dung giao việc mẫu, không phải một yêu cầu tự động xây mọi tính năng, publish hay thay luật.

Khi có khác biệt giữa docs MVP cũ và bộ này, dùng [bảng migration](05-TICH-HOP-UI-VA-REPO.md#2-hiện-trạng-và-ranh-giới-thay-đổi). Giữ các nguyên tắc bảo toàn ứng dụng, framework và sandbox trong AGENTS.md; version hóa những hành vi mới thay vì âm thầm sửa replay/kết quả cũ.

## Tích hợp vào repo đã có

1. Kiểm tra `git status`, nhánh và AGENTS.md trong checkout thật. Không ghi đè thay đổi người dùng.
2. Chép các file mới của bộ này vào `docs/`, gồm toàn bộ `docs/ui-style/`. Không thay nguyên thư mục `docs` và không xóa bộ docs MVP cũ.
3. Tên file mới dùng dấu `-`; docs MVP cũ dùng `_`, nên có thể cùng tồn tại. Nếu repo đã có `docs/README.md` hoặc file trùng tên, merge nội dung và review diff, không ghi đè mù.
4. Bổ sung link `docs/README.md` vào README gốc và phần “Tài liệu mở rộng” trong AGENTS.md; giữ nguyên nội dung gốc. Mẫu:

```md
## Tài liệu mở rộng giải đấu

Đọc [bộ tài liệu giải đấu và UI](docs/README.md) trước khi mở rộng tournament.
UI dùng [hướng dẫn tích hợp](docs/05-TICH-HOP-UI-VA-REPO.md)
và [style kit](docs/ui-style/README.md).
```

5. Từ root repo chạy `node docs/ui-style/build-tokens.mjs`; CSS và contrast report được sinh từ JSON, không sửa bằng tay.
6. Giao milestone cụ thể cho agent bằng brief tích hợp; không coi việc chép docs là đã thay UI hoặc đã có backend production.

Bộ docs không cần `demo-ui/`, `source-game/`, node_modules, DB, source bot sinh viên hoặc secret. `references/style-elements.png` là tham khảo element, không phải screenshot để dựng lại bố cục.

## Các file trong style kit

- [README](ui-style/README.md): cách dùng bộ kit.
- [UI-GUIDE](ui-style/UI-GUIDE.md): mỹ thuật, typography, component, responsive và accessibility.
- [ASSET-GUIDE](ui-style/ASSET-GUIDE.md): silhouette, alpha, tỷ lệ và nguồn asset.
- [tokens.json](ui-style/tokens.json): nguồn token duy nhất; [tokens.css](ui-style/tokens.css): CSS sinh ra.
- [build-tokens.mjs](ui-style/build-tokens.mjs): generator Node không cần thư viện; [contrast-report.json](ui-style/contrast-report.json): kiểm màu đặc.
- [AGENT-BRIEF](ui-style/AGENT-BRIEF.md): brief phong cách dùng chung; [REPO-INTEGRATION-BRIEF](ui-style/REPO-INTEGRATION-BRIEF.md): brief riêng cho OTTv2.
- [Ảnh tham khảo và nguồn](ui-style/references/README.md).

## Kiểm tra trước merge

- Link nội bộ đầy đủ; giữ ảnh tham khảo trong repo.
- Generator chạy được và output không drift so với JSON.
- Đặc tả không còn bắt viết lại bot, giữ kín map hoặc yêu cầu đội xem trận offline.
- Agent hiểu style kit không cấp thêm luật lửa/nước/bụi cây; v1 chỉ có ô cản.
- Khi bắt đầu code: kiểm tra build, chức năng, cả hai theme và quyền xem theo milestone. Contrast report không thay cho kiểm tra UI thực tế.
