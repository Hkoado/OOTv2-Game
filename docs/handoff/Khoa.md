# Kết quả Khoa — Scheduler / worker / runtime

## 25/10/2026 — Gate chính, sau commit a137f63

- Phạm vi assignment 25/10: code/config/health/runbook hoàn thiện; **chưa ký RC tổng thể**
  hoặc mở intake bot lạ. Hoãn edge/operational rehearsal, không bỏ guard runtime.
- VM fixture acceptance thật tại `/srv/ootv2-test/main-gates-a137f63`, root-owned/non-writable;
  private mount namespace + tmpfs `/run`, env rỗng allowlist và cgroup UUID riêng.
  Có chép source test/chạy fixtures trên VM; **không** deploy service, đổi current,
  nạp credential DB, claim queue, push hay apply migration.
- Full attestation PASS và **8/8 gate PASS**: production preflight, expired receipt,
  runner hash mismatch, 2 session song song với RAM/PIDs/swap đúng budget, trận Campus v2
  + replay verify, abort giữa trận + recovery, stdout bounded, cleanup cgroup.
- Drill bắt lỗi thật `cleanup_not_confirmed`: watchdog sleep giữ protocol pipe mở.
  Đã redirect watchdog stdio và trap kill/wait sleep; chạy lại VM PASS. Có regression local.
- Runtime vẫn `campus-runtime.v2`; launcher đổi nên hash mới
  `8887cd2531b20c12e1824adfbf1a924f410c515e79006a5e95cd9893c70337c1`.
  Hash Windows/Linux khớp; không sửa snapshot cũ. Service vẫn active trên release
  `20261024T162131Z-fc5c364044fc`, không phải source vừa nghiệm thu trong thư mục test.
- Full regression **462/462 PASS**, 0 skip (`data/khoa-main-gates/tests-final2.log`).
  Evidence VM: `data/khoa-main-gates/vm-final.log`; lần lỗi giữ tại `debug.log`.
- Build PASS (4.82s, còn cảnh báo chunk >500 kB); manual-worker drill **9/9 PASS**
  với DB/Storage/Python mô phỏng, không phải PostgreSQL acceptance. Bash syntax,
  Node syntax và `git diff --check` PASS. Evidence tại `data/khoa-main-gates/`.
- **NOT RUN/hoãn:** 2 consumer DB thật/lease reclaim/stale finish/duplicate finish trên release này,
  DB/Storage outage thật, reboot, failed update/rollback, disposable restore, production smoke
  và chữ ký Huy/Bảo. Hai sandbox session KHÔNG phải hai worker tranh queue PostgreSQL.
- Deny-list/root supervisor còn giới hạn threat model. Sandbox fixture PASS không đồng nghĩa
  public untrusted readiness; không ký thay owner khác hoặc coi hoãn là PASS.

Chạy lại fixture (chỉ trên thư mục test Linux riêng, root-owned):
`sudo bash tools/provision/test-main-gates.sh --fixtures-only`.
Không chạy trên API host hoặc trong maintenance window không cho phép tải fixture.

## 25/10/2026 — RC online tối giản: hardening local + runbook

Base checkout: `be8d17fd0bc5def03d75f4c589117b4eabde382c` (`dev`); working tree ban đầu sạch.
Không push/deploy/apply migration, không đổi VM/service. VM kiểm tra chỉ đọc qua SSH với
`StrictHostKeyChecking=yes` và `D:/OOTv2-VM/known_hosts`:
`OOTv2-Judge` Running, `ootv2-official-worker` active, release cũ
`20261024T162131Z-fc5c364044fc`, attestation full cũ `RESULT pass=14 fail=0`.
Đây không phải evidence cho source mới và không chứng minh 2-worker/recovery.

### Thay đổi trong working tree

- Production guard mới `server/lib/productionSafety.js`: không tự nạp `.env` trong production;
  fail-fast cho trusted-dev, WSL override, localhost origin, upload compatibility và seccomp off.
- `campusSandboxFactory.js`: production yêu cầu Linux sandbox, receipt full selftest trong hạn tối đa
  24h, đọc/kiểm receipt mỗi lần mở session; kiểm owner/mode/hash runner + seccomp generator + BPF.
  Bump version receipt giữ nguyên v1 schema nhưng bổ sung `artifacts`; installer phải tạo receipt mới.
- `attest.sh` ghi hash runner/generator, ghi receipt atomic; `run-bot.sh` fail-closed khi không tắt swap
  và ưu tiên `cgroup.kill` để cleanup tiến trình con. RAM/PIDs từ budget đã pin được truyền tới session.
- Cấm gọi legacy runner/worker và trusted session trong production. Official runtime đổi
  `campus-runtime.v2`, hash thêm safety guard, launcher và seccomp generator; snapshot v1 không tự nâng.
- `/api/health` thành liveness nhẹ; `/api/ready` session+admin, chỉ báo DB, ghi rõ worker chưa được kiểm.
  Header no-store/security, CORS/proxy hiện có giữ nguyên. `worker-health --scope=judge` fail-closed
  nếu sandbox không sẵn sàng; `workerctl health` đặt env Linux production.
- Nâng Multer 2.4.0 → 2.5.0; khai báo Node `>=22.12.0`. Cập nhật env example, runbook vận hành,
  thứ tự deploy/rollback/backup/restore và checklist `docs/WORKER-UNTRUSTED-READINESS.md`.

### Kiểm thử / bằng chứng

- Baseline build: PASS. Targeted hardening: **18/18 PASS**.
- Full test ban đầu bắt đúng 2 assertion đang hard-code runtime v1; cập nhật test đọc version export
  thay vì thay đổi behavior. Full suite sau đó: **460/460 PASS**, 0 skip.
- `npm run build`: PASS (`data/khoa-hardening/final2-build.status`).
- `npm install --ignore-scripts`: PASS; `npm audit --json` trước: 1 high (Multer), sau: **0**.
- `git diff --check`: PASS. Bash syntax PASS (`data/khoa-hardening/bash-final2.status`).
- Test là local Windows/mock; **không phải** sandbox acceptance VM. VM release chưa cập nhật.
- Benchmark simulation nhạy tải host: lượt full `final2` FAIL 200 viewers ở 188.5 RPS (<200),
  lượt isolated cũng fail 100/200 do host throughput; suite `final3` đạt 460/460.
  Đây không phải benchmark hạ tầng deploy; counts/worker capacity production vẫn NOT RUN.

### Chưa chạy / blocker mở chấm bot lạ

- Full fixture acceptance trên release mới, quyền/mode/hash thật sau provisioning.
- Hai worker tranh job, expired lease, duplicate finish, kill giữa ván, mất DB/Storage, reboot.
- Update hỏng/rollback trên VM; backup DB+Storage/artifact và restore disposable.
- Browser/production smoke sau deploy; Huy/Bảo ký và tích hợp RC.
- `trusted-dev` vẫn có thể dùng ở development với bot tin cậy; không dùng bot người lạ.
- Deny-list seccomp và root supervisor có giới hạn threat model; chưa đủ căn cứ tuyên bố an toàn public.

**Kết luận:** chặn bot lạ vẫn giữ nguyên. Chỉ mở sau khi cài đúng RC lên VM, tạo attestation mới,
chạy mọi gate runtime/recovery ở `docs/WORKER-UNTRUSTED-READINESS.md` và ghi evidence PASS.

## 24/10/2026 (lượt 2) — dựng VM thật trên Hyper-V, chặn ở host key console

Đã làm trong lượt này (chỉ trong phạm vi đã được duyệt: image/key/VM; **chưa** chuyển `.env`,
chưa cài/chạy worker trên guest):

1. `Worker.ps1 -Action doctor` → **PASS** (log `data/khoa-current/doctor-admin.log`), gồm check mới
   `wsl-image-tools` và `wsl-vm-directory: /mnt/d/OOTv2-VM`.
2. Image Ubuntu Noble tải + **verify SHA-256** (`image=downloaded`, 592.5 MB), chạy lại `image=reused`.
3. `judge.vhdx` 40 GiB (Resize-VHD), `seed.vhdx` (cloud-init), VM `OOTv2-Judge` Gen2/4 vCPU/Default Switch.
4. `Start-VM` 4 GiB tĩnh lỗi `0x800705AA`; theo lựa chọn của người dùng đã chuyển sang **dynamic memory**
   (min 2 / startup 4 / max 4 GiB) → **VM Running, cấp đủ 4096 MB**.
5. Guest boot, DHCP cấp **192.168.230.176**, TCP/22 mở (`OpenSSH_9.6p1 Ubuntu-3ubuntu13.20`),
   Hyper-V event `successfully booted an operating system` lúc 22:08:32.
6. Rebuild seed `--seed-only` (**SEED_REBUILT**, exit 0) để: thêm `linux-cloud-tools-virtual` +
   `hv-kvp-daemon` (KVP báo IP) và in fingerprint public host key ra console.
7. Full suite sau toàn bộ thay đổi: **442/442 PASS**, exit 0 (`data/khoa-current/full-test.log`).

**Trạng thái cuối lượt:** VM `OOTv2-Judge` chạy, SSH strict đã pin, release `20261024T162131Z-fc5c364044fc`
đã cài, **judge worker `active` + `enabled`**, attestation `pass`, `worker-health --scope=judge` OK.
Việc còn lại: chấm **một job thật** (official hoặc manual final) rồi drill tranh chấp 2 worker / hết lease /
kill giữa trận / reboot / rollback update hỏng.

**Lỗi thật đã sửa trong lượt này:** `NativeCommandError` từ `wsl.exe`/`ssh`/`scp` giết script im lặng;
`wsl.exe` bỏ backslash khiến `wslpath` fail; `Assert-WslVisible` nhận sai path; `qemu-img` không resize được vhdx;
grow qua raw trên DrvFs treo; 4 GiB tĩnh không cấp được; KVP thiếu nên Hyper-V không báo IP;
**cloud-init `ssh_deletekeys` sinh lại host key mỗi lần seed rebuild**; **entrypoint check sai khi release
deploy qua symlink** (service chạy rồi thoát 0 mà không làm gì); `workerctl.sh` hỏng quoting Python +
chết vì file attestation root-only; `-Service` mặc định sai.

## 24/10/2026 — hoàn thiện runtime/bộ cài sau khi Huy chốt schema (mới nhất)

Phạm vi: chỉ phần Khoa (readiness, provisioning Hyper-V, service/update/rollback, test). Không sửa
engine/luật hoà/schema/router/UI của Huy–Bảo, không apply migration, không claim job remote.

### Đã sửa

