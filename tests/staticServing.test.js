/**
 * Test phục vụ web tĩnh từ Express (một origin sau Cloudflare Tunnel): SPA fallback,
 * cache asset, không nuốt `/api`, không lộ file ngoài `dist/`.
 *
 * Chạy: `node --test tests/staticServing.test.js`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';

import { startTestEnv } from './helpers/testEnv.js';

test('static serving: dist + SPA fallback, /api không bị nuốt', async (t) => {
  const env = await startTestEnv({ withServer: false });
  const originalDist = env.config.distDir;
  const distDir = mkdtempSync(path.join(os.tmpdir(), 'ootv2-dist-'));
  writeFileSync(path.join(distDir, 'index.html'), '<!doctype html><title>LIVE-APP</title>', 'utf8');
  mkdirSync(path.join(distDir, 'assets'));
  writeFileSync(path.join(distDir, 'assets', 'app-abc123.js'), 'console.log("live");', 'utf8');

  env.config.distDir = distDir;
  env.config.serveDist = true;

  const { createApp } = await import('../server/app.js');
  const server = createApp().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;

  t.after(() => {
    server.close();
    env.cleanup();
    rmSync(distDir, { recursive: true, force: true });
    env.config.distDir = originalDist;
  });

  const root = await fetch(`${base}/`, { headers: { accept: 'text/html' } });
  assert.equal(root.status, 200);
  assert.match(await root.text(), /LIVE-APP/u);
  assert.equal(root.headers.get('cache-control'), 'no-store');

  // Hash route dùng chung index.html; đường dẫn sâu vẫn trả app.
  const deep = await fetch(`${base}/some/deep/link`, { headers: { accept: 'text/html' } });
  assert.equal(deep.status, 200);
  assert.match(await deep.text(), /LIVE-APP/u);

  const api = await fetch(`${base}/api/health`, { headers: { accept: 'application/json' } });
  assert.equal(api.status, 200);
  assert.equal((await api.json()).ok, true);

  const missingApi = await fetch(`${base}/api/khong-co`, { headers: { accept: 'text/html' } });
  assert.equal(missingApi.status, 404, 'API 404 phải trả JSON, không rơi vào SPA fallback');
  assert.equal((await missingApi.json()).error, 'endpoint_not_found');

  const asset = await fetch(`${base}/assets/app-abc123.js`);
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get('cache-control'), /immutable/u);

  // Không phục vụ file ngoài dist (DB private nằm trong data/).
  const probe = await fetch(`${base}/data/ootv2.sqlite`, { headers: { accept: 'text/html' } });
  const probeText = await probe.text();
  assert.ok(!probeText.startsWith('SQLite format'), 'không được trả file SQLite');
  assert.match(probeText, /LIVE-APP/u);
});
