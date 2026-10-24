"""OOTv2 Campus v2 — bot.v1 "thế công" (Python 3.12+, chỉ thư viện chuẩn).

Một tiến trình sống suốt ván: đọc 1 dòng JSON trên stdin, ghi đúng 1 dòng JSON ra stdout.
Bot tự xếp đủ 9 quân trong setup kín và tự chọn mọi nước đi; server vẫn là trọng tài cuối
nên mọi điểm số dưới đây chỉ là ước lượng, không thay luật và không tự tuyên bố thắng.

Ý tưởng: dồn quân về phía nhà chính đối phương, ưu tiên ăn quân, tránh đứng trong tầm ăn
của quân khắc mình và tránh dao động hai nước. Không dùng random nên ván tái lập được.

File này KHÔNG phải sandbox: chỉ dùng cho trusted-dev/drill, không nhận bài công khai.
"""

import json
import sys

PROTOCOL_VERSION = "bot.v1"
RESPONSE_LIMIT = 16384
REQUEST_LIMIT = 65536
# Nhà chính cần chiếm, tính theo màu bot đang cầm.
ENEMY_BASE = {"red": "i9", "blue": "a1"}
# Búa ăn Kéo, Kéo ăn Bao, Bao ăn Búa.
BEATS = {"rock": "scissors", "scissors": "paper", "paper": "rock"}


def square_distance(first, second):
    """Khoảng cách Chebyshev, đúng bằng số bước đi tối thiểu trên bàn 9x9."""
    return max(abs(int(first[1]) - int(second[1])), abs(ord(first[0]) - ord(second[0])))


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON key")
        result[key] = value
    return result


def reject_constant(value):
    raise ValueError("Non-finite JSON number: " + value)


def plan_setup(obs):
    """Ghép 9 quân vào 9 ô hợp lệ, ưu tiên ô gần nhà chính đối phương.

    Mỗi loại quân có tập ô riêng do địa hình chặn (availableSquaresByType), nên dùng
    ghép cặp có ưu tiên (thuật toán tăng đường) để không kẹt ô khi ưu tiên trùng nhau.
    """
    pieces = obs["unplaced"]
    by_type = obs.get("availableSquaresByType") or {}
    target = ENEMY_BASE[obs["you"]]
    candidates = {}
    for piece in pieces:
        pool = by_type.get(piece["type"]) or obs["availableSquares"]
        candidates[piece["id"]] = sorted(
            pool, key=lambda square: (square_distance(square, target), square))

    owner = {}  # square -> piece_id

    def place(piece_id, visited):
        for square in candidates[piece_id]:
            if square in visited:
                continue
            visited.add(square)
            occupant = owner.get(square)
            if occupant is None or place(occupant, visited):
                owner[square] = piece_id
                return True
        return False

    for piece in pieces:
        if not place(piece["id"], set()):
            raise ValueError("No legal setup square for every piece")
    by_piece = {piece_id: square for square, piece_id in owner.items()}
    return [{"pieceId": piece["id"], "square": by_piece[piece["id"]]} for piece in pieces]


class AttackBot:
    def __init__(self):
        self.left_square = {}  # piece_id -> ô vừa rời, dùng để phạt việc quay lại ngay

    def choose_move(self, obs):
        legal = obs["legalMoves"]
        if not legal:
            # Engine phải kết thúc bằng NO_LEGAL_MOVE trước khi gọi bot.
            raise ValueError("No legal move available")
        you = obs["you"]
        mine = {piece["id"]: piece for piece in obs["pieces"] if piece["player"] == you}
        enemy = [piece for piece in obs["pieces"] if piece["player"] != you]
        target = ENEMY_BASE[you]
        best = None
        for candidate in legal:
            score = self.score_move(mine[candidate["pieceId"]], candidate["to"], enemy, target)
            key = (-score, candidate["pieceId"], candidate["to"])
            if best is None or key < best[0]:
                best = (key, candidate)
        chosen = best[1]
        self.left_square[chosen["pieceId"]] = mine[chosen["pieceId"]]["square"]
        return chosen

    def score_move(self, piece, destination, enemy, target):
        occupied = {other["square"]: other for other in enemy}
        score = 0
        victim = occupied.get(destination)
        if victim is not None:
            score += 120
            if victim["type"] == "scissors":
                score += 15
        # Ưu tiên giảm khoảng cách tới nhà chính đối phương.
        score += (square_distance(piece["square"], target)
                  - square_distance(destination, target)) * 14
        if destination == target:
            score += 1000
        score -= 18 * self.threats(enemy, destination, piece["type"])
        if self.left_square.get(piece["id"]) == destination:
            score -= 30
        return score

    @staticmethod
    def threats(enemy, square, my_type):
        """Số quân địch đứng cạnh ô đích có thể ăn quân loại `my_type` (ước lượng)."""
        return sum(1 for other in enemy
                   if BEATS[other["type"]] == my_type
                   and square_distance(other["square"], square) == 1)


def main():
    bot = AttackBot()
    while True:
        line = sys.stdin.buffer.readline(REQUEST_LIMIT + 1)
        if not line:
            return
        if len(line) > REQUEST_LIMIT or not line.endswith(b"\n"):
            raise ValueError("Request line exceeds bot.v1 limit")
        request = json.loads(line.decode("utf-8"), object_pairs_hook=unique_object,
                             parse_constant=reject_constant)
        if request.get("protocolVersion") != PROTOCOL_VERSION:
            raise ValueError("Unsupported protocol version")
        obs = request["game"]
        response = {"protocolVersion": PROTOCOL_VERSION, "requestId": request["requestId"],
                    "kind": request["kind"]}
        if request["kind"] == "setup":
            response["placements"] = plan_setup(obs)
        elif request["kind"] == "move":
            chosen = bot.choose_move(obs)
            response["pieceId"] = chosen["pieceId"]
            response["to"] = chosen["to"]
        else:
            raise ValueError("Unsupported request kind")
        encoded = json.dumps(response, ensure_ascii=False, allow_nan=False,
                             separators=(",", ":")).encode("utf-8") + b"\n"
        if len(encoded) > RESPONSE_LIMIT:
            raise ValueError("Response exceeds bot.v1 limit")
        sys.stdout.buffer.write(encoded)
        sys.stdout.buffer.flush()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:  # stderr chỉ để chẩn đoán, stdout giữ riêng cho protocol.
        print(f"attack bot failed: {error}", file=sys.stderr)
        sys.exit(1)

