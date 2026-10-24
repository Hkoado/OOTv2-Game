# Khoa — hoàn thiện runtime manual và bộ cài, 24/10/2026

## Quyết định người dùng trong phiên này

- Huy tiếp tục E2E online repo → cutoff → round → knockout → publication và tổng hợp gate RC.
- Khoa tự hoàn thiện runtime/provisioning, không chờ Huy/Bảo viết heartbeat manual.
- Bot lỗi ngay setup: lưu accepted win/loss và replay 0-ply do engine xác định.
  Lỗi hạ tầng vẫn không được forfeit.
- Dùng Hyper-V trên máy Windows này. Phiên hiện tại không elevated; `Get-VM` bị từ chối.
  Không tự nâng quyền, tạo VM hay chuyển credential trong phiên này.
- Người dùng chốt **project trong `.env`**, chỉ kiểm readiness; không copy schema từ G5,
  không tự apply migration hay claim job remote.

## Schema/code deployment order

Migration mới `20261026130000_manual_worker_heartbeat.sql` (đổi tên từ `20261026120000_…` vì trùng version
với `ko_round_roster_guard`; file chưa từng apply remote nên đổi tên an toàn). **Huy đã apply trên DB thật
`ftzockzolisecnyhlwej` ngày 24/10** (prosrc `claim`/`finish`/`release` đã vá, RPC heartbeat chỉ service_role).
Apply theo migration history, trước consumer mới. Không sửa migration manual gốc.
RPC heartbeat `mvp_manual_final_heartbeat(uuid,uuid,integer,integer)` chỉ service_role,
kiểm running/token/generation/expiry; false `lease_lost` không hồi sinh lease hết hạn.
Finish/release từ chối lease hết hạn; claim kết thúc infra_fault khi hết attempts.
Finish duplicate terminal vẫn idempotent; không tạo accepted result thứ hai.
SQL replacement có prerequisite guards để không âm thầm áp lên definition khác.
**Static contract tests không thay PostgreSQL rehearsal.**

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

Readiness `.env` đã kiểm chỉ đọc: credential cấu hình được và bucket private/262144 bytes
đạt, nhưng bảng intake/manual và claim/heartbeat RPC trả 404/PGRST202. Do đó chưa thể
start judge trên project này. Không apply hay copy schema. Cần operator duyệt migration
history cho đúng project trước khi chạy worker thật.

## Gate còn phải nghiệm thu (không coi NOT RUN là PASS)

1. PostgreSQL rehearsal migration mới: heartbeat live/stale/expired, attempt cap, 0-ply,
   grants, concurrent claim/finish và duplicate finish.
2. Hyper-V install/start/stop/reboot; full sandbox attestation; expiration; update hỏng/rollback.
3. Hai process chấm job thật, kill giữa ván, phục hồi sau DB/Storage failure, artifact cleanup.
4. Worker capacity, backup/restore bằng chứng thực; browser role/privacy và E2E tích hợp.

Các bước local capture: `node tools/cli/khoa-local-check.js`, evidence ở
`data/khoa-current/results.json` cùng log từng lệnh, không commit log nhạy cảm.

Ghi chú validation: lượt full mặc định song song có một lần fail gate viewer P95
(overview 904.9 ms vượt 800 ms), không lỗi heartbeat. Không sửa/nới assertion.
Chạy lại full với `--test-concurrency=1` để đo không tranh tài nguyên giữa file test;
không coi kết quả này là benchmark production hoặc xóa dấu vết lượt fail.