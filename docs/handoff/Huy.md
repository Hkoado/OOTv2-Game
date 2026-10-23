# Kết quả Huy — Backend / GitHub / privacy

## Trạng thái mới nhất

- Trạng thái: **H1 (+ fix review), H2 (contract hardening) và H3 DONE (mock-verified)** — intake,
  lease/idempotent finish/revoke, ACL/cổng upload, lịch phát; **chưa chạy Postgres thật**; H4 chưa làm.
- Phạm vi: H1 trong [phân công Huy](../assignments/Huy.md).
- Checkpoint nguồn: `3de220e`; **commit kết quả H1: `be22c09`** trên nhánh `dev` (đã push `origin/dev`).
- Migration `20261024130000_github_intake.sql`: **CHƯA apply remote** (quy ước repo: cần operator duyệt).
- B2 (Bảo) **có thể nối API thật ngay**: route + DTO dưới đây đã chốt, có test mock phủ quyền/lỗi.
- **24/10/2026 (ngoài H1–H3):** thêm "nhớ tài khoản" ở màn đăng nhập — client chỉ lưu username
  (`src/tournament/portal/rememberAccount.js`), phiên 30 ngày khi bật (`REMEMBER_MS`) thay vì 8 giờ;
  test TTL trong `tests/portalAuthApi.test.js`. **286/286 pass**, build pass; browser thật NOT RUN.

## H1 — route, DTO, quyền (đã chốt cho B2/Khoa)

### Route (`server/shared/router.js`, service `server/services/githubIntake.js`)

| Method + path | Quyền | Trả về |
| --- | --- | --- |
| `PUT /api/local/events/:id/repository` | team (chính mình) / admin (kèm `team`) | `{connection}`; team → `approved:false` (`pending_approval`), admin → `approved:true` |
| `GET /api/local/events/:id/repository` | owner / admin (`?team=`) | `{connection}` |
| `GET /api/local/events/:id/repositories` | admin | `{connections:[{...,team_name}]}` (danh sách chờ duyệt) |
| `POST /api/local/events/:id/submissions/from-github` | owner / admin (kèm `team`) | `202 {created, job, receipt}`; body `{repository?, branch?}` phải khớp connection đã duyệt |
| `GET /api/local/events/:id/submissions/from-github` | owner / admin | `{event:{id,status}, connection, receipt}` (receipt mới nhất) |
| `GET /api/local/repo-sync-jobs/:id` | owner / admin | `{job, receipt}` |

- Cần session cookie + `x-csrf-token` cho PUT/POST (guard chung `requireSession`); admin routes dùng
  `requireLocalAdmin`. Origin lạ bị chặn bởi middleware same-origin sẵn có.
- Không route nào clone, tải source, gọi git hay chạy Python. GitHub chỉ gọi 2 endpoint metadata:
  `/repos/{owner}/{repo}` và `/repos/{owner}/{repo}/commits/{branch}`.

### DTO receipt (snake_case, khớp fixtures `src/tournament/portal/githubSyncState.js`)

```json
{
  "id": "uuid", "event_id": "uuid", "team_id": "uuid", "repo_id": 987654321,
  "repository": "https://github.com/team-delta/ootv2-bot", "branch": "main",
  "commit_sha": "a1b2...40 hex", "resolved_at": "2026-10-24T00:10:00.000Z",
  "status": "resolving", "source_kind": "github", "file_path": "bot.py",
  "source_hash": null, "error": null, "error_category": null,
  "submission_id": null, "previous_valid_submission_id": null, "job_id": "uuid"
}
```

- `status ∈ resolving|fetching|checking|valid|invalid|infrastructure|frozen`.
- Khi giải đã bắt đầu (`status ≠ draft`), API trả view `status:"frozen"` + `previous_status` + `note`
  (không sửa dữ liệu đã lưu).
- Không trả `storage_path`, token, lease token hay raw lỗi GitHub. `source_hash`/`submission_id` do
  worker (H2/Khoa) điền sau khi tải + kiểm `bot.py`.

### DTO job (nội bộ cho worker, không lộ lease)

```json
{ "id": "uuid", "event_id": "uuid", "team_id": "uuid", "status": "queued", "attempt": 0,
  "available_at": "...", "error": null, "error_category": null, "created_at": "...", "updated_at": "..." }
```

