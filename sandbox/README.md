# Sandbox Linux (dev acceptance)

- `linux/run-bot.sh` — runner bwrap + cgroup v2 cho một bot stdin/stdout.
- `linux/preflight.sh` — kiểm kernel, cgroup, bwrap, Python.
- `linux/selftest.sh` — 11 kiểm tra cách ly bằng fixture tin cậy.
- `fixtures/` — bot lành tính và fixture phá hoại **chỉ để test**, không phải code sinh viên.

Đọc [hướng dẫn và bằng chứng](../docs/SANDBOX-WSL.md). Đây **không phải** sandbox production:
chưa seccomp/attestation, chưa nối worker, chưa dùng cho code không tin cậy.
