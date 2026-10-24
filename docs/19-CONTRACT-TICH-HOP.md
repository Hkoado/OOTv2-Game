# Contract phối hợp cho đợt hoàn thiện

**Cập nhật 25/10/2026:** phạm vi và ownership theo [Hướng dẫn vận hành](runbook/BAN-TO-CHUC.md).
Huy chốt với Bảo hai boundary kết quả đã công bố/cutoff batch bằng DTO + fixture versioned
trước khi nối; tái sử dụng mapping sẵn có, không coi endpoint đề xuất là đã implement.
Khoa sở hữu config/package/Vercel và tổng hợp RC; health UI chỉ nối nếu thực sự cần.
Manual E2E tạm hoãn, mọi nguyên tắc ACL/provenance/fencing bên dưới vẫn giữ nguyên.

Ngày 24/10/2026. Đi cùng [Hướng dẫn vận hành](runbook/BAN-TO-CHUC.md).
Đây là **contract ngữ nghĩa bắt buộc**, không khẳng định các route/RPC dưới đây đã tồn tại.
Nhóm map vào exports/routes/schema thật trước khi code từng boundary; không tạo tên trùng hoặc
đường chạy song song chỉ để khớp tài liệu. Bảng mapping ở cuối chưa được coi là contract wire đã xong.

## 1. Quy tắc chung

- ID ổn định, version schema rõ; thời gian server/DB UTC ISO, UI định dạng theo timezone có nhãn.
- Producer chỉ trả DTO whitelist; UI không nhận service key, token lease, source, storage key hoặc
  snapshot private chỉ để hiển thị trạng thái. Admin tải source nếu nghiệp vụ cho phép là endpoint riêng có ACL.
- Mọi write kiểm session/CSRF/role/scope tại server. Hidden control không phải authorization.
- Cookie phiên: `HttpOnly`, `SameSite=strict`, `Secure` khi HTTPS; **path `/api`** (không chỉ `/api/local`) vì
  `/api/live/*` cũng dùng `requireSession`. Khi đổi path phải xoá cookie path cũ (`/api/local`) lúc login/logout,
  nếu không browser gửi cookie cũ trước và phiên mới bị che.
- Bảng runtime chỉ ghi qua RPC `SECURITY DEFINER` có fence (lease/generation/chain): `service_role` **chỉ được
  `SELECT`** trên `mvp_official_rounds/games/jobs/job_attempts` và `mvp_manual_final_*`; cấp `INSERT/UPDATE`
  bảng sẽ cho PostgREST bỏ qua fence (ví dụ PATCH thẳng `status='succeeded'` hoặc `result`).
- Idempotency cho request retry; optimistic version cho draft; transaction cho khóa/chọn/claim/finish.
- Dùng error envelope/code hiện có, bổ sung code có test nếu thiếu. UI phân biệt forbidden,
  conflict/frozen, validation, infrastructure; không suy thành công từ HTTP 202 hay trạng thái process.
- Fixture cùng schema với API thật, test producer/consumer, tests không gọi mạng thật mặc định.

## 2. Các boundary phải thống nhất

| Boundary | Producer → consumer | Dữ liệu/điều kiện tối thiểu |
| --- | --- | --- |
| Intake/readiness | Huy → Bảo/Khoa | event/team, receipt/job ID, pinned SHA/hash, trạng thái và lý do, ready/blockers; latest khác locked |
| Snapshot | Huy + Khoa → runtime | immutable source identity + map/rules/protocol/runtime/budget + seed + round; provenance phù hợp intake mode |
| Schedule | Khoa → Huy/Bảo | round/game identity, seq/prefix/version, red/blue, map/seed, trạng thái, màu persist trước chạy |
| Execution | Khoa ↔ persistence Huy review | job/attempt, lease token/generation, heartbeat, input hashes, accepted result/replay; fencing mọi ghi liên quan |
| Standings/bracket/vé | Khoa → Huy/Bảo | điểm ván/cặp tách biệt, tie-break/seed, tiến độ, next stage/ticket provenance; output kín trước công bố |
| Publication | Huy → Bảo | server time, lịch phát, cursor/reset, chỉ visible moves và result được phép; API kiểm membership |
| Manual intake | Huy → Bảo/Khoa | event/round/team/submission ID, sourceKind manual, bytes/hash, người/thời gian nhận, trạng thái, version/locked |
| Manual judging | Huy/Bảo → Khoa | hai đội và submission đã khóa, map/runtime/seed/cấu hình cặp hợp lệ, idempotency; không latest lookup khi chạy |
| Health/control | Khoa → operator/API khi cần | intake health khác match execution readiness; schema/storage/runtime/attestation/capacity và blockers, không secret |

