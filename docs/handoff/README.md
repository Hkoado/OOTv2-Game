# Bàn giao chung — Huy / Bảo / Khoa

## Quyết định hiện hành 24/10/2026

Ưu tiên [phạm vi chốt](../18-CHOT-HOAN-THIEN-VA-NGHIEM-THU.md) và
[contract](../19-CONTRACT-TICH-HOP.md) trước chỉ dẫn lịch sử dưới đây.
Ba người hoàn thiện toàn gói, checkpoint/test nội bộ; không chỉ H1/B1/K1 rồi chờ user.
User nghiệm thu một RC tích hợp, tự deploy Vercel. Offline hoàn toàn không Internet hoãn;
chỉ Chung kết thủ công BTC nạp/chọn/khóa/chấm qua hệ thống có kết nối.
Mỗi owner tự nối/sửa lỗi phần mình tới RC; Huy tổng hợp, Bảo browser/review script,
Khoa VM/runtime/runbook. Prompt chọn một bước rồi dừng ở cuối file không thu hẹp nhiệm vụ mới.

Thư mục duy nhất để ghi **kết quả thực hiện**, khác với kế hoạch trong `docs/assignments/`.
Khởi tạo ngày 23/10/2026 tại checkpoint `3de220e` (dev); đây chưa phải báo cáo hoàn thành của ba người.

## Agent tiếp theo đọc theo thứ tự

1. AGENTS.md và `docs/16-THIET-LAP-CHINH-THUC-VA-CHIA-VIEC.md` để hiểu quyết định hiện hành.
2. [Huy.md](Huy.md), [Bao.md](Bao.md), [Khoa.md](Khoa.md) — trạng thái, commit, contract và bằng chứng.
3. [Các bước sau tích hợp](SAU-TICH-HOP.md).
4. Kiểm Git/status/code/schema thật; xác minh commit đã merge, không chỉ tin nhãn DONE trong báo cáo.

## Quy tắc bắt buộc cho cả ba người

- Sau **mỗi PR/milestone**, kể cả còn dở hoặc bị chặn, cập nhật file mang tên mình trong thư mục này
  và commit cùng code. Trước khi dừng phiên phải ghi điểm đang dở và lệnh tiếp theo có thể chạy.
- Mỗi người chỉ sửa báo cáo của mình để tránh conflict; không ghi kết quả vào báo cáo người khác.
  Người tích hợp cập nhật checklist trong `SAU-TICH-HOP.md` sau khi tự kiểm chứng.
- Giữ phần trạng thái mới nhất ở đầu, thêm lịch sử checkpoint phía dưới; không xóa bằng chứng cũ.
- Trạng thái chuẩn: `NOT STARTED`, `IN PROGRESS`, `BLOCKED`, `READY FOR REVIEW`, `VERIFIED`.
  `VERIFIED` phải ghi phạm vi/môi trường; unit pass không đồng nghĩa production hoặc DB thật pass.
- Dẫn đường dẫn file từ root repo + tên export/route/RPC, commit/branch/PR. Nếu chính commit báo cáo
  chưa có SHA, ghi commit code đã biết và “SHA commit báo cáo: tra bằng git log -- docs/handoff/<tên>.md”.
- Mỗi lệnh ghi ngày, môi trường, exit code, pass/fail/skip và log đã làm sạch. Tách rõ mock,
  PostgreSQL integration, browser, Linux sandbox, load, offline; chưa chạy ghi `NOT RUN` cùng lý do.
- Đính kèm contract đã làm thật: request/response/error/status, schema/RPC và breaking changes;
  phân biệt đề xuất với contract đã được nhóm/BTC chốt. Người dùng chưa duyệt đề xuất không được coi là duyệt.
- Ghi migration ordering và **applied/not applied/project test**; không ghi secret/project credential.
  Không tự apply remote/deploy vì có file bàn giao. Ghi cờ gate bật/tắt và cách rollback được kiểm chứng.
- Chỉ commit Markdown, fixture vô hại và script tái hiện vào repo. Log/screenshot lớn giữ ở `data/`
  gitignored hoặc nơi nhóm được phép truy cập; ghi vị trí, cách tái tạo và hạn chế truy cập.
  Không commit `.env`, token, mật khẩu, cookie, source bot sinh viên hoặc thông tin cá nhân.
- Báo cáo cuối chat chỉ tóm tắt và dẫn về file đã cập nhật; không để bằng chứng chỉ nằm trong chat.

## Mẫu nội dung mỗi checkpoint

```text
Ngày / người / milestone / trạng thái:
Branch / commit code / PR / đã merge vào đâu:
Đã làm (hành vi thực, không chép lại kế hoạch):
File / export / route / RPC quan trọng:
Contract thực hiện + ví dụ JSON không secret + trạng thái lỗi:
Migration thứ tự / applied chưa / env mới (chỉ tên biến):
Tests: lệnh | môi trường | exit | pass/fail/skip | vị trí log:
NOT RUN + lý do:
Giới hạn / bug còn lại / gate đang tắt / rủi ro:
Dependency người khác + phần chưa tích hợp:
Cách chạy demo và rollback (đã thử hay chỉ đề xuất):
Bước tiếp theo nhỏ nhất: file, test cần thêm, lệnh kiểm chứng:
```

## Prompt cho agent nhận tiếp

> Đọc AGENTS.md, docs/16 và toàn bộ docs/handoff theo README. Kiểm tra Git và đối chiếu các SHA
> bàn giao với nhánh tích hợp; giữ thay đổi người dùng. Tổng hợp VERIFIED/BLOCKED/NOT RUN từ ba báo cáo,
> không suy việc đã xong từ placeholder hoặc unit test. Đọc SAU-TICH-HOP.md, chọn đúng một bước còn thiếu
> có thể kiểm chứng và nêu kế hoạch trước khi code. Không tự đổi contract chưa duyệt, bỏ gate,
> deploy/apply SQL remote hoặc chạy bot không tin cậy. Kết thúc cập nhật bằng chứng và bước tiếp vào
> báo cáo tương ứng/checklist tích hợp, chạy test/build phù hợp, ghi rõ điều chưa nghiệm thu.