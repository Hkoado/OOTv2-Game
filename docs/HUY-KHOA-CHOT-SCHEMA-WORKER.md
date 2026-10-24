# Chốt schema tích hợp worker official/manual — phản hồi của Huy cho Khoa

**Ngày kiểm:** 24/10/2026 (giờ máy dev, UTC+7)
**Project đích:** `ftzockzolisecnyhlwej` (DB chính thức, cấu hình trong `.env`)
**Commit backend:** `03be94f` + các migration `20261026150000`, `20261026160000` (commit kèm tài liệu này)
**Kết luận ngắn:** schema đích **đã đúng cấu trúc và hành vi worker cần** (17/17 ca PostgreSQL PASS trên
project chính thức). Trong lúc kiểm đã tìm và **đóng 2 lỗ thật**: fencing lease official và quyền DELETE
của `service_role`. Không phải “chỉ đã chạy migration”.

---

## 1. Trạng thái ban đầu và việc đã làm

| Bước | Trước | Sau |
| --- | --- | --- |
| Schema project chính thức | 13 bảng foundation, chưa có bảng runtime/official | 43 bảng: runtime shared, github intake, official schedule/jobs, manual final, publication |
| Migration áp dụng | Không có kênh DDL hoạt động (token sai tiền tố, sau đó chỉ có quyền project dev) | `node tools/cli/apply-migrations.js --bootstrap --apply --smoke` → **21 migration trong PLAN**, smoke PASS |
| Ledger | Chỉ `supabase_migrations.schema_migrations` 1 dòng (`20261024070659 campus_foundation`, do công cụ khác tạo) | Thêm `public.ootv2_schema_migrations` **21 dòng** version+name+sha256 (mục 3) |
| Fencing lease (official) | heartbeat hồi sinh lease chết; finish/fail ghi kết quả khi lease đã hết | Từ chối `lease_lost` (migration `20261026150000`) |
| Quyền bảng | `service_role` còn `DELETE` trên `mvp_official_rounds/games` (REST DELETE = 204) | `403 42501` (migration `20261026160000`) |

## 2. Đối chiếu migration history và catalog

Trạng thái dùng đúng quy ước: `MATCH` (catalog đúng worker cần), `MISSING` (không có), `DIFF` (có nhưng
khác contract), `NOT VERIFIED` (không có kênh đọc).

| Migration / file | Official: history | Official: catalog | Dev | Hành động |
| --- | --- | --- | --- | --- |
| `20261022125205` runtime tables | ledger `MATCH` | `MATCH` (participants/tournaments/submissions/accounts/sessions/attempts/imports) | đã có từ trước | none |
| `20261022125322` runtime functions | ledger `MATCH` | `MATCH` (account/draft/claim/finish/release/import) | có | none |
| `20261023160000` official setup + seed 1..56 | ledger `MATCH` | `MATCH` | có | none |
| `20261025090000` official schedule (rounds/games + 4 RPC) | ledger `MATCH` | `MATCH` | có | none |
| `20261025100000` cutoff capture | ledger `MATCH` | `MATCH` (trigger `cutoff_verify_round` trên `mvp_official_rounds`) | có | none |
| `20261026090000` official worker jobs | ledger `MATCH` | `MATCH` (7 RPC + 2 bảng) | có | xem mục 4 (fencing đã vá bằng `150000`) |
| `20261026100000` manual final | ledger `MATCH` | `MATCH` (6 bảng + 7 RPC) | có | none |
| `20261026110000` official grants hardening | ledger `MATCH` | `MATCH` (service_role không UPDATE; REST PATCH = 403) | có | none |
| `20261026120000` knockout roster guard | ledger `MATCH` | `MATCH` (prosrc chứa `new.round_id = 'group'`) | có | none |
| `20261026130000` manual heartbeat/fencing | ledger `MATCH` | `MATCH` (RPC heartbeat chỉ service_role; prosrc claim/finish/release đã vá) | **MISSING** | xem mục 3 (version trùng) |
| `20261026140000` official broadcast | ledger `MATCH` | `MATCH` (bảng + trigger guard) | **MISSING** (404) | drill tự SKIP trên dev |
| `20261026150000` official lease fencing (mới) | ledger `MATCH` | `MATCH` | **MISSING** | cần apply khi dev có kênh DDL |
| `20261026160000` official write hardening (mới) | ledger `MATCH` | `MATCH` | **MISSING** | cần apply khi dev có kênh DDL |

Riêng prosrc/trigger/grants của **dev** là `NOT VERIFIED`: token hiện tại không còn quyền Management API
trên `wsyfcgurnrowcuefwynx` (REST service key vẫn dùng được). Không suy ra dev “chưa có schema” từ đó.

