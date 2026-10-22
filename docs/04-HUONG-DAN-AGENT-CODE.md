# Bộ hướng dẫn triển khai cho coding agent

Ngày 22/10/2026. Đây là handoff để lập trình về sau, không phải tuyên bố hệ thống đã được xây hoặc chạy test. Đọc toàn bộ trước khi sửa code. Tài liệu ưu tiên phát triển tiếp sản phẩm hiện có, chia milestone có nghiệm thu; không thay project bằng một demo mới.

Với việc frontend, đọc thêm [tích hợp UI vào repo](05-TICH-HOP-UI-VA-REPO.md), [UI guide](ui-style/UI-GUIDE.md), [asset guide](ui-style/ASSET-GUIDE.md) và [brief repo](ui-style/REPO-INTEGRATION-BRIEF.md). Dùng token giấy da light/hầm ngục dark người tổ chức cung cấp; style kit không thay luật hoặc tự yêu cầu dựng lại demo.

Luồng nộp online mới nhất là [GitHub sync và cache tối thiểu](06-GITHUB-NOP-BOT-VA-LUU-TRU.md). Tích hợp trong M4 và UI tương ứng: repo được duyệt, resolve SHA trước cutoff, lấy đúng `bot.py`, hash/cache tạm, check sandbox, khóa vòng. Không giữ quy định MVP cũ “không nhận source URL” để bỏ yêu cầu này; vẫn cấm arbitrary URL/execute project. Offline tải trước và thu file sửa tại chỗ.

## 1. Prompt khởi động có thể đưa trực tiếp cho agent

> Bạn là kỹ sư phụ trách mở rộng OTTv2 Tournament cho khoảng 100 sinh viên, đội 2–3 người, 35–50 bot Python. Phát triển tiếp repository `https://github.com/Hkoado/OOTv2-Game`, bắt đầu từ `tournament/initial`, giữ framework và game hiện có. Đọc AGENTS.md, docs/code/tests hiện có, bản đọc nhanh và đủ file01–04 mới. Kiểm tra git status/nhánh, làm milestone được chỉ định và kiểm tra thật. Mục tiêu: vòng loại online; chung kết tuần/tháng/kỳ offline không mạng, đội nhận bot cũ và được dùng nguyên/sao chép/sửa/thay trước cutoff, không phải viết lại; toàn bộ map chính/dự phòng công bố từ trước sự kiện. Mọi vòng online có player hai bot, chỉ đội thuộc vòng được xem các trận của vòng đó; dùng server snapshot + từng nước đi xuống UI để giảm tải. Offline chỉ BTC xem, không xây LAN/player client đội. Engine authoritative; code sinh viên chạy sandbox Linux đã kiểm thử. Nếu thiếu môi trường Linux, làm phần độc lập, giữ production upload tắt và báo phần chưa nghiệm thu, không giả lập thành công.

Prompt này không tự cấp quyền publish, gửi thông báo cho người khác, xóa dữ liệu thật hoặc mở server công khai. Khi được giao một milestone, hoàn thành milestone đó và báo cáo theo AGENTS.md của repository.

## 2. Bối cảnh đã xác minh

| Nội dung | Bằng chứng / hệ quả |
| --- | --- |
| Nhánh mặc định | `Ex2`, commit khảo sát `0a0b6b5c2992aa8973c6a052da6eff026800e897` |
| Nhánh phát triển giải | `origin/tournament/initial`, commit khảo sát `78cb8e20e83bf9d42445f3f166d42c09f95a7247` |
| Ex2 | React/Vite, game rooms, các file `src/game/*`, chưa có backend trong nhánh này |
| tournament/initial | Express/SQLite, Python runner, giải 8 bot/30 ván, UI/replay, tests, AGENTS.md và docs |
| Giới hạn nhánh tournament | local-dev trusted-only, subprocess không phải sandbox, chưa auth thật, worker tuần tự |
| Luật cũ khác đề xuất mới | 200 plies, 2 ván knockout, giao thức stateless; phải migrate/version, không đổi âm thầm |

Trong workspace soạn tài liệu, clone nằm ở `source-game/` và đang checkout Ex2; nhánh tournament mới được đọc bằng `git show`, chưa checkout/sửa. Không nhầm workspace chứa tài liệu với root repository code. Trước lập trình, xác minh lại branch/commit vì remote có thể đã thay đổi.

Các file cần đọc từ nhánh tournament: `AGENTS.md`, `IMPLEMENTATION_NOTES.md`, `README.md`, `docs/01_MVP_SCOPE_ARCHITECTURE.md` đến `docs/05_AGENT_PROMPTS.md`, `examples/sample_bot.py`; rồi đọc trực tiếp code ở `server/judge/`, `server/services/tournaments.js`, `server/worker.js`, `server/db.js`, `src/tournament/` và tests. Chú ý notes có thể lệch tên file/chi tiết so với code; code thực tế và test là bằng chứng.