Không đổi các enum persistent hiện có cho đẹp; ghi mapping chính xác giữa enum DB/job và nhãn UI.
`valid` source/syntax không đồng nghĩa match đã chạy hoặc sandbox production được nghiệm thu.
Kết quả chính thức phải xuất phát accepted attempt, không chỉ thấy một artifact tồn tại.

## 3. Chung kết thủ công

**Bổ sung 24/10/2026 (Khoa, quyết định user):** manual heartbeat + expired-lease fencing
và accepted engine result/replay 0-ply được chuẩn bị trong migration additive
`20261026130000_manual_worker_heartbeat.sql` (đổi tên từ `20261026120000_…` vì trùng version với
`ko_round_roster_guard`; file chưa apply remote nên đổi tên an toàn). Thay ghi chú lịch sử
“chờ Huy heartbeat/0-ply” ở bên dưới; xem `KHOA-WORKER-RC.md` về order/gates.

- Intake mode phân biệt online GitHub và manual final; binding nằm ở đợt/vòng, kiểm ở server.
- Lifecycle ngữ nghĩa: draft → nhận/kiểm bài → chọn bài → locked → chấm → BTC xác nhận/chốt.
  Wire enum chọn theo code thật; không ép sửa enum cũ hoặc dùng status UI thay transaction.
- Upload scoped event/round/team, admin-only; một `.py` UTF-8 1..262144 bytes. Private artifact,
  server hash và server received time; filename người dùng không thành execution path.
- Validation/selection/lock không race: bài pending/invalid không khóa; chọn bài khác sau lock bị chặn.
  Không ghi đè submission cũ; job chấm pin snapshot, không đọc latest toàn đội.
- Snapshot manual không yêu cầu GitHub capture giả. Nó có provenance manual được validate riêng;
  không nới lỏng yêu cầu capture của online để hỗ trợ manual.
- Cùng worker/sandbox/budget/rules. Bot lỗi tính theo luật; infra retry cùng input, không tự forfeit.
- Cancel/rerun có actor/reason/link attempt cũ, không xóa audit; accepted result conflict phải chặn.
- Xác nhận đi tiếp không cho BTC tự giả engine result; không tự công bố manual finals cho đội.
- Không cần bundle/import offline hay API không mạng; không dùng cờ mở online upload toàn cục làm thiết kế.

## 4. Test contract tối thiểu

1. Admin/team/anonymous/cross-event; CSRF, upload size/type, path/redirect/source secrecy.
2. Upload trùng/retry, hai người chọn/khóa đồng thời, pending/invalid và thay bài sau khóa.
3. Online không nhận manual provenance; manual không cần GitHub nhưng không bỏ artifact validation.
4. Snapshot hash mismatch/runtime mismatch → không chạy. Duplicate/stale attempt → không ghi được kết quả.
5. Infra vs bot fault; replay của accepted attempt; retry không đổi map/source/seed.
6. Viewer không đọc kết quả kín/nước tương lai dù sửa cursor hoặc clock; manual admin-only.

## 5. Mapping wire thực tế — nhóm điền trước khi nối boundary

Đây là prerequisite nội bộ, không phải câu hỏi chờ người dùng duyệt tên endpoint. Mỗi owner
đối chiếu code thật, điền method/path hoặc export/RPC, request/response/error/version, tests
và consumer đã xác nhận. Chỉ đánh VERIFIED khi đã tích hợp và có test.

