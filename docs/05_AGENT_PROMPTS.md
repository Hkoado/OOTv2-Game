# 05 — Prompt dùng trực tiếp với DeepSeek agent trong VS Code

> T?i li?u l?ch s? cho profile MVP. Khi m? r?ng Campus, ?u ti?n [docs m?i](README.md)
> v? [tr?ng th?i tri?n khai](07-TRANG-THAI-TRIEN-KHAI.md); gi? version ?? ??c k?t qu?/replay c?.

## Hướng dẫn sử dụng

1. Giải nén bộ tài liệu vào **thư mục gốc của repo OOTv2-Game** (cùng cấp `package.json`).
2. Chuyển VS Code sang workspace repo gốc, bảo đảm AI agent có quyền đọc `AGENTS.md` và thư mục `docs/`.
3. Dùng prompt **START** bên dưới để agent khảo sát M0; không bảo agent làm cả 5 milestone trong một lần.
4. Sau khi xem kết quả M0, dùng prompt M1, rồi M2, ... từng bước.
5. Luôn review diff, chạy tests trước khi chấp nhận thay đổi.

## START — Gửi đầu tiên

```text
Bạn là senior full-stack/network programming engineer. Hãy tiếp tục phát triển
repo OOTv2-Game ĐANG MỞ trong VS Code thành nền tảng giải đấu bot Oẳn Tù Tì
phiên bản MVP.

Đọc AGENTS.md và docs/01_MVP_SCOPE_ARCHITECTURE.md đến
04_IMPLEMENTATION_CHECKLIST.md; đây là source of truth.

QUAN TRỌNG:
- Không tạo repo/project mới, không viết lại game engine/React UI.
- Không Docker/container, không microservices, không mở rộng tính năng.
- Server dùng Node.js/Express/SQLite, worker một process riêng, bot Python
  chạy bằng subprocess/JSON Lines CHỈ trên môi trường demo local trusted.
- Subprocess KHÔNG phải sandbox an toàn: cấm mở API upload công khai.
- Tái sử dụng src/game/{constants,rules,gameState}.js.
- Giữ nguyên phòng chơi multiplayer và spectator hiện tại.

TRONG LẦN NÀY: CHỈ LÀM M0.
1. Kiểm tra git status/branch và đọc source thực tế.
2. Liệt kê exports, trạng thái, random, side effects và những chỗ cần adapter.
3. Kiểm tra npm run build hiện tại.
4. Báo cáo kế hoạch file thay đổi cho M1–M5 và mọi điểm khác tài liệu.
5. KHÔNG viết code mới/chỉnh code trong M0.
Trả lời bằng tiếng Việt, kèm lệnh đã chạy/kết quả rồi DỪNG.
```

## PROMPT M1 — Engine

```text
Tiến hành DUY NHẤT milestone M1 của docs/04_IMPLEMENTATION_CHECKLIST.md.
Dùng các hàm gốc trong src/game/*, xây gameAdapter.js cho tournament và
unit tests. Không đụng UI/room. Không dựng API/database/worker trong bước này.
Tôn trọng luật/setup Red trước Blue, 9 quân mỗi đội và seeded randomness.
Sau khi hoàn tất: chạy test, liệt kê file sửa và DỪNG.
```

## PROMPT M2 — Protocol và BotRunner

```text
Tiến hành DUY NHẤT M2 theo docs/02_BOT_WORKER_PROTOCOL.md và roadmap.
Dùng Python process mới cho từng request setup/move, stdin/stdout 1 JSON line,
timeout/output cap/cleanup. Không shell:true. Viết sample bot và test lỗi.
Chỉ dùng bot nội bộ đáng tin cậy và chỉ chạy local; không gọi đây là secure sandbox.
Không làm upload UI/tournament scheduler trong bước này.
Test xong, báo kết quả và DỪNG.
```

## PROMPT M3 — Backend SQLite + upload

```text
Tiến hành DUY NHẤT milestone M3: bổ sung Express API và SQLite đơn giản,
participant, submissions, upload .py, validate, tournament draft/start.
API bind 127.0.0.1, x-admin-key, storage private, không public bot upload.
Không thêm auth phức tạp/WebSocket/Redis/PostgreSQL/Docker.
Chạy tests. Bảo toàn scripts và multiplayer UI hiện tại. Báo kết quả rồi DỪNG.
```

## PROMPT M4 — Worker và tournament

```text
Tiến hành DUY NHẤT milestone M4: một Node worker polling SQLite,
chạy trận bằng gameAdapter + botRunner, lưu result/seed/replay,
lập lịch 8 bot, 2 bảng 4, 2 lượt/cặp, standings 3/1/0,
semifinal, final theo docs/01 và docs/03.
Đảm bảo 24 game bảng + 4 bán kết + 2 chung kết khi không phát sinh retry.
Test E2E với 8 bot local trusted và các case invalid/timeout/restart.
Không làm UI mới trong bước này. Báo kết quả rồi DỪNG.
```

## PROMPT M5 — UI, replay, hoàn thiện

```text
Tiến hành DUY NHẤT milestone M5: thêm tab Tournament vào React/Vite sẵn có,
upload bot, tạo/start giải local, standings, match list, semifinal/final,
replay read-only từ moves đã lưu. Dùng CSS/components hiện có nếu phù hợp.
Polling REST 2–3 giây; KHÔNG thêm WebSocket mới.
Cập nhật README hướng dẫn 3 terminal để demo, lưu ý trusted-only.
Chạy npm run build/test:server, manual regression game phòng hiện có.
Báo diff/tests rồi DỪNG.
```

## PROMPT REVIEW — Kiểm tra độ bám spec

```text
Review toàn bộ thay đổi của tournament theo AGENTS.md và docs/01..04.
Kiểm tra: không phá room, không copy engine/viết lại luật, protocol đúng,
JSON input/output caps, không shell:true, API local-only, không giả vờ
subprocess là sandbox, SQLite persist, 8 bots/30 games, standings/bracket,
replay, worker restart và test.
KHÔNG tự thêm feature. Báo lỗi theo mức độ nghiêm trọng và nơi sửa.
```
