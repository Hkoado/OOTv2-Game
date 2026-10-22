#!/usr/bin/env node
/**
 * live-demo.js — Tạo giải demo 8 đội với bot "chậm" để khán giả xem trực tiếp.
 *
 * - Không tạo project mới, dùng đúng service của server (participants/tournaments).
 * - Mỗi đội là 1 source Python sinh tại chỗ (stdlib), delay 0.26–0.33 s/nước và
 *   in log ra stderr để kiểm tra luồng L2 (log chỉ đội sở hữu + admin xem được).
 * - Sau khi tạo xong, chạy worker (`npm run dev:worker`) để các ván bắt đầu.
 *
 * Chạy: `npm run demo:live` (thêm `--force` nếu muốn tạo khi đang có giải chạy).
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { getDb, initDb } from '../../server/db.js';
import { createParticipant, createSubmission } from '../../server/services/participants.js';
import { createTournament, getTournament, startTournament } from '../../server/services/tournaments.js';

const TEAM_NAMES = [
  'Sao Băng',
  'Cơn Lốc',
  'Hải Đăng',
  'Mộc Miên',
  'Bình Minh',
  'Tia Chớp',
  'Cỏ May',
  'Vầng Trăng',
];

/** Source bot demo: đọc 1 JSON line, in 1 JSON line; log ra stderr để xem ở L2. */
function botSource({ team, delay, pickLast }) {
  return `"""Bot demo cho giải trực tiếp — sinh tự động, chỉ dùng thư viện chuẩn."""

import json
import sys
import time

TEAM = ${JSON.stringify(team)}
DELAY = ${delay}
PICK_LAST = ${pickLast ? 'True' : 'False'}


def log(message):
    print("[" + TEAM + "] " + message, file=sys.stderr, flush=True)


def on_setup(request):
    pieces = request["my_pieces"]
    squares = request["available_squares"]
    if len(pieces) != 9 or len(squares) < 9:
        raise ValueError("Unexpected setup request")
    placements = []
    for index, piece in enumerate(pieces):
        placements.append({"piece_id": piece["id"], "square": squares[index]})
    log("xep quan xong: " + str(len(placements)) + " quan")
    time.sleep(DELAY)
    return {"placements": placements}


def on_move(request):
    moves = request["legal_moves"]
    if not moves:
        raise ValueError("No legal moves available")
    move = moves[-1] if PICK_LAST else moves[0]
    log(
        "nuoc " + str(request.get("turn_number"))
        + ": " + str(move.get("piece_id")) + " -> " + str(move.get("to"))
    )
    time.sleep(DELAY)
    return move


def main():
    line = sys.stdin.readline()
    if not line:
        raise ValueError("No input provided")
    request = json.loads(line)
    if request.get("protocol_version") != 1:
        raise ValueError("Unsupported protocol version")
    kind = request.get("request")
    if kind == "setup":
        response = on_setup(request)
    elif kind == "move":
        response = on_move(request)
    else:
        raise ValueError("Unsupported request: " + str(kind))
    sys.stdout.write(json.dumps(response, ensure_ascii=False) + "\\n")
    sys.stdout.flush()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print("Bot failed: " + str(error), file=sys.stderr)
        sys.exit(1)
`;
}

function runningTournament() {
  return (
    getDb()
      .prepare(
        `SELECT id, name, status FROM tournaments
         WHERE status IN ('group_running','semifinal_running','final_running')
         ORDER BY started_at DESC LIMIT 1`
      )
      .get() || null
  );
}

async function main() {
  const force = process.argv.includes('--force');
  initDb();

  const running = runningTournament();
  if (running && !force) {
    console.error(
      `Đang có giải "${running.name}" ở trạng thái ${running.status}.\n`
        + 'Worker chạy tuần tự nên hãy để giải đó kết thúc (hoặc dùng --force để tạo song song).'
    );
    process.exitCode = 1;
    return;
  }

  const stamp = new Date()
    .toISOString()
    .slice(11, 16)
    .replace(':', '');
  const workDir = mkdtempSync(path.join(tmpdir(), 'ootv2-live-demo-'));
  const participants = [];

  try {
    for (let index = 0; index < TEAM_NAMES.length; index += 1) {
      const team = TEAM_NAMES[index];
      const displayName = `${team} ${stamp}`;
      const participant = createParticipant(displayName);
      const source = botSource({
        team,
        delay: Number((1.05 + (index % 4) * 0.06).toFixed(2)),
        pickLast: index % 3 === 2,
      });
      const filePath = path.join(workDir, `team-${index}.py`);
      writeFileSync(filePath, source, 'utf8');

      const submission = await createSubmission(participant.id, {
        buffer: readFileSync(filePath),
        originalname: `team-${index}.py`,
      });
      if (submission.status !== 'valid') {
        throw new Error(`Bot demo của ${displayName} không hợp lệ: ${submission.validation_error}`);
      }
      participants.push({ participant, submission });
    }

    const tournament = createTournament({
      name: `Giải demo trực tiếp ${stamp}`,
      participantIds: participants.map(({ participant }) => participant.id),
    });
    startTournament(tournament.id);
    const detail = getTournament(tournament.id);

    console.log('');
    console.log(`[ok] Giải "${detail.name}" đã bắt đầu.`);
    console.log(`     Event id : ${detail.id}`);
    console.log(`     Thể thức : ${detail.match_counts.total} ván (vòng bảng → bán kết → chung kết)`);
    console.log('     Khán giả : http://127.0.0.1:3001/#/live');
    console.log('     Worker   : npm run dev:worker   (nếu worker chưa chạy)');
    console.log('     Mỗi ván  : ~20 giây (bot demo ngủ 1.05–1.23 s mỗi nước).');
    console.log('     Xem chậm : OOTV2_WORKER_PAUSE_MS=8000 npm run dev:worker  (nghỉ 8 s giữa hai ván)');
    console.log('');
    console.log('Dừng demo: Ctrl+C ở cửa sổ worker, dữ liệu vẫn nằm trong data/ootv2.sqlite.');
  } finally {
    try {
      rmSync(workDir, { recursive: true, force: true });
    } catch {
      /* thư mục tạm, để lại cũng không sao */
    }
  }
}

main().catch((error) => {
  console.error('[demo:live] lỗi:', error);
  process.exitCode = 1;
});

