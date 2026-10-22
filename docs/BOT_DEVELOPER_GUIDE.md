# Hướng Dẫn Phát Triển Bot Thi Đấu OOTv2 (Bot Developer Instruction)

> **Dành cho AI Coding Agent / Lập trình viên**: Tài liệu này chứa đặc tả kỹ thuật đầy đủ để tạo một repository GitHub chứa bot thi đấu cờ OOTv2. Hãy đọc kỹ và tuân thủ 100% các quy ước để bot được hệ thống tự động kéo về (Git pull), thẩm định và thi đấu thành công.

---

## 1. Quy cách Repository

1. **Vị trí file bot**: Bắt buộc phải là file `bot.py` nằm ngay tại **thư mục gốc (root)** của repository:
   ```text
   my-ootv2-bot/
   ├── bot.py           <-- BẮT BUỘC
   ├── README.md        <-- Khuyến khích mô tả bot
   └── .gitignore
   ```
2. **Kích thước file**: `bot.py` tối đa **256 KiB**.
3. **Ngôn ngữ & Thư viện**:
   - Chạy trên **Python 3.12+**.
   - **CHỈ ĐƯỢC DÙNG THƯ VIỆN CHUẨN (Python Standard Library)** như: `json`, `sys`, `random`, `math`, `copy`, `time`, `collections`, `heapq`...
   - **TUYỆT ĐỐI KHÔNG** dùng thư viện ngoài (`numpy`, `pandas`, `torch`, `pygame`, `scipy`...) vì máy chủ chạy bằng cờ cô lập `python -I -S -B bot.py` (không tải site-packages).
4. **Nhánh Git**: Mặc định là `main` hoặc `master`.
5. **Quyền truy cập**: Repository phải là **Public** trên GitHub (hoặc nếu chạy test cục bộ, có thể dùng mock repo do hệ thống cấp).

---

## 2. Giao thức Truyền Nhận (I/O Protocol)

Hệ thống trọng tài (Judge) vận hành bot theo mô hình **Stateless Subprocess**:
- Mỗi khi cần xếp quân (setup) hoặc đi 1 nước (move), hệ thống khởi chạy một tiến trình Python mới:
  `python -I -S -B bot.py`
- Hệ thống gửi dữ liệu qua **`sys.stdin`** (đúng 1 dòng JSON kết thúc bằng `\n`).
- Bot đọc dữ liệu, tính toán, và in kết quả ra **`sys.stdout`** (đúng 1 dòng JSON kết thúc bằng `\n`), sau đó gọi `sys.stdout.flush()`.
- Tiến trình bot kết thúc ngay sau khi in kết quả.

### Quy định nghiêm ngặt về `stdout` và `stderr`:
> [!CAUTION]
> **TUYỆT ĐỐI KHÔNG** dùng lệnh `print(...)` thông thường để in log ra màn hình, vì điều đó sẽ in vào `sys.stdout` làm hỏng chuỗi JSON kết quả, khiến bot bị xử thua ngay lập tức (`forfeit_move` / `bad_json`).
> Mọi thông tin log/debug phải ghi rõ ràng vào `sys.stderr`:
> ```python
> print("Debug thông tin tại đây...", file=sys.stderr)
> ```

### Thời gian chạy tối đa (Timeout):
- Lượt xếp quân (`setup`): tối đa **3.0 giây**.
- Lượt đi nước (`move`): tối đa **2.0 giây**.
- Quá thời gian quy định sẽ bị tiến trình Judge kết liễu và xử thua (`timeout`).

---

## 3. Quy Tắc Trò Chơi OOTv2

- **Bàn cờ**: 9 hàng x 9 cột (tọa độ từ cột `a` đến `i`, hàng `1` đến `9`, ví dụ: `a1`, `e5`, `i9`).
- **Nhà chính (Base)**:
  - Phe Đỏ (Red): Ô `e1`.
  - Phe Xanh (Blue): Ô `e9`.
- **Số lượng quân**: Mỗi bên 9 quân:
  - 3 Búa (`rock`)
  - 3 Bao (`paper`)
  - 3 Kéo (`scissors`)
- **Di chuyển**: Quân cờ đi được 1 ô theo **8 hướng** (ngang, dọc, chéo).
- **Chiến đấu (Oẳn Tù Tì)**:
  - Búa (`rock`) ăn Kéo (`scissors`).
  - Kéo (`scissors`) ăn Bao (`paper`).
  - Bao (`paper`) ăn Búa (`rock`).
  - Hai quân **cùng loại** (ví dụ: Búa gặp Búa) hoặc quân **cùng phe** thì **KHÔNG** ăn được nhau (chặn đường nhau).
- **Điều kiện thắng (Thắng ngay lập tức)**:
  1. **Chiếm nhà chính đối phương**: Phe Đỏ đưa quân vào ô `e9`, hoặc Phe Xanh đưa quân vào ô `e1`.
  2. **Diệt sạch một loại quân của đối phương**: Ăn sạch toàn bộ 3 quân Búa, HOẶC 3 quân Bao, HOẶC 3 quân Kéo của đối phương.
  3. Đối phương không còn nước đi hợp lệ (`no_legal_move`), hoặc phạm luật (`forfeit`).

