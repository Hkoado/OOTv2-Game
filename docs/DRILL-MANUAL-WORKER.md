# Drill worker Chung kết thủ công (Khoa)

Trạng thái 24/10/2026: **code + drill hợp đồng 2 worker PASS**, **smoke 2 process trên DB thật
PASS với queue rỗng**, **E2E có job thật và drill VM Linux: NOT RUN** (xem §4–§6).
Không có tuyên bố nào thay thế nghiệm thu VM/thi đấu thật.

## 1. Phạm vi

| Hạng mục | Nguồn |
| --- | --- |
| Worker loop + chọn queue | `server/officialWorker.js` (`--manual`, `--all`, `processManualFinalJob`) |
| Executor `validate`/`match` | `server/services/manualFinalExecution.js` |
| Hợp đồng DB (claim/finish/release) | `supabase/migrations/20261026100000_manual_final.sql` |
| Client RPC + DTO | `server/shared/manualFinalJobs.js` |
| Drill 2 worker (không DB) | `tools/cli/manual-worker-drill.js` + `tests/manualWorkerDrill.test.js` |
| Preflight schema/RPC | `tools/cli/worker-health.js` (đã thêm 2 bảng manual + `mvp_manual_final_claim`) |

## 2. Drill hợp đồng 2 worker (chạy được mọi máy, không DB/Python)

```powershell
npm run drill:manual-worker
# hoặc kèm artifact JSON
node tools/cli/manual-worker-drill.js --json data/khoa-manual/drill-local.json
```

Drill chạy **đúng** `runOfficialWorker` → `processManualFinalJob` → `executeManualFinalJob`;
chỉ thay DB/Storage/Python bằng queue in-memory mô phỏng `FOR UPDATE SKIP LOCKED`,
lease token + `generation`, `attempt`, backoff và `already_finished` của SQL.

Kết quả 24/10/2026: **9/9 PASS**

| Kịch bản | Kỳ vọng | Bằng chứng |
| --- | --- | --- |
| 2 worker tranh 1 job | chấm 1 lần, 1 accepted | `{status: completed, accepted: 1, executions: 1}` |
| Lease bị lấy | worker cũ `lease_lost`, chỉ worker mới ghi | `{stale: lease_lost, fresh: finished, generation: 1→2}` |
| Lỗi sandbox | release retry **cùng snapshot**, 1 accepted | `{first: queued, second: finished, attempt: 2}` |
| Hết lượt retry | `infra_fault`, 0 accepted | `{status: infra_fault, accepted: 0}` |
| Finish lặp (mất response) | `already_finished`, không nhân đôi | `{applied:false, alreadyFinished:true, accepted:1}` |
| 2 job / 2 worker | mỗi job 1 lần chấm, 2 accepted | `{perJob:[1,1], accepted:2}` |
| Validate file nhị phân | `invalid`, **không** khởi động bot | `{result: invalid, factoryCalls: 0}` |
| Validate hợp lệ | `valid`, 0 kết quả trận | `{result: valid, row: completed}` |
| Bot lỗi setup 0 ply | `bot_fault` + `setup_bot_fault`, 0 accepted | `{result: bot_fault}` |

## 3. Smoke 2 process trên DB thật (queue rỗng)

Chứng minh preflight sandbox (gate opt-in của Huy), claim RPC thật và loop 2 process cùng chạy,
**không tạo/không ghi dòng nào** vì queue rỗng:

```powershell
node --env-file=.envdev server/officialWorker.js --manual --once   # cửa sổ 1
node --env-file=.envdev server/officialWorker.js --manual --once   # cửa sổ 2
# Máy dev tin cậy cần OOTV2_ALLOW_TRUSTED_DEV=1; VM thật dùng env linux-sandbox.
```

Kết quả 24/10/2026 (2 process song song, project OTTv2-G5 `wsyfcgurnrowcuefwynx`):

```
{"at":"official-worker","sandbox":"trusted-dev"}
RESULT processed=0 recorded=0 failures=0      # exit 0, cả hai process
```

Kèm preflight đọc-only:

```powershell
node --env-file=.envdev tools/cli/worker-health.js --json
```

- PASS: `mvp_manual_final_jobs`, `mvp_manual_final_matches`, `mvp_manual_final_claim`
  (`bad_worker guard reachable` — probe không lease/ghi gì).
- FAIL trên G5: `storage_bucket` (bucket `ootv2-bots` chưa đúng cấu hình private/262144) và
  `mvp_github_claim` (khác subsystem) → **chưa thể chạy job thật** cho tới khi Huy cấu hình bucket.

> Lưu ý môi trường: `.env` của workspace này trỏ `ftzockzolisecnyhlwej` — project **không có**
> schema `mvp_*` (mọi bảng/RPC trả 404). Phải dùng `--env-file=.envdev` (G5) mới thấy schema.
> Đừng kết luận "worker hỏng" khi chỉ thấy `shared_db_error` trên `.env`.


## 4. E2E có job thật (NOT RUN — cần quyền ghi DB)

Điều kiện: bucket `ootv2-bots` đúng cấu hình, BTC tạo 1 cặp đấu thật qua UI
(`/api/local/manual-finals/*`) hoặc chấp thuận cho drill tạo dữ liệu.

1. BTC: tạo đợt (map v2) → intake → 2 đội nộp bot → chọn → khóa → **pair** (sinh job `match`).
2. Chạy 2 worker song song, quan sát log `manual-worker`:
   ```powershell
   node --env-file=.envdev server/officialWorker.js --manual        # worker A
   node --env-file=.envdev server/officialWorker.js --manual        # worker B
   ```
