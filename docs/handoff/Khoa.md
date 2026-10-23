# Kết quả Khoa — Scheduler / worker / runtime

## Trạng thái mới nhất

### 24/10/2026 — Fetch/tích hợp H1 + K3b pinned GitHub source: READY FOR REVIEW

- Đã `git fetch --all --prune` exit 0, origin/dev từ a84c3c7 lên **1822e92**.
  H1 **be22c09**, handoff a38dc4f/a25d024, B2 1822e92. Huy H1 mock-verified, H2–H4 NOT RUN;
  không còn áp dụng kết luận Huy NOT STARTED trong checkpoint K3a bên dưới.
- Theo yêu cầu user tích hợp: chốt merge map/B1 đang mở thành **1ac8be6**, commit riêng K3a
  **f7bf6f5**, merge origin/dev không conflict; không reset/ghi đè/abort merge hoặc push.
  Backup K3a và Git logs ở `data/khoa-h1/backup`, `inspection.json`, `integration.json`.
- Thêm `server/shared/githubArtifact.js`: `fetchGithubArtifact(job,{fetchImpl,token,timeoutMs,
  signal,expectedHash})`. Input contract H1 nội bộ: numeric repo_id, canonical repository,
  file_path=bot.py, commit_sha full 40 hex; branch không dùng khi lấy source.
- Pipeline fixed api.github.com: repo identity -> pinned Git commit -> root tree -> exact blob.
  Không clone/archive/project/HEAD/download_url. Kiểm tree không truncated, một bot.py regular
  mode 100644/100755, từ chối symlink/tree/submodule. Source 1..256 KiB, base64 canonical,
  Git blob SHA1 đối chiếu bytes, UTF8 fatal/no NUL/no LFS; sourceHash SHA256 và optional
  expectedHash để restore đúng source đã pin. Không execute bot, không đọc DB hoặc ghi Storage.
- Budget toàn operation <=20s (fetch/body), streaming bounded buffers (repo 64 KiB, commit
  256 KiB, root tree 1 MiB, blob JSON 400 KiB); hủy stream khi quá cỡ/timeout/cancel,
  redirect:error, token chỉ header và raw upstream không vào error. Lỗi access/rate/network/
  integrity là infrastructure; lỗi file sai định dạng là code; repo identity changed là repo.
  Category chỉ là output nội bộ, chưa mapping thành SQL outcome hoặc result thua bot.
- Output: `{source:Buffer,sourceHash,size,repoId,commitSha,blobSha,filePath,sourceKind}`;
  source private không trả qua API DTO/log/replay. Helper chỉ consume job tin cậy từ coordinator,
  không phải cơ chế xác minh quyền sở hữu/cutoff từ input người dùng.
- Tests mới `tests/githubArtifact.test.js`: **17 pass**; cùng H1/API/B2 **30/30**;
  full suite **196/196 pass**, 0 fail/skip; build và diff check exit 0. Baseline sau merge
  install/test/build exit 0 (179 tests). Baseline script copy giữ log path cũ
  `data/khoa-k3/baseline*`; final logs `data/khoa-h1/final.json`, `final-{0..3}.log`.
- Test mocks kiểm SHA/branch không đổi, size biên/pinned hash, repo thay thế, symlink/submodule,
  LFS/binary/UTF8, tamper blob, truncated tree, oversize stream, timeout/cancel, redaction.
  GitHub thật/private/PAT permissions, PostgreSQL thật, browser B2 mới **NOT RUN**.
- Review H1 phát hiện blocker SQL trước tạo valid candidate thứ hai:
  `20261024130000_github_intake.sql` dòng 155 `SELECT id INTO previous FROM mvp_github_receipts`
  rồi ghi previous vào `previous_valid_submission_id REFERENCES mvp_submissions(id)`.
  Phải chọn `submission_id` của valid receipt (không receipt.id). Không sửa migration Huy tại chỗ;
  Huy cần migration corrective reviewed và integration trên Postgres. API H1 readJson còn dùng
  arrayBuffer rồi mới kiểm size, chưa bounded trước allocation như helper worker K3b.
- H1 chưa có RPC claim/heartbeat/progress/fenced finish/retry cho repo_sync_jobs;
  không tự đoán RPC hoặc nối consumer ghi trực tiếp bảng. Cần contract token/generation/lease,
  atomic submission+receipt acceptance/idempotency, retry/backoff/freeze-candidate semantics.
  Result/events/log/terminal game attempts vẫn cần fencing riêng, không đánh đồng intake job.
- Để tiếp tục consumer E2E: Huy review/đưa RPC trên, sửa FK previous, operator cấp disposable
  Supabase project và cho phép migrations qua kênh credential riêng (không paste secret chat).
  Linux sandbox host/runtime pin là gate độc lập trước validation source không tin cậy.
