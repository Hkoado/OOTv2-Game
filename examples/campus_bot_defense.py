"""OOTv2 Campus v2 — bot.v1 "thế thủ" (Python 3.12+, chỉ thư viện chuẩn).

Một tiến trình sống suốt ván: đọc 1 dòng JSON trên stdin, ghi đúng 1 dòng JSON ra stdout.
Bot tự xếp đủ 9 quân trong setup kín và tự chọn mọi nước đi; server vẫn là trọng tài cuối
nên mọi điểm số dưới đây chỉ là ước lượng, không thay luật và không tự tuyên bố thắng.

Ý tưởng: giữ đội hình quanh nhà chính của mình thành một vòng chắn, chỉ ra ngoài khi ăn
được quân địch (nhất là quân đang uy hiếp nhà), tránh đứng trong tầm ăn của quân khắc mình
và tránh dao động hai nước. Không dùng random nên ván tái lập được.

File này KHÔNG phải sandbox: chỉ dùng cho trusted-dev/drill, không nhận bài công khai.
"""

import json
import sys

PROTOCOL_VERSION = "bot.v1"
RESPONSE_LIMIT = 16384
REQUEST_LIMIT = 65536
# Nhà chính của mình và của đối phương, tính theo màu bot đang cầm.
OWN_BASE = {"red": "a1", "blue": "i9"}
ENEMY_BASE = {"red": "i9", "blue": "a1"}
BEATS = {"rock": "scissors", "scissors": "paper", "paper": "rock"}
# Bán kính giữ nhà: quân thủ chỉ rời vùng này khi thật cần.
GUARD_RADIUS = 3


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
    """Ghép 9 quân thành khối gần nhà chính của mình, không chiếm ô nhà chính.

    Ô nhà chính bị loại khỏi lựa chọn vì đứng trên đó chỉ tạo mục tiêu cho đối phương.
    Mỗi loại quân có tập ô riêng theo địa hình nên dùng ghép cặp có ưu tiên.
    """
    pieces = obs["unplaced"]
    by_type = obs.get("availableSquaresByType") or {}
    home = OWN_BASE[obs["you"]]
    enemy_base = ENEMY_BASE[obs["you"]]
    candidates = {}
    for piece in pieces:
        pool = by_type.get(piece["type"]) or obs["availableSquares"]
        pool = [square for square in pool if square != home]
        candidates[piece["id"]] = sorted(
            pool, key=lambda square: (square_distance(square, home),
                                      -square_distance(square, enemy_base), square))

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


class DefenseBot:
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
        home, enemy_base = OWN_BASE[you], ENEMY_BASE[you]
        best = None
        for candidate in legal:
            score = self.score_move(mine[candidate["pieceId"]], candidate["to"],
                                    enemy, home, enemy_base)
            key = (-score, candidate["pieceId"], candidate["to"])
            if best is None or key < best[0]:
                best = (key, candidate)
        chosen = best[1]
        self.left_square[chosen["pieceId"]] = mine[chosen["pieceId"]]["square"]
        return chosen

    def score_move(self, piece, destination, enemy, home, enemy_base):
        occupied = {other["square"]: other for other in enemy}
        score = 0
        victim = occupied.get(destination)
        if victim is not None:
            score += 130
            # Ăn quân đang áp sát nhà mình có giá trị cao hơn.
            score += max(0, 40 - 5 * square_distance(victim["square"], home))
        after_home = square_distance(destination, home)
        if after_home > GUARD_RADIUS:
            score -= (after_home - GUARD_RADIUS) * 12
        elif after_home <= 2:
            score += 8
        # Tiến chậm về phía đối phương để không đứng yên vô hạn.
        score += (square_distance(piece["square"], enemy_base)
                  - square_distance(destination, enemy_base)) * 3
        if destination == enemy_base:
            score += 1000
        score -= 20 * self.threats(enemy, destination, piece["type"])
        if self.left_square.get(piece["id"]) == destination:
            score -= 28
        return score

    @staticmethod
    def threats(enemy, square, my_type):
        """Số quân địch đứng cạnh ô đích có thể ăn quân loại `my_type` (ước lượng)."""
        return sum(1 for other in enemy
                   if BEATS[other["type"]] == my_type
                   and square_distance(other["square"], square) == 1)


def main():
    bot = DefenseBot()
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
        print(f"defense bot failed: {error}", file=sys.stderr)
        sys.exit(1)
