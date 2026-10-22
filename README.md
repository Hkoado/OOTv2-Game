# OOTv2 · Cổng giải đấu bot

## Chơi thử và chuẩn bị giải

- Trang đăng nhập có **Chơi offline**: hai người cùng máy, không tài khoản/API, ba map mẫu.
- Admin tạo giải bằng tên, thêm đội/map sau. Mỗi giải có snapshot riêng tại `data/events/<id>/`.
- SQLite là nguồn chính; thư mục snapshot chưa phải bundle backup. Worker MVP chỉ chạy map không ô cản.
- [Bàn giao và chia việc tiếp theo](docs/10-BAN-GIAO-OFFLINE-VA-THU-MUC-GIAI.md).

Ứng dụng hiện **tournament-first**: mở `http://127.0.0.1:3000/` **luôn** vào màn hình đăng nhập.
Đăng nhập bằng tài khoản BTC cấp; không có tab phòng chơi/spectator trên giao diện chính.

```powershell
node tools/cli/create-admin.js   # tạo admin đầu tiên (nếu chưa có)
npm run build
node tools/cli/start-local.js    # API :3001 + worker + web :3000
```

- Thông tin admin local nằm trong `data/local-admin-credentials.txt` (không commit/chia sẻ).
- Đội: **Tổng quan**, **Đội của tôi**, **Bot & bài nộp**, **Giải đấu**, **Luật & hướng dẫn**.
- Admin: **Tổng quan**, **Đội & tài khoản**, **Bài nộp**, **Quản lý giải**, **Luật & vận hành**.
- UI phòng chơi tay, spectator và Tournament MVP cũ được giữ nguyên trong `src/LegacyApp.jsx`
  nhưng **không được mount**; không còn mở bằng query string.
- Cổng giải đấu: `src/App.jsx` → `src/tournament/portal/CampusPortal.jsx` → `LocalCore.jsx`.
  Theme/token lấy từ `docs/ui-style/tokens.json`; CSS tại `src/tournament/portal/tournament.css`.
- Polling 4 giây, không chồng request, tự dừng khi tab ẩn; ReplayBoard được tải theo nhu cầu.
- Chỉ dùng bot nội bộ tin cậy trên máy thử nghiệm; chưa có sandbox, Supabase hoặc GitHub sync.
- Core dùng profile MVP 8 đội/30 ván, không phải Campus production. API legacy không auth tắt mặc định.

Hướng dẫn vận hành chi tiết: [localhost và phân công 4 người](docs/09-LOCAL-CORE-VA-BAN-GIAO-4-NGUOI.md).
Tài liệu Campus: [mục lục](docs/README.md), [trạng thái triển khai](docs/07-TRANG-THAI-TRIEN-KHAI.md).

> Các mục 1–… bên dưới mô tả luật chơi và giao diện phòng/spectator gốc. Chúng vẫn đúng về luật
> và còn mã nguồn trong `LegacyApp.jsx`, nhưng không phải màn hình khởi động hiện tại.

---

# Oẳn Tù Tì v2 (OTTv2) - Online Multiplayer Strategy Match

Tài liệu Campus mới: [mục lục giải đấu/UI](docs/README.md),
[trạng thái triển khai](docs/07-TRANG-THAI-TRIEN-KHAI.md).
Hiện có nền tảng engine `ott-campus.v1` và CLI kiểm map/replay; API/worker/UI giải đấu bên dưới
vẫn là MVP 8 bot. Dùng `npm run test:engine` để kiểm cả luật legacy và Campus;
`npm run map:validate -- examples/maps/campus-arena.json` để kiểm map mẫu.

Trò chơi cờ chiến thuật **Oẳn Tù Tì v2 (OTTv2)** trên bàn cờ **9x9** dành cho 2 người chơi thi đấu trực tuyến thời gian thực qua phòng, kèm chế độ **Người xem (Spectator)**. Dự án được tối ưu để push lên GitHub và deploy trực tiếp lên Vercel.
---

## 1. Giới thiệu & Điểm nổi bật

- **Công nghệ Realtime:** Sử dụng thư viện **playhtml** (`playhtml.fun`) với hạ tầng PartyKit và CRDT state sync, cho phép chơi nhiều người cùng lúc mà không cần tự dựng server Node.js backend cồng kềnh.
- **Hệ thống Phòng chơi & Người xem (Spectator):**
  - Người chơi có thể tạo phòng mới hoặc vào phòng bằng mã.
  - Mỗi phòng hỗ trợ đúng 2 người chơi: **Đội Đỏ (P1)** và **Đội Xanh (P2)**.
  - Khi phòng đã đủ 2 người, tất cả người vào sau sẽ tự động trở thành **Người xem (Spectator)** theo dõi trận đấu theo thời gian thực để tránh xung đột nước đi.
