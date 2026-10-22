# IMPLEMENTATION_NOTES — Giải đấu bot OOTv2 (MVP M0→M5)

> Ghi chú này mô tả profile MVP lịch sử. Hướng phát triển Campus và phần đã làm mới nằm ở
> [docs/README.md](docs/README.md) và [trạng thái triển khai](docs/07-TRANG-THAI-TRIEN-KHAI.md).

> Tài liệu này ghi lại **thiết kế đã triển khai thực tế** trong repo (không phải đề xuất):
> backend Node/Express + SQLite, judge worker chạy bot Python, UI React trong `src/tournament/`,
> kiểm thử bằng `node --test`. Đọc kèm `docs/01..05` và `README.md` mục 7.

## 1. Mục tiêu & phạm vi

- Cho phép tổ chức một **giải đấu 8 bot** end-to-end: upload bot `.py` → tạo giải → start →
  worker chạy **30 game** (24 vòng bảng + 4 bán kết + 2 chung kết) → bảng xếp hạng, bracket, replay.
- **Không** thay thế UI/game engine hiện tại; chế độ chơi tay 2 người + spectator vẫn nguyên vẹn.
- Chỉ chạy **local-dev, người tin tưởng**: API bind `127.0.0.1`, bot là file `.py` duy nhất,
  không Docker/K8s/Redis/ORM. Triển khai công khai **out of scope** (chưa có sandbox cấp OS).

## 2. Kiến trúc & luồng dữ liệu

Ba tiến trình dev độc lập:

```
npm run dev:api     (terminal 1)  Express + better-sqlite3   http://127.0.0.1:3001
npm run dev:worker  (terminal 2)  poll SQLite → chạy bot → ghi kết quả + replay
npm run dev         (terminal 3)  Vite React, proxy /api → 127.0.0.1:3001
```

Luồng một trận:

1. `POST /api/tournaments/:id/start` sinh **series + 30 match `pending`** (bảng A/B, 2 lượt đổi màu).
2. Worker nhặt match `pending` → claim thành `running` trong transaction → dựng state từ
   `src/game/gameState.js` qua `server/judge/gameAdapter.js`.
3. Setup: gửi request `setup` cho bot Đỏ, rồi bot Xanh (Xanh **thấy** vị trí 9 quân Đỏ).
4. Vòng lặp nước đi: gọi bot → `applyValidatedMove()` (đối chiếu `legal_moves` do chính engine sinh) →
   `executeMove()`. Engine là **nguồn xác thực cuối cùng**; bot không thể tự báo thắng.
5. Ghi `matches.result/reason/ply_count/replay_json`, rồi `advanceTournament()` chuyển vòng
   (`group_running → semifinal_running → final_running → finished`) — idempotent, guard chống sinh trùng.
6. Frontend polling 3 s lấy danh sách/chi tiết/standings/bracket/matches; replay đọc từ
   `replay_json` (`initial_pieces` + `events`).

## 3. Cơ sở dữ liệu (SQLite — `server/db.js`)

- `participants(id, name UNIQUE, name_key UNIQUE, created_at)` — `name_key` chặn trùng tên
  không phân biệt hoa/thường.
- `submissions(id, participant_id, storage_path, sha256, status ∈ uploaded|valid|invalid,
  validation_error, created_at)` — `storage_path` **không bao giờ** trả ra API.
- `tournaments(id, name, status ∈ draft|group_running|semifinal_running|final_running|finished,
  seed, created_at, started_at, finished_at)`.
- `tournament_entries(id, tournament_id, participant_id, submission_id, seed_order, group_name ∈ A|B)`
  với unique `(tournament_id, participant_id)` và `(tournament_id, seed_order)` — snapshot bot
  tại thời điểm tạo giải.
