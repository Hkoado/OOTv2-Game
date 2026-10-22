/**
 * index.js — Entry API server: mở DB rồi listen loopback (mặc định 127.0.0.1:3001).
 * Chạy: `npm run dev:api`.
 */

import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

import config from './config.js';
import { initDb } from './db.js';
import { createApp } from './app.js';
import { sharedEnabled } from './shared/client.js';

export function startServer({ port = config.port, host = config.host } = {}) {
  if (!['127.0.0.1', '::1', 'localhost'].includes(host)) {
    throw new Error('Core local chưa có sandbox OS: chỉ cho phép bind loopback.');
  }
  if (!sharedEnabled) initDb();
  const app = createApp();
  const server = app.listen(port, host, () => {
    console.log(`[api] OOTv2 tournament API: http://${host}:${port} (loopback only)`);
    if (config.serveDist && fs.existsSync(path.join(config.distDir, 'index.html'))) {
      console.log(`[api] Web tĩnh (dist/) cùng origin: http://${host}:${port}/#/live`);
    } else {
      console.log('[api] Chưa có dist/index.html — chạy `npm run build` để phục vụ web cùng API.');
    }
  });

  const close = () => {
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', close);
  process.on('SIGTERM', close);

  return server;
}

const isEntryPoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntryPoint) {
  startServer();
}

export default { startServer };
