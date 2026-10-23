/**
 * h4Drill.test.js — guardrail tĩnh cho drill H4 (không chạy DB trong test).
 * Hành vi thật được nghiệm thu bằng `npm run db:h4` trên project thật.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const drill = readFileSync(new URL('../tools/cli/h4-drill.js', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../tools/cli/h4-worker.js', import.meta.url), 'utf8');

test('H4 drill: từ chối chạy khi DB đang có job thật', () => {
  assert.match(drill, /mvp_repo_sync_jobs\?select=id&limit=5|select=id&limit=5/u);
  assert.match(drill, /Không tranh job thật/u);
  assert.match(drill, /process\.exit\(3\)/u);
});

test('H4 drill: cleanup xoá submissions trước participants (FK)', () => {
  const submissionsAt = drill.indexOf("deleteRows('mvp_submissions'");
  const participantsAt = drill.indexOf("deleteRows('mvp_participants'");
  assert.ok(submissionsAt > 0, 'phải xoá submissions theo participant_id');
  assert.ok(participantsAt > submissionsAt, 'submissions phải bị xoá trước participants');
  assert.match(drill, /mvp_github_receipts[^\n]*event_id=eq/u);
});

test('H4 worker: claim/progress/finish qua RPC, crash mode không exit sớm', () => {
  for (const rpc of ['mvp_github_claim', 'mvp_github_progress', 'mvp_github_finish']) {
    assert.match(worker, new RegExp(rpc, 'u'));
  }
  assert.doesNotMatch(worker, /mode === 'crash'[\s\S]{0,300}process\.exit\(0\)/u,
    'crash mode phải break để stdout pipe flush đủ JSON');
  assert.match(worker, /process\.stdout\.write/u);
});

test('H4 drill: 2 worker là process thật, không dùng shell', () => {
  assert.match(drill, /spawn\(process\.execPath/u);
  assert.doesNotMatch(drill, /shell:\s*true/u);
  assert.doesNotMatch(worker, /shell:\s*true/u);
  assert.match(drill, /H4_MODE: 'crash'/u);
});

test('H4 drill: phủ cutoff, revoke, stale token/generation, duplicate finish', () => {
  assert.match(drill, /past_cutoff/u);
  assert.match(drill, /mvp_repo_connection_revoke/u);
  assert.match(drill, /'lease_lost'/u);
  assert.match(drill, /already_finished/u);
  assert.match(drill, /p_max_attempts: 1/u);
});
