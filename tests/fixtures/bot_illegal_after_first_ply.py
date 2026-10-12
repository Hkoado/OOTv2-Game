"""Fixture: bot hợp lệ khi setup và ở nước đi đầu tiên (để qua smoke test khi upload),
sau đó cố tình trả nước không nằm trong `legal_moves` để judge xử thua `forfeit_move`."""
import json
import sys


def main():
    request = json.loads(sys.stdin.readline())
    if request.get("request") == "setup":
        pieces = request["my_pieces"]
        squares = request["available_squares"]
        response = {
            "placements": [
                {"piece_id": piece["id"], "square": square}
                for piece, square in zip(pieces, squares[:9])
            ]
        }
    elif request.get("turn_number", 0) <= 1:
        response = request["legal_moves"][0]
    else:
        # Nước sai: ô đích không nằm trong legal_moves của bất kỳ quân nào.
        response = {"piece_id": request["legal_moves"][0]["piece_id"], "to": "z9"}
    sys.stdout.write(json.dumps(response) + "\n")
    sys.stdout.flush()


main()
