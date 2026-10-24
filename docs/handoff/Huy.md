# Kết quả Huy — Backend / GitHub / privacy

## Đợt 25/10/2026 (Lần 2) — Sửa & Xác minh hoàn tất 5 Findings RC (H1–H5 theo docs/21)

- **Phạm vi:** Xử lý toàn bộ findings kỹ thuật tại [docs/DEPLOY-REVIEW-2026-10-25.md](../DEPLOY-REVIEW-2026-10-25.md) theo kịch bản [docs/21-KICH-BAN-SUA-VA-VERIFY-RC.md](../21-KICH-BAN-SUA-VA-VERIFY-RC.md).
- **H1 — Chặn lộ kết quả trước giờ reveal (P1):**
  - Tạo hàm whitelist `sanitizeOfficialGame(game, { reveal, isAdmin })` trong `server/services/officialBroadcasts.js`.
  - Khi `reveal_result = false` và tài khoản không phải admin: các key nhạy cảm `result`, `replay_hash`, `recorded_at` **hoàn toàn vắng mặt** trong JSON trả về của `officialBroadcastState` và `listPublishedOfficialGames` (không chỉ là `null`).
  - Đã bổ sung regression test trong `tests/officialBroadcast.test.js` (10/10 PASS).
- **H2 — Publication gate cho standings, bracket, tickets (P1):**
  - Thêm helper `getRoundBroadcastStatuses(roundPk)` kiểm tra authoritative broadcast state từ cơ sở dữ liệu.
  - `GET /published/standings`: Chỉ công bố khi vòng bảng `frozen = true` VÀ 100% ván đấu vòng bảng có `reveal_result = true`.
  - `GET /published/bracket`: Chỉ công bố khi vòng bảng đã phát xong; các series knockout đang phát bị giấu outcome đối với thành viên giải, chỉ hiển thị khi đã broadcast `reveal_result = true`.
  - `GET /published/tickets`: Chỉ công bố khi toàn bộ vòng bảng và 100% series knockout đã hoàn tất phát sóng (`reveal_result = true`).
  - Đã bổ sung 3 test cases trong `tests/officialPublishedRoutes.test.js` (12/12 PASS).
- **H3 — Sửa query danh sách ván theo schema thật (P1):**
  - Sửa `loadGames` trong `server/services/officialBroadcasts.js`: loại bỏ hoàn toàn các cột không tồn tại trong `mvp_official_games` (`series_id`, `reason`, `ply_count`); chỉ select các cột thực tế (`round_pk, game_key, stage, group_name, game_no, red_participant_id, blue_participant_id, result, replay_hash, recorded_at`).
  - Lấy `totalPlies` từ attempt `succeeded` mới nhất trong bảng `mvp_official_job_attempts`.
- **H4 — Bounded cutoff batch và tiến độ authoritative (P1):**
  - `server/services/githubCutoff.js`: Đặt trần `DEFAULT_BATCH_LIMIT = 5`, `MAX_BATCH_LIMIT = 10`, và time budget `MAX_BATCH_TIME_MS = 20000` (ngắt an toàn dưới timeout 30s của Vercel).
  - Loại trừ các đội đã `pinned` trước khi chia batch, bảo đảm không lãng phí slot limit.
  - Trả về `remaining` và `complete` authoritative dựa trên toàn bộ approved connections của giải.
  - Đã bổ sung 2 test cases trong `tests/githubCutoff.test.js` (9/9 PASS).
- **H5 — Login throttle fallback không đếm đôi (P2):**
  - `server/lib/loginThrottle.js`: Bỏ việc bump local trước ngoài Promise. Khi có RPC, chỉ fallback bump local đúng 1 lần duy nhất khi RPC thất bại hoặc timeout.
  - Đã bổ sung 2 regression tests trong `tests/loginThrottle.test.js` (7/7 PASS), kiểm tra 10 lần liên tiếp allowed và lần 11 mới bị chặn khi RPC gặp sự cố.