| File | Lỗi đã đóng |
| --- | --- |
| `tools/cli/worker-health.js` + `tools/cli/workerHealthProbes.js` | Probe GitHub chỉ nhận `bad_lease` trong khi guard thật là `400/P0001 bad_worker` ⇒ DB đúng vẫn bị chặn start. Tách `--scope=github\|judge\|all`, thêm kiểm official tables/claim, kiểm attestation trên guest Linux, không claim job |
| `tests/workerReadinessProbes.test.js` (mới) | Test hành vi thật của guard: `ok:true` (đã lease) phải FAIL, lỗi 401/404/PGRST202/500 phải FAIL |
| `tools/provision/workerctl.sh` | `health` theo đúng service; `start`/`restart` của judge bắt buộc attestation timer + oneshot thành công; thêm `attest` |
| `tools/provision/ootv2-official-worker.service` | `Wants=ootv2-attest.service` để boot kéo attestation trước judge |
| `tools/provision/install-judge.sh` | Chụp service active **trước** khi stop (`OOTV2_PREVIOUS_ACTIVE`); env ghi file tạm rồi swap, rollback phục hồi env cũ; attestation lỗi được báo rõ thay vì bị `||` nuốt |
| `tools/provision/deploy-release.sh` | Đọc trạng thái service từ state file (trước đây đọc sau khi installer đã stop nên update luôn tắt worker cũ); rollback chạy lại attestation, lỗi thì dừng service |
| `tools/vm/New-JudgeVM.ps1` | Kiểm passphrase bằng header bcrypt (`ssh-keygen -y` **không** nhận `-P`), `Invoke-Capture` đóng stdin + timeout nên không treo prompt; derive `.pub` và kiểm khớp thay vì tạo lại key; chuyển path bằng `wslpath` + `test -e` thay vì giả định `/mnt/<drive>`; `exit 0/1` |
| `tools/vm/Install-Judge.ps1` | `ssh-keygen -F` xác nhận `known_hosts` có entry trước khi gửi credential; kiểm release đủ file tại Windows; `ConnectTimeout`/`ServerAlive*` |
| `tools/vm/Worker.ps1` | `doctor` kiểm `wsl-image-tools` và WSL thấy thư mục VM; `known_hosts` rỗng là FAIL; thêm action `attest` |
| `tools/vm/prepare-image.sh` | Retry/resume (`-C -`, `--retry-all-errors`, speed-limit), partial đặt tên theo checksum build, mismatch bỏ partial, tối đa 3 lượt; conversion qua `judge.vhdx.stage`/`seed.vhdx.stage`; cloud-init thêm growpart + qemu-guest-agent |
| `tests/workerVmProvisioning.test.js`, `tests/productionPlan.test.js` | Cập nhật theo code mới; thêm ca chạy `bash -n` thật trên 4 script |

### Bằng chứng đã chạy (local)

| Lệnh | Kết quả |
| --- | --- |
| `node --test --test-concurrency=1 'tests/*.test.js'` | **442/442 PASS**, 0 fail, exit 0 (`data/khoa-current/full-test.log`) |
| `npm run build` | **PASS**, `built in 5.88s`, exit 0 (`data/khoa-current/build.log`). Lượt này không sửa file `src/` nào nên build không phụ thuộc các sửa shell/PowerShell sau đó |
| `node --test tests/workerVmProvisioning.test.js tests/workerReadinessProbes.test.js tests/productionPlan.test.js` | **14/14 PASS**, exit 0 (`data/khoa-current/final-check.log`) |
| `bash -n` cho `prepare-image.sh`, `install-judge.sh`, `deploy-release.sh`, `workerctl.sh` | exit 0 (có trong test + `final-check.exit`) |
| PowerShell `Parser::ParseFile` cho `New-JudgeVM.ps1`, `Worker.ps1`, `Install-Judge.ps1` | **0 lỗi** |
| `node --check tools/cli/worker-health.js`, `workerHealthProbes.js` | exit 0 |
| `node tools/cli/worker-health.js --scope=bogus` | usage + **exit 64** (không chạm mạng/DB) |
| Kiểm chứng thủ công key: ProcessStartInfo tạo key `-N ""`, phát hiện bcrypt, `ssh-keygen -y` derive khớp `.pub` | PASS (`plain_detected=False`, `locked_detected=True`, `pub_matches_derived=True`) |
| `git diff --check` | sạch |

### NOT RUN (không đổi thành PASS)

- Chưa tạo VM/VHDX: `.part` cũ không hợp lệ, chưa có lần download kết thúc với exit code quan sát được.
  **Chưa có bằng chứng kết luận nguyên nhân là reset kết nối** — script mới sẽ cho kết luận rõ.
- Chưa có guest host-key fingerprint ⇒ chưa pin `known_hosts`. Fingerprint `SHA256:BjbX…` ở lượt trước là
  **client key**, không phải host key.
- Chưa chuyển `.env`, chưa cài/start worker trên guest, chưa chấm job thật, chưa kill/reclaim/reboot/rollback
  trên VM, chưa chạy PostgreSQL rehearsal riêng.
- Browser E2E, load 50/100/200 viewer, restore rehearsal: NOT RUN (thuộc Bảo/operator).

### Bước tiếp theo cần người dùng cho phép

1. Chạy lại provisioning (`Worker.ps1 -Action doctor` → `install`) để image tải/resume và tạo VM.
2. Đọc **host key của guest trong console**, ghi `known_hosts`, rồi mới cài release.
3. Sau khi được phép: `workerctl.sh attest` + `health` + `start` cho `judge`, rồi chấm job thật.

## 24/10/2026 — tiếp tục sau pull Huy / elevated Windows

- `doctor` chạy elevated: PASS. `.env` project hiện `ftzockzolisecnyhlwej`; health read-only
  cho manual/GitHub tables + manual claim/heartbeat reachability PASS, bucket private/256 KiB
  PASS. GitHub claim health call nhận guard `400/P0001`; không claim job.
- Migration history live chỉ ghi `campus_foundation` trong khi catalog có manual heartbeat,
  GitHub RPC/tables. History/catalog mismatch cần Huy/operator đối chiếu; không apply migration.
- User cho phép tạo `OOTv2-Judge` ở `D:\OOTv2-VM` (4 CPU/4 GiB/Default Switch). Chưa tạo VM:
  Noble image download connection reset, `.part` chưa đủ/không hợp lệ. Key ed25519 empty-passphrase
  verify PASS; fingerprint console: `SHA256:BjbXTSsCId9+zf/pYbp8fKkcpjwKZAjeh9Vr6b88B6s`;
  chưa pin known_hosts, chưa SSH/install worker.
- Phát hiện PowerShell native arg bug ở ssh-keygen; sửa local `New-JudgeVM.ps1`, thêm
  `tests/workerVmProvisioning.test.js`. Cần sửa/kiểm provisioning retry policy và clean partial
  image có xác minh rồi mới chạy lại. Xem `docs/KHOA-WORKER-RC.md`.

## Cập nhật hiện hành 24/10/2026 — heartbeat manual / 0-ply / service judge

Xem `docs/KHOA-WORKER-RC.md`: thay các ghi chú lịch sử bên dưới về “chờ Huy heartbeat”
và “0-ply chỉ bot_fault”. Consumer + migration additive đã được bổ sung local;
migration mới chưa apply remote, PostgreSQL/VM acceptance chưa đạt. Người dùng chọn
Hyper-V và chấp thuận accepted result/replay 0-ply do engine xác định.
Huy tiếp tục E2E online; không xem enqueue là publication hoặc tự đóng gate RC.

Bằng chứng local mới: `node --test --test-concurrency=1 tests/*.test.js` **421/421 PASS**,
exit 0; build/diff/Bash syntax exit 0 (`data/khoa-current/results.json`). Lượt full
parallel trước đó 420/421 do viewer overview P95 904.9 > 800 ms; không nới test.
PowerShell parser `Worker.ps1`: 0 lỗi. `.env` readiness: bucket private/256 KiB đạt,
intake/manual tables và RPC trả 404/PGRST202, nên chưa thể chạy judge thật.
PostgreSQL rehearsal migration mới, VM install/reboot/rollback và real-job recovery:
**NOT RUN**. Chưa ký gate Khoa/RC, không push/deploy/apply remote.

## 24/10/2026 (sau khi pull) — Tích hợp gate sandbox của Huy + drill 2 worker

- **Tôn trọng thay đổi của Huy:** `campusSandboxFactory` nay bắt opt-in `trusted-dev`
  (`OOTV2_ALLOW_TRUSTED_DEV=1`) và worker chạy `assertCampusSandboxReady()` lúc khởi động.
  Adapter manual đã dùng `trusted: factory.trustedDev === true` nên không thể vô tình chạy bot
  trên host khi factory chưa opt-in.
- **Thêm script chạy worker manual** (`package.json`, chỉ thêm dòng, không đổi script cũ):
  `worker:manual`, `worker:manual:once`, `worker:manual:drain`, `worker:manual:dev-db`,
  `drill:manual-worker`.
- **Drill 2 worker** `tools/cli/manual-worker-drill.js` (+ `tests/manualWorkerDrill.test.js`):
  chạy **đúng** `runOfficialWorker` → `processManualFinalJob` → `executeManualFinalJob`, chỉ thay
  DB/Storage/Python bằng queue in-memory mô phỏng lease token + `generation` + `attempt` +
  backoff + `already_finished` của `20261026100000_manual_final.sql`.
  Kết quả **9/9 PASS**: 2 worker tranh 1 job (1 lần chấm), lease bị lấy (worker cũ `lease_lost`),
  retry cùng snapshot, hết lượt → `infra_fault`, finish lặp → `already_finished`,
  2 job/2 worker, validate nhị phân không chạy bot, validate hợp lệ, bot lỗi setup 0 ply.
  Artifact: `data/khoa-manual/drill-local.json`.
- **Preflight mở rộng** `tools/cli/worker-health.js`: thêm `mvp_manual_final_jobs`,
  `mvp_manual_final_matches` và probe `mvp_manual_final_claim` với `p_worker=''`
  (hàm trả `bad_worker` trước khi truy vấn job nên **không lease/ghi** gì).
- **Smoke 2 process trên DB thật** (G5 `wsyfcgurnrowcuefwynx`, queue rỗng): hai process
  `node --env-file=.envdev server/officialWorker.js --manual --once` chạy song song, cả hai
  `exit 0` với `RESULT processed=0 recorded=0 failures=0`, log preflight `sandbox: trusted-dev`.
  Không tạo/không ghi dòng nào. Artifact: `data/khoa-manual/live-2worker-smoke.json`.
- **Phát hiện môi trường (quan trọng cho cả nhóm):** `.env` trong workspace trỏ
  `ftzockzolisecnyhlwej` — project **không có** schema `mvp_*` (mọi bảng/RPC trả 404), nên
  worker ở đó chỉ ra `shared_db_error`. Schema manual chỉ có trên G5 qua `.envdev`
  (`mvp_manual_final_jobs`, `mvp_manual_final_matches`, `mvp_manual_final_claim` PASS).
  Trên G5, `worker-health` còn FAIL `storage_bucket` (bucket `ootv2-bots` chưa private/262144)
  và `mvp_github_claim` (khác subsystem) → chưa chạy được job thật.
