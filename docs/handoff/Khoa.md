# Kết quả Khoa — Scheduler / worker / runtime

## Trạng thái mới nhất

- Ngày 24/10/2026, Khoa, **K1 — READY FOR REVIEW** (hàm thuần, không phải runtime chính thức).
- Branch `dev`, baseline code `bb9cb4e9124a4e513505f7a03ce468eee7bbccee`, checkout sạch trước khi làm.
- SHA commit K1/báo cáo: tra bằng `git log -- docs/handoff/Khoa.md`; chưa tạo PR/push/merge/deploy.
- Chỉ hoàn thành phạm vi K1 trong [phân công Khoa](../assignments/Khoa.md); K2–K4 chưa làm.
- Gate `official_scheduler_not_ready` giữ nguyên ở API/SQL; không enqueue hoặc nối worker MVP.

## Kết quả và bằng chứng

### Code và contract nội bộ đã triển khai

- `server/lib/officialGroups.js`: `OFFICIAL_GROUPS_VERSION = campus-groups.v1`,
  `OFFICIAL_GROUP_TIE_BREAKERS`, `createOfficialGroupSchedule`, `computeOfficialGroupStandings`.
- Tái sử dụng `drawCompetition` từ `src/game/competition.js` (chia bảng cân bằng, canonical roster)
  và `deriveSeed` hiện có; không sửa game phòng, replay/runner MVP hoặc profile 200 plies.
- Lịch vòng tròn 2 ván/cặp đổi màu; cùng seed cặp, mapHash và mapPackVersion cả hai ván.
  35/40/48/50 đội lần lượt 60/80/120/132 cặp, 120/160/240/264 ván.
- ID cặp/ván là slot **trong giải**, không phải UUID toàn cục. Khi persistence phải scope thêm
  event/round/snapshot; không dùng ID này một mình làm khóa DB giữa nhiều giải.
- Input lịch: `{ participantIds: string[], seed: uint32, mapHash: hex64, mapPackVersion: string }`.
  Map hash do caller cung cấp; K1 kiểm cú pháp, KHÔNG chứng nhận pack đã công bố/hash đúng nội dung.
  Một map chính áp dụng toàn lịch K1; phân map nhiều slot và manifest bất biến thuộc K2.
- Output lịch: `{ schemaVersion, seed, mapHash, mapPackVersion, groups, drawOrder, series, games }`.
  Ví dụ game: `{ id: 'group:A:1-2:1', seriesId: 'group:A:1-2', groupName: 'A', gameNo: 1,
  redParticipantId: 'team-01', blueParticipantId: 'team-02', seed: 123,
  mapHash: '<hex64 của map>', mapPackVersion: 'week-1' }` (seed minh họa).
- Input standings thêm `results: [{ gameId, result: 'red_win'|'blue_win'|'draw' }]`;
  chỉ đưa terminal record từ accepted attempt. Thiếu ván là pending, không suy ra bot thua.
  Record lạ/trùng/sai result hoặc seed/roster/map identity sai ném `Error`, không HTTP/RPC mới.
- Điểm ván 1/0.5/0; chỉ cặp đủ hai ván mới cộng điểm cặp 3/1/0. Bảng tạm có thể có điểm ván
  của cặp chưa đủ nhưng `seriesPlayed` chưa tăng; không dùng bảng tạm cấp vé.
- Standings trả `{ schemaVersion, seed, complete, games: {total,finished}, series: {total,finished},
  tieBreakers, tieDrawOrder, groups: [{name,complete,rows}] }`.
  Row có `participantId, rank, seriesPlayed/Won/Drawn/Lost` (các field đầy đủ là
  `seriesPlayed`, `seriesWon`, `seriesDrawn`, `seriesLost`), `seriesPoints`,
  `gamesPlayed/gamesWon/gamesDrawn/gamesLost`, `gamePoints`, `miniSeriesPoints`,
  `miniGamePoints`, `drawRank`, `tieParticipantIds`.
- Tie đúng thứ tự: điểm cặp → điểm cặp mini-table → tổng điểm ván → điểm ván mini-table
  → drawRank tăng dần. Nhóm mini-table được tạo đúng một lần từ seriesPoints ban đầu.
  `tieDrawOrder` là bốc thăm riêng bằng seed dẫn xuất, lưu trong DTO để kiểm tra/tái lập.
