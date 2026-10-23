# Campus runtime độc lập — trusted-dev, chưa phải sandbox

Checkpoint 24/10/2026. Phần này phát triển độc lập để Khoa không phải chờ schema của Huy.
Không thay worker/replay MVP, không tự mở Start, không gọi DB/API hoặc tải code GitHub.

## Đã có

- `server/contracts/botProtocol.js`: request/response `bot.v1`, JSON UTF-8 nghiêm ngặt,
  từ chối duplicate key (kể cả escaped key), unknown fields, sai request ID/kind,
  NaN/Infinity, depth >16, input 64 KiB/response 16 KiB.
- `server/judge/campusTrustedSession.js`: process Python sống cả ván, request tuần tự,
  timeout monotonic, tổng wall phản hồi 45 s mặc định, stdout 4 MiB/stderr 256 KiB,
  kill khi vượt budget, môi trường không kế thừa secret, private working directory,
  cleanup có deadline. Bắt output thừa khi quan sát được, không ghép vào request sau.
- `server/judge/campusMatchRunner.js`: setup Red rồi Blue, adapter session inject được,
  campusEngine authoritative (map/repetition/400 plies), engine replay được verify,
  fault đúng active side; lỗi hạ tầng/cancel/cleanup không trả kết quả thua bot.
- `examples/campus_bot.py`: một file Python standard library chỉnh sửa được;
  `setup(obs)`/`move(obs)`, stdin loop, JSONL flush, seed RNG một lần mỗi process.
- `tools/cli/demo-campus-bots.js`: hai bản bot mẫu tin cậy, seed cố định, output mới
  dùng `wx`, không ghi đè replay đã có, không đọc arbitrary bot từ CLI.

Các đường dẫn phía trên tương đối với root repo. Không thêm package/dependency.

## Chạy local (PowerShell từ D:\OOTv2-Game)

```powershell
node --test tests/campusRuntime.test.js
node tools/cli/demo-campus-bots.js --trusted-dev examples/maps/campus-arena.json "$env:TEMP/oot-campus-bots-new.json"
node tools/cli/verify-replay.js "$env:TEMP/oot-campus-bots-new.json"
npm.cmd test
npm.cmd run build
```

Chọn đường dẫn output chưa tồn tại. Demo chỉ chạy bot mẫu trong repo, không source sinh viên.
Replay `campus-engine-replay.v1` là transcript engine, KHÔNG phải replay production có đầy đủ
runtime attestation, source provenance, accepted attempt và publication policy.

## Ranh giới bắt buộc trước tích hợp

`trusted=true` chỉ là xác nhận sử dụng local, **không phải cờ cho phép chạy bot không tin cậy**.
Subprocess, `-I -S -B`, thư mục riêng và timeout không phải sandbox. Không có network/filesystem
isolation, CPU/RAM accounting, cgroup freezer hay seccomp. `cpuRemainingMs:30000` là mức dự kiến
trong observation trusted-dev, không phải số đo; output có `productionReady:false` và limitations.
Không benchmark/chốt budget giải bằng adapter này.

Một số output trễ có thể rơi sát biên request khi không có freezer; ID binding và đọc pipe giúp
phát hiện sai protocol nhưng không thay freeze/ack phía Linux. Không dùng để chứng nhận chống bot ác ý.
Taskkill/process group cleanup không chứng minh toàn cây bot ác ý đã được cách ly/reap.

Huy cần review DTO cho receipt/snapshot/accepted-attempt và RPC claim/heartbeat/fenced write
(bao gồm event/log/terminal); Khoa không tự đoán tên RPC. Worker phải abort adapter khi mất lease,
không publish replay kín, không đổi pending validation thành invalid khi lỗi mạng/disk/Python.

K4 production còn Linux supervisor/nsjail/cgroups/launcher readiness, pin rootfs/runtime/budget,
CPU/RAM measurement, freeze acknowledgment, subreaper/verify-empty, host preflight và fault suite
trên VM sạch. Không chạy fork bomb/network/file probing trên máy cá nhân hoặc WSL có secret.
Sandbox acceptance không phụ thuộc schema DB, nhưng cần host sạch được chuẩn bị và runtime pin
được nhóm/BTC duyệt. Không coi Windows integration tests là Linux sandbox PASS.