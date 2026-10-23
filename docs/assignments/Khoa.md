# Khoa — Thể thức chính thức, scheduler và worker/runtime

## Đọc và hiện trạng

Đọc AGENTS.md, docs/16, đủ docs/01-THE-THUC-GIAI.md và docs/03-DAC-TA-KY-THUAT.md,
docs/06, docs/14, campusEngine/replay/worker/RPC thật. Ưu tiên Supabase-only và policy theo giải
ở docs/14 hơn SQLite/ACL vòng trong docs cũ. Không đổi replay MVP thành Campus.
Setup foundation đã có, chưa runtime chính thức. `ott-campus.v1` engine thuần có sẵn; worker vẫn MVP.

## Ownership

`src/game/competition.js`, `server/shared/{tournaments,officialSetup,worker,artifacts}.js`,
scheduler thuần, `server/judge/*`, protocol/SDK/sandbox, test runner/scheduler.
Migration scheduler file riêng bạn viết, Huy review; không sửa router/intake hoặc React của hai người khác.
Contract snapshot/job/output cần chốt với Huy, standings/bracket DTO gửi Bảo trước tích hợp.

## Các PR theo thứ tự

1. **K1 — Thể thức thuần:** round-robin 2 ván/cặp cùng map/seed, balanced groups thresholds,
   điểm ván 1/0.5/0 và điểm cặp 3/1/0. Tie: điểm bảng → mini-table từ nhóm đồng điểm ban đầu
   → tổng điểm ván → điểm ván mini-table → seeded draw; không lặp tách mini-table.
   Tests 35/40/48/50 + biên 4/7/8/15/16/31/32/56, không mutation/nonseed RNG.
2. **K2 — Bracket/vé/snapshot:** tỷ lệ seed so phân số chính xác; nhất bảng trước nhì,
   tránh cùng bảng vòng đầu bằng permutation tổng lệch nhỏ nhất rồi lexicographic, lưu permutation,
   fixed bracket không reseed. Main 4 / final 6 / extra đúng 2 rồi seed, đủ ván, tranh ba.
   Bye/double-DQ/walkover không ván giả; ranking/cấp bù vé không trùng; kỳ 3 tháng/6 đội 2 bye.
   Snapshot/map hash/runtime bất biến theo vòng, không trỏ latest submission toàn đội như MVP.
3. **K3 — Worker GitHub/job:** consume contract Huy, claim/lease/fencing/retry/backoff, bounded blob SHA/hash,
   không clone branch HEAD, không secret vào bot; giữ valid cũ khi lỗi hạ tầng, pin/cache/GC.
   Không chỉ fence result: live/log/terminal cũng phải thuộc accepted attempt, tránh stale worker overwrite.
4. **K4 — Runtime chính thức:** persistent bot.v1 + SDK, nối campusEngine/map/repetition/400 plies;
   Linux supervisor/nsjail/cgroups/preflight trên VM sạch, budgets benchmark. Chưa có sandbox thì
   chỉ fixtures/bot tin cậy, không tuyên bố production. Offline bundle/cache/receipt/restore là milestone
   kế tiếp phối hợp cả nhóm, không dùng SQLite fallback để chạy offline khi đã chốt Supabase-only.

## Test và Done

Mỗi PR nhỏ: pure tests trước → persistence/RPC integration trên project disposable → worker E2E.
Thiếu Python/git/disk/mạng/DB là hạ tầng, không forfeit. Hai worker tranh job/lease hết hạn/crash/
duplicate finish không tính đôi. Bot fault chỉ đúng bên đang được yêu cầu.
Runtime không thay đổi luật game phòng; regression engine/replay cũ, test/build và báo NOT RUN Linux.
Không bỏ trigger `official_scheduler_not_ready` cho đến khi snapshot/runner/privacy của Huy đạt gate;
thay bằng migration reviewed chứ không sửa migration đã apply. Không tự bật giải thật/deploy/apply remote.

## Bàn giao kết quả bắt buộc trong thư mục chung

- Đọc [quy ước bàn giao](../handoff/README.md); sau mỗi PR/milestone và trước khi dừng phiên,
  cập nhật **`docs/handoff/Khoa.md`**, commit cùng code, không chỉ báo trong chat.
- Ghi branch/SHA/PR, scheduler/worker exports và contract, snapshot/map/runtime versions, migration
  applied/not applied, test counts/exit, mock/DB/Linux phân biệt; không gọi subprocess là sandbox đã đạt.
- Nêu gate Start, lease/fencing/recovery và offline còn thiếu, dependency Huy/Bảo, cách tái hiện và bước tiếp;
  chỉ sửa báo cáo của mình. Lỗi/NOT RUN không được chuyển thành PASS để đóng milestone.
- Xem [checklist sau tích hợp](../handoff/SAU-TICH-HOP.md): pure tests hoặc K1 không thay K2–K4,
  E2E/privacy/load/restore và diễn tập giải. Chuyển phần chưa làm cho agent sau bằng chứng cụ thể.

## Prompt tiếp tục

> Tôi là Khoa. Đọc AGENTS.md, docs/16-THIET-LAP-CHINH-THUC-VA-CHIA-VIEC.md và docs/assignments/Khoa.md.
> Kiểm Git/baseline, chỉ làm K1: scheduler vòng bảng và standings thuần đúng điều lệ chính thức,
> dùng seed lưu, cùng map/seed trong cặp đổi màu, điểm cặp khác điểm ván và mini-table không đệ quy.
> Đọc campusEngine/code export thật, giữ profile MVP/replay cũ, không mở Start hoặc sửa router/UI.
> Chốt DTO với Huy/Bảo, tests counts 35/40/48/50 và tie nhiều đội; không DB thật mặc định.
> Chạy full test/build, báo kết quả/giới hạn, không tự deploy/apply SQL hoặc chạy bot lạ. Dừng sau K1.
> Trước khi dừng, đọc docs/handoff/README.md và cập nhật docs/handoff/Khoa.md theo mẫu chung, commit cùng code;
> ghi SHA/PR, scheduler/worker contract, migration, tests/exit, NOT RUN Linux/offline, blocker và bước tiếp.