/**
 * manualFinalApi.test.js — Hợp đồng API/DB Chung kết thủ công (mock, không chạm Supabase).
 *
 * Bảo vệ các quy tắc đã chốt trong docs/18 + docs/19:
 * - Admin-only; đội/anonymous/cross-event bị chặn ở server, CSRF bắt buộc cho mọi write.
 * - Một `.py` UTF-8 1..262144 bytes; chặn ZIP/định dạng khác, binary, UTF-8 hỏng; hash do server tính.
 * - Upload lặp cùng bytes idempotent; bài pending/invalid không chọn/khóa; sau khóa không đổi bài.
 * - Chấm chỉ khi vòng đã khóa, hai bài đã khóa/hợp lệ; idempotent theo key; không đọc bài mới nhất.
 * - Kết quả chỉ qua finish có fence; duplicate/stale attempt không ghi; hủy/chấm lại có lý do + audit.
 * - DTO không lộ storage_path/token; replay chỉ admin và chỉ khi đã accepted.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, scryptSync } from 'node:crypto';

import { SAMPLE_MAPS } from '../src/game/sampleMaps.js';

process.env.SUPABASE_URL = 'https://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only';
delete process.env.OOTV2_ALLOW_ONLINE_UPLOAD;

const harness = await import('./helpers/portalHarness.js');
const { installManualFinalRpc } = await import('./helpers/manualFinalFake.js');
const jobs = await import('../server/shared/manualFinalJobs.js');

const PASSWORD = harness.PASSWORD;
const ADMIN_ID = harness.ADMIN_ID;
const TEAM_A = harness.TEAM_PARTICIPANT;
const TEAM_B = '44444444-4444-4444-8444-555555555555';
const TEAM_C = '44444444-4444-4444-8444-666666666666';
const OTHER_EVENT_TEAM = '44444444-4444-4444-8444-777777777777';
const MAP = SAMPLE_MAPS[0].map;
const BOT_OK = 'import json\nprint(json.dumps({"ok": True}))\n';

const encode = (password) => {
  const salt = 'a'.repeat(32);
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
};

function seedStore() {
  const now = new Date().toISOString();
  const account = (id, username, participant) => ({
    id, username, password_hash: encode(PASSWORD), role: participant ? 'team' : 'admin',
    participant_id: participant, members: '', contact: '', repository: '', branch: 'main', created_at: now,
  });
  return {
    participants: [
      { id: TEAM_A, name: 'Đội Alpha', name_key: 'đội alpha', created_at: now },
      { id: TEAM_B, name: 'Đội Beta', name_key: 'đội beta', created_at: now },
      { id: TEAM_C, name: 'Đội Gamma', name_key: 'đội gamma', created_at: now },
      { id: OTHER_EVENT_TEAM, name: 'Đội Ngoài', name_key: 'đội ngoài', created_at: now },
    ],
    accounts: [
      account(ADMIN_ID, 'admin', null),
      account('22222222-2222-4222-8222-222222222222', 'alpha', TEAM_A),
    ],
    sessions: [],
    submissions: [],
    tournaments: [],
    tournament_entries: [],
    official_setups: [],
    repo_connections: [],
    repo_sync_jobs: [],
    github_receipts: [],
    match_events: [],
    match_bot_output: [],
    worker_state: [],
    manual_final_events: [],
    manual_final_teams: [],
    manual_final_submissions: [],
    manual_final_matches: [],
    manual_final_jobs: [],
    manual_final_audit: [],
  };
}

async function call(base, path, { method = 'GET', session, body, form } = {}) {
  const headers = { cookie: session?.cookie || '' };
  if (session?.csrf) headers['x-csrf-token'] = session.csrf;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const response = await globalThis.fetch(`${base}${path}`, { method, headers, body: payload });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { raw: text };
  }
  return { status: response.status, body: parsed, headers: response.headers };
}

function uploadForm(source, filename = 'bot.py') {
  const form = new FormData();
  const bytes = Buffer.isBuffer(source) ? source : Buffer.from(source, 'utf8');
  form.append('file', new Blob([bytes], { type: 'text/x-python' }), filename);
  return form;
}

async function start(t) {
  const store = seedStore();
  installManualFinalRpc(store);
  const { base } = await harness.startPortal(t, store);
  const admin = await harness.login(base, 'admin');
  const team = await harness.login(base, 'alpha');
  return { store, base, admin, team };
}

async function createEvent(base, admin, { teams = [TEAM_A, TEAM_B], name = 'Chung kết thủ công 2026' } = {}) {
  const created = await call(base, '/api/local/manual-finals', {
    method: 'POST', session: admin,
    body: { name, level: 'semester', round_no: 1, team_ids: teams, map: MAP },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  return created.body;
}

async function setStatus(base, admin, eventId, status) {
  return call(base, `/api/local/manual-finals/${eventId}/status`, {
    method: 'POST', session: admin, body: { status },
  });
}

async function upload(base, admin, eventId, teamId, source = BOT_OK) {
  const form = uploadForm(source);
  form.append('team_id', teamId);
  return call(base, `/api/local/manual-finals/${eventId}/submissions`, {
    method: 'POST', session: admin, form,
  });
}

/** Worker thật của Khoa sẽ làm bước này: claim job validate rồi finish valid. */
async function validatePending(base, admin, eventId) {
  for (;;) {
    const claimed = await jobs.claimManualFinalJobs({ worker: 'test-worker', limit: 5 });
    const pending = claimed.jobs.filter((job) => job.kind === 'validate');
    if (!pending.length) break;
    for (const job of pending) {
      const finished = await jobs.finishManualFinalJob({
        jobId: job.jobId, token: job.token, generation: job.generation, kind: 'validate',
        outcome: { status: 'valid', source_hash: job.submission.sha256 },
      });
      assert.equal(finished.applied, true);
    }
  }
}

