# Kết quả Khoa — Scheduler / worker / runtime

## Trạng thái mới nhất

- Checkpoint 24/10/2026 tiếp theo: **K2 pure foundation — READY FOR REVIEW**, chưa persistence/E2E.
  Baseline `dev @ ddc20f3`; người dùng cho phép deploy/browser, nhưng chưa deploy vì thiếu runtime/privacy
  và chưa xác định project Vercel. Không apply SQL remote. K3/K4 vẫn BLOCKED bởi contract/runtime gate.
- Thêm `server/lib/officialBracket.js`, `server/contracts/officialSnapshot.js`,
  `tests/officialBracket.test.js`; không sửa router/UI/worker/migration/package.
- K2 exports: `compareOfficialFractions`, `seedOfficialQualifiers`, `seedOfficialTicketHolders`,
  `createOfficialBracket`, `createOfficialKnockoutSeries`, `resolveOfficialKnockoutSeries`,
  `officialBracketEntrants`, `allocateOfficialTickets`, `rankOfficialKnockout`.
- `campus-bracket.v1`: seed tỷ lệ bằng cross-product BigInt chính xác; nhất bảng trước nhì;
  permutation lower-half tối thiểu tổng lệch rồi numeric lexicographic, fixed winner/loser edges,
  không reseed. Single-group Top 4 không thể tránh tái đấu cùng bảng.
- Main 4/final 6, đổi màu từng block và luân phiên màu đầu; extra plan đúng 2 ván reserve,
  chỉ trả `nextGames` extra khi main hoàn tất và hòa; không dừng sớm. Bye/walkover/double absence
  không tạo ván hay game points giả; double-DQ truyền null xuống nhánh.
- Ranking tranh nhất/tranh ba rồi losers vòng trước theo seed; administrative non-finishers trả
  `unranked`, `complete:false`, cần quyết định trọng tài, không tự gán rank cho người bị DQ/rút.
  Ticket allocator nhận ranking đã duyệt, loại holder/rút, không duplicate, trả reserves/vacant.
- Ticket seeding giữ thành tích thực tế tốt nhất của đội (rank thật của vé chuyển), không giả á quân.
- `createOfficialRoundSnapshot`, `verifyOfficialRoundSnapshot`: `campus-round-snapshot.v1`, canonical
  contentHash, deep freeze; pin event/round/cutoff/seed, primary/reserve map + hash, packVersion,
  runtimeVersion/runtimeHash/budgetHash, rules `ott-campus.v1`, protocol `bot.v1`, bot source hash,
  artifact/submission, GitHub repo numeric ID/commit SHA/resolvedAt trước cutoff. Không đọc latest.
- Contract K2 là nội bộ/chờ Huy/Bảo review, không API/RPC mới. Snapshot hash không chứng minh runtime
  đã được cài/benchmark; provenance do caller tin cậy cung cấp, chưa receipt validation transaction.
  Persist snapshot/write-once, map pack công bố/slot assignment, bracket/seed locking và accepted-attempt
  fencing còn phải tích hợp với Huy; không gọi K2 end-to-end đã hoàn tất.
- Tests 24/10 Windows Node v24.18.0: baseline install/test/build exit 0 (102 tests); K2 riêng
  21/21 pass; full `npm.cmd test` 123/123 pass, 0 fail/skip, exit 0; build exit 0; diff check exit 0.
  Logs `data/khoa-k1/k2-tests.log`, `k2-final-{0,1,2,3}.log`, `k2-final.json` (gitignored).
  Lượt đầu bắt được validation group size max 7 sai tại 15/31 đội (bảng 8); đã sửa max 8 và chạy lại.
- Browser: Edge headed local production build, API 503 fixture, không login/DB remote;
  script `data/khoa-k1/browser-k2.mjs`, report/screenshots `data/khoa-k2-ui/`.
  Kết quả cuối PASS: login dark/light, 81 ô, xếp quân hai bên và đi hợp lệ khi chặn mạng,
  desktop 1366×900/mobile 390×844 không tràn ngang, 0 runtime exception. Đã đọc ảnh
  `login-light.png`, `offline-light.png`, `offline-mobile.png` để kiểm trực quan.
  Screenshot không phải nghiệm thu UI bracket (chưa nối UI).
  Script QA cũ dùng `.tt-login__snapshot`, `.tt-turn`, `.square--valid-target` đã lỗi thời;
  đã đổi script tạm sang selector đúng UI kit, không sửa production UI.
- Remote inspection chỉ list Supabase project `OTTv2-G5`, không query/write/migrate.
  Không có Vercel CLI/project link local. WSL Ubuntu có tên trong danh sách nhưng sandbox/preflight
  Linux **NOT RUN**. DB integration/worker E2E/load/offline/restore/Preview **NOT RUN**.
- Bước tiếp: Huy review snapshot/job/receipt/claim/finish DTO và schema trước K3; gate Start vẫn tắt.
  Không dùng quyền deploy để bỏ qua privacy/runtime/sandbox. Muốn deploy preview cần project đích,
  schema test tương thích và cấu hình credential qua cơ chế riêng, không dán secret vào chat.
- SHA checkpoint mới: tra `git log -- docs/handoff/Khoa.md`; không push.

### Checkpoint K1 trước đó

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