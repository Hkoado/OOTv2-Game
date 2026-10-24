# Khoa — hoàn thiện runtime manual và bộ cài, 24/10/2026

## Quyết định người dùng trong phiên này

- Huy đã pull phần E2E; hiện Huy đang migrate DB và chỉnh luật hoà. Khoa chỉ nghiệm thu
  provisioning/runtime, không sửa/migrate thay phần đó.
- Khoa tự hoàn thiện runtime/provisioning, không chờ Huy/Bảo viết heartbeat manual.
- Bot lỗi ngay setup: lưu accepted win/loss và replay 0-ply do engine xác định.
  Lỗi hạ tầng vẫn không được forfeit.
- Dùng Hyper-V trên máy Windows này. Phiên hiện tại elevated; `doctor` đạt, nhưng VM
  chưa được tạo. Provisioning dừng do download Ubuntu image bị reset; `.part` không hợp lệ.
- Người dùng chốt **project trong `.env`**, chỉ kiểm readiness; không copy schema từ G5,
  không tự apply migration hay claim job remote.

## Schema/code deployment order

Migration mới `20261026130000_manual_worker_heartbeat.sql` (đổi tên từ `20261026120000_…` vì trùng version
với `ko_round_roster_guard`; file chưa từng apply remote nên đổi tên an toàn). **Huy đã apply trên DB thật
`ftzockzolisecnyhlwej` ngày 24/10** (prosrc `claim`/`finish`/`release` đã vá, RPC heartbeat chỉ service_role).

**Phản hồi "Chốt schema":** `docs/HUY-KHOA-CHOT-SCHEMA-WORKER.md` (catalog/grants/ledger, contract RPC đọc từ
`pg_proc`, thứ tự guard cho probe health, drill `worker-schema-drill` 17/17). Huy xác nhận **schema ready =
YES** trên `ftzockzolisecnyhlwej` (21 migration + ledger `public.ootv2_schema_migrations`), kèm hai migration
additive mới:
- `20261026150000_official_lease_fencing.sql` — official heartbeat/finish/fail **từ chối lease đã hết hạn**
  (trước đó bản `26090000` vẫn cho ghi kết quả sau khi lease hết nếu chưa bị reclaim). Cùng luật với manual.
- `20261026160000_official_write_hardening.sql` — `service_role` **không còn DELETE** trên
  `mvp_official_rounds/games/broadcasts` (REST DELETE: 204 → 403 `42501`); INSERT/UPDATE cần cho publication
  vẫn giữ. Drill dọn dữ liệu bằng owner/Management API, không bằng service key.
- `worker-health.js`: probe `mvp_github_claim` với `p_worker:''` thực tế trả `400/P0001 bad_worker`
  (guard worker chạy trước guard lease); official/manual claim trả JSONB HTTP 200 và official claim
  **clamp** `p_lease_seconds` 30..3600 nên không có `bad_lease`.
Apply theo migration history, trước consumer mới. Không sửa migration manual gốc.
RPC heartbeat `mvp_manual_final_heartbeat(uuid,uuid,integer,integer)` chỉ service_role,
kiểm running/token/generation/expiry; false `lease_lost` không hồi sinh lease hết hạn.
Finish/release từ chối lease hết hạn; claim kết thúc infra_fault khi hết attempts.
Finish duplicate terminal vẫn idempotent; không tạo accepted result thứ hai.
SQL replacement có prerequisite guards để không âm thầm áp lên definition khác.
**Static contract tests không thay PostgreSQL rehearsal.**

`Schema ready = YES` chỉ mở gate kiểm thử tích hợp worker; nó **không** nói VM/sandbox/worker/RC đã nghiệm thu.

## Readiness theo service và bộ cài (sửa 24/10/2026)

`tools/cli/worker-health.js` được tách lại theo đúng lỗi đã phát hiện:
- `--scope=github|judge|all` (mặc định `all`). Máy chỉ nạp bài GitHub không bị chặn bởi bảng official, và
  guest chấm không cần bảng intake.
- Probe GitHub nhận đúng guard thật `400/P0001 bad_worker` (vẫn nhận `bad_lease` cho deployment cũ) và
  **không** coi mọi lỗi khác là PASS. Trước đây chỉ nhận `bad_lease` nên DB đúng vẫn bị chặn start.
- Probe official/manual dùng JSONB `ok:false` + `bad_worker`; JSONB `ok:true` bị coi là FAIL vì nghĩa là
  health-check đã lease job thật.