- **Bằng chứng kiểm thử tổng thể:**
  - `npm test`: **491/491 tests PASS** (100% thành công, 0 fail, 0 skip).
  - `npm run build`: **Vite build sạch** (1,656 modules).

---

## Đợt 25/10/2026 — Hoàn tất 3 phần việc Backend / Auth / Cutoff (RC online tối giản)

- **Phạm vi:** Hoàn thành toàn bộ gói được giao cho Huy tại [docs/20-RC-ONLINE-TOI-GIAN.md](../20-RC-ONLINE-TOI-GIAN.md) và [docs/assignments/Huy.md](../assignments/Huy.md).
- **Mục 1 — API Kết quả công bố cho Đội thi:**
  - Giữ nguyên 7 route admin điều hành kín.
  - Thêm 4 route cho thành viên giải:
    - `GET /events/:id/official/published/standings` (yêu cầu round freeze).
    - `GET /events/:id/official/published/bracket` (yêu cầu round freeze).
    - `GET /events/:id/official/published/tickets` (yêu cầu knockout complete).
    - `GET /events/:id/official/published/games` (danh sách ván đã lên lịch/đang phát sóng).
  - `server/services/officialBroadcasts.js`: thêm `listPublishedOfficialGames`.
  - `tests/officialPublishedRoutes.test.js`: 9/9 PASS.
- **Mục 2 — Cutoff Batch có Tiến độ & Retry giữ SHA/policy:**
  - `server/services/githubCutoff.js`:
    - `getCutoffStatus({ eventId })`: Trả về tiến độ chi tiết (tổng đội, pinned_count, busy_count, pending_count, complete, danh sách đội chi tiết).
    - `syncAllAtCutoff({ eventId, teamIds, limit })`: Hỗ trợ retry danh sách đội chỉ định mà không ghi đè các đội đã pin (giữ nguyên SHA/receipt bất biến).
  - Mount route trong `server/shared/router.js`:
    - `GET /events/:id/github-cutoff-status` (admin).
    - `POST /events/:id/github-cutoff-sync` (admin, nhận `team_ids`, `limit`).
  - `tests/githubCutoff.test.js`: 7/7 PASS (thêm test status và retry teamIds).
- **Mục 3 — Login Throttle dùng chung Supabase:**
  - Migration: `supabase/migrations/20261026170000_shared_login_throttle.sql` (bảng `mvp_login_attempts`, RPC `mvp_login_throttle_hit`, `mvp_login_throttle_reset`).
  - `server/lib/loginThrottle.js`: Gọi RPC phân tán, tự động fallback an toàn về in-memory nếu DB/mạng gián đoạn.
  - Tích hợp async/await vào route `/login` trong `server/shared/router.js`.
  - Khai báo PLAN trong `tools/cli/apply-migrations.js` (chưa apply remote, tuân thủ quy tắc safety gate).
  - `tests/loginThrottle.test.js`: 5/5 PASS.
  - `tests/supabaseSchema.test.js`: 11/11 PASS.
- **Hợp đồng & Tài liệu:**
  - Cập nhật mục 7 và thêm mục 8 trong `docs/19-CONTRACT-TICH-HOP.md` cho Bảo và Khoa.
- **Bằng chứng kiểm thử tổng thể:**
  - `npm test`: **467/467 tests PASS** (100%).
  - `npm run build`: **Pass** (1,656 modules transformed sạch sẽ).
  - Không có cảnh báo hay lỗi cú pháp.

---

## Đợt 24/10/2026 — Backend Chung kết thủ công + rà gate API/DB (RC)

- Phạm vi: toàn gói backend theo [docs/18](../18-CHOT-HOAN-THIEN-VA-NGHIEM-THU.md) và
  [contract](../19-CONTRACT-TICH-HOP.md), **không chỉ H1**. Áp dụng cho module mới; không sửa
  engine/runner của Khoa, không sửa UI của Bảo, giữ Campus v2 + Supabase-only + online GitHub capture.