| Boundary | Owner chốt | Mapping/test/consumer | Trạng thái |
| --- | --- | --- | --- |
| Intake/readiness/publication | Huy, Bảo xác nhận | `PUT/GET/DELETE /api/local/events/:id/repository`, `POST/GET .../submissions/from-github`, `GET /repo-sync-jobs/:id`, `GET /broadcasts/:matchId`; test `githubIntakeApi`, `uploadDisabled`, `publication`; Postgres smoke `db:h4` 30/30 | VERIFIED (mock + DB smoke; browser chưa) |
| Snapshot/schedule/job/result/standings | Khoa + Huy, Bảo xác nhận DTO | `officialSchedule.js` + RPC `mvp_official_*`; `officialJobs.js` (claim/heartbeat/finish/fail/requeue/reap) sau `20261026090000`; grants siết bởi `20261026110000` (service_role chỉ `SELECT`, REST PATCH/POST → 403 `42501`); **route mục 7** (`server/routes/official.js`); test `officialSchedule`, `officialGroups`, `officialBracket`, `officialRounds`, `officialWorker` + route test 6/6 | PARTIAL — API route có, **UI Bảo chưa nối**, VM/2 worker chưa nghiệm thu |
| Manual intake/lock/judging | Huy + Khoa, Bảo xác nhận | Xem mục 6: route `/api/local/manual-finals/*`, RPC `mvp_manual_final_*`; test `manualFinalApi` (9), `manualFinalDrill` (5), `supabaseSchema` (+1); **migration đã apply 24/10/2026** (project OTTv2-G5) + drill PASS | IMPLEMENTED + APPLIED; UI/worker chưa nối (Bảo/Khoa) |
| Worker install/control/readiness | Khoa | Có scaffolding, cần sửa và nghiệm thu VM | NOT VERIFIED |


## 6. Mapping Chung kết thủ công — đã implement 24/10/2026 (Huy)

Nguồn: `server/services/manualFinal.js`, `server/routes/manualFinal.js`, `server/shared/manualFinalJobs.js`,
migration `supabase/migrations/20261026100000_manual_final.sql`, drill `supabase/tests/manual_final.sql`.

Nguyên tắc: **admin-only toàn bộ**, không dùng `OOTV2_ALLOW_ONLINE_UPLOAD`, không giả receipt/SHA GitHub,
API không chạy Python; `storage_path`/lease token không nằm trong DTO; intake mode `manual_final` gắn ở
đợt/vòng và không trộn với online.

### 6.1 Route (prefix `/api/local/manual-finals`, `requireSession` + `requireLocalAdmin` + CSRF)

| Method + path | Body | Trả về |
| --- | --- | --- |
| `GET /` | — | `{events:[eventView]}` |
| `POST /` | `{name, level, round_no?, team_ids[2..56], map, seed?}` | `201` event detail + **top-level `id`/`name`/`status`** (client hiện có dùng ngay sau khi tạo) |
| `GET /:id` | — | `{event, teams, submissions, matches, jobs, readiness, audit[20]}` |
| `POST /:id/status` | `{status:'intake'|'locked'|'closed', reason?}` | event detail |
| `POST /:id/close` | `{reason?}` | event detail (closed) |
| `POST /:id/submissions` | multipart `file` (`.py`, 1..262144 B) + field `team_id` | `201 {duplicate:false, submission}`; trùng bytes → `200 {duplicate:true}` |
| `GET /:id/submissions/:sid/source` | — | `text/x-python` + `X-Source-Sha256`, `no-store` |
| `POST /:id/submissions/:sid/select` | — | `{select:{team_id, submission_id, sha256, selected_at}}` |
| `POST /:id/lock` | `{team_id}` | `{lock:{team_id, submission_id, sha256, locked_at, already_locked}}` |
| `POST /:id/matches` | `{red_team_id, blue_team_id, series_id, game_no?, seed?, note?}` | `202 {pair:{match_id, job_id, snapshot_hash, idempotent:false}}`; gọi lặp → `200 idempotent:true` |
| `GET /:id/matches/:mid/replay` | — | `{match, replay}` — chỉ khi đã accepted |
| `POST /:id/matches/:mid/cancel` | `{reason}` (5..500) | `{cancel:{status:'canceled', previous_status, already_canceled}}` |
| `POST /:id/matches/:mid/rerun` | `{reason}` (5..500) | `202 {rerun:{match_id, rerun_of, snapshot_hash, idempotent}}` |