`status ∈ queued|leased|running|completed|bot_fault|infra_fault|canceled`; DB có thêm
`lease_token/lease_until` nhưng view loại bỏ.

### Ví dụ luồng gọi API cho B2

```text
# 1) Đội đăng ký repo (team session + header x-csrf-token)
PUT /api/local/events/<eventId>/repository   {"repository":"https://github.com/team-delta/ootv2-bot","branch":"main"}
→ 200 {"connection":{...,"approved":false,"status":"pending_approval"}}

# 2) Admin duyệt (admin session)
PUT /api/local/events/<eventId>/repository   {"team":"<participantId>","repository":"...","branch":"main"}
→ 200 {"connection":{...,"approved":true,"status":"approved"}}

# 3) Đội yêu cầu đồng bộ (gọi lại cùng SHA an toàn: created=false)
POST /api/local/events/<eventId>/submissions/from-github   {}
→ 202 {"created":true,"job":{"id":"...","status":"queued"},"receipt":{"status":"resolving","commit_sha":"<40 hex>",...}}

# 4) Poll trạng thái
GET /api/local/repo-sync-jobs/<job.id>                    → {"job":{...},"receipt":{...}}
GET /api/local/events/<eventId>/submissions/from-github   → {"event":{...},"connection":{...},"receipt":{...}}
```

Lưu ý UI: `status` chỉ sang `fetching/checking/valid/invalid` sau khi worker H2 xử lý job; hiện dừng ở
`resolving` cho tới khi H2 xong.


### Mã lỗi API (map từ envelope RPC, không lộ SQL)

`repo_not_approved` (403), `repo_taken` (409), `repository_changed` (409), `repository_not_found` (404),
`past_cutoff` (409), `event_frozen` (409), `quota_exceeded` (429), `missing_team` (400),
`github_rate_limited` (503), `github_timeout` (504), `github_unavailable` (503),
`github_auth_failed` / `github_forbidden` / `github_bad_response` (502).

## H3 — lịch phát và privacy (`20261024150000_broadcast_schedule.sql`)

Bảng `mvp_match_broadcasts` (1 row/ván, RLS private) tách khỏi trạng thái chấm:
`scheduled → canceled`, còn `ended` suy ra từ giờ server. **Ván `finished` không tự động được công bố.**

| Route | Quyền | Ghi chú |
| --- | --- | --- |
| `POST /api/local/admin/broadcasts` | admin | body `{match_id, starts_at (ISO có múi giờ), ply_interval_ms 250..60000, release_mode window|full}` → `201 {broadcast}`; chỉ ván `finished` (nếu chưa: `match_not_graded`) |
| `POST /api/local/admin/broadcasts/:matchId/cancel` | admin | hủy trước giờ phát; đã phát → `409 broadcast_started` |
| `GET /api/local/events/:id/broadcasts` | owner/admin | danh sách lịch; đội chỉ thấy ván đã công bố |
| `GET /api/local/broadcasts/:matchId?afterSeq=` | owner/admin | gói phát `{phase, server_time, starts_at, ply_interval_ms, release_mode, visible_plies, total_plies, reveal_result, next_poll_ms, events[], result?}` |
| `GET /api/live/*` | **bắt buộc đăng nhập** + đội thuộc giải | overview/snapshot/events lọc theo lịch phát |

- `visible_plies = clamp(floor((server_now - starts_at)/ply_interval_ms) + 1, 0, total_plies)`;
  `events` chỉ tới `seq <= visible_plies` (kèm `initial` seq 0); không có `result`/terminal trước khi mở.
- `reveal_result = phase === 'ended' && release_mode === 'full'` — chỉ khi đó mới trả `result` và mở
  `GET /api/local/matches/:id/replay` cùng log bot cho đội.
- Ẩn với đội: ván chưa công bố trong `GET /events/:id` (matches/standings/bracket tính lại từ đúng tập
  đã mở), `/api/live`, replay, bot-output; đội giải khác → 403 `scope_denied`.
- Ẩn danh: mọi route `/api/live` trả `401 login_required` (thay chính sách L1 công khai trước đây).
- UI Bảo: trang Live cần hiện nhắc đăng nhập; dùng `phase`/`visible_plies`/`next_poll_ms` của gói phát.
- `/api/live/overview` chỉ chọn trong các giải mà đội tham gia (`getLiveOverview({eventIds})`); đội khác
  giải không thấy tên giải/đội/matches (test `publication` phủ trường hợp này).



