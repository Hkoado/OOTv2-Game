/**
 * requestHardening.test.js — hồi quy cho các lỗi review 24/10/2026 (mức cao):
 * - Cookie `Secure` vẫn bật khi proxy chuyển tiếp HTTPS nhưng `req.secure` chưa đúng.
 * - Rate limit `/api/live` theo tài khoản, để cả hội trường sau một NAT không dùng
 *   chung một quota (trước đây 100 viewer → 429 hàng loạt).
 * - Throttle đăng nhập theo cặp IP+tài khoản, trần theo IP đủ rộng cho lớp học.
 * - Origin localhost bị từ chối ở production; same-origin qua proxy vẫn nhận.
 * - `trust proxy`: loopback mặc định, nhưng 1 hop khi chạy trên Vercel.
 * - `OOTV2_EXPECTED_PROJECT_REF` chặn `.env` trộn URL/key của hai project Supabase.
 * - Tách `.env` (DB chính thức) / `.envdev` (dev): loader không ghi đè biến shell và
 *   `node --env-file=.envdev` không bị `.env` đè.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { isSecureRequest } from '../server/lib/cookieSecurity.js';
import { createRateLimiter } from '../server/lib/rateLimit.js';
import { LOGIN_PER_ACCOUNT, LOGIN_PER_IP, createLoginThrottle } from '../server/lib/loginThrottle.js';
import { originAllowed } from '../server/lib/origin.js';
import { loadEnvFile, parseAllowLocalOrigins, parseTrustProxy } from '../server/config.js';

const makeRes = () => {
  const state = { status: 200, headers: {}, body: null };
  return {
    state,
    set(key, value) { state.headers[key] = value; return this; },
    status(code) { state.status = code; return this; },
    json(body) { state.body = body; return this; },
  };
};

test('cookie Secure nhận cả req.secure lẫn X-Forwarded-Proto của proxy', () => {
  assert.equal(isSecureRequest({ secure: true }), true);
  assert.equal(isSecureRequest({ secure: false, get: () => 'https' }), true);
  assert.equal(isSecureRequest({ secure: false, get: () => 'https, http' }), true);
  assert.equal(isSecureRequest({ secure: false, headers: { 'x-forwarded-proto': 'HTTPS' } }), true);
  assert.equal(isSecureRequest({ secure: false, get: () => 'http' }), false);
  assert.equal(isSecureRequest({ secure: false }), false);
  assert.equal(isSecureRequest(undefined), false);
});

test('rate limit /api/live: quota theo tài khoản, không theo IP dùng chung', () => {
  let clock = 0;
  const limiter = createRateLimiter({ windowMs: 60_000, max: 3, now: () => clock,
    keyGenerator: (req) => `account:${req.account.id}` });
  const sharedIp = '203.0.113.50';
  // 100 viewer cùng IP: mỗi người một quota riêng, không ai bị 429 oan.
  for (let viewer = 0; viewer < 100; viewer += 1) {
    let allowed = 0;
    for (let poll = 0; poll < 3; poll += 1) {
      limiter({ ip: sharedIp, account: { id: `viewer-${viewer}` } }, makeRes(), () => { allowed += 1; });
    }
    assert.equal(allowed, 3, `viewer ${viewer} phải dùng đủ quota của mình`);
  }
  const blocked = makeRes();
  let afterLimit = 0;
  limiter({ ip: sharedIp, account: { id: 'viewer-0' } }, blocked, () => { afterLimit += 1; });
  assert.equal(afterLimit, 0, 'vượt trần của chính tài khoản thì mới chặn');
  assert.equal(blocked.state.status, 429);
  assert.ok(Number(blocked.state.headers['Retry-After']) >= 1);
});

test('rate limit IP: request có phiên nhận trần rộng hơn nhưng vẫn bị đếm', () => {
  let clock = 0;
  const limiter = createRateLimiter({ windowMs: 60_000,
    max: (req) => (req.headers?.cookie ? 5 : 1), now: () => clock });

  let anonymous = 0;
  limiter({ ip: '198.51.100.7', headers: {} }, makeRes(), () => { anonymous += 1; });
  const anonymousBlocked = makeRes();
  limiter({ ip: '198.51.100.7', headers: {} }, anonymousBlocked, () => { anonymous += 1; });
  assert.equal(anonymous, 1, 'request ẩn danh chỉ được 1 lượt/phút trong test này');
  assert.equal(anonymousBlocked.state.status, 429);

  // Cùng IP nhưng có phiên: trần 5, bộ đếm dùng chung (đã 2 lượt) → còn 3 lượt.
  let signedIn = 0;
  for (let index = 0; index < 3; index += 1) {
    limiter({ ip: '198.51.100.7', headers: { cookie: 'oot_local_session=abc' } }, makeRes(), () => { signedIn += 1; });
  }
  assert.equal(signedIn, 3);
  const signedBlocked = makeRes();
  limiter({ ip: '198.51.100.7', headers: { cookie: 'oot_local_session=abc' } }, signedBlocked, () => { signedIn += 1; });
  assert.equal(signedIn, 3, 'cookie không được miễn đếm hoàn toàn');
  assert.equal(signedBlocked.state.status, 429);
});


test('throttle đăng nhập: cả lớp chung IP vẫn vào được, dò một tài khoản thì bị chặn', () => {
  let clock = 0;
  const throttle = createLoginThrottle({ now: () => clock });

  // 30 học sinh chung một IP, mỗi em một lượt → không em nào bị chặn.
  for (let student = 0; student < 30; student += 1) {
    assert.equal(throttle.check({ ip: '203.0.113.7', username: `team${student}` }).allowed, true);
  }

  // Dò mật khẩu một tài khoản: chặn từ lượt vượt trần (trước đây là 15 lượt/IP).
  const brute = createLoginThrottle({ now: () => clock });
  for (let attempt = 0; attempt < LOGIN_PER_ACCOUNT; attempt += 1) {
    assert.equal(brute.check({ ip: '198.51.100.1', username: 'admin' }).allowed, true);
  }
  const blocked = brute.check({ ip: '198.51.100.1', username: 'admin' });
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfter >= 1);
  // Đăng nhập thành công chỉ mở lại cặp ip+tài khoản vừa dùng.
  brute.reset({ ip: '198.51.100.1', username: 'admin' });
  assert.equal(brute.check({ ip: '198.51.100.1', username: 'admin' }).allowed, true);

  // Trần theo một IP (dò nhiều username) vẫn còn, và cửa sổ tự trôi.
  const perIp = createLoginThrottle({ now: () => clock });
  for (let index = 0; index < LOGIN_PER_IP; index += 1) {
    assert.equal(perIp.check({ ip: '192.0.2.9', username: `user${index}` }).allowed, true);
  }
  assert.equal(perIp.check({ ip: '192.0.2.9', username: 'user-late' }).allowed, false);
  clock += 60_001;
  assert.equal(perIp.check({ ip: '192.0.2.9', username: 'user-late' }).allowed, true);
});

test('origin: localhost chỉ được phép ở dev; same-origin qua proxy vẫn nhận', () => {
  const req = { hostname: 'ootv2.example.edu.vn' };
  assert.equal(originAllowed(req, 'http://localhost:5173', { allowLocal: false }), false);
  assert.equal(originAllowed(req, 'http://127.0.0.1:5173', { allowLocal: false }), false);
  assert.equal(originAllowed(req, 'http://localhost:5173', { allowLocal: true }), true);
  assert.equal(originAllowed(req, 'https://ootv2.example.edu.vn'), true, 'same-origin sau proxy');
  assert.equal(originAllowed({ hostname: 'khac.example' }, 'https://ootv2.example.edu.vn'), false);
  assert.equal(originAllowed(req, 'http://ootv2.example.edu.vn'), false, 'production phải HTTPS');
  assert.equal(originAllowed(req, 'https://ootv2.example.edu.vn',
    { publicOrigins: ['https://ootv2.example.edu.vn'] }), true);
  assert.equal(originAllowed(req, 'not-a-url'), false);
});

test('trust proxy: loopback mặc định, Vercel nhận 1 hop; cờ origin localhost theo NODE_ENV', () => {
  assert.equal(parseTrustProxy('', {}), 'loopback');
  assert.equal(parseTrustProxy(undefined, {}), 'loopback');
  assert.equal(parseTrustProxy('', { VERCEL: '1' }), 1);
  assert.equal(parseTrustProxy('2', { VERCEL: '1' }), 2);
  assert.equal(parseTrustProxy('0', {}), false);
  assert.equal(parseAllowLocalOrigins('', {}), true);
  assert.equal(parseAllowLocalOrigins(undefined, { NODE_ENV: 'production' }), false);
  assert.equal(parseAllowLocalOrigins('1', { NODE_ENV: 'production' }), true);
  assert.equal(parseAllowLocalOrigins('0', {}), false);
});

test('OOTV2_EXPECTED_PROJECT_REF chặn SUPABASE_URL trỏ nhầm project', async () => {
  process.env.OOTV2_EXPECTED_PROJECT_REF = 'aaaaaaaaaaaaaaaaaaaa';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only-key';
  process.env.SUPABASE_URL = 'https://bbbbbbbbbbbbbbbbbbbb.supabase.co';

  const client = await import('../server/shared/client.js');
  assert.equal(client.projectRefOf(process.env.SUPABASE_URL), 'bbbbbbbbbbbbbbbbbbbb');
  assert.equal(client.projectRefOf('https://example.invalid'), null);
  assert.equal(client.projectRefOf('khong-phai-url'), null);
  assert.throws(() => client.assertSharedConfig(), /OOTV2_EXPECTED_PROJECT_REF/u);

  process.env.SUPABASE_URL = 'https://aaaaaaaaaaaaaaaaaaaa.supabase.co';
  assert.doesNotThrow(() => client.assertSharedConfig());

  // Test double/PostgREST tự dựng (host không phải Supabase) không bị guard này chặn.
  process.env.SUPABASE_URL = 'https://example.invalid';
  assert.doesNotThrow(() => client.assertSharedConfig());
});

test('loadEnvFile: không ghi đè biến shell, chọn được file khác .env, thiếu file thì bỏ qua', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'ootv2-env-'));
  const file = path.join(directory, 'custom.env');
  writeFileSync(file, [
    '# comment',
    'SUPABASE_URL=https://file.example.invalid',
    'OOTV2_TEST_ONLY_MARKER="from-file"',
    'OOTV2_TEST_ONLY_EMPTY=',
    '',
  ].join('\n'), 'utf8');

  // Biến đã có (shell / `node --env-file=`) thắng file env.
  const env = { SUPABASE_URL: 'https://shell.example.invalid' };
  const result = loadEnvFile(file, env);
  assert.equal(result.loaded, 2);
  assert.equal(env.SUPABASE_URL, 'https://shell.example.invalid', 'biến shell thắng file');
  assert.equal(env.OOTV2_TEST_ONLY_MARKER, 'from-file', 'bỏ dấu nháy khi parse');
  assert.equal(env.OOTV2_TEST_ONLY_EMPTY, '');

  // File không tồn tại không phải lỗi (mặc định .env có thể vắng).
  const missing = loadEnvFile(path.join(directory, 'missing.env'), {});
  assert.equal(missing.loaded, 0);
  assert.equal(missing.file, path.join(directory, 'missing.env'));

  rmSync(directory, { recursive: true, force: true });
});