### Quy tắc Git

Người tổ chức yêu cầu task mới = nhánh mới, tách từ `tournament/initial`, PR vào `dev`. Tạo tên mặc định `codex/<milestone-name>` trừ khi người dùng chọn khác. Kiểm tra nhánh `dev` có tồn tại trước khi chọn base PR; không tự tạo hoặc force push. Các milestone nối tiếp cần lấy commit đã hợp nhất hoặc nhánh phụ thuộc được ghi rõ, không bắt đầu lại từ base cũ và làm mất thay đổi milestone trước.

Không checkout/reset khi có thay đổi chưa commit cần giữ. Không đổi nhánh clone tham khảo chỉ để sửa tài liệu. Không tự mở PR khi nhiệm vụ chỉ yêu cầu đặc tả. Khi làm code thật, giữ nguyên các chế độ người chơi/room/spectator; regression phải bao gồm luồng này.

## 3. Yêu cầu sản phẩm bắt buộc

1. Tài khoản đội/admin/operator/judge; trận chính thức không mở spectator ẩn danh. Online đội chỉ xem trận/replay thuộc vòng đã tham gia; BTC/judge theo scope. Đội A không xem source/log riêng của B. Chế độ spectator game chơi tay cũ giữ nguyên.
2. Nhận online từ repo GitHub đã đăng ký, tự sync đúng `bot.py` UTF-8 ≤256 KiB tại SHA đã chốt. Chỉ thư viện chuẩn, không pip/ZIP/Dockerfile/build commands. Giữ metadata và cache chạy tạm, không ghi đè bài khóa; upload chỉ fallback, offline import file vẫn có.
3. SDK/sample bot và practice; quota 5 cặp/ngày và 10 commit mới được check/ngày/đội theo Asia/Bangkok. Poll cùng SHA không trừ quota; không buộc push code đồng nghĩa receipt nhận bài.
4. Vòng loại tuần 8 bảng cho 32–56 đội, vòng tròn cặp 2 ván đổi màu; 2 đội/bảng vào Top 16 offline. Các quy mô nhỏ theo điều lệ.
5. Tháng 4 tuần ×2 vé thành Top 8; kỳ 4 tháng ×2 vé thành Top 8, số giai đoạn cấu hình được. Trùng đội chuyển vé xuống thứ hạng chưa có vé, không cấm thi lại.
6. Chung kết tuần/tháng/kỳ offline không mạng. Phát lại đúng bot cũ cho đội, cho dùng nguyên/sao chép/chỉnh/thay, không kiểm gõ lại hoặc chặn clipboard. Đề xuất 30 phút đầu buổi kiểm tra/chỉnh bot và 15 phút trước mỗi vòng; khóa bài đồng thời, không sửa phiên bản dùng cho vòng đang chạy. Offline chỉ BTC cần xem, thu bài qua USB BTC, không LAN/client stream.
7. Toàn bộ pack map chính/dự phòng tuần/tháng/kỳ công bố trước sự kiện, có file JSON/preview/version/hash và assignment theo vòng/slot; được luyện và tối ưu theo map. Không secret map hoặc commit–reveal. Các ván chính của cặp cùng map và đổi màu; ván phụ dùng reserve đã công bố với snapshot giữ nguyên.
8. Linux nsjail + cgroups/namespace/seccomp cho mọi code thí sinh. Không mở production khi host preflight thất bại. Không lấy Python isolated flags làm cơ chế sandbox.
9. Engine authoritative, replay kiểm chứng hash, phân lỗi bot/hạ tầng, lease + fencing, backup và máy dự phòng.
10. Có màn hình giải/BXH/bracket/vé, editor/publish map, tiến độ chấm, player hai bot và replay. Online ACL theo round cho mọi đường đọc; server gửi nước đi xuống UI. Offline player chỉ BTC. Bundle có integrity/provenance.

Không làm Elo liên tục, fetch URL bất kỳ, đa ngôn ngữ, AI editor, terrain phức tạp hoặc dịch vụ phân tán. GitHub sync repo đội được duyệt là tính năng cần làm; ưu tiên polling/nút cập nhật, webhook sau nếu cần. SHA/hash cố định cho round, không pull head mới giữa ván. Tách sync credential khỏi runner và bộ offline.

## 4. Quy tắc thể thức để agent không tự sáng tác

### 4.1 Luật bàn và kết thúc

