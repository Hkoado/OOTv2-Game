/**
 * worker.js — Entry worker chấm bài. Toàn bộ dữ liệu ở Supabase; không còn chế độ
 * SQLite. Logic chấm nằm trong `shared/worker.js` (claim + lease + heartbeat).
 *
 * Chạy: `npm run dev:worker`, `npm run worker:once`, `npm run worker:drain`.
 */

import { pathToFileURL } from 'node:url';

import { assertSharedConfig } from './shared/client.js';
import { runSharedWorker } from './shared/worker.js';

export async function runWorker({ once = false, drain = false } = {}) {
  // Thiếu SUPABASE_* thì dừng ngay: không tự chuyển sang DB khác.
  assertSharedConfig();
  return runSharedWorker({ once, drain });
}

const isEntryPoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntryPoint) {
  runWorker({
    once: process.argv.includes('--once'),
    drain: process.argv.includes('--drain'),
  }).catch((error) => {
    console.error('[worker] lỗi nghiêm trọng:', error);
    process.exitCode = 1;
  });
}

export default { runWorker };