3. Đối soát (read-only):
   ```powershell
   node tools/cli/db-sql.js "select id,status,attempt,generation,worker_id,error_code from public.mvp_manual_final_jobs order by created_at desc limit 10"
   node tools/cli/db-sql.js "select id,status,result,ply_count,error_code from public.mvp_manual_final_matches order by requested_at desc limit 10"
   node tools/cli/db-sql.js "select entity,action,detail from public.mvp_manual_final_audit order by created_at desc limit 20"
   ```
4. Tiêu chí đạt:
   - mỗi `match_id` có **đúng một** bản `status='finished'` (unique index `mvp_manual_final_one_accepted`);
   - hai worker khác `worker_id` là hợp lệ, nhưng **không** có hai kết quả;
   - job `validate` chuyển `completed`/`bot_fault`, không tạo kết quả trận;
   - audit có `finish`/`retry` tương ứng, không có `lease_lost` ghi đè.
5. Dọn dẹp: schema **không có** policy DELETE cho `service_role`; muốn xoá phải dùng
   `db-sql --write` (Management API) theo quy trình của Huy — **chưa được phép** trong lượt này.

## 5. Drill VM Linux + 2 worker (NOT RUN — máy này không có quyền Hyper-V)

Máy hiện tại: `Get-VM` → *"You do not have the required permission"*, không có
`tools/vm/worker.local.json`, không có `D:\OOTv2-VM`. Không thể boot VM thật.

Khi có VM (theo `docs/WORKER-PACKAGING.md` và `docs/SANDBOX-PRODUCTION.md`):

```bash
# VM Ubuntu 24.04, root
bash sandbox/linux/preflight.sh
bash sandbox/linux/attest.sh /run/ootv2-sandbox-attestation.json --full
export OOTV2_CAMPUS_SANDBOX=linux-sandbox \
       OOTV2_SANDBOX_RUNNER=/srv/ootv2/sandbox/linux/run-bot.sh \
       OOTV2_SANDBOX_ATTESTATION=/run/ootv2-sandbox-attestation.json
node tools/cli/worker-health.js            # phải PASS trước khi start
```

Hai worker (2 process riêng, cùng DB, `workerId` sinh từ hostname + PID nên đã khác nhau):

```bash
node server/officialWorker.js --manual &    # worker A
node server/officialWorker.js --manual &    # worker B
journalctl -u ootv2-manual-worker -f        # nếu chạy dưới systemd
```

Checklist nghiệm thu VM (đủ mới tuyên bố "đã drill VM"):

- [ ] `attest.sh --full` pass, receipt còn hạn, `OOTV2_CAMPUS_SANDBOX=linux-sandbox`.
- [ ] `worker-health.js` PASS (gồm 3 bảng manual + `mvp_manual_final_claim`).
- [ ] Hai worker chạy song song; 1 job thật được chấm **đúng một lần**.
- [ ] Kill worker đang chấm (`SIGKILL`) → job quá lease được worker kia nhận, kết quả vẫn chỉ 1.
- [ ] Bot lỗi setup → `bot_fault`, không có `result`.
- [ ] Log không chứa source/stderr thô của bot; cgroup/process dọn sạch sau mỗi ván.
- [ ] Attestation hết hạn → worker dừng nhận ván mới (fail-closed).

## 6. Tuyên bố trung thực

- **PASS**: drill hợp đồng 2 worker 9/9; smoke 2 process thật trên G5 (queue rỗng); preflight
  schema/RPC manual trên G5.
- **NOT RUN**: job thật end-to-end, VM Linux/sandbox thật, kill/lease-expiry trên DB thật,
  browser E2E.
- Không có thay đổi nào ở migration/RPC hay deploy trong lượt này.

## 7. Lỗ hổng contract phát hiện khi review (cần Huy quyết định, chưa sửa)

**(a) Claim không chặn `attempt` khi lease hết hạn.** `mvp_manual_final_claim` đưa mọi job
`running` quá lease về `queued` mà **không** kiểm `attempt`/`max_attempts`; vòng sau claim lại
`attempt = attempt + 1`. Vì cột có `check (attempt between 0 and 10)`, một worker bị kill lặp
(crash-loop, mất điện) có thể làm `attempt` vượt 10 → UPDATE vi phạm CHECK `23514` → **cả
transaction claim lỗi**, worker nhận `shared_db_error` và không job nào được nhận.
Đề xuất migration additive (Huy duyệt rồi apply):

```sql
-- trong mvp_manual_final_claim, TRƯỚC update requeue:
update public.mvp_manual_final_jobs
   set status = 'infra_fault', error_code = 'lease_expired_max_attempts',
       lease_token = null, lease_until = null, finished_at = clock_timestamp()
 where status = 'running' and lease_until <= clock_timestamp() and attempt >= max_attempts;
```

**(b) Không có RPC heartbeat** cho queue manual → worker phải giữ lease 300 s (dưới trần 900 s).
Nếu sau này có heartbeat, consumer chỉ cần truyền `leaseSeconds` ngắn hơn; không đổi code khác.

**(c) `ply_count = 0`:** `finish` yêu cầu `ply_count >= 1`, nên bot lỗi ngay setup được ghi
`bot_fault` + `setup_bot_fault` thay vì `finished`. Muốn lưu forfeit 0 ply cần migration
additive (nới CHECK và giữ `result`/`reason`).
