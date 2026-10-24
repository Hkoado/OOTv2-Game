/**
 * githubRepo.test.js — Unit test resolver GitHub của intake (H1).
 *
 * Toàn bộ mạng được giả lập bằng `fetchImpl` được truyền vào; test KHÔNG gọi GitHub thật.
 * Bảo vệ: chỉ https://api.github.com, không token trong URL, không tải source/blob,
 * chỉ nhận SHA 40 hex, và map lỗi GitHub sang lỗi API có mã đọc được.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { parseBranch, parseRepository, resolveIntakeTarget } from '../server/services/githubRepo.js';

const SHA = 'a'.repeat(40);
const OWNER = 'team-delta';
const NAME = 'ootv2-bot';

function stubFetch(handler) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return handler(String(url), options);
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

const jsonResponse = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

test('parseRepository: chỉ nhận URL GitHub canonical, không token/query/path lồng', () => {
  assert.deepEqual(parseRepository(`https://github.com/${OWNER}/${NAME}`), {
    owner: OWNER,
    name: NAME,
    fullName: `${OWNER}/${NAME}`,
    repository: `https://github.com/${OWNER}/${NAME}`,
  });
  assert.equal(parseRepository(`https://github.com/${OWNER}/${NAME}/`).repository, `https://github.com/${OWNER}/${NAME}`);

  const rejected = [
    `http://github.com/${OWNER}/${NAME}`,
    `https://gitlab.com/${OWNER}/${NAME}`,
    `https://github.com:8443/${OWNER}/${NAME}`,
    `https://user:token@github.com/${OWNER}/${NAME}`,
    `https://github.com/${OWNER}/${NAME}?access_token=x`,
    `https://github.com/${OWNER}/${NAME}#readme`,
    `https://github.com/${OWNER}/${NAME}/tree/main`,
    'not-a-url',
  ];
  for (const value of rejected) {
    assert.throws(() => parseRepository(value), (error) => error.status === 400 && error.code === 'bad_repository', value);
  }
});

test('parseBranch: chặn ref đặc biệt, ký tự lạ và độ dài quá mức', () => {
  assert.equal(parseBranch(' main '), 'main');
  assert.equal(parseBranch('release/2026-10'), 'release/2026-10');

test('resolveIntakeTarget: resolve repo ID + HEAD SHA, không tải blob/hook source', async () => {
  const fetchImpl = stubFetch((url) => {
    if (url === `https://api.github.com/repos/${OWNER}/${NAME}`) {
      return jsonResponse({ id: 987654321, full_name: `${OWNER}/${NAME}`, private: false, default_branch: 'main' });
    }
    if (url === `https://api.github.com/repos/${OWNER}/${NAME}/commits/main`) {
      return jsonResponse({ sha: SHA.toUpperCase() });
    }
    throw new Error(`Không được gọi ${url}`);
  });

  const target = await resolveIntakeTarget(
    { repository: `https://github.com/${OWNER}/${NAME}`, branch: 'main' },
    { fetchImpl, token: 'btc-token', timeoutMs: 1000 }
  );

  assert.equal(target.repoId, 987654321);
  assert.equal(target.commitSha, SHA);
  assert.equal(target.repository, `https://github.com/${OWNER}/${NAME}`);
  assert.equal(target.private, false);

  assert.equal(fetchImpl.calls.length, 2, 'chỉ 2 request metadata, không tải nội dung');
  for (const call of fetchImpl.calls) {
    const parsed = new URL(call.url);
    assert.equal(parsed.origin, 'https://api.github.com');
    assert.ok(!call.url.includes('btc-token'), 'token không được nằm trong URL/log');
    assert.ok(!/\/contents\/|\/git\/blobs\//u.test(parsed.pathname), 'không tải source/blob trong API');
    assert.equal(call.options.headers.authorization, 'Bearer btc-token');
    assert.equal(call.options.redirect, 'error');
    assert.ok(call.options.signal, 'phải có timeout');
  }
});

test('resolveIntakeTarget: không gửi Authorization khi chưa cấu hình token', async () => {
  const fetchImpl = stubFetch((url) => (url.endsWith('/commits/main') ? jsonResponse({ sha: SHA }) : jsonResponse({ id: 7 })));
  await resolveIntakeTarget({ repository: `https://github.com/${OWNER}/${NAME}`, branch: 'main' }, { fetchImpl, token: '' });
  assert.equal('authorization' in fetchImpl.calls[0].options.headers, false);
});

test('lỗi GitHub được map thành lỗi API có mã, không lộ chi tiết remote', async () => {
  const notFound = stubFetch(() => jsonResponse({ message: 'Not Found' }, 404));
  await assert.rejects(
    resolveIntakeTarget({ repository: `https://github.com/${OWNER}/${NAME}`, branch: 'main' }, { fetchImpl: notFound, token: '' }),
    { status: 404, code: 'repository_not_found' }
  );

  const rateLimited = stubFetch(() => jsonResponse({ message: 'API rate limit exceeded' }, 403, { 'x-ratelimit-remaining': '0' }));
  await assert.rejects(
    resolveIntakeTarget({ repository: `https://github.com/${OWNER}/${NAME}`, branch: 'main' }, { fetchImpl: rateLimited, token: '' }),
    { status: 503, code: 'github_rate_limited' }
  );

  const offline = stubFetch(() => {
    throw new Error('ECONNRESET');
  });
  await assert.rejects(
    resolveIntakeTarget({ repository: `https://github.com/${OWNER}/${NAME}`, branch: 'main' }, { fetchImpl: offline, token: '' }),
    { status: 503, code: 'github_unavailable' }
  );

  const shortSha = stubFetch((url) => (url.endsWith('/commits/main') ? jsonResponse({ sha: 'abc1234' }) : jsonResponse({ id: 7 })));
  await assert.rejects(
    resolveIntakeTarget({ repository: `https://github.com/${OWNER}/${NAME}`, branch: 'main' }, { fetchImpl: shortSha, token: '' }),
    { status: 502, code: 'github_bad_response' }
  );

  const tooLarge = stubFetch(() => jsonResponse({ id: 7, pad: 'x'.repeat(4096) }));
  await assert.rejects(
    resolveIntakeTarget(
      { repository: `https://github.com/${OWNER}/${NAME}`, branch: 'main' },
      { fetchImpl: tooLarge, token: '', maxBytes: 512 }
    ),
    { status: 502, code: 'github_bad_response' }
  );
});

  for (const value of ['', 'refs/heads/main', '../main', 'main..backup', '/main', 'main/', 'main.lock', 'a b', 'x'.repeat(121), 'feat$']) {
    assert.throws(() => parseBranch(value), (error) => error.status === 400 && error.code === 'bad_branch', value);
  }
});
