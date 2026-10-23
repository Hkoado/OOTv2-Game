# Káº¿t quáº£ Huy â€” Backend / GitHub / privacy

## Tráº¡ng thÃ¡i má»›i nháº¥t

- Tráº¡ng thÃ¡i: **H1 DONE (mock-verified)** â€” API + migration intake Ä‘Ã£ cÃ³, **chÆ°a cháº¡y Postgres tháº­t**;
  H2â€“H4 chÆ°a lÃ m.
- Pháº¡m vi: H1 trong [phÃ¢n cÃ´ng Huy](../assignments/Huy.md).
- Checkpoint nguá»“n: `3de220e`; **commit káº¿t quáº£ H1: `be22c09`** trÃªn nhÃ¡nh `dev` (Ä‘Ã£ push `origin/dev`).
- Migration `20261024130000_github_intake.sql`: **CHÆ¯A apply remote** (quy Æ°á»›c repo: cáº§n operator duyá»‡t).
- B2 (Báº£o) **cÃ³ thá»ƒ ná»‘i API tháº­t ngay**: route + DTO dÆ°á»›i Ä‘Ã¢y Ä‘Ã£ chá»‘t, cÃ³ test mock phá»§ quyá»n/lá»—i.

## H1 â€” route, DTO, quyá»n (Ä‘Ã£ chá»‘t cho B2/Khoa)

### Route (`server/shared/router.js`, service `server/services/githubIntake.js`)

| Method + path | Quyá»n | Tráº£ vá» |
| --- | --- | --- |
| `PUT /api/local/events/:id/repository` | team (chÃ­nh mÃ¬nh) / admin (kÃ¨m `team`) | `{connection}`; team â†’ `approved:false` (`pending_approval`), admin â†’ `approved:true` |
| `GET /api/local/events/:id/repository` | owner / admin (`?team=`) | `{connection}` |
| `GET /api/local/events/:id/repositories` | admin | `{connections:[{...,team_name}]}` (danh sÃ¡ch chá» duyá»‡t) |
| `POST /api/local/events/:id/submissions/from-github` | owner / admin (kÃ¨m `team`) | `202 {created, job, receipt}`; body `{repository?, branch?}` pháº£i khá»›p connection Ä‘Ã£ duyá»‡t |
| `GET /api/local/events/:id/submissions/from-github` | owner / admin | `{event:{id,status}, connection, receipt}` (receipt má»›i nháº¥t) |
| `GET /api/local/repo-sync-jobs/:id` | owner / admin | `{job, receipt}` |

- Cáº§n session cookie + `x-csrf-token` cho PUT/POST (guard chung `requireSession`); admin routes dÃ¹ng
  `requireLocalAdmin`. Origin láº¡ bá»‹ cháº·n bá»Ÿi middleware same-origin sáºµn cÃ³.
- KhÃ´ng route nÃ o clone, táº£i source, gá»i git hay cháº¡y Python. GitHub chá»‰ gá»i 2 endpoint metadata:
  `/repos/{owner}/{repo}` vÃ  `/repos/{owner}/{repo}/commits/{branch}`.

### DTO receipt (snake_case, khá»›p fixtures `src/tournament/portal/githubSyncState.js`)

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

- `status âˆˆ resolving|fetching|checking|valid|invalid|infrastructure|frozen`.
- Khi giáº£i Ä‘Ã£ báº¯t Ä‘áº§u (`status â‰  draft`), API tráº£ view `status:"frozen"` + `previous_status` + `note`
  (khÃ´ng sá»­a dá»¯ liá»‡u Ä‘Ã£ lÆ°u).
- KhÃ´ng tráº£ `storage_path`, token, lease token hay raw lá»—i GitHub. `source_hash`/`submission_id` do
  worker (H2/Khoa) Ä‘iá»n sau khi táº£i + kiá»ƒm `bot.py`.

### DTO job (ná»™i bá»™ cho worker, khÃ´ng lá»™ lease)

```json
{ "id": "uuid", "event_id": "uuid", "team_id": "uuid", "status": "queued", "attempt": 0,
  "available_at": "...", "error": null, "error_category": null, "created_at": "...", "updated_at": "..." }
```

`status âˆˆ queued|leased|running|completed|bot_fault|infra_fault|canceled`; DB cÃ³ thÃªm
`lease_token/lease_until` nhÆ°ng view loáº¡i bá».
### Ví dụ luồng gọi API cho B2

