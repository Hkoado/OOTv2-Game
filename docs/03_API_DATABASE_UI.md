# 03 — Data model, REST API và giao diện MVP

> T?i li?u l?ch s? cho profile MVP. Khi m? r?ng Campus, ?u ti?n [docs m?i](README.md)
> v? [tr?ng th?i tri?n khai](07-TRANG-THAI-TRIEN-KHAI.md); gi? version ?? ??c k?t qu?/replay c?.

## 1. Mô hình dữ liệu SQLite tối thiểu

> Dùng SQL migration khởi tạo qua `server/db.js` hoặc 1 file `schema.sql`. Không cần ORM hay dịch vụ DB ngoài cho MVP.

### `participants`
- `id` TEXT PRIMARY KEY (UUID)
- `name` TEXT UNIQUE NOT NULL (1–40 ký tự sau trim)
- `created_at` TEXT NOT NULL

### `submissions`
- `id` TEXT PRIMARY KEY
- `participant_id` TEXT NOT NULL FK
- `storage_path` TEXT NOT NULL (server generated; không expose ra client)
- `sha256` TEXT NOT NULL
- `status` TEXT NOT NULL (`uploaded` | `valid` | `invalid`)
- `validation_error` TEXT NULL
- `created_at` TEXT NOT NULL

### `tournaments`
- `id` TEXT PRIMARY KEY
- `name` TEXT NOT NULL
- `status` TEXT NOT NULL (`draft` | `group_running` | `semifinal_running` | `final_running` | `finished`)
- `seed` INTEGER NOT NULL
- `created_at`, `started_at`, `finished_at` TEXT NULL

### `tournament_entries`
- `id` TEXT PRIMARY KEY
- `tournament_id` TEXT NOT NULL FK
- `participant_id` TEXT NOT NULL FK
- `submission_id` TEXT NULL FK khi draft; bắt buộc có giá trị sau khi start (phiên bản bot **đóng băng** khi giải bắt đầu)
- `seed_order` INTEGER NOT NULL (1..8)
- `group_name` TEXT (`A` | `B`)
- UNIQUE(`tournament_id`, `participant_id`)

### `matches`
- `id` TEXT PRIMARY KEY
- `tournament_id` TEXT NOT NULL FK
- `stage` TEXT NOT NULL (`group` | `semifinal` | `final`)
- `series_id` TEXT NOT NULL (cặp đấu 2 lượt)
- `game_no` INTEGER NOT NULL (1 hoặc 2)
- `red_entry_id` TEXT NOT NULL FK
- `blue_entry_id` TEXT NOT NULL FK
- `seed` INTEGER NOT NULL
- `status` TEXT NOT NULL (`pending` | `running` | `finished`)
- `result` TEXT NULL (`red_win` | `blue_win` | `draw`)
- `reason` TEXT NULL (`base_capture`, `type_eliminated`, `move_limit`, `forfeit_setup`, `forfeit_move`, `no_legal_move`)
- `ply_count` INTEGER NULL
- `replay_json` TEXT NULL (JSON `{protocol_version, seed, initial_pieces, events, result}`)
- `started_at`, `finished_at` TEXT NULL

Không bắt buộc có `standings` table: **tính aggregate từ các match `finished` trong vòng bảng** để tránh đồng bộ phức tạp. `series_id` dùng để gộp 2 game vòng loại trực tiếp, bracket từ aggregate series. Tạo indexes trên match (`status`, `tournament_id`, `stage`, `series_id`).

## 2. API endpoints

Tất cả JSON response có status code đúng và lỗi dạng `{ "error": "machine_code", "message": "..." }`. Chỉ chạy local loopback (xem doc 02).

| Method | Endpoint | Mục đích |
|---|---|---|
| `POST` | `/api/participants` | Tạo đội `{name}`; tên phải duy nhất |
| `GET` | `/api/participants` | Danh sách đội để chọn vào giải |
| `POST` | `/api/participants/:id/submissions` | Multipart upload trường `file`; validate `.py`, size; test protocol/trạng thái valid |
| `GET` | `/api/participants/:id/submissions` | Danh sách submissions và validation status (không trả source hoặc path riêng) |
| `POST` | `/api/tournaments` | Admin tạo giải `{name, participantIds: [8 IDs]}` từ submissions valid mới nhất; `x-admin-key` |
| `POST` | `/api/tournaments/:id/start` | Admin start giải; chốt 8 submissions; tạo 24 trận bảng; `x-admin-key` |
| `GET` | `/api/tournaments` | Liệt kê các giải |
| `GET` | `/api/tournaments/:id` | Thông tin giải và trạng thái |
| `GET` | `/api/tournaments/:id/standings` | Bảng A/B (xếp hạng + P/W/D/L/pts) |
| `GET` | `/api/tournaments/:id/bracket` | Danh sách semifinal/final series + winner |
| `GET` | `/api/tournaments/:id/matches` | Danh sách game + status/score, có lọc stage |
| `GET` | `/api/matches/:id` | Chi tiết game (không code bot) |
| `GET` | `/api/matches/:id/replay` | JSON initial board + events đã sanitize (chỉ có khi finished) |