## 3. Phương án version trùng (đã chốt)

- `20261026120000_ko_round_roster_guard.sql` **đã apply** trên dev (24/10) và trên official (24/10) ⇒
  **không đổi tên**.
- `20261026120000_manual_worker_heartbeat.sql` của Khoa **chưa từng apply ở đâu**: probe REST trên dev trả
  `404 PGRST202` cho `mvp_manual_final_heartbeat` (log `data/probe-dev.mjs`); PLAN apply trước đó cũng
  không có file này. Vì vậy đổi tên thành `20261026130000_manual_worker_heartbeat.sql` là an toàn:
  - file < 630000 không có bản ghi lịch sử nào bị sai,
  - checksum của `ko_round_roster_guard` không đổi,
  - `tools/production/migrationPlan.js` yêu cầu version **duy nhất** để tạo bundle, nên trùng version làm
    `freshDatabaseBundle` ném `invalid_migration_plan` — đổi tên cũng sửa luôn lỗi công cụ này.
- Ledger ghi đúng `130000` (name `manual_worker_heartbeat`), đã áp trên official.

**Ledger dùng gì:** `tools/cli/apply-migrations.js` tự ghi `public.ootv2_schema_migrations(version text PK,
name text, sha256 text, applied_at timestamptz default now())` — cùng hình dạng với bảng mà bundle
`freshDatabaseBundle` tạo, nên project mới và project đã có lịch sử đọc giống nhau.
`sha256` = SHA-256 của **nội dung file sau khi chuẩn hoá CRLF→LF** (cùng công thức `migrationPlan.js`),
`name` = phần sau dấu `_` đầu tiên của tên file. Chạy lại idempotent bằng
`node tools/cli/apply-migrations.js --apply --record-history` (chỉ ghi cho migration mà probe `exists()`
đã xác nhận object tồn tại; `applied_at` của dòng backfill là **thời điểm ghi nhận**, không phải giờ apply gốc).

## 4. Contract RPC worker dùng (đọc từ `pg_proc`, không phải từ tài liệu)

Tất cả chỉ `service_role` có `EXECUTE`; `anon`/`authenticated` = **false**. Hàm `SECURITY DEFINER` đều đặt
`search_path = ''` (riêng 3 hàm schedule cũ `open_round/append_game/record_result/freeze_round` dùng
`search_path = public, pg_temp`).

| RPC | Tham số | Trả về | Fence |
| --- | --- | --- | --- |
| `mvp_official_enqueue_job` | `(uuid, text, text)` | `jsonb {ok, created, status, job_id}` / `{ok:false,error}` | `round_frozen`, `input_mismatch`, không hồi sinh job terminal |
| `mvp_official_claim_job` | `(text, integer)` | `jsonb {ok, reclaimed, job:{id,roundId,gameKey,stage,inputHash,attempt,maxAttempts,generation,leaseToken,leaseUntil}}` hoặc **`null`** khi hàng đợi rỗng | `bad_worker` khi worker rỗng; `p_lease_seconds` **clamp 30..3600** (không có `bad_lease`); `for update skip locked`; generation+1 |
| `mvp_official_heartbeat_job` | `(uuid, uuid, integer, integer)` | `{ok:true, lease_until, generation}` / `{ok:false,error:'lease_lost'}` | token+generation+`status='running'`+**`lease_until > now()`** (mới) |
| `mvp_official_finish_job` | `(uuid, uuid, integer, text, text, jsonb)` | `{ok, already_recorded, result, replay_hash, job_id}` / `{error: bad_input|replay_too_large|job_not_found|lease_lost|result_conflict}` | token+generation+status+**lease còn hạn**; kết quả khác ⇒ `result_conflict`; replay ≤ 256 KiB |
| `mvp_official_fail_job` | `(uuid, uuid, integer, text, text, boolean)` | `{ok, status, attempt, available_at, terminal}` | như finish; retryable + infrastructure + `attempt < max_attempts` ⇒ queued, ngược lại `failed` |
| `mvp_official_cancel_job` / `requeue_job` | `(uuid, text, text)` | `jsonb` | không thay accepted result; giữ audit |
| `mvp_official_reap_jobs` | `(integer)` | `jsonb` | thu hồi lease hết hạn |
| `mvp_manual_final_claim` | `(text, integer, integer)` | `{ok:true, jobs:[…]}` / `{ok:false,error:'bad_worker'}` | clamp lease, `for update skip locked`, kết thúc `infra_fault` khi hết attempts |
| `mvp_manual_final_heartbeat` | `(uuid, uuid, integer, integer)` | `{ok:true, lease_until}` / `{ok:false,error: bad_lease|lease_lost}` | `p_lease_seconds` ngoài 10..900 ⇒ `bad_lease`; lease hết hạn ⇒ `lease_lost` (không hồi sinh) |
| `mvp_manual_final_finish` / `release` | `(uuid, uuid, integer, jsonb)` / `(uuid, uuid, integer, text, integer)` | `jsonb` | từ chối lease hết hạn; `ply_count` 0..1000 (0-ply hợp lệ) |

