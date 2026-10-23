# Supabase: nền tảng DB quản lý giải

Ngày 22/10/2026. Project đã được người dùng xác nhận: **OTTv2-G5**, ref `wsyfcgurnrowcuefwynx`.
Migration đã áp dụng: `20261022122359`, tên `campus_foundation`.

## Phạm vi

Foundation Campus vẫn độc lập. Runtime MVP hiện dùng các bảng `mvp_*` trong cùng
project, không chuyển dữ liệu lịch sử sang luật Campus. Không mở thực thi bot công khai.

Lựa chọn Supabase theo yêu cầu mới thay cho quyết định SQLite-only **ở toàn bộ runtime**:
từ 23/10/2026 SQLite đã bị bỏ hẳn (schema, driver, CLI import và test harness).
Không thêm SDK, ORM hoặc dependency. Service-role key chỉ dùng backend, không in/commit.
Migration DDL dùng kết nối quản trị đã xác thực.

## Bỏ SQLite — Supabase là DB duy nhất (23/10/2026)

- Migration mới **`20261023120000_live_stream.sql`** tạo `mvp_match_events`,
  `mvp_match_bot_output`, `mvp_worker_state` (RLS + chỉ `service_role`), phục vụ `/api/live`.
  **Phải chạy migration này trước khi chấm trận đầu tiên**; nếu chưa, API trả
  `503 live_not_ready` kèm tên migration.
- Đã xoá `better-sqlite3`, `server/db.js`, các service/route legacy, `OOTV2_DB_DRIVER`,
  `OOTV2_DB_PATH`, `OOTV2_ADMIN_KEY`, `tools/cli/{live-demo,reset-live-demo,migrate-shared-db}.js`.
  Runtime, worker và công cụ chỉ dùng `server/shared/*`.
- `tools/cli/verify-shared-db.js` giờ là smoke Supabase thuần (health, đếm bảng, login/CSRF/logout),
  không đọc file `.sqlite` nữa. Chạy `npm run db:verify`.
- Thiếu `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` → `assertSharedConfig()` ném lỗi ngay khi boot
  (`server/index.js`, `server/worker.js`); không có driver dự phòng.


## Map snapshot theo ván (24/10/2026)
## GitHub intake H1 — repo approval + job/receipt (24/10/2026)

- Migration **`20261024130000_github_intake.sql`** (additive, chưa apply remote): 3 bảng private
  `mvp_repo_connections` (repo/branch đã duyệt theo giải+đội), `mvp_repo_sync_jobs` (lease/attempt/
  available_at/error_category), `mvp_github_receipts` (trạng thái cho UI + `source_hash`/`submission_id`).
  RLS bật, `REVOKE` khỏi `PUBLIC/anon/authenticated`, chỉ `service_role` đọc/ghi.
- RPC `mvp_repo_connection_upsert` (đăng ký/duyệt, unique `(event, repo_id)` chống dùng chéo đội) và
  `mvp_github_intake` (cutoff/freeze/membership/quota/idempotency bằng `clock_timestamp()`), trả envelope
  `{ok, created?, connection?|receipt?, job?, error?}` để API map mã lỗi mà không lộ chi tiết SQL.
- API chỉ resolve `repository id` + HEAD `commit SHA` qua `api.github.com` (`server/services/githubRepo.js`),
  kiểm host/protocol/redirect/size/timeout, token chỉ ở header. Không clone, không tải `bot.py`,
  không chạy git/Python; worker BTC (H2) sẽ tải blob đúng SHA.
- Route + DTO đã chốt: xem [docs/16](16-THIET-LAP-CHINH-THUC-VA-CHIA-VIEC.md) và
  [bàn giao Huy](handoff/Huy.md). UI B2 dùng `receipt`/`job` view này trực tiếp.
- Bảo mật: receipt chỉ trả whitelist (không `storage_path`, không token, không raw lỗi GitHub);
  team chỉ đọc job/receipt của mình, admin đọc mọi đội; giải đã chạy thì `event_frozen`/`frozen`.



- Migration **`20261024120000_mvp_match_map_snapshot.sql`** thêm `mvp_matches.map_json` (MapV1 đã
  chuẩn hoá) và `mvp_matches.map_hash` (hash canonical bỏ `id`/`revision`), rồi thay
  `mvp_stage_commit` để mọi ván mới bắt buộc có snapshot hợp lệ (`bad_game_map` nếu thiếu/sai dạng).
  **Phải chạy migration này trước khi bắt đầu giải mới**; chưa chạy thì API trả lỗi RPC vì cột chưa có.
