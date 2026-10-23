# Sandbox Linux trên WSL — K4a, dev acceptance (chưa production)

Trạng thái 24/10/2026: đã dựng **distro WSL2 riêng** và chạy runner sandbox với 11/11 kiểm tra
cách ly. Đây là **dev acceptance**, không phải sandbox production: chưa có seccomp, chưa có
attestation, chưa nối worker và chưa được dùng cho code sinh viên không tin cậy.

## Môi trường đã dựng (không nằm trong repo)

| Thành phần | Giá trị |
|---|---|
| Distro | `ootv2-sandbox`, import từ Ubuntu base 24.04.3, đặt tại `data/wsl/ootv2-sandbox` (gitignored) |
| WSL | 3.0.3.0, kernel `6.18.54.1-microsoft-standard-WSL2` |
| Python | 3.12.3 (chỉ stdlib) |
| Cách ly | `bubblewrap 0.9.0` + cgroup v2 (`cpu memory pids`), chạy bằng root trong distro |
| Khác | Không dùng Ubuntu cá nhân; không mount `/mnt` vào sandbox; `clearenv` |

Tái lập:

```powershell
# tải rootfs + import distro riêng (D: còn trống; C: không dùng)
wsl.exe -d Ubuntu -u root -- curl -fL -o /mnt/d/OOTv2-Game/data/wsl/ubuntu-base.tar.gz `
  https://cdimage.ubuntu.com/ubuntu-base/releases/24.04/release/ubuntu-base-24.04.3-base-amd64.tar.gz
wsl.exe --import ootv2-sandbox D:\OOTv2-Game\data\wsl\ootv2-sandbox `
  D:\OOTv2-Game\data\wsl\ubuntu-base.tar.gz --version 2

# cài tối thiểu trong distro mới
wsl.exe -d ootv2-sandbox -u root -- bash -c 'apt-get update'
wsl.exe -d ootv2-sandbox -u root -- bash -c 'DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends python3 bubblewrap ca-certificates procps'
```

Script trong repo phải giữ LF (`.gitattributes` đã khóa `*.sh`); nếu checkout Windows làm CRLF:
`wsl.exe -d ootv2-sandbox -u root --exec /usr/bin/sed -i 's/\r$//' /mnt/d/OOTv2-Game/sandbox/linux/*.sh`.

## Runner

`sandbox/linux/run-bot.sh --bot <abs.py> [--timeout-ms 10000] [--memory-bytes 268435456]
[--pids 32] [--cpu-max "50000 100000"] [--metrics /abs/metrics.json]`

- stdin/stdout/stderr **truyền nguyên** cho bot; stdout dành riêng cho JSONL `bot.v1`.
- Trong sandbox: `--unshare-all` (user/pid/net/ipc/uts/cgroup), `clearenv`, `--cap-drop ALL`,
  `/usr` read-only, `/proc` + `/dev` riêng, `/tmp` tmpfs 16 MiB, `/mnt|/home|/sys` không tồn tại.
- Giới hạn: cgroup v2 `memory.max`, `memory.swap.max=0`, `pids.max`, `cpu.max`; `ulimit -t 5`,
  `ulimit -f 4096`, `ulimit -n 64`; watchdog wall-time; dọn cgroup + tiến trình sau mỗi lần chạy.
- Exit code: `0` xong, `124` timeout, `137` bị kill/OOM, `78` thiếu hạ tầng, `64` tham số sai.
- Metrics JSON: `{exitCode, memoryPeakBytes, cpuUsageUsec, oomKills, timedOut}`.

Chạy kiểm chứng:

```powershell
wsl.exe -d ootv2-sandbox -u root -- /bin/bash /mnt/d/OOTv2-Game/sandbox/linux/preflight.sh
wsl.exe -d ootv2-sandbox -u root -- /bin/bash /mnt/d/OOTv2-Game/sandbox/linux/selftest.sh
```

## Adapter Node

`server/judge/linuxSandboxSession.js` — `createLinuxSandboxSession({filePath, allowedRoot, runnerPath,
launch?, memoryBytes, pids, cpuMax, timeoutMs, responseTotalMs, cpuTotalMs?, cgroupRoot?, cgroupId?,
measureResources?, seccompMode?, spawnProcess?, killProcess?, runnerEnv?})`.

- Profile `linux-sandbox.v2`. Mặc định chỉ chạy khi `process.platform === 'linux'`; Windows phải
  truyền `launch` tường minh (bridge WSL), không dùng `shell`.
- Kiểm artifact qua `resolveBotPath` (chỉ `.py`, không symlink, trong `allowedRoot`), dựng argv runner
  với `--cpu-seconds`, `--cgroup-root`, `--cgroup-id`, `--seccomp-mode`; `runnerEnv` mặc định
  `{PATH:'/usr/bin:/bin'}` (không mang secret).