- **Thiết kế tối giản, theme sáng:**
  - Tông màu trắng chủ đạo kết hợp màu xanh lá cây thanh lịch, hiện đại.
  - Quân cờ biểu tượng Đấm ✊ / Lá ✋ / Kéo ✌️ rõ ràng, sắc nét với viền Đỏ và Xanh dương.
  - Trải nghiệm phẳng, sạch sẽ, không nhấp nháy, không hiệu ứng neon lóa mắt.

---

## 2. Luật chơi chi tiết (Bám sát quy chuẩn)

### 2.1 Bàn cờ & Phân vùng
- **Kích thước bàn cờ:** 9x9 (81 ô). Tọa độ cột `a` đến `i`, hàng `1` đến `9`.
- **Sân nhà Đội Đỏ:** Gồm đúng **28 ô** quanh Nhà chính `a1` (thỏa mãn `col + row <= 8`).
- **Sân nhà Đội Xanh:** Gồm đúng **28 ô** quanh Nhà chính `i9` (thỏa mãn `col + row >= 12`).
- **Ranh giới giữa sân:** Là 3 đường chéo ở giữa bàn cờ gồm đúng **25 ô** (thỏa mãn `col + row ∈ {9, 10, 11}`). *Không được phép đặt quân vào ranh giới trong giai đoạn xếp quân.*

### 2.2 Quân cờ & Giai đoạn Xếp quân (30 giây)
- Mỗi đội có đúng **9 quân cờ**:
  - **3 quân Đấm (Búa ✊)**
  - **3 quân Lá (Bao ✋)**
  - **3 quân Kéo (✌️)**
- **Thời gian xếp quân:** 30 giây cho mỗi đội.
  - **Đội Đỏ** được đi trước và phải xếp quân trước trong 28 ô sân nhà của mình.
  - **Đội Xanh** xếp quân sau. Đặc biệt: **Đội Xanh ĐƯỢC NHÌN THẤY toàn bộ vị trí và loại quân Đội Đỏ đã xếp** trên bàn cờ để dàn thế trận đối phó.
  - Hết 30 giây nếu chưa xếp xong, hệ thống tự động đặt ngẫu nhiên số quân còn lại vào các ô trống hợp lệ trong sân nhà.

### 2.3 Quy tắc Di chuyển & Ăn quân
- **Di chuyển:** Mỗi quân cờ được di chuyển tối đa **1 ô theo 8 hướng** (như quân Vua trong cờ vua).
- **Luật ăn quân Oẳn Tù Tì:**
  - **Đấm (Búa ✊)** thắng **Kéo (✌️)**
  - **Kéo (✌️)** thắng **Lá (Bao ✋)**
  - **Lá (Bao ✋)** thắng **Đấm (Búa ✊)**
- **Hai quân cùng loại:** Không thể ăn nhau mà chỉ đứng **chặn đường nhau** (không thể đi vào ô của nhau).
- **Chặn nước đi tự sát:** Hệ thống ngăn chặn hoàn toàn nước đi vào ô có quân địch mạnh hơn mình (quân cờ chỉ có thể đi vào ô trống hoặc ô có quân địch yếu hơn để ăn quân).

### 2.4 Điều kiện Chiến thắng
Người chơi giành chiến thắng ngay lập tức khi thỏa mãn **1 trong 2** điều kiện sau:
1. **Đột kích Nhà chính:** Đội Đỏ đưa 1 quân bất kỳ đến được ô **`i9`** (Nhà chính Đội Xanh), HOẶC Đội Xanh đưa 1 quân bất kỳ đến được ô **`a1`** (Nhà chính Đội Đỏ).
2. **Tiêu diệt sạch 1 loại quân:** Ăn hết sạch hoàn toàn cả 3 quân của cùng một loại của đối phương (ví dụ ăn sạch 3 Kéo, hoặc 3 Búa, hoặc 3 Bao của địch).

---

## 3. Cấu trúc Dự án