- Bàn 9×9, tọa độ a1..i9; base Đỏ a1, Xanh i9. Vùng xếp Đỏ `col+row<=8`, Xanh `>=12`, col/row tính 1..9; 25 ô giữa không xếp nhưng được đi nếu không bị cản.
- Mỗi bên 9 quân, 3 rock/3 paper/3 scissors, owner/type/ID do engine cấp. Đỏ xếp trước; Xanh thấy Đỏ; Đỏ đi trước.
- Đi một ô theo 8 hướng; chỉ đi trống hoặc ăn loại yếu hơn. Cùng loại/đồng đội/loại mạnh hơn chặn đích. Ô cản chặn đích; đi chéo bị cấm nếu cả hai ô kề cạnh bị cản.
- Thắng khi đến base địch hoặc ăn hết một loại quân địch; không còn legal move khi đến lượt thì thua.
- Sau mỗi nước: thắng → chuyển lượt/blocked → hòa lặp lần 3 → hòa đủ 400 plies. Lặp xét board owner/type/square + turn + map, bỏ ID các quân cùng loại và timestamp. Không có pass, không cứu setup sai bằng random.

### 4.2 Điểm và bracket

- Ván thắng/hòa/thua = 1/0,5/0. Lưu integer half-points 2/1/0 để tránh floating point.
- Cặp vòng bảng thắng/hòa/thua = 3/1/0 điểm bảng. Không nhầm với hệ cũ tính 3/1/0 trực tiếp mỗi ván.
- Xếp bảng: điểm bảng → điểm cặp đối đầu nhóm đồng điểm → tổng điểm ván → điểm ván đối đầu nhóm đồng điểm → seeded draw. Mini-table group lấy một lần từ nhóm bằng điểm bảng, không recalculate recursive.
- Seed Top 16: nhất bảng trước nhì bảng; trong mỗi nhóm so điểm bảng tối đa hóa thành phân số `points/(3*seriesPlayed)`, rồi điểm ván/game; so bằng tích chéo integer. Seeded draw phá hòa. Không dùng cùng tổng điểm thô khi bảng khác cỡ.
- Ghép 1–16, 2–15, … theo bracket chuẩn; tránh cùng bảng vòng đầu bằng tối ưu permutation seed 9–16 như điều lệ. Giữ seed giải gốc, không reseed sau vòng.
- Knockout 4 ván/cặp, trận nhất 6 ván; hòa thêm đúng 2 ván đổi màu trên reserve map; vẫn hòa seed giải tốt hơn đi tiếp. Đấu đủ ván chính.
- Cả hai missing = double-DQ và nhánh tiếp theo bye. Bye/walkover là kết quả hành chính, không phải transcript ván giả.
- Xếp đủ top16: 1/2/3/4 theo trận, 5–8 và 9–16 theo vòng bị loại rồi seed. Dùng bảng này cấp vé/dự bị.
- Vé tháng/kỳ unique theo team/target event. Team đã có vé vẫn dự thi được; chuyển cho đội thứ hạng cao kế tiếp chưa có vé. Chỉ cấp sau finalize và giải quyết khiếu nại; thiếu ứng viên thì ghi vé trống, tổ chức tranh vé, không cấp trùng.

### 4.3 Quy mô chuẩn để test

| Case | Cặp bảng | Ván bảng | Ván chính offline | Ván phụ tối đa |
| --- | ---: | ---: | ---: | ---: |
| 35 đội, bảng 4/5 | 60 | 120 | 66 cho Top16 | 32 |
| 40 đội, bảng 5 | 80 | 160 | 66 | 32 |
| 48 đội, bảng 6 | 120 | 240 | 66 | 32 |
| 50 đội, bảng 6/7 | 132 | 264 | 66 | 32 |
| Tháng/kỳ Top8 | không vòng bảng onsite | 0 | 34 | 16 |

Các số offline có trận tranh ba, không tính walkover/bye. Case 6 đội kỳ: bracket8, hai bye cho seed1–2; đừng tạo fake game cho bye.

## 5. Kiến trúc cần giữ và cách thay đổi an toàn

Giữ React/Vite/CSS hiện có, Node.js JavaScript ESM/Express, `better-sqlite3`, Node built-in `node --test`, polling trước khi cần SSE. Giữ `src/game` và `server/judge/gameAdapter.js` làm nơi chia sẻ rules; đưa phần map/validation vào helper testable, không fork một engine server không liên quan với UI. Bổ sung thư mục `server/contracts`, `server/replay`, `sandbox`, `runtime/python`, `tools/cli` khi cần. Không cần monorepo, TypeScript migration, Docker/Compose, Redis hoặc Kubernetes.