- Dùng lại `parseBotJson`/`validateBotResponse` của `bot.v1`; giới hạn request/response/stdout/stderr;
  timeout theo request + tổng; runner `78` → `sandbox_unavailable`, `124` → `BOT_TIMEOUT`,
  `137` → `BOT_MEMORY_LIMIT`.
- **Đo CPU thật**: đọc `cpu.stat` trong cgroup của ván mỗi 50 ms; vượt `cpuTotalMs` → `BOT_CPU_LIMIT`
  và kill session. `metrics()` trả `cpuMeasured`, `cpuUsec`, `memoryMeasured`, `memoryPeakBytes`,
  `oomKills`, `seccomp`, `cgroup`.
- Vẫn `productionReady:false`: chưa attestation, seccomp là deny-list, WSL chia sẻ kernel.

Ví dụ bridge dev (chạy Node trong distro WSL):

```js
const session = await createLinuxSandboxSession({
  filePath: '/mnt/d/OOTv2-Game/sandbox/fixtures/protocol_bot.py',
  allowedRoot: '/mnt/d/OOTv2-Game/sandbox/fixtures',
  runnerPath: '/mnt/d/OOTv2-Game/sandbox/linux/run-bot.sh',
  launch: (runner, args) => ({ command: '/bin/bash', args: [runner, ...args] }),
  cgroupId: 'e2e-session-01', cpuTotalMs: 10000,
});
```

Bằng chứng 24/10/2026: `sandbox-session-e2e.mjs` trong distro (Node 18.19.1) trả
`{"ok":true,"profile":"linux-sandbox.v2","placements":9,"move":{"pieceId":"p1","to":"a1"}}`;
metrics `cpuMeasured=true`, `memoryPeakBytes≈5 MiB`, `seccomp=deny-list.v1`, cgroup dọn sạch.
Unit test `tests/linuxSandboxSession.test.js` **9/9** (fake child): argv/limit/env, round-trip,
envelope sai, budget, timeout/78/137/spawn fail, CPU budget, close.



Preflight: `kernel=6.18.54.1-microsoft-standard-WSL2`, `python=3.12.3`, `bwrap=0.9.0`,
`cgroup_controllers=cpuset cpu io memory hugetlb pids rdma`, `seccomp_bindings=ok`,
`bwrap_seccomp=1`, profile `blocked=67`, `preflight=ok`.

Selftest **14/14 PASS**:

| Kiểm tra | Kết quả |
|---|---|
| JSONL round-trip (stdin/stdout) | pass |
| Metrics cgroup ghi được | pass (`seccomp=deny-list.v1`) |
| Seccomp probe | pass — `Seccomp:2`; ptrace/mount/unshare/keyctl/bpf/io_uring_setup đều `EPERM` |
| `--seccomp-mode off` | pass — ghi `off`, `Seccomp:0` (chỉ dùng dev) |
| FS/network/env isolation | pass — không thấy `/mnt`, `/home`; không đọc `/etc/shadow`, `/root`; `/usr` read-only; `/tmp` ghi được; không nối mạng; env không có `SUPABASE_*` |
| Fork bomb | bị chặn, exit 124 |
| Memory limit 64 MiB | exit 137 (OOM) |
| CPU + wall timeout | exit 124 sau ~2 s |
| CPU accounting | ~261 ms, dưới hạn |
| Stdout flood | cắt ở 65 536 B, exit 1, 109 ms |
| Wall timeout khi sleep | exit 124 sau ~1,35 s |
| Cgroup cleanup | pass, không còn thư mục |
| Process cleanup | pass, không còn `/work/bot.py` |

Log: `data/khoa-next/preflight2.txt`, `selftest3.txt`, `e2e2.txt`, `attest-run2.txt` (gitignored).
`attest.sh` trên WSL trả `result=dev-only` (đúng: WSL bị factory từ chối), probe/hash pass.

## Giới hạn / chưa đạt gate production

- **Chưa nối worker/API**: `server/judge/campusSandboxFactory.js` đã sẵn để chọn adapter, nhưng
  worker campus/API chưa tồn tại; mặc định vẫn `trusted-dev`.
- Seccomp hiện là **deny-list**, chưa phải allowlist; chưa attestation trên VM thật; adapter
  chưa đo RAM theo từng request (chỉ peak cả ván + OOM kill).
- WSL2 chia sẻ kernel/tài nguyên với Windows host; không tương đương **VM sạch** cho code lạ.
  Factory từ chối receipt WSL. Không dùng cho sinh viên tới khi có VM Linux riêng + review.
- Chưa thử escape nâng cao (kernel bug, side-channel, binfmt interop).
- Distro nằm trong `data/` (gitignored), không tự xóa; muốn reset thì `wsl --unregister ootv2-sandbox`
  rồi import lại.

Kế hoạch production + ngân sách phần cứng: [SANDBOX-PRODUCTION.md](SANDBOX-PRODUCTION.md).