---

## 4. Chi tiết Các Yêu Cầu (Requests) & Phản Hồi (Responses)

Dữ liệu đầu vào từ `sys.stdin` luôn là một object JSON có trường `"request"`.

### 4.1. Giai đoạn Xếp Quân (`request == "setup"`)

- **Đỏ (`player == "red"`)**: Xếp quân trước, chưa thấy quân Xanh.
- **Xanh (`player == "blue"`)**: Xếp quân sau, được thấy toàn bộ 9 quân Đỏ đã xếp trong `opponent_pieces`.

#### Input JSON từ stdin:
```json
{
  "protocol_version": 1,
  "request": "setup",
  "player": "red",
  "seed": 12345,
  "my_pieces": [
    {"id": "red_rock_0", "type": "rock"},
    {"id": "red_rock_1", "type": "rock"},
    {"id": "red_rock_2", "type": "rock"},
    {"id": "red_paper_0", "type": "paper"},
    {"id": "red_paper_1", "type": "paper"},
    {"id": "red_paper_2", "type": "paper"},
    {"id": "red_scissors_0", "type": "scissors"},
    {"id": "red_scissors_1", "type": "scissors"},
    {"id": "red_scissors_2", "type": "scissors"}
  ],
  "available_squares": ["a1", "a2", "a3", "...", "i3"],
  "opponent_pieces": []
}
```
*(Nếu là Xanh, `opponent_pieces` sẽ chứa 9 quân của Đỏ kèm ô đã xếp `{"id": "...", "type": "...", "square": "..."}`)*.

#### Output JSON ra stdout:
Phải trả về đúng 9 quân với 9 ô khác nhau nằm trong `available_squares`:
```json
{
  "placements": [
    {"piece_id": "red_rock_0", "square": "a1"},
    {"piece_id": "red_rock_1", "square": "b1"},
    {"piece_id": "red_rock_2", "square": "c1"},
    {"piece_id": "red_paper_0", "square": "d1"},
    {"piece_id": "red_paper_1", "square": "f1"},
    {"piece_id": "red_paper_2", "square": "g1"},
    {"piece_id": "red_scissors_0", "square": "h1"},
    {"piece_id": "red_scissors_1", "square": "i1"},
    {"piece_id": "red_scissors_2", "square": "e2"}
  ]
}
```

---

### 4.2. Giai đoạn Di Chuyển (`request == "move"`)

#### Input JSON từ stdin:
```json
{
  "protocol_version": 1,
  "request": "move",
  "player": "red",
  "turn_number": 5,
  "seed": 12345,
  "pieces": [
    {"id": "red_rock_0", "player": "red", "type": "rock", "square": "b2", "alive": true},
    {"id": "blue_scissors_1", "player": "blue", "type": "scissors", "square": "b3", "alive": true}
  ],
  "legal_moves": [
    {"piece_id": "red_rock_0", "to": "b3"},
    {"piece_id": "red_rock_0", "to": "c2"},
    {"piece_id": "red_rock_0", "to": "a2"}
  ]
}
```

#### Output JSON ra stdout:
Bot **bắt buộc phải chọn đúng một nước đi có trong danh sách `legal_moves`**:
```json
{
  "piece_id": "red_rock_0",
  "to": "b3"
}
```

---

## 5. Code Mẫu Chuẩn Cho Bot (`bot.py`)

Dưới đây là mã nguồn hoàn chỉnh của một bot mẫu có tư duy chiến thuật cơ bản (Greedy AI), sẵn sàng để agent sử dụng làm nền tảng hoặc tinh chỉnh:

```python
#!/usr/bin/env python3
"""
OOTv2 Tournament Bot
Tuân thủ đầy đủ OOTv2 Bot Protocol V1 (Python 3.12+ Standard Library only).
"""

import sys
import json
import math

BEATS = {
    "rock": "scissors",
    "scissors": "paper",
    "paper": "rock",
}

def parse_coord(sq):
    col = ord(sq[0].lower()) - ord('a')
    row = int(sq[1]) - 1
    return col, row

def chebyshev_distance(sq1, sq2):
    c1, r1 = parse_coord(sq1)
    c2, r2 = parse_coord(sq2)
    return max(abs(c1 - c2), abs(r1 - r2))

def on_setup(req):
    my_pieces = req["my_pieces"]
    available_squares = req["available_squares"]
    player = req["player"]
    opp_pieces = req.get("opponent_pieces", [])
    
    # Chiến thuật setup:
    # Bảo vệ nhà chính (Red: e1, Blue: e9), dàn quân đều các cột
    # Đặt quân phòng thủ gần base, quân tấn công ở hàng phía trước
    opp_base = "e9" if player == "red" else "e1"
    
    # Sắp xếp các ô khả dụng theo khoảng cách tới nhà chính đối phương
    sorted_squares = sorted(available_squares, key=lambda sq: chebyshev_distance(sq, opp_base))
    
    placements = []
    # Chọn 9 ô đầu tiên không trùng nhau
    chosen_squares = sorted_squares[:9]
    
    for piece, square in zip(my_pieces, chosen_squares):
        placements.append({
            "piece_id": piece["id"],
            "square": square
        })
        
    return {"placements": placements}

def on_move(req):
    player = req["player"]
    legal_moves = req.get("legal_moves", [])
    pieces = req.get("pieces", [])
    
    if not legal_moves:
        raise ValueError("Không có nước đi hợp lệ.")
        
    opp_player = "blue" if player == "red" else "red"
    opp_base = "e9" if player == "red" else "e1"
    
    # Tạo bản đồ bàn cờ hiện tại
    piece_map = {p["id"]: p for p in pieces if p.get("alive", True)}
    square_to_piece = {p["square"]: p for p in pieces if p.get("alive", True) and p.get("square")}
    
    # Đếm số lượng từng loại quân còn sống của đối thủ
    opp_counts = {"rock": 0, "paper": 0, "scissors": 0}
    for p in pieces:
        if p.get("alive", True) and p.get("player") == opp_player:
            opp_counts[p["type"]] += 1
            
    best_move = legal_moves[0]
    best_score = -999999
    
    for move in legal_moves:
        score = 0
        p_id = move["piece_id"]
        to_sq = move["to"]
        piece = piece_map.get(p_id)
        if not piece:
            continue
            
        p_type = piece["type"]
        from_sq = piece["square"]
        
        # 1. ƯU TIÊN CAO NHẤT: Chiếm nhà chính đối phương để thắng trận
        if to_sq == opp_base:
            score += 100000
            
        # 2. Ăn quân đối thủ
        target_piece = square_to_piece.get(to_sq)
        if target_piece and target_piece["player"] == opp_player:
            target_type = target_piece["type"]
            if BEATS.get(p_type) == target_type:
                # Nếu đây là quân cuối cùng của loại đó -> THẮNG NGAY LẬP TỨC!
                if opp_counts[target_type] == 1:
                    score += 90000
                else:
                    score += 500
                    
        # 3. Tiến quân về gần nhà chính đối phương
        old_dist = chebyshev_distance(from_sq, opp_base)
        new_dist = chebyshev_distance(to_sq, opp_base)
        score += (old_dist - new_dist) * 15
        
        # 4. Tránh bị ăn ở ô đích (kiểm tra an toàn đơn giản)
        for other_p in pieces:
            if other_p.get("alive", True) and other_p.get("player") == opp_player:
                other_sq = other_p.get("square")
                if other_sq and chebyshev_distance(other_sq, to_sq) == 1:
                    # Đối thủ có thể đi tới to_sq ở lượt kế tiếp
                    if BEATS.get(other_p["type"]) == p_type:
                        score -= 300
                        
        if score > best_score:
            best_score = score
            best_move = move
            
    return best_move

def main():
    line = sys.stdin.readline()
    if not line:
        return
        
    try:
        req = json.loads(line.strip())
    except Exception as e:
        print(f"Lỗi cú pháp JSON: {e}", file=sys.stderr)
        return

    req_type = req.get("request")
    if req_type == "setup":
        resp = on_setup(req)
    elif req_type == "move":
        resp = on_move(req)
    else:
        print(f"Không hỗ trợ request: {req_type}", file=sys.stderr)
        return
        
    # In ra đúng 1 dòng JSON ra STDOUT
    sys.stdout.write(json.dumps(resp, ensure_ascii=False) + "\n")
    sys.stdout.flush()

if __name__ == "__main__":
    main()
```

---

## 6. Kiểm Thử Cục Bộ Trước Khi Đẩy Lên Git (Local Verification)

Agent hãy chạy thử script sau qua terminal để chắc chắn `bot.py` hoạt động:

### Test Setup:
```bash
python bot.py << 'EOF'
{"protocol_version":1,"request":"setup","player":"red","seed":100,"my_pieces":[{"id":"red_rock_0","type":"rock"},{"id":"red_rock_1","type":"rock"},{"id":"red_rock_2","type":"rock"},{"id":"red_paper_0","type":"paper"},{"id":"red_paper_1","type":"paper"},{"id":"red_paper_2","type":"paper"},{"id":"red_scissors_0","type":"scissors"},{"id":"red_scissors_1","type":"scissors"},{"id":"red_scissors_2","type":"scissors"}],"available_squares":["a1","b1","c1","d1","f1","g1","h1","i1","e2"],"opponent_pieces":[]}
EOF
```
*Kết quả phải trả về 1 dòng JSON chứa `"placements"` gồm 9 quân.*

### Test Move:
```bash
python bot.py << 'EOF'
{"protocol_version":1,"request":"move","player":"red","seed":100,"turn_number":1,"pieces":[{"id":"red_rock_0","player":"red","type":"rock","square":"b1","alive":true}],"legal_moves":[{"piece_id":"red_rock_0","to":"b2"}]}
EOF
```
*Kết quả phải trả về: `{"piece_id": "red_rock_0", "to": "b2"}`.*

