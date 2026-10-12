/**
 * app.js — Tạo Express app cho API tournament (tách khỏi `index.js` để test được
 * bằng cách import app mà không cần mở cổng mạng).
 *
 * Bảo mật MVP: chỉ bind loopback, chỉ phục vụ API + file bot mẫu; không phục vụ
 * thư mục `data/` (DB và bot upload của người dùng).
 */

import fs from 'node:fs';
import path from 'node:path';
import express from 'express';

import { ROOT_DIR } from './config.js';
import { badRequest, sendError } from './lib/httpError.js';
import participantsRouter from './routes/participants.js';
import tournamentsRouter from './routes/tournaments.js';
import matchesRouter from './routes/matches.js';

/** Nội dung `examples/sample_bot.py` cho UI hướng dẫn (không phải input của bot). */
function readSampleBot() {
  const samplePath = path.join(ROOT_DIR, 'examples', 'sample_bot.py');
  return fs.readFileSync(samplePath, 'utf8');
}

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '64kb' }));

  app.get('/api/health', (req, res) => {
    res.json({ ok: true, service: 'ootv2-tournament-api' });
  });

  app.get('/api/sample-bot', (req, res) => {
    res.type('text/plain').send(readSampleBot());
  });

  app.use('/api/participants', participantsRouter);
  app.use('/api/tournaments', tournamentsRouter);
  app.use('/api/matches', matchesRouter);

  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'endpoint_not_found', message: 'Endpoint không tồn tại' });
  });

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