**Thứ tự guard cho probe health (đúng như Khoa nghi):**

| Probe | Kết quả thực tế |
| --- | --- |
| `mvp_github_claim` `{p_worker:'', p_lease_seconds:1}` | **HTTP 400 `P0001` message `bad_worker`** — `bad_worker` chạy **trước** `bad_lease` |
| `mvp_github_claim` `{p_worker:'schema-probe', p_lease_seconds:1}` | HTTP 400 `P0001` `bad_lease` |
| `mvp_github_claim` hàng đợi rỗng | HTTP 200 body `null` (không lease gì) |
| `mvp_official_claim_job` `{p_worker:''}` | HTTP **200** `{"ok": false, "error": "bad_worker"}` (không phải 400) |
| `mvp_official_claim_job` `{p_worker:'x', p_lease_seconds:1}` | HTTP 200 `null` — lease bị **clamp** thành 30s, **không có `bad_lease`** |
| `mvp_manual_final_claim` `{p_worker:''}` | HTTP 200 `{"ok": false, "error": "bad_worker"}` |
| `mvp_manual_final_heartbeat` `{p_lease_seconds:0}` | HTTP 200 `{"ok": false, "error": "bad_lease"}` |
| `mvp_official_heartbeat_job` job/token giả | HTTP 200 `{"ok": false, "error": "lease_lost"}` |

⇒ `tools/cli/worker-health.js` hiện coi `bad_lease` là đạt cho `mvp_github_claim` khi gửi `p_worker:''` là
**sai contract**; sửa đúng là chấp nhận `P0001 bad_worker` (hoặc gửi worker hợp lệ + lease ngoài 10..900 để
nhận `bad_lease`). Với official/manual claim thì guard trả **JSONB HTTP 200**, không phải exception.

## 5. Bằng chứng PostgreSQL (chạy trên project chính thức)

Công cụ: `tools/cli/worker-schema-drill.js --allow-project=ftzockzolisecnyhlwej`
(log `data/schema-drill2.txt`; fixture tạo/xoá bằng owner, đếm lại 0 sau khi xong). **PASS 17/17.**

| Ca thử | Kết quả | Ghi chú |
| --- | --- | --- |
| enqueue đúng 1 job/ván | PASS | `mvp_official_enqueue_job` tạo `queued`, không tạo trùng |
| Hai kết nối claim cùng job | PASS | `Promise.all` 2 HTTP độc lập: một lease, worker kia nhận `null` |
| Heartbeat đúng owner | PASS | `{ok:true, lease_until}` |
| Heartbeat sai token | PASS | `lease_lost`, `lease_until` **không đổi** (so sánh trước/sau) |
| Heartbeat trên lease đã hết hạn | PASS | `lease_lost` — nhờ `20261026150000` (trước đó hàm cũ **vẫn gia hạn**) |
| Worker cũ finish/fail sau khi lease hết | PASS | `lease_lost`, `official_games.result` vẫn `null` |
| Worker khác reclaim | PASS | `reclaimed:true`, `attempt=2`, `generation=2`; attempt cũ `lease_expired` |
| Accepted result 0-ply | PASS | `events: []` vẫn lưu result + replay + hash, job `succeeded`, lease giải phóng |
| Duplicate finish | PASS | `already_recorded:true`; chỉ **1** attempt `succeeded`; result khác ⇒ `result_conflict` |
| Retry vượt cap | PASS | dừng ở `attempt=max_attempts=3`, `status=failed`, `error_category=infrastructure` |
| Lỗi hạ tầng không forfeit | PASS | `official_games.result` vẫn `null` sau 3 lần fail |
| REST PATCH jobs/games/attempts | PASS | `403 42501` |
| REST DELETE `official_games` | PASS | `403 42501` (trước `20261026160000` là **204**) |
| Dọn fixture | PASS | jobs/games/rounds/events = 0 |
| Manual final RPC (claim/heartbeat/finish/release/cancel/rerun/audit) | PASS | `npm run db:manual` — rehearsal 1 transaction + ROLLBACK trên project chính thức |

