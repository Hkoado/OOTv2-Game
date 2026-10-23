# Bảo — Frontend GitHub/setup, viewer và QA sản phẩm

## Đọc và hiện trạng

Đọc AGENTS.md, docs/16, docs/05-TICH-HOP-UI-VA-REPO.md, docs/06, docs/14 và style kit.
Portal đã tạo cấu hình chính thức với preview 35–50 đội; executionReady=false là gate có chủ ý.
GitHub trong profile mới là metadata, chưa có intake; live hiện public/immediate cần thay.
Không coi trang upload hoặc viewer cũ là sản phẩm đã đạt đặc tả mới.

## Ownership

`src/tournament/portal/*`, frontend DTO adapters, browser fixtures/automation và docs/runbook UI.
Không sửa server/router/schema (Huy), competition engine/scheduler (Khoa). API/config chung phải chốt trước.
Giữ theme/fonts/assets hiện có, React/Vite, không tạo app mới hoặc nâng framework.

## Các PR theo thứ tự

1. **B1 — Setup + trạng thái chuẩn:** review form tuần/tháng/kỳ, dirty draft không bị polling ghi đè,
   conflict version/reload có cảnh báo; timezone rõ UTC/local; roster/groups dynamic A–H, map chính/dự phòng.
   Hoàn thiện UX chọn/công bố pack khi API có, không biến preview thành draw đã khóa.
   Xây fixtures theo DTO Huy: resolving/fetching/checking/valid/invalid/infrastructure/frozen.
2. **B2 — GitHub UI thật:** repo/branch + nút cập nhật, SHA/receipt/cutoff/quota, bản valid/bản locked,
   loading/error/retry. Thay CTA file upload online sau H1/H2. Không nhận PAT hoặc fetch GitHub trực tiếp
   từ browser, không nút sync giả. Offline USB/admin fallback vẫn riêng, không xóa theo yêu cầu “bỏ upload”.
3. **B3 — Viewer lịch phát:** nối publication API Huy; countdown/catch-up/server_time/afterSeq,
   không tải sẵn replay đầy đủ rồi giấu bằng UI. Phát cùng mốc cho hai tài khoản, dừng poll tab ẩn,
   backoff/jitter, reconnect/reset/dedup; chỉ show kết quả khi server cho phép.
   UI standings/bracket chính thức theo DTO Khoa, không giữ labels/điểm MVP cho giải mới.
4. **B4 — QA và runbook:** browser automation team/admin/hai theme/keyboard/mobile/dirty draft/logout,
   tải 50/100/200 viewer và ghi request rate/P95/lỗi thay vì ước lượng; phối hợp Huy/Khoa trace DB/worker.
   Hướng dẫn sinh viên repo receipt, BTC setup/publish/khôi phục, regression room hai máy/spectator.

## Test và Done

Node built-in test cho pure adapters và browser tests với backend test/mock tách rõ; không login DB thật
mặc định. Đội khác không có dữ liệu cũ sót sau logout; API 403/409 không blank page/mất draft.
Mọi action thật có trạng thái thành công/thất bại; không tự mở Start khi runner/privacy chưa nghiệm thu.
Chạy full suite/build, verify browser thực và screenshot local gitignored; báo phần chưa chạy.
Không copy UI Backend nguyên vì routes/driver cũ khác dev; tận dụng bố cục sau đối chiếu contract.

## Prompt tiếp tục

> Tôi là Bảo. Đọc AGENTS.md, docs/16-THIET-LAP-CHINH-THUC-VA-CHIA-VIEC.md và docs/assignments/Bao.md.
> Kiểm branch/status/baseline; chỉ làm B1: review và hoàn thiện UX thiết lập giải chính thức, dirty draft,
> conflict version/timezone, fixtures trạng thái GitHub theo contract Huy. Giữ executionReady=false,
> không viết API giả hoặc tự bật chấm. Dùng React/style kit đang có; không sửa router/schema/engine.
> Phối hợp Huy/Khoa khi DTO chưa chốt thay vì đoán. Chạy test/build và browser QA nếu có thể, báo mock vs
> integration/NOT RUN, không tự deploy hoặc dùng credential thật. Dừng sau B1.