"""Single-file bot.v1 example / editable SDK, Python 3.12+, standard library.

One process lives for a whole game. Keep stdout exclusively for flushed JSONL.
This file is an example strategy, NOT a sandbox or a tournament worker.
"""
import json
import random
import sys


def setup(obs):
    """Replace this strategy; availableSquares already excludes blocked cells."""
    return [{"pieceId": p["id"], "square": square}
            for p, square in zip(obs["unplaced"], obs["availableSquares"])]


def move(obs):
    """Replace this strategy. Server still validates every chosen move."""
    return obs["legalMoves"][0]


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON key")
        result[key] = value
    return result


def reject_constant(value):
    raise ValueError("Non-finite JSON number: " + value)


def main():
    rng = None
    while True:
        line = sys.stdin.buffer.readline(65537)
        if not line:
            break
        if len(line) > 65536 or not line.endswith(b"\n"):
            raise ValueError("Request line exceeds protocol limit")
        request = json.loads(line.decode("utf-8"), object_pairs_hook=unique_object,
                             parse_constant=reject_constant)
        if request["protocolVersion"] != "bot.v1":
            raise ValueError("Unsupported protocol")
        obs = request["game"]
        if rng is None:
            rng = random.Random(obs["seed"])
        # rng is seeded once per game; strategies may close over it if needed.
        response = {"protocolVersion": "bot.v1", "requestId": request["requestId"],
                    "kind": request["kind"]}
        if request["kind"] == "setup":
            response["placements"] = setup(obs)
        elif request["kind"] == "move":
            response.update(move(obs))
        else:
            raise ValueError("Unsupported request kind")
        encoded = json.dumps(response, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
        if len(encoded.encode("utf-8")) + 1 > 16384:
            raise ValueError("Response exceeds protocol limit")
        print(encoded, flush=True)


if __name__ == "__main__":
    main()