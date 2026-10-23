# Kiến trúc chấm trước và phát trận theo lịch — 23/10/2026

Tài liệu này **chốt hướng triển khai**, không phải tuyên bố M1–M6 đã xong.
Mốc M0 (baseline + quyết định) đã thực hiện; các mốc sau triển khai dần, mỗi lần một milestone.

**Đối chiếu sau các commit Supabase-only/M1 ngày 23/10:** xem
[bàn giao hai agent](15-DIEU-PHOI-HAI-AGENT.md) cho phần đã có, phần thiếu, ownership và prompt.
M1 chưa hoàn tất GitHub SHA/job/receipt; đợt song song đầu chỉ đóng M1, chưa làm tràn M2–M6.

## 1. Vấn đề và quyết định

Yêu cầu mới nhất của BTC:

1. Sinh viên nộp **repo GitHub**, không upload file.
2. Máy BTC (worker) **chỉ đọc DB** để lấy việc, chấm, rồi **ghi lại kết quả/replay vào DB**.
3. Khi BTC công bố, **bật phát trận đó**; lúc này mới đọc kết quả đã chấm và chiếu cho thí sinh xem.
4. Thí sinh xem **từng nước một**, có nhịp nhả nước tối ưu theo số người xem.
5. Web chính host trên Vercel/Cloudflare; **không chạy live bằng tiến trình server dài hạn**.

Quyết định: **chấm trước — lưu kín — phát theo lịch**. Web chỉ phục vụ request ngắn;
worker là tiến trình riêng trên máy BTC. Client tải dữ liệu đã được phép xem rồi tự dựng bàn cờ.

```text
Sinh viên ──► Web (Vercel) ──► Supabase (DB + Storage private) ◄── Worker máy BTC
                 │                        │
                 │                        └── replay + kết quả (private tới khi công bố)
                 └── API kiểm quyền, tính mốc nước được xem, trả dữ liệu ──► Viewer (trình duyệt)
```

Điều này **không** thay thế: chế độ 2 người chơi/spectator cũ, engine, luật OOTv2, hay framework hiện tại.

## 2. Không dùng cách hiểu “worker chạy trên web, thực thi ở client”

- Worker chấm là **tiến trình Node.js + Python trên máy BTC**, ở `server/shared/worker.js`;
  `server/worker.js` chỉ là entrypoint. Supabase là DB duy nhất, SQLite legacy đã bị bỏ.
- Trình duyệt **không chấm bot, không quyết định kết quả**; chỉ dựng bàn cờ và diễn hoạt nước đi.
- Trang quản lý worker trên web chỉ hiển thị trạng thái/nhịp tim; không nhận lệnh chạy code tùy ý
  qua HTTP và không chạy Python trong Function.

## 3. Trạng thái dữ liệu

### 3.1 Trạng thái chấm (đã có trong schema hiện tại)

`mvp_matches.status` hiện chỉ có `pending | running | finished`, kèm `lease_token`,
`worker_id`, `lease_until` (lease 60 s), `replay_json`, `result`, `reason`, `ply_count`.
Sự cố hạ tầng dùng `mvp_release` để trả ván về `pending` (hoãn 30 s), **không** tính là thua bot.

### 3.2 Trạng thái công bố (đề xuất, migration additive ở M3)

Tách khỏi trạng thái chấm bằng **bảng riêng** thay vì nhồi thêm giá trị vào `CHECK` của
`mvp_matches.status`. Lý do: không phá các truy vấn queue/bracket đang dựa trên 3 giá trị cũ,
và một ván có thể bị hủy lịch phát mà kết quả chấm vẫn giữ nguyên.

```text
hidden → scheduled → broadcasting → ended
   └──────────── hủy lịch (quay lại hidden) ───────────┘
```

Trường tối thiểu: `match_id`, `starts_at`, `ply_interval_ms`, `release_mode`
(`window` = chỉ mở tới mốc hiện tại, `full` = mở toàn bộ sau khi phát xong),
`created_by`, `created_at`, `updated_at`.

## 4. Luồng nghiệp vụ