### 6.2 RPC (chỉ `service_role`, đã revoke PUBLIC/anon/authenticated)

| RPC | Vai trò |
| --- | --- |
| `mvp_manual_final_select(uuid,uuid)` | chọn 1 phiên bản; chặn khi đợt chưa `intake`, bài chưa `valid`, hoặc đội đã khóa |
| `mvp_manual_final_lock(uuid,uuid,uuid)` | khóa bài đã chọn của đội; khóa lặp idempotent |
| `mvp_manual_final_pair(jsonb,uuid)` | tạo match + job trong 1 transaction, idempotent theo key, không đọc "bài mới nhất" |
| `mvp_manual_final_cancel(uuid,uuid,text)` | hủy trận chưa accepted + hủy job chờ + audit; bắt buộc lý do |
| `mvp_manual_final_claim(text,integer,integer)` | worker claim 1..5 job với lease token + generation (`for update skip locked`) |
| `mvp_manual_final_finish(uuid,uuid,integer,jsonb)` | ghi kết quả/validation có fence; duplicate → `already_finished`; stale → `lease_lost` |
| `mvp_manual_final_release(uuid,uuid,integer,text,integer)` | retry cùng input + backoff, quá số lần → `infra_fault` |

### 6.3 DTO và mã lỗi cho Bảo

- `submissionView`: `{id,event_id,team_id,round_no,source_kind:'manual_final',filename,sha256,byte_size,status,error_code,error_message,received_at,received_by,selected,selected_at,locked,locked_at}` — **không có** `storage_path`.
- `matchView`: `{id,series_id,game_no,red,blue,seed,map_hash,snapshot_hash,color_policy,status,result,reason,ply_count,error_code,error_message,requested_at,started_at,finished_at,canceled_at,cancel_reason,rerun_of,replay_available,can_cancel,can_rerun}`.
- `readiness`: `{teams,locked_teams,pending_validations,matches:{queued,running,finished,bot_fault,infra_fault,canceled},can_lock_round,can_close,blockers,blocker_details}` — `blockers` là **mảng chuỗi** để UI join trực tiếp; chi tiết máy đọc ở `blocker_details: [{code,team_id,message}]`.
- Mã lỗi ổn định: `admin_required`, `csrf_required`, `event_not_open`, `event_not_locked`, `teams_not_locked`, `jobs_pending`, `bad_transition`, `submission_not_valid`, `submission_locked`, `not_selected`, `red_submission_not_locked`, `blue_submission_not_locked`, `same_team`, `result_conflict`, `rerun_not_allowed`, `reason_required`, `result_not_ready`, `artifact_integrity`, `scope_denied`, `bad_extension`, `binary_file`, `bad_encoding`, `file_too_large`.

### 6.4 Bàn giao cho Khoa (worker) và Bảo (UI)

