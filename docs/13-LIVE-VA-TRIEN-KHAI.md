# 13 — Xem trực tiếp và triển khai công khai (đã triển khai)

Cập nhật 22/10/2026. Tài liệu này mô tả **phần đã chạy được trong repo**, không phải đề xuất:

- Khán giả ẩn danh xem bàn cờ trực tiếp của **mọi ván đang đấu** (L1).
- Log stdout/stderr của bot (L2) chỉ đội sở hữu bên của mình và admin đọc được.
- API Express phục vụ luôn `dist/` → **một origin duy nhất** cho web + API, phù hợp
  chạy tại nhà và mở ra Internet bằng Cloudflare Tunnel.
- DB vẫn là SQLite (`better-sqlite3`), thêm bảng mới theo kiểu additive.

## 1. Kiến trúc đang chạy

```
Trình duyệt khán giả
      │  HTTPS (Cloudflare)
      ▼
cloudflared  ──►  127.0.0.1:3001  (Express: /api + dist/ + SPA fallback)
                        │
                        ├── SQLite data/ootv2.sqlite (WAL)
                        │        ▲
                        └── server/worker.js (poll 1 s, chạy tuần tự 1 ván)
                                 │ spawn Python -I -S -B cho từng request bot
                                 ▼
                              submissions/<uuid>.py
```

- Không WebSocket, không Redis: khán giả **poll 2 giây** `/api/live/matches/:id/events`.
  Cloudflare cắt HTTP request ở 100 s nên polling an toàn hơn SSE ở giai đoạn này.
- API và worker là hai tiến trình Node độc lập, cùng mở một file SQLite (WAL +
  `busy_timeout = 5000`). Chỉ worker chạy code Python.
- `dist/index.html` được phục vụ cùng cổng API; mọi request `/api/*` luôn được xử lý
  trước static/SPA fallback.

## 2. Bảng dữ liệu mới (additive)

| Bảng | Vai trò | Quyền đọc |
| --- | --- | --- |
| `match_events` | `seq 0 = initial` (thế trận sau xếp quân), `seq 1..n = move`, cuối là `terminal`. Không chứa đường dẫn file/ghi chú. | Công khai qua `/api/live` |
| `match_bot_output` | Từng dòng stdout/stderr của bot, đã lọc ký tự điều khiển, tối đa 400 dòng/trận. | Chỉ đội sở hữu + admin |

- `seq` của `move` = số thứ tự nước (1..200) nên ghi lại cùng nước là idempotent.
- `recoverUnfinishedMatches()` khi worker khởi động trả ván `running` về `pending` và
  **xoá event của các ván pending** để ván chạy lại không trộn bàn cờ cũ.
- Worker gọi `pruneLiveHistory()` khi boot: xoá event/log của giải đã kết thúc quá 2 ngày.

## 3. API công khai `/api/live`

Rate limit 240 request/phút/IP (Map trong RAM, không cần Redis); `Cache-Control: no-store`.

| Endpoint | Trả về |
| --- | --- |
| `GET /api/live/overview` | Giải đang chạy (hoặc giải gần nhất), danh sách ván `running` kèm số nước, 8 ván vừa xong, counts, trạng thái worker (`alive` nếu heartbeat < 15 s) |
| `GET /api/live/matches/:id` | Snapshot L1: thông tin ván + `initial_pieces` + `latest_seq`; không có log/notes/đường dẫn |
| `GET /api/live/matches/:id/events?afterSeq=N` | Event mới hơn `N`; `reset: true` khi client tụt lại (ván bị chạy lại) |

Endpoint L2 (cần cookie phiên, mount dưới `/api/local`):

`GET /api/local/live/matches/:id/bot-output?after=<id>&side=red|blue`
- Đội: server tự xác định bên từ `participant_id` của phiên; đội không tham gia ván → 403.
- Admin: thấy cả hai bên, lọc được bằng `side`.
- API công khai **không có** endpoint nào trả bảng `match_bot_output`.

## 4. Cấu hình mới

