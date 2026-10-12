"""Fixture: bot setup lỗi (chỉ xếp 5 quân) -> forfeit_setup."""
import json
import sys

request = json.loads(sys.stdin.readline())
pieces = request["my_pieces"]
squares = request["available_squares"]
response = {
    "placements": [
        {"piece_id": piece["id"], "square": square}
        for piece, square in zip(pieces[:5], squares[:5])
    ]
}
sys.stdout.write(json.dumps(response) + "\n")
sys.stdout.flush()
