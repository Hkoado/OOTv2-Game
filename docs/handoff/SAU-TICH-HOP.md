# Các bước còn lại để hoàn thiện sau Huy / Bảo / Khoa

Checklist này chưa được nghiệm thu. Người tích hợp ghi commit, ngày, môi trường và bằng chứng khi đánh dấu.
Hoàn thành H1/B1/K1 chỉ là **PR đầu tiên**, không phải hoàn thành cả gói H1–H4/B1–B4/K1–K4.
Nếu các gói đã có bằng chứng VERIFIED thì kiểm lại trên nhánh tích hợp, không bắt viết lại tính năng.

## 1. Thu kết quả và tích hợp có kiểm soát

- [ ] Đọc ba báo cáo; kiểm commit/PR tồn tại và merge đúng nhánh. Xác định contract đã duyệt,
  chỗ còn fixture, API thiếu và migration chưa apply. Không tự coi đề xuất contract là quyết định BTC.
- [ ] Merge từng PR, giải conflict theo ownership; full test/build sau mỗi đợt, không merge nguyên Backend cũ.
- [ ] Trên project disposable được phép: migration theo thứ tự, private grants/RLS/RPC/Storage,
  session/CSRF/HTTPS/cookie/proxy. Thử nâng từ schema cũ, không chỉ cài DB trống. Backup trước rollout.
- [ ] Review dependency vulnerabilities và secrets/credential rotation nếu cần; không tự audit fix mù.

## 2. E2E nghiệp vụ chính thức trên nhánh tích hợp

- [ ] Tài khoản đội → đăng ký repo được duyệt → receipt đúng SHA → validation → snapshot theo vòng
  → scheduler → kết quả/replay kín → BTC đặt lịch → viewer nhận đúng mốc → mở kết quả sau phát xong.
- [ ] Counts 35/40/48/50, điểm cặp/tie mini-table, tránh cùng bảng, ván phụ/tranh ba,
  bye/double-DQ/walkover/vé bù. Map/rules/protocol/runtime hash đúng và không đổi snapshot sau khóa.
- [ ] Cutoff race/force-push/revoke/rate limit/cùng SHA/mất cache; giữ valid cũ khi lỗi hạ tầng,
  không tính đôi hoặc nhận HEAD sau hạn. API chạy không cần git/Python.
- [ ] Membership/IDOR trên list/detail/events/replay/file/standings/bracket/log; khách/khác giải bị chặn,
  cùng giải xem vòng sau đã công bố; sửa afterSeq/clock client không lộ nước tương lai hoặc kết quả kín.

## 3. An toàn runtime và khả năng chịu lỗi — gate mở bot sinh viên

- [ ] Kiểm sandbox Linux thật trên VM sạch: filesystem/network/CPU/RAM/process/flood/timeout/cleanup;
  xác nhận không secret vào bot. Chưa có bằng chứng thì chỉ trusted-dev, không mở nhận code lạ.
- [ ] Hai worker tranh job, lease hết hạn, stale result/event/log/terminal, duplicate finish,
  kill giữa ván, DB/Storage/GitHub mất mạng; lỗi hạ tầng không quy đội thua.
- [ ] Pin runtime/budget và benchmark; pause queue/cảnh báo/khôi phục, log/audit và retention có giới hạn.

## 4. Browser, tải và hồi quy

- [ ] Browser thật team/admin, hai theme, mobile, keyboard, draft/conflict/logout,
  viewer countdown/catch-up/reset/reconnect và không tải replay tương lai.
- [ ] Đo tải 50/100/200 viewer + đợt nộp bài + 2 game slots theo đặc tả; ghi P95/request rate/error,
  tài nguyên DB/API/worker, quota thực và thời lượng toàn giải. Điều chỉnh polling từ số đo, không từ phỏng đoán.
- [ ] Hồi quy replay MVP và game/phòng/spectator hai máy; code còn trong repo không đồng nghĩa đã dùng được.

## 5. Offline giải chính thức và khôi phục — milestone riêng

- [ ] Chốt kiến trúc offline không Internet tương thích quyết định Supabase-only hiện hành với BTC.
  Không tự thêm SQLite fallback; nếu cần đổi quyết định phải có ADR/phê duyệt trước code.
- [ ] Export gói pin bot cũ/map/runtime/manifest/hash trước khi ngắt mạng; phát đúng bot cho đội,
  cho dùng/sửa/thay, thu USB và seal/cutoff/receipt; không kéo GitHub trong giờ thi.
- [ ] BTC chấm/xem không mạng, import kết quả idempotent, không có ván giả hoặc đổi snapshot.
  Chơi tay offline hiện có không thay thế quy trình này.
- [ ] Backup nhất quán và restore máy dự phòng; diễn tập mất điện/mất máy/mất mạng, kiểm artifacts,
  accepted results và chạy lại cùng snapshot/map/seed. Có ít nhất hai người thao tác phục hồi được.

## 6. Vận hành và phát hành

- [ ] Preview HTTPS với project test, GitHub App/credential tối thiểu, Storage private,
  giám sát worker/job lỗi; tài liệu cài máy chấm, env chỉ tên biến và runbook xử lý sự cố.
- [ ] BTC phê duyệt điều lệ/cutoff/map pack/budget/quota/lịch công bố/quy trình khiếu nại,
  kiểm audit/xác nhận sửa kết quả và quyền vận hành; không coi quyền kỹ thuật là quyền tổ chức đã duyệt.
- [ ] Diễn tập giải đầy đủ bằng dữ liệu thử; ghi biên bản PASS/FAIL/NOT RUN, đóng blocker mức mở giải.
- [ ] Rollout có backup, thứ tự schema/code, rollback đã thử và người trực vận hành.
  Chỉ người được phép deploy/apply remote; push GitHub không tự có nghĩa production-ready.

## Tiêu chuẩn hoàn thiện

Chỉ báo “sẵn sàng giải chính thức” khi luồng E2E đúng luật/quyền, sandbox bot lạ, tải và recovery
có bằng chứng trên môi trường triển khai; offline hoàn tất nếu công bố phạm vi giải online + offline.
Có thể nghiệm thu online trước nhưng phải ghi rõ offline chưa xong, không tuyên bố toàn dự án hoàn thiện.
Agent sau chọn một checkbox còn thiếu làm milestone, không tự thực hiện toàn checklist trong một phiên.