- Khoa: `claimManualFinalJobs({worker,limit,leaseSeconds})` → job `validate` (tải artifact từ `storage_path` trong DTO worker, chạy syntax + protocol smoke) hoặc job `match` (chạy Campus trên `snapshot`); trả qua `finishManualFinalJob` / `releaseManualFinalJob`. Cùng sandbox/budget/engine, không runner thứ hai, không lookup latest.
- **Đã map vào code (24/10/2026, Khoa):** producer ở `server/shared/manualFinalJobs.js` + migration
  `20261026100000_manual_final.sql`; consumer ở `server/services/manualFinalExecution.js` và
  `server/officialWorker.js` (queue `manual`, `--manual` / `--all`). Mapping nội bộ:

  | Bước | Nguồn | Dùng bởi consumer |
  | --- | --- | --- |
  | Claim | `mvp_manual_final_claim(worker,limit,leaseSeconds)` → `jobs[]` (`job_id/kind/token/generation/attempt/input_hash`, `submission.storage_path`, `match.snapshot`) | `processManualFinalJob` (limit 1, lease manual 300 s) |
  | `validate` | artifact bytes theo `storage_path` + `sha256`/`byte_size` | static UTF-8/size → protocol smoke Campus v2 trong session sandbox |
  | `match` | `snapshot_json` pin (`manual-final-match.v1`) + submission ID đã khóa đọc lại theo ID | `verifyManualSnapshot` → tải/verify hash → `runCampusMatch` |
  | Finish | `mvp_manual_final_finish(job,token,generation,outcome)` | `valid`/`invalid` cho validate; `finished`(result,reason,ply_count,replay) / `bot_fault` / `infra_fault` cho match |
  | Retry | `mvp_manual_final_release(...,maxAttempts)` | lỗi hạ tầng retry cùng input; input sai vĩnh viễn dùng `maxAttempts=1` |
  | Fence | `lease_lost` / `already_finished` | `leaseLost` không tính là đã ghi; duplicate finish không nhân đôi |

  Ghi chú còn mở: (a) `finish` yêu cầu `ply_count >= 1` nên ván bot lỗi setup (0 ply) được ghi
  `bot_fault` + `setup_bot_fault`; (b) queue manual **chưa có RPC heartbeat**, consumer dùng lease
  300 s (trần claim 900 s); (c) `mvp_manual_final_claim` requeue job hết lease **mà không kiểm
  `attempt`/`max_attempts`**, nên worker bị kill lặp có thể đẩy `attempt` vượt CHECK 10 và làm
  hỏng cả transaction claim — cần migration additive (đề xuất trong
  [drill manual worker](DRILL-MANUAL-WORKER.md) §7). Ba điểm này cần được đối chiếu trước nghiệm thu.

  Drill/kiểm chứng: `npm run drill:manual-worker` (9 kịch bản 2 worker, không DB/Python),
  `node tools/cli/worker-health.js` (đã probe 2 bảng manual + `mvp_manual_final_claim`).
  Nhật ký và giới hạn: [DRILL-MANUAL-WORKER](DRILL-MANUAL-WORKER.md).
- Bảo: mọi route admin-only; chỉ hiển thị trạng thái/lý do; nạp file bằng multipart + `x-csrf-token`; không có form nhập điểm tay; không mở upload online cho đội.
- Migration **đã apply** ngày 24/10/2026 trên project `wsyfcgurnrowcuefwynx` (OTTv2-G5) cùng
  `20261025100000_cutoff_capture.sql`; `npm run db:manual` chạy drill trên schema đã apply (ROLLBACK).
  `apply-migrations.js` đã có 2 migration này trong PLAN. Consumer manual **đã có code + contract
  test**; browser E2E/VM acceptance và chạy worker trên DB thật vẫn **NOT RUN**.


## 7. Mapping vòng chính thức K3 — API route (Huy, 24/10/2026)

Nguồn: `server/routes/official.js` (mount trong `server/shared/router.js`), bọc service của Khoa
(`officialOrchestration`, `officialKnockout`). **Admin-only toàn bộ** (kết quả/bảng còn kín trước công bố).

