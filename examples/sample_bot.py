"""OOTv2 bot mẫu cho MVP, Python 3.12+, chỉ standard library.

Protocol: đọc đúng 1 JSON line từ stdin và in đúng 1 JSON line ra stdout.
Bot stateless. Không in log ra stdout. Thích hợp để test giao thức, không
phải bot chơi giỏi.
"""

import json
import sys


def on_setup(request):
    pieces = request["my_pieces"]
    squares = request["available_squares"]
    if len(pieces) != 9 or len(squares) < 9:
        raise ValueError("Unexpected setup request")
    # Chọn 9 ô sân nhà đầu tiên, không trùng. Blue vẫn nhận được đội hình Red
    # qua opponent_pieces nhưng bot ví dụ không cần sử dụng.
    return {
        "placements": [
            {"piece_id": piece["id"], "square": square}
            for piece, square in zip(pieces, squares[:9])
        ]
    }


def on_move(request):
    legal_moves = request["legal_moves"]
    if not legal_moves:
        # Judge phải xử lý no_legal_move trước khi gọi bot.
        raise ValueError("No legal moves available")
    # Chọn nước hợp lệ đầu tiên, không dùng random để demo tái lập được.
    return legal_moves[0]


def main():
    line = sys.stdin.readline()
    if not line:
        raise ValueError("No input provided")
    request = json.loads(line)
    if request.get("protocol_version") != 1:
        raise ValueError("Unsupported protocol version")

    request_type = request.get("request")
    if request_type == "setup":
        response = on_setup(request)
    elif request_type == "move":
        response = on_move(request)
    else:
        raise ValueError(f"Unsupported request: {request_type}")

    sys.stdout.write(json.dumps(response, ensure_ascii=False) + "\n")
    sys.stdout.flush()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Bot failed: {error}", file=sys.stderr)
        sys.exit(1)
