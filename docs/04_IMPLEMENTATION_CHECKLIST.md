# 04 — Roadmap cho coding agent (triển khai TỪNG MILESTONE)

> Không làm toàn bộ kế hoạch trong một prompt. Sau mỗi milestone: chạy test, nêu file thay đổi, chờ yêu cầu tiếp.

## M0 — Khảo sát repo & baseline (không viết tính năng)

- [ ] `git status`, xác nhận branch đang mở, Node/Python version.
- [ ] Xem `package.json`, `vite.config.js`, `src/game/{constants,rules,gameState}.js`, `src/App.jsx`, `src/components/Board.jsx`, `src/sync/usePlayRoom.js`.
- [ ] Liệt kê chính xác API/export của rule/state, các hàm có mutation, random, Date.now.
- [ ] Chạy `npm install` (nếu cần), `npm run build`; kiểm tra mode phòng chơi ban đầu.
- [ ] Đề xuất file sẽ thêm/sửa theo docs, phát hiện va chạm code hiện tại.

**Done:** Có một báo cáo hiện trạng, build baseline, các khác biệt cần xử lý. Không thay đổi game logic/UX.

## M1 — Server game adapter + tests

- [ ] Thêm `server/judge/gameAdapter.js`, import chung `src/game/*`.
- [ ] Tạo state tournament độc lập với playhtml `seats`/`participants` nhưng vẫn gọi engine hiện có.
- [ ] Hàm `buildSetupRequest`, `validatePlacements`, `applySetup`, `listAllLegalMoves`, `buildMoveRequest`, `applyValidatedMove`.
- [ ] Đảm bảo `setup red -> setup blue -> playing`, Blue thấy Red setup; Red đi trước.
- [ ] Seeded PRNG cho các quyết định judge cần random; không làm hỏng `autoPlaceRemaining` hiện tại.
- [ ] Tests: setup 9 quân, trùng ô, sai sân, move 8 hướng, rock/scissors/paper, own-piece blocking, chiếm base, diệt quân.

**Done:** Node test có thể dựng trận và apply nước đi bằng luật thật của OOTv2 (chưa cần bot upload/UI).

## M2 — Python bot protocol + BotRunner (trusted local ONLY)

- [ ] Tạo `server/judge/botRunner.js` với `spawn` không qua shell, 1 request JSONL.
- [ ] Thêm giới hạn timeout, stdout/stderr, file, cleanup (xem doc 02).
- [ ] Thêm `examples/sample_bot.py`; chạy được `setup red`, `setup blue`, `move`.
- [ ] Tests: sample bot, process exit lỗi, stdout xấu, timeout vô hạn, move sai.
- [ ] README nêu rõ bot chỉ trusted/local; các hạn chế của subprocess.

**Done:** Node gọi bot Python hợp lệ trên máy local, nhận JSON chuẩn, không treo worker khi bot lỗi. **Không tuyên bố đã sandbox an toàn.**

## M3 — SQLite + Express API upload

- [ ] Cài deps tối thiểu: `express`, `multer`, `better-sqlite3` (hoặc báo blocker tương thích và đề xuất 1 lựa chọn SQLite gọn).
- [ ] Thêm `server/db.js` + schema, `server/index.js`, upload route.
- [ ] Thêm scripts `dev:api`, `dev:worker`, `test:server` giữ `dev`, `build`, `preview` cũ.
- [ ] Tạo directories private `data/`, `.gitignore`, `.env.example`; chỉ bind `127.0.0.1`.
- [ ] Validate participant, path, extension/size, source file, protocol smoke test. Reject invalid.
- [ ] Thêm routes participants/submissions + tournaments draft/start và GET.
- [ ] Tests HTTP upload đúng/sai, không tràn path, admin check, db persistence.

**Done:** API local nhận bot sample và lưu submissions/participant trong SQLite, tạo được tournament draft/start từ 8 bot.