- Trên guest Linux, scope `judge` còn kiểm `sandbox_attestation` (profile/result/seccomp/hạn) **ngay lúc gọi**,
  nên VM hết hạn chứng nhận sẽ không nhận việc mới.
- Logic phân loại nằm ở `tools/cli/workerHealthProbes.js` để test hành vi thật
  (`tests/workerReadinessProbes.test.js`), không chỉ regex.

`workerctl.sh`: `health` truyền `--scope=$queue`; `start`/`restart` của `judge` **bắt buộc** chạy
attestation (timer + oneshot) và từ chối khởi động khi attestation lỗi; thêm action `attest`.
`ootv2-official-worker.service` thêm `Wants=ootv2-attest.service` để boot kéo attestation trước judge.

`install-judge.sh`/`deploy-release.sh`:
- Chụp danh sách service đang active **trước** khi stop và truyền qua `OOTV2_PREVIOUS_ACTIVE`; trước đây
  deploy đọc trạng thái sau khi installer đã stop nên update luôn để worker cũ ở trạng thái tắt.
- Env mới ghi ra file tạm rồi mới swap; nếu deploy-release thất bại (rollback code) thì env cũ được phục hồi.
- Rollback chạy lại attestation; nếu attestation sau rollback lỗi thì dừng service thay vì chạy mù.
- Cài mới vẫn không enable/start worker; health của install dùng `--scope=all`.

`Install-Judge.ps1`: kiểm `known_hosts` có entry đúng địa chỉ (`ssh-keygen -F`) trước khi gửi archive
credential, kiểm release đủ file ngay trên Windows, thêm `ConnectTimeout`/`ServerAlive*` cho SSH/SCP.

`New-JudgeVM.ps1`: kiểm key không passphrase bằng header bcrypt (không dùng `ssh-keygen -y -P` vì
`-y` không nhận `-P`) + `Invoke-Capture` đóng stdin và có timeout nên không bao giờ treo prompt; derive
`.pub` từ private key và kiểm khớp thay vì tạo lại danh tính; chuyển path bằng `wslpath` rồi `test -e`
trong distribution thay vì giả định `/mnt/<drive>`; `exit 0/1` tường minh.

`prepare-image.sh`: mỗi lần thử đọc lại `SHA256SUMS` (build `noble/current` thay đổi), partial đặt tên
theo checksum nên không ghép nhầm build, resume bằng `-C -`, mismatch thì bỏ partial, tối đa 3 lượt rồi
`image_download_incomplete`; conversion ghi `judge.vhdx.stage`/`seed.vhdx.stage` rồi mới nhận tên cuối.


## Worker/control

- Official đã có heartbeat. Manual nay heartbeat trước execute và định kỳ lease/3,
  không chạy renewal chồng nhau; mất lease/lỗi renewal abort; finally dọn timer/listener.
- Executor kiểm abort trước finish và không ghi kết quả sau shutdown.
- `ootv2-github-worker.service`: intake/static validation, user không đặc quyền.
- `ootv2-official-worker.service`: `officialWorker.js --all`, sandbox Linux bắt buộc,
  attestation bắt buộc; không bật trusted-dev. **Root chỉ trong guest chấm riêng** vì
  launcher hiện yêu cầu root cho namespaces/cgroup. Đây không phải permission profile intake.
- Installer cài hai service nhưng không tự start/enable. Attestation dùng `/srv/ootv2/current`.
- Deploy theo dõi cả hai service, kiểm health, rollback symlink và restart service đã active.
  Rehearsal failure/rollback/reboot thực tế vẫn bắt buộc trước ký gate.

Sau khi mở VS Code/PowerShell Administrator, chạy từ repo:

```powershell
Copy-Item 'd:\OOTv2-Game\tools\vm\worker.config.example.json' 'd:\OOTv2-Game\tools\vm\worker.local.json'
& 'd:\OOTv2-Game\tools\vm\Worker.ps1' -Action doctor
# Chỉ khi doctor đạt và được phép dựng VM:
& 'd:\OOTv2-Game\tools\vm\Worker.ps1' -Action install
# Đối chiếu fingerprint từ console, ghi known_hosts rồi mới install lại.
& 'd:\OOTv2-Game\tools\vm\Worker.ps1' -Action install
& 'd:\OOTv2-Game\tools\vm\Worker.ps1' -Service judge -Action start
& 'd:\OOTv2-Game\tools\vm\Worker.ps1' -Service judge -Action status
& 'd:\OOTv2-Game\tools\vm\Worker.ps1' -Service judge -Action logs
& 'd:\OOTv2-Game\tools\vm\Worker.ps1' -Service judge -Action stop
```