- Code mới: `server/services/manualFinal.js`, `server/routes/manualFinal.js`,
  `server/shared/manualFinalJobs.js`, migration `supabase/migrations/20261026100000_manual_final.sql`,
  mount tại `/api/local/manual-finals` trong `server/shared/router.js` (admin-only, CSRF, no-store).
- Bảo mật/provenance: intake `manual_final` tách khỏi GitHub; không giả receipt/SHA; hash + thời gian +
  actor do server ghi; `storage_path` và lease token **không** trả trong DTO; source chỉ tải qua route
  admin riêng (`/submissions/:sid/source`, kiểm lại sha256/byte_size trước khi trả).
- Ghi DB có nguyên tử/fence ở SQL: chọn/khóa/pair/cancel/claim/finish/release là RPC `SECURITY DEFINER`
  (`set search_path=''`), cấm REST sửa bytes/hash/snapshot/result (revoke cả `service_role` rồi cấp
  column-level grant), audit append-only, một ván chỉ một kết quả accepted.
- Upload không dùng cờ `OOTV2_ALLOW_ONLINE_UPLOAD`; đội online vẫn bị `upload_disabled` (đã test lại).

### Bằng chứng đã chạy (exit 0)

| Lệnh | Kết quả |
| --- | --- |
| `npm test` | **372/372 pass**, 0 skip |
| `node --test tests/manualFinalApi.test.js` | 9/9 — quyền/CSRF/IDOR, upload/dup, chọn/khóa, pair idempotent, cancel/rerun, finish fence/duplicate, release retry, replay/download |
| `node --test tests/manualFinalDrill.test.js` | 5/5 — drill luôn một transaction + ROLLBACK, chặn COMMIT, có chế độ “schema đã apply” |
| `node --test tests/supabaseSchema.test.js` | 10/10 — +1 test tĩnh cho migration manual final |
| `npm run build` | pass (Vite) |
| `npm run db:apply-migrations -- --apply --smoke` | **OK 2/2 + smoke PASS** (24/10/2026): `20261025100000_cutoff_capture` + `20261026100000_manual_final`, mỗi file một transaction |
| `npm run db:check-github` | mọi bảng HTTP 200; RPC trả domain error (`event_not_found`, `bad_lease`), không còn `PGRST202` |
| `npm run db:verify` | counts **16/11/2/12/28/4** đúng như trước apply; `apiAuthCsrfLogout: true` |
| `npm run db:manual` | **PASS** ở chế độ đã-apply (drill trong một transaction, ROLLBACK) |

### Môi trường đã chốt (24/10/2026)

- Project đích = `wsyfcgurnrowcuefwynx` (**OTTv2-G5**, ACTIVE_HEALTHY) — project duy nhất mà
  `SUPABASE_ACCESS_TOKEN` hiện tại truy cập được (`GET /v1/projects` chỉ trả project này).
- `ftzockzolisecnyhlwej` nêu trong `PRODUCTION-BOOTSTRAP.md` **không** truy cập được bằng token này;
  muốn dùng project đó phải cấp URL/token mới rồi chạy fresh bundle + 2 migration này.
- Snapshot dữ liệu trước khi apply: `data/backup-before-step0.json` (gitignored, không chứa secret).

### NOT RUN / blocker (không đổi thành PASS)

- Worker Khoa chưa consume `claimManualFinalJobs`/`finishManualFinalJob`; chưa có VM/sandbox thật
  cho job `match`/`validate`.
- Bảo chưa nối UI vào API (panel hiện chạy state cục bộ).
- Browser E2E, load 50/100/200 viewer, **restore rehearsal** (đã có snapshot dữ liệu, chưa diễn tập
  phục hồi), `npm audit`/secret scan lại: **NOT RUN**.


### Tích hợp sau merge `origin/dev` (e0d88d4)

- Đã merge `origin/dev` (Bảo: `ManualFinalsPanel.jsx`, `tests/manualFinals.test.js`, dọn scope nộp bài)
  và giữ nguyên phần API/DB của Huy; `npm test` **371/371 pass**, `npm run build` pass sau merge.