## M4 — Tournament scheduler + match worker + standings

- [ ] Match table + polling claim tuần tự; worker chạy **1 game tại một thời điểm**.
- [ ] Mỗi match: validate two setups, Red/Blue move, judge authoritative, giới hạn 200 plies, forfeit/draw/win, seed, save replay.
- [ ] Worker restart: recover unfinished `running` theo seed cũ; không double-count.
- [ ] Schedule 2 nhóm × 4 bots; 2 lượt mỗi cặp, 24 game.
- [ ] Standings 3/1/0, tie-break points > wins > game difference > seed_order.
- [ ] Semi A1–B2 / B1–A2, 2 lượt/cặp; final 2 lượt. Series tie = seed_order nhỏ hơn.
- [ ] Khi hoàn tất toàn bộ, champion + status `finished`; no duplicate scheduling.
- [ ] E2E với 8 sample bots biến thể; tổng 30 game, standings đúng, worker không crash với invalid bot.

**Done:** Từ `start tournament` tự chạy hết giải ở terminal và xem JSON kết quả trong API (chưa cần UI đẹp).

## M5 — React UI + replay + regression

- [ ] Thêm tab/link `Giải đấu bot` ở `src/App.jsx` ít xâm lấn nhất.
- [ ] Trang participant/upload/test; 8 đội, admin create/start local.
- [ ] Trang standings, match list, bracket semifinal/final; polling 2–3 s.
- [ ] Replay read-only từ `initial_pieces/events`, next/prev và chỉ dùng board UI sẵn có khi phù hợp.
- [ ] README: chuẩn bị Python + Node, 3 terminal lệnh chạy, create/upload 8 bots, start, xem replay; ghi rõ bot mode trusted-only.
- [ ] Chạy `npm run build`, `npm run test:server`, manual smoke test room player/spectator và Tournament.

**Done:** Người dùng trên **máy local** upload 8 bot Python, giải tự chạy, nhìn thấy bảng điểm/bracket và xem replay mà chức năng chơi người thật vẫn chạy.

## Kiểm thử E2E bắt buộc (tích hợp khi M4/M5)

| ID | Tình huống | Kỳ vọng |
|---|---|---|
| T1 | Tạo 8 participants và upload `.py` hợp lệ | 8 submissions `valid` |
| T2 | Upload `.zip` hoặc `.py` >64 KiB | HTTP 4xx rõ lý do |
| T3 | Tạo giải chỉ 7 bots | từ chối start |
| T4 | Game setup Đỏ trước, Xanh thấy Đỏ | input protocol đúng |
| T5 | Bot nước đi trái luật | bot đó thua, game kết thúc |
| T6 | Bot timeout/bad stdout | thua có `reason`, worker sống tiếp |
| T7 | Kết thúc vòng bảng | mỗi đội 6 game, 24 games tổng |
| T8 | Tính điểm 3/1/0 | standings đúng, stable tie breaker |
| T9 | Bán kết rồi chung kết | bracket 4 + 2 games |
| T10 | Worker restart giữa trận | không duplicate match/points |
| T11 | Replay từng nước | board khớp winner/result đã lưu |
| T12 | Phòng chơi người thật | không regress lobby / room / spectator |

## Definition of Done cho toàn MVP

- [ ] M0–M5 hoàn tất, build/test pass hoặc ghi blocker xác thực.
- [ ] Một giải 8 đội chạy hết **30 game**; replay từ kết quả đã lưu.
- [ ] Không có Docker, không có đa worker, không tạo repo mới.
- [ ] Tất cả code user chạy qua 1 runner interface, chỉ local/trusted demo, không expose API public.
- [ ] Hướng dẫn demo từ terminal sạch + ví dụ bot có thể hoạt động theo tài liệu.
- [ ] Nếu không thể làm trong phạm vi, tạo `docs/OPEN_QUESTIONS.md` ghi giả định thay vì tự mở rộng.