### 4.1 Nộp bài

1. Sinh viên nhập repo GitHub + branch; file thi cố định `bot.py`.
2. API **không** chạy bot, **không** clone trong Function.
3. API ghi nhận **commit SHA** và **thời điểm nhận theo giờ server**, tạo job kiểm tra.
4. Worker tải đúng blob tại SHA, kiểm kích thước/hash/cú pháp, chạy smoke test, ghi receipt.
5. Sinh viên thấy receipt: commit nào đã nhận, đang kiểm tra, hợp lệ hay lỗi.

Không dùng `git pull` trước mỗi trận: mọi trận dùng **cùng một bản bot đã khóa**.
Commit sau cutoff không đủ điều kiện, kể cả khi worker chấm sau cutoff.

### 4.2 Chấm trước

Worker claim job → giữ lease/heartbeat → chấm → ghi `result`, `replay_json`, nhật ký → tiến vòng đấu.
Ván đã `finished` nhưng **chưa có bản ghi công bố** thì thí sinh **không** thấy gì:
không replay, không kết quả, không điểm, không nhánh bracket.

### 4.3 Công bố và phát

Admin chọn ván đã chấm, đặt `starts_at` và `ply_interval_ms`. Server tính mốc từ giờ server:

```text
visible_plies = clamp(floor((server_now - starts_at) / ply_interval_ms) + 1, 0, total_plies)
```

- Trước `starts_at`: `visible_plies = 0`, UI hiện đếm ngược.
- Trong lúc phát: chỉ trả các nước `0..visible_plies-1`, **không** trả kết quả cuối.
- Sau khi phát hết: mở replay đầy đủ nếu `release_mode = full`; nếu `window` thì vẫn chỉ trả tới mốc cuối.
- Người vào muộn nhận ngay mốc hiện tại, không phát lại từ đầu.

### 4.4 Chính sách xem (thay quyết định cũ)

| Đối tượng | Được xem |
|---|---|
| Khách chưa đăng nhập | Chỉ thông tin giải đã công khai; không nước đi, không kết quả |
| Đội thuộc giải | **Mọi ván đã được công bố trong giải mình tham gia**, kể cả vòng sau khi đã bị loại |
| Đội khác giải | Không |
| Admin | Tất cả, gồm cả ván chưa công bố và nhật ký chấm |

Quy tắc này thay dòng “chỉ trận thuộc vòng mình tham gia” trong `docs/README.md`.
Server vẫn là nguồn quyền cuối cùng; kiểm tra ở API, không chỉ ẩn nút trên UI.

## 5. Nhịp phát và tải

Tách hai đại lượng, **không tăng thời gian mỗi nước chỉ vì đông người xem**:

- **Nhịp phát** (`ply_interval_ms`): trải nghiệm xem, mặc định **2000 ms/nước**.
- **Chu kỳ lấy dữ liệu của client** (`next_poll_ms`): tải API/DB, mặc định **2000 ms**,
  tự giãn tới 5000 ms khi tải cao; tab ẩn thì dừng.

Ước lượng tải: `request/giây ≈ số viewer đồng thời ÷ chu kỳ poll (giây)`.

| Viewer | Poll 2 s | Poll 3 s | Poll 5 s |
|---:|---:|---:|---:|
| 50 | 25 | 17 | 10 |
| 100 | 50 | 33 | 20 |
| 200 | 100 | 67 | 40 |
| 500 | 250 | 167 | 100 |

Thời lượng một ván: 200 nước ≈ 6 phút 40 giây; 400 nước ≈ 13 phút 20 giây (ở 2 s/nước).

Biện pháp giảm tải bắt buộc khi triển khai:

- Một request trả gói: `server_time`, `visible_plies`, nước mới từ `afterSeq`, `phase`, `next_poll_ms`.
- Không trả toàn bộ replay mỗi lần; không dùng helper tải mọi trận/replay để phục vụ viewer.
- Truy vấn có index; gộp kiểm phiên + membership + dữ liệu phát trong ít lượt DB nhất.
- Jitter nhẹ ở client để cả lớp không gọi cùng một giây.
- Không cache công khai phản hồi riêng theo tài khoản; không dựa vào bộ đếm RAM của một Function.
- Đo thật ở 50/100/200 viewer rồi **chốt** chu kỳ; chưa cần SSE/WebSocket ở bản đầu.