test('Chung kết thủ công là admin-only: anonymous 401, đội 403, thiếu CSRF 403', async (t) => {
  const { base, team } = await start(t);
  const anonymous = await call(base, '/api/local/manual-finals');
  assert.equal(anonymous.status, 401);
  assert.equal(anonymous.body.error, 'login_required');

  const teamList = await call(base, '/api/local/manual-finals', { session: team });
  assert.equal(teamList.status, 403);
  assert.equal(teamList.body.error, 'admin_required', 'đội không đọc được đợt BTC');

  const teamCreate = await call(base, '/api/local/manual-finals', {
    method: 'POST', session: team,
    body: { name: 'X', level: 'weekly', team_ids: [TEAM_A, TEAM_B], map: MAP },
  });
  assert.equal(teamCreate.status, 403);
  assert.equal(teamCreate.body.error, 'admin_required');

  const missingCsrf = await call(base, '/api/local/manual-finals', {
    method: 'POST', session: { cookie: team.cookie },
    body: { name: 'X', level: 'weekly', team_ids: [TEAM_A, TEAM_B], map: MAP },
  });
  assert.equal(missingCsrf.status, 403);
  assert.equal(missingCsrf.body.error, 'csrf_required');

  const teamUpload = await call(base, `/api/local/manual-finals/${randomUUID()}/submissions`, {
    method: 'POST', session: team, form: uploadForm(BOT_OK),
  });
  assert.equal(teamUpload.status, 403);
  assert.equal(teamUpload.body.error, 'admin_required');
});

