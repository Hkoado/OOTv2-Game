# K2 schedule persistence — migration + client + drill thật

Trạng thái 24/10/2026 (sau H4): **migration đã apply trên Supabase thật** (nằm trong 10 file
H4 apply, `20261025090000_official_schedule`) và **drill DB thật PASS 14/14** (`npm run db:k2`).
Không thay đổi trigger `official_scheduler_not_ready`, không mở Start, chưa thêm API/UI,
chưa chạy bot. Đây là lớp lưu lịch/màu để sau này nối runtime chính thức.

- Migration: `supabase/migrations/20261025090000_official_schedule.sql` — **đã apply remote**.
- Client: `server/shared/officialSchedule.js`.
- Test mock: `tests/officialSchedule.test.js` (8/8); guardrail drill: `tests/k2Drill.test.js`.
- Drill thật: `tools/cli/k2-schedule-drill.js` (`npm run db:k2`, cần `.env` service role).

## Bảng và bất biến

`mvp_official_rounds`: một dòng / `(event_id, round_id)`; giữ `snapshot` jsonb
(`campus-round-snapshot.v1`), `snapshot_hash`, `genesis_hash`, `chain_hash` (head), `game_count`,
`frozen`. Check DB bắt snapshot đúng schema, `contentHash = snapshot_hash`,
`eventId/roundId` khớp cột. RLS bật, `revoke all` khỏi `public/anon/authenticated`, chỉ
`service_role` đọc/ghi.

`mvp_official_games`: `seq` và `game_key` unique trong vòng; hai màu khác nhau; `seed` uint32;
`map_slot` primary/reserve; `map_hash` 64 hex; `color_policy` cố định
`alternate-loss-priority.v1`; `chain_hash`; kết quả chỉ có **một** trong ba giá trị kèm
`replay_hash` + `recorded_at` (không có result mà thiếu replay, và ngược lại).

## RPC

| RPC | Việc | Từ chối |
| --- | --- | --- |
| `mvp_official_open_round(p_event,p_round,p_snapshot,p_genesis)` | tạo vòng, pin genesis | `round_exists`, `event_not_found`, `event_closed`, `invalid_snapshot`, `snapshot_identity_mismatch`, `bad_input` |
| `mvp_official_append_game(p_round,p_expected_prefix,p_game)` | `SELECT … FOR UPDATE`; chỉ nhận đúng `seq = game_count+1` khi `chain_hash = expected_prefix`; map hash/version phải khớp snapshot | `stale_prefix`, `round_frozen`, `bad_sequence`, `map_mismatch`, `duplicate_game`, `bad_input` |
| `mvp_official_record_result(p_round,p_game_key,p_result,p_replay_hash)` | ghi kết quả một lần; gọi lại cùng result+replay trả `already_recorded` | `result_conflict`, `game_not_found`, `bad_input` |
| `mvp_official_freeze_round(p_round,p_expected_games)` | khóa append khi đủ số ván và mọi ván có kết quả | `incomplete_schedule`, `pending_results` |

Client chuyển lỗi DB thành `HttpError` (404 round/game, 409 stale/frozen/duplicate/conflict,
400 input sai, 503 response hỏng) và **không retry** các lỗi fencing.

## Chain và màu

`genesis = contentHash({schemaVersion:'official-schedule.v1', eventId, roundId, snapshotHash})`.
Mỗi ván: `chain = sha256(prefix + '\n' + canonicalJson(game))` với đúng 12 trường
`seq, gameKey, stage, groupName?, gameNo?, redParticipantId, blueParticipantId, seed, mapSlot,
mapHash, mapPackVersion, colorPolicy`. DB lưu chain do client gửi nhưng **không tin nó**: append
bị chặn nếu prefix không khớp head, nên hai writer/duplicate không thể cùng ghi.

`loadOfficialRound` đọc round + toàn bộ games, kiểm snapshot hash, genesis, `game_count`, seq liên
tục, từng chain và head; lệch bất kỳ đâu → `409 chain_invalid/snapshot_invalid`.

`nextPinnedGroupGame({snapshot,games})` tái tạo lịch chuẩn từ snapshot (participant IDs, seed,
mapHash, packVersion), đối chiếu từng ván đã lưu (seed/map/group/gameNo) rồi mới gọi
`assignNextOfficialGameColor` để trả **ván kế tiếp kèm màu đã chốt**. Yêu cầu prefix đã có kết quả;
thiếu → `409 result_pending`; lệch lịch → `409 schedule_mismatch`. Không suy màu bằng kết quả tương lai.

## Thứ tự áp dụng / rollback

Áp sau các migration `20261022125205`, `20261023160000`, `20261024130000`… trên **project
disposable được phép**, không áp remote trong phiên này. Rollback (chỉ khi chưa có dữ liệu thật) ghi
cuối file SQL: drop 4 function rồi drop 2 bảng.

## Đã kiểm trên DB thật (24/10/2026)

`npm run db:k2` tạo event + 4 đội tạm, mở vòng `group`, rồi kiểm **14/14 PASS**:

- Open round + `round_exists`; load khớp snapshot/genesis.
- **2 writer tranh append**: đúng một thắng, writer thua `stale_prefix`.
- Chain seq 1 khớp; record lặp idempotent; record kết quả khác `result_conflict`.
- Freeze thiếu ván `incomplete_schedule`; append/record đủ 12 ván; load xác minh toàn chain;
  freeze `frozen=true`; freeze lặp idempotent.
- Cleanup xoá games → rounds → entries → tournaments → participants; query leftover = 0.

Chưa kiểm: RLS bằng JWT anon/authenticated (`.env` chỉ có service role), crash giữa transaction,
2 writer trên nhiều process/region, tải 35–56 đội.

## Chưa làm / NOT RUN

- **Runner**: chưa gọi `runCampusMatch`/append/record/freeze; K2 chỉ lưu lịch.
- **Knockout/standings**: chưa persist series main/final/extra hoặc tự lên top 16.
- **Quyền xem**: route round hiện chỉ admin; đội/viewer chưa có API lịch/màu.
- **VM**: Hyper-V đang Disabled; sandbox production chưa nghiệm thu.
- **Accepted result**: caller vẫn phải cung cấp `replay_hash` của attempt đã chấp nhận.
- Trigger Start vẫn khóa; không có scheduler queue/runner thật.