**Mục tiêu nghiệm thu M5: 100 viewer đồng thời** (quy mô ~100 sinh viên trong docs), kiểm thêm 200.
Đây là mục tiêu kiểm thử, không phải cam kết hosting chịu tải trước khi đo.

## 6. Hình dạng API đề xuất (M3–M4)

```text
GET  /api/local/events/:eventId/broadcasts            danh sách ván đã công bố + trạng thái
GET  /api/local/broadcasts/:matchId?afterSeq=<n>      gói dữ liệu phát (có session + CSRF read-only)
POST /api/local/admin/broadcasts                      đặt lịch { match_id, starts_at, ply_interval_ms, release_mode }
POST /api/local/admin/broadcasts/:matchId/cancel      hủy lịch trước giờ phát
```

Phản hồi của gói phát (ví dụ):

```json
{
  "match_id": "…",
  "phase": "broadcasting",
  "server_time": "2026-10-23T12:00:06.000Z",
  "starts_at": "2026-10-23T12:00:00.000Z",
  "ply_interval_ms": 2000,
  "visible_plies": 4,
  "total_plies": 137,
  "events": [{ "seq": 3, "ply": 3, "type": "move", "payload": { "…": "…" } }],
  "next_poll_ms": 2000
}
```

Quy tắc bắt buộc:

- `events` chỉ chứa `seq >= afterSeq` và `seq < visible_plies`; **không** có `result` khi chưa hết ván.
- `total_plies` chỉ tiết lộ số nước, không tiết lộ ai thắng.
- Mọi response `private, no-store`; không dùng edge cache công khai cho dữ liệu theo tài khoản.
- Sai quyền trả 403/404 thống nhất, không phân biệt “không tồn tại” và “không được xem”.

## 7. Triển khai hosting

| Thành phần | Nơi chạy | Ghi chú |
|---|---|---|
| React/Vite | Vercel (static) | Giữ nguyên build hiện tại |
| API Express | Vercel Function | Chỉ request ngắn; không chạy Python, không clone, không vòng lặp worker |
| DB + Storage | Supabase | Service role chỉ ở server; không dùng `VITE_` cho secret |
| Worker chấm | Máy BTC (Linux/VM) | Node + Python + cách ly; kết nối DB trực tiếp |

`vercel.json` hiện rewrite mọi đường dẫn về `index.html`, sẽ nuốt `/api/*`.
M1 phải đổi sang cấu hình có Function cho API và fallback SPA riêng cho phần còn lại.
Vercel Function có giới hạn thời gian thực thi, nên **không** đưa vòng lặp worker vào đó.
Cloudflare Workers có runtime/giới hạn khác Node đầy đủ; chỉ chọn khi đã kiểm chứng API chạy được,
và WebSocket/SSE cần Durable Objects — bản đầu dùng polling nên không cần.

## 8. Milestone

| Mốc | Nội dung | Điều kiện Done |
|---|---|---|
| **M0** | Baseline build/test, chốt kiến trúc, ghi tài liệu, không merge mù nhánh cũ | Build + test pass; tài liệu này và `docs/07` cập nhật |
| M1 | API web không thực thi bot; tách khởi tạo SQLite/filesystem/Python; entrypoint Vercel; job nộp bài + receipt | Đăng nhập, đăng ký repo, tạo job chạy được mà web không cần Python |
| M2 | Worker GitHub lấy đúng blob tại SHA, giới hạn/hash, validation phía worker, map cho shared worker, retry/idempotency | Repo → receipt → validation → snapshot → chấm → replay kín |
| M3 | Migration bảng công bố, admin đặt/hủy lịch, API tính mốc, chặn lộ replay/kết quả/bracket | Không lấy được nước tương lai hay kết quả kín qua API |
| M4 | Viewer từng nước, đếm ngược, bắt kịp khi vào muộn, mở replay sau khi phát xong | Hai tài khoản cùng giải thấy cùng mốc; khác giải bị chặn |
| M5 | Test tải 50/100/200 viewer, hai worker tranh chấp, mất mạng, cutoff, force-push, hồi quy chế độ cũ | Có số đo thật; chốt chu kỳ polling từ số đo |
| M6 | Đóng gói + docs deploy Vercel, setup máy chấm, vận hành/khôi phục | Người khác làm theo tài liệu deploy được bản Preview |

