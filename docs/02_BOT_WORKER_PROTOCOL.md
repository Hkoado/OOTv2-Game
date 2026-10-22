# 02 — Đặc tả Bot Protocol, Judge Worker và chế độ chạy local

> T?i li?u l?ch s? cho profile MVP. Khi m? r?ng Campus, ?u ti?n [docs m?i](README.md)
> v? [tr?ng th?i tri?n khai](07-TRANG-THAI-TRIEN-KHAI.md); gi? version ?? ??c k?t qu?/replay c?.

## 1. Quyết định quan trọng

**Mỗi lần cần xếp quân hoặc đi một nước, worker khởi tạo một process Python mới** để xử lý 1 request JSON, đọc 1 response JSON, sau đó process thoát. Bot là stateless: không giữ biến qua các lần gọi. Đây là lựa chọn MVP dễ debug, dễ timeout/thu hồi process, chấp nhận overhead vì chỉ chạy 1 match một lúc.

Không dùng container. KHÔNG mô tả `subprocess`/`venv`/`-I`/temp working directory như một sandbox bảo mật hoàn chỉnh. Chỉ dùng bot đáng tin cậy trên máy hoặc VM thử nghiệm riêng, API bind `127.0.0.1`. Không triển khai upload công khai.

## 2. Quy ước file bot và stdin/stdout

- Upload duy nhất file tên kết thúc `.py` (giới hạn 64 KiB), không cho ZIP, executable, symlink; lưu tên ngẫu nhiên do server đặt trong `data/submissions/<uuid>.py`.
- Worker launch Python 3.12+ với argument riêng, **không thông qua shell**; ưu tiên `python -I -S -B <absolute-path-to-bot>` cho local trusted demo.
- `stdin`: chính xác **một dòng JSON UTF-8** và dấu newline, đóng stdin ngay sau khi gửi.
- `stdout`: chính xác **một dòng JSON UTF-8**. Không `print` lời chào/log ra stdout; debug có thể ghi stderr (bị giới hạn).
- `stderr`: chỉ để debug nội bộ, không xuất đường dẫn máy chủ/secret ra frontend.
- Response >16 KiB, timeout, process exit != 0, stdout rỗng/không hợp lệ/nhiều dòng -> lỗi bot.
- Max input JSON 64 KiB, max source 64 KiB, stdout/stderr buffer tối đa 16 KiB mỗi luồng.
- Setup: timeout 3 giây/process; move: 2 giây/process; giới hạn **200 plies** mỗi game.
- Đầu vào JSON có `protocol_version: 1`; request sai phiên bản phải bị từ chối rõ ràng.

## 3. Request: setup

Đỏ luôn setup trước. Khi gọi bot Xanh, mảng `opponent_pieces` có đủ 9 quân Đỏ đã setup.

```json
{
  "protocol_version": 1,
  "request": "setup",
  "player": "red",
  "seed": 12345,
  "my_pieces": [
    { "id": "red_rock_0", "type": "rock" },
    { "id": "red_rock_1", "type": "rock" }
  ],
  "available_squares": ["a1", "a2", "a3"],
  "opponent_pieces": []
}
```

Ví dụ trên **rút gọn array chỉ để minh họa**. Trong request thật, `my_pieces` có đúng 9 phần tử (3 mỗi loại); `available_squares` có đầy đủ 28 ô vùng sân nhà tương ứng. Agent lấy danh sách từ `createUnplacedPieces()` và các hằng `RED_HOME_SQUARES`, `BLUE_HOME_SQUARES`, KHÔNG hardcode 9 ID.

Response phải gồm **đủ chín** placement hợp lệ:

```json
{
  "placements": [
    { "piece_id": "red_rock_0", "square": "a1" },
    { "piece_id": "red_rock_1", "square": "a2" }
  ]
}
```

Ví dụ response cũng được rút gọn. Trong thực tế: đủ 9 piece IDs duy nhất, 9 square khác nhau trong sân nhà đội đó, không vượt ranh giới; mọi ID thuộc bot đang được hỏi. Response thiếu/trùng/không hợp lệ => **bot đó thua do lỗi setup** (`forfeit_setup`). Như vậy tournament không dùng auto-fill khi bot quên setup. Chức năng tự điền quân sau 30 giây của phòng chơi người thật vẫn giữ nguyên.

## 4. Request: move

```json
{
  "protocol_version": 1,
  "request": "move",
  "player": "red",
  "seed": 12345,
  "turn_number": 1,
  "pieces": [
    {"id":"red_rock_0", "player":"red", "type":"rock", "square":"a1", "alive":true},
    {"id":"blue_paper_3", "player":"blue", "type":"paper", "square":"h9", "alive":true}
  ],
  "legal_moves": [
    {"piece_id":"red_rock_0", "to":"b1"},
    {"piece_id":"red_rock_0", "to":"b2"}
  ]
}
```

`pieces` mẫu được rút gọn; trong request thật gửi **toàn bộ 18 quân** để bot tính chiến thuật. `legal_moves` do server tổng hợp từ `getValidMoves` cho mọi quân còn sống thuộc phe đang tới lượt. Response:

```json
{ "piece_id": "red_rock_0", "to": "b2" }
```