- Tài liệu runbook: `docs/DRILL-MANUAL-WORKER.md` (drill local, smoke DB thật, E2E job thật,
  drill VM + acceptance checklist).

### Bằng chứng sau pull (24/10/2026)

| Lệnh | Kết quả |
| --- | --- |
| `node --test tests/manualFinalExecution.test.js tests/manualFinalWorker.test.js tests/manualWorkerDrill.test.js tests/manualFinalApi.test.js tests/officialWorker.test.js` | **35/35 PASS**, exit 0 (`data/khoa-manual/contract-tests.log`) |
| `npm.cmd run drill:manual-worker` | **9/9 PASS** (`data/khoa-manual/drill-local.json`) |
| 2 process `--manual --once` trên G5 (queue rỗng) | **PASS**, cả hai `exit 0`, `processed=0`, không ghi dòng (`data/khoa-manual/live-2worker-smoke.json`) |
| `node tools/cli/worker-health.js --json` (`.env`) | BLOCKED: mọi bảng/RPC 404 (project `ftzock...` không có schema) |
| `node --env-file=.envdev tools/cli/worker-health.js --json` | manual jobs/matches/claim **PASS**; bucket `ootv2-bots` FAIL |
| `npm test` toàn bộ | **406/406 PASS**, 0 fail (`data/khoa-manual/full-test.log`) |
| `npm run build` | **PASS**, 1654 modules, 6.65 s (`data/khoa-manual/build.json`) |
| `git diff --check` | sạch |

### NOT RUN (giữ trung thực)

- Chưa có job thật end-to-end: cần bucket `ootv2-bots` đúng cấu hình + BTC tạo cặp đấu
  (hoặc cho phép drill ghi dữ liệu vào G5). Schema không có DELETE policy cho `service_role`.
- Chưa drill VM Linux: máy này `Get-VM` bị từ chối quyền Hyper-V, không có `tools/vm/worker.local.json`,
  không có `D:\OOTv2-VM`. Không có `linux-sandbox` + attestation thật.
- Chưa thử kill worker đang chấm trên DB thật để kiểm lease-expiry (đã kiểm ở drill hợp đồng).
- Chưa commit/push (để người dùng review RC).

## 24/10/2026 — Consumer queue Chung kết thủ công đã có code (gỡ blocker E2E manual)

- **Đính chính handoff cũ:** câu "manual-final source/provenance chưa có producer" **không còn đúng**.
  Producer phía Huy đã có từ trước: bảng `mvp_manual_final_*`, `snapshot_json`, RPC
  `mvp_manual_final_claim/finish/release` (`supabase/migrations/20261026100000_manual_final.sql`)
  và client `server/shared/manualFinalJobs.js`. Phần thiếu chỉ là **consumer**, nay đã bổ sung.
- Code mới: `server/services/manualFinalExecution.js` (xử lý `validate` + `match`).
- Code sửa: `server/officialWorker.js` — nhận thêm queue `manual`:
  `WORKER_QUEUES = ['official','manual']`, `processManualFinalJob`, `createQueueProcessor`,
  `parseWorkerQueues`; `runOfficialWorker` giữ lease riêng từng queue
  (`leaseSeconds` cho official, `manualLeaseSeconds = 300` cho manual).
- Không có runner thứ hai: manual và official dùng **cùng** `runCampusMatch`,
  `createCampusSessionFactory`, `OFFICIAL_BUDGET`, `createOfficialRuntimeIdentity` và
  `verifyPinnedRuntime`. Không dùng runner MVP, không chạy bot trong API/Vercel.
- `validate`: tải artifact private theo `storage_path` trong DTO claim → kiểm size/sha256 →
  `inspectSourceBuffer` (UTF-8/NUL/size) → protocol smoke Campus v2 **trong session sandbox**
  (setup Đỏ → setup Xanh khi đã thấy Đỏ → một nước Đỏ hợp lệ) → `finish` `valid`/`invalid`.
- `match`: xác minh snapshot pin trước khi tải bytes:
  `schemaVersion = manual-final-match.v1`, `provenance = manual_final`, khớp `eventId/roundNo/
  seriesId/gameNo/seed/contentHash = snapshot_hash`, `mapHash` + `map` khớp `map_hash`,
  runtime/budget khớp identity đang chạy, `red/blue.submissionId|teamId|sha256` khớp match.
  Sau đó đọc submission **theo ID đã pin** (không lookup "bài mới nhất"), kiểm `status = valid`
  + `locked_at`, tải và kiểm hash rồi mới chạy Campus.
- Phân loại lỗi:
  - lỗi bot/protocol trong `validate` → `invalid` (không retry);
  - Storage/sandbox/tải lỗi tạm thời → `release` retry **cùng input**;
  - input sai vĩnh viễn (hash/map/runtime/provenance) hoặc replay quá lớn → `release` với
    `maxAttempts = 1` để dừng ở `infra_fault`;
  - `leaseLost = true` từ `finish` **không** tính là đã ghi và không release;
  - shutdown giữa ván → release `worker_shutdown`, không có kết quả.
- **Contract còn mở với Huy:** `mvp_manual_final_finish` yêu cầu `ply_count >= 1`, nên ván kết thúc
  ngay ở setup (bot lỗi xếp quân, 0 ply) hiện được ghi `bot_fault` + `error_code = setup_bot_fault`
  thay vì `finished`. Không tự sửa migration của Huy; nếu BTC muốn lưu kết quả forfeit 0 ply thì
  cần migration additive cho phép `ply_count = 0` và giữ nguyên `result`/`reason`.
- **Queue manual chưa có RPC heartbeat** trong migration hiện tại; consumer dùng lease 300 s
  (dưới trần 900 s của claim) đủ cho `2 × responseTotalMs + setup + tải artifact`. Đề nghị Huy
  bổ sung heartbeat nếu muốn lease ngắn hơn hoặc trần thời gian dài hơn.

### Cách chạy (Huy/BTC dùng để kiểm E2E manual)

```powershell
# Một job rồi thoát (CI/kiểm tra nhanh)
node server/officialWorker.js --manual --once

# Xử lý tới khi queue rỗng
node server/officialWorker.js --manual --drain

# Chạy dài hạn (service)
node server/officialWorker.js --manual

# Một tiến trình phục vụ cả official + manual (official trước)
node server/officialWorker.js --all
```

`--manual` và `--all` loại trừ nhau. Mặc định (không cờ) vẫn chỉ chạy `official` như trước.
Service dài hạn: `node server/officialWorker.js --manual` (workerId prefix `manual-...`).
Chưa thêm npm script vì `package.json` thuộc Huy; nếu Huy đồng ý, thêm
`"worker:manual": "node server/officialWorker.js --manual"`.

### Bằng chứng đã chạy

| Lệnh | Kết quả |
| --- | --- |
| `node --test tests/manualFinalExecution.test.js tests/manualFinalWorker.test.js tests/manualFinalApi.test.js tests/officialWorker.test.js` | **32/32 pass**, exit 0 (`data/khoa-manual/contract-tests.log`) |
| `npm test` (toàn bộ) | **395/395 pass**, 0 fail/skip, exit 0 (`data/khoa-manual/full-test.log`) |
| `npm run build` | **PASS**, exit 0, 1654 modules, built in 8.62s (`data/khoa-manual/build.log`) — sau khi chuyển `dist/` cũ bị giữ handle sang `data/` (xem ghi chú dưới) |
| `git diff --check` | sạch |

Test phủ: snapshot pin đúng/sai (schema, provenance, map, runtime, submission), validate
valid/binary/INVALID_SETUP/Storage lỗi, match accepted result + replay, 0-ply bot fault,
snapshot bị sửa, source lệch hash, lease lost, shutdown giữa ván, claim/queue rỗng/queue lạ,
argv `--manual`/`--all`, lease riêng từng queue. Test mới dùng stub session/runMatch —
**chưa chạy Python thật trong bước này**.

**Ghi chú build trên Windows (đã tái hiện được):** lần đầu `npm run build` FAIL với
`EPERM ... dist\\assets` tại `emptyDir` của Vite, dù **không có file read-only** và build sang
thư mục mới (`--outDir dist-check`) **PASS**. `rmSync('dist')` cũng trả `EPERM` → có process
khác đang giữ handle trong `dist/` (không phải lỗi code). Sau khi chuyển `dist/` cũ sang
`data/dist-stale-*` (đã ignore), `npm run build` chạy sạch. Đề nghị Huy thêm bước clean dist
an toàn (`prebuild`) nếu muốn tránh lặp lại; Vercel build từ checkout sạch nên không bị.

### NOT RUN / blocker còn lại

- Chưa chạy consumer trên **Supabase thật**: cần `20261026100000_manual_final.sql` đã apply
  (Huy báo đã apply trên `wsyfcgurnrowcuefwynx`) và một job thật; lượt này không gọi DB/mạng.
- Chưa chạy sandbox Linux/VM thật cho job `validate`/`match`; `trusted-dev` vẫn là mặc định
  và factory fail-closed khi thiếu attestation.
- Chưa có browser E2E manual (Bảo) dùng worker này; replay manual vẫn cần Bảo sửa callback
  `onOpenReplay` (đang truyền object replay vào hàm nhận match ID).
- Chưa có heartbeat manual trong DB; lease 300 s là giải pháp tạm có ghi chú.

## 24/10/2026 — Worker Campus chính thức: code local, gate chưa đạt

- Trong workspace có scaffolding chưa track cho `server/officialWorker.js`,
  `server/services/{officialExecution,officialKnockout,officialOrchestration}.js`,
  `server/shared/officialJobs.js` và migration additive
  `supabase/migrations/20261026090000_official_worker_jobs.sql`. Không sửa/xóa các
  artifact `.tmp_*` hoặc migration; migration **chưa apply**.
- Đã thêm `worker:official`, `worker:official:once`, `worker:official:drain` vào
  `package.json`; thêm `tests/officialWorker.test.js` cho claim/reap, queue rỗng,
  transient backoff, once-mode và abort/shutdown.
- `node --test tests/officialWorker.test.js`: **5/5 PASS**.
- `npm.cmd test`: **358/358 PASS**, 0 fail/skip (stdout `data/official-test.stdout.log`).
- `npm.cmd run build`: **FAIL** sau transform 1652 modules, Vite `EPERM` khi xóa
  `dist/assets` trên Windows (`data/official-build.stderr.log`). Chưa xác định đây là
  quyền/lock trên output hiện hữu hay lỗi khác; không xóa `dist` để thử lại.
- `git diff --check`: không in lỗi; exit không được shell integration ghi nhận ổn định.
- DB migration/PostgreSQL concurrency: **NOT RUN**, không apply remote. Hyper-V/VM sạch,
  attestation production, 2 worker thật, update/rollback/recovery và manual-final E2E:
  **NOT RUN / BLOCKED**. Không bật worker gate/Start và không tuyên bố runtime production-ready.