- **Ranh giới cần Bảo nối tiếp:** `ManualFinalsPanel.jsx` hiện dùng state cục bộ (`Date.now()` cho match,
  hash bằng Web Crypto ở client, không gọi API) — chưa phải luồng thật và không được coi là bằng chứng
  E2E. Panel cần gọi đúng route mục 6.1 docs/19 (multipart + `x-csrf-token`), hiển thị trạng thái/lỗi
  từ server (`submission_not_valid`, `event_not_open`, `result_conflict`...), không tự tính hash/lock.
- Huy **không** sửa UI/runner của Bảo/Khoa trong đợt này.

### Hợp nhất hợp đồng với UI Bảo + review cookie + smoke API thật (24/10/2026)

- Nhận `origin/dev` (`918fab1`, `7773e47`): Bảo nối UI thật qua `src/tournament/portal/manualFinalApi.js`
  (mọi route khớp prefix `/api/local/manual-finals`, không còn nút giả/local-state).
- Sửa **phía API** để khớp UI đã xong (không sửa file UI của Bảo → tránh conflict):
  - `POST /manual-finals` trả thêm `id`/`name`/`status` ở top-level (giữ nguyên `{event, teams, …}`);
    trước đó UI đọc `created.id` nên đợt mới không được chọn.
  - `readiness.blockers` → **mảng chuỗi** (UI `join('; ')`); giữ chi tiết máy ở `blocker_details`
    `[{code, team_id, message}]`. Test `manualFinalApi` khoá cả 2 shape.
- Review thay đổi file dùng chung của Bảo: cookie session đổi `path '/api/local' → '/api'`.
  Kết luận: **giữ** (vì `/api/live/*` cũng `requireSession`), nhưng bổ sung xoá cookie legacy `/api/local`
  ở login **và** logout — nếu không, browser gửi cookie path dài trước và phiên mới bị che.
  Đã ghi vào docs/19 §1.
- Smoke API **thật** trên DB đã apply (script `data/smoke-manual-api.mjs`, gitignored):
  admin tạm → login + CSRF → tạo đợt → upload `.py` → upload trùng → mở intake → chặn chọn bài pending →
  chặn khóa khi chưa chọn → chặn pair khi chưa khóa vòng → chặn nhảy bước trạng thái → chặn thiếu CSRF →
  dọn sạch. Kết quả **16/16 PASS**; sau smoke counts trở lại `tournaments=2, accounts=11, manual_events=0`.
- Lưu ý vận hành: audit của manual final là **append-only chặn cả DELETE**; dọn dữ liệu drill/smoke phải
  tạm `disable trigger mvp_manual_final_audit_guard` trong một transaction rồi bật lại (chỉ owner/Management
  API), không thể qua REST. Không được tắt trigger ngoài dọn dẹp có kiểm soát.
- `npm test` **372/372 pass**, `npm run build` pass sau thay đổi.

### Review + apply hàng đợi official của Khoa (24/10/2026)

- Nhận `origin/dev` (`96f6231`, merge `e6ad2af`) gồm `officialWorker`, `officialJobs`, `officialExecution`,
  `officialOrchestration`, `officialKnockout` và migration `20261026090000_official_worker_jobs.sql`.
- **Review SQL (Huy):** RPC có fence đúng (`for update skip locked`, lease/generation → `lease_lost`,
  finish idempotent `already_recorded`/`result_conflict`, `unique(round_pk, game_key)`, `reap`, `notify pgrst`).
  Nhưng bảng `mvp_official_jobs`/`job_attempts` (và `rounds`/`games` từ migration cũ) đang cấp
  `INSERT/UPDATE` cho `service_role` ⇒ PostgREST có thể ghi đè `status/result` bỏ qua fence.
- **Đã thêm** `supabase/migrations/20261026110000_official_grants_hardening.sql`: `service_role` chỉ còn
  `SELECT` trên 4 bảng; browser không có quyền. Không đổi schema/RPC.