test('tạo đợt: bắt buộc map v2, đủ 2..56 đội tồn tại, runtime chính thức được pin', async (t) => {
  const { base, admin } = await start(t);
  const weak = await call(base, '/api/local/manual-finals', {
    method: 'POST', session: admin,
    body: { name: 'Thiếu đội', level: 'weekly', team_ids: [TEAM_A], map: MAP },
  });
  assert.equal(weak.status, 400);
  assert.equal(weak.body.error, 'bad_teams');

  const legacy = await call(base, '/api/local/manual-finals', {
    method: 'POST', session: admin,
    body: { name: 'Map v1', level: 'weekly', team_ids: [TEAM_A, TEAM_B],
      map: { ...MAP, schemaVersion: 'map.v1', rulesVersion: 'ott-campus.v1' } },
  });
  assert.equal(legacy.status, 400);

  const unknownTeam = await call(base, '/api/local/manual-finals', {
    method: 'POST', session: admin,
    body: { name: 'Đội lạ', level: 'weekly', team_ids: [TEAM_A, randomUUID()], map: MAP },
  });
  assert.equal(unknownTeam.status, 400);
  assert.equal(unknownTeam.body.error, 'unknown_team');

  const event = await createEvent(base, admin);
  assert.equal(event.event.status, 'draft');
  assert.equal(event.event.intake_mode, 'manual_final');
  assert.equal(event.event.map_hash.length, 64);
  assert.equal(event.event.runtime.runtimeVersion, 'campus-runtime.v1');
  assert.equal(event.event.runtime.rulesVersion, 'ott-campus.v2');
  assert.match(event.event.runtime.runtimeHash, /^[a-f0-9]{64}$/u);
  assert.equal(event.teams.length, 2);
  assert.equal(event.readiness.blockers.length, 2);
  assert.equal(event.audit[0].action, 'create');
});


test('nạp bot: chặn ZIP/binary/UTF-8 hỏng, hash do server tính, upload trùng idempotent', async (t) => {
  const { base, admin, store } = await start(t);
  const event = await createEvent(base, admin);
  const eventId = event.event.id;

  const zipForm = uploadForm('PK\u0003\u0004', 'bot.zip');
  zipForm.append('team_id', TEAM_A);
  const zip = await call(base, `/api/local/manual-finals/${eventId}/submissions`, {
    method: 'POST', session: admin, form: zipForm,
  });
  assert.equal(zip.status, 400);
  assert.equal(zip.body.error, 'bad_extension');

  const binary = await upload(base, admin, eventId, TEAM_A, Buffer.from([1, 2, 0, 4]));
  assert.equal(binary.status, 400);
  assert.equal(binary.body.error, 'binary_file');

  const brokenUtf8 = await upload(base, admin, eventId, TEAM_A, Buffer.from([0xff, 0xfe, 0x41]));
  assert.equal(brokenUtf8.status, 400);
  assert.equal(brokenUtf8.body.error, 'bad_encoding');

  const outsider = await upload(base, admin, eventId, OTHER_EVENT_TEAM);
  assert.equal(outsider.status, 403);
  assert.equal(outsider.body.error, 'scope_denied');

  const first = await upload(base, admin, eventId, TEAM_A);
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(first.body.submission.status, 'pending');
  assert.equal(first.body.submission.filename, 'bot.py');
  assert.equal(first.body.submission.sha256.length, 64);
  assert.equal(first.body.submission.byte_size, Buffer.byteLength(BOT_OK));
  assert.equal(first.body.submission.locked, false);
  assert.equal(first.body.submission.source_kind, 'manual_final');
  assert.ok(!('storage_path' in first.body.submission), 'DTO không lộ storage_path');
  assert.ok(!JSON.stringify(first.body).includes('ootv2-bots'), 'không lộ bucket/key');

  const again = await upload(base, admin, eventId, TEAM_A);
  assert.equal(again.status, 200);
  assert.equal(again.body.duplicate, true);
  assert.equal(again.body.submission.id, first.body.submission.id);
  assert.equal(store.manual_final_submissions.length, 1, 'upload trùng không tạo bản ghi thứ 2');
  assert.equal(store.manual_final_jobs.length, 1, 'không xếp job validate trùng');
  assert.equal(store.__storage.size, 1, 'bytes chỉ lưu một lần');
});