- Contract hiện có xác nhận `rows('official_jobs')` tự ánh xạ sang
  `mvp_official_jobs`; không đổi relation. Manual-final source/provenance chưa có producer
  trong workspace nên chưa thể enqueue manual snapshot một cách hợp lệ.

## Trạng thái mới nhất

### 24/10/2026 — K2 real DB sau H4: PASS 14/14 (migration đã apply)

- Đồng bộ `origin/dev` (merge `e0075a4`): H4 đã apply **10/10 migration** trên Supabase thật,
  gồm `20261025090000_official_schedule`; `db:verify` OK (driver/workerLeases/auth-CSRF, counts đọc được).
- Thêm `tools/cli/k2-schedule-drill.js` + `npm run db:k2` + `tests/k2Drill.test.js` (**2/2**).
  Drill tạo event/4 đội tạm, **không đụng dữ liệu thật**, cleanup trong `finally`.
- **DB thật PASS 14/14**: open round + `round_exists`; load snapshot/genesis; **2 writer tranh
  append** (một thắng, một `stale_prefix`); chain seq 1; record lặp idempotent; record khác
  `result_conflict`; freeze thiếu ván `incomplete_schedule`; append/record đủ **12 ván**; load
  xác minh toàn chain; freeze `frozen=true`; freeze lặp idempotent. Leftover sau drill = 0.
- Thêm `server/judge/officialRuntime.js` + `tests/officialRuntime.test.js` (**3/3**): hash file
  engine/rules/protocol/replay + budget; CRLF chuẩn hoá; verify trước chấm. Drill K2 đã dùng hash thật.
  Budget/đóng băng engine **chờ BTC chốt**: [OFFICIAL-RUNTIME](../OFFICIAL-RUNTIME.md).
- Lưu ý: chưa kiểm RLS bằng JWT anon/authenticated (`.env` chỉ có service role), crash giữa
  transaction, nhiều process/region, tải 35–56 đội.
- **Đã thêm:** `server/services/officialRounds.js` build snapshot từ setup/submission + admin route
  `GET/POST /events/:id/official-round` + panel “Vòng bảng chính thức”; drill `db:k2-open` **6/6**.
  `server/services/githubCutoff.js` + API/CLI/worker pull một lần lúc cutoff; drill `db:cutoff` **4/4**.
- **Còn thiếu K2:** runner gọi `runCampusMatch` rồi append/record/freeze, standings/top 16/knockout,
  đội/viewer xem lịch, VM sandbox. Trigger `official_scheduler_not_ready` và Start vẫn khóa.
- **VM Hyper-V:** máy này `Microsoft-Hyper-V-All` đang **Disabled**, không có `vmms`; cần admin +
  reboot mới tạo VM sạch. Chưa dùng WSL2 cho production.
- Cập nhật `docs/OFFICIAL-SCHEDULE.md`, `docs/OFFICIAL-RUNTIME.md`, `docs/OFFICIAL-WEEKLY-FLOW.md`,
  `docs/GITHUB-CONSUMER.md`, `docs/07`; migration không sửa lại.
- Full suite **326/326 pass**, 0 skip; Vite build exit 0 (1652 modules); `git diff --check` sạch.


### 24/10/2026 — K4 seccomp + CPU budget + attestation (dev 14/14, production chưa mở)

- **Chọn công cụ** sau khi đối chiếu judge thật: `bubblewrap` (nhẹ, không setuid, Flatpak dùng,
  có `--seccomp`) + cgroup v2 + libseccomp. nsjail/isolate là phương án allowlist/judge thuần;
  gVisor/Firecracker cho code công khai. Bảng so sánh + link trong `docs/SANDBOX-PRODUCTION.md`.
- **Seccomp**: `sandbox/linux/seccomp-profile.py` sinh BPF deny-list 67 syscall (mount*, unshare,
  setns, ptrace, process_vm_*, keyctl/add_key, bpf, perf_event_open, io_uring_*, userfaultfd,
  open_by_handle_at, kexec/module, swap/reboot...) → `EPERM`; runner fail-closed nếu thiếu
  `python3-seccomp`/generator; `--seccomp-mode off` chỉ để dev và được ghi vào metrics.
- **Runner**: `--cpu-seconds`, `--cgroup-id`/`--cgroup-root` (adapter đọc đúng cgroup), metrics
  thêm `seccomp`, `cpuSeconds`, `cgroup`; exit 0/124/137/78/64 giữ nguyên.
- **Selftest 14/14 PASS** (WSL, kernel 6.18.54.1): thêm probe `Seccomp:2` + 6 syscall escape
  (`EPERM`), mode off (`Seccomp:0`); các test cũ vẫn pass (fork 124, mem 137, CPU/wall 124,
  flood cắt 64 KiB, FS/net/env, cleanup).
- **Adapter `linux-sandbox.v2`**: đọc `cpu.stat` mỗi 50 ms, vượt `cpuTotalMs` → `BOT_CPU_LIMIT`;
  exit 137 → `BOT_MEMORY_LIMIT`; metrics `cpuMeasured`, `cpuUsec`, `memoryMeasured`,
  `memoryPeakBytes`, `oomKills`, `seccomp`, `cgroup`; unit **9/9**. E2E WSL: setup 9 quân + move,
  `cpuMeasured=true`, `memoryPeak≈5 MiB`, `seccomp=deny-list.v1`, cgroup sạch.
- **Attestation + factory**: `sandbox/linux/attest.sh` xuất receipt 24 h (kernel, hash BPF, probe,
  selftest); `server/judge/campusSandboxFactory.js` từ chối WSL, receipt hết hạn/sai, seccomp off,
  runner tương đối; mặc định vẫn `trusted-dev`. Test **4/4**.
- **Ngân sách đề xuất**: 128 MiB RAM/bot, 20 s CPU/ván/bot, setup 5 s, move 1 s, pids 16,
  `cpu.max` 1 core; VM 4 vCPU/8 GiB/80 GiB cho ~200 ván/ngày (4 ván đồng thời). Chi tiết +
  checklist production trong `docs/SANDBOX-PRODUCTION.md`.
- `campusMatchRunner` giờ trả `sandboxProfiles` và limitations lấy từ session (không còn ghi
  "No OS sandbox" khi chạy sandbox thật).
- **Chưa production**: deny-list (chưa allowlist), chưa chạy `attest.sh --full` trên VM Linux thật,
  campus worker/API chưa nối factory. H4/DB và gate Start/consumer giữ nguyên.
- Full suite **312/312 pass**, 0 skip; Vite build exit 0 (1650 modules); `git diff --check` sạch.


### 24/10/2026 — K4a (bản đầu, trước seccomp): dev acceptance 11/11

- Dựng **distro WSL2 riêng** `ootv2-sandbox` từ Ubuntu base 24.04.3, import vào
  `data/wsl/ootv2-sandbox` (gitignored, D:), không dùng Ubuntu cá nhân. WSL 3.0.3 / kernel
  6.18.54.1, Python 3.12.3, bubblewrap 0.9.0, cgroup v2 có `cpu memory pids`.
- `sandbox/linux/run-bot.sh`: `bwrap --unshare-all --clearenv --cap-drop ALL`, `/usr` read-only,
  `/proc` + `/dev` riêng, `/tmp` tmpfs 16 MiB, không `/mnt|/home|/sys`; cgroup v2
  `memory.max/swap=0/pids.max/cpu.max` + watchdog wall-time + dọn cgroup/process; stdin/stdout
  JSONL truyền nguyên. Exit: 0/124 timeout/137 kill/78 thiếu hạ tầng/64 tham số.
- `sandbox/linux/preflight.sh`, `selftest.sh`, fixtures lành tính + phá hoại (chỉ test).
  **Selftest 11/11 PASS**: JSONL round-trip, metrics, FS/network/env isolation, fork bomb (124),
  memory 64 MiB (137), CPU/timeout (124), CPU accounting ~262 ms, stdout flood cắt 64 KiB,
  wall timeout, cgroup cleanup, process cleanup. Log `data/khoa-next/sandbox-*.txt`.
- `docs/SANDBOX-WSL.md` + `sandbox/README.md`; `.gitattributes` khóa LF cho `*.sh`.
- Adapter Node `server/judge/linuxSandboxSession.js`: Linux-only mặc định (Windows phải truyền
  `launch` tường minh), kiểm `resolveBotPath`, argv limit, `runnerEnv` tối thiểu, tái dùng validator
  `bot.v1`, timeout/budget, map exit 78/124; test fake child **7/7**.
- E2E thật trong WSL (Node 18.19.1 + runner + bwrap): setup 9 quân + move trả đúng, `stdoutBytes=497`,
  đóng session không còn cgroup; `productionReady:false` vì chưa đo CPU/RAM per request.
- **Chưa production:** chưa seccomp/syscall allowlist/attestation, WSL chia sẻ kernel/tài nguyên
  Windows, chưa thử escape nâng cao. Không dùng cho code sinh viên; mọi gate Start/consumer giữ nguyên.
- Đã merge thêm `origin/dev` (`4477be5`, sửa SubmissionsPage/githubSyncState) không conflict.
  Sau merge: **306/306 test pass**, Vite build exit 0 (1650 modules), `git diff --check` sạch.
- (Đã thực hiện ở mục K4 phía trên; còn nghiệm thu trên VM Linux sạch.)

### 24/10/2026 — K2 schedule persistence + màu: READY FOR REVIEW (migration chưa apply)

- Bối cảnh: H4 chưa push (`origin/dev` = `2d8f6a3` lúc bắt đầu); giữa đợt remote nhảy 5 commit
  (`23b59c9`: live view trong login, `apply-migrations`/`check-github-db` dry-run mặc định). Đã merge
  `origin/dev` vào `dev`, không conflict; package.json giữ cả `offline:bundle` và 2 script DB mới.
  **Huy handoff vẫn ghi H4 chưa làm; chưa có bằng chứng apply Postgres thật.**
- Migration `supabase/migrations/20261025090000_official_schedule.sql` (**CHƯA apply**):
  `mvp_official_rounds` (snapshot jsonb + snapshot/genesis/chain hash + game_count + frozen) và
  `mvp_official_games` (seq/game_key unique trong vòng, hai màu khác nhau, seed uint32,
  map phải khớp snapshot, `color_policy=alternate-loss-priority.v1`, kết quả một lần kèm replay hash).
  RLS + `revoke all` khỏi public/anon/authenticated, chỉ `service_role`.
- 4 RPC: `open_round` (pin genesis, chặn trùng/đóng giải), `append_game` (`FOR UPDATE`, chỉ nhận
  `seq = game_count+1` khi `chain_hash = expected_prefix`, chặn `stale_prefix/round_frozen/
  map_mismatch/duplicate_game`), `record_result` (idempotent cùng replay, khác → `result_conflict`),
  `freeze_round` (`incomplete_schedule`/`pending_results`).