- `server/shared/tournaments.js` chốt snapshot ngay khi lên lịch (`seriesGames`) cho cả vòng bảng,
  bán kết và chung kết; sửa map của giải sau đó không làm lệch ván đã tạo.
- `server/shared/worker.js` đọc snapshot của ván, tính lại hash (`server/contracts/mapSnapshot.js`);
  snapshot hỏng hoặc hash lệch ⇒ lỗi hạ tầng: release lease, **không chạy bot** với map khác.
  Ván tạo trước migration (`NULL`) dùng map hiện tại của giải.
- `runMatch({ map })` gửi cùng `map`/`map_hash` trong request `setup`, `move` và ghi vào `replay_json`.
- API danh sách trận trả thêm `map_hash` để đối soát; trường này vẫn không lộ source bot hay hash bài.


## Runtime MVP dùng chung — 22/10/2026

- Migration `20261022125205_shared_mvp_runtime_tables` và
  `20261022125322_shared_mvp_runtime_functions` đã áp dụng, 9 bảng bật RLS,
  chỉ service_role có quyền; 13 bảng Campus không thay đổi.
- Quan sát chấm bài (Mức 2): migration `20261022150000_judge_monitor` thêm bảng
  `mvp_match_logs` (RLS, chỉ service_role đọc/ghi; API vẫn gate `requireLocalAdmin`).
  Chưa áp dụng thì trang Chấm bài vẫn hiển thị tiến độ nhưng trả `logs_available: false`.
- Đã nhập 9 participants, 2 accounts, 1 tournament, 7 entries; không có submission/match.
  Password hash giữ nguyên, bỏ session cũ: mọi người đăng nhập lại.
- SQLite có ID TEXT không phải UUID (`draft-bay-doi`): CLI ánh xạ tất định sang UUID,
  cập nhật khóa ngoại trong bundle, lưu `idMap` trong receipt; không sửa SQLite gốc.
- Backup dùng SQLite backup API (gồm WAL), receipt trong data/private, không commit.
  Import DB nguyên tử, fingerprint cho phép chạy lại. Artifact upload trước transaction:
  nếu bị ngắt giữa upload/import khi có source, cần kiểm tra object mồ côi trước rerun.
- Bucket `ootv2-bots` private, 64 KiB, application/octet-stream, không policy client.
  Đây là giới hạn MVP cũ, không phải giới hạn 256 KiB Campus.
- Nhiều worker claim bằng SKIP LOCKED, lease 60 giây/heartbeat 10 giây,
  DB clock, token-fenced finish và attempt history; lỗi hạ tầng retry sau 30 giây.
- API vẫn loopback; mỗi máy tin cậy dùng cùng credential backend. Bot subprocess
  không phải sandbox; không cấp key cho đội/bot, không mở upload công khai.
- Thiếu kết nối DB báo lỗi, không fallback. Node test runner không còn mở DB cục bộ:
  test dùng mock `fetch` (PostgREST giả lập), xem `tests/liveStream.test.js`.

Từ `d:\OOTv2-Game`: chạy `node tools/cli/setup-shared-storage.js` một lần cho bucket,
sau đó mỗi máy mới chỉ cần `.env` + `npm run dev:api` + `npm run dev:worker`.
`npm run db:verify` kiểm health, số lượng bảng và HTTP auth/CSRF/logout (tạo admin tạm rồi cleanup).
Chưa nghiệm thu concurrency nhiều máy thực, browser hai máy, giải shared 30 ván
end-to-end, hoặc sandbox OS; không coi smoke DB là các nghiệm thu này.

## 13 bảng trong public