Không overwrite config có sẵn. Không gửi private key/token vào chat. Không bỏ SSH verification.
Phải chốt project DB đích trước khi chuyển env (handoff cũ ghi .env và .envdev khác project).

Readiness `.env` (chỉ đọc, không claim): credential cấu hình được và bucket `ootv2-bots` private/262144
bytes đạt. Sau khi Huy bootstrap DB đích, history/catalog đã được đối chiếu trong
`docs/HUY-KHOA-CHOT-SCHEMA-WORKER.md`; probe GitHub trả `400/P0001 bad_worker` là **guard đúng**, không
phải thiếu schema — và đây chính là chỗ `worker-health.js` trước đó kỳ vọng sai `bad_lease`.
Đối chiếu schema là việc của Huy/operator; Khoa chỉ đọc và chạy `worker-schema-drill` khi được phép.
Không apply migration hay claim job.

## Tiến độ provisioning 24/10/2026

- `doctor`: **PASS** (elevated, Hyper-V module/switch, Ubuntu WSL, 116 GiB trống, env allowlist) và có thêm
  hai check mới: `wsl-image-tools` (qemu-img/cloud-localds/curl) và `wsl-vm-directory` (/mnt/d/OOTv2-VM).
- **Image đã tải và xác minh**: `noble-server-cloudimg-amd64.img` **592.5 MB**, SHA-256 khớp `SHA256SUMS`
  (`image=downloaded`), chạy lại cho `image=reused` (không tải lại, không ghi đè).
- **Disk đã tạo**: `judge.vhdx` (40 GiB virtual qua `Resize-VHD`), `seed.vhdx` (16 MB), `user-data`/`meta-data`
  (cloud-init: user `ootv2`, sudo NOPASSWD, ssh_pwauth off, growpart, openssh/bubblewrap/python3-seccomp/
  qemu-guest-agent). Script idempotent: `image=disks_already_prepared`, và fail-closed
  `incomplete_disk_set_present` nếu chỉ có một disk.
- **VM `OOTv2-Judge` đã tạo**: Gen2, SecureBoot MicrosoftUEFICertificateAuthority, 4 vCPU, Default Switch, 2 disk
  (SCSI0:0 `judge.vhdx` 40 GiB, SCSI0:1 `seed.vhdx`).
- **Memory (người dùng chốt):** `Start-VM` với 4 GiB tĩnh lỗi `0x800705AA` (host 16 GiB, chỉ còn ~3.9 GiB trống).
  Người dùng chọn **dynamic memory**: min 2 GiB, startup 4 GiB, max 4 GiB, buffer 20 → VM `Running`,
  được cấp đủ 4096 MB. Script đã cập nhật để tái tạo đúng cấu hình này.
- **Guest đã boot và có mạng**: DHCP của Default Switch cấp `192.168.230.176` (MAC `00-15-5D-0A-02-01`),
  TCP/22 mở, banner `SSH-2.0-OpenSSH_9.6p1 Ubuntu-3ubuntu13.20` ⇒ cloud-init đã chạy (openssh được cài).
- **KVP:** image gốc không có `hv_kvp_daemon` nên `Get-VMNetworkAdapter.IPAddresses` rỗng. Đã thêm
  `linux-cloud-tools-virtual` + `systemctl enable hv-kvp-daemon` vào cloud-init và **rebuild riêng seed**
  (`--seed-only`, `SEED_REBUILT`, exit 0) với instance-id mới để cloud-init chạy lại.
  `Worker.ps1` cũng có fallback tra IP qua bảng neighbor theo MAC (không phụ thuộc KVP).
- **Còn thiếu để cài worker:** `known_hosts` rỗng. Guest không cho login console (`lock_passwd: True`) nên
  không thể đăng nhập để đọc host key; `wsl --mount --vhd` và COM-port named-pipe đều **không dùng được**
  (treo / lỗi API) nên đã bỏ, COM port cũng đã gỡ. Cách đang dùng: cloud-init ghi fingerprint **public**
  host key vào `/etc/issue.d/10-hostkey.issue` + `/etc/issue` nên **banner login hiện thường trực** dòng
  `HOSTKEY SHA256:...` (đã xác nhận bằng ảnh chụp console của người dùng) để người vận hành đối chiếu.