- **Đã apply** `20261026090000` + `20261026110000` bằng `db:apply-migrations -- --apply --smoke`
  (**OK 2/2**, smoke rollback PASS). Kiểm chứng: 2 bảng + 8 RPC tồn tại;
  `has_table_privilege('service_role', …, 'UPDATE'|'INSERT') = false`, `SELECT = true`, `anon = false`;
  REST `GET` jobs 200 nhưng `PATCH`/`POST` → **403 `42501`**. Counts dữ liệu không đổi
  (`tournaments=2, participants=16, matches=4, official_rounds=0`).
- `npm test` **395/395 pass**, `npm run build` pass; `db:check-github` không còn 404/5xx.
- **Dọn repo:** 7 file nháp `.tmp_*` do commit trước vô tình thêm vào đã được xoá khỏi git + thêm `/.tmp_*`
  vào `.gitignore` (nội dung chỉ là output git/docs/test, không có secret).
- **Cần Khoa nối tiếp:** worker hiện chỉ xử lý `mvp_official_jobs`; **manual final chưa có consumer**.
  Producer đã có (`mvp_manual_final_*` + `snapshot_json` + `mvp_manual_final_claim/finish/release`,
  client `server/shared/manualFinalJobs.js`) — đề nghị mở rộng `officialWorker` nhận thêm kind manual.
  Ghi chú “manual chưa có producer” trong `docs/handoff/Khoa.md` đã lỗi thời.
- **Còn lại của Huy:** API route cho official orchestration/knockout (`publishNextGame`, `roundProgress`,
  `groupStandings`, `freezeGroupRound`, `cancel/requeue job`, knockout/bracket/tickets), test route + smoke;
  sau đó drill 2 worker trên VM.

### API route vòng chính thức K3 (24/10/2026)

- Thêm `server/routes/official.js`, mount trong `server/shared/router.js`; **admin-only từng route**
  (không dùng middleware toàn cục để không chặn nhầm route khác).
- Endpoint (chi tiết DTO ở docs/19 §7): `GET .../official/progress|standings|bracket|tickets`,
  `POST .../official/publish|freeze|bracket/open`, `POST /official/jobs/:jobId/cancel|requeue` (reason 5..400).
- Nguyên tắc: resolve `group` round theo event ở server (client không truyền roundId), DTO bracket
  whitelist (không lộ `snapshot`, `artifactKey`, plan nội bộ), không tự tạo ván/kết quả.
- Kiểm thử: route test **6/6 PASS** (`data/officialRoutes.test.mjs`, gitignored theo quy tắc “không push
  file test tự sinh”) — auth 403 team/anonymous, DTO progress/standings, publish/freeze, bracket whitelist,
  cancel/requeue + actor, 404 `round_not_found`.
- Smoke API thật (admin tạm trên project đã apply): **12/12 PASS** — 401 anonymous, 404 `round_not_found`
  cho 7 endpoint khi event chưa mở vòng, 400 `reason_required`, 404 `job_not_found` (domain error), 403 thiếu CSRF.
- `npm test` **399/399 pass**, `npm run build` pass (route test nằm ngoài `tests/` nên không đổi con số).
- Bảo: nối UI theo docs/19 §7; Khoa: không cần đổi service, route chỉ gọi export hiện có.

### E2E online + bootstrap DB thật (24/10/2026)

- Token mới (có `sbp_`) **chỉ thấy project thật** `ftzockzolisecnyhlwej`; dev `wsyfcgurnrowcuefwynx` không
  còn quyền Management API (REST/service key vẫn dùng được).
- **DB thật đã bootstrap**: `node tools/cli/apply-migrations.js --bootstrap --apply --smoke` → 19 migration
  (gồm `shared runtime` 125205/125322 vừa thêm vào PLAN), heartbeat manual
  `20261026130000` (đổi tên từ `…120000` vì trùng version; file chưa từng apply remote) và
  `20261026140000_official_broadcast` (mới). Smoke PASS, dữ liệu rỗng. `db:verify`, `db:check-github`,
  `db:manual` PASS trên project thật; `mvp_official_*`/`mvp_manual_final_*` prosrc đã vá đúng.
