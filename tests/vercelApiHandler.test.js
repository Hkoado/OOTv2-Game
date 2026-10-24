import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import handler from '../api/[...path].js';
import indexHandler from '../api/index.js';
import { restoreApiUrl } from '../server/lib/vercelPath.js';

test('vercel handler: trả lời /api/health khi URL đầy đủ', async () => {
  const server = http.createServer(async (req, res) => {
    await handler(req, res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.service, 'ootv2-tournament-api');
  } finally {
    server.close();
  }
});

test('vercel handler: trả lời /api/health ngay cả khi Vercel strip /api khỏi req.url', async () => {
  const server = http.createServer(async (req, res) => {
    // Giả lập Vercel serverless function nhận req.url là /health thay vì /api/health
    req.url = '/health';
    await handler(req, res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/test`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.service, 'ootv2-tournament-api');
  } finally {
    server.close();
  }
});

test('vercel rewrite: dựng lại path sâu từ tham số nội bộ (giữ query gốc)', () => {
  assert.equal(restoreApiUrl('/api?__ootv2_path=local/login'), '/api/local/login');
  assert.equal(
    restoreApiUrl('/api?__ootv2_path=live/matches/abc/events&afterSeq=7'),
    '/api/live/matches/abc/events?afterSeq=7'
  );
  // Vercel có thể vẫn gửi kèm path gốc: kết quả phải giữ nguyên, chỉ bỏ tham số nội bộ.
  assert.equal(
    restoreApiUrl('/api/local/teams?__ootv2_path=local/teams'),
    '/api/local/teams'
  );
  // URL không có tham số nội bộ: trả nguyên trạng.
  assert.equal(restoreApiUrl('/api/health?x=1'), '/api/health?x=1');
  assert.equal(restoreApiUrl('/api/health'), '/api/health');
  assert.equal(restoreApiUrl(''), '');
  // Path không an toàn hoặc không trỏ vào function rewrite: không được đổi route.
  assert.equal(restoreApiUrl('/api?__ootv2_path=../admin'), '/api');
  assert.equal(restoreApiUrl('/api/health?__ootv2_path=local/session'), '/api/health');
});

test('vercel rewrite: request /api?__ootv2_path=... vào được Express với path sâu', async () => {
  // Dùng chính entrypoint mà rewrite `/api/:path*` trỏ tới (api/index.js).
  const server = http.createServer((req, res) => indexHandler(req, res));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api?__ootv2_path=local/session`);
    // Không dựng lại path thì Express trả 404 endpoint_not_found; route thật trả 401.
    assert.equal(res.status, 401);
    const data = await res.json();
    assert.equal(data.error, 'login_required');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('vercel config: rewrite dồn /api/* về đúng một function, đứng trước rewrite SPA', () => {
  const vercelConfig = JSON.parse(fs.readFileSync(path.resolve('vercel.json'), 'utf8'));
  const apiIndex = vercelConfig.rewrites.findIndex((r) => r.source === '/api/:path*');
  const spaIndex = vercelConfig.rewrites.findIndex((r) => r.destination === '/index.html');
  assert.ok(apiIndex !== -1, 'phải có rewrite /api/:path* cho path sâu');
  assert.ok(spaIndex !== -1, 'phải có rewrite SPA');
  assert.ok(apiIndex < spaIndex, 'rewrite API phải đứng trước rewrite SPA');
  assert.equal(vercelConfig.rewrites[apiIndex].destination, '/api?__ootv2_path=:path*');
});

test('vercel config: rewrite regex loại trừ /api và giữ SPA routes', () => {
  const vercelConfig = JSON.parse(fs.readFileSync(path.resolve('vercel.json'), 'utf8'));
  const spaRewrite = vercelConfig.rewrites.find((r) => r.destination === '/index.html');
  assert.ok(spaRewrite, 'phải có rewrite về /index.html');

  // Regex pattern trong vercel.json
  const pattern = new RegExp(spaRewrite.source.replace(/^\//, '^/').replace(/$/, '$'));

  // Phải KHÔNG match các API routes
  assert.equal(pattern.test('/api/health'), false, 'Không được rewrite /api/health');
  assert.equal(pattern.test('/api/local/login'), false, 'Không được rewrite /api/local/login');
  assert.equal(pattern.test('/api/local/events'), false, 'Không được rewrite /api/local/events');
  assert.equal(pattern.test('/api'), false, 'Không được rewrite /api');

  // Phải match các frontend routes
  assert.equal(pattern.test('/'), true, 'Phải rewrite / về index.html');
  assert.equal(pattern.test('/events'), true, 'Phải rewrite /events về index.html');
  assert.equal(pattern.test('/teams'), true, 'Phải rewrite /teams về index.html');
  assert.equal(pattern.test('/live'), true, 'Phải rewrite /live về index.html');
});
