# Bảo — UI hiện có, trải nghiệm hoàn chỉnh và browser nghiệm thu

## Phân công hiện hành — 25/10/2026

Ưu tiên [RC online tối giản](../20-RC-ONLINE-TOI-GIAN.md). Chỉ thực hiện:

1. UI đội xem standings/bracket/vé/ván đã công bố và mở viewer; không tính điểm client.
2. Nối cutoff batch; hoàn thiện thao tác online, loading/error/401/403/409/logout/refresh.
3. Bắt đầu bằng DTO/fixture đã chốt, tự nối API thật ngay khi có; không fallback fixture
   ở production. Giữ component/style hiện có, không redesign hoặc thêm framework.
4. Một smoke browser online admin/đội/khác giải và review script ngắn; hướng dẫn đội.

Sở hữu frontend portal/adapters/tests và runbook SINH-VIEN; không sửa server/schema.
Tạm gác nghiệm thu/manual E2E và benchmark dài; không chờ health UI mới hoàn thiện online.
Ghi evidence/NOT RUN trong handoff; phối hợp sửa boundary, không chuyển việc nối UI cho Huy/user.

---

## Lịch sử ngày 24/10 — không dùng làm checklist giao việc đợt này

## Nhiệm vụ hiện hành — 24/10/2026

Đọc AGENTS.md, docs/18-CHOT-HOAN-THIEN-VA-NGHIEM-THU.md,
docs/19-CONTRACT-TICH-HOP.md, docs/17, UI-GUIDE và UI đang mount.
Hoàn thiện **toàn gói**, không chỉ B1 rồi chờ user review. Checkpoint nhỏ là nội bộ.

## Ownership và giới hạn UI

Sở hữu `src/tournament/portal/*`, frontend adapters, browser automation/load harness và hướng dẫn.
Tái sử dụng TournamentUi, token/font/icon/asset/layout hiện có. Không redesign/phong cách/theme mới,
không thêm framework/UI library. Hai theme và desktop viewport theo UI-GUIDE; nhỏ hơn có fallback,
không tự mở dự án mobile redesign. Không sửa router/schema/engine; yêu cầu đúng owner sửa boundary.

## Phải hoàn thành

1. UI online thật: thiết lập tuần/tháng/kỳ, roster/repo, map công bố/khóa, cutoff/receipt/SHA,
   readiness, snapshot/vòng, tiến độ chấm, pause/retry hợp lệ, lịch/màu, standings/bracket/vé.
2. UI viewer publication: server time, countdown/cursor/catch-up/reset/reconnect; chỉ nhận nước
   và kết quả được server cho phép, không tải replay đầy đủ rồi giấu bằng UI.
3. Mục riêng **Chung kết thủ công**, BTC-only: tạo đợt/vòng, chọn đội/map/runtime, nạp `.py`,
   lịch sử/hash/validation, chọn phiên bản/khóa bài, chọn cặp/yêu cầu chấm, điểm/lý do/replay,
   xác nhận đi tiếp và cancel/rerun có reason theo API. Không cho sửa engine result bằng form điểm.
4. Không quảng cáo mất Internet vẫn chạy: hệ thống này cần API/Supabase/worker. Không làm bundle,
   import offline hai chiều, thu USB tự động hoặc phòng thi. BTC tự thu file rồi nạp web.
5. Bỏ CTA online upload sai scope; không dùng admin fallback hiện tại như đã đủ manual final.
   Không nhận PAT, không fetch GitHub trực tiếp từ browser, không nút fake-success.
6. Hoàn thiện dirty draft/conflict, 401/403/409, loading/empty/error, logout, timeout/retry,
   keyboard/focus và tiếng Việt. State của đội trước không còn sau đổi account/logout.
7. Browser E2E admin/team/khác giải, hai theme/desktop, refresh/reconnect; UI không phải lớp ACL.
   Đo tải viewer 50/100/200 bằng harness và rehearsal thật cùng Huy/Khoa, ghi P95/error/request rate.
8. Hướng dẫn đội nộp GitHub và BTC vận hành online/chung kết thủ công, kịch bản review RC.

## Contract và tích hợp

Xác nhận DTO/docs/19 cùng Huy/Khoa trước boundary. Làm ngay trên fixture versioned,
sau đó tự nối API thật; fixture/mocks không chứng minh E2E. Tích hợp sớm một giải nhỏ bằng
runtime chính thức. Gửi lỗi tái hiện/contract test cho đúng owner, tiếp tục phần độc lập;
không đợi Huy tự kiểm mọi màn và không chuyển việc nối API cho user.

## Done và bàn giao

- UI online và chung kết thủ công chạy với API/worker thật; không cần DevTools/sửa DB để qua luồng chính.
- Chạy unit adapter, browser, full test/build/diff phù hợp; phân biệt mock/test env/production.
- `docs/handoff/Bao.md`: commit, API thực/fixture, browser/theme/viewport, script và evidence,
  exit code/số đo, NOT RUN/blocker. Không commit cookie/ảnh dữ liệu cá nhân.
- Cung cấp review script và hướng dẫn; ký gate UI/load và hai E2E trong docs/18.
  Còn trách nhiệm sửa bug tích hợp/UI tới khi RC đạt, không dừng khi component render được.

## Prompt giao Bảo

> Bạn là Bảo. Đọc AGENTS.md, docs/18, docs/19, UI-GUIDE và toàn bộ phân công này; kiểm baseline/status.
> Hoàn thiện toàn UI online và mục Chung kết thủ công theo UI hiện có, không sáng tạo phong cách,
> redesign hay đổi framework. Chốt DTO với Huy/Khoa, dùng fixture để song song nhưng phải tự nối API thật.
> Offline hoàn toàn không Internet đã hoãn; chỉ BTC nạp bot/chọn/khóa/chấm/xem bằng hệ thống có kết nối.
> Không sửa server/engine hoặc tự mở gate. Browser test admin/team/privacy, hai theme/desktop,
> load/reconnect, test/build; cập nhật handoff bằng chứng. Không chỉ làm B1 rồi chờ user review.
> Phối hợp sửa lỗi tích hợp tới RC cuối; user không phải nối màn hình hoặc gọi API thủ công.