- **Bug knockout (root cause)**: `nextSeriesGame` truyền cả kết quả ván phụ vào lần pin ván chính ⇒
  `assignNextOfficialGameColor` ném `Invalid color result` ⇒ `series_invalid` sau ván phụ đầu tiên.
  Đã lọc theo `mainGames`; test hồi quy `tests/officialKnockoutResolve.test.js`.
- **E2E dev**: `PASS 13/13` — intake 4/4, cutoff 4/4, vòng bảng 12/12, standings, freeze, knockout
  `bracket_complete` 4/4 (mọi series toàn hòa → thắng theo seed), vé `awarded=2/vacant=0`, replay 12/12.
- **Publication official**: migration + `server/services/officialBroadcasts.js` + 3 route
  (`PUT/GET …/broadcast`, `GET …/viewer`) + 8 unit test; rehearsal SQL trên DB thật (2 guard) và
  **E2E trên DB thật** bằng fixture tạm (window không lộ kết quả → `full` mở 12/12 replay → đội ngoài giải
  `scope_denied` → dọn sạch, đếm lại 0). Trên dev drill tự `SKIP` vì dev chưa có bảng này.
- **Còn NOT RUN**: browser E2E (Bảo), VM/2-worker thật (Khoa), restore rehearsal, và **UI viewer** cho
  publication official — Bảo nối theo contract `docs/19` §7.
- `npm test` **431/431**, `npm run build` pass, `git diff --check` sạch.
- **Chốt schema Huy ↔ Khoa** (`docs/HUY-KHOA-CHOT-SCHEMA-WORKER.md`): catalog/grants/ledger MATCH trên
  project thật; phát hiện + vá 2 lỗ (fencing lease official `20261026150000`, DELETE của service_role
  `20261026160000`); drill `tools/cli/worker-schema-drill.js` **PASS 17/17**; ledger
  `public.ootv2_schema_migrations` 21 dòng (thêm `--record-history` cho `apply-migrations`).
  Guard order đã xác nhận: `mvp_github_claim` trả `400/P0001 bad_worker` trước `bad_lease` (probe
  `worker-health.js` đang kỳ vọng sai); official/manual claim trả JSONB HTTP 200 (`bad_worker`), official
  claim **clamp** lease 30..3600 nên không có `bad_lease`.
- **RC: chưa ký.** Các gate còn lại thuộc Bảo (browser/UI, load 50/100/200, UI viewer publication) và Khoa
  (VM/2-worker thật, sandbox, restore); schema/DB/API/E2E của Huy đã xong và có log.


### Việc của người khác (không tự làm thay)

- Bảo: nối UI mục “Chung kết thủ công” theo DTO mục 6.3 của docs/19; migration **đã apply** nên có thể
  nối API thật ngay, fixture chỉ dùng để chạy song song trước khi nối.
  Góp ý nhỏ còn lại (không chặn): reload `detail` sau khi đổi trạng thái đợt, và map `blocker_details`
  nếu UI muốn hiện theo đội.
- Bảo: nối panel vòng chính thức với route mục 7 docs/19 (progress/standings/publish/freeze/bracket/
  tickets + cancel/requeue job có lý do); không tự tính kết quả/bracket ở client.
- Khoa: nối worker manual final (producer đã có) + chạy VM/2-worker thật; không tạo runner thứ hai.
- Operator: rehearsal DB/VM + restore rehearsal trước khi đóng gate RC.

## Trạng thái mới nhất

- Trạng thái: **H1/H2/H3 DONE — đã VERIFIED trên Postgres thật** (10/10 migration + smoke PASS,
  `db:check-github` 200/domain errors); **H4 mức DB DONE** (`npm run db:h4` 30/30 check, rồi dọn sạch).
  Chưa chạy consumer Khoa thật (polling + Python), chưa Start/deploy.
- Phạm vi: H1 trong [phân công Huy](../assignments/Huy.md).
- Commit: H1 `be22c09`; nối DB thật `cfc7a77` trên nhánh `dev` (đã push `origin/dev`).
- Migration `20261024130000_github_intake.sql`: **đã apply 24/10/2026** (cùng 9 file khác).
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

