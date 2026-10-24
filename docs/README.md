# Tài liệu OOTv2

Đọc README gốc để xem giới thiệu, kiến trúc, cài đặt và demo. Các đường dẫn dưới tương đối với thư mục D:\OOTv2-Game\docs.

## Hồ sơ bàn giao

| Tài liệu | Nội dung |
| --- | --- |
| [PROJECT-STRUCTURE.md](PROJECT-STRUCTURE.md) | Toàn bộ danh mục file nguồn |
| [Hướng dẫn đội](runbook/SINH-VIEN.md) | Bot, repository, receipt và xem kết quả |
| [Hướng dẫn BTC](runbook/BAN-TO-CHUC.md) | Vận hành, triển khai, rollback, backup/restore |
| [Luật v2](17-LUAT-DIA-HINH-VA-XEP-KIN.md) | Địa hình, setup kín, phân màu |
| [Contract](19-CONTRACT-TICH-HOP.md) | API/worker và ranh giới dữ liệu |

## Tài liệu kỹ thuật giữ lại

- 01-THE-THUC-GIAI.md, 03-DAC-TA-KY-THUAT.md: điều lệ/thiết kế Campus.
- 06-GITHUB-NOP-BOT-VA-LUU-TRU.md, GITHUB-CONSUMER.md: nộp/tiếp nhận bot.
- 12-SUPABASE-DATABASE.md, STORAGE-ADAPTER.md, SOURCE-CACHE.md: DB/artifact/cache.
- 14-KIEN-TRUC-CHAM-TRUOC-VA-PHAT-TRAN.md, OFFICIAL-WEEKLY-FLOW.md, OFFICIAL-SCHEDULE.md, OFFICIAL-RUNTIME.md: lịch/runtime/publication.
- CAMPUS-TRUSTED-RUNTIME.md và README trong sandbox ở gốc repo: demo và môi trường cô lập.
- WORKER-PACKAGING.md, PRODUCTION-BOOTSTRAP.md: bộ cài/môi trường.
- SANDBOX-PRODUCTION.md, SANDBOX-WSL.md: điều kiện cô lập và giới hạn môi trường; xem thêm runbook BTC.
- DRILL-MANUAL-WORKER.md, OFFLINE-BUNDLE.md: công cụ bổ sung, không chứng minh manual/offline đã nghiệm thu.
- 05-TICH-HOP-UI-VA-REPO.md, 11-TICH-HOP-UI-KIT.md, ui-style/README.md: UI, asset và token.

## Tài liệu lịch sử

Các đặc tả MVP dùng dấu gạch dưới trong tên 01–03 được giữ để hiểu protocol/replay cũ. SQLite, 8 đội, stateless và setup công khai trong đó **không phải** hướng dẫn Campus hiện hành. Không phục hồi driver cũ hoặc chuyển replay lịch sử sang luật mới.

Một số tài liệu kỹ thuật ghi bằng chứng tại thời điểm viết; test count/migration/remote trong đó không thay việc đối chiếu checkout và ledger hiện tại. Nguồn xác thực hành vi là code/schema/test tương ứng. Hướng dẫn triển khai hiện hành nằm trong runbook BTC; không giữ các biên bản review, chia việc và nhật ký theo ngày trong hồ sơ nguồn.
