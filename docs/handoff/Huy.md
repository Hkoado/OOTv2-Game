# Kết quả Huy — Backend / GitHub / privacy

## Trạng thái mới nhất

- Trạng thái: **H1 DONE (mock-verified)** — API + migration intake đã có, **chưa chạy Postgres thật**;
  H2–H4 chưa làm.
- Phạm vi: H1 trong [phân công Huy](../assignments/Huy.md).
- Checkpoint nguồn: `3de220e`; **commit kết quả H1: `be22c09`** trên nhánh `dev` (đã push `origin/dev`).
- Migration `20261024130000_github_intake.sql`: **CHƯA apply remote** (quy ước repo: cần operator duyệt).
- B2 (Bảo) **có thể nối API thật ngay**: route + DTO dưới đây đã chốt, có test mock phủ quyền/lỗi.

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

### Mã lỗi API (map từ envelope RPC, không lộ SQL)

`repo_not_approved` (403), `repo_taken` (409), `repository_changed` (409), `repository_not_found` (404),
`past_cutoff` (409), `event_frozen` (409), `quota_exceeded` (429), `missing_team` (400),
`github_rate_limited` (503), `github_timeout` (504), `github_unavailable` (503),
`github_auth_failed` / `github_forbidden` / `github_bad_response` (502).

## Schema / RPC (migration `20261024130000_github_intake.sql`, additive, CHƯA apply)

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

| Lệnh | Kết quả |
| --- | --- |
| `node --test tests/githubRepo.test.js` | **5/5 pass** — URL/branch, chỉ metadata, token ở header, map lỗi GitHub |
| `node --test tests/githubIntakeApi.test.js` | **6/6 pass** — duyệt repo, 202 + receipt whitelist, idempotent SHA, cross-team 403, quota 429, CSRF/frozen/admin-only |
| `node --test tests/supabaseSchema.test.js` | **6/6 pass** — guardrail SQL tĩnh cho migration mới |
| `node --test tests/*.test.js` | **120/120 pass**, exit 0 |
| `npm run build` | **pass** (4.96 s, exit 0) |

Môi trường: Windows, Node 24.18.0; không có test bị skip.

## NOT RUN / giới hạn

- **Postgres integration**: chưa có disposable Supabase project/credential, nên 2 RPC mới chỉ được kiểm
  bằng guardrail SQL tĩnh + mirror JS trong test — **chưa VERIFIED trên Postgres**.
- **Worker claim job + tải blob `bot.py` tại SHA + validate**: thuộc H2/Khoa. Hiện job ở `queued`,
  receipt ở `resolving`; chưa có gì chuyển sang `fetching/checking/valid/invalid`.
- **GitHub thật** (repo private, GitHub App, rate limit thực): NOT RUN — mọi test inject `fetchImpl`.
- **Tắt upload HTTP cho đội online** (H2) và publication/privacy (H3) chưa làm; route
  `POST /api/local/submissions/:team` vẫn hoạt động như trước.
- **UI/B2, browser QA**: thuộc Bảo; chưa có màn duyệt repo/poll job.

## Blocker / rủi ro cần biết

- `approved=false` là mặc định: B2 cần màn admin duyệt (dùng `GET /repositories` + `PUT` kèm `team`),
  nếu không đội luôn thấy `pending_approval`/403 `repo_not_approved`.
- Chưa chặn hai đội khác nhau dùng cùng *owner* GitHub (chỉ chặn trùng `repo_id`); chưa xác minh
  ownership repo ngoài việc BTC duyệt tay.
- Chưa có API xem “quota còn lại” hay danh sách job gần đây cho UI (chỉ đọc theo `job id`).
- `mvp_official_setups.config.cutoff` là nguồn cutoff duy nhất; giải MVP không có setup chính thức
  thì chỉ kiểm `status='draft'`.

## Bước tiếp (đúng thứ tự, chưa làm)

1. **H2**: worker claim job (`queued → leased`), tải blob `bot.py` tại SHA qua GitHub API (bounded,
   verify regular file), kiểm size/UTF-8/hash + validate trên worker, tạo `mvp_submissions` valid và
   cập nhật receipt (`fetching → checking → valid|invalid|infrastructure`), giữ bản valid cũ khi lỗi.
2. **H2**: tắt upload HTTP mặc định cho đội online (opt-in admin/trusted-dev), giữ import offline.
3. **H3**: publication/privacy. **H4**: integration/ops trên project DB test, hai worker claim/retry.

## Lịch sử checkpoint

- 24/10/2026: **H1 done (mock-verified)** — commit `be22c09`: migration approval/job/receipt + 6 route +
  DTO cho B2; test 120/120 pass, build pass; migration chưa apply remote, Postgres integration NOT RUN.
- 23/10/2026: tạo khung bàn giao, chưa thực hiện thay người được giao.



