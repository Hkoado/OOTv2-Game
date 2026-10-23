# K2 schedule persistence — migration + client, chưa apply

Trạng thái 24/10/2026: **schema + RPC + client + test mock đã có; PostgreSQL thật NOT RUN.**
Không thay đổi trigger `official_scheduler_not_ready`, không mở Start, không thêm API route/UI,
không chạy bot. Đây là lớp lưu lịch/màu để sau này nối runtime chính thức.

- Migration: `supabase/migrations/20261025090000_official_schedule.sql` — **CHƯA apply remote**.
- Client: `server/shared/officialSchedule.js`.
- Test: `tests/officialSchedule.test.js` (mock PostgREST + guardrail SQL).

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

## Chưa làm / NOT RUN

- **NOT RUN:** apply PostgreSQL, 2 writer tranh `append`, crash giữa transaction, RLS/service_role
  thật, tải 35–50 đội. Chưa có API/admin route hay UI công bố màu trước ván (Bảo/Huy).
- Chưa persist series knockout (main/final/extra) — bảng riêng và bracket pinning còn thiếu.
- Chưa nối kết quả từ worker/replay đã accepted vào `record_result`; hiện caller phải cung cấp
  `replay_hash` của attempt đã chấp nhận.
- Trigger Start vẫn khóa; không có scheduler queue/runner.
