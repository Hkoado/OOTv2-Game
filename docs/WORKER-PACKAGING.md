# Đóng gói worker cho máy Windows khác

Máy Windows khác pull repo này về có thể tự dựng VM chấm và chạy worker bằng một
bộ script. Tài liệu này nói rõ phần nào chạy được hôm nay và phần nào **chưa** có.

## 1. Phạm vi thật của gói worker

| Thành phần | Trạng thái |
| --- | --- |
| Worker GitHub intake (`server/githubWorker.js`) | **Có**, chạy dài hạn, chấm dứt êm |
| Kiểm tra tĩnh + cú pháp Python, upload Storage private | **Có** (không chạy bot) |
| Release swap có rollback, systemd, health gate | **Có code**, chưa chạy trên VM thật |
| Chấm trận Campus/Firewall sandbox qua worker | **Chưa có** worker loop + claim/lease cho `mvp_official_games` |
| Service `ootv2-official-worker` | **Không tồn tại** — không được tạo cho đủ bộ |

Gói này **không** biến worker intake thành trọng tài. Nó chỉ chốt source đội
(GitHub → SHA → Storage) để BTC mở vòng. Chấm trận là milestone riêng.

`server/worker.js` (MVP) **không** được cài, không được enable, không phải fallback.

## 2. Yêu cầu trên máy Windows mới

- Windows Pro/Enterprise có Hyper-V (Home không hỗ trợ Hyper-V).
- Phiên PowerShell **Administrator**.
- Node.js 22+ trên máy host (để chạy script điều phối và kiểm tra cấu hình).
- OpenSSH Client (`ssh`, `scp`, `ssh-keygen`) và `tar` (có sẵn trong Windows 10+).
- Một distro WSL để **chuẩn bị image**: `qemu-utils`, `cloud-image-utils`, `curl`.
  WSL chỉ dùng lúc tạo image; judge chạy trong Hyper-V guest.
- ≥ 45 GiB trống cho ổ chứa VM.

## 3. Cài trên máy mới

```powershell
git clone <repo> D:\OOTv2-Game
cd D:\OOTv2-Game
Copy-Item tools\vm\worker.config.example.json tools\vm\worker.local.json
notepad tools\vm\worker.local.json      # sửa đường dẫn/CPU/RAM/tên VM nếu cần
Copy-Item .env.example .env             # rồi điền SUPABASE_URL + SERVICE_ROLE_KEY
node tools\cli\worker-config.js tools\vm\worker.local.json
powershell -NoProfile -ExecutionPolicy Bypass -File tools\vm\Worker.ps1 -Action doctor
```

`doctor` kiểm tra: quyền admin, build Windows, Hyper-V, virtualization firmware,
CPU/RAM đủ cho cấu hình, `ssh/scp/tar/ssh-keygen/wsl`, phiên bản Node, distro WSL,
switch, dung lượng ổ, `.env` có credential. Mã thoát `1` nếu còn lỗi chặn.

### Tạo VM và xác minh SSH

```powershell
powershell -File tools\vm\Worker.ps1 -Action install
```

Lần đầu chưa có VM: script tạo VM Gen 2 (mặc định 4 vCPU / 4 GiB / 40 GiB),
rồi **dừng** và yêu cầu xác minh fingerprint. Đây là chủ ý: không có bước nào
tự bỏ qua host verification.

Trong console của VM:

```bash
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
```

So sánh với fingerprint thu được trên host, rồi lưu vào `known_hosts`:

```powershell
ssh-keyscan -t ed25519 <IP> | Add-Content D:\OOTv2-VM\known_hosts
```

`ssh-keyscan` chỉ là cách lấy dữ liệu; **giá trị phải khớp fingerprint đọc trong
console**. Nếu không khớp, đừng thêm.

Sau khi có `known_hosts`:

```powershell
powershell -File tools\vm\Worker.ps1 -Action install
```

