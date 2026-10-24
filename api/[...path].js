/**
 * api/[...path].js — Entrypoint Vercel Function cho toàn bộ `/api/*`.
 *
 * Vì Vercel Functions có giới hạn thời gian và không có tiến trình nền:
 * - KHÔNG chạy worker, KHÔNG chạy Python, KHÔNG git clone trong function này.
 * - Worker Campus chạy trên VM riêng (`server/officialWorker.js`), không dùng runner MVP.
 * - Online nộp GitHub; intake syntax validation không đồng nghĩa sandbox acceptance.
 *
 * Vercel ưu tiên file trong `api/` trước rewrite SPA, nên `/api/health` vẫn vào đây.
 *
 * Giới hạn đã kiểm chứng trên Vercel: file `[...path].js` chỉ match **một** segment
 * (`/api/health`), còn `/api/local/login` trả 404 của Vercel. Vì vậy `vercel.json`
 * rewrite path sâu hơn về function `/api` (`api/index.js`) kèm tham số nội bộ; cả hai
 * entrypoint đều dựng lại URL gốc bằng `restoreApiUrl` trước khi vào Express.
 */

import { createApp } from '../server/app.js';
import { restoreApiUrl } from '../server/lib/vercelPath.js';

const app = createApp();

export default function handler(req, res) {
  req.url = restoreApiUrl(req.url);
  if (req.url && !req.url.startsWith('/api')) {
    req.url = '/api' + (req.url.startsWith('/') ? req.url : '/' + req.url);
  }
  return app(req, res);
}