- Không env/dependency/migration mới, không remote DB write/apply/deploy/push, Start vẫn tắt,
  profile/replay MVP không đổi. Milestone này không đóng K3/K4/cache-pin-GC/scheduler persistence.

### 24/10/2026 — K3a bounded Supabase artifact retrieval: READY FOR REVIEW

- Nền `dev @ abb7cae`; có sẵn **18 file staged** của người dùng (map snapshot/worker MVP,
  migration map và UI B1). Không sửa/unstage/commit các file này; không kết luận chúng là H1
  chỉ từ lời mô tả. `docs/handoff/Huy.md` vẫn NOT STARTED; không tìm thấy GitHub backend
  receipt/job service hoặc migration/RPC tương ứng trong checkout. Bảo B1 READY FOR REVIEW.
- Phần thực hiện: `server/shared/artifactDownload.js`, sửa `server/shared/artifacts.js`,
  thêm `tests/artifactDownload.test.js` (10 tests), cập nhật báo cáo Khoa này.
- Contract: `downloadStorageArtifact(storageKey,{maxBytes,timeoutMs=20000,signal}) -> Buffer`;
  fixed HTTPS configured Supabase origin, bucket `ootv2-bots`, UUID.py key; không URL arbitrary,
  không redirect. Byte budget <=256 KiB kiểm cả header và từng chunk, fixed buffer tránh tích lũy
  metadata của vô số chunk nhỏ. Deadline bao trùm fetch/body và không chờ cancel treo.
- `materialize(submission,{signal,timeoutMs}={})` giữ tương thích một argument; kiểm SHA-256
  syntax trước mạng, kiểm hash trước file, file private UUID `wx`/0600, cleanup khi partial write.
  Source không execute ở downloader; lỗi upstream/body không bị đưa vào message/log.
  Không đổi `client.request()` chung hoặc upload API, worker/MVP profile/map snapshot.
- Integration test fetch giả xác nhận `validatePendingSubmissions` tải quá cỡ vẫn giữ uploaded,
  không ghi valid/invalid/kết quả; API/storage origin giả, không gọi credential/network thật.
- Baseline install/test/build exit 0: 155/155 tests. Sau sửa: targeted **16/16**, toàn repo
  **165/165 pass**, 0 fail/skip; build exit 0 (1639 modules). Log `data/khoa-k3/final.json`,
  `final-{0..4}.log`. Lượt đầu bắt cancellation-vs-EOF race đã sửa và test lại.
- `git diff --check` phần unstaged của Khoa exit 0. `git diff --cached --check` toàn stage
  có sẵn exit 2: extra blank EOF trong docs/07, githubSyncState.js, officialSetupView.js,
  githubSyncState.test.js, matchMapSnapshot.test.js, officialSetupView.test.js. Không tự sửa
  whitespace của người khác để báo PASS giả. Install còn 2 high vulnerabilities và esbuild
  script approval warning có trước; không tự audit fix.
- Không migration/env/dependency mới, không apply remote/deploy/push. Start giữ nguyên tắt.
  NOT RUN: Supabase integration thật, GitHub consumer, persistent retention/pin/GC, lease/fencing
  event/log/terminal, Linux sandbox, browser mới (không sửa frontend).
- Bước tiếp: xác định phần Huy nằm ở commit/branch/file nào nếu chưa vào checkout; cần contract
  reviewed receipt/job/snapshot/RPC trước consumer. Helper bounded GitHub blob/cache có thể
  làm milestone độc lập; K3a này chỉ tăng an toàn luồng Storage đang có, không đóng K3.
- Commit checkpoint **chưa tạo**: Git báo `cannot do a partial commit during a merge`.
  Repo có MERGE_HEAD đang mở; không tự commit merge/abort merge của người dùng. Đã bỏ stage
  chỉ 4 file của checkpoint này sau lần thử, bảo toàn 18 file stage gốc; code mới còn working tree
  và untracked để review. Bằng chứng `data/khoa-k3/{commit,merge-check}.json`.

### Checkpoint runtime trước đó

- Checkpoint độc lập 24/10/2026: **bot.v1/Campus trusted runtime foundation — READY FOR REVIEW**.
  Baseline `dev @ 0b4ca63`, checkout sạch. Không tuyên bố K3/K4 production hoàn tất.
- Đã thêm wire parser/validator/request builder `server/contracts/botProtocol.js`,
  `createTrustedCampusSession` trong `server/judge/campusTrustedSession.js`, `runCampusMatch`
  trong `server/judge/campusMatchRunner.js`, bot mẫu một file `examples/campus_bot.py`,
  CLI `tools/cli/demo-campus-bots.js`, 15 tests `tests/campusRuntime.test.js`, tài liệu
  `docs/CAMPUS-TRUSTED-RUNTIME.md` và README hướng dẫn. Không dependency/schema/env mới.
