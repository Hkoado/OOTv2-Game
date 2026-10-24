**“Chốt schema” là Huy và Khoa xác nhận DB đích có đúng cấu trúc và hành vi mà bản worker hiện tại cần**, không chỉ xác nhận “đã chạy migration” hoặc “bảng đã tồn tại”.

Ví dụ: có hàm `finish` nhưng vẫn cho worker hết lease ghi kết quả thì chưa đạt; migration đã chạy trên DB dev nhưng chưa xác minh DB official cũng chưa đạt.

Hiện đang ở **Plan mode**, tôi chưa tạo file trong workspace. Dưới đây là nội dung tài liệu bạn có thể gửi nguyên cho Huy. Đường dẫn đề xuất khi lưu:  
`d:\OOTv2-Game\docs\HUY-KHOA-CHOT-SCHEMA-WORKER.md`

---

# Chốt schema tích hợp worker official/manual — Huy ↔ Khoa

**Ngày:** 24/10/2026  
**Mục tiêu:** xác nhận DB đích tương thích với worker official/manual trước khi bật consumer và chạy job nghiệm thu.

## 1. Huy cần xác nhận gì?

Nhờ Huy đối chiếu **DB thực tế + migration history + code worker**, rồi bàn giao:

1. Đúng project đích.
2. Migration nào đã áp dụng, migration nào còn thiếu.
3. Bảng/RPC/grants có đúng contract worker cần không.
4. Heartbeat, reclaim, fencing, duplicate finish và replay 0-ply có hoạt động đúng trên PostgreSQL không.
5. Những điểm còn thiếu hoặc chưa thử phải ghi rõ, không coi “có hàm” là đã nghiệm thu hành vi.

**Không yêu cầu tạo schema mới từ đầu, copy DB dev hoặc apply lại tất cả migration.**

## 2. Project đích và phạm vi quyền

| Môi trường | Project | Vai trò |
|---|---|---|
| Official, cấu hình từ `.env` | `ftzockzolisecnyhlwej` | DB đích cần xác nhận trước khi bật worker |
| Dev, cấu hình từ `.envdev` | `wsyfcgurnrowcuefwynx` | Bằng chứng thử nghiệm riêng; không thay thế xác nhận DB official |

Các tài liệu cũ có thông tin khác nhau về schema/quyền truy cập DB official. Vì vậy:

- Kiểm tra lại hiện trạng, kèm thời điểm và project.
- Không kết luận DB official thiếu schema chỉ dựa vào handoff cũ.
- Không chuyển worker sang DB dev để vượt blocker.
- Không đưa token, service key, connection string hoặc source bot vào tài liệu/log bàn giao.
- Nếu thiếu quyền đọc catalog/history, ghi **BLOCKED**, không suy ra schema chưa tồn tại.
- Mọi apply/repair history hoặc thay đổi DB remote cần được người dùng cho phép trước.

## 3. Đối chiếu migration history và catalog

### 3.1. Hai migration đang trùng version

Checkout Khoa đang có:

- `d:\OOTv2-Game\supabase\migrations\20261026120000_ko_round_roster_guard.sql`
- `d:\OOTv2-Game\supabase\migrations\20261026120000_manual_worker_heartbeat.sql`

Nhờ Huy xác nhận:

- File nào đã áp dụng trên từng project?
- Được áp dụng bằng công cụ nào?
- Ledger lưu version, tên file và checksum như thế nào?
- Catalog hiện tại có nội dung của cả hai bản sửa không?
- Cách xử lý version trùng mà không chạy lại SQL sai hoặc làm mất lịch sử?

**Không tự đổi tên migration đã áp dụng, sửa checksum hoặc đánh dấu applied khi chưa đối chiếu.**

### 3.2. Kiểm cả các ledger liên quan

Đối chiếu, nếu tồn tại:

- `supabase_migrations.schema_migrations`.
- `public.ootv2_schema_migrations`.
- Definition thực của bảng/hàm/trigger/grants.

