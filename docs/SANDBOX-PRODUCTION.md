# Sandbox production plan (K4)

Trạng thái 24/10/2026: **dev acceptance trên WSL đã đạt 14/14 + seccomp**; production
vẫn **chưa mở**. Tài liệu này chốt công cụ, ngân sách phần cứng, cách attest và các
bước còn lại trên VM Linux thật. Không thay đổi gate Start/consumer hay DB (H4).

## 1. Chọn công cụ: bubblewrap + cgroup v2 + libseccomp

| Công cụ | Ưu | Nhược | Kết luận |
|---|---|---|---|
| **bubblewrap (bwrap)** | Nhẹ nhất (~1 binary C, không setuid), phổ biến (Flatpak), namespaces + `--seccomp`, đã có sẵn | Không tự quản cgroup/thời gian → phải ghép supervisor | **Chọn** |
| **nsjail** | Sinh cho chạy code không tin cậy: namespaces + cgroup + rlimit + seccomp Kafel trong 1 config | Phải build từ source; thêm protobuf/Kafel | Phương án 2 khi cần allowlist |
| **isolate** | Chuẩn IOI/CMS, namespaces + cgroups + seccomp, package Debian/Ubuntu | Mô hình thư mục/user riêng, tích hợp nặng hơn | Phương án cho judge thuần IOI |
| **firejail** | Nhiều profile desktop | Setuid, bề mặt tấn công lớn, ít phù hợp server | Không chọn |
| **gVisor / Firecracker** | Cách ly mạnh nhất (user-space kernel / microVM) | Vận hành nặng, cần VM/host riêng | Bước tiếp nếu nhận code công khai |