## H1 — contract RPC worker (`20261024160000_github_jobs_worker.sql`)

Worker BTC (Khoa/H2) dùng `server/shared/githubJobs.js`; mọi kiểm quyền nằm ở RPC:

| RPC | Input | Ghi chú |
| --- | --- | --- |
| `mvp_github_claim(worker, lease_seconds=120)` | worker 1..120, lease 10..900 | claim `queued` tới hạn hoặc lease hết hạn (`SKIP LOCKED`), tăng `attempt` + `generation`, trả `{job, receipt, lease}` |
| `mvp_github_heartbeat(job, token, generation, lease_seconds)` | lease token + generation | gia hạn lease; `false` = mất lease |
| `mvp_github_progress(job, token, generation, status, note)` | `fetching|checking` | cập nhật receipt cho UI; `false` = mất lease |
| `mvp_github_finish(job, token, generation, outcome)` | `{status, source_hash, submission?...}` | ghi submission + receipt + job trong **một transaction**; `false` = stale worker, không ghi gì |
| `mvp_github_release(job, token, generation, error, max_attempts=3)` | backoff 15s×attempt (tối đa 300s) | retry; vượt attempts → `infra_fault`; trả `{ok:false, reason:'lease_lost'}` khi mất lease |

- Chống stale worker: mọi UPDATE dùng
  `WHERE lease_token=p_token AND generation=p_generation AND status IN ('leased','running') AND lease_until>clock_timestamp()`.
- `finish` valid tạo `mvp_submissions` với `participant_id` lấy từ **job.team_id** (không tin payload),
  kiểm `storage_path` dạng `<uuid>.py` và `sha256 = source_hash`; invalid/infrastructure **không** tạo
  submission và giữ bản valid cũ.
- **Sửa bug review**: `previous_valid_submission_id` lấy `submission_id` (FK trỏ `mvp_submissions(id)`),
  bỏ qua receipt `valid` chưa có submission; sửa tại chỗ ở `20261024130000` và `CREATE OR REPLACE` trong
  migration mới (ai đã apply bản nháp thì apply lại file cũ hoặc chạy migration mới).


## H2 — transaction/ACL/intake (audit + đóng cổng upload)

| Yêu cầu H2 | Trạng thái | Bằng chứng |
| --- | --- | --- |
| Receipt whitelist (không storage path/token/raw error) | DONE | `receiptView()` chỉ trả field DTO; test `githubIntakeApi` |
| Cross-team denial | DONE | `scopeTeam`, `getJob` (owner/admin) và **`requireEventMember` mới** cho `getConnection`/`getLatest`/`requestSubmission` → 403 `scope_denied` trước khi gọi GitHub/DB |
| Clock DB cho cutoff/freeze/quota | DONE | `mvp_github_intake` dùng `clock_timestamp()` + `FOR UPDATE`; giờ server chỉ dùng để chọn SHA |
| Unique `(event, team, repo_id, commit_sha, path)` | DONE | unique index ở `mvp_github_receipts`/`mvp_repo_sync_jobs`; `unique_violation` trả receipt cũ |
| Pending trước cutoff được chấm sau | DONE | job `queued` không có hạn; claim không kiểm cutoff |
| Giữ bản valid cũ khi lỗi | DONE | `finish` invalid/infrastructure không tạo submission; `previous_valid_submission_id` trỏ submission cũ |
| Repo chưa verify phải BTC duyệt | DONE | `approved=false` mặc định; chỉ admin PUT set `approved=true`; intake `repo_not_approved` |
| **Tắt upload HTTP cho đội + admin opt-in** | **DONE (mới)** | `server/shared/uploadPolicy.js` + `config.uploads.allowOnlineAdmin` (`OOTV2_ALLOW_ONLINE_UPLOAD`, mặc định tắt) |

- Đội: **luôn** `403 upload_disabled` (kể cả khi bật cờ) — nộp qua GitHub.
- Admin/BTC: `403 upload_disabled` mặc định; chỉ `201` khi `OOTV2_ALLOW_ONLINE_UPLOAD=1` (trusted-dev/import
  offline). Multer vẫn chặn đuôi/kích thước khi cổng mở; response không lộ `storage_path`.
