/**
 * api/[...path].js — Entrypoint Vercel Function cho toàn bộ `/api/*`.
 *
 * Vì Vercel Functions có giới hạn thời gian và không có tiến trình nền:
 * - KHÔNG chạy worker, KHÔNG chạy Python, KHÔNG git clone trong function này.
 * - Worker chấm bài vẫn chạy trên máy BTC (`server/worker.js`) và ghi vào Supabase.
 * - Upload bot chỉ kiểm tra tĩnh; worker chấm thử rồi chuyển `uploaded` → `valid/invalid`.
 *
 * Vercel ưu tiên file trong `api/` trước rewrite SPA, nên `/api/health` vẫn vào đây.
 */

import { createApp } from '../server/app.js';

const app = createApp();

export default function handler(req, res) {
  return app(req, res);
}