Việc một ledger không có bản ghi **chưa đủ** để kết luận SQL chưa áp dụng; ngược lại, có bản ghi cũng chưa chứng minh catalog còn đúng.

**Đầu ra mong muốn:**

| Migration/file | Official: history | Official: catalog | Dev | Hành động cần thiết |
|---|---|---|---|---|
| Official worker jobs | … | … | … | … |
| Manual final | … | … | … | … |
| Official grants hardening | … | … | … | … |
| Knockout roster guard | … | … | … | … |
| Manual heartbeat/fencing | … | … | … | … |

Dùng trạng thái rõ ràng: `MATCH`, `MISSING`, `DIFF`, `NOT VERIFIED`.

## 4. Contract worker cần xác nhận

Dùng **tên RPC/signature thực tế trong code**, không tạo RPC mới chỉ để khớp tên trong tài liệu này.

### 4.1. Claim và heartbeat

- Claim trả đủ identity của job/attempt, token/generation và thời hạn lease theo contract.
- Hai worker đồng thời không cùng sở hữu một lease hợp lệ của cùng job.
- Heartbeat chỉ gia hạn đúng attempt đang sở hữu.
- Worker cũ không thể hồi sinh lease đã hết hạn hoặc bị thay thế.
- Snapshot source/map/runtime/seed giữ nguyên khi retry.

### 4.2. Finish và accepted result

- Finish chỉ nhận từ attempt/token/generation hợp lệ, lease còn hiệu lực.
- Một game chỉ có một kết quả accepted.
- Duplicate finish xử lý theo semantics đã chốt, không tính điểm hoặc tạo accepted attempt hai lần.
- Attempt cũ không overwrite result/replay sau khi job bị reclaim.
- Không sửa trạng thái terminal hoặc accepted result bằng REST để vượt fence.

### 4.3. Release, reclaim và giới hạn retry

- Lỗi hạ tầng đi theo retry/failure policy, không tự xử bot thua.
- Reclaim kiểm lease hết hạn và không vượt attempt cap.
- Worker cũ không release/cancel/finish attempt mới.
- Hết retry phải có trạng thái/lý do rõ ràng, không lặp vô hạn.

### 4.4. Replay 0-ply

- Chấp nhận kết quả engine hợp lệ kết thúc trước nước đi đầu tiên theo contract.
- Không bắt buộc có ít nhất một move để lưu accepted replay.
- Result, replay và hash tương ứng cùng accepted attempt.
- Không dùng replay rỗng để hợp thức hoá lỗi hạ tầng hoặc kết quả chưa được engine xác nhận.

### 4.5. Provenance và artifact

- Online giữ contract GitHub capture/receipt/SHA.
- Manual giữ provenance manual, không cần GitHub receipt giả.
- Worker đọc đúng submission đã khóa trong snapshot, không lookup `latest`.
- Hash/size/artifact identity được kiểm trước thực thi.
- Sai snapshot/artifact không được biến thành kết quả trận hợp lệ.

## 5. Grants và health-check không claim job

Nhờ Huy cung cấp/xác nhận:

- Signature và kiểu trả về chính xác của các RPC worker sử dụng.
- Quyền `EXECUTE` đúng role.
- `anon`/`authenticated` không gọi được RPC đặc quyền.
- Quyền bảng không cho phép bỏ qua các RPC fencing.
- Các hàm đặc quyền có cấu hình `SECURITY DEFINER`/`search_path` phù hợp.

### Health probe hiện có vấn đề

`d:\OOTv2-Game\tools\cli\worker-health.js` gửi:

```json
{"p_worker":"","p_lease_seconds":1}
```

nhưng chỉ coi `bad_lease` là đạt. Audit trước ghi nhận RPC trả `bad_worker`.

Nhờ Huy xác nhận **guard nào chạy trước mọi truy vấn/ghi/claim**, cùng SQLSTATE/message thực tế để Khoa sửa probe.

**Không dùng worker name hợp lệ để thử claim trên hàng đợi thật. Không coi mọi lỗi `400/P0001` là PASS.**

