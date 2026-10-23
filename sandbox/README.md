# Sandbox Linux (dev acceptance)

- `linux/run-bot.sh` — runner bwrap + cgroup v2 + seccomp deny-list cho một bot stdin/stdout.
- `linux/seccomp-profile.py` — sinh BPF deny-list (cần `python3-seccomp`) cho `bwrap --seccomp`.
- `linux/preflight.sh` — kiểm kernel, cgroup, bwrap, Python, libseccomp; sinh + hash profile.
- `linux/selftest.sh` — 14 kiểm tra cách ly bằng fixture tin cậy.
- `linux/attest.sh` — receipt JSON 24 h (kernel, hash profile, probe seccomp, selftest).
- `fixtures/` — bot lành tính và fixture phá hoại **chỉ để test**, không phải code sinh viên.

Đọc [hướng dẫn dev + bằng chứng](../docs/SANDBOX-WSL.md) và
[kế hoạch production/ngân sách](../docs/SANDBOX-PRODUCTION.md). Đây **không phải** sandbox
production: seccomp là deny-list, chưa attestation trên VM thật, chưa dùng cho code không tin cậy.

Cài trên Ubuntu 24.04: `apt-get install -y bubblewrap python3-seccomp`.
