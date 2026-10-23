/**
 * uploadTrustedDev.test.js — H2 nhánh opt-in: admin/BTC upload file (trusted-dev/import offline).
 * Đặt env TRƯỚC khi import app vì `config` đọc `process.env` lúc import.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only';
process.env.OOTV2_ALLOW_ONLINE_UPLOAD = '1';

const harness = await import('./helpers/portalHarness.js');

test('H2: admin opt-in upload được; đội vẫn bị 403 upload_disabled', async (t) => {
  const store = harness.seedStore();
  const { base } = await harness.startPortal(t, store);
  const admin = await harness.login(base, 'admin');
  const team = await harness.login(base, 'upload');

  const teamUpload = await harness.uploadBot(base, { teamId: harness.TEAM_PARTICIPANT, session: team });
  assert.equal(teamUpload.status, 403);
  assert.equal(teamUpload.body.error, 'upload_disabled', 'flag chỉ mở cho admin, không mở cho đội');
  assert.equal(store.submissions.length, 0);

  const adminUpload = await harness.uploadBot(base, { teamId: harness.TEAM_PARTICIPANT, session: admin });
  assert.equal(adminUpload.status, 201);
  assert.equal(adminUpload.body.status, 'uploaded');
  assert.equal(adminUpload.body.participant_id, harness.TEAM_PARTICIPANT);
  assert.match(adminUpload.body.sha256, /^[0-9a-f]{64}$/u);
  assert.equal('storage_path' in adminUpload.body, false, 'không lộ storage path');
  assert.equal(store.submissions.length, 1);
  assert.match(store.submissions[0].storage_path, /^[0-9a-f-]{36}\.py$/u);

  // Vẫn giữ kiểm tra multer khi cổng mở: sai đuôi bị chặn trước khi tạo submission.
  const badForm = new FormData();
  badForm.append('file', new Blob(['print(1)\n'], { type: 'text/plain' }), 'bot.txt');
  const badExtension = await globalThis.fetch(`${base}/api/local/submissions/${harness.TEAM_PARTICIPANT}`, {
    method: 'POST',
    headers: { cookie: admin.cookie, 'x-csrf-token': admin.csrf },
    body: badForm,
  });
  assert.equal(badExtension.status, 400);
  assert.equal((await badExtension.json()).error, 'bad_extension');
  assert.equal(store.submissions.length, 1, 'file sai không được ghi DB');
});