- Client `server/shared/officialSchedule.js`: `genesisHash`, `gameChainHash` (canonical JSON),
  `normalizeOfficialGame` (đúng 12 trường), `openOfficialRound`, `appendOfficialGame`,
  `recordOfficialResult`, `freezeOfficialRound`, `loadOfficialRound` (verify snapshot + toàn bộ chain
  + head), `nextPinnedGroupGame` (tái tạo lịch từ snapshot, đối chiếu prefix rồi trả ván kế tiếp kèm
  màu đã chốt; thiếu kết quả → `result_pending`, lệch lịch → `schedule_mismatch`).
- Test `tests/officialSchedule.test.js` **8/8**: genesis/normalize, open, append + stale fence,
  result idempotent/conflict, freeze, load + 4 kiểu tamper, next-game màu, guardrail SQL
  (RLS/revoke/unique/`$$` chẵn/không grant anon/không tự BEGIN-COMMIT).
  Full sau merge: `node --test "tests/*.test.js"` **295/295 pass**, 0 fail/skip; Vite build exit 0
  (1649 modules); `git diff --check` sạch.
- **NOT RUN:** apply PostgreSQL, 2 writer tranh append, crash giữa transaction, RLS/service_role thật,
  API admin, UI công bố màu (Bảo), persist series knockout, nối accepted result. Trigger
  `official_scheduler_not_ready` và Start vẫn khóa. Chi tiết `docs/OFFICIAL-SCHEDULE.md`.
- Việc tiếp: Huy review SQL rồi apply trên project disposable; sau H4 mới chạy test concurrency/crash;
  kế đó mới thêm route admin + UI màu và persist bracket.

### 24/10/2026 — K6a gói offline tự chứa: READY FOR REVIEW (chưa nối giải thật)

- Người dùng yêu cầu chờ H4 và làm trước những gì không phụ thuộc DB. Đợt này chỉ dùng filesystem +
  contract K2 sẵn có, không cần PostgreSQL/Storage/GitHub/sandbox.
- Thêm `server/shared/offlineBundle.js`: `buildOfflineBundle`, `verifyOfflineBundle`,
  `writeOfflineBundle`, `readOfflineBundle`; schema `campus-offline-bundle.v1`.
  Gói = `manifest.json` + `snapshot.json` (canonical JSON của `campus-round-snapshot.v1`) +
  `bots/<participantId>.py`; map chính/dự phòng và runtime hash nằm trong snapshot.
- Kiểm: manifest/snapshot contentHash, snapshot hợp lệ, tập bot đúng bằng snapshot, từng bot khớp
  `sourceSha256`, size/giới hạn, path chỉ `snapshot.json|bots/<safe-id>.py` (chặn traversal/extra/
  duplicate). Ghi vào thư mục rỗng, temp + fsync + rename, manifest cuối; đọc chỉ file trong manifest,
  từ chối symlink/không phải regular file và kiểm size trước khi đọc.
- CLI `tools/cli/offline-bundle.js` + script `npm run offline:bundle` (`build`/`verify`).
- Diễn tập thật trên Windows (không mạng/DB/Python): snapshot 2 bot → build 3 file/1754 byte → verify
  pass; sửa 1 byte → exit 1 `offline_bundle_invalid: file_hash_mismatch, bot_hash_mismatch`;
  phục hồi → exit 0. Log: `data/khoa-next/offline-demo-*.txt`, `offline-demo-tamper.json`
  (gitignored). Chi tiết: `docs/OFFLINE-BUNDLE.md`.
- **NOT RUN:** xuất từ giải thật, bundle 56 đội, restore VM Linux sạch, chạy bot trong phòng thi,
  ký số manifest, nhập kết quả/replay sau chấm offline. Chưa đổi consumer/Start/migration/env.
- Kiểm chứng đợt này: `node --test tests/offlineBundle.test.js` **5/5 pass**;
  `node --test "tests/*.test.js"` **287/287 pass**, 0 fail/skip; Vite build exit 0 (1649 modules,
  3,65 s); `git diff --check` sạch.

### 24/10/2026 — K3e Storage adapter cho consumer: READY FOR REVIEW (consumer vẫn tắt)

- Tiếp tục từ `dev @ 3ff49e7` (đã fetch/merge Huy+Bảo, working tree sạch, không conflict). Không đổi
  contract H1/H2/H3, không sửa báo cáo Huy/Bảo, không apply migration, không deploy.
- Thêm `server/shared/artifactUpload.js` — `storeVerifiedSource(source,{sourceHash,signal,timeoutMs})`
  là implementation cụ thể của callback `storeSource` mà `processGithubJob` yêu cầu:
  key tự sinh `<uuid>.py`, bucket cố định `ootv2-bots`, origin HTTPS từ `SUPABASE_URL`,
  `x-upsert:false`, `redirect:'error'`, deadline 20 s, honor `signal`.
  Sau POST phải **tải lại bằng `downloadStorageArtifact`** và so bytes + SHA-256; chỉ khớp mới trả
  `{storage_path, sha256}`. Lỗi chuẩn hoá `invalid_source|invalid_budget|storage_configuration|
  upload_rejected|upload_timeout|upload_cancelled|upload_integrity|upload_unavailable`; không đọc body
  lỗi, không retry, **không xoá** object (có thể là bài đã được `finish` nhận).
- Không import vào `runSharedWorker`/API/router/React; consumer vẫn `enabled:false`; không polling,
  không chạy Python. Đây là adapter Storage, **không phải sandbox** và không thay validation.
- Test bổ sung nằm trong `tests/artifactDownload.test.js` (7 test, mock `fetch`), gồm 1 test tích hợp
  `processGithubJob` + adapter: finish nhận đúng `{storage_path,sha256}`, không gửi `submission_id`.
  Cố ý không tạo file test mới để không thêm process song song làm nhiễu load test của Bảo.
- Contract và giới hạn: `docs/STORAGE-ADAPTER.md`; `docs/GITHUB-CONSUMER.md` đã trỏ tới adapter này.
- Exit code/lệnh (Windows, Node v24.18.0, lưu `data/khoa-next/*.json|log`):

  | Lệnh | Exit | Kết quả |
  |---|---|---|
  | `node --test tests/artifactDownload.test.js tests/githubConsumer.test.js` | 0 | 29/29 pass |
  | `node --test "tests/*.test.js"` | 0 | **282/282 pass**, 0 fail, 0 skip |
  | `node node_modules/vite/bin/vite.js build` | 0 | Vite build, 1649 modules, 4,70 s |
  | `git fetch origin --prune` | 0 | `HEAD == origin/dev == 3ff49e7` trước commit; không phân kỳ |
  | `git diff --check` | 0 | không output (không whitespace error) |

- **Load test nhạy cảm tải máy:** hai lượt full đầu fail ngưỡng P95 của Bảo
  (`1881.3 ms` và `1700.6 ms` so 1500 ms; `887.6 ms` so 800 ms) khi suite chạy thêm process;
  lượt chốt pass (`864.8 ms`, RPS 365, lỗi 0%). Không sửa ngưỡng hay test của Bảo; số đo phụ thuộc
  CPU/máy và chưa phải benchmark production.
- NOT RUN: Supabase Storage/PostgreSQL thật, GitHub thật, sandbox Linux, browser/pass, offline restore.
  Orphan khi upload xong nhưng finish không rõ vẫn chưa có inventory/GC tự động.

### 24/10/2026 — K3d consumer coordinator: READY FOR REVIEW (chưa bật)

- Tiếp tục từ `dev @ ec7d2f4`, working tree sạch; không fetch/merge remote trong đợt này.
- Thêm `server/shared/githubConsumer.js` export `processGithubJob`: opt-in disabled trước DB,
  yêu cầu explicit validateSource/storeSource adapter, mặc định RPC client + pinned GitHub fetch.
  Không import vào runSharedWorker, không CLI/env/schema/API/React mới, không gọi Python mặc định.
- Claim kiểm job/receipt identity và fence token/generation; heartbeat 10s/lease 120s; deadline
  sau claim tối đa 60s, signal abort khi lease mất/cancel/timeout. Callback nhận bytes copy/hash/signal,
  không raw job hoặc token. Cache put/acquire và finally release; chưa GC inventory tự động.
- Progress fetching/checking; invalid không upload; valid chỉ finish bằng submission payload mới,
  không dùng existing submission_id thiếu kiểm status/hash trong SQL. Hạ tầng release retry với
  fixed redacted message, heartbeat trước release; không coi đây là sửa server-side expiry bug.
- Finish không rõ commit => không release/delete/retry finish; cần đối soát receipt và orphan inventory.
  RPC đã in-flight không bị thu hồi transaction bởi AbortSignal của consumer; callback phải tự honor
  signal/cleanup, Promise.race không sandbox/kill process/chặn JS synchronous. Đọc giới hạn đầy đủ
  tại `docs/GITHUB-CONSUMER.md`; không tuyên bố H2/K3 production DONE.
- Thêm `tests/githubConsumer.test.js`: 12 test fixtures/mocks, gồm actual RPC wrappers + bounded
  pinned GitHub helper + filesystem cache qua fetch mock (4 GitHub calls), không DB/GitHub/Python thật.
  Test disabled/config/no-job, valid/invalid, identity/hash/storage checks, errors/redaction,
  heartbeat/progress loss, stalled fetch, cancel/deadline, uncertain finish.
- Baseline install/test/build exit 0 (**222/222**); warnings dependency cũ không audit fix.
  Sau code nhóm consumer/jobs/artifact/cache **44/44 pass**, toàn repo **234/234 pass**, 0 skip,
  exit 0. Build pass (4.21s), diff check exit 0; `data/khoa-consumer/final.json` đã thu đủ exit codes.
- Logs: `data/khoa-consumer/{git,baseline,targeted,final}.json`, `baseline-*.log`, `final-*.log`.
  Shell integration báo completion không quan sát được; đọc exit codes spawnSync/log thay vì suy thành công.
- NOT RUN: PostgreSQL concurrency/crash/lease, Storage thật, private GitHub, sandbox Linux,
  browser/load/offline recovery. Không push/deploy/apply remote, Start giữ khóa.
- Bước tiếp: Huy review/fix release expiry + existing submission check + reclaim max attempts,
  H4 DB thật trên project disposable được phép; nối adapter validation có sandbox và bounded Storage
  có signal/inventory rồi mới bật poll consumer. K2 persistence/H3 QA/K4 còn release gates riêng.
  SHA checkpoint: tra `git log -- docs/handoff/Khoa.md`.

### 24/10/2026 — Tích hợp contract GitHub/H3 + K3c cache: READY FOR REVIEW

- User yêu cầu pull Huy H2/H3 và làm tiếp. Checkout `dev @ bc0e0c6` sạch, không MERGE_HEAD.
  Fetch origin exit 0, fast-forward tới **d0ad705**, không conflict. Đã nhận `cf34ef5` (H3),
  `3b25a33` (fix previous submission + RPC worker), `43aff1b`/`d0ad705` (handoff).
  **Không xác nhận H2 DONE:** handoff Huy hiện ghi H1 fix/H3 mock-verified; H2/H4 chưa làm,
  consumer/validation và chặn upload online chưa hoàn tất. Không sửa báo cáo Huy/Bảo.