| Method + path | Body | Trả về |
| --- | --- | --- |
| `GET /api/local/events/:id/official/progress` | — | `{round_id, roundId, eventId, round, frozen, games:{total,finished}, jobs:{total,byStatus,failed[]}, pending}` |
| `GET /api/local/events/:id/official/standings` | — | `{event_id, round_id, complete, games, series, tieBreakers, groups, qualifiers}` |
| `POST /api/local/events/:id/official/publish` | — | `{round_id, status:'published'|'pending'|'frozen', game}` |
| `POST /api/local/events/:id/official/freeze` | `{expected_games?}` | `{round_id, frozen, expectedGames}` |
| `GET /api/local/events/:id/official/bracket` | — | DTO bracket (xem dưới) |
| `POST /api/local/events/:id/official/bracket/open` | — | `202 {status:'opened'|'advanced', matchId, roundId, game}` hoặc `200 {status:'bracket_complete'|'blocked'}` |
| `GET /api/local/events/:id/official/tickets` | — | `{event_id, round_id, ranking, tickets}` (409 `bracket_incomplete` nếu chưa xong) |
| `POST /api/local/official/jobs/:jobId/cancel` | `{reason}` (5..400) | `{job_id, alreadyCancelled, reason}` |
| `POST /api/local/official/jobs/:jobId/requeue` | `{reason}` (5..400) | `{job_id, status, reason}` |
| `PUT /api/local/official/rounds/:roundPk/games/:gameKey/broadcast` | `{starts_at, ply_interval_ms?, release_mode?, state?}` | `{broadcast, game}` (admin) |
| `GET /api/local/official/rounds/:roundPk/games/:gameKey/broadcast` | — | `{broadcast:{phase,visible_plies,total_plies,reveal_result,...}, round_id, game}` (admin & thành viên giải khi published) |
| `GET /api/local/official/rounds/:roundPk/games/:gameKey/viewer?after_seq=` | — | `{schema_version:'official-broadcast.v1', phase, events[], reveal_result, ...}` (thành viên giải) |
| `GET /api/local/events/:id/official/published/standings` | — | `{published:true, event_id, round_id, complete, games, groups, ...}` (thành viên giải khi round đã freeze; 409 `round_not_published` nếu chưa) |
| `GET /api/local/events/:id/official/published/bracket` | — | `{published:true, event_id, round_id, series, qualifiers, ...}` (thành viên giải khi round đã freeze; 409 `round_not_published` nếu chưa) |
| `GET /api/local/events/:id/official/published/tickets` | — | `{published:true, event_id, round_id, ranking, tickets}` (thành viên giải khi knockout xong; 409 `tickets_not_published` nếu chưa) |
| `GET /api/local/events/:id/official/published/games` | — | `{published:true, event_id, round_id, games:[{game_key, stage, broadcast:{phase, ...}}]}` (danh sách ván đã công bố) |

Quy tắc publication official (`server/services/officialBroadcasts.js`, migration `20261026140000`):

- Chỉ đặt lịch cho ván **đã có kết quả accepted** (`game_not_scored` 409); `event_id` luôn lấy từ round,
  trigger `mvp_official_broadcast_guard` chặn `broadcast_event_mismatch` và `broadcast_game_not_scored`.
- Replay nguồn là `mvp_official_job_attempts.replay` của attempt `succeeded`; `total_plies` = số `events`.
- Viewer nhận `events` có `seq` đã tới hạn phát, không bao giờ có `result`/`replay` đầy đủ trước khi
  `reveal_result = true` (chỉ `release_mode='full'` khi đã phát xong hoặc `state='ended'`).
- `broadcast_not_published` (404) cho đội khi chưa công bố; đội ngoài giải bị `scope_denied`.

**DTO bracket** (whitelist, không lộ snapshot/artifact key):

```json
{ "event_id": "uuid", "round_id": "uuid", "schema_version": "campus-knockout.v1", "level": "weekly",
  "seed": 42, "expected": 4, "resolved": 1, "complete": false,
  "waiting": null, "next": {"match_id":"sf2","stage":"semifinal","round_id":"ko:semifinal:2","opened":false},
  "qualifiers": [{"participant_id":"uuid","group_name":"A","seed":1,"rank":1}],
  "series": [{"match_id":"sf1","stage":"semifinal","round_id":"ko:semifinal:1","complete":true,
              "reason":"winner","winner_participant_id":"uuid","loser_participant_id":"uuid",
              "administrative":false,"games_played":2}] }
```

- Mọi request resolve `group` round theo `:id` event ở server; client không truyền `roundId` tuỳ ý.
- `round_not_found` (404) khi event chưa mở vòng bảng; `reason_required` (400) cho cancel/requeue;
  `admin_required` (403) cho đội/anonymous; lỗi domain của DB giữ mã như `job_not_found`, `bad_lease`,
  `group_incomplete`, `bracket_incomplete`.
- Không route nào tự tạo ván/kết quả; `publish` chỉ enqueue đúng ván đã pin qua chain, worker Khoa ghi
  accepted result bằng RPC fence.

