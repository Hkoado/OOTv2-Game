# Gate chấm bot không tin cậy — 25/10/2026

**BLOCKED: chưa mở nhận/chấm code không tin cậy.** Đã chạy fixture source mới trên VM
trong thư mục test cách ly; chưa deploy service/apply remote và không đổi execution gate.

## Kế hoạch và điều kiện đạt

| Thứ tự | Công việc | Trạng thái |
| --- | --- | --- |
| 1 | Production cấm trusted-dev/WSL override/seccomp off; chặn direct legacy runner/worker; tách env | Đã sửa local, có regression |
| 2 | Full selftest bắt buộc, receipt <=24h, không ở tương lai; kiểm trước mỗi session; root ownership/mode và hash runner/generator/BPF | PASS fixture VM thư mục test, chưa service deploy |
| 3 | Atomic receipt; swap limit fail-closed; cleanup cgroup.kill; truyền RAM/PIDs đã pin xuống adapter | PASS fixture VM; sửa watchdog giữ pipe, rerun PASS |
| 4 | Chốt threat model deny-list hiện tại; production public cần allowlist hoặc cô lập mạnh hơn theo SANDBOX-PRODUCTION | Chưa đóng; không tuyên bố deny-list đủ an toàn |
| 5 | Fixture FS/network/env/syscalls/CPU/RAM/PIDs/output/timeout/cleanup với đúng release | Full attestation + 8/8 gate VM PASS trên source test; service vẫn release cũ |
| 6 | Hai worker, expired lease, duplicate finish, kill giữa trận, DB/Storage mất kết nối, reboot, update lỗi/rollback | NOT RUN trên VM cho release mới |
| 7 | Backup DB+Storage/artifact và restore project disposable; RC signatures | NOT RUN / chờ evidence owner |

VM hiện hữu đã được đọc qua SSH strict: service official active trên release
`20261024T162131Z-fc5c364044fc`; receipt full `RESULT pass=14 fail=0` là evidence
release cũ, không phải nghiệm thu patch này. Không thay đổi VM/service trong đợt hardening.

### Gate chính bổ sung 25/10

`tools/provision/test-main-gates.sh --fixtures-only` chạy full attestation và
`tools/cli/sandbox-main-gates.js` trong private mount namespace, tmpfs `/run`,
env sạch, cgroup riêng. Source test tại `/srv/ootv2-test/main-gates-a137f63`.
Evidence `data/khoa-main-gates/vm-final.log`: **8/8 PASS**, gồm concurrent sessions,
exact RAM/PIDs/swap, sealed setup/replay, abort/recover và bounded output/cleanup.
Không dùng DB/queue; **không** thay thế 2-consumer PostgreSQL, OS reboot/rollback/restore.
Edge/operational rehearsal được hoãn có ghi nhận, không chuyển thành PASS hoặc mở bot lạ.

## Thực hiện rehearsal khi có quyền cập nhật release

1. Drain worker và cách ly queue test khỏi giải thật. Không dùng bot của bên thứ ba làm fixture.
2. Cài đúng RC bằng bộ cài, giữ release rollback; kiểm kernel/Node/Python/bwrap/libseccomp và SSH.
3. Full attestation, đọc artifact hashes; tamper/expiry phải chặn trước spawn. Khôi phục file từ release,
   không chỉnh receipt bằng tay để tạo PASS.
4. Chạy fixtures acceptance, kiểm không đọc secret/host files/ra mạng, giới hạn tài nguyên và không sót
   process/cgroup sau lỗi. Kiểm swap disabled thực và metrics RAM/PIDs/CPU đúng budget đã pin.
5. Drill queue bằng job test được pin: hai consumer, lease reclaim/stale finish, duplicate finish,
   kill/restart/reboot, mất DB/Storage. Không kết quả tính đôi, không infra-forfeit, retry cùng input.
6. Update hỏng và rollback có attestation lại; backup/restore theo runbook. Lưu command, exit code,
   release/hash, môi trường và log đã loại secret. Không PASS khi chỉ quan sát service active.

## Giới hạn

- Namespace/seccomp deny-list không chống kernel vulnerabilities hoặc mọi side-channel.
- Worker supervisor hiện cần root trên VM chuyên dụng; không chạy cạnh API hay dữ liệu cá nhân.
- Intake GitHub hiện kiểm text + AST syntax, không execute bot; `valid` không phải sandbox acceptance.
- Runtime chuyển `campus-runtime.v2`; không sửa snapshot/hash lịch sử và không fallback MVP.
- Health API chỉ DB readiness; chưa có attestation end-to-end từ API tới từng worker đang chấm.