- **Host key đã pin** (`D:\OOTv2-VM\known_hosts`), sau khi sửa một lỗi thật:
  cloud-init mặc định `ssh_deletekeys: true` nên **mỗi lần seed rebuild (instance-id mới) nó xoá và sinh lại
  host key**, làm giá trị đã đối chiếu console thành sai (`REMOTE HOST IDENTIFICATION HAS CHANGED!`).
  Đã thêm `ssh_deletekeys: False`; rebuild lại và xác nhận key **ổn định** qua hai lần chạy.
  - fingerprint pin: `SHA256:+99WuGiLSxDv/vITqtu7Hxow47en91OyPluPS5HC4Q0`
  - public key: `AAAAC3NzaC1lZDI1NTE5AAAAIBZOGO+d5lCgAD1WwL7QZnqxTdw02HmpvRP/9CY8NSG0`
  - kiểm chứng end-to-end (`data/khoa-current/known-hosts-pin.log`): `ssh -o StrictHostKeyChecking=yes
    -o UserKnownHostsFile=known_hosts -i judge_ed25519` → **exit 0**; guest trả `Linux 6.8.0-147-generic`,
    `nproc=4`, `Mem 3914 MB`, `/dev/sda1 38G 2.0G dùng 36G trống`, `SUDO_OK`, và `ssh-keygen -lf` **bên trong
    guest** cho đúng fingerprint đã pin.
- `Worker.ps1 -Action status` đi hết chuỗi VM → IP (KVP) → strict host verification → key judge → chạy lệnh
  trên guest. Mặc định `-Service` đã đổi sang **judge** (trước đó mặc định `github` nên `status` báo
  `worker=inactive` dù judge worker đang chạy).
- **Worker đã cài và đang chạy** (người dùng cho phép chuyển `.env` + cài release):
  release `20261024T162131Z-fc5c364044fc`; `status` → `worker=active`, `enabled=enabled`,
  `attestation_timer=active`; `worker-health --scope=judge` = **OK**; `attestation=pass
  expires=2026-10-25T16:04:18Z`.
- **Đính chính:** fingerprint `SHA256:BjbXTSsCId9+zf/pYbp8fKkcpjwKZAjeh9Vr6b88B6s` đã kiểm lại bằng
  `ssh-keygen -l -f judge_ed25519.pub`: đây là fingerprint của **SSH client key**, **không phải** host key
  của guest.


- **Đính chính:** fingerprint `SHA256:BjbXTSsCId9+zf/pYbp8fKkcpjwKZAjeh9Vr6b88B6s` đã kiểm lại bằng
  `ssh-keygen -l -f judge_ed25519.pub`: đây là fingerprint của **SSH client key**, **không phải** host key
  của guest.

### Lỗi thật phát hiện khi chạy thật (đã sửa)

