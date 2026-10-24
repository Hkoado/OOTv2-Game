# Sổ Tay Vận Hành Dành Cho Ban Tổ Chức (OOTv2 Tournament Operator Runbook)

Tài liệu quy trình vận hành kỹ thuật dành cho Ban tổ chức (BTC), Trọng tài và Quản trị viên hệ thống Giải Đấu Cờ OOTv2 Campus.

---

## 1. Thiết lập giải đấu chính thức (Setup Panel)

Truy cập trang Cấu hình (`#/setup`) bằng tài khoản Quản trị viên (`admin`):

1. **Khung thời gian & Múi giờ**:
   - Nhập thời điểm bắt đầu giải và hạn chót nộp bài (`Cutoff`).
   - Giao diện hỗ trợ chuyển đổi 2 chiều: múi giờ địa phương (trình duyệt) và chuẩn UTC ISO string. Đảm bảo thông báo rõ giờ thi đấu theo giờ Việt Nam (UTC+7).
2. **Chia bảng đấu động A–H (35–50 đội)**:
   - Chọn thể thức chia từ 4 đến 8 bảng đấu (A đến H).
   - Kiểm tra thông báo cân bằng bảng (`formatGroupSummary`): nếu chênh lệch giữa bảng nhiều nhất và ít nhất lớn hơn 1 đội, hệ thống sẽ phát cảnh báo để BTC điều chỉnh số hạt giống.
3. **Cơ chế bảo vệ bản nháp (Dirty Draft Protection)**:
   - Trong khi BTC đang chỉnh sửa form, polling nền tự động tạm dừng để tránh ghi đè dữ liệu.
   - Nếu có quản trị viên khác vừa lưu thay đổi trên server, hệ thống sẽ bật cảnh báo xung đột phiên bản (`Version Conflict`). BTC bấm "Tải lại dữ liệu" sau khi xác nhận để đồng bộ.
4. **Chốt an toàn Execution Ready**:
   - Thuộc tính `executionReady` luôn giữ giá trị `false` trong giai đoạn thiết lập cho đến khi toàn bộ worker và sandbox được nghiệm thu sẵn sàng.

---

## 2. Quản lý & Phê duyệt Kho mã GitHub

1. Truy cập trang **Nộp bài** (`#/submissions`) bằng tài khoản Admin.
2. Chọn đội cần thao tác từ bộ lọc **Chọn đội thi đấu**.
3. **Tiêu chí duyệt**:
   - URL repository đúng định dạng HTTPS GitHub công khai (`https://github.com/owner/repo`).
   - Nhánh thi đấu chính xác (`main` hoặc `master`).
   - Mỗi repository chỉ được đại diện cho một đội duy nhất trong cùng một giải đấu.
4. **Phê duyệt**: Bấm nút **"Phê duyệt repository này"** để cấp quyền đồng bộ commit cho đội.
5. **Thu hồi phê duyệt (Admin Revoke)**:
   - Nếu phát hiện đội vi phạm quy chế hoặc đội yêu cầu đổi repository khác trước hạn cutoff, Admin bấm **"Thu hồi phê duyệt"**.
   - Hệ thống sẽ gọi lệnh hủy duyệt (`DELETE /api/local/events/:id/repository?team=...`), tự động hủy mọi job đang xếp hàng (`canceled`) và đóng băng thẻ biên nhận đang xử lý dở dang (`frozen: repository_revoked`). Bản bot hợp lệ trước đó vẫn được giữ nguyên an toàn.

---

## 3. Lên lịch phát sóng ván đấu (Broadcast Scheduling)

Hệ thống áp dụng nguyên tắc **Chấm trước — Lưu kín — Phát theo lịch** (H3 publication architecture):

1. **Thời điểm đặt lịch**: Chỉ những ván đấu đã chấm xong hoàn tất (`status === 'finished'`) mới được đặt lịch phát. Ván chưa chấm xong sẽ bị hệ thống từ chối (`409 match_not_graded`).
2. **Thao tác đặt lịch**:
   - Trên bảng ván đấu (`MatchTable`), tìm ván cần phát và bấm **"Đặt lịch"**.
   - Hộp thoại `BroadcastDialog` mở ra:
     - **Thời điểm bắt đầu phát (`starts_at`)**: Chọn ngày giờ bắt đầu chiếu trực tiếp.
     - **Nhịp phát (`ply_interval_ms`)**: Chọn từ $250\text{ ms}$ đến $60,000\text{ ms}$ (mặc định $2,000\text{ ms}$ / nước đi).
     - **Chế độ công bố (`release_mode`)**:
       - `full`: Sau khi phát hết toàn bộ nước đi, server sẽ tự động công bố kết quả chung cuộc, vinh danh đội thắng và mở link xem lại replay.
       - `window`: Sau khi chiếu hết, kết quả vẫn được bảo mật (dành cho các vòng đấu loại trực tiếp cần bảo mật điểm số đến lễ bế mạc).
