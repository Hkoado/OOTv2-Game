import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import handler from '../api/[...path].js';
import indexHandler from '../api/index.js';

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