| Lỗi | Bằng chứng | Sửa |
| --- | --- | --- |
| `wsl.exe` ghi stderr + `$ErrorActionPreference='Stop'` → `NativeCommandError` giết script **im lặng** (log rỗng, không có exit code) | doctor dừng ngay sau check `wsl-image-tools`, log không có dòng `doctor:` | `Invoke-Wsl` hạ preference trong phạm vi lời gọi, gộp stderr, trả exit code |
| `wsl.exe` **bỏ backslash** trong argument: `wslpath -a D:\OOTv2-VM` → `wslpath: D:OOTv2-VM` (exit 1) | `FAIL wsl-path: wslpath failed for D:\OOTv2-VM: wslpath: D:OOTv2-VM`; thử `D:/OOTv2-VM` và `D:\\OOTv2-VM` đều cho `/mnt/d/OOTv2-VM` | truyền path dạng `/`: `$fullPath.Replace('\','/')` |
| `Assert-WslVisible` được gọi với path **Windows** thay vì path Linux | `WSL 'Ubuntu' cannot see D:\OOTv2-VM` | truyền `$linuxDirectory`/`$linuxKey` |
| `qemu-img resize -f vhdx` không tồn tại | `qemu-img: Image format driver does not support resize` | grow bằng `Resize-VHD` của Hyper-V trước khi tạo VM, có verify 40 GiB |
| Grow qua raw trung gian **không dùng được** trên `/mnt/d` | `truncate -s 40G` phải ghi thật 36.5 GB qua DrvFs (9p) — treo nhiều phút | bỏ hướng raw, convert thẳng qcow2→vhdx rồi Resize-VHD |
| 4 GiB RAM tĩnh không cấp được trên host 16 GiB | `Start-VM: ... 0x800705AA Insufficient system resources` | dynamic memory min 2 / startup 4 / max 4 (người dùng chốt) |
| `Get-VMNetworkAdapter.IPAddresses` rỗng dù guest online | ARP mới thấy `192.168.230.176` cho MAC của VM | thêm gói KVP vào image + fallback ARP trong `Resolve-TargetAddress` |
| Rebuild seed khi VM đang chạy | `mv: cannot move 'seed.vhdx.stage' to 'seed.vhdx': Permission denied` | fail-closed đúng ý; quy trình: power off VM rồi `--seed-only` |
| **cloud-init mặc định `ssh_deletekeys: true`** ⇒ mỗi lần seed rebuild lại sinh host key mới, `known_hosts` đã pin thành sai | `WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!` — fingerprint đổi từ `GvbkME2PC…` sang `+99WuGiL…` dù không ai chạm guest | thêm `'ssh_deletekeys': False` + test hồi quy; xác nhận key ổn định qua 2 lần chạy |
| Serial console (COM port named pipe) không dùng được để đọc fingerprint tự động | reader PowerShell lỗi `cannot call a method on an invalid/null expression`; không có dữ liệu, đã gỡ COM port | giữ cách đối chiếu console (banner `/etc/issue.d`) |
| **`import.meta.url === pathToFileURL(argv[1]).href` sai khi release qua symlink** ⇒ service systemd (gọi đường dẫn tuyệt đối `/srv/ootv2/current/...`) "Started → Deactivated successfully" trong 1 giây, **không log, không làm gì**, `Result=success` | journal chỉ có 3 dòng systemd; chạy tay bằng đường dẫn tuyệt đối cho 0 byte output trong khi đường dẫn tương đối in banner | thêm `server/shared/entrypoint.js` (`isMainModule` so sánh **sau realpath**), dùng cho `officialWorker.js` + `githubWorker.js`, có test symlink |
| `isMainModule` tự nhận default `metaUrl = import.meta.url` → luôn so URL của chính helper | sau khi thêm helper, cả hai cách gọi đều im lặng, exit 0 | bỏ default, call site truyền `import.meta.url` của chính nó + test hồi quy |
| `workerctl.sh version` chết vì đọc file attestation root-only | `PermissionError ... /run/ootv2-sandbox-attestation.json` | kiểm `[ -r file ]`, in `attestation=unreadable (run with sudo)` |
| `workerctl.sh` one-liner Python hỏng do `\"` trong chuỗi nháy đơn | `SyntaxError: unexpected character after line continuation character` | hàm `print_attestation()` dùng `%`-format với nháy kép |
| `ssh/scp/tar` + `$ErrorActionPreference='Stop'` ⇒ `NativeCommandError` giết install im lặng (không exit code, log rỗng) | wrapper `Worker.ps1 -Action install` biến mất, `install.log` dừng sau dòng export env | `Invoke-Native` (Install-Judge.ps1) và `Invoke-Guest` (Worker.ps1) hạ preference trong phạm vi lời gọi |
| `-Service` mặc định `github` | `Worker.ps1 -Action status` báo `worker=inactive` dù judge worker `active` | default `judge` + test |

Ngoài ra: tiến trình PowerShell tạo bằng `Start-Process` từ terminal bị dừng khi terminal tái sử dụng; các
lần chạy dài được khởi tạo tách rời qua `Win32_Process.Create` + `cmd.exe`, log và exit code ghi ra file
(`data/khoa-current/{doctor-admin,image-prep,create-vm,seed-rebuild}.log|.exit|.cmdexit`,
`prepare-image.log`, `guest-ip-probe.log`, `guest-ssh-probe.log`).

## Gate còn phải nghiệm thu (không coi NOT RUN là PASS)

1. PostgreSQL rehearsal trên môi trường tách biệt: heartbeat live/stale/expired, attempt cap, 0-ply,
   grants, concurrent claim/finish và duplicate finish. Drill 17/17 của Huy là bằng chứng của Huy trên DB
   đích, **không thay** rehearsal của Khoa.
2. Hyper-V install/start/stop/reboot; full sandbox attestation; attestation hết hạn; update hỏng/rollback.
3. Hai process chấm job thật, kill giữa ván, phục hồi sau DB/Storage failure, artifact cleanup.
4. Worker capacity, backup/restore bằng chứng thực; browser role/privacy và E2E tích hợp.

Các bước local capture: `node tools/cli/khoa-local-check.js`, evidence ở
`data/khoa-current/results.json` cùng log từng lệnh, không commit log nhạy cảm.

Ghi chú validation: lượt full mặc định song song có một lần fail gate viewer P95
(overview 904.9 ms vượt 800 ms), không lỗi heartbeat. Không sửa/nới assertion.
Chạy lại full với `--test-concurrency=1` để đo không tranh tài nguyên giữa file test;
không coi kết quả này là benchmark production hoặc xóa dấu vết lượt fail.