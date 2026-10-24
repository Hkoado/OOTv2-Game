# Đặc tả kỹ thuật OTTv2 Campus Bot League — phương án B

Phiên bản thiết kế 1.1, cập nhật ngày 22/10/2026. Chưa phải phần mềm đã triển khai. Điều lệ tại `01-THE-THUC-GIAI.md` và lựa chọn tại `02-PHUONG-AN-TRIEN-KHAI.md` là đầu vào. Bản này thay yêu cầu viết lại/giữ kín map bằng dùng lại bot/map công bố trước; xem trận cho đội chỉ áp dụng online theo vòng, offline chỉ BTC xem. Các yêu cầu dùng “phải” là tiêu chí nghiệm thu; thông số thời gian phải benchmark và khóa trước mở giải.

## 1. Mục tiêu và ranh giới

Hỗ trợ 35–50 đội Python, giải tuần/tháng/kỳ; nộp và luyện tập online, vòng loại tự động, chung kết offline không mạng. Đội được phát bot cũ và tự do dùng/sao chép/sửa/thay trước cutoff; map cụ thể công bố trước sự kiện và có phiên bản theo tuần/tháng/kỳ. Online chỉ đội thuộc vòng được xem các trận của vòng; offline chỉ BTC cần xem. Máy chấm là nguồn kết quả chính thức, UI không quyết định nước hợp lệ hoặc thắng thua.

Thiết kế một coordinator, một database cục bộ và một hoặc hai runner tin cậy. Mùa đầu mặc định 2 game slots toàn hệ thống. Không xây rating liên tục, billing, marketplace bot, đa ngôn ngữ hoặc phân tán nhiều vùng. Kế thừa nhánh `tournament/initial` tại commit `78cb8e20e83bf9d42445f3f166d42c09f95a7247`, giữ Node.js JavaScript ESM + Express + better-sqlite3 + React/Vite và Node built-in tests. Không yêu cầu đổi framework hay viết lại ứng dụng.

## 2. Cấu trúc và tái sử dụng

Giao diện theo [tích hợp UI vào repo](05-TICH-HOP-UI-VA-REPO.md) và [Hướng dẫn vận hành](runbook/BAN-TO-CHUC.md). Token JSON có hai theme là nguồn thị giác; không suy luật terrain từ ảnh tham khảo. Giữ behavior game cũ, migrate CSS có scope và kiểm tra hồi quy.

```text
src/tournament/           UI hiện có, bổ sung portal/BTC/map/replay
src/game/                 luật hiện có; thêm helper thuần tương thích ngược
server/routes/            Express API hiện có + auth/map/event/offline
server/services/          scheduler, bảng đấu, vé, snapshot, artifact
server/judge/             adapter/runner hiện có, thêm production nsjail supervisor
server/contracts/         JSON Schema, JSDoc types, version, canonical JSON
server/replay/            replay writer/verifier; viewer trong src/tournament
tools/cli/                validate/import/run/export/restore/simulation
runtime/python/           rootfs, launcher và Python đã pin
sandbox/                  nsjail, seccomp, cgroup setup, host preflight
fixtures/                 trạng thái, map, bot tốt/lỗi, expected result
docs/                     điều lệ, đặc tả, hướng dẫn, runbook
```

`source-game/` là clone tham chiếu, đang checkout Ex2 tại commit `0a0b6b5c2992aa8973c6a052da6eff026800e897`; phần tournament đã khảo sát bằng `git show origin/tournament/initial`. Khi triển khai phải bắt đầu từ nhánh tournament theo quy ước của nhóm. Adapter hiện có đã làm validation setup; engine thuần mở rộng tiếp adapter và rule helpers, có test hồi quy. `gameState.js` có `Date.now`, `Math.random`, auto-place; không dùng các giá trị đó trong quyết định giải. Giữ default room behavior, bổ sung clock/RNG/config có injection hoặc helper tournament riêng chia sẻ cùng rule primitive. Không viết lại rules thành hai bản khác nhau.

Giữ chế độ chơi tay/room/spectator hiện có; chỉ đường thi đấu chính thức tách khỏi `usePlayRoom`, PeerJS và playhtml. UI replay tiếp tục dùng phần render Board/Square/Piece/MoveHistory hiện có. Backend mới là mở rộng theo milestone, không thay ứng dụng bằng project khác.

### Migration từ MVP hiện có

MVP hiện có giải 8 đội/30 ván, file 64 KiB, 200 plies, process mới mỗi request, chưa sandbox OS, chưa login thật. Thiết kế này dùng 256 KiB/400 plies và process sống cả ván cho profile `bot.v1`. Phải version schema/protocol/rules, giữ adapter đọc replay cũ, không đưa bot stateless cũ vào runner mới mà không chuyển SDK. Legacy runner chỉ ở trusted local-dev; production fail closed khi nsjail chưa sẵn sàng. Lỗi hạ tầng trong code cũ có thể thành hòa `internal_error`; thay bằng attempt lỗi hạ tầng không tính điểm. DB migration có backup, không sửa kết quả cũ thành luật mới.

## 3. Engine và luật quyết định

API thuần tối thiểu (ký hiệu type bên dưới để mô tả contract; triển khai JavaScript ESM với JSDoc/JSON Schema):