Đường game chơi tay dùng default behavior cũ; tournament dùng `rulesVersion=ott-campus.v1` và `map.v1`. Đồng hồ/PRNG vào helper bằng dependency injection; engine không tự đọc clock/network/random toàn cục để quyết định thắng hoặc xếp hạng. Replay cũ giữ decoder riêng; không chạy lại bằng rules mới rồi khẳng định khớp.

Protocol production mới `bot.v1` dùng process sống cả ván. Protocol MVP hiện tại process-per-request phải để ở `legacy` chỉ trusted local-dev hoặc chuyển toàn SDK/fixtures có version rõ. Không pha hai kiểu để code chạy được tình cờ. Nếu muốn giữ stateless vì công sức, phải đưa thành lựa chọn kỹ thuật công khai mới, đo chi phí khởi động và sửa tài liệu trước code; không tự quyết âm thầm.

### Không để code rủi ro được công khai trước sandbox

Feature flag chế độ chạy:

```text
local-dev: chỉ loopback, chỉ code tin cậy, cảnh báo rõ, không tuyên bố sandbox
production: host preflight + nsjail bắt buộc, auth/quota, không fallback subprocess
offline: không outbound và không listener LAN, import bởi operator, nsjail bắt buộc
```

Nếu nsjail không chạy trên máy Windows, agent vẫn làm engine/schema/UI/migrations; giữ đường chấm thật tắt, cung cấp hướng dẫn Linux và đánh dấu Linux acceptance chưa chạy. Không dùng mock runner để báo pass E2E production.

## 6. Contract kỹ thuật cần tạo thành file thật

- JSON Schema `map.v1`, `bot.v1.request`, `bot.v1.response`, `replay.v1`, `offline-bundle.v1` và `rules.v1` config.
- Map 9×9 cố định, bases a1/i9, diagonal setup, blocked đối xứng 180°, ít nhất 9 setup squares mỗi bên, graph đúng luật 8 hướng/corner rule; kiểm connectivity và hai đường vertex-disjoint. Pack published có nội dung đầy đủ trước cutoff, kể cả reserve; draft chưa duyệt private.
- Canonical serializer có test cho object key order, blocked order, UTF-8; SHA-256 không tham chiếu hash của chính object. IDs/version metadata được tách với hash nội dung theo spec.
- Bot response `protocolVersion,requestId,kind` + `placements[{pieceId,square}]` hoặc `pieceId,to`. Setup đủ 9; reject unknown fields/duplicate keys/NaN/depth>16. SDK đọc/ghi đúng một dòng, flush.
- Replay chứa initial config, map/runtime/rules/source hashes, raw bounded transcript private, actions, terminal fault và resultingStateHash từng event. Viewer không cần bot source để xem lại.
- Offline bundle có manifest/hash/chữ ký Ed25519, organizer/team/result tách biệt; key private không nằm trong gói và jail.

Ví dụ API/schema chi tiết nằm trong `03-DAC-TA-KY-THUAT.md`. Dùng một contract làm nguồn cho validator, docs và fixtures; không chép ba bản field names lệch nhau giữa Python/JS/UI.

### Budget production ban đầu

Source 256 KiB; request 64 KiB; response line 16 KiB; stdout 4 MiB/ván/bot; stderr 256 KiB/ván/bot; tmpfs 16 MiB; RAM 256 MiB/bot; pids 16; cpu quota 1 core/bot; CPU tổng 30 giây/bot/ván; startup 5 giây, setup 5 giây, move 1 giây wall; tổng wall chờ phản hồi 45 giây/bot/ván; ván watchdog 120 giây; 400 plies; 2 slots. Đây là profile dự kiến, phải benchmark khóa lại trước giải.

Cgroup CPU gồm boot, mọi child và activity đến freeze; per-request wall dùng monotonic clock, không tính chờ đối thủ vào tổng response budget. Freeze/resume toàn jail giữa lượt. Budget vượt => fault riêng; worker/host lỗi => infra attempt, không draw. Cgroup cleanup phải xác nhận empty trước trả slot. Seccomp cấm network/process creation theo policy compatible với Python; không dùng forkbomb test ngoài VM cách ly.

## 7. Database/API migration

Đừng xóa bảng cũ hoặc `data/` để test cho tiện. Dùng schema migrations có version và backup/restore. Bổ sung teams/users/memberships/events/registrations/submission scopes/round_freezes/map_packs/series/game_slots/jobs/attempts/artifacts/standings/tickets/decisions/audit/bundles theo spec; tên cũ có thể giữ nếu mapping rõ và đáp ứng bất biến.

Bất biến cần constraint/transaction thật:

```text
unique(teamId,eventId) registration
unique(seriesId,gameIndex) game slot
at most one acceptedAttempt per game slot
unique(targetEventId,teamId) for active ticket
unique(bundleId) import receipt
immutable sourceHash/mapHash/runtimeHash after freeze
```