test('chọn/khóa: pending không chọn, chưa chọn không khóa, sau khóa không đổi bài, thiếu đội không khóa vòng', async (t) => {
  const { base, admin } = await start(t);
  const event = await createEvent(base, admin);
  const eventId = event.event.id;
  const uploadA = await upload(base, admin, eventId, TEAM_A);
  const uploadB = await upload(base, admin, eventId, TEAM_B);
  const subA = uploadA.body.submission.id;
  const subB = uploadB.body.submission.id;

  const tooEarly = await setStatus(base, admin, eventId, 'locked');
  assert.equal(tooEarly.status, 409);
  assert.equal(tooEarly.body.error, 'bad_transition');

  const opened = await setStatus(base, admin, eventId, 'intake');
  assert.equal(opened.status, 200);
  assert.equal(opened.body.event.status, 'intake');

  const selectPending = await call(base, `/api/local/manual-finals/${eventId}/submissions/${subA}/select`, {
    method: 'POST', session: admin,
  });
  assert.equal(selectPending.status, 409);
  assert.equal(selectPending.body.error, 'submission_not_valid');

  await validatePending(base, admin, eventId);

  const lockWithoutSelect = await call(base, `/api/local/manual-finals/${eventId}/lock`, {
    method: 'POST', session: admin, body: { team_id: TEAM_A },
  });
  assert.equal(lockWithoutSelect.status, 409);
  assert.equal(lockWithoutSelect.body.error, 'not_selected');

  const selectedA = await call(base, `/api/local/manual-finals/${eventId}/submissions/${subA}/select`, {
    method: 'POST', session: admin,
  });
  assert.equal(selectedA.status, 200);
  assert.equal(selectedA.body.select.team_id, TEAM_A);
  const lockedA = await call(base, `/api/local/manual-finals/${eventId}/lock`, {
    method: 'POST', session: admin, body: { team_id: TEAM_A },
  });
  assert.equal(lockedA.status, 200);
  assert.equal(lockedA.body.lock.already_locked, false);
  const lockedAgain = await call(base, `/api/local/manual-finals/${eventId}/lock`, {
    method: 'POST', session: admin, body: { team_id: TEAM_A },
  });
  assert.equal(lockedAgain.status, 200);
  assert.equal(lockedAgain.body.lock.already_locked, true, 'khóa lặp idempotent');

  const second = await upload(base, admin, eventId, TEAM_A, `${BOT_OK}# v2\n`);
  assert.equal(second.status, 201);
  await validatePending(base, admin, eventId);
  const reselect = await call(base, `/api/local/manual-finals/${eventId}/submissions/${second.body.submission.id}/select`, {
    method: 'POST', session: admin,
  });
  assert.equal(reselect.status, 409);
  assert.equal(reselect.body.error, 'submission_locked');
  const lockedView = await call(base, `/api/local/manual-finals/${eventId}`, { session: admin });
  assert.equal(lockedView.body.teams.find((team) => team.team_id === TEAM_A).locked_submission_id, subA);

  const lockRoundEarly = await setStatus(base, admin, eventId, 'locked');
  assert.equal(lockRoundEarly.status, 409);
  assert.equal(lockRoundEarly.body.error, 'teams_not_locked');

  await call(base, `/api/local/manual-finals/${eventId}/submissions/${subB}/select`, {
    method: 'POST', session: admin,
  });
  await call(base, `/api/local/manual-finals/${eventId}/lock`, {
    method: 'POST', session: admin, body: { team_id: TEAM_B },
  });
  const lockRound = await setStatus(base, admin, eventId, 'locked');
  assert.equal(lockRound.status, 200, JSON.stringify(lockRound.body));
  assert.equal(lockRound.body.event.status, 'locked');
  assert.equal(lockRound.body.readiness.can_lock_round, false);
});


/** Đưa một đợt tới trạng thái locked với mọi đội đã chọn + khóa bài hợp lệ. */
async function lockedEvent(base, admin, { teams = [TEAM_A, TEAM_B] } = {}) {
  const event = await createEvent(base, admin, { teams });
  const eventId = event.event.id;
  const subs = new Map();
  for (const teamId of teams) {
    const uploaded = await upload(base, admin, eventId, teamId);
    assert.equal(uploaded.status, 201, JSON.stringify(uploaded.body));
    subs.set(teamId, uploaded.body.submission.id);
  }
  const opened = await setStatus(base, admin, eventId, 'intake');
  assert.equal(opened.status, 200);
  await validatePending(base, admin, eventId);
  for (const teamId of teams) {
    const selected = await call(base, `/api/local/manual-finals/${eventId}/submissions/${subs.get(teamId)}/select`, {
      method: 'POST', session: admin,
    });
    assert.equal(selected.status, 200, JSON.stringify(selected.body));
    const locked = await call(base, `/api/local/manual-finals/${eventId}/lock`, {
      method: 'POST', session: admin, body: { team_id: teamId },
    });
    assert.equal(locked.status, 200, JSON.stringify(locked.body));
  }
  const closedIntake = await setStatus(base, admin, eventId, 'locked');
  assert.equal(closedIntake.status, 200, JSON.stringify(closedIntake.body));
  return { eventId, subs };
}