```text
# 1) Đội đăng ký repo (team session + header x-csrf-token)
PUT /api/local/events/<eventId>/repository
    {"repository":"https://github.com/team-delta/ootv2-bot","branch":"main"}
→ 200 {"connection":{...,"approved":false,"status":"pending_approval"}}

# 2) Admin duyệt (admin session)
PUT /api/local/events/<eventId>/repository
    {"team":"<participantId>","repository":"https://github.com/team-delta/ootv2-bot","branch":"main"}
→ 200 {"connection":{...,"approved":true,"status":"approved"}}

# 3) Đội yêu cầu đồng bộ (gọi lại cùng SHA an toàn: created=false)
POST /api/local/events/<eventId>/submissions/from-github   {}
→ 202 {"created":true,
       "job":{"id":"...","status":"queued","attempt":0},
       "receipt":{"id":"...","status":"resolving","commit_sha":"<40 hex>","repo_id":987654321,...}}

# 4) Poll trạng thái
GET /api/local/repo-sync-jobs/<job.id>                    → {"job":{...},"receipt":{...}}
GET /api/local/events/<eventId>/submissions/from-github   → {"event":{...},"connection":{...},"receipt":{...}}
```

Lưu ý UI: `status` chỉ sang `fetching/checking/valid/invalid` sau khi worker H2 xử lý job; hiện dừng ở
`resolving` cho tới khi H2 xong.



### MÃ£ lá»—i API (map tá»« envelope RPC, khÃ´ng lá»™ SQL)

`repo_not_approved` (403), `repo_taken` (409), `repository_changed` (409), `repository_not_found` (404),
`past_cutoff` (409), `event_frozen` (409), `quota_exceeded` (429), `missing_team` (400),
`github_rate_limited` (503), `github_timeout` (504), `github_unavailable` (503),
`github_auth_failed` / `github_forbidden` / `github_bad_response` (502).

## Schema / RPC (migration `20261024130000_github_intake.sql`, additive, CHÆ¯A apply)

- **Thứ tự áp dụng**: sau `20261022125205_shared_mvp_runtime_tables` (bảng `mvp_*`) và
  `20261023160000_official_setup` (RPC đọc `mvp_official_setups.config.cutoff`); migration này không sửa
  bảng cũ, chỉ thêm 3 bảng + 2 RPC.

- `mvp_repo_connections`: unique `(event_id, team_id)` + unique `(event_id, repo_id)` (má»™t repo/Ä‘á»™i trong
  giáº£i), `approved boolean`, `approved_by`, check `repository` lÃ  https://github.com/..., `file_path='bot.py'`.
- `mvp_repo_sync_jobs`: `commit_sha` 40-hex check, `status` 7 giÃ¡ trá»‹ ná»™i bá»™, `attempt`, `lease_token/until`,
  `available_at`, `error/error_category âˆˆ code|infrastructure|repo`, unique
  `(event_id, team_id, repo_id, commit_sha, file_path)`.
- `mvp_github_receipts`: `status` 7 giÃ¡ trá»‹ UI, `source_hash` 64-hex (nullable), `submission_id`,
  `previous_valid_submission_id`, `resolved_at`, cÃ¹ng unique key vá»›i job.
- RLS báº­t cáº£ 3 báº£ng; `REVOKE ALL ... FROM PUBLIC, anon, authenticated`; chá»‰ `service_role` select/insert/update.
- `mvp_repo_connection_upsert(...)`: kiá»ƒm giáº£i cÃ²n `draft`, membership, repo chÆ°a thuá»™c Ä‘á»™i khÃ¡c; tráº£
  `{ok, connection}` hoáº·c `{ok:false,error}`.
- `mvp_github_intake(...)`: `FOR UPDATE` giáº£i â†’ `event_frozen`; Ä‘á»c `mvp_official_setups.config->>'cutoff'`
  so `clock_timestamp()` â†’ `past_cutoff`; membership â†’ `not_in_event`; connection chÆ°a duyá»‡t â†’
  `repo_not_approved`; repo/branch lá»‡ch â†’ `repository_changed`; idempotent theo unique key; quota
  `count(distinct commit_sha)` 24h (máº·c Ä‘á»‹nh 10, `OOTV2_GITHUB_DAILY_QUOTA`); insert job `queued` +
  receipt `resolving` kÃ¨m `previous_valid_submission_id`; báº¯t `unique_violation` Ä‘á»ƒ tráº£ receipt cÅ©.
- Rollback (chá»‰ khi chÆ°a cÃ³ dá»¯ liá»‡u tháº­t): `DROP FUNCTION mvp_github_intake(uuid,uuid,uuid,text,text,text,
  bigint,text,integer); DROP FUNCTION mvp_repo_connection_upsert(uuid,uuid,text,bigint,text,text,boolean,uuid);
  DROP TABLE mvp_github_receipts, mvp_repo_sync_jobs, mvp_repo_connections;`

## Tests (mock â€” khÃ´ng cháº¡m DB/GitHub tháº­t)