Lease claim bằng CAS transaction, lease 30 giây/heartbeat 5 giây; mỗi claim tăng generation; report phải đúng owner/token/generation và lease còn hiệu lực. Idempotent retry/report/import/finalize, không chỉ check trên UI. Artifact durable trước result transaction. Retry infra tối đa 2 lần, cùng inputs, stale report bị fence. Một coordinator ghi SQLite; worker khác máy dùng internal API, không dùng network share DB.

Auth và quyền kiểm trên mọi route/artifact, không chỉ UI. Operator seal/import nhưng không tự sửa kết quả; judge đề nghị, admin khác xác nhận. Không phát source/log/team private/worker token/draft map. Local admin key demo phải migration. Thêm round_participants và scoped grants: team cùng round online xem mọi trận round đó, không tự xem round sau; offline btc_only/judge kể cả replay sau sync. Practice chỉ owner. Predicate dùng chung cho list/detail/state/events/SSE/replay/file; không public URL/cache bypass; thu hồi quyền đóng stream.

Viewer nhận snapshot seq N + events từ N+1; action server đã kiểm gồm setup/move/terminal, seq, attemptId/resultVersion và stateHash. UI dedup, phát hiện gap/hash sai, resnapshot khi retry/reset; không tự tính kết quả để ghi server. Một trận chỉ có một execution bất kể bao nhiêu người xem. Poll event theo batch mỗi 1–2 giây, backoff/catch-up; SSE là nâng cấp tùy tải, không video. Full-state fallback vẫn cùng ACL. Không xây client viewer đội cho offline.

## 8. Milestone thực hiện và bằng chứng hoàn tất

### M0 — Khảo sát và baseline

Đọc branch/AGENTS/docs/code/tests; ghi version Node/Python/SQLite và baseline. Dùng lockfile hiện có; chạy lệnh cài theo AGENTS/repo và kiểm native `better-sqlite3` trên máy thật, không tự upgrade cả dependency tree. Chạy `npm run build`, `npm test` nếu script tồn tại. Không chạy bot không tin cậy trên host Windows chỉ vì test yêu cầu. Chụp trạng thái/luồng game chơi tay và tournament8 cũ. Bàn giao bảng những gì giữ, mở rộng, thay thế có version; chưa mở API public.

### M1 — Map, luật và deterministic engine

Thêm MapV1/schema/canonical hash, obstacles/corner rule/graph validation, adapter setup đúng map, repetition/400 plies/NO_LEGAL_MOVE, injected clock/RNG. Test golden luật cũ cho map không cản và rules profile tương ứng. Đảm bảo UI room không thay behavior. CLI validate map và replay verifier chạy được. Nghiệm thu case xếp Đỏ ở sân Xanh bị từ chối ở server adapter, không chỉ ở Board.

### M2 — SDK và production runner

Tạo sample random/greedy/base-seeking + blank template, docs Python offline. Hợp đồng persistent JSONL có requestId, strict parser. Supervisor nsjail cgroup đầy đủ, metrics, faults, cleanup, host preflight, fail closed. Kiểm thử Linux thật tốt/lỗi/timeout/RAM/process/network/filesystem/output. Bàn giao log cgroup empty, cấu hình pin và số đo P95. Không được báo hoàn tất production bằng subprocess legacy.

### M3 — Scheduler nhiều đội và hệ giải

Implement bảng cân bằng, seed/draw tái lập, round-robin2 ván/cặp, standings exact rational, bracket Top16/8/4, trùng bảng, 4/6 ván +2 phụ, administrative byes, ranking đầy đủ. Events tuần/tháng/kỳ và tickets unique/chuyển/thiếu/withdrawal. Test số ván chuẩn và finalize lặp không sinh thêm trận/vé. Chưa có web cũng phải demo được bằng CLI/fixtures.

### M4 — Snapshot, auth, practice và queue tin cậy

User/team roles, upload kiểm input, check async trong sandbox, cutoff chọn valid, quotas, private artifact route, lease fencing/attempt/result atomicity, audit và quyết định phân xử. Thử 2 workers claim cùngjob, crash/duplicate/stale response và disk full. Production upload chỉ bật trong môi trường đã đạt M2, không bật global demo flag.

### M5 — Web và map editor

Nâng UI `src/tournament` với đội/bài, practice, lịch tuần/tháng/kỳ, vé, bảng/bracket/replay; editor map đối xứng + validate/duyệt/publish/khóa; dashboard queue/seal. Online player hiển thị hai bot theo snapshot/event server, chỉ list trận thuộc round của đội; test ACL cả backend. Offline chỉ dashboard/player BTC localhost. Nhãn tiếng Việt rõ “tạm thời/chính thức/chưa kiểm chứng”, tọa độ/legend ô cản dễ đọc, không chỉ dựa màu. Pack tải được trước giải, không còn màn hình chờ tiết lộ map.

