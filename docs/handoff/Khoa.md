# Kết quả Khoa — Scheduler / worker / runtime

## Trạng thái mới nhất

- Trạng thái: **NOT STARTED** — mẫu báo cáo được tạo trước khi nhận kết quả Khoa.
- Phạm vi: K1–K4 trong [phân công Khoa](../assignments/Khoa.md).
- Checkpoint nguồn: `3de220e`; chưa có branch/commit/PR kết quả được xác minh.
- Chưa có bằng chứng scheduler/runner chính thức hoặc sandbox của Khoa đã hoàn thành.
- Bước đầu: kiểm Git/code/điều lệ, contract snapshot/job và baseline trước khi bắt đầu K1.

## Kết quả và bằng chứng

Khoa cập nhật theo [mẫu chung](README.md) sau mỗi PR. Bắt buộc nêu fixtures counts/tie/bracket/bye/vé,
DTO standings, phiên bản snapshot/map/protocol/runtime/budget, RPC claim/heartbeat/finish/retry,
fencing event/log/result, bounded fetch/cache/GC và lỗi hạ tầng. Ghi chính xác Linux host/preflight,
sandbox fault tests và cleanup đã chạy/chưa chạy; subprocess không phải sandbox.
Chỉ ra gate Start còn chặn gì, migration nào mới đề xuất, không tự mở gate hoặc apply remote.

## Blocker / NOT RUN / bước tiếp

Chưa nhận kết quả nên chưa có mục được VERIFIED; test engine thuần không chứng minh worker E2E/sandbox.

## Lịch sử checkpoint

- 23/10/2026: tạo khung bàn giao, chưa thực hiện thay người được giao.