Chi tiết điều kiện an toàn: **chưa có cách ly cấp OS đã kiểm thử thì chỉ chạy bot tin cậy**.
Subprocess không phải sandbox; không mở nhận bài không tin cậy qua Internet.

## 9. Quyết định về các nhánh cũ (M0)

Baseline M0: `testkhoa` @ `7676a51` (nhánh `live` + commit logs). Build pass, `npm.cmd test` **93/93**.

Đã xem xét `Backend` và `Worker-Fix` (chỉ tồn tại ở remote-tracking, chưa merge) và **không merge nguyên nhánh**:

| Nhánh | Có gì | Vì sao chưa merge |
|---|---|---|
| `Backend` | Clone/sync repo GitHub, trường deadline, validation | Gắn với SQLite, và lấy HEAD tại/qua cutoff → không khóa đúng commit trước hạn |
| `Worker-Fix` | Hỗ trợ map có ô cản, kiểm `OOTV2_ALLOW_BLOCKED_MAPS` | Chỉ cho worker SQLite; cờ kiểm truthy chứ không so `=1`; shared worker chưa có map |

Cách làm: **port chọn lọc** sang đường Supabase/shared ở M2 (khóa SHA, map, validation phía worker),
không mang theo logic deadline sai và không tạo hai nguồn sự thật SQLite/Supabase.

Đã có sẵn trên HEAD và sẽ tái sử dụng:

- Claim + lease 60 s + heartbeat 10 s + token fencing, `mvp_release` cho sự cố hạ tầng.
- `mvp_finish` kiểm `result/reason/replay` trước khi ghi; kết quả cũ không bị ghi đè.
- `ReplayBoard` dựng bàn cờ từ replay ở client.
- Portal kiểm quyền theo membership giải.

## 10. Chưa làm / rủi ro đã biết

- **Chưa có** bảng công bố, lịch phát, API cắt theo mốc, hay viewer “từng nước theo giờ” — thuộc M3–M4.
- **Chưa có** cách ly cấp OS cho bot sinh viên; chưa được mở nhận bài công khai.
- API upload chỉ kiểm tĩnh; Python validation đã chuyển sang worker, nhưng chưa có job claim/lease/fencing
  cho validation upload. GitHub intake/SHA/job/receipt còn thiếu ở M1, thực thi job an toàn thuộc M2.
- API live công khai hiện tại (`/api/live`) đọc Supabase, không kiểm membership/lịch phát → phải khóa lại trước khi công bố.
- Mọi worker dùng chung một service role key của Supabase → chưa có danh tính riêng cho từng máy chấm.
- Test tải mới là ước lượng; phải đo thật trước khi cam kết 100–200 viewer.
- Luật 200 nước trong MVP khác 400 plies của Campus; **không đổi trong đợt này**.

## 11. Lệnh kiểm chứng M0

```powershell
npm.cmd run build
npm.cmd test
node docs/ui-style/build-tokens.mjs
```

Kết quả M0: build pass (3.94 s), test **93/93 pass** (42,6 s, exit 0).

## 12. Tiêu chí bàn giao cuối

> Đội A nộp repo → worker nhận và kiểm tra → BTC khóa/chấm → kết quả còn kín → BTC đặt lịch →
> đội thuộc giải xem từng nước → đội khác giải bị chặn → phát xong mới thấy kết quả/replay đầy đủ.

Kèm số đo tải, lệnh đã chạy và phần chưa nghiệm thu. Có tài liệu hoặc build thành công
**không** được báo là đã nghiệm thu production.


