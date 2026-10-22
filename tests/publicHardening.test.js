/**
 * Test hardening trước khi mở web công khai: cookie `Secure` theo `X-Forwarded-Proto`,
 * origin allowlist (same-origin sau reverse proxy) và giới hạn upload 256 KiB (`bot.v1`).
 *
 * Chạy: `npm run test:server` hoặc `node --test tests/publicHardening.test.js`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { example, startTestEnv } from './helpers/testEnv.js';

async function createAdmin(username) {
  const { createAccount } = await import('../server/services/localAccounts.js');
  return createAccount({ username, password: 'test-admin-password', role: 'admin' });
}

async function rawLogin(env, { username, password = 'test-admin-password', origin, forwarded } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (origin) headers.origin = origin;
  if (forwarded) Object.assign(headers, forwarded);
  const response = await fetch(`${env.baseUrl}/api/local/login`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ username, password }),
  });
  const setCookie = response.headers.get('set-cookie') || '';
  const body = await response.json().catch(() => null);
  return { status: response.status, setCookie, body };
}

test('public hardening: cookie Secure khi request HTTPS, không Secure khi HTTP dev', async (t) => {
  const env = await startTestEnv();
  t.after(() => env.cleanup());
  await createAdmin('admin_cookie');

  const plain = await rawLogin(env, { username: 'admin_cookie' });
  assert.equal(plain.status, 200);
  assert.match(plain.setCookie, /HttpOnly/u);
  assert.match(plain.setCookie, /SameSite=Strict/u);
  assert.doesNotMatch(plain.setCookie, /;\s*Secure/iu, 'HTTP dev không được đặt Secure');

  const https = await rawLogin(env, { username: 'admin_cookie', forwarded: { 'x-forwarded-proto': 'https' } });
  assert.equal(https.status, 200);
  assert.match(https.setCookie, /;\s*Secure/iu, 'sau proxy HTTPS phải đặt Secure');
});

test('public hardening: origin lạ bị chặn, same-origin sau proxy được phép', async (t) => {
  const env = await startTestEnv();
  t.after(() => env.cleanup());
  await createAdmin('admin_origin');

  const proxyHeaders = { 'x-forwarded-host': 'ootv2.example.edu.vn', 'x-forwarded-proto': 'https' };

  const sameOrigin = await rawLogin(env, {
    username: 'admin_origin',
    origin: 'https://ootv2.example.edu.vn',
    forwarded: proxyHeaders,
  });
  assert.equal(sameOrigin.status, 200);

  const evil = await rawLogin(env, {
    username: 'admin_origin',
    origin: 'https://evil.test',
    forwarded: proxyHeaders,
  });
  assert.equal(evil.status, 403);
  assert.equal(evil.body.error, 'scope_denied');

  const insecurePublic = await rawLogin(env, {
    username: 'admin_origin',
    origin: 'http://ootv2.example.edu.vn',
    forwarded: proxyHeaders,
  });
  assert.equal(insecurePublic.status, 403, 'origin public bắt buộc HTTPS');
});

test('public hardening: OOTV2_PUBLIC_ORIGIN mở đúng origin đã khai báo', async () => {
  const { default: config } = await import('../server/config.js');
  const { isAllowedOrigin } = await import('../server/lib/origin.js');
  config.publicOrigins.push('https://ootv2.example.edu.vn');
  try {
    const req = { hostname: 'api-internal.local', get: () => 'api-internal.local' };
    assert.equal(isAllowedOrigin(req, 'https://ootv2.example.edu.vn'), true);
    assert.equal(isAllowedOrigin(req, 'https://evil.test'), false);
    assert.equal(isAllowedOrigin(req, 'http://ootv2.example.edu.vn'), false);
    assert.equal(isAllowedOrigin(req, 'ftp://ootv2.example.edu.vn'), false);
    assert.equal(isAllowedOrigin(req, 'not-a-url'), false);
    assert.equal(isAllowedOrigin({ hostname: 'localhost' }, 'http://localhost:5173'), true);
    assert.equal(isAllowedOrigin({ hostname: 'ootv2.example.edu.vn' }, 'https://ootv2.example.edu.vn'), true);
  } finally {
    config.publicOrigins.pop();
  }
});

test('public hardening: upload nhận file tới 256 KiB và chặn vượt hạn mức', async (t) => {
  const env = await startTestEnv();
  t.after(() => env.cleanup());
  assert.equal(env.config.limits.maxSourceBytes, 256 * 1024);

  const sample = readFileSync(example('sample_bot.py'));
  const padding = Buffer.from(`# ${'x'.repeat(116)}\n`.repeat(1500));
  const bigSource = Buffer.concat([padding, sample]);
  assert.ok(bigSource.length > 64 * 1024, 'phải lớn hơn hạn mức 64 KiB cũ');
  assert.ok(bigSource.length <= 256 * 1024, 'phải nằm trong hạn mức mới');

  const bigPath = path.join(env.dataDir, 'big_valid.py');
  writeFileSync(bigPath, bigSource);
  const participant = env.participantsService.createParticipant('Big Bot Team');
  const accepted = await env.uploadFile(participant.id, bigPath);
  assert.equal(accepted.status, 201, JSON.stringify(accepted.body));
  assert.equal(accepted.body.status, 'valid');

  const tooBig = new Uint8Array(env.config.limits.maxSourceBytes + 1);
  tooBig.fill(32);
  const form = new FormData();
  form.append('file', new Blob([tooBig], { type: 'text/x-python' }), 'huge.py');
  const rejected = await env.api(`/api/participants/${participant.id}/submissions`, { method: 'POST', body: form });
  assert.equal(rejected.status, 400);
  assert.equal(rejected.body.error, 'file_too_large');
});