| Bảng | Ý nghĩa |
| --- | --- |
| players | Hồ sơ người chơi, mã sinh viên duy nhất; không chứa password |
| teams | Đội, tên duy nhất không phân biệt hoa/thường, repo |
| team_members | Thành viên theo tháng; một người/một đội/tháng, tối đa một đội trưởng |
| tournaments | Giải tuần/tháng/kỳ, lịch, seed uint32, phiên bản luật |
| tournament_entries | Đăng ký đội, hạt giống, snapshot đội hình |
| submissions | Metadata bot, commit/hash, kích thước tối đa 256 KiB, trạng thái validation |
| rounds | Vòng thuộc giải, online/offline, cutoff |
| round_entries | Đội và snapshot bot của từng vòng |
| maps | Định nghĩa JSON, phiên bản/hash; map đã gán vòng phải tạo revision mới khi đổi |
| round_maps | Map chính/dự phòng và thứ tự áp dụng |
| matches | Cặp đấu; hỗ trợ bye, walkover, double-DQ, hòa |
| games | Từng ván đổi màu, map/seed/kết quả/replay |
| audit_logs | Nhật ký quyết định quản trị, actor_ref do backend xác nhận |

`matches.entry_a_id/entry_b_id` và `games.red_entry_id/blue_entry_id` tham chiếu
**round_entries.id**, không phải tournament_entries.id. Khóa ngoại tổng hợp bảo đảm
đội thuộc đúng giải/vòng, bot thuộc đúng đội, map thuộc bộ map của vòng.
Trigger kiểm hai màu đúng cặp đấu, chặn đổi participant sau khi có ván, đổi bot
sau khi ghép cặp, đổi submission/map đã được tham chiếu.
Các quan hệ dùng RESTRICT; không cascade xóa lịch sử thi đấu.

## Quyền truy cập

- RLS bật trên cả 13 bảng. Không có policy cho browser ở milestone này.
- Thu hồi quyền bảng của PUBLIC, anon và authenticated.
- service_role được CRUD, riêng audit_logs chỉ SELECT/INSERT. Đây không phải log
  chống sửa tuyệt đối: chủ DB vẫn có thể sửa. Backend phải tự ghi audit cùng transaction.
- Không có mapping Supabase Auth, vai trò BTC hay chính sách xem theo vòng ở giai đoạn này.
  Đừng mở quyền đọc toàn bảng để chữa lỗi permission denied.
- Service-role key chỉ ở backend; không dùng biến VITE_ và không cấp cho bot.

## Những validation thuộc milestone tích hợp kế tiếp

Không coi schema là hệ thống điều hành giải đã hoàn chỉnh. Backend còn phải:

1. Duyệt đội 2–3 người, xác thực mã sinh viên, đóng băng roster_snapshot và lịch sử thành viên.
2. Validate map bằng engine hiện có; JSON object/hash đúng định dạng không chứng minh map hợp lệ.
3. Chỉ chốt submission đã valid trước cutoff, khóa trạng thái vòng bằng transaction.
4. Chặn sửa map schedule/round sau freeze; kiểm chuyển trạng thái và bất biến snapshot khi cạnh tranh ghi.
5. Tính standings/tie-break/vé tháng-kỳ, xử lý retry attempt và xác nhận kết quả chính thức.
6. Ghi audit có actor tin cậy, phân quyền BTC/đội, chính sách xem online theo vòng; replay offline chỉ BTC.
7. Thêm migration dữ liệu SQLite, repository adapter và đồng bộ offline trong milestone riêng.

Không có bảng standings ghi tay, bảng auth riêng, rating, billing hoặc queue phân tán.
Các fixture kiểm thử chỉ kiểm schema, không phải map/bot thi đấu hợp lệ.

## Kiểm tra lại

- File migration: `d:\OOTv2-Game\supabase\migrations\20261022122359_campus_foundation.sql`.
- Smoke SQL: `d:\OOTv2-Game\supabase\tests\foundation.sql`.
- Mở SQL Editor của đúng project, chạy **toàn bộ** smoke SQL với quyền postgres.
  Script BEGIN/ROLLBACK nên không để lại fixture; kết quả cuối phải là
  `foundation smoke passed; fixtures rolled back`.
- Không chạy lại migration trên project đã áp dụng. Tên file khớp version remote;
  thay đổi tiếp theo phải dùng migration mới. Không dùng DROP CASCADE để rollback.
- Migration remote dùng cùng DDL, khác trình bày/whitespace với file local.
- Trên DB mới, áp dụng migration một lần trong transaction bằng công cụ migration.

Smoke gồm luồng tạo player → đội → giải → bài nộp → vòng → cặp → hai ván đổi màu,
ghi kết quả/audit; 11 trường hợp dữ liệu sai bị từ chối; kiểm quyền anon/authenticated
và audit append-only. Không phải test tải/concurrency hay kiểm thử UI Supabase.