- `piece_id` phải thuộc phe hiện tại và đang sống; `(piece_id,to)` phải có trong `legal_moves` (sau đó judge còn gọi `executeMove()` để giữ engine là trọng tài cuối).
- Không có legal move trước khi gọi bot: phe tới lượt thua (`no_legal_move`).
- Sai JSON, sai schema, nước không hợp lệ, timeout hoặc process lỗi: phe bot đó thua ngay (`forfeit_move`).
- Nếu đúng 200 plies mà chưa ai thắng: kết quả `draw` với reason `move_limit`.
- Bot không được chỉ định `winner`, `pieces` mới hoặc kết quả trận; không tin dữ liệu nào từ bot ngoài placement/move.

## 5. Vòng đời một game

```text
PENDING
  ↓ (worker nhận game)
RUNNING
  ↓ gọi bot RED: setup → validate
  ↓ gọi bot BLUE: setup (thấy RED) → validate
  ↓ state.phase = playing; turn = red
  ├── có legal moves? nếu không: thua
  ├── gọi process bot theo turn, timeout 2s
  ├── validate output → executeMove(state, turn, pieceId, to)
  ├── ghi event {ply, player, from, to, piece_id, capture?, state_digest?}
  └── lặp tới winner hoặc 200 plies
FINISHED: result = red_win | blue_win | draw, reason + replay
```

- Khi setup thành công, dùng chính `completeSetupRed()` và `completeSetupBlue()` của source (hoặc adapter thật mỏng nếu hàm hiện tại không đủ tính thuần).
- Seed sử dụng trong scheduling và mọi fallback ngẫu nhiên do judge xử lý, nhưng không để `Math.random()` gây khác nhau giữa các lần replay.
- **Lưu `initial_pieces` và từng event**. Replay GUI lấy initial board, đi qua từng event; không cần chạy lại Python bot để xem replay.
- Nếu worker crash giữa trận: trên khởi động lại local single-worker, reset match `running` chưa hoàn tất về `pending`, chạy lại bằng **seed và submission snapshot cũ**. Lưu kết quả theo transaction để không đúp điểm.

## 6. BotRunner interface (cho AI agent hiện thực)

```js
// Dạng định hướng, KHÔNG phải code cài đặt hoàn chỉnh:
// runBotRequest({ filePath, payload, timeoutMs })
//   -> { ok: true, response: object }
//   -> { ok: false, errorCode: 'timeout' | 'bad_json' |
//                                  'nonzero_exit' | 'output_limit' | 'spawn_error' }
```

Thiết kế implementation:

1. Dùng `child_process.spawn(pythonPath, ['-I','-S','-B',absoluteBotPath], {cwd:privateTempDir, shell:false, env:safeMinimalEnv, stdio:['pipe','pipe','pipe']})`.
2. Không truyền `process.env` nguyên trạng cho bot: chỉ truyền môi trường tối thiểu để tìm Python/locale/temp trên máy local, không chứa DB password, admin key, API tokens.
3. Ghi input 1 dòng, đóng stdin, giới hạn stdout và stderr khi nhận chunk.
4. Timeouts lấy đồng hồ server. Khi vi phạm, kill process (và dọn process tree phù hợp OS), giải phóng working dir trong `finally`.
5. Validate path nằm trong thư mục submissions với `realpath`/normalized paths; loại bỏ symlink; không dùng original filename do client cung cấp.
6. Trả mã lỗi có cấu trúc để match runner xử thua; tuyệt đối không throw uncaught làm dừng worker.
7. Giới hạn 1 trận chạy đồng thời để tránh resource contention; không cho API gọi trực tiếp bot runner.

### Cảnh báo cô lập

- `python -I -S -B` **chỉ giảm ảnh hưởng của môi trường/import**, không chặn truy cập file, network, CPU/RAM hoặc tiến trình con.
- `spawn` + timeout + output cap + thư mục riêng **không an toàn với code của người lạ**. Không có sandbox security boundary ở cấp hệ điều hành trong MVP.
- Nếu thật sự cần mở public, làm nhiệm vụ RIÊNG: chạy worker trên VM/host biệt lập và bổ sung isolation OS thực sự (restricted user, deny network, resource limits, filesystem policy, process tree limit; có thể nghiên cứu `nsjail` nếu chấp nhận). **Không được tự bật public bằng một cờ config**.
- Local dev Windows được hỗ trợ cho bot được tin tưởng; Linux phù hợp hơn nếu sau này cần hạn chế tài nguyên ở cấp OS.

## 7. Kiểm thử worker tối thiểu

- Bot sample setup 9 quân mỗi màu, move hợp lệ.
- Bot stdout không phải JSON -> thua, worker tiếp tục trận kế.
- Bot treo vô hạn -> timeout -> thua, không treo API.
- Bot `print` debug vào stdout -> invalid protocol (thông báo rõ).
- Bot trả move không có trong legal list -> forfeit.
- Bot không có legal move -> thua theo rule tournament.
- Bot chạy quá 200 plies -> draw.
- Worker restart với match `running` không kết quả -> chạy lại với seed cũ.
- Bot cố truy cập file/network là **rủi ro được ghi nhận**; không được dùng test này làm bằng chứng đã có sandbox.
