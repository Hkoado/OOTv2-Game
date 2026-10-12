# 01 — Đặc tả MVP và kiến trúc

## 1. Bối cảnh đã khảo sát

Repo gốc: <https://github.com/Hkoado/OOTv2-Game>, nhánh mặc định hiển thị khi khảo sát: `Ex2` (12/10/2026). Dự án hiện có React/Vite, realtime rooms qua playhtml, và game engine JavaScript trong:

- `src/game/constants.js`: cấu hình bàn 9×9, phe Đỏ/Xanh, 3 loại quân, sân nhà và căn cứ.
- `src/game/rules.js`: `getValidMoves(pieces, pieceId)`, `getPieceAtSquare()`, `checkWinCondition()`.
- `src/game/gameState.js`: `GAME_PHASES`, `createUnplacedPieces`, `autoPlaceRemaining`, `createNewGame`, `completeSetupRed`, `completeSetupBlue`, `executeMove`.
- `src/App.jsx`, `src/components/*`: giao diện game.
- `src/sync/usePlayRoom.js`: chế độ phòng người chơi/người xem. **Không thay bằng tournament worker.**

**Đầu việc M0:** agent phải kiểm tra nhánh đang mở và exports thực tế trong VS Code; các đường dẫn trên là cơ sở tham khảo, không cho phép sửa mù.

## 2. Mục tiêu demo (luồng hoàn chỉnh)

1. Người chơi nhập tên đội và upload một file `.py` qua giao diện Tournament (chế độ local/classroom trusted-only).
2. Backend kiểm tra định dạng, lưu bot, tạo một submission, cho chạy kiểm thử với protocol mẫu.
3. Admin tạo giải **đúng 8 bot**, chốt phiên bản bot khi bắt đầu giải.
4. Chia 2 bảng A/B, mỗi bảng 4 đội; đấu vòng tròn **2 lượt đổi bên**.
5. Tính bảng xếp hạng bảng, lấy 2 đội đầu mỗi bảng vào bán kết (A1–B2, B1–A2).
6. Mỗi cặp knockout đấu 2 lượt đổi bên; có quy tắc giải hòa rõ ràng; tạo chung kết.
7. Hiển thị trạng thái, kết quả, bảng điểm, nhánh knockout, xem lại trận bằng bàn cờ hiện có.

## 3. Trong phạm vi / ngoài phạm vi

**Phải có:** upload bot Python, validation, bot mẫu, Python subprocess runner, engine/judge authoritative, queue SQLite, 1 worker, seed và replay, vòng bảng, knockout, bảng điểm, UI cơ bản, test.

**Không làm ở MVP:** Docker/container; sandbox an toàn cho code công khai; login/OAuth; đa ngôn ngữ bot; cài dependencies Python; cùng lúc nhiều giải đang chạy; ELO toàn hệ thống; rank thời gian thực theo mùa; Redis/queue phân tán; multi-worker; match livestream real-time; code editor online; bot đấu trực tiếp với người chơi; đa game engine; deploy worker trên Vercel.

## 4. Kiến trúc tối giản

```text
[React/Vite hiện tại]
   ├── Người chơi / Room / Spectator (giữ nguyên playhtml)
   └── Tournament: upload, standings, bracket, replay
                    |
                HTTP /api
                    |
             [Express API :3001]
                 |      |
           [SQLite DB] [Private uploads dir]
                 |
       [1 Node.js Judge Worker]
                 |
      [OOTv2 game rules/state trong JS]
                 |
      [Python bot A/B subprocess, JSONL]
```

- Không để frontend quyết định thắng/thua tournament.
- API lưu submission, giải, cặp đấu, kết quả; worker độc lập lấy match `pending` từ SQLite.
- Match chạy **tuần tự** để đơn giản; API vẫn phản hồi khi worker xử lý.
- Frontend poll API mỗi 2–3 giây ở trang giải đấu, không chạm playhtml room.
- SQLite và thư mục uploads tồn tại khi reload server; không lưu DB nhị phân vào Git.

## 5. Cấu trúc dự kiến (không bắt buộc giống 100%)