async function pair(base, admin, eventId, body = {}) {
  return call(base, `/api/local/manual-finals/${eventId}/matches`, {
    method: 'POST', session: admin,
    body: { red_team_id: TEAM_A, blue_team_id: TEAM_B, series_id: 'sf1', game_no: 1, ...body },
  });
}

test('yêu cầu chấm: chỉ sau khi khóa vòng + hai bài khóa, idempotent theo key, không đọc bài mới nhất', async (t) => {
  const { base, admin, store } = await start(t);
  const earlyEvent = await createEvent(base, admin);
  const notLocked = await pair(base, admin, earlyEvent.event.id);
  assert.equal(notLocked.status, 409);
  assert.equal(notLocked.body.error, 'event_not_locked');

  const { eventId, subs } = await lockedEvent(base, admin);
  const sameTeam = await pair(base, admin, eventId, { blue_team_id: TEAM_A });
  assert.equal(sameTeam.status, 400);
  assert.equal(sameTeam.body.error, 'same_team');

  const badSeries = await pair(base, admin, eventId, { series_id: 'bad series!' });
  assert.equal(badSeries.status, 400);
  assert.equal(badSeries.body.error, 'bad_series');

  const crossEvent = await pair(base, admin, eventId, { red_team_id: TEAM_C });
  assert.equal(crossEvent.status, 409);
  assert.equal(crossEvent.body.error, 'red_submission_not_locked', 'đội ngoài đợt không lộ dữ liệu');

  const first = await pair(base, admin, eventId, { note: 'Bán kết 1' });
  assert.equal(first.status, 202, JSON.stringify(first.body));
  assert.equal(first.body.pair.idempotent, false);
  assert.equal(first.body.pair.snapshot_hash.length, 64);
  assert.ok(first.body.pair.job_id);

  const match = store.manual_final_matches[0];
  assert.equal(match.red_submission_id, subs.get(TEAM_A));
  assert.equal(match.blue_submission_id, subs.get(TEAM_B));
  assert.equal(match.status, 'queued');
  assert.equal(match.snapshot_json.provenance, 'manual_final');
  assert.equal(match.snapshot_json.mapHash, match.map_hash);
  assert.equal(match.snapshot_json.red.submissionId, subs.get(TEAM_A));
  assert.ok(!JSON.stringify(match.snapshot_json).includes('github'), 'provenance không giả GitHub');
  assert.equal(store.manual_final_jobs.filter((job) => job.kind === 'match').length, 1);

  const repeat = await pair(base, admin, eventId, { note: 'Bán kết 1' });
  assert.equal(repeat.status, 200);
  assert.equal(repeat.body.pair.idempotent, true);
  assert.equal(repeat.body.pair.match_id, first.body.pair.match_id);
  assert.equal(store.manual_final_matches.length, 1, 'gọi lặp không tạo trận thứ 2');

  const view = await call(base, `/api/local/manual-finals/${eventId}`, { session: admin });
  assert.equal(view.body.readiness.matches.queued, 1);
  assert.equal(view.body.readiness.can_close, false);
  assert.ok(view.body.audit.some((entry) => entry.action === 'pair'));
});