### M6 — Offline phát lại bot và thu bài

Organizer/team/result bundles có chữ ký/hashes, đúng bot cũ có thể dùng/sửa của từng đội, toàn bộ map đã công bố, local docs/simulator. Không bắt đầu rỗng, không chống copy/paste hoặc so mã cũ–mới. Operator seal đúng hạn bằng giờ BTC, import file đúng hash; bot cũ được chấp nhận nếu đội xác nhận nộp nguyên bản. Không LAN/Internet/SSO/CDN/Git/analytics; chỉ BTC xem diễn biến bằng localhost, máy đội không cần viewer. Chỉnh trước round, freeze đồng thời, giữ snapshot ván phụ. Import result idempotent, không overwrite DB online; giữ offline game/replay btc_only/judge. Máy dự phòng restore được.

### M7 — Capacity, rehearsal và bàn giao

Chạy 50 đội/264 ván với 2 slots và khoảng 100 viewer online có quyền round; ghi hardware/runtime/profile/P50/P95/throughput/băng thông và stage barriers. Diễn tập offline phát lại/dùng nguyên/sửa bot, thu USB, BTC xem, worker chết/restore; không yêu cầu client đội xem. Xuất runbook, checklist, backup, hướng dẫn và giới hạn còn lại. Nếu lịch không đủ, chốt Top 8 hoặc kéo dài trước đăng ký; không giảm ván sau kết quả.

Mỗi milestone có build/test phù hợp; không lặp toàn bộ stress test khi chỉ sửa văn bản hoặc màu UI. Test nguy hiểm chỉ chạy ở VM test sạch. Giữ các fixtures có ý nghĩa, không viết test chỉ lặp implementation.

## 9. Các kịch bản nghiệm thu cụ thể

| ID | Kịch bản | Kết quả mong đợi |
| --- | --- | --- |
| E01 | Bot Đỏ xếp 9 quân tại sân Xanh | INVALID_SETUP, thua; không auto-fill |
| E02 | Bot khai owner/type mới hoặc ID đối thủ | Schema/validation reject, không mutate state |
| E03 | Nước400 chiếm base | Thắng BASE_REACHED, không hòa PLY_LIMIT |
| E04 | Hai quân rock cùng bên đổi vị trí tạo board tương đương | Repetition key bỏ piece ID, tính đúng lần3 |
| M01 | Map editor chặn e4 nhưng không e6 | Không approve vì thiếu đối xứng |
| M02 | Map chặn nhà hoặc cô lập một ô setup | Validator fail, không tạo series |
| M03 | Đã khóa pack rồi admin đổi JSON | Từ chối; muốn sửa tạo revision/pack mới |
| P01 | JSON đến thành nhiều chunk nhưng một dòng hợp lệ | Buffer có giới hạn, parse đúng một response |
| P02 | Bot gửi hai response hoặc sai requestId | PROTOCOL_ERROR, không dùng dòng sau cho lượt mới |
| P03 | Bot im lặng/không flush | TIMEOUT; cleanup cả cgroup |
| S01 | Bot đọc host secret, network, spawn, write source | Bị isolate/deny; host không lộ dữ liệu |
| S02 | Bot vượt RAM/CPU/output | Fault đúng loại, worker còn chạy, jail sạch |
| Q01 | Hai runner nhận cùng job và report trễ | Một claim/result được nhận; stale bị fence |
| Q02 | Runner chết giữa nước đi | Infra retry cùng input; không cộng hòa |
| Q03 | Report thành công gửi lại ba lần | Cùng receipt, điểm tính một lần |
| T01 | 50 đội chia8 bảng | 6 bảng6 +2 bảng7, 132 cặp264 ván |
| T02 | Nhiều đội bằng điểm và nhóm bị tách | Mini-table một lần, thứ tự tái lập |
| T03 | Hai bên hòa toàn bộ knockout | Chạy đúng2 ván phụ, seed tốt hơn đi tiếp |
| T04 | Cả hai đội không có bài khóa | Double-DQ; next branch bye |
| K01 | Đội đã có vé tháng lại vô địch | Được danh hiệu, vé mới cấp đội chưa có vé tiếp theo |
| K02 | Finalize/import lặp | Không sinh vé hoặc game trùng |
| O01 | Tắt Wi-Fi/rút Ethernet trên mọi máy | Tài liệu, viết bot, chấm và chiếu chạy được |
| O02 | Đội A mở bundle của mình | Bot A dùng/sửa được, đầy đủ map đã công bố, không source B |
| O03 | Nộp đúng giờ, BTC import USB muộn | Nhận theo seal ledger, không mtime |
| O04 | File nộp khác hash giám thị đã seal | Từ chối nhập, có quyết định xử lý |
| O05 | Sửa code giữa2 ván cùng cặp | Không đổi snapshot dùng cho ván sau |
| O06 | Restore máy dự phòng rồi import kết quả | Kết quả accepted giữ đúng, attempt cũ không sống lại |
| O07 | Đội xác nhận nộp nguyên bot cũ | Chấp nhận nếu valid, không đòi viết lại/khác hash bản cũ |
| O08 | Offline máy đội không có player/mạng | BTC vẫn xem/chấm được; không thiếu chức năng bắt buộc |
| V01 | Đội thuộc round online xem trận đội khác cùng round | Được xem state/events/replay, không source/log riêng |
| V02 | Đội bị loại thử đọc trận round sau qua API/file URL | Từ chối ở mọi đường đọc; không chỉ ẩn UI |
| V03 | Event trùng/thiếu hoặc attempt thay đổi | Dedup/catch-up/resnapshot, không ghép hai attempt |
| V04 | Thu hồi quyền trong lúc SSE đang mở | Đóng stream, reconnect không được đọc tiếp |
| V05 | Sync trận offline lên online | Vẫn chỉ BTC/judge xem replay, không tự cấp cho đội |
| R01 | Replay thiếu event hoặc sai state hash | Hiện chưa kiểm chứng, không giả là replay chuẩn |