## DB thật — ĐÃ NỐI: 10 migration + smoke PASS (24/10/2026)

Project thật `https://wsyfcgurnrowcuefwynx.supabase.co`; DDL qua Management API (`SUPABASE_ACCESS_TOKEN`),
REST qua service role (không in key/token):

- `npm run db:verify` **OK** (24/10/2026, sau apply): driver `supabase`, `workerLeases: true`,
  `apiAuthCsrfLogout: true`; counts participants 11, accounts 6, tournaments 1, entries 8, submissions 4, matches 0.
- **Đã apply 10/10 migration** qua kênh DDL **Management API** (`SUPABASE_ACCESS_TOKEN`, không in token):
  `20261022150000_judge_monitor` → `20261023120000_live_stream` → `20261023160000_official_setup` →
  `20261024120000_mvp_match_map_snapshot` → `20261024130000_github_intake` →
  `20261024150000_broadcast_schedule` → `20261024160000_github_jobs_worker` →
  `20261024170000_github_jobs_hardening` → `20261024180000_lock_published_maps` →
  `20261025090000_official_schedule`.
- **Smoke PostgreSQL: PASS** — `npm run db:apply-migrations -- --apply --smoke` chạy
  `supabase/tests/github_intake.sql` (BEGIN/ROLLBACK) qua chính kênh DDL: hai worker claim,
  stale token/generation, duplicate finish, crash/retry, cutoff, revoke repo.
- **`npm run db:check-github`**: tất cả bảng HTTP 200 (`mvp_match_logs`, `mvp_match_events`,
  `mvp_match_bot_output`, `mvp_worker_state`, `mvp_official_setups`, `mvp_repo_connections`,
  `mvp_repo_sync_jobs`, `mvp_github_receipts`, `mvp_match_broadcasts`); RPC trả lỗi domain thay vì
  `PGRST202` (`mvp_github_intake`/`mvp_repo_connection_revoke` → `event_not_found`;
  `mvp_github_claim` → `bad_lease`).
- Ba lỗi thật phát hiện khi apply lần đầu (đã sửa, không phải lỗi DB):
  1. `20261024170000` dùng `CREATE OR REPLACE` cho `mvp_github_finish` nhưng đổi return type
     `boolean → jsonb` ⇒ PostgreSQL `42P13`; thêm `DROP FUNCTION IF EXISTS ...finish(uuid,uuid,integer,jsonb)`
     và `DROP ...claim(text,integer)` (overload 2 tham số cũ sẽ che bản 3 tham số mới của PostgREST).
  2. Cùng file: biến PL/pgSQL `j` trùng alias bảng `j` trong `mvp_github_claim` ⇒ `42702` "column
     reference j.id is ambiguous"; đổi alias thành `job`.
  3. `supabase/tests/github_intake.sql` thiếu `name_key` (NOT NULL UNIQUE từ `shared_mvp_runtime_tables`)
     ⇒ thêm `'pg đội a'`/`'pg đội b'`.
- Runner `apply-migrations` được vá thêm: NOTIFY `pgrst, 'reload schema'` + poll sau mỗi file (schema cache
  PostgREST từng làm probe REST báo FAIL oan), và đưa 3 migration mới vào kế hoạch (10 file thay vì 7).
- Vẫn **không** mở Start/deploy; consumer Khoa giữ `enabled=false` cho tới khi chạy thật 2 worker + Python.


## H4 — drill 2 worker thật trên Supabase (24/10/2026)

Công cụ: `npm run db:h4` (`tools/cli/h4-drill.js` + `tools/cli/h4-worker.js`). Kết quả **PASS 30/30**
trên project thật; baseline sau drill không đổi (`db:verify`: 11 participants, 6 accounts, 1 event,
8 entries, 4 submissions, 0 matches).

- **Hai worker = hai OS process** (`spawn(process.execPath, …, shell:false)`), claim song song 4 job:
  không job nào bị claim 2 lần, mỗi lần claim một lease token riêng, cả hai worker đều nhận việc;
  finish lần thứ hai trả `already_finished=true, applied=false`.