- DTO này là contract **nội bộ đã có code, chờ Huy/Bảo review**, chưa phải schema/API nhóm đã duyệt.
  Không trả thẳng standings kín qua endpoint team; Huy phải áp dụng publication/ACL trước tích hợp.
- Không migration/env/dependency mới. Không apply migration nào (kể cả setup migration có trước).
  Snapshot/runtime/protocol/budget không thêm version mới; worker/RPC/lease/fencing không sửa.

### Kiểm chứng ngày 24/10/2026

Windows, Node v24.18.0, Node built-in runner; K1 không DB/mạng/Python.
Do shell integration không thu exit ổn định, chạy bằng child process, lưu `spawnSync.status`
và log tại `data/khoa-k1/` (gitignored, không secret).

| Lệnh | Exit | Kết quả / log |
|---|---|---|
| `npm.cmd install` baseline | 0 | `baseline-0.log`; 2 high vulnerabilities + cảnh báo esbuild allow-scripts, không audit fix |
| `npm.cmd test` baseline | 0 | 91/91 pass; `baseline-1.log` |
| `npm.cmd run build` baseline | 0 | `baseline-2.log` |
| `node --test tests/officialGroups.test.js` cuối | 0 | 11/11 pass, 0 fail/skip; `final-0.log` |
| `npm.cmd test` cuối | 0 | 102/102 pass, 0 fail/skip; `final-1.log` |
| `npm.cmd run build` cuối | 0 | `final-2.log` |
| `git diff --check` | 0 | `final-3.log` |

`tests/officialGroups.test.js` phủ counts, ngưỡng 4/7/8/15/16/31/32/56, trùng/thiếu màu,
map/seed cặp, đảo thứ tự roster/results, seed 0, không mutation, không ambient Math.random,
điểm ván/cặp, partial pair, head-to-head, chu trình tie ba đội và seeded draw.
Lượt đầu 10/11 pass: fixture tie ba đội sai kỳ vọng; đã sửa fixture và chạy lại toàn bộ thành công.

## Blocker / NOT RUN / bước tiếp

- **NOT RUN:** PostgreSQL/Supabase integration, apply SQL, worker E2E, browser, multiplayer hai máy,
  Linux sandbox/preflight/fault/cleanup, load, offline bundle/restore: K1 chỉ hàm thuần.
- K2 còn bracket fixed/permutation tránh cùng bảng, so phân số, bye/double-DQ/walkover,
  main/final/extra/tranh ba/vé không trùng, snapshot/map/runtime manifest bất biến.
- K3 còn GitHub consumer contract của Huy, bounded SHA/blob/hash/cache/GC, lease/retry/fencing
  cho result **và** event/log/terminal; thiếu hạ tầng không được forfeit.
- K4 còn persistent bot.v1/SDK/Campus runtime và sandbox Linux đã kiểm thử. Subprocess không phải sandbox.
- Dependency Huy: review DTO, thiết kế persistence snapshot/accepted attempt/publication/ACL;
  dependency Bảo: review standings fields/state partial/complete trước nối UI. Chưa tự tuyên bố đã chốt.
- Start phải tiếp tục chặn cho tới khi snapshot/runner/privacy đạt gate. Không mở giải thật.
- Tái hiện: từ root repo chạy `node --test tests/officialGroups.test.js`, `npm.cmd test`, `npm.cmd run build`.
- Rollback runtime: module chưa được import từ đường runtime/API/UI nên không đổi hành vi đang chạy.
  Gỡ PR/commit K1 là phương án đề xuất, chưa diễn tập revert. Không cần rollback DB.
- Bước nhỏ kế tiếp **K2**: review DTO với Huy/Bảo rồi thêm helper/test bracket thuần riêng;
  không bỏ trigger Start, không làm K3/K4 hoặc offline trong PR đó.

## Lịch sử checkpoint

- 23/10/2026: tạo khung bàn giao, chưa thực hiện thay người được giao.
- 24/10/2026: K1 thuần READY FOR REVIEW; test/build local pass, integration/runtime chưa nghiệm thu.