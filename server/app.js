/**
 * app.js — Tạo Express app cho API tournament (tách khỏi `index.js` để test được
 * bằng cách import app mà không cần mở cổng mạng).
 *
 * Toàn bộ dữ liệu đi qua Supabase (`shared/*`); không còn driver SQLite dự phòng.
 * API chỉ bind loopback và không phục vụ thư mục dữ liệu riêng (`data/`).
 */

import fs from 'node:fs';
import path from 'node:path';
import express from 'express';

import config, { ROOT_DIR } from './config.js';
import { badRequest, sendError } from './lib/httpError.js';
import { liveRouter } from './routes/live.js';
import { health } from './shared/client.js';
import { sharedRouter } from './shared/router.js';
import { requireSession, requireLocalAdmin } from './shared/accounts.js';
import { assertProductionSafety } from './lib/productionSafety.js';

/** Nội dung `examples/sample_bot.py` cho UI hướng dẫn (không phải input của bot). */
function readSampleBot() {
  const samplePath = path.join(ROOT_DIR, 'examples', 'sample_bot.py');
  return fs.readFileSync(samplePath, 'utf8');
}
export function createApp({ checkHealth = health, sessionGuard = requireSession, adminGuard = requireLocalAdmin } = {}) {
  assertProductionSafety();
  const app = express();

  app.disable('x-powered-by');
  // Reverse proxy cùng máy (Caddy/Nginx) gửi `X-Forwarded-For`/`X-Forwarded-Proto`:
  // cần biết IP thật cho rate limit và biết request là HTTPS để đặt cookie `Secure`.
  app.set('trust proxy', config.trustProxy);
  // Header an toàn tối thiểu cho cả web tĩnh và API (không cần CSP ở MVP).
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.set('X-Frame-Options', 'SAMEORIGIN');
    if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
    if (req.secure) res.set('Strict-Transport-Security', 'max-age=31536000');
    next();
  });
  app.use(express.json({ limit: '64kb' }));

  app.get('/api/health', (req, res) => {
    res.json({ ok: true, service: 'ootv2-tournament-api' });
  });
  // Liveness is public and cheap; DB readiness is admin-only and does not attest workers.
  app.get('/api/ready', sessionGuard, adminGuard, async (req, res) => {
    try {
      await checkHealth();
      res.json({ ok: true, database: 'ready', workerReadiness: 'not_checked' });
    } catch {
      res.status(503).json({ ok: false, error: 'database_unavailable' });
    }
  });

  // Công khai, ẩn danh: chỉ dữ liệu L1 (bàn cờ + nước đi), có rate limit riêng.
  app.use('/api/live', liveRouter());

  app.get('/api/sample-bot', (req, res) => {
    try {
      res.type('text/plain').send(readSampleBot());
    } catch {
      // Serverless bundle không kèm examples/: không làm sập API.
      res.status(503).json({ error: 'sample_unavailable', message: 'Không đọc được bot mẫu trên môi trường này.' });
    }
  });

  app.use('/api/local', sharedRouter());

  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'endpoint_not_found', message: 'Endpoint không tồn tại' });
  });

  // --- Web tĩnh cùng origin với API (chế độ triển khai qua Cloudflare Tunnel) ---
  // `dist/` do Vite build; chỉ phục vụ đúng thư mục này, không đụng `data/`, `src/`,
  // và không bao giờ "nuốt" request `/api/*`.
  // Trên Vercel, `dist/` do CDN phục vụ nên function không đọc đĩa.
  const isServerless = Boolean(process.env.VERCEL);
  const indexHtml = path.join(config.distDir, 'index.html');
  if (!isServerless && config.serveDist && fs.existsSync(indexHtml)) {
    app.use(
      express.static(config.distDir, {
        index: false,
        dotfiles: 'ignore',
        etag: true,
        setHeaders(res, filePath) {
          const normalized = filePath.replace(/\\/gu, '/');
          if (normalized.endsWith('/index.html')) {
            res.setHeader('Cache-Control', 'no-store');
          } else if (normalized.includes('/assets/')) {
            // Vite sinh tên file có hash → cache dài hạn an toàn.
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          } else {
            res.setHeader('Cache-Control', 'public, max-age=3600');
          }
        },
      })
    );

    // SPA fallback: chỉ trả index.html cho điều hướng HTML (hash route dùng chung file).
    app.use((req, res, next) => {
      if (!['GET', 'HEAD'].includes(req.method)) return next();
      const accept = req.get('accept') || '';
      if (!accept.includes('text/html')) return next();
      res.setHeader('Cache-Control', 'no-store');
      res.sendFile(indexHtml);
    });
  }

  // Error middleware chung: format `{error, message}`, không lộ stack hay path máy chủ.
  app.use((error, req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    if (error?.type === 'entity.parse.failed') {
      sendError(res, badRequest('bad_json', 'Body JSON không hợp lệ'));
      return;
    }
    if (error?.type === 'entity.too.large') {
      sendError(res, badRequest('body_too_large', 'Body JSON quá lớn (giới hạn 64 KiB)'));
      return;
    }
    sendError(res, error);
  });

  return app;
}

export default createApp;
