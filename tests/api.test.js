/**
 * Test M3 — API đội, upload submission và các guard cơ bản.
 * Chạy: `npm run test:server` (hoặc `node --test tests/api.test.js`).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

import { example, startTestEnv } from './helpers/testEnv.js';

const { rmSync } = await import('node:fs');

test('M3 API: participants CRUD + chặn tên trùng không phân biệt hoa/thường', async (t) => {
  const env = await startTestEnv();
  t.after(() => env.cleanup());

  const health = await env.api('/api/health');
  assert.equal(health.status, 200);
  assert.equal(health.body.ok, true);

  const created = await env.api('/api/participants', {
    method: 'POST',
    body: { name: '  Bot Alpha  ' },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.name, 'Bot Alpha');

  const duplicate = await env.api('/api/participants', {
    method: 'POST',
    body: { name: 'bot alpha' },
  });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.error, 'duplicate_name');

  const missing = await env.api('/api/participants', { method: 'POST', body: {} });
  assert.equal(missing.status, 400);
  assert.equal(missing.body.error, 'missing_name');

  const empty = await env.api('/api/participants', { method: 'POST', body: { name: '   ' } });
  assert.equal(empty.status, 400);
  assert.equal(empty.body.error, 'bad_name');

  const list = await env.api('/api/participants');
  assert.equal(list.status, 200);
  assert.equal(list.body.participants.length, 1);
});

test('M3 API: upload bot hợp lệ trở thành submission valid, không lộ storage_path', async (t) => {
  const env = await startTestEnv();
  t.after(() => env.cleanup());

  const participant = env.participantsService.createParticipant('Bot Alpha');
  const upload = await env.uploadFile(participant.id, example('sample_bot.py'));

  assert.equal(upload.status, 201);
  assert.equal(upload.body.status, 'valid');
  assert.equal(upload.body.validation_error, null);
  assert.match(upload.body.sha256, /^[0-9a-f]{64}$/u);
  assert.equal('storage_path' in upload.body, false);

  const list = await env.api(`/api/participants/${participant.id}/submissions`);
  assert.equal(list.status, 200);
  assert.equal(list.body.submissions.length, 1);
  assert.equal('storage_path' in list.body.submissions[0], false);

  const unknown = await env.api('/api/participants/khong-ton-tai/submissions');
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.error, 'participant_not_found');
});

test('M3 API: upload sai đuôi, thiếu file, quá lớn hoặc lỗi cú pháp bị xử đúng', async (t) => {
  const env = await startTestEnv();
  t.after(() => env.cleanup());
  const participant = env.participantsService.createParticipant('Bot Beta');

  const wrongExt = await env.uploadFile(participant.id, example('sample_bot.py'), {
    filename: 'bot.zip',
  });
  assert.equal(wrongExt.status, 400);
  assert.equal(wrongExt.body.error, 'bad_extension');

  const noFile = await env.api(`/api/participants/${participant.id}/submissions`, {
    method: 'POST',
    body: new FormData(),
  });
  assert.equal(noFile.status, 400);
  assert.equal(noFile.body.error, 'missing_file');

  const bigBytes = new Uint8Array(70 * 1024);
  bigBytes.fill(32);
  const form = new FormData();
  form.append('file', new Blob([bigBytes], { type: 'text/x-python' }), 'big.py');
  const tooLarge = await env.api(`/api/participants/${participant.id}/submissions`, {
    method: 'POST',
    body: form,
  });
  assert.equal(tooLarge.status, 400);
  assert.equal(tooLarge.body.error, 'file_too_large');

  const brokenPath = path.join(env.dataDir, 'broken.py');
  writeFileSync(brokenPath, 'def broken(:\n    pass\n');
  const broken = await env.uploadFile(participant.id, brokenPath);
  assert.equal(broken.status, 201);
  assert.equal(broken.body.status, 'invalid');
  assert.match(broken.body.validation_error, /syntax/u);
});

test('M3 API: route giải đấu cần x-admin-key và báo lỗi JSON rõ ràng', async (t) => {
  const env = await startTestEnv();
  t.after(() => env.cleanup());

  const bodies = [];
  for (let index = 0; index < 8; index += 1) {
    bodies.push(env.participantsService.createParticipant(`Bot ${index}`).id);
  }

  const noKey = await env.api('/api/tournaments', {
    method: 'POST',
    body: { name: 'Giải thiếu key', participantIds: bodies },
  });
  assert.equal(noKey.status, 401);
  assert.equal(noKey.body.error, 'admin_key_required');

  const wrongKey = await env.api('/api/tournaments', {
    method: 'POST',
    headers: { 'x-admin-key': 'sai-key' },
    body: { name: 'Giải sai key', participantIds: bodies },
  });
  assert.equal(wrongKey.status, 401);

  const missingSubmission = await env.api('/api/tournaments', {
    method: 'POST',
    admin: true,
    body: { name: 'Giải thiếu bot', participantIds: bodies },
  });
  assert.equal(missingSubmission.status, 201);
  const startWithoutBots = await env.api(`/api/tournaments/${missingSubmission.body.id}/start`, { method: 'POST', admin: true });
  assert.equal(startWithoutBots.status, 400);
  assert.equal(startWithoutBots.body.error, 'missing_valid_submission');

  const badParticipants = await env.api('/api/tournaments', {
    method: 'POST',
    admin: true,
    body: { name: 'Thiếu đội', participantIds: bodies.slice(0, 7) },
  });
  assert.equal(badParticipants.status, 201);
  const startWithSeven = await env.api(`/api/tournaments/${badParticipants.body.id}/start`, { method: 'POST', admin: true });
  assert.equal(startWithSeven.status, 400);
  assert.equal(startWithSeven.body.error, 'need_eight_entries');

  const badJson = await env.api('/api/tournaments', {
    method: 'POST',
    admin: true,
    headers: { 'content-type': 'application/json' },
    body: '{"name": ',
  });
  assert.equal(badJson.status, 400);
  assert.equal(badJson.body.error, 'bad_json');

  const unknownEndpoint = await env.api('/api/khong-co-that');
  assert.equal(unknownEndpoint.status, 404);
  assert.equal(unknownEndpoint.body.error, 'endpoint_not_found');

  rmSync(path.join(env.dataDir, 'broken.py'), { force: true });
});
