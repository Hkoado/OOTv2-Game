import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';

test('judge monitor: sanitized logs, worker heartbeat, admin-only read API', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'oot-judge-monitor-'));
  process.env.OOTV2_DATA_DIR = dir;
  process.env.OOTV2_DB_PATH = path.join(dir, 'judge.sqlite');
  const { initDb, closeDb, getDb, nowIso } = await import('../server/db.js');
  const { createAccount, initAccounts } = await import('../server/services/localAccounts.js');
  const { createApp } = await import('../server/app.js');
  const { recordResult, workerLabel } = await import('../server/worker.js');
  const { getJudgeMatch, getJudgeOverview, heartbeatWorker } = await import('../server/services/judgeMonitor.js');
  const { sanitizeNote, buildJudgeOverview } = await import('../server/services/judgeView.js');

  // Phần thuần: ghi chú bị lọc đường dẫn tuyệt đối, giữ nội dung chẩn đoán.
  const dirty = 'Bot lỗi tại C:\\Users\\Admin\\AppData\\Local\\oot\\bot.py và /tmp/oot/bot.py\nstderr: Traceback';
  const clean = sanitizeNote(dirty);
  assert.equal(clean.includes('C:\\'), false);
  assert.equal(clean.includes('/tmp'), false);
  assert.match(clean, /\[path\]/);
  assert.equal(clean.includes('\n'), false);
  assert.equal(sanitizeNote('x'.repeat(600)).length, 401);

  const pure = buildJudgeOverview({
    matches: [
      { id: 'm1', stage: 'group', series_id: 'g1', game_no: 1, status: 'running', started_at: '2026-10-22T10:00:00.000Z' },
      { id: 'm2', stage: 'group', series_id: 'g1', game_no: 2, status: 'finished', result: 'draw', reason: 'move_limit', started_at: '2026-10-22T10:00:00.000Z', finished_at: '2026-10-22T10:00:05.000Z' },
    ],
    logs: new Map([['m2', { notes_json: '["đạt giới hạn"]', elapsed_ms: 5000, worker: 'w1' }]]),
    nowMs: Date.parse('2026-10-22T10:00:10.000Z'),
  });
  assert.deepEqual(pure.counts, { total: 2, pending: 0, running: 1, finished: 1, failed: 0 });
  assert.equal(pure.stages[0].total, 2);
  assert.equal(pure.active[0].elapsed_ms, 10000);
  assert.equal(pure.recent[0].log.notes[0], 'đạt giới hạn');

  initDb();
  initAccounts();
  const admin = await createAccount({ username: 'judge-admin', password: 'judge-admin-password', role: 'admin' });
  const team = await createAccount({ username: 'judge-team', password: 'judge-team-password', name: 'Đội Judge' });
  const rival = await createAccount({ username: 'judge-rival', password: 'judge-rival-password', name: 'Đội Rival' });
  assert(admin.id && team.participant_id && rival.participant_id);

  const db = getDb();
  const tournamentId = 'evt-judge';
  const redEntry = 'entry-red';
  const blueEntry = 'entry-blue';
  const startedAt = nowIso();
  db.prepare('INSERT INTO tournaments (id,name,status,seed,created_at,started_at) VALUES (?,?,?,?,?,?)')
    .run(tournamentId, 'Giải quan sát', 'group_running', 7, startedAt, startedAt);
  db.prepare('INSERT INTO tournament_entries (id,tournament_id,participant_id,seed_order) VALUES (?,?,?,?)')
    .run(redEntry, tournamentId, team.participant_id, 1);
  db.prepare('INSERT INTO tournament_entries (id,tournament_id,participant_id,seed_order) VALUES (?,?,?,?)')
    .run(blueEntry, tournamentId, rival.participant_id, 2);

  const matchId = 'match-with-log';
  const legacyId = 'match-legacy';
  const insert = db.prepare(
    `INSERT INTO matches (id,tournament_id,stage,series_id,game_no,red_entry_id,blue_entry_id,seed,status,result,reason,ply_count,replay_json,started_at,finished_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  );
  insert.run(matchId, tournamentId, 'group', 'g1', 1, redEntry, blueEntry, 11, 'running', null, null, null, null, startedAt, null);
  insert.run(legacyId, tournamentId, 'group', 'g1', 2, blueEntry, redEntry, 12, 'finished', 'red_win', 'forfeit_move', 3, '{}',
    startedAt, new Date(Date.now() + 1000).toISOString());

  const outcome = {
    result: 'blue_win',
    reason: 'forfeit_move',
    winner: 'blue',
    ply_count: 5,
    notes: [`bot Đỏ lỗi nước đi (illegal_move): nước không hợp lệ tại C:\\Users\\Admin\\oot\\bot.py`],
    replay: { protocol_version: 'bot.v1', match_id: matchId, seed: 11, initial_pieces: [], events: [] },
  };
  assert.equal(recordResult(matchId, outcome, { worker: 'test-worker', elapsedMs: 1234 }), true);
  assert.equal(recordResult(matchId, outcome, { worker: 'test-worker' }), false, 'không ghi lại ván đã xong');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM match_logs').get().n, 1);

  const [logRow] = db.prepare('SELECT * FROM match_logs WHERE match_id=?').all(matchId);
  assert.equal(logRow.worker, 'test-worker');
  assert.equal(logRow.elapsed_ms, 1234);
  assert.equal(logRow.error.includes('C:\\'), false);
  assert.equal(JSON.parse(logRow.notes_json)[0].includes('C:\\'), false);

  heartbeatWorker({ workerId: workerLabel() });
  const overview = getJudgeOverview({ eventId: tournamentId });
  assert.equal(overview.driver, 'sqlite');
  assert.deepEqual(overview.counts, { total: 2, pending: 0, running: 0, finished: 2, failed: 2 });
  assert.equal(overview.stages[0].failed, 2);
  assert.equal(overview.worker.alive, true);
  assert.equal(overview.issues.length, 2);
  assert.equal(overview.recent[0].id, legacyId, 'ván mới xong nhất đứng đầu');
  assert.equal(overview.recent.find((row) => row.id === legacyId).log, null, 'ván cũ chưa có nhật ký');
  assert.equal(overview.logs_available, true);
  assert.equal(overview.limits.max_plies, 200);

  const detail = getJudgeMatch(matchId);
  assert.equal(detail.match.log.notes.length, 1);
  assert.match(detail.match.log.notes[0], /\[path\]/);
  assert.equal(detail.replay_available, true);
  assert.throws(() => getJudgeMatch('missing-match'));

  const server = createApp().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;

  async function api(route, { method = 'GET', body, session } = {}) {
    const headers = { Accept: 'application/json' };
    if (session) {
      headers.cookie = session.cookie;
      headers['x-csrf-token'] = session.csrf;
    }
    if (body) headers['Content-Type'] = 'application/json';
    const response = await fetch(`${base}/api${route}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const payload = await response.json().catch(() => ({}));
    return { status: response.status, payload };
  }

  async function signIn(username, password) {
    const response = await fetch(`${base}/api/local/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    return { cookie: response.headers.get('set-cookie').split(';')[0], csrf: payload.csrf };
  }

  try {
    assert.equal((await api('/local/admin/judge')).status, 401);
    const adminSession = await signIn('judge-admin', 'judge-admin-password');
    const judge = await api('/local/admin/judge', { session: adminSession });
    assert.equal(judge.status, 200);
    assert.equal(judge.payload.event.id, tournamentId);
    assert.equal(judge.payload.counts.failed, 2);
    assert.equal(judge.payload.worker.alive, true);

    const detailResponse = await api(`/local/admin/judge/matches/${matchId}`, { session: adminSession });
    assert.equal(detailResponse.status, 200);
    assert.equal(detailResponse.payload.match.log.worker, 'test-worker');
    assert.equal(detailResponse.payload.replay_available, true);

    const teamSession = await signIn('judge-team', 'judge-team-password');
    assert.equal((await api('/local/admin/judge', { session: teamSession })).status, 403);
    assert.equal((await api(`/local/admin/judge/matches/${matchId}`, { session: teamSession })).status, 403);
    assert.equal((await api('/local/admin/judge?event=missing', { session: adminSession })).status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    closeDb();
    rmSync(dir, { recursive: true, force: true });
  }
});