```ts
validateMap(map: MapV1): ValidationResult
createGame(config: GameConfig): GameState
getObservation(state: GameState, player: Player): Observation
validateSetup(state: GameState, player: Player, placements: Placement[]): ValidationResult
applySetup(state: GameState, player: Player, placements: Placement[]): Transition
listLegalMoves(state: GameState, player: Player): Move[]
applyMove(state: GameState, player: Player, move: Move): Transition
adjudicateBotFault(state: GameState, player: Player, fault: BotFault): Transition
canonicalState(state: GameState): Uint8Array
```

Engine không tự đo thời gian. Supervisor phát fault có bằng chứng đo được; engine quyết định kết quả từ fault. Mọi action phải kiểm phase, bên, quyền sở hữu quân, schema, tọa độ, ô cản và tính hợp lệ; không dựa vào danh sách legal moves gửi cho client.

State machine: `created -> setup_red -> setup_blue -> playing -> finished`. Thông tin lifecycle chạy ván (`queued/running/...`) tách khỏi phase engine. Đỏ setup không thấy vị trí Xanh chưa xếp; Xanh setup thấy đầy đủ quân Đỏ. Khi chơi, cả hai thấy toàn bộ quân sống. Quân khởi tạo có ID ổn định, owner/type bất biến; placement chỉ gồm `pieceId,square`, không được khai báo lại owner/type/alive.

Setup yêu cầu đúng 9 ID đã cấp, mỗi ID một lần, đúng vùng trừ ô cản, không trùng ô. Không auto-place. Phải kiểm đủ 3 quân mỗi loại từ danh sách engine; không gọi điều kiện diệt loại trước hoàn tất hai setup.

Di chuyển một ô theo 8 hướng; ô trống hoặc quân địch yếu hơn. Ô cản chặn đích. Đi chéo bị cấm nếu cả hai ô kề cạnh của bước chéo đều là ô cản; quân đứng ở hai ô kề cạnh không tạo quy tắc cắt góc. Bị khóa tất cả quân ở đầu lượt thì thua `NO_LEGAL_MOVE`, không gọi bot để xin pass.

Sau mỗi action hợp lệ: cập nhật bàn → xét thắng do nhà/diệt loại → chuyển lượt → kiểm bị khóa bên mới → xét lặp → xét 400 plies. Nếu đã thắng thì không ghi đè thành hòa. Trạng thái lặp dùng `mapHash + sorted(owner,type,square của quân sống) + sideToMove`; không gồm ID các quân cùng loại, đồng hồ, requestId, history hay seed. Đếm trạng thái đầu khi đủ setup là lần 1; hòa lần xuất hiện thứ 3. Toàn state replay có thể chứa ID nhưng repetition key phải độc lập ID.

`GameResult`: `red_win | blue_win | draw`; `terminationReason` enum riêng, gồm `BASE_REACHED, TYPE_ELIMINATED, NO_LEGAL_MOVE, REPETITION, PLY_LIMIT, BOT_TIMEOUT, BOT_CPU_LIMIT, BOT_MEMORY_LIMIT, BOT_CRASH, INVALID_JSON, INVALID_SETUP, ILLEGAL_MOVE, OUTPUT_LIMIT, PROTOCOL_ERROR`. `INFRA_ERROR`, `ADMIN_CANCEL` không phải kết quả ván tính điểm.

## 4. MapV1, version và chọn map

Ví dụ hợp lệ về cấu trúc:

```json
{
  "schemaVersion": "map.v1",
  "id": "w01-arena-03",
  "revision": 1,
  "width": 9,
  "height": 9,
  "bases": {"red": "a1", "blue": "i9"},
  "setupZoneRule": "diagonal-28-v1",
  "blocked": ["e4", "e6"],
  "cornerRule": "block-if-both-orthogonals-blocked",
  "rulesVersion": "ott-campus.v1"
}
```

Trong v1, `width/height/bases/setupZoneRule/cornerRule` là các giá trị cố định được kiểm bằng schema, chưa hỗ trợ admin thay kích thước hoặc tùy biến vùng. Quay 180°: `(col,row)->(10-col,10-row)`. Các trường hash/status/reviewer không thuộc nội dung map để tránh hash tự tham chiếu. SHA-256 tính trên UTF-8 canonical JSON: key object sắp từ điển, không whitespace, `blocked` loại trùng và sort theo `(row,col)` trước khi lưu; từ chối input trùng ô thay vì lặng lẽ chuẩn hóa bài sai.

Validator: đúng schema, tọa độ `^[a-i][1-9]$`, không ô ngoài bàn, đối xứng quay, không chặn base, mỗi vùng có ít nhất 9 ô trống, toàn bộ ô xếp trống có đường đến base đối phương khi bỏ qua quân. Graph dùng adjacency của engine gồm luật cắt góc. Kiểm tối thiểu hai đường vertex-disjoint giữa tập ô xếp hai bên qua vùng giữa bằng node-splitting max flow; không đếm các super-node nối tập nguồn/đích. Lưu báo cáo kiểm tra và preview. Điều này không chứng minh map cân bằng chiến thuật; thêm kết quả bot mẫu đổi màu và duyệt thủ công.