## 4. Vận hành hàng ngày

```powershell
powershell -File tools\vm\Worker.ps1 -Action status
powershell -File tools\vm\Worker.ps1 -Action health
powershell -File tools\vm\Worker.ps1 -Action start
powershell -File tools\vm\Worker.ps1 -Action logs -Tail 200
powershell -File tools\vm\Worker.ps1 -Action stop
powershell -File tools\vm\Worker.ps1 -Action update
```

`start` chạy `worker-health` trước; thiếu bảng/RPC/bucket thì **từ chối** khởi
động và in lý do, thay vì để systemd restart vô hạn.

Trên guest có thể dùng trực tiếp:

```bash
sudo /srv/ootv2/current/tools/provision/workerctl.sh status|health|version|start|stop|restart|logs
```

## 5. Cấu trúc trên guest

```
/srv/ootv2/releases/<utc>-<rand>/    # release bất biến, root:root
/srv/ootv2/current -> releases/...   # symlink đổi bằng mv -T
/etc/ootv2/worker.env                # 0600, chỉ 3 biến allowlist
/var/lib/ootv2/                      # cache artifact, owner ootv2-worker
/opt/ootv2-node/                     # Node 22 từ tar chính thức, kiểm SHA-256
```

`update` deploy release mới rồi `systemctl restart`. Nếu service không lên,
`deploy-release.sh` trả symlink về release trước và restart lại. Giữ 3 release.

Credential: chỉ `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OOTV2_GITHUB_TOKEN`
được chuyển sang guest. `SUPABASE_ACCESS_TOKEN` (PAT), `SUPABASE_DB_URL`, `VITE_*`
**không** được gửi. Máy nhận service-role key phải là máy BTC tin cậy.

## 6. Nhiều máy chấm

Có thể cài trên nhiều máy; mỗi máy tạo `workerId` riêng. Chống chấm trùng dựa vào
lease/token/generation trong DB (`mvp_github_claim`), không dựa vào việc chỉ có
một máy. Hai worker tranh cùng job đã có test ở tầng DB/drill; **chưa chạy thử hai
máy Windows thật**. Chỉ tuyên bố hỗ trợ nhiều máy sau khi drill đó chạy.

## 7. Bằng chứng đã chạy (24/10/2026)

| Kiểm tra | Kết quả |
| --- | --- |
| `Worker.ps1 -Action config` | PASS — in JSON đã chuẩn hóa, không có secret |
| `Worker.ps1 -Action doctor` | PASS, exit 0 trên máy dev (PASS 12 mục, WARN vm/ssh-key/known-hosts) |
| `node server/githubWorker.js --once` | exit 1, một dòng log `shared_db_error`, không treo, không fallback |
| `node tools/cli/worker-health.js` | BLOCKED: Storage PASS, 3 bảng + RPC 404 (schema runtime chưa áp) |
| `node --test tests/*.test.js` | PASS toàn bộ, 0 skip |
| PowerShell parser cho `tools/vm/*.ps1` | PASS |
| `bash -n` + chạy guard cho `tools/provision/*.sh` | PASS (`staging_missing`, `wsl_is_not_a_judge_vm`) |
| `npm run build` | PASS |

Đã sửa hai lỗi thật trong quá trình kiểm thử: gán `$code = Invoke-Doctor`/`Invoke-Guest`
nuốt output ra console, và `VirtualizationFirmwareEnabled` trả rỗng khi hypervisor
đã chạy (dùng `HypervisorPresent`).

## 8. Chưa nghiệm thu

- Chưa boot guest, chưa chạy `install-judge.sh`, `deploy-release.sh` trên VM thật.
- Chưa kiểm systemd restart/rollback/attestation timer trong guest.
- Chưa có worker chấm trận; Start/`ootv2-official-worker` vẫn đóng.
- Chưa chạy hai máy Windows thật tranh cùng job.
- Chưa commit/push/deploy.