- `matches(id, tournament_id, stage ∈ group|semifinal|final, series_id, game_no ∈ 1|2,
  red_entry_id, blue_entry_id, seed, status ∈ pending|running|finished, result ∈ red_win|blue_win|draw,
  reason, ply_count, replay_json, started_at, finished_at)`, unique `(tournament_id, stage, series_id, game_no)`.
- PRAGMA `journal_mode = WAL`, `foreign_keys = ON`. DB nằm trong `data/` (private, gitignore).
- `recoverUnfinishedMatches()`: match `running` không có `result` được đưa về `pending` khi worker
  khởi động lại → chạy lại bằng **đúng seed + submission snapshot cũ**, không đúp điểm.

## 4. API (đều có prefix `/api`)

| Method + path | Cần `x-admin-key` | Ghi chú |
| --- | --- | --- |
| `GET /api/health` | – | `{ok:true, service:'ootv2-tournament-api'}` |
| `GET /api/sample-bot` | – | trả `text/plain` nội dung `examples/sample_bot.py` |
| `GET /api/participants` | – | kèm `latest_submission`, `latest_valid_submission_id` |
| `POST /api/participants` | – | `{name}` → 201 |
| `GET /api/participants/:id/submissions` | – | lịch sử submission (đã lọc `storage_path`) |
| `POST /api/participants/:id/submissions` | – | multipart field `file`, `.py` ≤ 64 KiB |
| `GET /api/tournaments` | – | kèm `match_total`, `match_finished` |
| `POST /api/tournaments` | ✅ | `{name, participantIds[8]}` → 201, chia bảng A/B |
| `GET /api/tournaments/:id` | – | kèm `entries[]`, `match_counts.{total,finished}` |
| `POST /api/tournaments/:id/start` | ✅ | sinh lịch vòng bảng + knockout |
| `GET /api/tournaments/:id/standings` | – | `{groups:{A,B}, tie_breakers, group_stage_complete, matches}` |
| `GET /api/tournaments/:id/bracket` | – | `{semifinals[], final, champion}` |
| `GET /api/tournaments/:id/matches` | – | query `stage` (tuỳ chọn) |
| `GET /api/matches/:id` | – | chi tiết trận (không có source bot) |
| `GET /api/matches/:id/replay` | – | chỉ khi `finished`; 404 `replay_not_ready` nếu chưa xong |

Lỗi luôn có dạng `{error, message}` (ví dụ `missing_name`, `bad_json`, `body_too_large`,
`endpoint_not_found`, `tournament_not_found`, `replay_not_ready`); UI hiển thị gọn `message` + `[code]`.

## 5. Judge, giao thức bot & giới hạn an toàn

- Bot = **tiến trình con riêng cho từng request** (`server/judge/pythonRunner.js`), spawn không
  `shell: true`, không `eval`/`exec`/`vm`, không `import` code bot vào API/worker.
- Mỗi request: ghi JSON **một dòng** vào stdin, đọc **một dòng JSON** từ stdout; in rác/nhiều dòng →
  `bad_json`; exit code ≠ 0 → `nonzero_exit`; treo → timeout (kill).
- Giới hạn (`server/config.js` → `limits`): file bot ≤ 64 KiB; input ≤ 64 KiB; stdout/stderr mỗi luồng
  ≤ 16 KiB; timeout setup 3 s, move 2 s; tối đa 200 plies; worker poll 1 s.
- Đường dẫn file bot do server tự đặt tên (`newId()`), không dùng tên file người dùng; có kiểm tra
  chống path traversal/symlink và chỉ nhận `.py`.
- Hết 200 plies hoặc hết nước hợp lệ → kết quả do giải quyết định (`move_limit`/`no_legal_move`);
  bot lỗi → xử thua (`forfeit_setup`/`forfeit_move`); lỗi nội bộ → `internal_error` (hòa) và worker
  **không được chết**.
- Seed (`matches.seed`, sinh từ PRNG có seed ở server) được lưu cùng replay để mọi fallback
  tái lập được — không dùng `Math.random()`/`Date.now()` cho quyết định kết quả.