## 10. Runbook BTC cần có trong sản phẩm

### Trước mùa

Chốt điều lệ/ngày/giải thưởng/hệ vé/chính sách AI; chuẩn bị máy và tài khoản sạch; pin runtime; kiểm host Linux sandbox; tập huấn giám thị; có người thay vận hành. Phát SDK/docs/sample, giải thích 1 ply, setup bất đối xứng, đổi màu và map dynamic. Tạo calendar stage thực tế, không hardcode một học kỳ luôn4 tháng.

### Mỗi tuần

Tạo pack map → validate/duyệt → công bố toàn bộ JSON/preview/hash/assignment trước cutoff → practice → khóa submissions → đợi check xong → draw và ghi round_participants → chấm + cấp viewer đúng round → replay/khiếu nại → finalize qualifier → mời đội offline → export organizer/team bundles riêng. Giám thị không chia gói organizer có source nhiều đội cho thí sinh.

### Ngày offline

Kiểm bundle/backup → phát bot cũ và map đã công bố cho đúng đội → ngắt mạng → 30 phút đầu dùng/kiểm tra/chỉnh bot → khóa bracket, xác nhận assignment → 15 phút chỉnh trước round → seal mọi đội → thu USB/import/đối soát → chạy queue và BTC xem localhost → thông báo kết quả → khiếu nại → vòng kế. Ván phụ không mở sửa bài. Cuối buổi xác minh/trao giải, backup/export result, cấp vé sau finalize. Dự kiến 5 giờ Top 16, 3–4 giờ Top 8; diễn tập trước đăng ký.

### Có sự cố

Bot lỗi riêng: xử ván theo reason, không restart cả giải. Worker/host lỗi: pause, lưu attempt, fence/cleanup, chuyển máy dự phòng, retry cùng inputs. Map lỗi: dừng, BTC quyết định phạm vi chạy lại; không đổi âm thầm. Mất máy thi đội: dùng bản sealed gần nhất hoặc cấp thời gian bù theo điều lệ bằng nhau/ghi nhận sự cố; không tự cho xem mạng để lấy code.

### Kết thúc sự kiện

Đối soát game counts/attempts/standings/tickets và ACL, import idempotent, giữ quyền offline. Source chính ở GitHub; cache có pin giữ đến finalized/đóng khiếu nại +72 giờ, không xóa bài còn cần cho round/appeal/offline. Metadata/replay/log có thể giữ 90 ngày sau kỳ. Backup chứa source cũng cùng hạn/pin. Không commit bot sinh viên vào repo game; xem file 06.

## 11. Lệnh cần cung cấp: phân biệt hiện có và mục tiêu

Các script đã thấy ở nhánh tournament tại lúc khảo sát:

```text
npm run dev              # frontend
npm run dev:api          # Express API local
npm run dev:worker       # worker legacy local
npm run worker:once
npm run worker:drain
npm test
npm run test:server
npm run build
```

Đây không phải hướng dẫn mở public production; runner hiện tại chưa sandbox. Agent kiểm lại package.json trước sử dụng.

Các CLI **mục tiêu cần lập trình**, chưa có sẵn:

