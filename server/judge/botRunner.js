/**
 * botRunner.js — Chạy bot Python bằng process con riêng cho TỪNG request.
 *
 * CẢNH BÁO BẢO MẬT (đọc kỹ, không được hiểu sai):
 * - `spawn` + timeout + giới hạn output + thư mục tạm riêng KHÔNG phải là sandbox.
 * - `python -I -S -B` chỉ giảm ảnh hưởng của biến môi trường/import, KHÔNG chặn
 *   truy cập file, mạng, CPU/RAM hay process con.
 * - Vì vậy chế độ MVP chỉ dành cho bot của thành viên nhóm được tin tưởng, chạy trên
 *   máy thử nghiệm/VM riêng, API chỉ bind 127.0.0.1. KHÔNG được mở upload công khai.
 *
 * Giao thức: 1 dòng JSON UTF-8 vào stdin, 1 dòng JSON UTF-8 ra stdout, bot stateless.
 */

import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, statSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import config from '../config.js';

export const BOT_ERROR_CODES = {
  BAD_PATH: 'bad_path',
  SPAWN_ERROR: 'spawn_error',
  INPUT_TOO_LARGE: 'input_too_large',
  TIMEOUT: 'timeout',
  NONZERO_EXIT: 'nonzero_exit',
  OUTPUT_LIMIT: 'output_limit',
  BAD_JSON: 'bad_json',
  NO_PYTHON: 'no_python',
};

/** Môi trường tối thiểu: đủ để Python khởi động, KHÔNG chứa secret của server. */
const ENV_ALLOWLIST = [
  'PATH',
  'PATHEXT',
  'SystemRoot',
  'SystemDrive',
  'windir',
  'ComSpec',
  'TEMP',
  'TMP',
  'HOME',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'PROGRAMFILES',
  'OS',
  'NUMBER_OF_PROCESSORS',
  'PROCESSOR_ARCHITECTURE',
];

function buildChildEnv() {
  const env = {};
  for (const key of ENV_ALLOWLIST) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  // Bắt buộc UTF-8 để khớp giao thức JSON Lines.
  env.PYTHONIOENCODING = 'utf-8';
  env.PYTHONUTF8 = '1';
  env.PYTHONDONTWRITEBYTECODE = '1';
  return env;
}

function fail(errorCode, message) {
  return { ok: false, errorCode, message };
}

/**
 * Kiểm tra file bot nằm trong thư mục submissions (chống path traversal/symlink).
 * Client không bao giờ quyết định tên file; server tự sinh `<uuid>.py`.
 */
export function resolveBotPath(filePath, allowedRoot = config.submissionsDir) {
  if (typeof filePath !== 'string' || filePath.length === 0) {
    throw new Error('Đường dẫn bot rỗng');
  }
  if (path.extname(filePath).toLowerCase() !== '.py') {
    throw new Error('Bot phải là file .py');
  }

  const rootReal = realpathSync(allowedRoot);
  const linkStat = lstatSync(filePath);
  if (linkStat.isSymbolicLink()) {
    throw new Error('Không chấp nhận symlink cho file bot');
  }
  const fileReal = realpathSync(filePath);
  const relative = path.relative(rootReal, fileReal);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Đường dẫn bot nằm ngoài thư mục submissions');
  }
  const fileStat = statSync(fileReal);
  if (!fileStat.isFile()) {
    throw new Error('Bot phải là file thường');
  }
  if (fileStat.size > config.limits.maxSourceBytes) {
    throw new Error('File bot vượt quá giới hạn dung lượng');
  }
  return fileReal;
}

let cachedPython = null;

/** Dò Python một lần duy nhất: OOTV2_PYTHON_BIN -> python -> py -3 -> python3. */
export function resolvePython() {
  if (cachedPython !== null) return cachedPython;

  const candidates = [];
  if (config.pythonBin) candidates.push([config.pythonBin]);
  candidates.push(['python'], ['py', '-3'], ['python3']);

  for (const candidate of candidates) {
    const [cmd, ...args] = candidate;
    const probe = spawnSync(cmd, [...args, '--version'], {
      shell: false,
      stdio: 'ignore',
      windowsHide: true,
    });
    if (probe.status === 0) {
      cachedPython = { cmd, args };
      return cachedPython;
    }
  }

  cachedPython = null;
  return null;
}

export function resetPythonCache() {
  cachedPython = null;
}

function terminate(child) {
  try {
    if (process.platform === 'win32' && child.pid) {
      // Kill cả process tree; pid là số do OS cấp, không phải dữ liệu người dùng.
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      return;
    }
    child.kill('SIGKILL');
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      /* bỏ qua: process có thể đã thoát */
    }
  }
}

