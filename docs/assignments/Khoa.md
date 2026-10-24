# Khoa — Runtime chính thức, điều phối giải và máy chấm

## Nhiệm vụ hiện hành — 24/10/2026

Đọc AGENTS.md, docs/18-CHOT-HOAN-THIEN-VA-NGHIEM-THU.md,
docs/19-CONTRACT-TICH-HOP.md, docs/17, điều lệ, OFFICIAL-RUNTIME và code/test thật.
Hoàn thiện **toàn gói**, không chỉ K1 rồi dừng chờ user. Giữ engine/protocol/replay lịch sử.

## Ownership

Engine/protocol/runner/scheduler/worker/artifact runtime, sandbox/SDK, tools/vm và provisioning/service.
SQL runtime mới file riêng do bạn viết, Huy review/tích hợp. Không sửa router/auth/intake hoặc React.
File config/package/lock chung yêu cầu Huy thay đổi; cung cấp export/adapters/DTO để Huy/Bảo nối.

## Phải hoàn thành

1. Worker Campus chính thức riêng, nối runner đã có: claim/heartbeat/lease/token generation,
   accepted attempt, bounded artifacts/replay, fencing result/log/terminal, retry/backoff/pause/recovery.
   Hai worker và duplicate finish không tính đôi; stale attempt không overwrite. Không fallback MVP.
2. Snapshot source/map/runtime/budget hash trước chạy; setup kín Campus v2, bot tự setup đủ 9 quân.
   Lỗi infra không forfeit, lỗi bot chỉ quy đúng bên được yêu cầu, không lấy thứ tự OS event chọn thua.
3. Online orchestration: pin lịch/màu trước ván, group → accepted result → standings → knockout/vé,
   ván phụ/tranh ba/bye/DQ/walkover, tie-break đúng điều lệ; không sinh fake games hoặc màu từ kết quả tương lai.
   Đủ persistence và service exports để Huy nối API, Bảo hiển thị; không chỉ hàm thuần/mock.
4. Job chung kết thủ công: nhận hai đội/submission đã khóa, map/seed/runtime/cấu hình cặp;
   dùng cùng queue/runner/sandbox, provenance manual rõ. BTC chủ động cặp/vòng/đi tiếp,
   không cần tự điều hành toàn buổi. Không lookup latest khi chấm, không runner manual thứ hai.
5. Sandbox VM Linux thật: filesystem/network/CPU/RAM/PIDs/stdout/timeout/cleanup, attestation
   còn hạn, runtime identity, không secret vào bot. Không gọi subprocess là sandbox an toàn.
6. Hoàn thiện Windows → Hyper-V cài/control/update/rollback; máy worker không cần web/API local.
   Sửa attestation path `/srv/ootv2/current`, SSH user/cloud-init/config nhất quán, doctor thiếu lệnh
   và dependency WSL image prep, config JSON null, service state/update health/rollback/abort.
   Review quyền/cgroup/env/cache: hardening intake không tự động phù hợp match runner.
7. VM rehearsal cài sạch, service start/stop/reboot, attestation expired, update hỏng/rollback,
   kill giữa ván, mất DB/Storage/GitHub. SSH fingerprint phải đối chiếu console, không tắt verification.
8. Benchmark counts 35/40/48/50 và worker capacity, hai máy tranh job khi có môi trường,
   runbook backup/artifacts/recovery. Không coi mock hoặc WSL test là VM production acceptance.

## Hoãn

Không triển khai bundle thi hoàn toàn không Internet, local DB, SQLite fallback, thu/phát USB
tự động hoặc sync/import offline kết quả. Giữ module offline-bundle cũ nhưng không mở rộng.
Chung kết thủ công vẫn dùng API/Supabase/worker có kết nối. USB bot vẫn không tin cậy.

## Contract, Done và bàn giao

Điền job/runtime/schedule/accepted result mapping docs/19 với Huy; Bảo xác nhận DTO.
Adapter/tests contract cho phép làm song song, rồi tự nối persistence thật sớm. SQL additive,
Huy review grants/transactions; không tự apply remote/push/deploy hoặc bỏ Start gate để demo.
Thay gate chỉ khi orchestration/runtime/privacy đạt bằng migration reviewed, không sửa migration đã áp.

Node built-in tests, DB concurrency được phép, Linux VM acceptance và orchestration E2E;
full regression/build/diff. Mọi command có exit/evidence. `docs/handoff/Khoa.md` ghi commit,
exports/job/schema/runtime versions, applied/not applied, mock vs VM thật, NOT RUN/blocker.
Giao installer/control/recovery đã thử, ký gate runtime/install/scale và hai E2E.
Còn trách nhiệm sửa lỗi runtime tích hợp tới RC cuối, không để user nối scheduler/worker.

## Prompt giao Khoa

> Bạn là Khoa. Đọc AGENTS.md, docs/18, docs/19, docs/17 và toàn bộ phân công này, kiểm code/status/baseline.
> Hoàn thiện toàn runtime chính thức/scheduler/worker/sandbox/Windows installer, không chỉ K1 rồi dừng.
> Tái sử dụng runner Campus, không fallback MVP. Chốt persistence/job/DTO với Huy/Bảo và tự nối/test thật.
> Chung kết thủ công dùng chung worker, source manual đã khóa; offline không Internet đã hoãn.
> Nghiệm thu VM/sandbox/2 worker/crash/update rollback, không thay bằng mock/WSL. Không secret vào bot,
> không tự apply remote/push/deploy hoặc tắt gate an toàn. Cập nhật handoff evidence/runbook,
> phối hợp fix tích hợp tới RC một bản để user review cuối rồi tự deploy Vercel.