- **Crash/retry**: worker `H4_MODE=crash` claim rồi thoát ngay; hết lease 10 s, claim với
  `max_attempts=1` **không phát lại** job → `infra_fault` + receipt `infrastructure`, lease đã nhả.
- **Stale**: finish sai token và sai `generation` đều trả `lease_lost`; `progress` sai token → `false`;
  `release` sai token → `lease_lost`; `release` đúng → `queued` + backoff, reclaim `attempt=2,
  generation=2`; finish `valid` tạo submission và finish lặp **không** tạo submission thứ hai.
- **Revoke**: `mvp_repo_connection_revoke` hủy đúng 2 job chờ (`canceled`), receipt `frozen`.
- **Cutoff**: `mvp_official_setups.config.cutoff` trong quá khứ → intake trả `past_cutoff`.
- An toàn: drill **từ chối chạy** nếu `mvp_repo_sync_jobs` đang có job lạ (không tranh job thật);
  UUID ngẫu nhiên cho event/team; cleanup trong `finally` (receipts → jobs → connections → setups →
  entries → submissions → tournaments → participants) và assert `leftover=0`.
- Phụ trợ: `npm run db:sql -- "select …"` (mặc định chỉ SELECT; `--write` mới cho câu ghi) để đối soát.
- **Còn lại (chưa làm)**: chạy consumer Khoa thật (polling + Python) trên drill này, đo tải
  Preview/50–200 viewer, review security cuối. Chưa bật Start/deploy.

## NOT RUN / giới hạn

- **DB thật**: đã apply 10 migration + smoke PASS (mục trên). **Chưa** chạy consumer Python/polling thật,
  chưa Start trận, chưa deploy; smoke mô phỏng hai worker trong cùng transaction, chưa phải 2 tiến trình
  worker thật tranh `SKIP LOCKED` trên project (H4).

- **Postgres integration: PASS (smoke)**. `supabase/tests/github_intake.sql` (BEGIN/ROLLBACK) đã chạy thật
  qua Management API, không để lại dữ liệu: hai worker claim, stale token/generation, duplicate finish,
  crash/retry, cutoff, revoke repo. Chưa phải hai tiến trình worker thật tranh nhau (H4).
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
2. **H4 phần còn lại**: chạy consumer Khoa thật (polling + Python) trên drill; đo tải 50–200 viewer,
   rà UI Live/B2. Contract DB (2 worker, crash, stale, duplicate finish, revoke, cutoff) đã PASS `db:h4`.
3. Đo tải 50–200 viewer, chốt chu kỳ poll; rà UI Live/B2 sau khi API ổn định.

## Lịch sử checkpoint

- 24/10/2026: **H4 drill DB thật** — `npm run db:h4` PASS **30/30**: 2 worker OS process (pid khác nhau)
  claim 4 job không trùng, crash/retry (`max_attempts=1` chặn phát lại → `infra_fault`), stale token/generation
  → `lease_lost`, release → queued + reclaim `attempt=2`, duplicate finish không tạo submission thứ 2,
  revoke hủy job + frozen receipt, cutoff → `past_cutoff`; cleanup `leftover=0`, baseline `db:verify` không đổi.
  Thêm `tools/cli/db-sql.js` (`npm run db:sql`, mặc định chỉ SELECT) và test guardrail `tests/h4Drill.test.js`.

- 24/10/2026: **NỐI DB THẬT** — có `SUPABASE_ACCESS_TOKEN`; apply **10/10** migration qua Management API;
  smoke PostgreSQL **PASS**; `db:check-github` mọi bảng 200 + RPC trả domain error; `db:verify` OK
  (participants 11, accounts 6, tournaments 1, entries 8, submissions 4, matches 0). Sửa 3 lỗi thật:
  `42P13` return type `mvp_github_finish`, `42702` alias `j` trong `mvp_github_claim`, fixture thiếu `name_key`.
  Runner thêm NOTIFY reload schema cache + 3 migration mới (10 file).

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
