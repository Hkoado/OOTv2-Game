# Contract phối hợp cho đợt hoàn thiện

Ngày 24/10/2026. Đi cùng [phạm vi chốt](18-CHOT-HOAN-THIEN-VA-NGHIEM-THU.md).
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
| Snapshot/schedule/job/result/standings | Khoa + Huy, Bảo xác nhận DTO | `officialSchedule.js` + RPC `mvp_official_*`; `officialJobs.js` (claim/heartbeat/finish/fail/requeue/reap) sau `20261026090000`; grants siết bởi `20261026110000` (service_role chỉ `SELECT`, REST PATCH/POST → 403 `42501`); test `officialSchedule`, `officialGroups`, `officialBracket`, `officialRounds`, `officialWorker` | PARTIAL — queue + worker code có, **API route chưa nối**, VM/2 worker chưa nghiệm thu |
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
  300 s (trần claim 900 s). Hai điểm này cần Huy quyết định nếu muốn đổi contract.
- Bảo: mọi route admin-only; chỉ hiển thị trạng thái/lý do; nạp file bằng multipart + `x-csrf-token`; không có form nhập điểm tay; không mở upload online cho đội.
- Migration **đã apply** ngày 24/10/2026 trên project `wsyfcgurnrowcuefwynx` (OTTv2-G5) cùng
  `20261025100000_cutoff_capture.sql`; `npm run db:manual` chạy drill trên schema đã apply (ROLLBACK).
  `apply-migrations.js` đã có 2 migration này trong PLAN. Consumer manual **đã có code + contract
  test**; browser E2E/VM acceptance và chạy worker trên DB thật vẫn **NOT RUN**.

Các quyết định sản phẩm đã chốt trong docs/18 không được thay đổi khi điền bảng này.