/** Parse stdout theo đúng giao thức: chính xác 1 dòng JSON object. */
export function parseSingleLineJson(stdout) {
  const trimmed = stdout.replace(/[\r\n\s]+$/u, '');
  if (trimmed.length === 0) {
    return { ok: false, errorCode: BOT_ERROR_CODES.BAD_JSON, message: 'stdout rỗng' };
  }
  if (trimmed.includes('\n') || trimmed.includes('\r')) {
    return {
      ok: false,
      errorCode: BOT_ERROR_CODES.BAD_JSON,
      message: 'stdout có nhiều hơn một dòng (không được print log ra stdout)',
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return {
      ok: false,
      errorCode: BOT_ERROR_CODES.BAD_JSON,
      message: 'stdout không phải JSON hợp lệ',
    };
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      ok: false,
      errorCode: BOT_ERROR_CODES.BAD_JSON,
      message: 'Response phải là một JSON object',
    };
  }

  return { ok: true, response: parsed };
}

/**
 * Chạy một request bot.
 * @param {{ filePath: string, payload: object, timeoutMs: number, allowedRoot?: string }} options
 * @returns {Promise<{ ok: true, response: object } | { ok: false, errorCode: string, message: string }>}
 */
export async function runBotRequest({ filePath, payload, timeoutMs, allowedRoot }) {
  let resolvedPath;
  try {
    resolvedPath = resolveBotPath(filePath, allowedRoot);
  } catch (error) {
    return fail(BOT_ERROR_CODES.BAD_PATH, error.message);
  }

  let input;
  try {
    input = Buffer.from(`${JSON.stringify(payload)}\n`, 'utf8');
  } catch (error) {
    return fail(BOT_ERROR_CODES.BAD_JSON, `Không serialize được payload: ${error.message}`);
  }
  if (input.length > config.limits.maxInputBytes) {
    return fail(BOT_ERROR_CODES.INPUT_TOO_LARGE, 'Payload vượt quá giới hạn 64 KiB');
  }

  const python = resolvePython();
  if (!python) {
    return fail(
      BOT_ERROR_CODES.NO_PYTHON,
      'Không tìm thấy Python 3 trên máy. Cài Python 3.12+ hoặc đặt OOTV2_PYTHON_BIN.'
    );
  }

  let workDir;
  try {
    workDir = mkdtempSync(path.join(tmpdir(), 'ootv2-bot-'));
  } catch (error) {
    return fail(BOT_ERROR_CODES.SPAWN_ERROR, `Không tạo được thư mục tạm: ${error.message}`);
  }

  const effectiveTimeout = Number(timeoutMs) > 0 ? Number(timeoutMs) : config.limits.moveTimeoutMs;

  return new Promise((resolve) => {
    let child;
    let settled = false;
    let stdoutChunks = [];
    let stderrChunks = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timer = null;

    const cleanup = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      try {
        rmSync(workDir, { recursive: true, force: true });
      } catch {
        /* dọn dẹp best-effort */
      }
    };

    const finish = (result) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    const killAndFail = (errorCode, message) => {
      terminate(child);
      finish(fail(errorCode, message));
    };

    try {
      child = spawn(
        python.cmd,
        [...python.args, '-I', '-S', '-B', resolvedPath],
        {
          cwd: workDir,
          shell: false,
          windowsHide: true,
          env: buildChildEnv(),
          stdio: ['pipe', 'pipe', 'pipe'],
        }
      );
    } catch (error) {
      finish(fail(BOT_ERROR_CODES.SPAWN_ERROR, `Không spawn được Python: ${error.message}`));
      return;
    }

    child.on('error', (error) => {
      finish(fail(BOT_ERROR_CODES.SPAWN_ERROR, `Lỗi process bot: ${error.message}`));
    });

    child.stdout.on('data', (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > config.limits.maxOutputBytes) {
        killAndFail(BOT_ERROR_CODES.OUTPUT_LIMIT, 'Bot ghi quá nhiều ra stdout');
        return;
      }
      stdoutChunks.push(chunk);
    });

    child.stderr.on('data', (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes > config.limits.maxOutputBytes) {
        child.stderr.destroy();
        return;
      }
      stderrChunks.push(chunk);
    });

    child.on('close', (code) => {
      const stdout = Buffer.concat(stdoutChunks).toString('utf8');

      if (code !== 0) {
        const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
        finish(
          fail(
            BOT_ERROR_CODES.NONZERO_EXIT,
            `Bot thoát với mã ${code}${stderr ? `: ${stderr.slice(0, 400)}` : ''}`
          )
        );
        return;
      }

      const parsed = parseSingleLineJson(stdout);
      finish(parsed);
    });

    timer = setTimeout(() => {
      killAndFail(BOT_ERROR_CODES.TIMEOUT, `Bot vượt quá thời gian ${effectiveTimeout}ms`);
    }, effectiveTimeout);

    child.stdin.on('error', () => {
      /* bot có thể thoát trước khi đọc hết stdin; lỗi thật sẽ đến từ 'close' */
    });
    child.stdin.end(input);
  });
}

export default { runBotRequest };