- Kết quả runner trả về: `{result, reason, winner, ply_count, replay, notes}`; replay gồm
  `{protocol_version, match_id, seed, initial_pieces, events, result, reason}` và có cờ
  `replay_consistent` khi trận kết thúc theo luật engine.

## 6. Lịch đấu, xếp hạng, knockout

- 8 đội chia **A = seed 1,4,5,8** và **B = seed 2,3,6,7**; mỗi bảng 6 cặp × 2 lượt = 12 game → 24 game.
- Điểm: thắng **3**, hòa **1**, thua **0**. Tie-breakers theo thứ tự
  `points → wins → win_loss_difference → seed_order` (hằng `TIE_BREAKERS` trong service).
- Bán kết: **A1–B2** và **B1–A2** (2 lượt đổi màu) → 4 game. Hòa series (1–1) thì **đội seed nhỏ hơn đi tiếp**.
- Chung kết 2 lượt → 2 game; đội thắng series là **champion**. Tổng **30 game**.
- `advanceTournament()` chỉ tiến **một bước** mỗi lần gọi, nằm trong transaction → worker poll nhiều
  lần vẫn không sinh trận trùng.

## 7. UI M5 (`src/tournament/`)

- `api.js` — fetch client: mặc định URL tương đối `/api` qua Vite proxy; ghi đè bằng
  `VITE_API_BASE` hoặc `localStorage.ottv2_api_base`; khóa admin lưu `localStorage.ottv2_admin_key`
  và gửi qua header `x-admin-key`; lỗi chuẩn hoá `{error, message, code, status}`.
- `TournamentApp.jsx` — **chủ sở hữu state**: tab (Đội & Bot / Giải đấu), polling **3 s** cho danh
  sách và cho giải đang mở, tạm dừng polling khi đang có thao tác ghi, banner trạng thái API,
  vùng thông báo/lỗi dùng chung, và các handler create/upload/start/open-replay.
- `ParticipantsView.jsx` — tạo đội, upload `.py`, hiển thị submission mới nhất + lỗi validate,
  cấu hình khóa admin/API base, link bot mẫu.
- `TournamentsView.jsx` — tạo giải (chọn đúng **8 đội có bot hợp lệ**), danh sách giải + tiến độ
  `match_finished/match_total`, nút Start cho giải `draft`, mở chi tiết.
- `TournamentDetailView.jsx` — banner vô địch, khối replay, bracket **bán kết/chung kết** (2 lượt,
  đội thắng series được tô nổi), 2 bảng xếp hạng A/B (2 đội đầu được tô), danh sách 30 game + nút Replay.
- `ReplayBoard.jsx` + `replay.js` — dựng lại ván đấu read-only bằng **chính** `executeMove` của
  engine (`initial_pieces` + `events`); board 9x9 dùng lại `Square`/`Piece` sẵn có nhưng **không**
  truyền `onClick`; điều khiển Đầu/Trước/Tự chạy/Sau/Cuối/slider, hiển thị nước hiện tại và quân đã
  mất theo phe. Nếu replay lỗi dựng lại, hoặc trận kết thúc do quyết định của giải (không có events)
  thì hiển thị ghi chú rõ thay vì board trống khó hiểu.
- `labels.js` — nhãn tiếng Việt cho trạng thái giải/trận, kết quả, lý do, vòng đấu, submission.
- CSS: `src/tournament/tournament.css` (dùng lại token màu/typography của `src/index.css`), bao gồm
  `.app-nav`/`.app-tab` cho thanh chuyển chế độ trong `App.jsx`.
- `App.jsx` chỉ thêm: import `TournamentApp`, state `activeView` (đọc `?view=tournament`), thanh tab
  “Chơi với người | Giải đấu bot” khi **ngoài phòng**, và URL sync giữ nguyên `?room=...` như cũ.
  Trong phòng vẫn render `RoomView` y hệt, không sửa hành vi chơi tay/spectator.

