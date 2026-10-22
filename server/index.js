/**
 * index.js — Entry API server: mở DB rồi listen loopback (mặc định 127.0.0.1:3001).
 * Chạy: `npm run dev:api`.
 */

import { pathToFileURL } from 'node:url';

import config from './config.js';
import { initDb } from './db.js';
import { createApp } from './app.js';

export function startServer({ port = config.port, host = config.host } = {}) {
  if (!['127.0.0.1', '::1', 'localhost'].includes(host)) {
    throw new Error('Core local chưa có sandbox OS: chỉ cho phép bind loopback.');
  }
  initDb();
  const app = createApp();
  const server = app.listen(port, host, () => {
    console.log(`[api] OOTv2 tournament API: http://${host}:${port} (loopback only)`);
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