| Biến | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `OOTV2_SERVE_DIST` | `1` | Express phục vụ `dist/` + SPA fallback; đặt `0` khi chỉ chạy API |
| `OOTV2_DIST_DIR` | `dist` | Thư mục build của Vite |
| `OOTV2_LIVE_BOT_OUTPUT` | `1` | Ghi log bot vào DB (L2); `0` để tắt |
| `OOTV2_WORKER_PAUSE_MS` | `0` | Nghỉ giữa hai ván (demo xem trực tiếp), mặc định chấm liên tục |
| `OOTV2_PUBLIC_ORIGIN` | trống | Origin HTTPS công khai của tunnel (allowlist same-origin) |
| `OOTV2_TRUST_PROXY` | `loopback` | Tin `X-Forwarded-*` từ cloudflared cùng máy |

`OOTV2_SERVE_DIST=1` chỉ có tác dụng khi `dist/index.html` tồn tại; nếu chưa build,

## 5. Chạy demo xem trực tiếp trên máy

```powershell
npm install
npm run build                                  # tạo dist/ (web dùng chung origin API)
node tools/cli/create-admin.js                 # nếu chưa có admin

# Terminal 1 — API + web tĩnh
npm start                                      # http://127.0.0.1:3001

# Terminal 2 — worker, nghỉ 8 s giữa hai ván để xem kịp
$env:OOTV2_WORKER_PAUSE_MS=8000
npm run start:worker

# Terminal 3 — tạo giải demo 8 đội, bot ngủ ~1,1 s mỗi nước
npm run demo:live
```

Mở:
- Khán giả: `http://127.0.0.1:3001/#/live` (không cần đăng nhập; trang tự chọn ván đang chạy).
- Vào thẳng một ván: `http://127.0.0.1:3001/#/live/<matchId>`.
- Cổng giải đấu (đăng nhập): `http://127.0.0.1:3001/#/overview`.

`npm run demo:live` từ chối tạo giải mới khi đang có giải chạy (worker chạy tuần tự);
dùng `--force` nếu thật sự muốn tạo song song. Dữ liệu demo nằm trong `data/ootv2.sqlite`
(private, đã gitignore) — xoá file này là reset sạch.

## 6. Mở ra Internet bằng Cloudflare Tunnel (miễn phí)

Điều kiện: máy chạy 24/7 (tắt sleep), đã cài Node 22+, Python 3.12+, `cloudflared`.
Chỉ bot của thành viên tin cậy mới được nộp — xem mục 8.

1. **Cấu hình `.env`** (copy từ `.env.example`):

```dotenv
OOTV2_DB_DRIVER=sqlite
OOTV2_API_HOST=127.0.0.1
OOTV2_API_PORT=3001
OOTV2_DATA_DIR=./data
OOTV2_SERVE_DIST=1
OOTV2_LIVE_BOT_OUTPUT=1
OOTV2_PUBLIC_ORIGIN=https://live.example.com   # domain/subdomain của bạn
OOTV2_TRUST_PROXY=loopback
OOTV2_ADMIN_KEY=<chuỗi ngẫu nhiên dài>
```

2. **Build + chạy API/worker** (2 tiến trình; không cần `vite` trong production):

```powershell
npm run build
Start-Process node -ArgumentList 'server/index.js'
$env:OOTV2_WORKER_PAUSE_MS=0; Start-Process node -ArgumentList 'server/worker.js'
```

Kiểm tra nội bộ: `curl http://127.0.0.1:3001/api/health` và mở `http://127.0.0.1:3001/#/live`.

3. **Tunnel** (một trong hai cách):

```powershell
# Cách nhanh — URL đổi mỗi lần chạy (phù hợp thử nghiệm trong ngày)
cloudflared tunnel --url http://127.0.0.1:3001

# Cách cố định — cần domain trên Cloudflare
cloudflared tunnel login
cloudflared tunnel create ootv2
cloudflared tunnel route dns ootv2 live.example.com
cloudflared tunnel run --url http://127.0.0.1:3001 ootv2
```

4. **Cloudflare dashboard**: bật *Always Use HTTPS*; tắt *Bot Fight Mode* / *Under Attack
   Mode* cho `/api/*` nếu có (challenge HTML sẽ làm poller nhận 403/HTML thay vì JSON).

