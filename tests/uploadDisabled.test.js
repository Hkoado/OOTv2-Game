/**
 * uploadDisabled.test.js — H2: upload file qua HTTP mặc định TẮT.
 *
 * Đội online nộp bằng GitHub; admin/BTC chỉ upload khi opt-in `OOTV2_ALLOW_ONLINE_UPLOAD=1`
 * (file `uploadTrustedDev.test.js` kiểm nhánh bật). Test không chạm Supabase/Storage thật.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { onlineUploadDecision, UPLOAD_DISABLED } from '../server/shared/uploadPolicy.js';

process.env.SUPABASE_URL = 'https://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only';
delete process.env.OOTV2_ALLOW_ONLINE_UPLOAD;

const harness = await import('./helpers/portalHarness.js');

test('uploadPolicy: đội luôn bị chặn; admin chỉ khi opt-in', () => {
  assert.deepEqual(onlineUploadDecision({ role: 'team', allowOnline: true }), {
    allowed: false,
    error: UPLOAD_DISABLED,
    message: onlineUploadDecision({ role: 'team', allowOnline: true }).message,
  });
  assert.equal(onlineUploadDecision({ role: 'team', allowOnline: true }).allowed, false, 'đội không được upload dù bật flag');
  assert.equal(onlineUploadDecision({ role: 'admin', allowOnline: false }).allowed, false);
  assert.equal(onlineUploadDecision({ role: 'admin', allowOnline: true }).allowed, true);
  assert.match(onlineUploadDecision({ role: 'admin', allowOnline: false }).message, /OOTV2_ALLOW_ONLINE_UPLOAD/u);
});

test('H2: upload HTTP mặc định tắt — admin và đội đều nhận 403 upload_disabled', async (t) => {
  const store = harness.seedStore();
  const { base } = await harness.startPortal(t, store);
  const admin = await harness.login(base, 'admin');
  const team = await harness.login(base, 'upload');

  const adminUpload = await harness.uploadBot(base, { teamId: harness.TEAM_PARTICIPANT, session: admin });
  assert.equal(adminUpload.status, 403);
  assert.equal(adminUpload.body.error, 'upload_disabled');
  assert.match(adminUpload.body.message, /OOTV2_ALLOW_ONLINE_UPLOAD/u);

  const teamUpload = await harness.uploadBot(base, { teamId: harness.TEAM_PARTICIPANT, session: team });
  assert.equal(teamUpload.status, 403);
  assert.equal(teamUpload.body.error, 'upload_disabled');
  assert.match(teamUpload.body.message, /GitHub/u);

  assert.equal(store.submissions.length, 0, 'cổng tắt thì không tạo submission');
});