test('hủy/chấm lại: bắt buộc lý do, giữ lịch sử, không hủy kết quả đã accepted, rerun cùng input', async (t) => {
  const { base, admin, store } = await start(t);
  const { eventId } = await lockedEvent(base, admin);
  const created = await pair(base, admin, eventId);
  const matchId = created.body.pair.match_id;
  const snapshotHash = created.body.pair.snapshot_hash;

  const noReason = await call(base, `/api/local/manual-finals/${eventId}/matches/${matchId}/cancel`, {
    method: 'POST', session: admin, body: { reason: 'ngắn' },
  });
  assert.equal(noReason.status, 400);
  assert.equal(noReason.body.error, 'reason_required');

  const canceled = await call(base, `/api/local/manual-finals/${eventId}/matches/${matchId}/cancel`, {
    method: 'POST', session: admin, body: { reason: 'Sai cặp đội do BTC chọn nhầm' },
  });
  assert.equal(canceled.status, 200, JSON.stringify(canceled.body));
  assert.equal(canceled.body.cancel.status, 'canceled');
  assert.equal(canceled.body.cancel.previous_status, 'queued');
  assert.equal(store.manual_final_matches[0].status, 'canceled');
  assert.equal(store.manual_final_jobs.find((job) => job.kind === 'match').status, 'canceled',
    'job đang chờ bị hủy, không chấm nữa');

  const cancelAgain = await call(base, `/api/local/manual-finals/${eventId}/matches/${matchId}/cancel`, {
    method: 'POST', session: admin, body: { reason: 'Hủy lặp do retry UI' },
  });
  assert.equal(cancelAgain.status, 200);
  assert.equal(cancelAgain.body.cancel.already_canceled, true);

  const rerun = await call(base, `/api/local/manual-finals/${eventId}/matches/${matchId}/rerun`, {
    method: 'POST', session: admin, body: { reason: 'Chấm lại sau khi hủy nhầm cặp' },
  });
  assert.equal(rerun.status, 202, JSON.stringify(rerun.body));
  assert.notEqual(rerun.body.rerun.match_id, matchId, 'rerun tạo trận mới, giữ trận cũ');
  assert.equal(rerun.body.rerun.rerun_of, matchId);
  assert.equal(rerun.body.rerun.snapshot_hash, snapshotHash, 'cùng snapshot/hash, không đổi input');
  const oldMatch = store.manual_final_matches.find((row) => row.id === matchId);
  assert.equal(oldMatch.status, 'canceled', 'trận cũ giữ nguyên kết quả lịch sử');

  const rerunAgain = await call(base, `/api/local/manual-finals/${eventId}/matches/${matchId}/rerun`, {
    method: 'POST', session: admin, body: { reason: 'Bấm lại nút chấm lại' },
  });
  assert.equal(rerunAgain.status, 202);
  assert.equal(rerunAgain.body.rerun.idempotent, true);
  assert.equal(rerunAgain.body.rerun.match_id, rerun.body.rerun.match_id);
  assert.equal(store.manual_final_matches.length, 2);

  // Kết quả accepted: không hủy để ghi đè.
  const claimed = await jobs.claimManualFinalJobs({ worker: 'judge-a', limit: 5 });
  const job = claimed.jobs.find((entry) => entry.kind === 'match');
  assert.ok(job, 'worker nhận job chấm của trận rerun');
  await jobs.finishManualFinalJob({
    jobId: job.jobId, token: job.token, generation: job.generation, kind: 'match',
    outcome: { status: 'finished', result: 'red_win', ply_count: 42, reason: 'capture',
      replay: { schemaVersion: 'campus-replay.v1', moves: [] } },
  });
  const conflict = await call(base, `/api/local/manual-finals/${eventId}/matches/${job.matchId}/cancel`, {
    method: 'POST', session: admin, body: { reason: 'Muốn đổi kết quả đã chấp nhận' },
  });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.error, 'result_conflict');
  const rerunFinished = await call(base, `/api/local/manual-finals/${eventId}/matches/${job.matchId}/rerun`, {
    method: 'POST', session: admin, body: { reason: 'Chấm lại trận đã có kết quả' },
  });
  assert.equal(rerunFinished.status, 409);
  assert.equal(rerunFinished.body.error, 'rerun_not_allowed');

  const audit = (await call(base, `/api/local/manual-finals/${eventId}`, { session: admin })).body.audit;
  assert.ok(audit.some((entry) => entry.action === 'cancel' && entry.reason));
});


