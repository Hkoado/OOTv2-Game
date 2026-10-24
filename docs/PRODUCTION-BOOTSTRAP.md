# Bootstrap DB và Hyper-V — checkpoint 24/10/2026

## Trạng thái thật, không phải nghiệm thu toàn hệ thống

- `.env` đang trỏ project `ftzockzolisecnyhlwej`, khác project thử nghiệm cũ.
- Trước thay đổi: schema `public` không có bảng, migration history rỗng.
- Đã áp dụng **chỉ Campus foundation**, Management API gán version
  `20261024070659`; source tương ứng `20261022122359_campus_foundation.sql`.
  Đã đọc lại 13 bảng và tất cả đều bật RLS. Không import tài khoản/dữ liệu thử.
- Đã tạo/đọc lại bucket `ootv2-bots`: **private**, tối đa 262144 bytes,
  MIME `application/octet-stream`. Chưa kiểm upload/download qua bot flow.
- **13 migration còn lại chưa áp dụng**; `mvp_*` và capture chưa được chuẩn bị
  trên project này. Không triển khai web mới hoặc chạy worker vào DB này lúc này.
- `.env` chưa có PAT/DB URL. Kết nối Supabase của agent có thể apply migration,
  nhưng CLI trên máy không tự kế thừa credential đó.
- Chưa tạo VM, chưa boot/SSH, chưa chạy guest install hoặc sandbox acceptance.
- Không nối official worker, không mở Start, không commit/push/deploy Vercel.

## Công cụ DB

Trong `D:\OOTv2-Game`:

```powershell
npm run db:production -- --bundle
```

Sinh `D:\OOTv2-Game\data\production\fresh-database.sql` và `manifest.json`:
14 file migration theo thứ tự + SHA-256, không chứa secret. Bundle **chỉ dành cho
project hoàn toàn rỗng**, chạy trong một transaction và dừng nếu đã có bảng.
**Không chạy bundle này trên project hiện tại đã có foundation.** Tiếp tục project
hiện tại phải đối chiếu object/history rồi apply từng file còn thiếu, không reset.

`--apply --confirm-project=<ref>` cần `SUPABASE_ACCESS_TOKEN`, cũng chỉ hỗ trợ
bootstrap đích rỗng. Ledger checksum của bundle là `ootv2_schema_migrations`,
không giả làm migration history của Supabase. Management API tự gán timestamp;
đối chiếu source theo tên/nội dung thay vì giả định timestamp sẽ giữ nguyên.

## Bộ dựng VM (đã có code, chưa chạy end-to-end)

Đường dẫn script: `D:\OOTv2-Game\tools\vm\New-JudgeVM.ps1`.

- PowerShell Administrator, Hyper-V đã bật; cần `ssh`, `scp`, `tar` trên Windows.
- Distro WSL dùng **chỉ chuẩn bị image**, cần `qemu-utils`, `cloud-image-utils`,
  `curl`, Python 3. WSL không phải nơi chạy judge production.
- Ubuntu cloud image tải HTTPS, đối chiếu SHA-256 từ cùng nhà phát hành;
  chưa có xác minh chữ ký GPG/pin khóa nhà phát hành. Không gọi đây là supply-chain
  attestation. Node 22 cũng kiểm checksum HTTPS, bản patch được chọn lúc cài.
- Mặc định VM Gen 2 / 4 vCPU / 4 GiB / VHDX động 40 GiB / Default Switch.
  Không ghi đè VM tồn tại, không thay switch, không mở port public.
- `prepare-image.sh` không ghi đè VHDX cũ. Nếu chuẩn bị bị gián đoạn, cần kiểm tra
  artifact trước khi retry; không tự xóa đĩa để "sửa" lỗi.

```powershell
& 'D:\OOTv2-Game\tools\vm\New-JudgeVM.ps1' -WslDistribution ootv2-sandbox
& 'D:\OOTv2-Game\tools\vm\Get-JudgeStatus.ps1'
```

Đợi cloud-init hoàn tất trong console. Kiểm tra SSH host fingerprint trực tiếp
trong console (`ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`), đối chiếu
với key thu được qua `ssh-keyscan`, rồi lưu vào `D:\OOTv2-VM\known_hosts`.
Không tắt StrictHostKeyChecking hoặc coi ssh-keyscan riêng lẻ là xác minh.

```powershell
& 'D:\OOTv2-Game\tools\vm\Install-Judge.ps1' -Address '<IP-trong-Default-Switch>'
```

Install chuyển archive allowlist (không Git history/data/.env/node_modules), chuyển
riêng **chỉ** URL/service-role/GitHub token qua SSH đã xác minh. Không chuyển PAT,
DB password hay `VITE_*`. Guest root sở hữu code/config; credential mode 0600.
Bootstrap cài runtime, chạy full attestation, timer 12 giờ và DB auth smoke.
**Không cài/bật service legacy worker hay official worker chưa hoàn tất.**
DB smoke tạm tạo admin rồi cleanup; chỉ chạy khi schema runtime đã đầy đủ.

Vận hành đã có: status VM và `journalctl -u ootv2-attest.service`,
`systemctl status ootv2-attest.timer` trên guest. Worker startup/recovery/update
atomic/rollback vẫn chưa triển khai. Install hiện là cập nhật tại chỗ, không phải
release transaction; nếu lỗi không tự restart worker.

## Gate tiếp theo

Kiểm thử checkpoint: **342/342 Node tests pass**, 0 skip; Vite build exit 0;
4 regression tests mới pass; PowerShell parser và `bash -n` cho cả hai shell
script pass; `git diff --check` không có lỗi. Script shell mới đã chuẩn hóa LF
sau khi syntax check lần đầu phát hiện line-ending/heredoc lỗi trên Windows.
Evidence local ở `D:\OOTv2-Game\data\production-*.{log,exit}`.
Syntax/static tests không chứng minh cloud image boot, systemd hay sandbox thật.

1. Apply và kiểm chứng 13 migration còn lại + Storage private + rollback smoke thật.
2. Official claim/heartbeat/token fence + Campus runner + replay persistence, phân
   biệt infra retry/bot fault; không tái sử dụng entrypoint MVP để nhận bot lạ.
3. Dựng VM, chốt SSH identity, full sandbox tests và chạy rehearsal DB thật.
4. Kiểm web/API routing/auth/publication trên Vercel; người dùng tự deploy.
5. Khắc phục audit high ở multer, secret/history/license review; giữ Start khóa.