### 7.1 Kết quả E2E online (24/10/2026) — chuỗi repo → vé PASS, publication đã có backend

Chạy `node tools/cli/e2e-online-drill.js` trên `.envdev` (`wsyfcgurnrowcuefwynx`); GitHub API thay bằng
test double tại lớp `fetch`, Supabase/Storage/engine trusted-dev là thật. Log: `data/e2e-online-ko6.txt`.

| Chặng | Kết quả |
| --- | --- |
| repo (duyệt + job) → intake | PASS: 4 receipt `valid` + 4 submission (syntax + protocol smoke thật) |
| cutoff capture | PASS: 4 đội pin đúng SHA/receipt |
| mở vòng bảng | PASS: snapshot chính thức, 12 ván |
| chấm bằng engine | PASS: 12/12 ván accepted; job `succeeded`; replay ở `mvp_official_job_attempts.replay` |
| standings + khóa vòng | PASS: complete (4 qualifiers), `frozen=true` |
| knockout | **PASS**: `bracket_complete`, 4/4 series (semifinal ×2, final, third_place); series toàn hòa được giải bằng **seed** đúng hợp đồng `officialBracket` (không bịa thêm ván) |
| vé | **PASS**: `awarded=2`, `vacant=0`, xếp hạng đủ 4 đội |
| replay | PASS: 12/12 ván vòng bảng có `replay_hash` + replay trong attempts |
| publication official | E2E trên DB dev **SKIP** (dev thiếu migration `20261026140000` và không còn kênh DDL); đã chứng minh riêng: 8 unit test + rehearsal SQL trên DB thật (guards) + **E2E publication trên DB thật** (fixture tạm → window không lộ kết quả → `full` mở đủ 12/12 replay → đội ngoài giải `scope_denied` → xoá sạch, đếm lại 0) |

**Bug đã sửa (24/10):** `nextSeriesGame` truyền *toàn bộ* kết quả (kể cả ván phụ) vào lần pin ván chính;
`assignNextOfficialGameColor` từ chối kết quả ngoài danh sách nên series toàn hòa ném
`series_invalid: Invalid color result` sau ván phụ đầu tiên. Sửa: lọc kết quả theo `mainGames` trước khi pin;
regression test `tests/officialKnockoutResolve.test.js` (4 main + 2 phụ → thắng theo seed).

**DB thật `ftzockzolisecnyhlwej`:** token mới đã có quyền; đã apply **21 migration** bằng
`node tools/cli/apply-migrations.js --bootstrap --apply --smoke` (smoke PASS, dữ liệu rỗng), gồm cả
`20261026130000_manual_worker_heartbeat` (đổi tên từ `…120000` vì trùng version),
`20261026140000_official_broadcast`, `20261026150000_official_lease_fencing` (heartbeat/finish/fail từ chối
lease đã hết hạn) và `20261026160000_official_write_hardening` (bỏ DELETE của service_role trên ván/vòng).
`db:verify` + `db:check-github` + `db:manual` PASS trên project thật.

**Chốt schema với Khoa (24/10):** xem `docs/HUY-KHOA-CHOT-SCHEMA-WORKER.md` — bảng catalog/grants/ledger,
contract RPC thực tế từ `pg_proc`, thứ tự guard cho probe health, và drill
`tools/cli/worker-schema-drill.js --allow-project=<ref>` **PASS 17/17** (claim đồng thời, heartbeat fencing,
reclaim, worker cũ bị fence, duplicate finish, retry cap, 0-ply accepted, REST 403, dọn sạch). Ledger mới
`public.ootv2_schema_migrations` có **21 dòng** version+name+sha256.

Các quyết định sản phẩm đã chốt trong docs/18 không được thay đổi khi điền bảng này.

## 8. Cutoff batch tiến độ/retry và Login throttle phân tán (Huy, 25/10/2026)

Theo điều lệ [Hướng dẫn vận hành](runbook/BAN-TO-CHUC.md):