test('kết quả: finish phải đúng fence, duplicate không nhân đôi, replay chỉ admin và chỉ khi accepted', async (t) => {
  const { base, admin, team, store } = await start(t);
  const { eventId } = await lockedEvent(base, admin);
  const created = await pair(base, admin, eventId);
  const matchId = created.body.pair.match_id;

  const notReady = await call(base, `/api/local/manual-finals/${eventId}/matches/${matchId}/replay`, { session: admin });
  assert.equal(notReady.status, 409);
  assert.equal(notReady.body.error, 'result_not_ready');

  const claim = await jobs.claimManualFinalJobs({ worker: 'judge-b', limit: 5 });
  const job = claim.jobs.find((entry) => entry.kind === 'match');
  assert.ok(job);
  const outcome = { status: 'finished', result: 'blue_win', ply_count: 37, reason: 'king_capture',
    replay: { schemaVersion: 'campus-replay.v1', seed: job.match.seed, moves: [{ ply: 1 }] } };

  const stale = await jobs.finishManualFinalJob({
    jobId: job.jobId, token: job.token, generation: job.generation + 5, kind: 'match', outcome,
  });
  assert.equal(stale.leaseLost, true, 'generation cũ không ghi được');
  assert.equal(store.manual_final_matches[0].status, 'running');
  assert.equal(store.manual_final_matches[0].result, null);

  const applied = await jobs.finishManualFinalJob({
    jobId: job.jobId, token: job.token, generation: job.generation, kind: 'match', outcome,
  });
  assert.equal(applied.applied, true);
  assert.equal(applied.alreadyFinished, false);
  assert.equal(applied.matchStatus, 'finished');
  assert.equal(applied.result, 'blue_win');
  assert.equal(applied.snapshotHash, created.body.pair.snapshot_hash);

  const duplicate = await jobs.finishManualFinalJob({
    jobId: job.jobId, token: job.token, generation: job.generation, kind: 'match', outcome,
  });
  assert.equal(duplicate.alreadyFinished, true, 'duplicate finish không ghi lần 2');
  assert.equal(store.manual_final_matches.filter((row) => row.status === 'finished').length, 1);

  const replay = await call(base, `/api/local/manual-finals/${eventId}/matches/${matchId}/replay`, { session: admin });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.match.result, 'blue_win');
  assert.equal(replay.body.match.ply_count, 37);
  assert.equal(replay.body.replay.schemaVersion, 'campus-replay.v1');

  const teamReplay = await call(base, `/api/local/manual-finals/${eventId}/matches/${matchId}/replay`, { session: team });
  assert.equal(teamReplay.status, 403);
  assert.equal(teamReplay.body.error, 'admin_required');

  const nextGame = await pair(base, admin, eventId, { series_id: 'sf1', game_no: 2 });
  assert.equal(nextGame.status, 202);
  const earlyClose = await call(base, `/api/local/manual-finals/${eventId}/close`, {
    method: 'POST', session: admin, body: { reason: 'Chốt sớm' },
  });
  assert.equal(earlyClose.status, 409);
  assert.equal(earlyClose.body.error, 'jobs_pending');

  await call(base, `/api/local/manual-finals/${eventId}/matches/${nextGame.body.pair.match_id}/cancel`, {
    method: 'POST', session: admin, body: { reason: 'Không cần ván 2' },
  });
  const closed = await call(base, `/api/local/manual-finals/${eventId}/close`, {
    method: 'POST', session: admin, body: { reason: 'BTC chốt kết quả vòng' },
  });
  assert.equal(closed.status, 200, JSON.stringify(closed.body));
  assert.equal(closed.body.event.status, 'closed');
  assert.ok(closed.body.event.closed_at);
  assert.ok(closed.body.audit.some((entry) => entry.action === 'close'));
  assert.equal(closed.body.readiness.can_close, false);
});


