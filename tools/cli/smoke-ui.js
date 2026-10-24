#!/usr/bin/env node
/**
 * smoke-ui.js — Bắt lỗi runtime làm trang trắng (loại lỗi `vite build` không phát hiện được).
 *
 * Cách làm: mở app đã build bằng Chrome/Edge headless, đợi JS chạy, đọc DOM và kiểm tra
 * `#root` có nội dung + có đủ các chuỗi `--expect`. Không thêm dependency nào: chỉ dùng
 * Node chuẩn và trình duyệt có sẵn trên máy.
 *
 * Ví dụ:
 *   npm run smoke:ui
 *   npm run smoke:ui -- --url http://127.0.0.1:3001/#/live --expect live-page --expect live-board
 *
 * Mã thoát: 0 = render OK, 1 = trang trắng/không tải được/thiếu nội dung.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const DIST_INDEX = path.join(ROOT_DIR, 'dist', 'index.html');

const BROWSER_CANDIDATES = [
  process.env.OOTV2_BROWSER,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

const USAGE = `[smoke:ui] Cách dùng:
  npm run smoke:ui
  npm run smoke:ui -- --url http://127.0.0.1:3001/#/live --expect live-page --expect live-board

  --url <url>      Trang cần kiểm tra (mặc định OOTV2_SMOKE_URL hoặc http://127.0.0.1:3001/#/live)
  --expect <text>  Chuỗi phải có trong DOM sau khi render (dùng nhiều lần)
  --budget <ms>    Thời gian ảo cho JS chạy (mặc định 9000)
  OOTV2_BROWSER    Đường dẫn Chrome/Edge nếu máy không có ở vị trí mặc định`;

function parseArgs(argv) {
  const options = {
    url: process.env.OOTV2_SMOKE_URL || 'http://127.0.0.1:3001/#/live',
    expect: [],
    budget: 9000,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--url') options.url = argv[index += 1];
    else if (arg === '--expect') options.expect.push(argv[index += 1]);
    else if (arg === '--budget') options.budget = Number(argv[index += 1]) || options.budget;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`tham số không hợp lệ: ${arg}`);
  }
  return options;
}

function findBrowser() {
  for (const candidate of BROWSER_CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  for (const name of ['chrome', 'msedge', 'google-chrome', 'chromium']) {
    const lookup = spawnSync(process.platform === 'win32' ? 'where' : 'which', [name], { encoding: 'utf8' });
    const found = (lookup.stdout || '').split(/\r?\n/u).map((line) => line.trim()).find(Boolean);
    if (lookup.status === 0 && found) return found;
  }
  return null;
}

/** PowerShell single-quote an toàn (URL có `?`, `&` vẫn đúng). */
function psQuote(value) {
  return `'${String(value).replace(/'/gu, "''")}'`;
}

/**
 * Trình duyệt trên Windows là GUI app nên `spawnSync` thường trả về ngay khi launcher
 * thoát (stdout rỗng). Dùng `Start-Process -Wait` để chờ và ghi DOM ra file.
 */
function dumpDom(browser, args, outFile, errFile) {
  if (process.platform !== 'win32') {
    const result = spawnSync(browser, args, { encoding: 'utf8', timeout: 120000, maxBuffer: 64 * 1024 * 1024 });
    return { code: result.status, dom: result.stdout || '', stderr: result.stderr || '' };
  }
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$process = Start-Process -FilePath ${psQuote(browser)} -ArgumentList @(${args.map(psQuote).join(',')})`
      + ` -RedirectStandardOutput ${psQuote(outFile)} -RedirectStandardError ${psQuote(errFile)} -PassThru -Wait`,
    'exit $process.ExitCode',
  ].join('; ');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    timeout: 150000,
  });
  return {
    code: result.status,
    dom: existsSync(outFile) ? readFileSync(outFile, 'utf8') : '',
    stderr: existsSync(errFile) ? readFileSync(errFile, 'utf8') : (result.stderr || ''),
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(USAGE);
    return;
  }
  if (!existsSync(DIST_INDEX)) {
    console.error('[smoke:ui] ✗ chưa có dist/index.html — chạy `npm run build` trước.');
    process.exitCode = 1;
    return;
  }
  const browser = findBrowser();
  if (!browser) {
    console.error('[smoke:ui] ✗ không tìm thấy Chrome/Edge. Đặt OOTV2_BROWSER=<đường dẫn trình duyệt>.');
    process.exitCode = 1;
    return;
  }

  const profile = mkdtempSync(path.join(tmpdir(), 'ootv2-smoke-'));
  const outFile = path.join(profile, 'dom.html');
  const errFile = path.join(profile, 'browser.log');
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-extensions',
    '--no-first-run',
    `--user-data-dir=${path.join(profile, 'profile')}`,
    `--virtual-time-budget=${options.budget}`,
    '--dump-dom',
    options.url,
  ];

  let result;
  try {
    result = dumpDom(browser, args, outFile, errFile);
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }

  const dom = result.dom || '';
  if (!dom.includes('id="root"')) {
    const tail = (result.stderr || '').split(/\r?\n/u).filter(Boolean).slice(-3).join(' | ');
    console.error(
      `[smoke:ui] ✗ không tải được ${options.url} (exit=${result.code}). API/web đã chạy chưa? (\`npm start\`)`
        + (tail ? ` — ${tail}` : '')
    );
    process.exitCode = 1;
    return;
  }
  if (/<div id="root">\s*<\/div>/u.test(dom)) {
    console.error(
      '[smoke:ui] ✗ React không mount: `#root` rỗng (trang trắng). '
        + 'Mở DevTools Console để xem lỗi; thường là `ReferenceError` ở phạm vi module.'
    );
    process.exitCode = 1;
    return;
  }
  const missing = options.expect.filter((needle) => !dom.includes(needle));
  if (missing.length > 0) {
    console.error(`[smoke:ui] ✗ DOM thiếu: ${missing.map((item) => `"${item}"`).join(', ')}`);
    process.exitCode = 1;
    return;
  }

  const shown = options.expect.length > 0 ? ` · có ${options.expect.join(', ')}` : '';
  console.log(`[smoke:ui] ✓ ${options.url} render OK (DOM ${dom.length} byte${shown}) · ${path.basename(browser)}`);
}

try {
  main();
} catch (error) {
  console.error(`[smoke:ui] ✗ ${error.message}\n\n${USAGE}`);
  process.exitCode = 1;
}