- Không chặn quy trình phát/thu file offline qua USB (ngoài HTTP).
- UI Bảo: nút "Nộp file USB" chỉ dành admin và cần cờ trên; đội dùng luồng GitHub.


## H2 — contract worker chi tiết (`20261024170000_github_jobs_hardening.sql`)

- **Claim** `mvp_github_claim(worker, lease_seconds=120, max_attempts=3)`: claim `queued` tới hạn hoặc lease
  hết hạn (`SKIP LOCKED`), tăng `attempt` + `generation`, trả `{job, receipt, lease{token, generation,
  expires_at, attempt, max_attempts}}`. **Chống crash**: lease hết hạn và `attempt >= max` → job
  `infra_fault`, receipt `infrastructure`, **không phát lại** (BTC xử lý tay).
- **Heartbeat/Progress**: trả `false` khi mất lease; `progress` chỉ nhận `fetching|checking`.
- **Finish** trả envelope `{ok, applied, already_finished, job, receipt}`:
  - `applied=true`: ghi submission (nếu valid) + receipt + job trong cùng transaction.
  - `already_finished=true`: lần trước đã commit nhưng mất response → **không tạo submission lần 2**;
    `receipt.submission_id` cho biết artifact của worker đã được nhận (`null` = chưa).
  - `lease_lost`: worker cũ/lease hết hạn → dừng, không ghi.
  - `valid` với `submission_id` có sẵn phải đúng `job.team_id`, `status='valid'`, `sha256 = source_hash`;
    sai → `bad_submission` (HTTP 400) để worker báo BTC.
- **Release**: **bắt buộc `lease_until > clock_timestamp()`**; hết hạn/sai token/generation →
  `{ok:false, error:'lease_lost'}`, không requeue. Còn hạn → `queued` với backoff `15s×attempt`
  (tối đa 300s); vượt attempts → `infra_fault`.
- **Revoke repo** `DELETE /api/local/events/:id/repository?team=` (admin) → `mvp_repo_connection_revoke`:
  `approved=false`, hủy job `queued|leased|running`, receipt chưa kết thúc → `frozen` (`repository_revoked`);
  receipt `valid` và snapshot đã khóa **không đổi**.
- **Start/freeze**: `POST /events/:id/start` trả `409 repo_sync_pending` khi còn job intake chưa xong —
  BTC đợi worker chấm xong hoặc thu hồi repo; không tự chọn HEAD mới.
- **Cutoff/candidate**: kiểm trong transaction bằng `clock_timestamp()` (`past_cutoff`); job nhận trước hạn
  vẫn được chấm sau hạn; start chọn **latest `valid`** theo `(created_at desc, id desc)`; lỗi
  hạ tầng/bot không thay bản valid cũ.
- **Phía Khoa**: consumer `14ff30b` đã có trên `dev` (mặc định `enabled=false`, chưa chạy Python/polling).
  Huy đã chỉnh `processGithubJob` dùng envelope: `recorded = applied || alreadyFinished`, `leaseLost` →
  `lease_lost`, còn lại `completion_unknown`; `tests/githubConsumer.test.js` 12/12. Contract tham chiếu
  `docs/GITHUB-CONSUMER.md` của Khoa.


## Schema / RPC (migration `20261024130000_github_intake.sql`, additive, CHƯA apply)

- **Thứ tự áp dụng**: `20261022125205` (bảng `mvp_*`) → `20261023160000` (official setup/cutoff)
  → `20261024130000` (approval + job/receipt + intake) → `20261024150000` (broadcast H3)
  → `20261024160000` (generation + worker RPC) → `20261024170000` (lease expiry, finish idempotent,
  reclaim cap, revoke). Tất cả **CHƯA apply remote**; rollback ghi trong `docs/12`.

- `mvp_repo_connections`: unique `(event_id, team_id)` + unique `(event_id, repo_id)` (một repo/đội trong
  giải), `approved boolean`, `approved_by`, check `repository` là https://github.com/..., `file_path='bot.py'`.
- `mvp_repo_sync_jobs`: `commit_sha` 40-hex check, `status` 7 giá trị nội bộ, `attempt`, `lease_token/until`,
  `available_at`, `error/error_category ∈ code|infrastructure|repo`, unique
  `(event_id, team_id, repo_id, commit_sha, file_path)`.
- `mvp_github_receipts`: `status` 7 giá trị UI, `source_hash` 64-hex (nullable), `submission_id`,
  `previous_valid_submission_id`, `resolved_at`, cùng unique key với job.