API admin chỉ để demo nội bộ. `ADMIN_KEY` từ `.env`, so sánh phía server, không nhúng vào Vite public env. UI có thể nhập admin key trực tiếp khi thao tác admin ở localhost, **không lưu localStorage**, hoặc dùng curl. Không lập hệ thống auth/users lúc này.

### Ví dụ response standings

```json
{
  "tournament_id": "t-001",
  "groups": {
    "A": [
      {"participant_id":"p-001", "name":"Bot Alpha", "played":6, "wins":4, "draws":1, "losses":1, "points":13, "seed_order":1}
    ],
    "B": []
  },
  "tie_breakers": ["points", "wins", "win_loss_difference", "seed_order"]
}
```

Vì 4 bot/bảng và đấu 2 lượt mỗi cặp, mỗi đội có **6 trận vòng bảng**; 6 trận/đội là kỳ vọng khi bảng hoàn tất. Ví dụ trên chỉ rút gọn arrays.

## 3. Lập lịch và xử lý bracket

1. Khi giải `draft` được start, kiểm tra có đúng 8 participants, mỗi đội có valid submission; trong transaction chốt snapshot `submission_id` cho mỗi entry.
2. Chia nhóm A/B theo seed xác định, tạo 2 game/cặp trong nhóm với Đỏ/Xanh đảo chiều, `status=pending`.
3. Worker poll và claim game `pending`; chỉ chạy khi tournament thuộc stage tương ứng.
4. Khi tất cả 24 game bảng `finished`, tính standings, tạo 2 semifinal series (`A1 vs B2`; `B1 vs A2`) gồm 2 game đổi màu, chuyển `semifinal_running` trong transaction; có khóa chống sinh trùng.
5. Khi 4 game semifinal `finished`, xác định 2 đội thắng series theo số game thắng; hòa thì đội seed_order tốt hơn đi tiếp; tạo final 2 lượt.
6. Khi 2 game final `finished`, chọn vô địch theo quy tắc tương tự, set tournament `finished`.
7. Update status + result + replay trong transaction; việc worker chạy lại không được sinh trận trùng / cộng điểm trùng.

Để đơn giản chỉ hỗ trợ **1 worker và 1 giải đang chạy**. Khi worker boot sau crash, khôi phục các match `running` chưa có result về `pending` trên máy dev; mỗi game được tính lại từ đúng seed/copy submission cũ.

## 4. Trang UI cần có

**A. Lobby**: giữ y nguyên UI chơi người thật hiện tại, thêm một nút/tab "Giải đấu bot".

**B. Tournament Upload**:
- Form tên đội, input `.py` tối đa 64 KiB, button upload.
- Link xem `examples/sample_bot.py` (có thể hiển thị phần hướng dẫn protocol ngắn).
- Dòng báo file hợp lệ/không hợp lệ và lỗi gọn gàng.
- Danh sách participant/submission.

**C. Tournament Dashboard**:
- Danh sách giải, trạng thái `draft / group / semifinal / final / finished`.
- Hai bảng standings với columns: hạng, đội, số trận, thắng, hòa, thua, điểm.
- List match: hai bot, màu Red/Blue, trạng thái, kết quả, nút xem replay khi kết thúc.
- Bracket bán kết và chung kết dạng thẻ hoặc bảng (không cần thư viện bracket/chart).

**D. Replay**:
- Tái sử dụng `Board`/`Piece` sẵn có nếu props tương thích; nếu không, thêm wrapper hiển thị read-only, không cho click đi quân.
- Điều khiển Prev / Next / Start / End; hiển thị ply và nước đi.
- Không cần live replay; chỉ lấy sau trận `finished`.

**E. Admin (local only)**:
- Tạo giải chọn 8 bot đã valid, nhấn Start.
- Không triển khai admin accounts, role matrix; khóa thông qua `x-admin-key` phía server.

## 5. Vite và local ports

- Frontend mặc định vẫn chạy `npm run dev` (cổng từ Vite config hiện tại).
- API chạy `127.0.0.1:3001` (ví dụ `npm run dev:api`).
- Thêm Vite proxy `/api -> http://127.0.0.1:3001` để client gọi URL tương đối và tránh CORS phức tạp.
- Worker `npm run dev:worker` chạy ở terminal riêng.
- Add `data/`, `.env`, log vào `.gitignore`; tránh overwrite cấu hình Vite/Playroom cũ.

## 6. Validation cần có

- Name trim 1–40 chars, reject duplicates case-insensitive nếu khả thi.
- File field `.py` + max 64 KiB + filename do backend tự sinh. MIME chỉ là tín hiệu phụ, không đáng tin.
- Validation `.py` syntactic check bằng Python stdlib (không cài package) và một request test `setup`/`move` trên local trusted demo. Một test synthetic không bảo đảm bot chơi đúng mọi trận; match runner vẫn validate mỗi lượt.
- Chỉ cho start khi cả 8 đội có `status=valid`, không có giải nào ở trạng thái đang chạy.
- Không lộ storage path, admin key hay stderr raw qua public response.
- Không render chuỗi không tin cậy thành raw HTML trong React; encode/sanitize response data.