```text
npm run tournament -- host-check --profile production
npm run tournament -- map-validate --file <map.json>
npm run tournament -- map-pack-lock --pack <id>
npm run tournament -- qualifier-run --event <id>
npm run tournament -- map-pack-publish --pack <id>
npm run tournament -- round-seal --round <id> --ledger <file>
npm run tournament -- offline-export --event <id> --out <folder>
npm run tournament -- offline-verify --bundle <folder>
npm run tournament -- offline-import --bundle <folder>
npm run tournament -- replay-verify --file <replay.jsonl>
npm run tournament -- backup --out <folder>
npm run tournament -- restore-verify --bundle <folder>
```

CLI phải có `--help`, exit code hữu ích, lỗi tiếng Việt dễ hiểu, dry-run cho import/restore, receipt và audit cho mutation. Secrets lấy từ file/env được bảo vệ, không argv/log. Restore dữ liệu thật phải xác nhận đúng target và backup trước, không tự xóa thư mục theo path ghép chuỗi.

## 12. Cấu hình và tài liệu vận hành phải bàn giao

`.env.example` không chứa secret, mô tả `RUN_MODE`, `BIND_HOST`, `PORT`, `DATA_DIR`, `SQLITE_PATH`, `ARTIFACT_ROOT`, `PYTHON_ROOTFS`, `NSJAIL_BIN`, `SANDBOX_PROFILE`, `WORKER_CONCURRENCY`, `LEASE_MS`, `HEARTBEAT_MS`, `RULES_VERSION`, `TIMEZONE`, `OFFLINE_SIGNING_KEY_PATH` và `TRUSTED_PUBLIC_KEYS_PATH`. Rootfs runtime phải nằm ngoài kho bài sinh viên. Tất cả giới hạn nằm trong versioned budget profile, không rải số magic trong UI/worker.

README bổ sung local tin cậy/Linux production/offline không mạng, nhập/xuất/backup/restore; giữ hướng dẫn chơi game cũ. Hướng dẫn sinh viên gồm API/lỗi/seed/map runtime, stdout vs stderr, luyện local, nhận và tự do dùng/sửa bot cũ, xem trận online đúng round. Hướng dẫn BTC nêu công bố map từ trước và offline chỉ BTC xem.

Hướng dẫn BTC gồm tạo lịch, roster, map review, seal/cutoff, tickets, khiếu nại, snapshot receipt, giám thị và khôi phục. Hướng dẫn giám thị không đòi hỏi biết shell hoặc SQLite để thu một bài.

## 13. Mẫu báo cáo sau milestone

Nêu kết quả và hành vi đã có, danh sách file quan trọng, lệnh kiểm tra thật và kết quả, test Linux/offline nào chưa chạy, thay đổi schema/protocol cần migrate, rủi ro có bằng chứng, bước tiếp theo. Không nói “đã an toàn” chỉ vì bot mẫu chạy; không nói “đã offline” khi vẫn gọi CDN; không nói “đã công bằng map” chỉ vì có ô cản đối xứng.

Definition of Done: website thao tác được; đúng snapshots/maps/luật/điểm/vé; code lạ chạy jail kiểm chứng; map công bố trước; bot cũ dùng/sửa được; online xem trận theo round bằng server events và ACL; offline chỉ BTC xem/chấm không mạng; replay hash đúng; recovery diễn tập; không phá game cũ hoặc còn mock trên đường thi thật. Liệt kê những kiểm tra chưa chạy, không lấp bằng cờ success.

## 14. Thứ tự quyết định khi tài liệu khác nhau

Yêu cầu mới nhất thay thế yêu cầu trước: không viết lại bắt buộc hoặc giữ kín map; đội nhận bot cũ và tự do dùng/sửa trước hạn, map tuần/tháng/kỳ công bố trước. Online có viewer đúng round; offline chỉ BTC xem, không LAN/client viewer đội. Giữ 35–50 đội, hệ vé và sandbox. Giữ quy tắc bảo toàn repo/framework AGENTS.md; migrate scope/protocol cũ rõ ràng. Nếu còn xung đột chưa giải quyết, đưa ví dụ và đề xuất nhỏ nhất, không bỏ an toàn hoặc viết lại project.

Nguồn yêu cầu: [tài liệu nhóm](https://docs.google.com/document/d/18dIiYvJgU5WNyXqWZ96JbX-64nBJq6MqnXaCY2gZKG0/edit?tab=t.0), [nhánh tournament](https://github.com/Hkoado/OOTv2-Game/tree/78cb8e20e83bf9d42445f3f166d42c09f95a7247), và điều chỉnh trực tiếp của người tổ chức ngày 22/10/2026. Bốn tài liệu mới cùng tạo thành bộ thiết kế; file này đủ bối cảnh khởi động nhưng không thay thế contract chi tiết ở file 03.