- FK previous valid đã đổi sang `receipt.submission_id`; migration **20261024160000** còn
  CREATE OR REPLACE intake để sửa DB đã nhận bản nháp. Không apply SQL remote trong phiên này.
- Review code thật: `mvp_github_release` kiểm token/generation/status nhưng thiếu lease_until
  còn hạn; `finish` với submission_id có sẵn chỉ kiểm participant, chưa kiểm status/hash.
  Expired claim chưa giới hạn max attempts; maxAttempts hiện chỉ dùng trong release.
  Cần Huy review corrective migration/tests PostgreSQL; không tự sửa migration ownership Huy.
  Intake/API bounded metadata cũ và contract freeze/pending/idempotent finish vẫn cần nghiệm thu.
- Milestone độc lập **K3c**: thêm `server/shared/sourceCache.js` export
  `createSourceCache({root,now?}) -> {put,read,acquire,gc,close}`; thêm 10 tests trong
  `tests/sourceCache.test.js`, hướng dẫn/giới hạn ở `docs/SOURCE-CACHE.md`.
  Cache theo SHA256, 1..256 KiB, private file UUID staging -> hash filename, kiểm bytes mỗi hit,
  từ chối traversal/symlink/junction/hardlink/non-file/oversize/corruption. Không execute source.
- acquire/release refcount bảo vệ source đang dùng; GC bắt buộc `retainedHashes` đầy đủ từ
  coordinator cho jobs/snapshots/valid/appeals/offline exports và maxAgeMs explicit, kiểm tất cả
  retained source trước xóa. Không có DB inventory tự động; pin bền vững vẫn thuộc DB, không Map.
  Một coordinator/root bằng exclusive `.owner`; không dùng shared root giữa hai worker.
  Crash lock cần operator xác nhận process chết trước dọn; không auto-steal. Chưa fsync/quota/
  crash rehearsal; Windows cần ACL operator, POSIX mode chưa nghiệm thu trên Linux.
- **Chưa nối cache vào worker/consumer/GC scheduler**, không thay runner MVP, router, React,
  dependency/config/schema; không mở Start. Không tự biến source hash thành submission valid.
- Baseline `npm.cmd install`, `npm.cmd test`, `npm.cmd run build`: exit 0, **212/212** tests.
  Install vẫn 2 high vulnerabilities + esbuild allow-scripts warning; không tự audit fix.
- Sau code: `node --test tests/sourceCache.test.js tests/githubArtifact.test.js
  tests/githubJobs.test.js tests/publication.test.js` **41/41 pass**, exit 0;
  `npm.cmd test` **222/222 pass**, 0 fail/skip, exit 0. `npm.cmd run build` pass (4.58s),
  `git diff --check` exit 0. Terminal integration báo không quan sát được completion nên
  dùng spawnSync exit + log files để xác minh, không coi wrapper failure là test failure.
- Bằng chứng gitignored: `data/khoa-h23/{inspection,merge,baseline,final}.json`,
  `baseline-*.log`, `final-*.log`. Không source sinh viên/secret trong code/tests.
- NOT RUN: PostgreSQL thật/migration concurrency, GitHub private thật, consumer E2E,
  browser H3/B2, load, Linux sandbox, offline restore. H3 mới xác minh mock, chưa production-ready.
- Bước tiếp: Huy review RPC issues + H4 disposable DB được operator cấp phép; sau đó consumer
  pinned fetch -> cancel khi lease mất -> sandbox validation -> Storage -> fenced finish.
  Cache integration chỉ GC sau inventory đầy đủ/nhất quán. K2 persistence và K4 sandbox còn gate.
  Không push/deploy/apply remote. SHA checkpoint: tra `git log -- docs/handoff/Khoa.md`.

### 24/10/2026 — Fetch/tích hợp H1 + K3b pinned GitHub source: READY FOR REVIEW

- Đã `git fetch --all --prune` exit 0, origin/dev từ a84c3c7 lên **1822e92**.
  H1 **be22c09**, handoff a38dc4f/a25d024, B2 1822e92. Huy H1 mock-verified, H2–H4 NOT RUN;
  không còn áp dụng kết luận Huy NOT STARTED trong checkpoint K3a bên dưới.
- Theo yêu cầu user tích hợp: chốt merge map/B1 đang mở thành **1ac8be6**, commit riêng K3a
  **f7bf6f5**, merge origin/dev không conflict; không reset/ghi đè/abort merge hoặc push.
  Backup K3a và Git logs ở `data/khoa-h1/backup`, `inspection.json`, `integration.json`.
- Thêm `server/shared/githubArtifact.js`: `fetchGithubArtifact(job,{fetchImpl,token,timeoutMs,
  signal,expectedHash})`. Input contract H1 nội bộ: numeric repo_id, canonical repository,
  file_path=bot.py, commit_sha full 40 hex; branch không dùng khi lấy source.
- Pipeline fixed api.github.com: repo identity -> pinned Git commit -> root tree -> exact blob.
  Không clone/archive/project/HEAD/download_url. Kiểm tree không truncated, một bot.py regular
  mode 100644/100755, từ chối symlink/tree/submodule. Source 1..256 KiB, base64 canonical,
  Git blob SHA1 đối chiếu bytes, UTF8 fatal/no NUL/no LFS; sourceHash SHA256 và optional
  expectedHash để restore đúng source đã pin. Không execute bot, không đọc DB hoặc ghi Storage.
- Budget toàn operation <=20s (fetch/body), streaming bounded buffers (repo 64 KiB, commit
  256 KiB, root tree 1 MiB, blob JSON 400 KiB); hủy stream khi quá cỡ/timeout/cancel,
  redirect:error, token chỉ header và raw upstream không vào error. Lỗi access/rate/network/
  integrity là infrastructure; lỗi file sai định dạng là code; repo identity changed là repo.
  Category chỉ là output nội bộ, chưa mapping thành SQL outcome hoặc result thua bot.
- Output: `{source:Buffer,sourceHash,size,repoId,commitSha,blobSha,filePath,sourceKind}`;
  source private không trả qua API DTO/log/replay. Helper chỉ consume job tin cậy từ coordinator,
  không phải cơ chế xác minh quyền sở hữu/cutoff từ input người dùng.
- Tests mới `tests/githubArtifact.test.js`: **17 pass**; cùng H1/API/B2 **30/30**;
  full suite **196/196 pass**, 0 fail/skip; build và diff check exit 0. Baseline sau merge
  install/test/build exit 0 (179 tests). Baseline script copy giữ log path cũ
  `data/khoa-k3/baseline*`; final logs `data/khoa-h1/final.json`, `final-{0..3}.log`.
- Test mocks kiểm SHA/branch không đổi, size biên/pinned hash, repo thay thế, symlink/submodule,
  LFS/binary/UTF8, tamper blob, truncated tree, oversize stream, timeout/cancel, redaction.
  GitHub thật/private/PAT permissions, PostgreSQL thật, browser B2 mới **NOT RUN**.
- Review H1 phát hiện blocker SQL trước tạo valid candidate thứ hai:
  `20261024130000_github_intake.sql` dòng 155 `SELECT id INTO previous FROM mvp_github_receipts`
  rồi ghi previous vào `previous_valid_submission_id REFERENCES mvp_submissions(id)`.
  Phải chọn `submission_id` của valid receipt (không receipt.id). Không sửa migration Huy tại chỗ;
  Huy cần migration corrective reviewed và integration trên Postgres. API H1 readJson còn dùng
  arrayBuffer rồi mới kiểm size, chưa bounded trước allocation như helper worker K3b.
- H1 chưa có RPC claim/heartbeat/progress/fenced finish/retry cho repo_sync_jobs;
  không tự đoán RPC hoặc nối consumer ghi trực tiếp bảng. Cần contract token/generation/lease,
  atomic submission+receipt acceptance/idempotency, retry/backoff/freeze-candidate semantics.
  Result/events/log/terminal game attempts vẫn cần fencing riêng, không đánh đồng intake job.
- Để tiếp tục consumer E2E: Huy review/đưa RPC trên, sửa FK previous, operator cấp disposable
  Supabase project và cho phép migrations qua kênh credential riêng (không paste secret chat).
  Linux sandbox host/runtime pin là gate độc lập trước validation source không tin cậy.
- Không env/dependency/migration mới, không remote DB write/apply/deploy/push, Start vẫn tắt,
  profile/replay MVP không đổi. Milestone này không đóng K3/K4/cache-pin-GC/scheduler persistence.

### 24/10/2026 — K3a bounded Supabase artifact retrieval: READY FOR REVIEW

- Nền `dev @ abb7cae`; có sẵn **18 file staged** của người dùng (map snapshot/worker MVP,
  migration map và UI B1). Không sửa/unstage/commit các file này; không kết luận chúng là H1
  chỉ từ lời mô tả. `docs/handoff/Huy.md` vẫn NOT STARTED; không tìm thấy GitHub backend
  receipt/job service hoặc migration/RPC tương ứng trong checkout. Bảo B1 READY FOR REVIEW.
- Phần thực hiện: `server/shared/artifactDownload.js`, sửa `server/shared/artifacts.js`,
  thêm `tests/artifactDownload.test.js` (10 tests), cập nhật báo cáo Khoa này.
- Contract: `downloadStorageArtifact(storageKey,{maxBytes,timeoutMs=20000,signal}) -> Buffer`;
  fixed HTTPS configured Supabase origin, bucket `ootv2-bots`, UUID.py key; không URL arbitrary,
  không redirect. Byte budget <=256 KiB kiểm cả header và từng chunk, fixed buffer tránh tích lũy
  metadata của vô số chunk nhỏ. Deadline bao trùm fetch/body và không chờ cancel treo.
- `materialize(submission,{signal,timeoutMs}={})` giữ tương thích một argument; kiểm SHA-256
  syntax trước mạng, kiểm hash trước file, file private UUID `wx`/0600, cleanup khi partial write.
  Source không execute ở downloader; lỗi upstream/body không bị đưa vào message/log.
  Không đổi `client.request()` chung hoặc upload API, worker/MVP profile/map snapshot.
- Integration test fetch giả xác nhận `validatePendingSubmissions` tải quá cỡ vẫn giữ uploaded,
  không ghi valid/invalid/kết quả; API/storage origin giả, không gọi credential/network thật.
- Baseline install/test/build exit 0: 155/155 tests. Sau sửa: targeted **16/16**, toàn repo
  **165/165 pass**, 0 fail/skip; build exit 0 (1639 modules). Log `data/khoa-k3/final.json`,
  `final-{0..4}.log`. Lượt đầu bắt cancellation-vs-EOF race đã sửa và test lại.