test('release: retry cùng snapshot rồi infra_fault; token cũ không ghi; cho phép rerun', async (t) => {
  const { base, admin, store } = await start(t);
  const { eventId } = await lockedEvent(base, admin);
  const created = await pair(base, admin, eventId);
  const snapshotHash = created.body.pair.snapshot_hash;

  const first = (await jobs.claimManualFinalJobs({ worker: 'judge-c', limit: 5 }))
    .jobs.find((entry) => entry.kind === 'match');
  const released = await jobs.releaseManualFinalJob({
    jobId: first.jobId, token: first.token, generation: first.generation,
    error: 'storage_unavailable', maxAttempts: 3,
  });
  assert.equal(released.ok, true);
  assert.equal(released.status, 'queued');
  const jobRow = store.manual_final_jobs.find((row) => row.kind === 'match');
  assert.equal(jobRow.status, 'queued');
  assert.equal(store.manual_final_matches[0].status, 'queued');
  assert.equal(store.manual_final_matches[0].snapshot_hash, snapshotHash, 'retry không đổi snapshot');

  // Cho phép claim lại ngay (backoff 15s) rồi kiểm token cũ bị fence.
  jobRow.available_at = '2000-01-01T00:00:00.000Z';
  const second = (await jobs.claimManualFinalJobs({ worker: 'judge-d', limit: 5 }))
    .jobs.find((entry) => entry.kind === 'match');
  assert.equal(second.generation, first.generation + 1);
  assert.equal(second.match.snapshot_hash, snapshotHash);
  const oldToken = await jobs.finishManualFinalJob({
    jobId: first.jobId, token: first.token, generation: first.generation, kind: 'match',
    outcome: { status: 'finished', result: 'draw', ply_count: 60, replay: { schemaVersion: 'campus-replay.v1' } },
  });
  assert.equal(oldToken.leaseLost, true, 'worker cũ không ghi đè');

  const failed = await jobs.releaseManualFinalJob({
    jobId: second.jobId, token: second.token, generation: second.generation,
    error: 'sandbox_crashed', maxAttempts: 2,
  });
  assert.equal(failed.status, 'infra_fault');
  assert.equal(store.manual_final_matches[0].status, 'infra_fault');
  assert.equal(store.manual_final_matches[0].result, null, 'lỗi hạ tầng không thành kết quả');

  const rerun = await call(base, `/api/local/manual-finals/${eventId}/matches/${created.body.pair.match_id}/rerun`, {
    method: 'POST', session: admin, body: { reason: 'Chấm lại sau lỗi hạ tầng sandbox' },
  });
  assert.equal(rerun.status, 202, JSON.stringify(rerun.body));
  assert.equal(rerun.body.rerun.snapshot_hash, snapshotHash);
});

test('tải source: chỉ BTC, đúng bytes/hash; không lộ storage_path; online upload của đội vẫn đóng', async (t) => {
  const { base, admin, team } = await start(t);
  const event = await createEvent(base, admin);
  const eventId = event.event.id;
  const uploaded = await upload(base, admin, eventId, TEAM_A);
  const submissionId = uploaded.body.submission.id;

  const source = await call(base, `/api/local/manual-finals/${eventId}/submissions/${submissionId}/source`, { session: admin });
  assert.equal(source.status, 200);
  assert.equal(source.body.raw, BOT_OK, 'trả đúng bytes đã hash');
  assert.equal(source.headers.get('x-source-sha256'), uploaded.body.submission.sha256);
  assert.equal(source.headers.get('cache-control'), 'no-store');

  const teamSource = await call(base, `/api/local/manual-finals/${eventId}/submissions/${submissionId}/source`, { session: team });
  assert.equal(teamSource.status, 403);
  assert.equal(teamSource.body.error, 'admin_required');

  const crossEvent = await call(base, `/api/local/manual-finals/${randomUUID()}/submissions/${submissionId}/source`, { session: admin });
  assert.equal(crossEvent.status, 404);

  // Đội online vẫn chỉ nộp qua GitHub: cổng upload chung không được mở bởi module manual.
  const legacyTeamUpload = await harness.uploadBot(base, { teamId: TEAM_A, session: team });
  assert.equal(legacyTeamUpload.status, 403);
  assert.equal(legacyTeamUpload.body.error, 'upload_disabled');
});