### 8.1 API Cutoff batch có tiến độ và retry giữ SHA
- `GET /api/local/events/:id/github-cutoff-status` (admin-only):
  - Trả về: `{ event_id, event_status, cutoff, reached, total_approved, pinned_count, busy_count, pending_count, complete, teams: [...] }`
  - Mỗi đội có `{ team_id, repository, branch, status: 'pinned'|'busy'|'pending', commit_sha, captured_at, receipt_id }`.
- `POST /api/local/events/:id/github-cutoff-sync` (admin-only):
  - Body: `{ team_ids?: string[], limit?: number }` (cho phép lọc retry chỉ định các đội bị lỗi mà không ảnh hưởng tới đội đã pin).
  - Trả về: `{ cutoff, policy:'cutoff-first-resolution.v1', total, queued, skipped, failed: [{ team_id, error }], remaining }`.

### 8.2 Login throttle phân tán qua Supabase
- Migration: `supabase/migrations/20261026170000_shared_login_throttle.sql`.
- Bảng `mvp_login_attempts` (RLS bật, cấm REST, chỉ RPC `SECURITY DEFINER`), RPC `mvp_login_throttle_hit(p_key, p_max, p_window_ms)`, `mvp_login_throttle_reset(p_key)`.
- Phân tầng bảo vệ:
  - `id:ip|username`: 10 lần / 60 giây (chặn brute-force tài khoản).
  - `ip:ip`: 60 lần / 60 giây (chặn quét từ một máy sau NAT).
  - Đăng nhập thành công chỉ reset bộ đếm cặp `id:ip|username`.
- Adapter Node.js: `server/lib/loginThrottle.js` tự động dùng RPC Supabase khi có kết nối, và fallback về in-memory Map nếu RPC/mạng gián đoạn.


### 8.3 Publication Gate authoritative và DTO Whitelist bảo mật kết quả kín (H1, H2, H3)
- **Publication Gate (H2)**:
  - `GET /events/:id/official/published/standings`: Chỉ công bố khi vòng bảng `frozen = true` VÀ 100% các ván vòng bảng có bản ghi broadcast với `reveal_result = true`. Nếu chưa: trả `409 round_not_published`.
  - `GET /events/:id/official/published/bracket`: Chỉ công bố khi toàn bộ vòng bảng đã phát sóng hoàn tất (`isRevealed = true`). Các series knockout đang thi đấu/phát sóng chỉ hiển thị outcome khi các ván tương ứng đã được broadcast `reveal_result = true`; series chưa phát xong bị giấu outcome đối với thành viên giải.
  - `GET /events/:id/official/published/tickets`: Chỉ công bố khi toàn bộ vòng bảng VÀ 100% các series knockout đã hoàn tất phát sóng (`reveal_result = true`). Nếu chưa: trả `409 tickets_not_published`.
- **DTO Whitelist bảo mật (H1)**:
  - `officialBroadcastState` và `listPublishedOfficialGames`: Khi `reveal_result = false` và tài khoản không phải admin, các trường `result`, `replay_hash`, `recorded_at` HOÀN TOÀN VẮNG MẶT khỏi object trả về.
- **Khớp Schema DB Thực Tế (H3)**:
  - Query `mvp_official_games` loại bỏ hoàn toàn các cột không tồn tại (`series_id`, `reason`, `ply_count`); chỉ select các cột thực có. `totalPlies` được tính authoritative từ `official_job_attempts` (attempt `succeeded` mới nhất).
- **Serverless Bounded Cutoff (H4)**:
  - `DEFAULT_BATCH_LIMIT = 5`, `MAX_BATCH_LIMIT = 10`, `MAX_BATCH_TIME_MS = 20000` (dưới trần 30s của Vercel). Đội đã pinned không tiêu tốn slot limit của batch. Authoritative `remaining` và `complete` dựa trên toàn bộ approved connections.
- **Login Throttle Fallback không đếm đôi (H5)**:
  - Khi RPC gặp sự cố hoặc timeout, fallback in-memory chỉ bump local đúng 1 lần duy nhất, giữ chuẩn ngưỡng 10 lần/tài khoản và 60 lần/IP.