`MapPack`: eventId/cấp tuần-tháng-kỳ, version, rulesVersion, danh sách hash map theo round/primary/reserve, quy tắc gán map, publishedAt, cutoff và metadata duyệt. Draft nội bộ có thể sửa; published/locked bất biến, chỉnh phải tạo version mới và thông báo trước cutoff với thời gian chuẩn bị đồng đều. Mỗi giải công bố toàn bộ nội dung pack và preview từ trước, kể cả reserve. Không cần secret seed hoặc commit–reveal để giữ kín bố trí.

Phân map: BTC công bố manifest gán `eventId|roundId|bracketSlot -> primaryMapHash,reserveMapHash` trước cutoff, không chọn dựa trên source hoặc kết quả. Nếu chưa bốc thăm, công bố theo slot bracket; sau draw gắn team/series vào slot mà không đổi mapping. Vòng bảng có thể dùng một map chung hoặc quy tắc phân cặp xác định đã công bố. Map có thể lặp giữa các cặp/vòng nếu manifest quy định; reserve chọn khác primary khi pack có nhiều map. Không tạo lại seriesId để đổi assignment. Hai màu cùng map trong block; map/seed bot/runtime đều ghi vào replay.

Khóa bài trước vòng đồng thời cho tất cả đội sau cửa sổ chỉnh chung 15 phút, không phụ thuộc thời điểm trận được chạy. Mốc công bố map tách khỏi mốc khóa bài: map phải có từ trước sự kiện, không đợi đến cửa sổ này. Pack đã published được tải vào bộ luyện và team bundle; draft chưa duyệt và source/log/credential vẫn private. Đề xuất đầu tuần công bố pack tuần; tháng/kỳ công bố khi mở sự kiện và trước cutoff, lịch ghi rõ thời điểm.

## 5. Giao thức bot Python

Một process mới/bot/ván, tồn tại qua setup và các nước đi; không tái sử dụng giữa ván. stdin/stdout UTF-8 JSON Lines, mỗi request một dòng và đúng một response. stderr chỉ để debug riêng của đội. Launcher do BTC giữ thực thi file `/submission/bot.py` với isolated Python, unbuffered; `python -I -u /opt/btc/launcher.py /submission/bot.py`. Launcher dùng `runpy.run_path` để chạy file đơn; không cho đội chỉ định command. `-I` là hygiene Python, không thay sandbox.

Contract envelope:

```json
{
  "protocolVersion": "bot.v1",
  "requestId": "game-123:7",
  "kind": "move",
  "game": {
    "id": "game-123",
    "rulesVersion": "ott-campus.v1",
    "mapHash": "<sha256>",
    "map": "<full MapV1 object>",
    "you": "red",
    "phase": "playing",
    "turn": "red",
    "ply": 6,
    "seed": 1731,
    "pieces": "<array of visible Piece objects>",
    "unplaced": [],
    "legalMoves": [{"pieceId":"red_rock_0","to":"b2"}]
  },
  "limits": {"responseWallMs": 1000, "cpuRemainingMs": 28000}
}
```

Ví dụ trên rút gọn map/pieces để dễ đọc; không dùng các chuỗi placeholder đó làm schema thực. Contract code phải dùng object/array thật. `Piece={id,player,type,square,alive}`, square `null` chỉ cho quân chưa đặt hoặc đã chết nếu observation có chúng; mặc định chỉ gửi quân sống đã đặt trong pieces. `unplaced` gửi quân mình cần đặt. Seed là unsigned 32-bit, SDK gọi `random.Random(seed)` một lần mỗi ván; bot có thể bỏ qua nhưng phải tự chịu tính ngẫu nhiên. Cùng đội nhận cùng seed trong 2 màu của block; các block dùng seed khác đã khóa trong manifest. Không cho đội tự chọn seed.

Setup request `kind=setup`, phase tương ứng, có đầy đủ map và danh sách 9 quân mình; Xanh còn thấy quân Đỏ. Response:

```json
{"protocolVersion":"bot.v1","requestId":"game-123:1","kind":"setup","placements":[{"pieceId":"red_rock_0","square":"a2"}]}
```

Ví dụ chỉ minh họa một entry; response hợp lệ phải có đủ 9. Move response:

```json
{"protocolVersion":"bot.v1","requestId":"game-123:7","kind":"move","pieceId":"red_rock_0","to":"b2"}
```

Không có `pass`, `resign` hoặc callback mạng. EOF kết thúc phiên. Sau ván supervisor đóng pipe và dọn sandbox, không chờ bot gửi lời chào. SDK chuẩn có hàm `setup(obs)` và `move(obs)`; boilerplate chỉ quản lý JSON I/O và seed, không giấu logic chiến thuật.

Schema từ chối unknown fields, duplicate keys, NaN/Infinity, sai requestId/kind/version, chuỗi quá dài, nested depth >16. Request tối đa 64 KiB; response một dòng tối đa 16 KiB; tổng stdout 4 MiB/ván, stderr lưu tối đa 256 KiB/ván/bot. Khi log vượt mức thì dừng với `OUTPUT_LIMIT`, không chỉ truncate mà tiếp tục cho bot spam vô hạn. Không được coi log stdout là comment. Bot phải flush; thiếu newline đến hết hạn là timeout. Response đã được chấp nhận không thể bị thay bằng dòng kế tiếp; output thừa cho cùng request là lỗi giao thức.

## 6. Sandbox và budget