## 6. Bằng chứng PostgreSQL cần có

Ưu tiên môi trường rehearsal tách biệt. Thử trên DB official chỉ khi được phép và có phạm vi dữ liệu thử rõ ràng.

| Ca thử | Kết quả mong đợi |
|---|---|
| Hai kết nối claim cùng job | Chỉ một lease owner hợp lệ |
| Heartbeat đúng owner | Gia hạn thành công |
| Heartbeat sai token/generation | Không thay đổi lease |
| Lease hết hạn, worker khác reclaim | Attempt mới hợp lệ; attempt cũ bị fence |
| Worker cũ finish/release | Bị từ chối, không sửa dữ liệu mới |
| Duplicate finish | Không tạo kết quả accepted thứ hai |
| Retry vượt cap | Không claim/reclaim vô hạn |
| Accepted result 0-ply | Lưu đúng result/replay/hash |
| Lỗi hạ tầng | Không tạo forfeit giả |
| REST ghi thẳng bảng được bảo vệ | Bị từ chối theo grants |

**Lưu ý:** drill một transaction rồi `ROLLBACK` có thể kiểm nhiều invariant, nhưng **không thay thế kiểm concurrency bằng hai kết nối độc lập**.

Mỗi bằng chứng ghi:
- Project/môi trường.
- Commit code và bộ migration.
- Lệnh hoặc kịch bản.
- Kết quả, exit code và artifact đã loại secret.
- Những ca `NOT RUN`.

## 7. Lỗi knockout toàn hoà: tách khỏi schema readiness

Handoff E2E đang ghi `series_invalid` khi toàn hoà. Tuy nhiên code hiện có:

- `d:\OOTv2-Game\server\lib\officialBracket.js`: fallback theo seed sau đủ ván phụ.
- `d:\OOTv2-Game\tests\officialBracket.test.js`: có ca kiểm fallback này.

Nhờ Huy bàn giao:
- Commit sửa mới nhất nếu đã có.
- Exception gốc trước khi bị bọc thành `series_invalid`.
- Fixture/kịch bản tái hiện không chứa secret.
- Xác nhận lỗi thuộc snapshot, mapping result, pinned colors, orchestration hay DB.

**Không tự thêm luật hoà mới để che lỗi tích hợp.** Đây là gate orchestration riêng, không phải lý do áp lại schema.

## 8. Phân công và điều kiện bàn giao

### Huy
- Xác nhận project, catalog/history và grants.
- Chốt phương án migration trùng version.
- Review contract SQL của worker.
- Bàn giao bằng chứng PostgreSQL và trạng thái sửa knockout.
- Không apply remote ngoài quyền đã được người dùng cấp.

### Khoa
- Sửa health/readiness theo contract đã xác nhận.
- Hoàn thiện provisioning, sandbox, service, update/rollback.
- Chạy nghiệm thu worker thật sau khi có quyền và schema readiness.
- Không tự sửa auth/router/UI hoặc đổi luật đang do Huy xử lý.

### Mẫu phản hồi Huy

```text
Commit backend:
Project đã kiểm:
Thời điểm kiểm:

Migration/catalog:
- Official jobs:
- Manual final:
- Heartbeat/fencing:
- Grants:
- Roster guard:
- Version trùng: phương án xử lý

RPC contract:
- Signature/return shape:
- Guard health không claim:
- Khác biệt so với worker:

PostgreSQL tests:
- PASS:
- FAIL:
- NOT RUN:

Knockout toàn hoà:
- Commit sửa / lỗi gốc / còn blocker:

Kết luận:
- Schema ready cho worker: YES / NO
- Thay đổi remote cần người dùng cho phép:
- Evidence:
```

**`Schema ready = YES` chỉ mở gate kiểm thử tích hợp worker; không có nghĩa VM, sandbox, worker hay toàn bộ RC đã được nghiệm thu.**

---

Nếu muốn tôi lưu nội dung này thành file trong repo, hãy **toggle to Act mode**.