## 8. Kiểm thử

`npm run test:server` (alias `npm test`) chạy `node --test tests/*.test.js`:

| File | Nội dung |
| --- | --- |
| `tests/api.test.js` | participants CRUD, chặn trùng tên, upload hợp lệ (không lộ `storage_path`), upload sai đuôi/thiếu file/quá lớn/lỗi cú pháp, route giải cần `x-admin-key` |
| `tests/botRunner.test.js` | dò Python 3, chạy bot thật: `bad_json`, nhiều dòng stdout, exit code, timeout + kill, output limit, path traversal/symlink, `parseSingleLineJson` |
| `tests/gameAdapter.test.js` | state M1: setup Đỏ/Xanh, luật ăn quân, legal moves, `base_capture`, `type_eliminated`, replay tái lập, PRNG có seed, `MAX_PLIES` |
| `tests/tournamentFlow.test.js` | API M3/M4: tạo → start → vòng bảng → knockout → vô địch, standings 3/1/0, bán kết/chung kết không sinh trùng, match detail/replay, chặn tạo/start khi thiếu 8 đội |
| `tests/workerE2E.test.js` | worker chạy thật với fixture bot: 30 game, 6 game vòng bảng mỗi đội, bot phạm luật 0 điểm, `--once` lấy match pending kế tiếp, recovery match `running` |

Fixture bot nằm ở `tests/fixtures/` (`bot_hang.py`, `bot_flood.py`, `bot_illegal_move.py`,
`bot_bad_setup.py`, …) và helper môi trường tạm ở `tests/helpers/testEnv.js`.
Ngoài ra `npm run build` phải pass để xác nhận Vite bundle được toàn bộ `src/tournament/*`.

## 9. Bảo mật & giới hạn đã biết

- **Không có sandbox cấp hệ điều hành**: tiến trình con chỉ là tách tiến trình; code Python chạy
  bằng quyền user hiện tại. Vì vậy chỉ nhận bot của người tin cậy, chạy trên máy thử nghiệm/VM riêng,
  và API chỉ bind `127.0.0.1`.
- Không có xác thực người dùng thật: thao tác tạo/start giải dùng `x-admin-key` tĩnh (giá trị demo).
- Không có WebSocket: mọi cập nhật realtime dùng polling 3 s (đúng chủ trương MVP).
- SQLite single-file, một tiến trình API + một worker tuần tự; chưa hỗ trợ nhiều worker song song.
- Không phân tích AST nội dung bot; chỉ kiểm tra đuôi file, kích thước và cú pháp Python cơ bản khi
  validate (bot vẫn có thể chứa code tùy ý → đây chính là lý do bắt buộc mô hình tin cậy).
- `data/` chứa source bot của người tham gia → phải gitignore, không public, không commit.
- Replay chỉ hiển thị dữ liệu engine (`initial_pieces`/`events`), không trả source bot, hash hay
  `storage_path`.

## 10. Việc chưa làm / hướng tiếp theo

- Cô lập cấp hệ thống (container/VM, user riêng, seccomp, mount read-only) **trước khi** mở cho người
  lạ; khi đó mới cân nhắc public API/worker.
- Giới hạn tài nguyên chi tiết hơn (CPU/RAM/disk quota) và rate-limit cho upload/create/start.
- Nhiều worker song song + hàng đợi công bằng giữa nhiều giải (hiện chạy 1 trận/lần).
- WebSocket/SSE thay polling 3 s nếu cần độ trễ thấp hơn.
- Xác thực người dùng thật, phân quyền BTC giải, audit log khi sửa kết quả.
- Export replay ra file để chia sẻ và thống kê đối đầu giữa các bot (win-rate, heatmap nước đi).
- Bổ sung test tự động cho UI (`src/tournament/`) — hiện kiểm thử ở tầng API, judge, worker.