- RLS bật cả 3 bảng; `REVOKE ALL ... FROM PUBLIC, anon, authenticated`; chỉ `service_role` select/insert/update.
- `mvp_repo_connection_upsert(...)`: kiểm giải còn `draft`, membership, repo chưa thuộc đội khác; trả
  `{ok, connection}` hoặc `{ok:false,error}`.
- `mvp_github_intake(...)`: `FOR UPDATE` giải → `event_frozen`; đọc `mvp_official_setups.config->>'cutoff'`
  so `clock_timestamp()` → `past_cutoff`; membership → `not_in_event`; connection chưa duyệt →
  `repo_not_approved`; repo/branch lệch → `repository_changed`; idempotent theo unique key; quota
  `count(distinct commit_sha)` 24h (mặc định 10, `OOTV2_GITHUB_DAILY_QUOTA`); insert job `queued` +
  receipt `resolving` kèm `previous_valid_submission_id`; bắt `unique_violation` để trả receipt cũ.
- Rollback (chỉ khi chưa có dữ liệu thật): `DROP FUNCTION mvp_github_intake(uuid,uuid,uuid,text,text,text,
  bigint,text,integer); DROP FUNCTION mvp_repo_connection_upsert(uuid,uuid,text,bigint,text,text,boolean,uuid);
  DROP TABLE mvp_github_receipts, mvp_repo_sync_jobs, mvp_repo_connections;`

## Tests (mock — không chạm DB/GitHub thật)
| `node --test tests/githubConsumer.test.js` | **12/12 pass** — envelope finish (already_finished/lease_lost), fencing, cache/artifact (sau khi Huy nối envelope) |


| Lệnh | Kết quả |
| --- | --- |
| `node --test tests/githubRepo.test.js` | **5/5 pass** — URL/branch, chỉ metadata, token ở header, map lỗi GitHub |
| `node --test tests/githubIntakeApi.test.js` | **7/7 pass** — duyệt/thu hồi repo, 202 + receipt whitelist, idempotent SHA, cross-team 403, quota 429, CSRF/frozen/admin-only |
| `node --test tests/supabaseSchema.test.js` | **9/9 pass** — guardrail SQL tĩnh cho migration mới |
| `node --test tests/githubJobs.test.js` | **5/5 pass** — claim/lease/generation, heartbeat/progress, finish chuẩn hoá + chặn payload sai, release retry |
| `node --test tests/publication.test.js` | **10/10 pass** — mốc phát, window vs full, ẩn ván chưa công bố, replay/log/live gate, cancel |
| `node --test tests/uploadDisabled.test.js` | **2/2 pass** — policy matrix + admin/đội 403 `upload_disabled`, không tạo submission |
| `node --test tests/uploadTrustedDev.test.js` | **1/1 pass** — admin opt-in 201, đội vẫn 403, sai đuôi 400, không lộ `storage_path` |


| `node --test tests/*.test.js` | **282/282 pass**, exit 0 |
| `npm run build` | **pass** (4.79 s, exit 0) |

Môi trường: Windows, Node 24.18.0; không có test bị skip.

## DB thật — trạng thái & cách áp migration (24/10/2026)

Đã kiểm project thật `https://wsyfcgurnrowcuefwynx.supabase.co` bằng service role (không in key):

- `npm run db:verify` OK: participants 11, accounts 5, tournaments 1, entries 8, submissions 4, matches 0.
- **Đã apply**: `campus_foundation` (`maps`/`round_maps`/`games`), `shared_mvp_runtime_tables`
  (`mvp_tournaments`, `mvp_submissions`).
- **CHƯA apply (7 file, đúng thứ tự)**: `20261022150000_judge_monitor` → `20261023120000_live_stream`
  → `20261023160000_official_setup` → `20261024130000_github_intake` → `20261024150000_broadcast_schedule`
  → `20261024160000_github_jobs_worker` → `20261024170000_github_jobs_hardening`.
  Bằng chứng: REST `PGRST205` cho `mvp_match_logs`/`mvp_match_events`/`mvp_official_setups`/
  `mvp_repo_sync_jobs`/`mvp_match_broadcasts`; `PGRST202` cho `mvp_github_intake`/`mvp_github_claim`/
  `mvp_repo_connection_revoke`.