| Lá»‡nh | Káº¿t quáº£ |
| --- | --- |
| `node --test tests/githubRepo.test.js` | **5/5 pass** â€” URL/branch, chá»‰ metadata, token á»Ÿ header, map lá»—i GitHub |
| `node --test tests/githubIntakeApi.test.js` | **6/6 pass** â€” duyá»‡t repo, 202 + receipt whitelist, idempotent SHA, cross-team 403, quota 429, CSRF/frozen/admin-only |
| `node --test tests/supabaseSchema.test.js` | **6/6 pass** â€” guardrail SQL tÄ©nh cho migration má»›i |
| `node --test tests/*.test.js` | **120/120 pass**, exit 0 |
| `npm run build` | **pass** (4.96 s, exit 0) |

MÃ´i trÆ°á»ng: Windows, Node 24.18.0; khÃ´ng cÃ³ test bá»‹ skip.

## NOT RUN / giá»›i háº¡n

- **Postgres integration**: chÆ°a cÃ³ disposable Supabase project/credential, nÃªn 2 RPC má»›i chá»‰ Ä‘Æ°á»£c kiá»ƒm
  báº±ng guardrail SQL tÄ©nh + mirror JS trong test â€” **chÆ°a VERIFIED trÃªn Postgres**.
- **Worker claim job + táº£i blob `bot.py` táº¡i SHA + validate**: thuá»™c H2/Khoa. Hiá»‡n job á»Ÿ `queued`,
  receipt á»Ÿ `resolving`; chÆ°a cÃ³ gÃ¬ chuyá»ƒn sang `fetching/checking/valid/invalid`.
- **GitHub tháº­t** (repo private, GitHub App, rate limit thá»±c): NOT RUN â€” má»i test inject `fetchImpl`.
- **Táº¯t upload HTTP cho Ä‘á»™i online** (H2) vÃ  publication/privacy (H3) chÆ°a lÃ m; route
  `POST /api/local/submissions/:team` váº«n hoáº¡t Ä‘á»™ng nhÆ° trÆ°á»›c.
- **UI/B2, browser QA**: thuá»™c Báº£o; chÆ°a cÃ³ mÃ n duyá»‡t repo/poll job.

## Blocker / rá»§i ro cáº§n biáº¿t

- `approved=false` lÃ  máº·c Ä‘á»‹nh: B2 cáº§n mÃ n admin duyá»‡t (dÃ¹ng `GET /repositories` + `PUT` kÃ¨m `team`),
  náº¿u khÃ´ng Ä‘á»™i luÃ´n tháº¥y `pending_approval`/403 `repo_not_approved`.
- ChÆ°a cháº·n hai Ä‘á»™i khÃ¡c nhau dÃ¹ng cÃ¹ng *owner* GitHub (chá»‰ cháº·n trÃ¹ng `repo_id`); chÆ°a xÃ¡c minh
  ownership repo ngoÃ i viá»‡c BTC duyá»‡t tay.
- ChÆ°a cÃ³ API xem â€œquota cÃ²n láº¡iâ€ hay danh sÃ¡ch job gáº§n Ä‘Ã¢y cho UI (chá»‰ Ä‘á»c theo `job id`).
- `mvp_official_setups.config.cutoff` lÃ  nguá»“n cutoff duy nháº¥t; giáº£i MVP khÃ´ng cÃ³ setup chÃ­nh thá»©c
  thÃ¬ chá»‰ kiá»ƒm `status='draft'`.

## BÆ°á»›c tiáº¿p (Ä‘Ãºng thá»© tá»±, chÆ°a lÃ m)

1. **H2**: worker claim job (`queued â†’ leased`), táº£i blob `bot.py` táº¡i SHA qua GitHub API (bounded,
   verify regular file), kiá»ƒm size/UTF-8/hash + validate trÃªn worker, táº¡o `mvp_submissions` valid vÃ 
   cáº­p nháº­t receipt (`fetching â†’ checking â†’ valid|invalid|infrastructure`), giá»¯ báº£n valid cÅ© khi lá»—i.
2. **H2**: táº¯t upload HTTP máº·c Ä‘á»‹nh cho Ä‘á»™i online (opt-in admin/trusted-dev), giá»¯ import offline.
3. **H3**: publication/privacy. **H4**: integration/ops trÃªn project DB test, hai worker claim/retry.

## Lá»‹ch sá»­ checkpoint

- 24/10/2026: **H1 done (mock-verified)** â€” commit `be22c09`: migration approval/job/receipt + 6 route +
  DTO cho B2; test 120/120 pass, build pass; migration chÆ°a apply remote, Postgres integration NOT RUN.
- 23/10/2026: táº¡o khung bÃ n giao, chÆ°a thá»±c hiá»‡n thay ngÆ°á»i Ä‘Æ°á»£c giao.