Mọi code sinh viên, kể cả kiểm syntax và smoke test, đều chạy trong jail trên host Linux chuyên dụng hoặc VM Linux không chứa dữ liệu cá nhân. Không bao giờ import file sinh viên trong API/engine. Không dùng blacklist import Python làm sandbox.

Profile phải pin nsjail commit/build, rootfs Python và seccomp policy. Tách mỗi bot vào namespaces user/pid/mount/ipc/uts/network; UID/GID không đặc quyền; rootfs read-only, submission read-only, tmpfs 16 MiB; không mount home, secret, DB, code đối thủ hoặc Docker socket. Net namespace không có kết nối ngoài; syscall network và tạo process/thread phải bị từ chối theo policy đã test tương thích runtime. Cgroups v2 riêng từng bot có `memory.max=256 MiB`, swap tắt, `pids.max=16`, cpu quota tối đa tương đương 1 core; thêm rlimits file/open files/core. Seccomp allowlist tối thiểu được xây từ workload chuẩn rồi test, không chép bừa policy “Python an toàn”.

Supervisor tin cậy có quyền tạo/kill cgroup theo cấu hình host; API/đội không có quyền truyền nsjail args hoặc mount path. Không chạy nsjail với `--privileged` chỉ để vượt lỗi quyền. Host preflight kiểm namespace, cgroup delegation, memory accounting, seccomp và network isolation thật; thiếu tính năng thì từ chối chạy bài chính thức. VM phải có tài nguyên cố định và test; WSL có thể dùng phát triển nhưng không mặc nhiên được duyệt làm máy thi.

| Budget dự kiến | Giá trị và cách đo |
| --- | --- |
| Boot sandbox/runtime | 5s wall/bot, kiểm tuần tự Đỏ rồi Xanh; CPU boot tính vào tổng bot |
| Setup response | 5s wall, nằm trong tổng thời gian phản hồi bot |
| Move response | 1000ms wall mỗi request |
| CPU tổng | 30.000ms/bot/ván, lấy `cpu.stat usage_usec` của cgroup gồm toàn cây process |
| Tổng wall đang chờ response | 45.000ms/bot/ván; không tính thời gian chờ đối thủ hoặc ghi replay |
| RAM | 256 MiB tổng cgroup; xác nhận OOM bằng memory events |
| Ván | 400 plies; watchdog 120s wall gồm khởi động và cleanup có timeout riêng |
| Slot | 2 ván; mỗi ván tối đa 2 bot |

CPU quota giới hạn tốc độ sử dụng, không làm bộ đếm 30 giây. Supervisor kiểm CPU định kỳ tối đa mỗi 10ms và ở mỗi response, log overshoot; rlimit CPU là lớp dự phòng, không đủ đo toàn cây ở độ phân giải ms. Chưa đặt CPU cap riêng từng nước; một nước vẫn bị chặn bởi wall 1 giây và CPU tổng. Mỗi ván pin số core/quota giống nhau, tránh tranh CPU bằng scheduler capacity. Không dùng thời gian chạy làm tie-break.

Jail chỉ chạy khi có request đang hoạt động; supervisor freeze toàn cgroup khi xong response, resume sau khi gửi request tiếp. Freeze acknowledgment và pipe buffer phải được quản lý để output thừa không được ghép vào request sau. Kernel freezer không áp dụng cho tiến trình engine. CPU tích lũy vẫn được đo đến lúc freeze hoàn tất. Startup kết thúc bằng readiness từ launcher BTC qua kênh điều khiển riêng, không chiếm stdout JSON của bot; kênh đóng trước chạy code sinh viên. Import và khởi tạo code sinh viên tính vào thời gian request đầu, không được coi là runtime boot vô hạn. Tất cả cơ chế này phải được nghiệm thu trên host; có thể giản lược thành process-per-request ở bản A chỉ khi đổi contract và benchmark công khai trước giải, không lén thay runtime giữa mùa.

Nếu bot chủ động `sleep`, chờ I/O hoặc dừng process, watchdog wall vẫn xử lý. Nếu CPU/RAM đo không đáng tin do lỗi host, đánh dấu hạ tầng, không tự coi bot gian lận. Mọi timeout dựa monotonic clock của supervisor, không dựa timestamp do bot gửi.

Lifecycle: `prepare -> launch -> setup -> active/frozen -> terminal -> kill-cgroup -> wait/reap -> verify-empty -> remove-temp`. Dùng init/subreaper để reap zombie. `finally` cleanup khi thắng/hòa, lỗi bot, admin hủy, runner exception hoặc mất lease. Worker supervisor bên ngoài cũng có watchdog; restart phải quét cgroup/job cũ, kill theo ownership marker, không kill process không thuộc giải. Không đánh dấu slot trống khi cgroup chưa sạch.

## 7. Dữ liệu và bất biến

Nguồn bài online chính là GitHub theo [đặc tả GitHub](06-GITHUB-NOP-BOT-VA-LUU-TRU.md): repo đăng ký, resolve SHA trước cutoff, tải đúng `bot.py`, hash/cache tạm và validate trong sandbox. Bổ sung repository/sync metadata; sourceKind phân biệt github/offline_file/upload_fallback. Không chạy `git pull` mutable branch giữa ván.

SQLite local, migrations có version, foreign keys bật, WAL nếu được host hỗ trợ, busy timeout và transaction ngắn. Một API coordinator ghi. File nội dung lưu theo SHA-256 ngoài DB. Các bảng tối thiểu:

| Bảng | Trường/chức năng chính |
| --- | --- |
| users, teams, team_members | tài khoản BTC cấp, role, roster đã khóa |
| seasons, stages, events | lịch tuần/tháng/kỳ, target event cấp vé, status, rulesVersion |
| registrations | team/event, eligible, check-in, unique(team,event) |
| submissions | team,event,scope(online/reference/offline_round), hash,size,status,receivedAt |
| submission_checks | sandbox artifact, validator version, lỗi và thời điểm |
| round_freezes, freeze_entries | round/team/snapshot hoặc missing; thời điểm khóa, giám thị |
| maps, map_packs, map_pack_items | hash, draft/published, publishedAt, validation, approval, immutable versions |
| round_participants, round_view_grants | event/round/team đủ quyền; grant riêng cho BTC/judge, unique theo đối tượng/vòng |
| groups, group_entries, bracket_entries | lịch bốc thăm, seed, vị trí nhánh |
| series, game_slots | round, map, snapshots, seeds, colors, scheduled block; unique(series,gameIndex) |
| jobs, job_attempts | queue, lease token, generation, heartbeat, retries, terminal state |
| game_results | gameSlot, acceptedAttempt, result, reason, artifact hash |
| artifacts | content hash, type, visibility(owner_team/round/btc_only), roundId, ownerTeam, storage key |
| standings_snapshots | version kết quả, phương pháp tie-break, normalized fractions |
| qualification_tickets | sourceEvent, targetEvent, team, rank, status |
| decisions, audit_events | thay đổi kết quả, actor, reason, before/after hash |
| bundles, offline_imports | manifest version/hash, nguồn, import ledger, đối soát |

Không ghi đè snapshot đã khóa. Một vé active duy nhất `(targetEventId,teamId)` bằng partial unique index; quota vé theo source event kiểm trong transaction. Idempotency key cho nộp bài, khóa vòng, finalize và import. Mỗi game slot chỉ có một accepted result đang hiệu lực, không tính nhiều lần từ retry.

Online cutoff GitHub: receipt khi server resolve đúng repo/branch thành SHA trước cutoff, không dựa timestamp commit hoặc chỉ lời báo đã push. Tải đúng blob tại SHA và check async; freeze đợi mọi candidate đúng hạn kiểm xong hoặc quyết định hạ tầng. Chọn bản valid mới nhất theo thời điểm resolve; bản lỗi tải/check không xóa bản valid cũ. Upload fallback tính khi nhận đủ file≤256KiB. Không có valid ghi missing; không tự chạy mutable head thay thế. Chi tiết retry/quota/cache và riêng tư theo file 06.

Offline cutoff: giám thị ghi receipt tại máy đội, hash và đánh dấu seal trước hạn, rồi BTC import sau. Ledger seal gồm event/round/team/hash/time/giám thị; file import phải khớp ledger. Không tin mtime file/USB hoặc thời gian máy đội. Đối với chế độ strict USB, giám thị dùng đồng hồ và danh sách ký nhận chung; app BTC là nơi xác nhận bản cuối. Giải quyết tranh chấp trước chạy round.

## 8. Queue, nhận kết quả và lỗi hạ tầng

Game job state `queued -> leased -> running -> completed | bot_failed | infra_failed | canceled`. `bot_failed` là kết quả ván hợp lệ; `infra_failed` không có điểm và có thể enqueue attempt mới. Lease 30s, heartbeat 5s; expiry chỉ cho retry sau khi đảm bảo runner cũ không còn thực thi hoặc fencing từ chối mọi report cũ.

Claim dùng transaction/CAS tăng `generation`, trả token ngẫu nhiên và hạn lease. Report phải khớp job, worker, token, generation và chưa hết lease. Coordinator chỉ nhận kết quả từ runner có auth, không từ trình duyệt. Trong transaction: kiểm lease và game slot → validate result/artifact refs → gắn acceptedAttempt → tính trạng thái series. Duplicate report cùng token trả cùng receipt; stale report bị từ chối. Không tự nhận một result cũ chỉ vì nội dung trông đúng.

Artifact ghi file tạm rồi fsync/rename vào kho content-addressed trước transaction result. File mồ côi có thể GC sau, DB không được trỏ file chưa hoàn tất. Heartbeat hết hạn giữa lúc upload thì artifact vẫn lưu để điều tra nhưng không chấp nhận kết quả attempt cũ.

Mặc định retry hạ tầng tối đa 2 lần với cùng snapshot/map/seed; sau đó block event để BTC xử lý. Retry không đảm bảo bot ngẫu nhiên ngoài seed ra cùng nước; snapshot, raw transcript và attempt cũ được giữ. Chỉ replay lại transcript mới đảm bảo tái dựng bàn cờ. Không tuyên bố chạy lại code tùy ý luôn deterministic.

Không tự chuyển map khi map lỗi. Hủy round chưa hoàn tất, có decision, sửa thành pack mới và chạy lại toàn bộ phần bị ảnh hưởng theo quy định BTC. Nếu kết quả ván bị đổi sau khi đã chạy vòng kế, đánh dấu tất cả dependent series/tickets cần review; không âm thầm sửa BXH rồi để bracket sai.