- **Chặn hiện tại**: máy chỉ có `SUPABASE_URL` + service role (PostgREST không chạy DDL), **không có**
  `SUPABASE_ACCESS_TOKEN`/`SUPABASE_DB_URL`, không có `psql`/Supabase CLI ⇒ chưa thể apply từ máy này.
- Công cụ đã thêm (dry-run mặc định): `npm run db:check-github` (probe bảng/RPC),
  `npm run db:apply-migrations` (xem kế hoạch), `npm run db:apply-migrations -- --apply` (apply).
  Runner kiểm baseline `mvp_tournaments`/`mvp_submissions`/`maps`, skip file đã apply, mỗi file một
  transaction, dừng ngay khi lỗi, kiểm lại object đại diện sau mỗi file.
- Cách cấp quyền (chọn 1) trong `.env`:
  `SUPABASE_ACCESS_TOKEN=sbp_...` (Personal Access Token) **hoặc**
  `SUPABASE_DB_URL=postgresql://postgres.<ref>:<password>@<host>:5432/postgres` (cần `psql`).
  Sau đó: `npm run db:apply-migrations -- --apply --smoke` (apply rồi chạy `supabase/tests/github_intake.sql`
  trong transaction + ROLLBACK) → `node tools/cli/check-github-db.js`.
  `--smoke` dùng chính kênh DDL đã chọn nên chỉ cần MỘT credential, không bắt buộc cài `psql`.
- Chưa mở Start/deploy; consumer vẫn `enabled=false` cho tới khi 7 migration trên được apply + smoke PASS.


## NOT RUN / giới hạn

- **DB thật**: kết nối OK nhưng DDL chưa chạy (thiếu token/DB URL) → 7 migration vẫn chưa apply; chưa coi
  intake/job/receipt/broadcast là VERIFIED trên Postgres thật.

- **Postgres integration: NOT RUN**. Script `supabase/tests/github_intake.sql` (BEGIN/ROLLBACK) phủ hai
  worker, stale token/generation, duplicate finish, crash/retry, cutoff, revoke; chạy
  `psql "$OOTV2_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/github_intake.sql` trên project
  disposable. Chưa có credential nên DDL/RPC chỉ kiểm bằng guardrail tĩnh + mirror JS.
- **Worker claim job + tải blob `bot.py` tại SHA + validate**: thuộc H2/Khoa. Hiện job ở `queued`,
  receipt ở `resolving`; chưa có gì chuyển sang `fetching/checking/valid/invalid`.
- **GitHub thật** (repo private, GitHub App, rate limit thực): NOT RUN — mọi test inject `fetchImpl`.
- **Upload HTTP**: đã tắt mặc định cho đội (403 `upload_disabled`); admin chỉ bật bằng
  `OOTV2_ALLOW_ONLINE_UPLOAD=1`; offline USB không đi qua HTTP nên giữ nguyên.
- **UI/B2, browser QA**: thuộc Bảo; chưa có màn duyệt repo/poll job.

- **H3 mức UI live**: `/api/live` giờ bắt buộc đăng nhập; trang Live của Bảo cần hiện nhắc đăng nhập thay
  vì bảng trống (chưa sửa React — thuộc Bảo).
- **Chưa đo tải 50–200 viewer** và chưa chạy trên Supabase thật; mốc `visible_plies` mới kiểm bằng test.
- `state` trong `mvp_match_broadcasts` không tự chuyển sang `ended`: giai đoạn `ended` suy ra từ giờ server +
  `ply_interval_ms`; DB chỉ đổi khi admin đặt lại lịch hoặc hủy.

- **H2 mức Postgres**: `requireEventMember` và cổng upload đã kiểm bằng HTTP mock; chưa chạy trên project DB thật.
- **Quota**: còn race nhỏ giữa `count` và `INSERT` (hai request đồng thời cùng vượt quota 1 đơn vị); unique
  `(event,team,repo_id,sha,path)` vẫn chặn trùng. Chưa có API trả "quota còn lại".
- **UI B2/Bảo**: nút "Nộp file USB" phải giới hạn admin và hiển thị lỗi `upload_disabled` khi BTC chưa bật cờ.

## Blocker / rủi ro cần biết

- `approved=false` là mặc định: B2 cần màn admin duyệt (dùng `GET /repositories` + `PUT` kèm `team`),
  nếu không đội luôn thấy `pending_approval`/403 `repo_not_approved`.
