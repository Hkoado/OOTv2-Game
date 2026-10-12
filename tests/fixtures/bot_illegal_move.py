"""Fixture: bot hợp lệ khi setup nhưng luôn trả nước đi không nằm trong legal_moves."""
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
    else:
        # Cố tình trả nước sai để kiểm tra judge từ chối.
        response = {"piece_id": "red_rock_0", "to": "e5"}
    sys.stdout.write(json.dumps(response) + "\n")
    sys.stdout.flush()


main()