Series normal aggregation theo tổng điểm ván; 2 ván phụ chỉ tạo sau hòa và giữ cùng round snapshot. Cả hai missing: double-DQ, nhánh sau bye. Một missing: walkover; không tạo transcript hoặc bot timeout giả. Vé chỉ sinh khi event finalized, khiếu nại đã giải quyết, qua transaction có audit. Event nhập lại không cấp thêm vé.

## 9. API và phân quyền

Auth online bằng tài khoản BTC tạo, password hash theo thư viện chuẩn được duy trì (ưu tiên Argon2id), cookie HttpOnly/Secure/SameSite, CSRF cho thay đổi state, rate limit login/upload. Khôi phục mật khẩu do BTC, không bắt buộc dịch vụ mail. Offline chỉ tài khoản operator cục bộ; không phụ thuộc OAuth/Internet.

| Role | Quyền |
| --- | --- |
| Team | nộp/xem bài mình, practice; chỉ xem trận/replay online của vòng có round_participant |
| Judge | xem trận/replay/log trong vòng được giao, đề nghị phân xử; không sửa code/pack |
| Operator | import file, chạy/dừng queue, kiểm tra máy, seal bài; không tự đổi điểm |
| Admin | quản lý event, maps, duyệt quyết định, xuất bundle/finalize |
| Spectator | không mở xem trận giải chính thức ẩn danh; spectator ở chế độ game chơi tay cũ giữ nguyên |

Các route mục tiêu:

```text
POST /api/session                 POST /api/logout
GET  /api/events                  GET /api/events/:id
POST /api/events/:id/submissions  GET /api/submissions/:id
POST /api/practice                GET /api/practice/:id
GET  /api/events/:id/standings    GET /api/events/:id/bracket
GET  /api/games/:id/replay        GET /api/games/:id/events?afterSeq=n
POST /api/admin/events/:id/draw   POST /api/admin/map-packs/:id/publish
POST /api/admin/rounds/:id/seal   POST /api/admin/events/:id/finalize
POST /api/admin/maps              POST /api/admin/maps/:id/validate
POST /api/admin/map-packs/:id/approve
POST /api/admin/map-packs/:id/lock
POST /api/admin/events/:id/export-offline
POST /api/admin/import-offline    POST /api/admin/decisions
POST /internal/jobs/claim         POST /internal/jobs/:id/heartbeat
POST /internal/jobs/:id/result
```

Thí sinh không được POST arbitrary action vào ván chính thức. Artifact download kiểm owner/role/round từng file, không dựa URL khó đoán. Team A không được đọc source/stderr của B, draft chưa duyệt, worker token hoặc DB. BTC có quyền xem theo nhiệm vụ; decisions đổi điểm có người đề xuất và người duyệt khác nhau. Mọi mutation admin dùng idempotency/audit.

### Xem trận online: server gửi nước đi, UI dựng bàn cờ

Mọi vòng online có player hiển thị hai bot đấu. Tách tải chấm bot khỏi tải người xem: một game execution sinh một luồng event lưu bền, nhiều client đọc chung; không chạy lại bot/engine cho từng viewer và không stream video. Khuyến nghị dùng event ngay từ MVP, full-state polling chỉ là fallback đơn giản.

`canViewGame(user,game)`: BTC/operator có scope phù hợp; judge được giao round; hoặc `game.mode=online` và team của user có bản ghi `round_participants` đúng `eventId,roundId`. Membership lấy từ đăng ký/bracket đã khóa, không nhận roundId từ client làm bằng chứng. “Vòng” là round cụ thể, không phải event/mùa/bảng riêng: đội trong vòng xem tất cả trận vòng đó. Đội bị loại giữ quyền vòng cũ, không có vòng kế; practice chỉ owner team. Game offline luôn btc_only/judge dù kết quả đã sync online.

Kiểm predicate thống nhất trên list/detail/snapshot/events/SSE/replay và artifact/file download. Không trả metadata của trận ngoài scope khi filter danh sách. Không cấp quyền xem source/log đối thủ từ quyền xem trận. Thu hồi membership phải đóng stream đang mở; reconnect/read lại kiểm quyền mới. Tránh CDN cache dùng chung, dùng private/no-store cho dữ liệu trận; không đưa bearer token lên URL; không để link replay vượt qua check round.

Luồng đề xuất:

```text
runner -> accepted board/action events -> coordinator event store
                                         |
                               kiểm quyền vòng online
                                         |
                     snapshot tại seq N + events seq > N
                                         |
                       UI render bàn cờ hai bot, read-only
```

Snapshot response gồm game/round/rules/map, state tại seq N, stateHash, attemptId và resultVersion. Events tiếp theo: `seq,attemptId,resultVersion,kind,actor,action,resultingStateHash`; `kind` gồm setup/move/terminal/reset. Sequence tăng trong một accepted/live attempt; khi retry hoặc invalidation phải phát reset và snapshot mới có attempt/resultVersion mới, không ghép event ván lỗi với ván chạy lại. Live có nhãn tạm thời đến accepted result.

Client lấy snapshot nhất quán ở seq N, sau đó đọc events từ N+1; bỏ event trùng, không bỏ event thiếu. Nếu gap/hash sai/schema lạ hoặc attempt đổi, tải snapshot thay vì suy diễn nước đi. Server cung cấp action capture/terminal đủ cho UI; server vẫn xác thực và là nguồn kết quả. UI chỉ dùng reducer hiển thị có version, không tự chấm thắng để ghi DB.

