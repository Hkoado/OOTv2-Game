"""Minimal bot.v1 fixture: valid setup/move envelopes only, no strategy."""
import json
import sys

for line in sys.stdin:
    request = json.loads(line)
    if request.get("kind") == "setup":
        response = {
            "protocolVersion": "bot.v1",
            "requestId": request["requestId"],
            "kind": "setup",
            "placements": [{"pieceId": f"p{index}", "square": f"a{index}"} for index in range(1, 10)],
        }
    else:
        response = {
            "protocolVersion": "bot.v1",
            "requestId": request["requestId"],
            "kind": "move",
            "pieceId": "p1",
            "to": "a1",
        }
    print(json.dumps(response), flush=True)