- Chưa chặn hai đội khác nhau dùng cùng *owner* GitHub (chỉ chặn trùng `repo_id`); chưa xác minh
  ownership repo ngoài việc BTC duyệt tay.
- Chưa có API xem “quota còn lại” hay danh sách job gần đây cho UI (chỉ đọc theo `job id`).
- `mvp_official_setups.config.cutoff` là nguồn cutoff duy nhất; giải MVP không có setup chính thức
  thì chỉ kiểm `status='draft'`.

## Bước tiếp (đúng thứ tự, chưa làm)

1. **H2 worker (Khoa)**: claim job (`queued → leased`) qua `githubJobs.js`, tải blob `bot.py` tại SHA (bounded,
   verify regular file), kiểm size/UTF-8/hash + validate trên worker, tạo `mvp_submissions` valid và
   cập nhật receipt (`fetching → checking → valid|invalid|infrastructure`), giữ bản valid cũ khi lỗi.
2. **H4**: integration/ops trên project DB test, hai worker claim/retry.
3. Đo tải 50–200 viewer, chốt chu kỳ poll; rà UI Live/B2 sau khi API ổn định.

## Lịch sử checkpoint

- 24/10/2026: **Kiểm DB thật** — `db:verify` OK (11 đội, 1 giải, 4 submission); phát hiện **7 migration chưa
  apply**; thêm `db:check-github`/`db:apply-migrations` (dry-run mặc định, skip theo object, transaction từng
  file); bị chặn apply vì môi trường không có `SUPABASE_ACCESS_TOKEN`/`SUPABASE_DB_URL` hoặc `psql`.

- 24/10/2026: **Tích hợp consumer Khoa** — `processGithubJob` dùng envelope finish
  (`recorded = applied || alreadyFinished`, `leaseLost` → `lease_lost`); bỏ comment cũ về release thiếu
  lease vì `20261024170000` đã chặn; `githubConsumer` 12/12, tổng 247/247. Consumer vẫn `enabled=false`,
  chưa chạy Python/polling.

- 24/10/2026: **H2 hardening contract** — release bắt buộc lease còn hạn; finish trả envelope
  `already_finished`/`lease_lost` và kiểm submission cùng đội/valid/hash; claim chặn reclaim khi crash;
  thêm `DELETE /repository` (revoke → hủy job/frozen receipt) + guard `repo_sync_pending` khi start;
  `githubJobs` 5/5, `githubIntakeApi` 7/7, schema 9/9, tổng 247/247; script PostgreSQL NOT RUN.

- 24/10/2026: **H3 hardening live overview** — `/api/live/overview` lọc theo giải của đội
  (`getLiveOverview({eventIds})`); đội khác giải không thấy tên giải/đội/matches. `publication` 10/10,
  tổng 247/247 pass.

- 24/10/2026: **H2 audit + đóng cổng upload** — thêm `requireEventMember` cho connection/receipt/intake
  (403 `scope_denied`), chặn upload HTTP mặc định (`403 upload_disabled`; admin chỉ khi
  `OOTV2_ALLOW_ONLINE_UPLOAD=1`); test `uploadDisabled`/`uploadTrustedDev`, tổng 215/215 pass.

- 24/10/2026: **H1 fix + worker contract** — sửa `previous_valid_submission_id` (dùng `submission_id`, bỏ
  receipt chưa có submission) và thêm `generation` + `mvp_github_claim/heartbeat/progress/finish/release`
  (lease token + generation, finish nguyên tử submission+receipt, release retry backoff);
  `tests/githubJobs.test.js` 5/5, tổng 212/212 pass.

- 24/10/2026: **H3 done (mock-verified)** — `mvp_match_broadcasts` + 4 route (list/viewer/admin
  schedule/cancel), chặn xem ẩn danh và ẩn result/standings/bracket/replay/log của ván chưa công bố;
  `tests/publication.test.js` 9/9, tổng 129/129 pass, build pass; Postgres integration NOT RUN.

- 24/10/2026: **H1 done (mock-verified)** — commit `be22c09`: migration approval/job/receipt + 6 route +
  DTO cho B2; test 120/120 pass, build pass; migration chưa apply remote, Postgres integration NOT RUN.
- 23/10/2026: tạo khung bàn giao, chưa thực hiện thay người được giao.