Tham chiếu: [bubblewrap](https://github.com/containers/bubblewrap) (9.2k sao, dùng bởi
Flatpak), [nsjail](https://github.com/google/nsjail) (Kafel seccomp), [isolate](https://github.com/ioi/isolate)
(CMS/IOI), [Docker seccomp default](https://docs.docker.com/engine/security/seccomp/).

**Vì sao không chỉ dựa vào WSL:** WSL2 chia sẻ kernel với Windows và có interop; chỉ
dùng để dev. Factory production từ chối attestation có `host.wsl=true`.

## 2. Các lớp đang bật

| Lớp | Cơ chế | Bằng chứng |
|---|---|---|
| Namespace | `bwrap --unshare-all` (user/mount/net/pid/uts/ipc/cgroup) | probe FS/network, selftest |
| Filesystem | `/usr` read-only, `/tmp` tmpfs 16 MiB, chỉ bind `bot.py` + `ld.so.cache` | probe `/mnt`,`/home`,`/repo` |
| Quyền | `--cap-drop ALL`, uid không đặc quyền, `--clearenv` | probe env, `capsh` |
| Syscall | seccomp deny-list 67 syscall (escape/mount/io_uring/keyring/perf/ptrace/...) → `EPERM` | `seccomp=2`, probe 6 syscall |
| RAM | cgroup v2 `memory.max`, `memory.swap.max=0` | memhog exit 137 |
| Process | `pids.max`, `ulimit -u`/`-f`/`-n` | forkbomb exit 124 |
| CPU | `cpu.max`, `RLIMIT_CPU`, watchdog wall | cpuhog exit 124 |
| Time | watchdog theo `--timeout-ms` | sleep 1.35 s |
| Cleanup | kill cgroup.procs, rmdir cgroup, xoá watchdog | 0 entry còn lại |
| Adapter | CPU cgroup theo dõi mỗi 50 ms, map 137 → `BOT_MEMORY_LIMIT`, 124 → `BOT_TIMEOUT` | unit test + E2E |

**Giới hạn đã biết:** deny-list không chặn syscall mới lạ; kernel bug có thể thoát;
chưa chống side-channel; `execve` phải cho phép để bwrap exec Python (bot có thể
spawn subprocess trong cùng namespace, đã bị pids/cgroup/net chặn). Vì vậy production
cần thêm allowlist (nsjail) hoặc microVM trước khi nhận code công khai.


## 3. Ngân sách phần cứng đề xuất

### 3.1 Giới hạn mỗi bot (đề xuất chốt cho v2)

| Tham số | Giá trị | Lý do |
|---|---|---|
| RAM | **128 MiB** (`--memory-bytes 134217728`) | Python 3.12 ~15–25 MiB; 128 MiB đủ search nhỏ, tránh OOM oan |
| CPU tổng / ván / bot | **20 s** (`cpuTotalMs=20000`) | 400 plies, trung bình 50 ms/ply |
| Wall mỗi setup | **5 s** | 9 quân, tính toán nặng hơn |
| Wall mỗi move | **1 s** | cùng giới hạn observer hiện tại |
| `cpu.max` | `100000 100000` (1 core) | 1 bot tính tại một thời điểm |
| `pids.max` | **16** | Python + tối đa vài thread |
| `/tmp` | 16 MiB | không cần ghi đĩa |
| File artifact | ≤ 256 KiB | giữ giới hạn hiện tại |

Dev có thể dùng 64 MiB để thử OOM; production nên 128 MiB.

### 3.2 Máy chấm

Một ván = 2 bot **tuần tự** (chỉ bên đến lượt chạy), nên tải CPU ~1 core/ván.

| Quy mô | VM đề xuất | Ghi chú |
|---|---|---|
| ≤ 50 ván/ngày | 2 vCPU / 2 GiB / 40 GiB SSD | 1 worker, chạy tuần tự |
| ~200 ván/ngày, cao điểm 4 ván đồng thời | **4 vCPU / 8 GiB / 80 GiB** | 3–4 worker, mỗi worker 1 ván; chừa 1 core cho OS |
| 20 ván đồng thời | 8 vCPU / 16 GiB | 6–7 worker + đệm |

- Ubuntu 24.04 LTS, không chạy service khác trên VM chấm.
- Egress tới Supabase/GitHub; **không** inbound công khai (SSH qua VPN/bastion).
- Mỗi worker là process riêng, nhận 1 ván/lúc; không dùng chung cgroup giữa các ván.
- 40 GiB đủ cho artifact 256 KiB + replay + log; log/stdout đã cắt 4 MiB/bot.

## 4. Attestation và bật sandbox

```bash
# VM Linux thật, root
apt-get install -y bubblewrap python3-seccomp
bash sandbox/linux/preflight.sh
bash sandbox/linux/attest.sh /run/ootv2-sandbox-attestation.json --full
```

`attest.sh` chạy preflight, sinh BPF, chạy probe seccomp và (tuỳ chọn) toàn bộ
selftest; ghi JSON 24 h gồm kernel, phiên bản, hash profile, kết quả probe.
Trên WSL kết quả là `dev-only` và **bị factory từ chối**.

Bật trong worker/CLI:

```js
import { createCampusSessionFactory } from './server/judge/campusSandboxFactory.js';
const startSession = createCampusSessionFactory(); // đọc env, fail-closed
await runCampusMatch({ id, map, seed, red, blue, startSession });
```

```bash
OOTV2_CAMPUS_SANDBOX=linux-sandbox \
OOTV2_SANDBOX_RUNNER=/srv/ootv2/sandbox/linux/run-bot.sh \
OOTV2_SANDBOX_ATTESTATION=/run/ootv2-sandbox-attestation.json \
OOTV2_SANDBOX_CGROUP_ROOT=/sys/fs/cgroup/ootv2-sandbox \
node server/worker.js
```

Factory từ chối khi: không phải Linux, `OOTV2_SANDBOX_SECCOMP=off`, thiếu runner
tuyệt đối, thiếu/hết hạn attestation, attestation WSL, seccomp probe sai hoặc hash sai.
Mặc định vẫn là `trusted-dev` và cần `trusted:true`.

systemd (VM riêng, runner cần root cho cgroup):

```ini
[Unit]
Description=OOTv2 judge worker (sandbox)
After=network-online.target
[Service]
Type=simple
User=root
WorkingDirectory=/srv/ootv2
Environment=OOTV2_CAMPUS_SANDBOX=linux-sandbox
Environment=OOTV2_SANDBOX_RUNNER=/srv/ootv2/sandbox/linux/run-bot.sh
Environment=OOTV2_SANDBOX_ATTESTATION=/run/ootv2-sandbox-attestation.json
ExecStartPre=/bin/bash /srv/ootv2/sandbox/linux/attest.sh /run/ootv2-sandbox-attestation.json
ExecStart=/usr/bin/node /srv/ootv2/server/worker.js
Restart=on-failure
[Install]
WantedBy=multi-user.target
```

Refresh attestation mỗi 12 h bằng timer; hết hạn 24 h thì factory dừng nhận ván mới.

## 5. Checklist trước khi mở nhận code công khai

- [ ] VM Linux sạch (không WSL), kernel LTS, chỉ service chấm.
- [ ] `attest.sh --full` pass, receipt còn hạn, hash profile khớp.
- [ ] seccomp **allowlist** hoặc nsjail/gVisor/Firecracker cho code không tin cậy.
- [ ] Rate limit + kích thước upload + quét file (chỉ `.py`, 256 KiB) ở API.
- [ ] Không secret trong env/FS của bot; log không chứa stderr thô.
- [ ] Thử escape: ptrace/mount/unshare/io_uring/keyring/network/fork/mem/CPU.
- [ ] Replay + kết quả lưu cùng attestation hash và phiên bản rules.
- [ ] H4/DB fencing hoàn tất trước khi Start; consumer vẫn khóa.

## 6. Bằng chứng dev 24/10/2026

- `sandbox/linux/selftest.sh`: **14/14 pass**, gồm seccomp deny-list và mode off.
- `attest.sh` trên WSL: `result=dev-only`, `seccomp.probe=true`, hash profile in ra.
- Adapter E2E trong WSL: setup 9 quân + move, `cpuMeasured=true`, `memoryPeakBytes≈5 MiB`,
  `seccomp=deny-list.v1`, cgroup dọn sạch.
- Node tests: adapter 9/9 + factory 4/4 (xem handoff để có tổng suite).