3. **Hủy lịch phát**:
   - Nếu cần hoãn hoặc đổi giờ, BTC có thể bấm nút **"Hủy lịch"** trước thời điểm `starts_at`.
   - Nếu ván đấu đã bắt đầu phát sóng (`broadcasting`), hệ thống sẽ khóa nút hủy (`409 broadcast_started`) để bảo đảm tính toàn vẹn của luồng xem trực tiếp.

---

## 4. Quản lý Trang Trực Tiếp (Live Stream Page)

Trang `#/live` phục vụ các đội thi và khán giả có tài khoản trong giải:

- **Bảo mật thành viên (H3 Privacy)**: Chỉ tài khoản thành viên thuộc giải đấu mới được cấp quyền xem ván đấu (`assertEventMember`). Người xem ẩn danh hoặc xem chéo giải khác sẽ nhận thông báo yêu cầu đăng nhập (401) hoặc từ chối quyền truy cập (403).
- **Trạng thái Chờ (`waiting`)**: Hiển thị thẻ Countdown đếm ngược chính xác theo giờ server tới mốc giờ phát sóng.
- **Trạng thái Đang phát (`broadcasting`)**: Client nhận các nước đi gia tăng giới hạn bởi `visible_plies` từ máy chủ theo đúng nhịp đồng hồ, tuyệt đối không tải trước toàn bộ replay để bảo vệ nước đi tương lai.
- **Tiến độ**: Thanh tiến độ hiển thị trực quan tỷ lệ % số nước cờ đã chiếu trên tổng số nước cờ của ván đấu.

---

## 5. Kế hoạch ứng cứu & Khôi phục sự cố khẩn cấp (Incident Response)

### A. Mất kết nối Internet diện rộng tại phòng thi
- Tạm dừng điều hành/chấm, giữ nguyên snapshot/SHA và thông báo sự cố. Không đổi policy cutoff.
- Không có chế độ giải hoàn toàn không Internet, SQLite hoặc đồng bộ offline.
- Chung kết thủ công vẫn cần API/Supabase/worker có kết nối và hiện hoãn nghiệm thu.
- Không bật `OOTV2_ALLOW_ONLINE_UPLOAD` để lách intake; production từ chối cờ này.

### B. Worker gặp sự cố khi đang chấm
- Các ván đấu bị gián đoạn do lỗi hạ tầng (`infrastructure_fault`) không bao giờ tự động xử thua bot thí sinh.
- Kiểm tra service, log và readiness trên VM; chỉ restart sau khi hiểu lỗi và xác minh lease:
  ```bash
  sudo env OOTV2_WORKER_SERVICE=judge bash /srv/ootv2/current/tools/provision/workerctl.sh status
  sudo env OOTV2_WORKER_SERVICE=judge bash /srv/ootv2/current/tools/provision/workerctl.sh health
  ```

### C. Khôi phục kết quả chính thức
- Không dùng phòng chơi tay, sửa DB hoặc nhập kết quả để thay accepted result của engine.
- Retry cùng input đã pin qua API điều hành có lý do/audit. Không đổi source, seed hoặc runtime hash của snapshot.

## 6. Cấu hình triển khai và health — 25/10/2026

**Chưa được mở chấm bot không tin cậy chỉ dựa vào health xanh.** Theo dõi gate trong
`docs/runbook/BAN-TO-CHUC.md`; RC online và nghiệm thu sandbox là hai mốc khác nhau.

