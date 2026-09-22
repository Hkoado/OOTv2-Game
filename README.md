# Oẳn Tù Tì v2 (OTTv2) - Online Multiplayer Strategy Match

Trò chơi cờ chiến thuật **Oẳn Tù Tì v2 (OTTv2)** trên bàn cờ **9x9** dành cho 2 người chơi thi đấu trực tuyến thời gian thực qua phòng, kèm chế độ **Người xem (Spectator)**. Dự án được tối ưu để push lên GitHub và deploy trực tiếp lên Vercel.

# Link web game: https://ootv2-3b3kl09i1-hkoados-projects.vercel.app/

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