Bắt đầu polling `/events?afterSeq=N` mỗi 1–2 giây với batch giới hạn (ví dụ 100 event hoặc 64 KiB), hỗ trợ trang/catch-up, backoff lỗi, dừng polling tab ẩn rồi catch-up. Có thể nâng SSE dùng seq/resume và heartbeat; viewer chậm phải reconnect/catch-up, không giữ buffer vô hạn làm nghẽn runner. Full-state fallback dùng cùng ACL và giới hạn tốc độ; tải lại snapshot không bypass quyền. Result/replay là đường xem lại khi trận kết thúc, vẫn cùng scope vòng.

Đo throughput/băng thông với khoảng 100 client, giới hạn connection/user và không buộc tốc độ hiển thị bằng tốc độ bot. Xem trận không thay đổi budget hoặc lịch chấm. Offline không có đường stream tới máy đội: BTC dùng player localhost đọc event/replay, không cần LAN. Quota practice có queue ưu tiên thấp; pause khi giải chính thức cần slot.

## 10. Git, tiếp nhận file và an toàn nhập bài

GitHub là luồng nhận bài online chính theo yêu cầu mới; thay phạm vi MVP cũ “không nhận source URL”. Chỉ repo đã đăng ký/xác minh, SHA cố định, lấy một blob `bot.py` có giới hạn thay vì clone/execute project. Sync service riêng có credential, runner không nhận credential/network. Không hooks/submodules/LFS/custom filters/build scripts hoặc arbitrary URL fetch. Mốc nhận bài, private repo/access, quota, retry/cache/GC và API theo file 06; upload chỉ fallback và import file offline vẫn có.

Offline dùng folder có manifest thay vì archive không kiểm soát. Nếu hỗ trợ ZIP, kiểm path traversal, absolute path, symlink/hardlink, số file, tổng kích thước sau giải nén và zip bomb trước ghi. Storage key sinh bởi BTC từ hash, không dùng filename người dùng làm path hoặc ghép shell. Không auto-run bất kỳ file nào từ USB. File `.py` cũng là code không tin cậy.

## 11. Gói offline và đối soát

Tách ba loại bundle:

1. **Organizer bundle:** event/roster/bracket, engine build, runtime/rootfs, profiles, toàn bộ map đã công bố và assignment, snapshots của đội, schemas, DB export nhất quán, manifest hashes/chữ ký Ed25519. Không đưa private signing key vào gói.
2. **Team bundle:** đúng bot cũ của đội ở dạng có thể dùng/sửa, SDK/tài liệu Python/API, simulator và toàn bộ map chính/dự phòng đã công bố. Không có source đội khác hoặc dữ liệu vận hành private. Không yêu cầu template rỗng hoặc chặn copy/paste.
3. **Result bundle:** snapshot nộp tại chỗ, seal ledger, game attempts/replays, standings, decisions, tickets đề nghị, manifest và chữ ký máy offline BTC.

Khoá public của BTC và máy offline được phân phối/đối chiếu trước sự kiện. Hash xác nhận byte; chữ ký xác nhận nguồn. Import kiểm signature, version, artifact hashes, eventId, source manifest và `bundleId` đã nhập; không chạy file từ bundle trong bước verify. Kết quả offline import vào online ở trạng thái chờ duyệt/đối soát, không ghi đè toàn DB online bằng DB cũ. Xung đột cùng event/game cần operator xử lý có audit; vé chỉ finalize một lần. Xác minh code đội nào/hash nào đã được dùng bằng biên nhận hiển thị/giấy.

App và tài liệu offline phải chứa local fonts/icons/assets; tắt analytics, remote imports, SSO, license checks mạng, CDN và service discovery. Máy đội chỉ cần Python + tài liệu + simulator local, bot cũ và pack map đã công bố; API/player/replay máy BTC bind loopback, không mở LAN. BTC xem trên màn hình cục bộ, không bắt buộc máy chiếu hoặc phát cho đội. Lưu bộ chính/dự phòng, thử xem/chạy giải khi rút dây mạng.

## 12. Replay và khả năng kiểm chứng

Header: schema, event/round/series/game/attempt IDs, engine commit/build hash, rulesVersion, map object/hash, hai snapshot hashes, runtime/profile hash, seeds, colors và budget profile. Events JSONL: `seq,kind,actor,requestId,action,resultingStateHash`; thêm resource/fault evidence riêng cho vận hành. Footer gồm final state hash, winner/reason, transcript hash và supervisor metrics. Timestamp dùng để audit, không tham gia engine hash.

Lưu đầy đủ action hợp lệ, response lỗi có giới hạn, fault và quyết định hạ tầng; không chỉ chuỗi mô tả nước đi. Replay viewer dựng state từ initial + actions, xác nhận mọi hash; playback speed không làm đổi game clock/budget. Event truncation, hash sai hoặc footer thiếu phải hiện “chưa kiểm chứng”, không gắn nhãn kết quả chính thức.