| Nơi đặt | Biến/cấu hình |
| --- | --- |
| Vercel API | `NODE_ENV=production`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OOTV2_EXPECTED_PROJECT_REF`, `OOTV2_PUBLIC_ORIGIN`, token GitHub metadata nếu dùng |
| Proxy | `OOTV2_TRUST_PROXY`: Vercel mặc định 1 hop; máy riêng mặc định loopback, chỉ tin đúng proxy quản lý |
| VM | Env runtime trong `/etc/ootv2/worker.env`, service đặt `NODE_ENV=production`, `OOTV2_CAMPUS_SANDBOX=linux-sandbox`, runner/attestation dưới `/srv/ootv2/current` và `/run` |
| Development | `.env` hoặc explicit `.envdev`; `OOTV2_ALLOW_TRUSTED_DEV=1` chỉ trên máy test với bot tin cậy |

Production không tự đọc `.env` trong checkout. Service/platform env là nguồn cấu hình;
nếu thật sự cần file riêng, operator chọn `OOTV2_ENV_FILE` rõ ràng. Không chuyển DDL token,
DB password hoặc khóa SSH sang Vercel/worker. Không dùng tiền tố `VITE_` cho secret.
Production cấm trusted-dev, WSL override, localhost origin và upload online compatibility.

- `GET /api/health`: public liveness, không query DB, không công bố phiên bản/hạ tầng.
- `GET /api/ready`: cookie session admin, trả DB ready hoặc HTTP 503; không kiểm worker.
- VM: `npm run worker:health -- --scope=judge --json` kiểm schema/Storage/sandbox;
  GitHub intake dùng `--scope=github`. Không suy ra queue tiến triển từ việc service còn chạy.
- Khi nghi queue kẹt: xem progress admin, job status/attempt/lease và journal của official worker;
  đối chiếu `recorded`/`reason`, không log source, token, secret. Chỉ hủy/requeue qua API được audit.

## 7. Thứ tự phát hành và rollback

### Lưu ý trước khi vận hành

- Deploy web/API nội bộ không tự khởi động worker và không chứng nhận chấm bot không tin cậy.
- Cutoff hiện có batch limit nhưng chưa có deadline chung xuyên suốt DB/GitHub; chuỗi I/O chậm có thể vượt trần function 30 giây. Demo nội bộ chấp nhận giới hạn này; khi timeout cần đối soát status/capture trước retry, không xóa pin hoặc đổi SHA đã chốt.
- Trước khi nhận code không tin cậy, kiểm đúng release: full sandbox attestation, hai consumer, lease hết hạn/stale write/duplicate finish, crash/retry, mất DB/Storage, reboot, update lỗi/rollback và restore DB + Storage. Không coi fixture local, service active hay DB health là đã nghiệm thu các bước này.
- Sandbox deny-list có giới hạn trước kernel vulnerabilities/side-channel; không đặt worker cạnh API hoặc dữ liệu cá nhân. Intake valid về text/cú pháp không phải sandbox acceptance.

1. Chốt RC SHA và evidence Huy/Bảo/Khoa; kiểm migration manifest với ledger đích, không dùng số
   migration trong handoff cũ làm bằng chứng. Huy xác nhận schema/grants tương thích.
2. Tạm dừng tạo job mới; chờ job đang chạy xong hoặc ghi nhận lease/recovery. Backup theo mục 8.
3. Operator được phép mới apply migration additive cần thiết, rồi cập nhật worker bằng bộ cài hiện có;
   đối chiếu SSH fingerprint với console, không tắt strict verification.
4. Runtime mới `campus-runtime.v2` làm đổi hash. Snapshot v1 đã khóa không tự nâng: hoàn tất bằng
   release tương ứng hoặc giữ nguyên để điều tra. Không sửa snapshot để vượt `runtime_mismatch`.
5. Worker cần tạo attestation mới bằng `attest.sh ... --full`; receipt cũ thiếu artifact hashes sẽ bị
   từ chối. Readiness phải PASS trước start. Không tự mở intake bot lạ khi gate chưa ký.
6. User deploy Vercel sau khi worker/API/schema tương thích. Kiểm HTTPS/cookie Secure, login/CSRF,
   `/api/*`, no-store, health/ready và kết quả đã công bố. Smoke sau deploy hiện **NOT RUN**.

Rollback: dừng tạo job mới, chụp attempt/lease; phục hồi release+env trước đó bằng cơ chế release swap
của bộ cài, tái tạo attestation từ đúng release, chạy readiness rồi mới start. Không rollback schema
bằng cách xóa cột/bảng hoặc sửa migration đã apply. Nếu schema không còn tương thích, giữ service
dừng và dùng kế hoạch restore đã rehearsal. Update hỏng/rollback runtime mới: **NOT RUN**.

## 8. Backup DB + artifact và restore rehearsal

- Chọn cửa sổ nhất quán: dừng writes/job creation, drain worker; ghi RC SHA, migration ledger,
  runtime/budget/map hash và thời điểm UTC. Không coi bản đếm rows là backup.
- Backup Postgres bằng cơ chế backup/PITR của project hoặc logical dump do operator có quyền thực hiện;
  lưu schema, dữ liệu, grants/RLS/functions và manifest. Xác minh chính sách project bao gồm auth cần thiết.
- Backup riêng bytes trong bucket private `ootv2-bots` và artifact/replay ngoài DB nếu có. DB backup
  không thay thế Storage objects. Inventory đầy đủ, đối chiếu size/SHA256 với metadata đã pin.
- Mã hóa backup, ACL hẹp, lưu khác máy chấm; không đưa backup/secret vào Git hoặc web root.
- Restore vào project/Storage **disposable**, không ghi đè project đang vận hành. Chặn egress/worker
  tự claim trong lúc phục hồi; phục hồi DB + objects + config mapping nhất quán.
- So sánh ledger/grants/RLS/counts/FK/hash artifact/replay; thử auth/ACL và một fixture có kiểm soát;
  kiểm idempotency, queue lease/retry và accepted result trước khi kết luận recovery PASS.
- Ghi RPO/RTO thực đo, lỗi, owner và checksum inventory. **Backup/restore rehearsal chưa chạy trong
  đợt này**; không ký gate recovery chỉ vì đã có hướng dẫn.