**NOT RUN (ghi rõ, không tính PASS):**
- Hai worker trên **hai VM riêng** tranh job (drill dùng 2 request HTTP song song trong cùng máy, không phải
  2 process/2 máy).
- Manual final: fixture đầy đủ event/team/submission/match/job để test **concurrency** và heartbeat fencing;
  hiện chỉ có rehearsal RPC + probe heartbeat `bad_lease`.
- Chạy worker thật (Python + sandbox) trên VM; browser; restore/backup rehearsal.

## 6. Hai thay đổi schema mới (additive, đã apply)

| Migration | Vì sao | Bằng chứng |
| --- | --- | --- |
| `20261026150000_official_lease_fencing.sql` | Bản `26090000` chỉ so token/generation/status: heartbeat **hồi sinh** lease chết, finish/fail ghi kết quả khi lease đã hết nhưng chưa bị reclaim. Áp cùng luật Khoa đã làm cho manual (`130000`), có `position(...)` prerequisite guard + `raise exception` nếu thân hàm khác | drill ca “heartbeat lease hết hạn” và “worker cũ finish/fail” PASS; `pg_proc.prosrc` chứa `lease_until > clock_timestamp()` và `j.lease_until <= clock_timestamp()` |
| `20261026160000_official_write_hardening.sql` | `110000` chỉ bỏ UPDATE; `service_role` vẫn DELETE được rounds/games (fence bypass) | REST DELETE: **204 → 403 42501**; insert/update cần cho publication vẫn giữ |

Không đổi bảng/cột/kết quả lịch sử; cả hai migration chỉ `CREATE OR REPLACE`/`REVOKE`, giữ ACL hiện có.

## 7. Lỗi knockout toàn hoà (§7 yêu cầu)

- **Commit sửa:** `03be94f` — `server/services/officialKnockout.js`, hàm `nextSeriesGame`.
- **Exception gốc trước khi bị bọc:** `Error: Invalid color result` (không phải lỗi snapshot/mapping/DB).
  `series_invalid` chỉ là lớp bọc `409` quanh exception này trong `publishNextSeriesGame`.
- **Nguyên nhân:** lần pin ván chính gọi `nextOfficialKnockoutGame({series, results})` với **toàn bộ** kết quả;
  sau khi có ván phụ, `assignNextOfficialGameColor` thấy record của game không nằm trong `games` truyền vào
  (chỉ main) ⇒ ném `Invalid color result`. Trước khi có ván phụ thì không lỗi, nên triệu chứng chỉ xuất hiện ở
  series toàn hòa.
- **Sửa:** lọc `results` theo `series.mainGames` trước khi pin ván chính; không thêm luật hòa mới — fallback
  theo seed vốn đã có trong `officialBracket.js` (`reason: 'seed'`) và vẫn giữ nguyên.
- **Tái hiện không cần secret:** `node --test tests/officialKnockoutResolve.test.js` — 4 ván chính + 2 ván
  phụ đều hòa ⇒ phải pin đủ 6 ván, `complete:true`, `reason:'seed'`, seed 1 đi tiếp.
- **E2E:** `data/e2e-online-ko6.txt` — `bracket_complete` 4/4 series, vé `awarded=2`, `vacant=0`.

## 8. Kết luận và điều kiện

**Schema ready cho worker official/manual: YES** (project `ftzockzolisecnyhlwej`), với các giới hạn đã ghi:

- YES chỉ mở gate **kiểm thử tích hợp worker**; không có nghĩa VM/sandbox/worker/RC đã nghiệm thu.
- Trước khi Khoa chạy worker thật, cần: bật `OOTV2_CAMPUS_SANDBOX` + attestation trên VM, chạy
  `node tools/cli/worker-health.js` (sau khi sửa probe `mvp_github_claim` theo mục 4) và chạy lại
  `worker-schema-drill` trên đúng project worker sẽ dùng.
- Nếu Khoa cần dev có đủ migration mới (`140000`, `150000`, `160000`) để thử: cấp lại token/`SUPABASE_DB_URL`
  cho project dev rồi chạy `node tools/cli/apply-migrations.js --apply --smoke --record-history`.

### Lệnh tái lập (không cần secret trong tài liệu)

```powershell
node tools/cli/apply-migrations.js --bootstrap --apply --smoke      # áp migration + smoke rollback
node tools/cli/apply-migrations.js --apply --record-history         # ghi/đồng bộ ledger
node tools/cli/worker-schema-drill.js --allow-project=<ref>         # 17 ca fencing/lease/replay
npm run db:verify ; npm run db:check-github ; npm run db:manual     # catalog/RPC/manual rehearsal
node --test tests/officialKnockoutResolve.test.js                   # regression knockout toàn hòa
```