Raw bot transcript private. Board/actions/replay online có scope round; offline btc_only/judge. Source chính ở GitHub; cache source giữ đến finalized + đóng khiếu nại 72 giờ, trừ bài pinned cần chạy/xuất offline/khiếu nại. Không mặc định lưu mọi lần push 90 ngày; metadata/kết quả/replay/log có thể giữ 90 ngày sau kỳ theo BTC. Backup/result bundle chứa source cũng cùng chính sách cache, xem file 06. Replay không chứa source, không public ẩn danh; sync offline không đổi visibility.

## 13. Observability, backup và recovery

Dashboard BTC: queued/running/failed, worker heartbeat, active cgroups, RAM/CPU/disk, oldest job, P50/P95 duration, bot fault theo loại, tiến độ vòng và trạng thái seal/publish map. Logs structured có event/game/attempt ID; không log token/password/source vào stdout chung. Cảnh báo disk dưới ngưỡng cấu hình hoặc cleanup chưa sạch thì pause queue.

Backup DB bằng SQLite backup API hoặc dừng ghi/checkpoint theo quy trình, không chỉ copy file `.db` đang WAL mà bỏ mất `.wal`. Export luôn gồm artifact referenced và manifest nhất quán. Sao lưu trước draw/freeze/finalize, sau mỗi vòng offline và cuối ngày online. Restore thử trên máy dự phòng; event chấp nhận mất tối đa các ván đang chạy, không mất kết quả đã chấp nhận và đã backup.

Recovery: pause queue → kill/quarantine jobs cũ → kiểm integrity/manifest → restore DB/artifacts → fence lease cũ → kiểm accepted results → enqueue lại ván hạ tầng → tiếp tục cùng snapshot/map/seed. Nếu chưa có backup ngay thời điểm mất máy, đối chiếu append-only artifact receipt/ledger để nhập lại, không đoán kết quả từ màn hình.

## 14. Kiểm thử và tiêu chí mở giải

- Engine: luật gốc; setup trái vùng/trùng/thiếu/đổi owner; tọa độ lạ; ô cản/cắt góc; base/capture/blocked; 400th move thắng ưu tiên; repetition với quân cùng loại đổi ID; không mutation đầu vào.
- Map: fixture hợp lệ/bất đối xứng/chặn base/thiếu setup/chia cắt/một cổ chai; render và validator cùng map hash; pack locked bất biến.
- Protocol: setup/move golden fixtures, partial line, no flush, duplicate JSON key, NaN, sai ID, stdout/stderr flood, EOF/crash; sample SDK chạy được trên máy đội và jail.
- Sandbox Linux thật: fork/process flood, memory allocate, sleep, CPU spin, read host file, write submission, socket/DNS, subprocess, zombie; host còn hoạt động, không process rác, không file/secret bị lộ. Chạy trong VM test không có bí mật.
- Queue: hai runner cùng claim, lease hết hạn, stale result, duplicate report/import/finalize, kill supervisor giữa ván, disk full; không tính đôi hoặc quy lỗi hạ tầng cho đội.
- Giải: count fixture 35/40/48/50, bảng lệch cỡ, tie nhiều đội, tránh tái đấu bảng, bracket/bye/double-DQ, vé trùng/chuyển/rút/thiếu ứng viên, kỳ 3 hoặc 4 tháng.
- Offline: đúng bot cũ của đội, dùng nguyên/sao chép/sửa/thay được; không đòi thư mục rỗng; có đầy đủ map trước giải; seal đúng hạn import muộn; BTC xem được, máy đội không cần player/network; restore và import hai lần an toàn.
- Viewer online: team thuộc vòng xem mọi trận cùng vòng; không xem vòng kế/chưa có vé; API list/detail/events/snapshot/SSE/replay/file đều chặn truy cập trái scope; dedup/gap/reset/catch-up đúng; thu hồi quyền đóng stream; không leak qua cache hoặc URL file. Replay offline vẫn chỉ BTC sau sync.
- Load: 50 submissions theo đợt, 264 ván qualifier, 2 slots, bot sát budget và bot mẫu; đo P95, CPU/RAM/disk và thời gian đầy đủ stage barriers. Không dùng 50 bản bot giống nhau để kết luận chất lượng thể thức, nhưng có thể dùng để kiểm tải.

Chỉ mở giải khi các mục đúng luật/sandbox/khóa bài/offline/recovery đạt, không còn placeholder/mock ở đường chấm thật; BTC đã diễn tập và có hai người biết phục hồi. Benchmark có thể buộc chọn Top 8 hoặc tăng giờ thi; công bố lựa chọn trước tuần, giữ số ván chẵn.

## Nguồn kỹ thuật đã đối chiếu

- [Repo gốc tại commit đã đọc](https://github.com/Hkoado/OOTv2-Game/tree/0a0b6b5c2992aa8973c6a052da6eff026800e897).
- [nsjail README](https://github.com/google/nsjail) và [config.proto](https://github.com/google/nsjail/blob/master/config.proto), tham chiếu cơ chế Linux isolation; pin bản khi triển khai vì nhánh master có thể thay đổi.
- [Python isolated mode và CLI](https://docs.python.org/3/using/cmdline.html), `-I` không tự chặn syscall hoặc mạng.
- [SQLite WAL](https://www.sqlite.org/wal.html), không chia DB WAL qua network filesystem.
- [Docker Engine security](https://docs.docker.com/engine/security/), giới hạn quyền daemon/mount. Thiết kế này không yêu cầu cho bot quyền Docker.