- `git diff --check` phần unstaged của Khoa exit 0. `git diff --cached --check` toàn stage
  có sẵn exit 2: extra blank EOF trong docs/07, githubSyncState.js, officialSetupView.js,
  githubSyncState.test.js, matchMapSnapshot.test.js, officialSetupView.test.js. Không tự sửa
  whitespace của người khác để báo PASS giả. Install còn 2 high vulnerabilities và esbuild
  script approval warning có trước; không tự audit fix.
- Không migration/env/dependency mới, không apply remote/deploy/push. Start giữ nguyên tắt.
  NOT RUN: Supabase integration thật, GitHub consumer, persistent retention/pin/GC, lease/fencing
  event/log/terminal, Linux sandbox, browser mới (không sửa frontend).
- Bước tiếp: xác định phần Huy nằm ở commit/branch/file nào nếu chưa vào checkout; cần contract
  reviewed receipt/job/snapshot/RPC trước consumer. Helper bounded GitHub blob/cache có thể
  làm milestone độc lập; K3a này chỉ tăng an toàn luồng Storage đang có, không đóng K3.
- Commit checkpoint **chưa tạo**: Git báo `cannot do a partial commit during a merge`.
  Repo có MERGE_HEAD đang mở; không tự commit merge/abort merge của người dùng. Đã bỏ stage
  chỉ 4 file của checkpoint này sau lần thử, bảo toàn 18 file stage gốc; code mới còn working tree
  và untracked để review. Bằng chứng `data/khoa-k3/{commit,merge-check}.json`.

### Checkpoint runtime trước đó

- Checkpoint độc lập 24/10/2026: **bot.v1/Campus trusted runtime foundation — READY FOR REVIEW**.
  Baseline `dev @ 0b4ca63`, checkout sạch. Không tuyên bố K3/K4 production hoàn tất.
- Đã thêm wire parser/validator/request builder `server/contracts/botProtocol.js`,
  `createTrustedCampusSession` trong `server/judge/campusTrustedSession.js`, `runCampusMatch`
  trong `server/judge/campusMatchRunner.js`, bot mẫu một file `examples/campus_bot.py`,
  CLI `tools/cli/demo-campus-bots.js`, 15 tests `tests/campusRuntime.test.js`, tài liệu
  `docs/CAMPUS-TRUSTED-RUNTIME.md` và README hướng dẫn. Không dependency/schema/env mới.
- `bot.v1` parser không mất duplicate key: scan trước JSON.parse, UTF-8 fatal, depth 16,
  finite numbers, exact envelope/request ID/kind/fields, 64 KiB input/16 KiB response.
  Persistent process tuần tự, total stdout 4 MiB/stderr 256 KiB, wall timer monotonic,
  total response wall 45 s mặc định, timeout/output overflow kill, private temporary dir,
  env allowlist không chuyển Supabase/server secret. Private output không chép vào result.
- Runner setup Red rồi Blue, bot fault chỉ active side; Campus engine authoritative với map,
  repetition/400 plies; replay engine verified trước return. Hạ tầng/cancel/cleanup failure throw,
  không trả result thua bot; abort đóng session, watchdog 120 s. Session cleanup idempotent.
- API adapter nội bộ: `startSession({filePath,allowedRoot,trusted,responseTotalMs})`
  → `{request(botV1Request),metrics(),close()}`. Production supervisor phải cung cấp contract
  tương thích và CPU remaining thực, không dùng adapter trusted như attestation.
  Output `profile:campus-engine-trusted.v1`, `productionReady:false`, result/reason/plyCount,
  replay engine/metrics/limitations; KHÔNG là DTO public hoặc replay production đầy provenance.
- Tests Windows/Node v24.18.0/Python local: riêng 15/15 pass, không skip; full suite 138/138 pass,
  build/diff check exit 0. Baseline install/test/build exit 0 (123 tests); install vẫn 2 high
  vulnerabilities/cảnh báo esbuild chưa tự audit fix. Logs `data/khoa-k1/runtime-final.json`,
  `runtime-final-{0..5}.log`. Test Python thực: persistent state/PID, secret absent,
  partial newline/timeout, stdout/stderr flood, duplicate line/key, crash, sample-vs-sample,
  deterministic replay. Injected adapter: fault đúng màu, invalid setup/move, cancel/cleanup infra.
- Demo CLI thực trên `examples/maps/campus-arena.json`: `blue_win/BASE_REACHED/16 plies`,
  replay verifier `ok:true,finished:true`, exit 0. Lượt đầu CLI sai argv count đã bắt và sửa;
  lượt cuối chạy lại demo/verifier/full test/build. Output file tạm được dọn sau verify.
- **Giới hạn thực:** subprocess không sandbox, không đo CPU/RAM, không cgroup freeze/ack,
  không readiness channel/subreaper/verify-empty. Chỉ bot tin cậy, never public student code.
  `cpuRemainingMs:30000` trong trusted request là dự kiến, KHÔNG phải measurement.
  Không giả mạo Linux sandbox pass hoặc sửa worker MVP để chạy Campus.
- NOT RUN: Linux sandbox/preflight/host pin/benchmark, DB concurrent workers/lease/stale event fencing,
  GitHub consumer/fetch/cache/GC, Preview deployment, offline bundles/restore/load. Browser không chạy lại
  checkpoint này vì không sửa frontend; bằng chứng browser K2 phía dưới chỉ áp dụng UI cũ.
- **Cần Huy cung cấp trước tích hợp K3/K2 persistence:** schema/RPC/DTO thật và reviewed cho repository
  numeric ID + pinned commit receipt + cutoff, validation job claim/heartbeat/retry/token,
  immutable round snapshot, accepted-attempt writes (result/event/log/terminal), publication ACL.
  Báo cáo Huy/Bảo vẫn NOT STARTED khi kiểm tra; không bịa RPC để gọi DB thật.
- **Không phải blocker từ Huy/Bảo:** Linux sandbox production vẫn là công việc Khoa chưa thực hiện.
  Cần host/VM sạch không secret, pin runtime/nsjail/seccomp/budget, thử fault suite và quyền vận hành
  được duyệt trước khi code/exercise isolation. WSL trên máy cá nhân không mặc nhiên là VM thi an toàn.
  GitHub bounded fetch/hash/cache helper độc lập cũng chưa làm trong milestone runtime này.
- Điểm dừng theo quy tắc một milestone: runtime trusted foundation đã demo E2E local;
  Start vẫn chặn, không apply SQL/deploy/push. Bước độc lập kế tiếp có thể làm: bounded GitHub
  blob fetch/hash helper (mock API), cache pin/GC thuần; không cần đợi Huy để viết test helper,
  nhưng consumer/RPC chỉ nối sau contract review. Không gọi mọi phần chưa làm là chờ người khác.
- SHA checkpoint: tra `git log -- docs/handoff/Khoa.md`.

### Checkpoint K2 trước đó

- Checkpoint 24/10/2026 tiếp theo: **K2 pure foundation — READY FOR REVIEW**, chưa persistence/E2E.
  Baseline `dev @ ddc20f3`; người dùng cho phép deploy/browser, nhưng chưa deploy vì thiếu runtime/privacy
  và chưa xác định project Vercel. Không apply SQL remote. K3/K4 vẫn BLOCKED bởi contract/runtime gate.
- Thêm `server/lib/officialBracket.js`, `server/contracts/officialSnapshot.js`,
  `tests/officialBracket.test.js`; không sửa router/UI/worker/migration/package.
- K2 exports: `compareOfficialFractions`, `seedOfficialQualifiers`, `seedOfficialTicketHolders`,
  `createOfficialBracket`, `createOfficialKnockoutSeries`, `resolveOfficialKnockoutSeries`,
  `officialBracketEntrants`, `allocateOfficialTickets`, `rankOfficialKnockout`.
- `campus-bracket.v1`: seed tỷ lệ bằng cross-product BigInt chính xác; nhất bảng trước nhì;
  permutation lower-half tối thiểu tổng lệch rồi numeric lexicographic, fixed winner/loser edges,
  không reseed. Single-group Top 4 không thể tránh tái đấu cùng bảng.
- Main 4/final 6, đổi màu từng block và luân phiên màu đầu; extra plan đúng 2 ván reserve,
  chỉ trả `nextGames` extra khi main hoàn tất và hòa; không dừng sớm. Bye/walkover/double absence
  không tạo ván hay game points giả; double-DQ truyền null xuống nhánh.
- Ranking tranh nhất/tranh ba rồi losers vòng trước theo seed; administrative non-finishers trả
  `unranked`, `complete:false`, cần quyết định trọng tài, không tự gán rank cho người bị DQ/rút.
  Ticket allocator nhận ranking đã duyệt, loại holder/rút, không duplicate, trả reserves/vacant.
- Ticket seeding giữ thành tích thực tế tốt nhất của đội (rank thật của vé chuyển), không giả á quân.
- `createOfficialRoundSnapshot`, `verifyOfficialRoundSnapshot`: `campus-round-snapshot.v1`, canonical
  contentHash, deep freeze; pin event/round/cutoff/seed, primary/reserve map + hash, packVersion,
  runtimeVersion/runtimeHash/budgetHash, rules `ott-campus.v1`, protocol `bot.v1`, bot source hash,
  artifact/submission, GitHub repo numeric ID/commit SHA/resolvedAt trước cutoff. Không đọc latest.
- Contract K2 là nội bộ/chờ Huy/Bảo review, không API/RPC mới. Snapshot hash không chứng minh runtime
  đã được cài/benchmark; provenance do caller tin cậy cung cấp, chưa receipt validation transaction.
  Persist snapshot/write-once, map pack công bố/slot assignment, bracket/seed locking và accepted-attempt
  fencing còn phải tích hợp với Huy; không gọi K2 end-to-end đã hoàn tất.
- Tests 24/10 Windows Node v24.18.0: baseline install/test/build exit 0 (102 tests); K2 riêng
  21/21 pass; full `npm.cmd test` 123/123 pass, 0 fail/skip, exit 0; build exit 0; diff check exit 0.
  Logs `data/khoa-k1/k2-tests.log`, `k2-final-{0,1,2,3}.log`, `k2-final.json` (gitignored).
  Lượt đầu bắt được validation group size max 7 sai tại 15/31 đội (bảng 8); đã sửa max 8 và chạy lại.
- Browser: Edge headed local production build, API 503 fixture, không login/DB remote;
  script `data/khoa-k1/browser-k2.mjs`, report/screenshots `data/khoa-k2-ui/`.
  Kết quả cuối PASS: login dark/light, 81 ô, xếp quân hai bên và đi hợp lệ khi chặn mạng,
  desktop 1366×900/mobile 390×844 không tràn ngang, 0 runtime exception. Đã đọc ảnh
  `login-light.png`, `offline-light.png`, `offline-mobile.png` để kiểm trực quan.
  Screenshot không phải nghiệm thu UI bracket (chưa nối UI).
  Script QA cũ dùng `.tt-login__snapshot`, `.tt-turn`, `.square--valid-target` đã lỗi thời;
  đã đổi script tạm sang selector đúng UI kit, không sửa production UI.