```text
OOTv2-Game/
├── AGENTS.md                         # file trong bộ tài liệu này
├── docs/01_...md ... 05_...md
├── examples/sample_bot.py
├── src/                              # giữ nguyên + UI Tournament
├── server/
│   ├── index.js                      # Express entry
│   ├── db.js                         # schema + SQLite helpers
│   ├── routes/                       # upload / tournaments / matches
│   ├── services/                     # scheduling / standings
│   └── judge/
│       ├── gameAdapter.js            # import các hàm src/game/*
│       ├── botRunner.js              # Python process per request
│       ├── matchRunner.js            # vòng đời một trận
│       └── worker.js                 # poll / claim / finalize
├── data/                              # gitignored: sqlite, submissions
├── tests/
├── .env.example                      # agent tạo, không đưa secret thực
└── package.json                      # bổ sung scripts/deps, không xóa scripts cũ
```

`gameAdapter.js` là chỗ thực hiện chuyển state từ game hiện tại sang request bot, validate setup, xử lý giới hạn turn và lấy replay; không fork rules thành phiên bản độc lập.

## 6. Luật cờ không được tự sửa

- 9×9; vị trí `a1` (Đỏ) và `i9` (Xanh); 3 rock, 3 paper, 3 scissors mỗi đội.
- Red setup trong 28 ô sân nhà Đỏ, Blue setup sau trong 28 ô sân nhà Xanh; Blue **biết** các quân Đỏ đã đặt.
- Đỏ đi đầu. Mỗi quân đi tối đa 1 ô, 8 hướng. Chỉ bắt được quân yếu hơn theo chu trình rock > scissors > paper > rock.
- `checkWinCondition()` xử lý 2 thắng lợi: chiếm căn cứ hoặc ăn hết một loại quân đối thủ.
- Phụ lục luật cho tournament (không thay game bình thường): `MAX_PLIES=200` nước đi **của cả 2 bên cộng lại** thì hòa; bên không còn legal move khi đến lượt sẽ thua; nước sai/timeout ở lượt `move` bị xử thua. Thời gian bot request nhỏ hơn 30 giây xếp quân UI; chỉ dùng cho judge bot.
- Mọi dữ liệu ngẫu nhiên ảnh hưởng trận phải dùng PRNG có seed lưu trong DB. `autoPlaceRemaining` hiện dùng `Math.random`: thêm tham số RNG hoặc adapter seeded mà không phá default room behavior.
- **Quan trọng**: `completeSetupRed/Blue` hiện tự auto-fill quân chưa xếp; judge kiểm tra đủ quân/trùng ô/thuộc vùng trước khi gọi, để tránh input gian lận. Mỗi request bot phải có đúng 9 placements hợp lệ.

## 7. Mô hình vòng đấu được chốt

- Một giải đang hoạt động, 8 entries (mỗi đội 1 bot snapshot cố định).
- Chia bảng theo `seed_order` cố định khi admin start: A nhận 1,3,5,7; B nhận 2,4,6,8 (hoặc phương án snake seed tương đương được code + test), đảm bảo tái lập.
- Mỗi bảng 4 đội đấu cặp 2 lượt Đỏ/Xanh: **12 game/bảng, 24 game tổng vòng bảng**.
- Điểm: thắng 3, hòa 1, thua 0. Xếp theo điểm > số thắng > hiệu số game thắng-thua > `seed_order` (ổn định). Không dùng head-to-head trong MVP để giảm complexity; phải công bố tiêu chí trên UI.
- Top 2 mỗi bảng vào bán kết A1–B2 và B1–A2. Hai lượt đổi màu mỗi cặp. Hai đội có nhiều game thắng hơn qua hai lượt đi tiếp.
- Nếu hòa sau 2 game knockout: ưu tiên đội có `seed_order` thấp hơn (được xếp cao hơn lúc vào giải). **Đây là luật tie-break đơn giản chỉ cho MVP**, hiển thị ở trang giải để người chơi biết. Trận chung kết cũng áp dụng.
- Tạo bracket bán kết và chung kết **chỉ sau khi giai đoạn trước hoàn tất**.
- Tổng bình thường: 24 vòng bảng + 4 bán kết + 2 chung kết = **30 game**.

## 8. Các quyết định triển khai

- Dùng REST + DB polling thay vì WebSocket; tránh trùng hạ tầng realtime với playhtml.
- Node.js ESM để import luật game hiện tại.
- SQLite thay PostgreSQL cho triển khai nhóm nhỏ. Bắt đầu với `better-sqlite3` và verify Node version / prebuild trên máy đang chạy.
- Admin start giải bằng header `x-admin-key`, cấu hình qua env. Không cần hệ thống account trong MVP.
- Chỉ phục vụ `127.0.0.1` trong mode `local-dev`; truy cập từ máy khác hay Internet chưa được phép ở MVP do rủi ro thực thi bot.
