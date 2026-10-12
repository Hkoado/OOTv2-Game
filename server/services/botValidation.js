/**
 * botValidation.js — Kiểm tra file bot: kích thước, UTF-8, cú pháp Python (stdlib)
 * và smoke test giao thức setup/setup/move bằng chính match adapter.
 *
 * Lưu ý: smoke test chỉ bắt lỗi sớm; match runner vẫn validate từng lượt.
 */

import { readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

import config from '../config.js';
import { runBotRequest, resolvePython, BOT_ERROR_CODES } from '../judge/botRunner.js';
import {
  PLAYERS,
  createTournamentGame,
  buildSetupRequest,
  validatePlacements,
  applySetup,
  buildMoveRequest,
  applyValidatedMove,
} from '../judge/gameAdapter.js';

const SMOKE_SEED = 20260101;

/** Kiểm tra cú pháp Python bằng `ast.parse` (chỉ stdlib, không cài package). */
export function checkPythonSyntax(filePath) {
  const python = resolvePython();
  if (!python) {
    return { ok: false, error: 'no_python', message: 'Không tìm thấy Python 3 để kiểm tra cú pháp' };
  }
  const code =
    'import ast, sys; '
    + 'src = open(sys.argv[1], encoding="utf-8").read(); '
    + 'ast.parse(src, filename="bot.py")';

  const result = spawnSync(python.cmd, [...python.args, '-I', '-S', '-B', '-c', code, filePath], {
    shell: false,
    windowsHide: true,
    encoding: 'utf8',
    timeout: 5000,
  });

  if (result.error) {
    return { ok: false, error: 'syntax_check_failed', message: result.error.message };
  }
  if (result.status !== 0) {
    const stderr = String(result.stderr || '').trim().split('\n').slice(-3).join(' ');
    return { ok: false, error: 'syntax_error', message: stderr.slice(0, 300) || 'Lỗi cú pháp Python' };
  }
  return { ok: true };
}

/** Kiểm tra file là text UTF-8 hợp lệ (không NUL byte), trong giới hạn 64 KiB. */
export function checkSourceFile(filePath) {
  const stat = statSync(filePath);
  if (!stat.isFile()) {
    return { ok: false, error: 'not_a_file', message: 'Không phải file thường' };
  }
  if (stat.size === 0) {
    return { ok: false, error: 'empty_file', message: 'File rỗng' };
  }
  if (stat.size > config.limits.maxSourceBytes) {
    return {
      ok: false,
      error: 'file_too_large',
      message: `File vượt quá ${config.limits.maxSourceBytes} bytes`,
    };
  }

  const raw = readFileSync(filePath);
  if (raw.includes(0)) {
    return { ok: false, error: 'binary_file', message: 'File chứa NUL byte, không phải text .py' };
  }

  let text;
  try {
    text = raw.toString('utf8');
  } catch {
    return { ok: false, error: 'bad_encoding', message: 'File không đọc được dạng UTF-8' };
  }
  if (text.includes('\uFFFD')) {
    return { ok: false, error: 'bad_encoding', message: 'File không phải UTF-8 hợp lệ' };
  }
  return { ok: true, source: text };
}

/**
 * Smoke test: gọi bot cho `setup red`, `setup blue` (bot thấy đội hình Red) và 1 nước đi.
 * Bot phải đóng đúng vai được yêu cầu; không bao giờ ném exception ra ngoài.
 */
export async function runProtocolSmokeTest(filePath) {
  try {
    let state = createTournamentGame('smoke');

    const redLive = await runBotRequest({
      filePath,
      payload: buildSetupRequest(state, PLAYERS.RED, SMOKE_SEED),
      timeoutMs: config.limits.setupTimeoutMs,
    });
    if (!redLive.ok) {
      return { ok: false, error: `setup_red_${redLive.errorCode}`, message: redLive.message };
    }
    const redCheck = validatePlacements(PLAYERS.RED, redLive.response.placements);
    if (!redCheck.ok) {
      return { ok: false, error: `setup_red_${redCheck.error}`, message: redCheck.message };
    }
    state = applySetup(state, PLAYERS.RED, redCheck.byId);

    const blueLive = await runBotRequest({
      filePath,
      payload: buildSetupRequest(state, PLAYERS.BLUE, SMOKE_SEED),
      timeoutMs: config.limits.setupTimeoutMs,
    });
    if (!blueLive.ok) {
      return { ok: false, error: `setup_blue_${blueLive.errorCode}`, message: blueLive.message };
    }
    const blueCheck = validatePlacements(PLAYERS.BLUE, blueLive.response.placements);
    if (!blueCheck.ok) {
      return { ok: false, error: `setup_blue_${blueCheck.error}`, message: blueCheck.message };
    }
    state = applySetup(state, PLAYERS.BLUE, blueCheck.byId);

    const moveLive = await runBotRequest({
      filePath,
      payload: buildMoveRequest(state, PLAYERS.RED, SMOKE_SEED, 1),
      timeoutMs: config.limits.moveTimeoutMs,
    });
    if (!moveLive.ok) {
      return { ok: false, error: `move_${moveLive.errorCode}`, message: moveLive.message };
    }
    try {
      applyValidatedMove(state, PLAYERS.RED, moveLive.response);
    } catch (error) {
      return { ok: false, error: 'move_illegal', message: error.message };
    }

    return { ok: true };
  } catch (error) {
    return { ok: false, error: 'smoke_test_failed', message: error.message };
  }
}

/** Toàn bộ pipeline validation; trả về `{ ok, error, message }`. */
export async function validateBotFile(filePath) {
  const source = checkSourceFile(filePath);
  if (!source.ok) return source;

  const syntax = checkPythonSyntax(filePath);
  if (!syntax.ok) return syntax;

  const smoke = await runProtocolSmokeTest(filePath);
  if (!smoke.ok) return smoke;

  return { ok: true };
}

export { BOT_ERROR_CODES };
export default { validateBotFile };