- Remote inspection chỉ list Supabase project `OTTv2-G5`, không query/write/migrate.
  Không có Vercel CLI/project link local. WSL Ubuntu có tên trong danh sách nhưng sandbox/preflight
  Linux **NOT RUN**. DB integration/worker E2E/load/offline/restore/Preview **NOT RUN**.
- Bước tiếp: Huy review snapshot/job/receipt/claim/finish DTO và schema trước K3; gate Start vẫn tắt.
  Không dùng quyền deploy để bỏ qua privacy/runtime/sandbox. Muốn deploy preview cần project đích,
  schema test tương thích và cấu hình credential qua cơ chế riêng, không dán secret vào chat.
- SHA checkpoint mới: tra `git log -- docs/handoff/Khoa.md`; không push.

### Checkpoint K1 trước đó

- Ngày 24/10/2026, Khoa, **K1 — READY FOR REVIEW** (hàm thuần, không phải runtime chính thức).
- Branch `dev`, baseline code `bb9cb4e9124a4e513505f7a03ce468eee7bbccee`, checkout sạch trước khi làm.
- SHA commit K1/báo cáo: tra bằng `git log -- docs/handoff/Khoa.md`; chưa tạo PR/push/merge/deploy.
- Chỉ hoàn thành phạm vi K1 trong [phân công Khoa](../assignments/Khoa.md); K2–K4 chưa làm.
- Gate `official_scheduler_not_ready` giữ nguyên ở API/SQL; không enqueue hoặc nối worker MVP.

## Kết quả và bằng chứng

### Code và contract nội bộ đã triển khai

- `server/lib/officialGroups.js`: `OFFICIAL_GROUPS_VERSION = campus-groups.v1`,
  `OFFICIAL_GROUP_TIE_BREAKERS`, `createOfficialGroupSchedule`, `computeOfficialGroupStandings`.
- Tái sử dụng `drawCompetition` từ `src/game/competition.js` (chia bảng cân bằng, canonical roster)
  và `deriveSeed` hiện có; không sửa game phòng, replay/runner MVP hoặc profile 200 plies.
- Lịch vòng tròn 2 ván/cặp đổi màu; cùng seed cặp, mapHash và mapPackVersion cả hai ván.
  35/40/48/50 đội lần lượt 60/80/120/132 cặp, 120/160/240/264 ván.
- ID cặp/ván là slot **trong giải**, không phải UUID toàn cục. Khi persistence phải scope thêm
  event/round/snapshot; không dùng ID này một mình làm khóa DB giữa nhiều giải.
- Input lịch: `{ participantIds: string[], seed: uint32, mapHash: hex64, mapPackVersion: string }`.
  Map hash do caller cung cấp; K1 kiểm cú pháp, KHÔNG chứng nhận pack đã công bố/hash đúng nội dung.
  Một map chính áp dụng toàn lịch K1; phân map nhiều slot và manifest bất biến thuộc K2.
- Output lịch: `{ schemaVersion, seed, mapHash, mapPackVersion, groups, drawOrder, series, games }`.
  Ví dụ game: `{ id: 'group:A:1-2:1', seriesId: 'group:A:1-2', groupName: 'A', gameNo: 1,
  redParticipantId: 'team-01', blueParticipantId: 'team-02', seed: 123,
  mapHash: '<hex64 của map>', mapPackVersion: 'week-1' }` (seed minh họa).
- Input standings thêm `results: [{ gameId, result: 'red_win'|'blue_win'|'draw' }]`;
  chỉ đưa terminal record từ accepted attempt. Thiếu ván là pending, không suy ra bot thua.
  Record lạ/trùng/sai result hoặc seed/roster/map identity sai ném `Error`, không HTTP/RPC mới.
- Điểm ván 1/0.5/0; chỉ cặp đủ hai ván mới cộng điểm cặp 3/1/0. Bảng tạm có thể có điểm ván
  của cặp chưa đủ nhưng `seriesPlayed` chưa tăng; không dùng bảng tạm cấp vé.
- Standings trả `{ schemaVersion, seed, complete, games: {total,finished}, series: {total,finished},
  tieBreakers, tieDrawOrder, groups: [{name,complete,rows}] }`.
  Row có `participantId, rank, seriesPlayed/Won/Drawn/Lost` (các field đầy đủ là
  `seriesPlayed`, `seriesWon`, `seriesDrawn`, `seriesLost`), `seriesPoints`,
  `gamesPlayed/gamesWon/gamesDrawn/gamesLost`, `gamePoints`, `miniSeriesPoints`,
  `miniGamePoints`, `drawRank`, `tieParticipantIds`.
- Tie đúng thứ tự: điểm cặp → điểm cặp mini-table → tổng điểm ván → điểm ván mini-table
  → drawRank tăng dần. Nhóm mini-table được tạo đúng một lần từ seriesPoints ban đầu.
  `tieDrawOrder` là bốc thăm riêng bằng seed dẫn xuất, lưu trong DTO để kiểm tra/tái lập.
- DTO này là contract **nội bộ đã có code, chờ Huy/Bảo review**, chưa phải schema/API nhóm đã duyệt.
  Không trả thẳng standings kín qua endpoint team; Huy phải áp dụng publication/ACL trước tích hợp.
- Không migration/env/dependency mới. Không apply migration nào (kể cả setup migration có trước).
  Snapshot/runtime/protocol/budget không thêm version mới; worker/RPC/lease/fencing không sửa.

### Kiểm chứng ngày 24/10/2026

Windows, Node v24.18.0, Node built-in runner; K1 không DB/mạng/Python.
Do shell integration không thu exit ổn định, chạy bằng child process, lưu `spawnSync.status`
và log tại `data/khoa-k1/` (gitignored, không secret).

| Lệnh | Exit | Kết quả / log |
|---|---|---|
| `npm.cmd install` baseline | 0 | `baseline-0.log`; 2 high vulnerabilities + cảnh báo esbuild allow-scripts, không audit fix |
| `npm.cmd test` baseline | 0 | 91/91 pass; `baseline-1.log` |
| `npm.cmd run build` baseline | 0 | `baseline-2.log` |
| `node --test tests/officialGroups.test.js` cuối | 0 | 11/11 pass, 0 fail/skip; `final-0.log` |
| `npm.cmd test` cuối | 0 | 102/102 pass, 0 fail/skip; `final-1.log` |
| `npm.cmd run build` cuối | 0 | `final-2.log` |
| `git diff --check` | 0 | `final-3.log` |

`tests/officialGroups.test.js` phủ counts, ngưỡng 4/7/8/15/16/31/32/56, trùng/thiếu màu,
map/seed cặp, đảo thứ tự roster/results, seed 0, không mutation, không ambient Math.random,
điểm ván/cặp, partial pair, head-to-head, chu trình tie ba đội và seeded draw.
Lượt đầu 10/11 pass: fixture tie ba đội sai kỳ vọng; đã sửa fixture và chạy lại toàn bộ thành công.

## Blocker / NOT RUN / bước tiếp (cập nhật 24/10/2026)

**Đã có bằng chứng mock/unit:** K1 thuần, K2 helper bracket, K3a–K3e (download/cache/pinned GitHub/
consumer/Storage adapter), worker Campus trusted-dev. Không có nghĩa giải đã chạy được end-to-end.

**Gate còn lại, theo thứ tự phụ thuộc (chưa mục nào VERIFIED trên hạ tầng thật):**

1. **H4 PostgreSQL thật** — chạy `supabase/tests/github_intake.sql` trên project disposable được phép:
   2 worker tranh job, lease hết hạn/crash/reclaim cap, duplicate finish, revoke repo, cutoff race,
   RLS + service_role. Bằng chứng cần: log, row count trước/sau, danh sách migration đã apply.
   Owner Huy (DB); Khoa kiểm lại consumer sau khi có kết quả.
2. **Storage + GitHub thật** — bucket private, quyền service_role, upload/readback SHA-256, quota/
   rate limit, inventory orphan. Adapter K3e mới chỉ mock.
3. **Sandbox Linux (K4)** — K4a đã dựng WSL2 riêng + runner bwrap/cgroup, 11/11 selftest
   (FS/network/env, fork, memory, CPU/timeout, flood, cleanup). Còn: nối Node worker, seccomp/
   attestation, budget theo request, VM Linux sạch. Chưa mở nhận bot lạ.
4. **K2 persistence + scheduler/màu** — K2p đã có migration/RPC/client + mock. Còn: Huy review/apply
   trên disposable, test 2-writer/crash/RLS, API admin + UI công bố màu, persist series knockout,
   nối accepted result. Giữ trigger `official_scheduler_not_ready` và Start khóa.
5. **H3 browser/privacy pass** — 401/403, `afterSeq`/clock client, replay/log ẩn; hiện chỉ mock.
6. **Offline chung kết** — K6a đã có manifest/CLI build-verify + diễn tập filesystem không mạng.
   Còn: xuất từ giải thật (snapshot + source), bundle 56 đội, ký manifest, restore VM sạch,
   nhập kết quả/replay sau chấm, diễn tập có BTC.
7. **B4 load** — số đo in-process, nhạy cảm CPU; cần benchmark trên hạ tầng triển khai thật.
8. **Cổng đang tắt** — `storeVerifiedSource`/consumer chưa nối worker, `enabled:false`, upload online
   tắt mặc định, Start khóa, chưa deploy/apply remote.

- Tái hiện: `node --test tests/artifactDownload.test.js tests/githubConsumer.test.js`,
  `node --test "tests/*.test.js"`, `node node_modules/vite/bin/vite.js build`.
- Rollback: bỏ import `artifactUpload`/`githubConsumer` (chưa có đường gọi runtime), không migration/
  env mới; không cần rollback DB.
- **Bước nhỏ kế tiếp:** chọn một — (a) inventory/quarantine artifact Storage để GC sau đối soát
  (không xóa mù), hoặc (b) validation adapter sau khi có sandbox. Không bật polling trước H4 + sandbox.

## Lịch sử checkpoint

- 23/10/2026: tạo khung bàn giao, chưa thực hiện thay người được giao.
- 24/10/2026: K1 thuần READY FOR REVIEW; test/build local pass, integration/runtime chưa nghiệm thu.
- 24/10/2026: K3e Storage adapter + test tích hợp; full 282/282 pass, vẫn tắt consumer/Start.
- 24/10/2026: K6a gói offline tự chứa + CLI; full 287/287 pass, chưa xuất từ giải thật.
- 24/10/2026: K2p schedule persistence (migration/RPC/client/mock); PostgreSQL thật NOT RUN.
- 24/10/2026: K4a sandbox WSL (bwrap + cgroup) 11/11 dev acceptance; chưa nối worker/seccomp.