Vì web và API cùng origin, `fetch('/api/...')` và cookie `Path=/api/local` hoạt động
bình thường sau tunnel; không cần CORS, không cần mở port router.

## 7. Vận hành trên Windows

- Chạy API + worker như Windows Service (NSSM hoặc Task Scheduler với
  *Restart on failure*), không để cửa sổ terminal bị đóng.
- Tắt sleep/hibernate; đặt chính sách khởi động lại máy sau mất điện.
- Sao lưu định kỳ `data/` (SQLite + `submissions/`). `data/` **không** được phục vụ qua web.
- Log: `data/live-api.log`, `data/live-worker.log` khi chạy theo hướng dẫn ở mục 6.
- `npm run build` lại mỗi khi đổi UI; API chỉ cần restart khi đổi code server.

## 8. Giới hạn bảo mật còn lại (quan trọng)

- **Chưa có sandbox cấp OS.** `spawn` + timeout + giới hạn output **không phải** sandbox.
  Chỉ nhận bot của thành viên tin cậy trên máy/VM riêng; API vẫn bind loopback và chỉ
  cloudflared (cùng máy) mới vào được.
- Nếu cần mở `/api/local` cho người ngoài, đặt **Cloudflare Access** (miễn phí) trước
  path đó; không mở form đăng nhập công khai khi chưa có sandbox.
- `/api/live` là công khai có rate limit 240 request/phút/IP. Poller hợp lệ dùng 2 s/lần.
- Log bot (L2) có thể chứa thông tin nội bộ của đội; không đưa bảng này vào API công khai.

## 9. Chẩn đoán "trang trắng" (`#/live` hoặc `/`)

`vite build` chỉ kiểm tra cú pháp, **không chạy** bundle: một dòng code đặt sai vị trí
(ví dụ `const x = ...` nằm ngoài component, ở phạm vi module) sẽ gây `ReferenceError`
khi nạp module → React không mount → `#root` rỗng, trang trắng dù API vẫn trả 200.

1. `npm run smoke:ui` — mở app đã build bằng Chrome/Edge headless, đọc DOM và báo lỗi nếu
   `#root` rỗng. Thêm `--expect live-page --expect live-board` để kiểm tra đúng trang live:
   `npm run smoke:ui -- --expect live-page`.
2. Trong trình duyệt: `Ctrl+F5`. `index.html` là `no-store`, asset có hash nên không sợ cache cũ.
3. DevTools Console: `Uncaught ReferenceError` hoặc `Failed to load module script` chính là
   dấu hiệu này; sửa code → `npm run build` → chạy lại smoke.
4. Nếu HTML tải được mà asset 404: kiểm tra `dist/` đúng bản mới và API đã restart sau khi
   sửa `server/` (API đọc `dist/` từ đĩa mỗi request, nhưng code server chỉ đổi sau restart).

## 10. Kiểm thử đã chạy

| Lệnh | Kết quả |
| --- | --- |
| `npm run build` | Pass (Vite 6) |
| `npm test` | 93/93 pass, gồm 11 test mới cho live/static |
| `node --test tests/liveEvents.test.js` | Event seq, snapshot whitelist, log L2, prune, recovery |
| `node --test tests/liveApi.test.js` | API công khai không lộ log; L2 chỉ đội sở hữu + admin |
| `node --test tests/liveView.test.js` | Hash `#/live`, gộp event, nhãn trạng thái, rate limiter |
| `node --test tests/staticServing.test.js` | `dist/` + SPA fallback, `/api` không bị nuốt, không lộ `data/` |
| `npm run smoke:ui` | App build render thật trong Chrome/Edge headless (`#root` có nội dung, có `live-page`) |

## 11. Việc chưa làm (milestone tiếp theo)

- SSE/WebSocket + heartbeat cho cập nhật tức thời (polling 2 s là đủ cho MVP hiện tại).
- Trang L2 trong portal đội/admin: endpoint đã có (`/api/local/live/matches/:id/bot-output`)
  nhưng UI hiển thị log bot chưa được thêm; hiện chỉ xem qua API/công cụ nội bộ.
- Nén/giới hạn thêm bảng `match_events` khi giải rất dài; xoá theo retention ngoài 2 ngày.

API log nhắc chạy `npm run build`.