- `bot.v1` parser không mất duplicate key: scan trước JSON.parse, UTF-8 fatal, depth 16,
  finite numbers, exact envelope/request ID/kind/fields, 64 KiB input/16 KiB response.
  Persistent process tuần tự, total stdout 4 MiB/stderr 256 KiB, wall timer monotonic,
  total response wall 45 s mặc định, timeout/output overflow kill, private temporary dir,
  env allowlist không chuyển Supabase/server secret. Private output không chép vào result.
- Runner setup Red rồi Blue, bot fault chỉ active side; Campus engine authoritative với map,
  repetition/400 plies; replay engine verified trước return. Hạ tầng/cancel/cleanup failure throw,
  không trả result thua bot; abort đóng session, watchdog 120 s. Session cleanup idempotent.
- API adapter nội bộ: `startSession({filePath,allowedRoot,trusted,responseTotalMs})`
  → `{request(botV1Request),metrics(),close()}`. Production supervisor phải cung cấp contract
  tương thích và CPU remaining thực, không dùng adapter trusted như attestation.
  Output `profile:campus-engine-trusted.v1`, `productionReady:false`, result/reason/plyCount,
  replay engine/metrics/limitations; KHÔNG là DTO public hoặc replay production đầy provenance.
- Tests Windows/Node v24.18.0/Python local: riêng 15/15 pass, không skip; full suite 138/138 pass,
  build/diff check exit 0. Baseline install/test/build exit 0 (123 tests); install vẫn 2 high
  vulnerabilities/cảnh báo esbuild chưa tự audit fix. Logs `data/khoa-k1/runtime-final.json`,
  `runtime-final-{0..5}.log`. Test Python thực: persistent state/PID, secret absent,
  partial newline/timeout, stdout/stderr flood, duplicate line/key, crash, sample-vs-sample,
  deterministic replay. Injected adapter: fault đúng màu, invalid setup/move, cancel/cleanup infra.
- Demo CLI thực trên `examples/maps/campus-arena.json`: `blue_win/BASE_REACHED/16 plies`,
  replay verifier `ok:true,finished:true`, exit 0. Lượt đầu CLI sai argv count đã bắt và sửa;
  lượt cuối chạy lại demo/verifier/full test/build. Output file tạm được dọn sau verify.
- **Giới hạn thực:** subprocess không sandbox, không đo CPU/RAM, không cgroup freeze/ack,
  không readiness channel/subreaper/verify-empty. Chỉ bot tin cậy, never public student code.
  `cpuRemainingMs:30000` trong trusted request là dự kiến, KHÔNG phải measurement.
  Không giả mạo Linux sandbox pass hoặc sửa worker MVP để chạy Campus.
- NOT RUN: Linux sandbox/preflight/host pin/benchmark, DB concurrent workers/lease/stale event fencing,
  GitHub consumer/fetch/cache/GC, Preview deployment, offline bundles/restore/load. Browser không chạy lại
  checkpoint này vì không sửa frontend; bằng chứng browser K2 phía dưới chỉ áp dụng UI cũ.
- **Cần Huy cung cấp trước tích hợp K3/K2 persistence:** schema/RPC/DTO thật và reviewed cho repository
  numeric ID + pinned commit receipt + cutoff, validation job claim/heartbeat/retry/token,
  immutable round snapshot, accepted-attempt writes (result/event/log/terminal), publication ACL.
  Báo cáo Huy/Bảo vẫn NOT STARTED khi kiểm tra; không bịa RPC để gọi DB thật.
- **Không phải blocker từ Huy/Bảo:** Linux sandbox production vẫn là công việc Khoa chưa thực hiện.
  Cần host/VM sạch không secret, pin runtime/nsjail/seccomp/budget, thử fault suite và quyền vận hành
  được duyệt trước khi code/exercise isolation. WSL trên máy cá nhân không mặc nhiên là VM thi an toàn.
  GitHub bounded fetch/hash/cache helper độc lập cũng chưa làm trong milestone runtime này.
- Điểm dừng theo quy tắc một milestone: runtime trusted foundation đã demo E2E local;
  Start vẫn chặn, không apply SQL/deploy/push. Bước độc lập kế tiếp có thể làm: bounded GitHub
  blob fetch/hash helper (mock API), cache pin/GC thuần; không cần đợi Huy để viết test helper,
  nhưng consumer/RPC chỉ nối sau contract review. Không gọi mọi phần chưa làm là chờ người khác.
- SHA checkpoint: tra `git log -- docs/handoff/Khoa.md`.

### Checkpoint K2 trước đó

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