```text
OTTv2-group5/
├── index.html              # HTML entrypoint chuẩn SEO & Google Fonts
├── package.json            # Dependencies: React 19, playhtml, lucide-react, vite
├── vite.config.js          # Cấu hình Vite dev server và build
├── vercel.json             # Cấu hình Vercel rewrite SPA routing
├── .gitignore              # Bỏ qua node_modules và dist
├── src/
│   ├── main.jsx            # Mount React
│   ├── App.jsx             # Điều phối Sảnh chờ, Phòng chơi, Modals
│   ├── index.css           # Design system, theme sáng, màu xanh lá chủ đạo
│   ├── game/
│   │   ├── constants.js    # Bàn cờ 9x9, 28 ô sân nhà, 25 ô ranh giới, rules mapping
│   │   ├── rules.js        # Logic nước đi 8 hướng, ăn quân, chặn tự sát, check thắng
│   │   └── gameState.js    # State machine: Waiting, Setup Red/Blue, Playing, Finished
│   ├── components/
│   │   ├── Header.jsx      # Thanh điều hướng, copy mã phòng, nút luật chơi
│   │   ├── Lobby.jsx       # Sảnh chờ, tạo phòng mới, vào bằng mã, xem phòng
│   │   ├── Board.jsx       # Bàn cờ 9x9 hiển thị tương tác nước đi, ranh giới, nhà chính
│   │   ├── Square.jsx      # Ô cờ, phân màu 3 khu vực sân, gợi ý nước đi
│   │   ├── Piece.jsx       # Quân cờ tròn tối giản ✊ ✋ ✌️
│   │   ├── SetupPanel.jsx  # Bảng xếp 9 quân trong 30s có đồng hồ đếm ngược
│   │   ├── PlayerCard.jsx  # Thông tin người chơi, lượt đi, bộ đếm quân còn sống
│   │   ├── MoveHistory.jsx # Biên bản nước đi và lịch sử ăn quân
│   │   ├── GameOverModal.jsx # Thông báo kết quả và lý do chiến thắng
│   │   └── RulesModal.jsx  # Bảng quy chuẩn luật chơi chi tiết
│   └── sync/
│       └── usePlayRoom.js  # Realtime sync qua playhtml + BroadcastChannel fallback
```

---

## 4. Hướng dẫn chạy thử nghiệm tại Local

1. Mở terminal tại thư mục dự án và chạy:
   ```bash
   npm install
   ```

2. Khởi động môi trường phát triển:
   ```bash
   npm run dev
   ```

3. Mở trình duyệt tại địa chỉ `http://localhost:3000` (hoặc cổng hiển thị trên terminal).
   - **Mẹo thử nghiệm 2 người chơi:** Bạn có thể mở 2 cửa sổ/tab trình duyệt (hoặc 1 tab thường và 1 tab ẩn danh Incognito), nhập cùng một mã phòng (ví dụ `OTT-1234`) để đóng vai Đội Đỏ và Đội Xanh thi đấu với nhau theo thời gian thực! Mở tab thứ 3 để trải nghiệm chế độ Người xem (Spectator).

---

## 5. Hướng dẫn Push lên GitHub

```bash
git init
git add .
git commit -m "feat: complete OTTv2 online multiplayer strategy game with playhtml"
git branch -M main
git remote add origin <URL_GITHUB_REPO_CUA_BAN>
git push -u origin main
```

---

## 6. Hướng dẫn Deploy lên Vercel

Dự án đã được tích hợp sẵn file `vercel.json` chuẩn cấu hình SPA. Bạn có thể deploy rất dễ dàng:

### Cách 1: Qua giao diện Vercel Dashboard (Khuyên dùng)
1. Đăng nhập vào [Vercel](https://vercel.com).
2. Nhấn nút **"Add New..."** → chọn **"Project"**.
3. Import GitHub repository bạn vừa push.
4. Framework Preset sẽ tự động nhận diện là **Vite**.
5. Nhấn **"Deploy"**. Trong vòng 1 phút, trang web OTTv2 của bạn sẽ chính thức online toàn cầu!

### Cách 2: Qua Vercel CLI
```bash
npx vercel
```
Làm theo hướng dẫn trên terminal để hoàn tất deploy.

---

## 7. Giải đấu bot (MVP — M0→M5)

Song song với chế độ chơi tay 2 người ở trên, repo có thêm **chế độ Giải đấu bot**: người chơi nộp **một file Python `.py`**, judge (Node) chạy bot trong tiến trình con riêng, mỗi trận đấu do server xử lý và có **replay read-only**.

> ⚠️ **Chỉ chạy local, với code của người mình tin tưởng.** Tiến trình con **không phải sandbox an toàn** cho người lạ. API chỉ bind `127.0.0.1`; không public API/worker này lên Internet. Triển khai công khai là **OUT OF SCOPE** cho tới khi có cô lập cấp hệ điều hành đã kiểm thử.

### 7.1 Chuẩn bị

- **Node.js 22+** (đã dùng cho Vite/React).
- **Python 3.12+** có trên `PATH` (`python --version`). Bot chỉ được dùng **thư viện chuẩn**; không nhận ZIP/package/`pip install`.

### 7.2 Chạy 3 tiến trình dev (3 terminal)

```bash
# Terminal 1 — API (Express + SQLite), mặc định http://127.0.0.1:3001
npm run dev:api

# Terminal 2 — Judge worker: chạy tuần tự từng game, poll SQLite
npm run dev:worker

# Terminal 3 — UI (Vite)
npm run dev
```

Vite dev proxy `/api` → `127.0.0.1:3001` (xem `vite.config.js`), nên UI không cần cấu hình CORS.

Mở UI, bấm tab **“Giải đấu bot”** (hoặc thêm `?view=tournament` vào URL).

### 7.3 Thao tác demo end-to-end

1. Tab **Đội & Bot** → tạo **8 đội**, mỗi đội upload **một file `.py`** (dùng `examples/sample_bot.py` để thử). Cột trạng thái phải hiện “Đủ điều kiện thi đấu”.
2. Nhập **Khóa admin local** (`x-admin-key`) và **API base** (để trống nếu dùng Vite proxy) trong khối “Cấu hình local”.
3. Tab **Giải đấu** → chọn đúng **8 đội**, đặt tên giải → **Tạo giải (draft)** → **Start**.
   - Chia bảng theo seed: **A = 1,4,5,8 · B = 2,3,6,7**; vòng bảng 24 game (mỗi cặp 2 lượt đổi màu) + bán kết 4 game (2 cặp × 2 lượt) + chung kết 2 game = **30 game**.
4. Worker ở Terminal 2 tự nhặt game `pending` và chạy lần lượt. UI tự làm mới mỗi **3 giây**.
5. Trang chi tiết giải hiển thị **bracket bán kết → chung kết**, **bảng xếp hạng A/B**, **danh sách 30 game**; game đã xong có nút **Replay** (board 9x9 read-only, tua từng nước / tự chạy).

### 7.4 Lệnh hữu ích

```bash
npm run worker:once    # chạy đúng 1 game rồi thoát (tiện debug)
npm run worker:drain   # chạy tới khi hết game pending
npm run test:server    # node --test tests/*.test.js (rule, protocol, worker, standings, knockout)
npm run build          # kiểm tra UI build được (Vite)
```

### 7.5 Biến môi trường (tuỳ chọn)

Server tự nạp file `.env` ở thư mục gốc nếu có (`process.loadEnvFile`, không cần dependency). Toàn bộ biến đều có default an toàn:

| Biến (`server/config.js`) | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `OOTV2_API_HOST` | `127.0.0.1` | Host API — **chỉ loopback** cho tới khi có sandbox cấp OS. |
| `OOTV2_API_PORT` | `3001` | Cổng API. |
| `OOTV2_ADMIN_KEY` | `local-dev-admin-key` | Giá trị hợp lệ của header `x-admin-key` cho route tạo/start giải. |
| `OOTV2_DATA_DIR` | `<repo>/data` | Thư mục dữ liệu private (SQLite + bot upload), nằm ngoài `public/`, `src/`, `dist/`. |
| `OOTV2_DB_PATH` | `<data>/ootv2.sqlite` | Đường dẫn file SQLite. |
| `OOTV2_PYTHON_BIN` | (trống) | Lệnh Python; để trống thì tự dò `python` / `py -3` / `python3`. |

Giới hạn cứng (trong `config.limits`, đổi bằng code): file bot ≤ **64 KiB**, input/output mỗi luồng ≤ **64/16 KiB**, timeout setup **3 s** và move **2 s**, tối đa **200 plies**, worker poll mỗi **1 s**.

### 7.6 Bản đồ mã nguồn phần giải đấu

```text
server/
├── index.js            # Khởi động API (bind 127.0.0.1)
├── app.js              # Express app, mount routes, middleware lỗi
├── db.js               # SQLite (better-sqlite3) + schema/migration
├── config.js           # Đọc env + giới hạn (không dùng dependency)
├── routes/             # participants, tournaments, matches, health, sample-bot
├── services/           # nghiệp vụ: participants/tournaments/matches/submissions
├── middleware/         # upload (multer), admin key, xử lý lỗi
├── judge/              # gameAdapter (dùng lại engine src/game), matchRunner, pythonRunner
└── worker.js           # worker poll match pending → chạy bot → ghi kết quả/replay
src/tournament/         # UI giải đấu (api.js, labels.js, replay.js, *View.jsx, ReplayBoard.jsx, tournament.css)
tests/                  # node --test: gameAdapter, pythonRunner, tournamentFlow, workerE2E, api
examples/sample_bot.py  # bot mẫu đúng giao thức
docs/                   # 01..05: scope, protocol, API/DB/UI, checklist, prompt triển khai
data/                   # (tạo khi chạy) SQLite + bot đã upload — không commit
```


## UI Kit tích hợp (22/10/2026)

Component bàn cờ, atlas và font offline nằm trong src/ui/ott-v2-ui-kit/.
Đọc [bàn giao UI kit](docs/11-TICH-HOP-UI-KIT.md) về adapter, kiểm thử và giới hạn QA.
Dự án không phụ thuộc thư mục UI Kit ngoài repository.
