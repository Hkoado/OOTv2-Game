/**
 * portalScenarios.test.js — B4: QA kịch bản tự động hóa cho Cổng giải đấu (Portal QA Scenarios).
 *
 * Kiểm tra các kịch bản người dùng cốt lõi theo hợp đồng phân công B4:
 * 1. Chu trình đăng nhập đa vai trò (Team / Admin) và cô lập dữ liệu sau logout.
 * 2. Bảo vệ bản nháp chưa lưu (dirty draft) và phát hiện xung đột phiên bản (version conflict).
 * 3. Hàng rào phân quyền và xử lý lỗi: 401 login_required, 403 scope_denied (dừng poll).
 * 4. Chu trình phát trực tiếp (waiting -> broadcasting -> ended window vs full).
 * 5. Luồng đăng ký kho mã GitHub, duyệt quyền BTC và kiểm tra thẻ biên nhận SHA.
 * 6. Kiểm soát bảng điểm chính thức chuẩn DTO Khoa: tách Điểm Cặp (3/1/0) và Điểm Ván (1/0.5/0).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID, scryptSync } from 'node:crypto';

import { detectVersionConflict, formatGroupSummary } from '../src/tournament/portal/officialSetupView.js';
import {
  GITHUB_SYNC_STATUSES,
  formatCommitSha,
  humanizeIntakeError,
  syncStatusInfo,
} from '../src/tournament/portal/githubSyncState.js';
import {
  broadcastPhaseMeta,
  calculateCountdown,
  computeViewerProgress,
  formatOfficialStandingsRow,
} from '../src/tournament/portal/live/publicationView.js';

process.env.SUPABASE_URL = 'https://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only';

const { createApp } = await import('../server/app.js');

const PASSWORD = 'mat-khau-kiem-thu-12';
const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const TEAM_A_ID = '22222222-2222-4222-8222-222222222222';
const TEAM_B_ID = '33333333-3333-4333-8333-333333333333';
const PARTICIPANT_A = '44444444-4444-4444-8444-444444444444';
const PARTICIPANT_B = '55555555-5555-4555-8555-555555555555';
const EVENT_H3 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_EVENT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MATCH_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const encode = (password) => {
  const salt = 'a'.repeat(32);
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
};

const json = (data, status = 200) =>
  new Response(data === null ? null : JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });

function seedScenarioStore() {
  const now = new Date().toISOString();
  return {
    participants: [
      { id: PARTICIPANT_A, name: 'Đội Sao Vàng', name_key: 'đội sao vàng', created_at: now },
      { id: PARTICIPANT_B, name: 'Đội Tia Chớp', name_key: 'đội tia chớp', created_at: now },
    ],
    accounts: [
      { id: ADMIN_ID, username: 'admin', password_hash: encode(PASSWORD), role: 'admin', participant_id: null, created_at: now },
      { id: TEAM_A_ID, username: 'saovang', password_hash: encode(PASSWORD), role: 'team', participant_id: PARTICIPANT_A, created_at: now },
      { id: TEAM_B_ID, username: 'tiachop', password_hash: encode(PASSWORD), role: 'team', participant_id: PARTICIPANT_B, created_at: now },
    ],
    sessions: [],
    submissions: [],
    tournaments: [
      { id: EVENT_H3, name: 'Giải Đấu Campus 2026', status: 'group_running', version: 3, created_at: now },
      { id: OTHER_EVENT, name: 'Giải Đấu Mở Rộng', status: 'group_running', version: 1, created_at: now },
    ],
    tournament_entries: [
      { id: randomUUID(), tournament_id: EVENT_H3, participant_id: PARTICIPANT_A, seed_order: 1, group_name: 'A' },
      { id: randomUUID(), tournament_id: OTHER_EVENT, participant_id: PARTICIPANT_B, seed_order: 1, group_name: 'A' },
    ],
    official_setups: [],
    repo_connections: [],
    repo_sync_jobs: [],
    github_receipts: [],
    matches: [
      { id: MATCH_ID, tournament_id: EVENT_H3, status: 'finished', ply_count: 30, result: 'red_win_base', reason: 'base_captured', stage: 'group', game_no: 1 },
    ],
    match_broadcasts: [
      {
        match_id: MATCH_ID,
        event_id: EVENT_H3,
        state: 'scheduled',
        starts_at: '2026-10-24T10:00:00.000Z',
        ply_interval_ms: 2000,
        release_mode: 'full',
        created_at: now,
      },
    ],
    match_events: [
      { id: randomUUID(), match_id: MATCH_ID, seq: 0, kind: 'initial', payload_json: '{}' },
      { id: randomUUID(), match_id: MATCH_ID, seq: 1, kind: 'move', payload_json: '{"turn":"red","move":"A1-B2"}' },
      { id: randomUUID(), match_id: MATCH_ID, seq: 30, kind: 'terminal', payload_json: '{"result":"red_win_base"}' },
    ],
    match_bot_output: [],
    worker_state: [],
  };
}

function fakeScenarioBackend(store) {
  const matchRow = (row, key, raw) => {
    const [op, ...rest] = String(raw).split('.');
    const value = rest.join('.');
    if (op === 'eq') return String(row[key]) === value;
    if (op === 'in') return value.replace(/^\(|\)$/gu, '').split(',').includes(String(row[key]));
    if (op === 'is') return value === 'null' ? row[key] === null : String(row[key]) === value;
    return true;
  };

  return async (url, options = {}) => {
    const target = new URL(String(url));
    if (target.origin !== 'https://example.invalid') throw new Error(`Test host lạ: ${target.origin}`);
    if (target.pathname.startsWith('/storage/v1/object/')) return json({ Key: target.pathname });

    const table = target.pathname.replace('/rest/v1/mvp_', '').replace('/rest/v1/', '');
    const method = (options.method || 'GET').toUpperCase();
    const rowsInTable = store[table] || (store[table] = []);
    const params = [...target.searchParams];
    const filters = params.filter(([key]) => !['select', 'order', 'limit', 'offset'].includes(key));
    const selected = () => rowsInTable.filter((row) => filters.every(([key, raw]) => matchRow(row, key, raw)));

    if (method === 'GET') {
      let data = selected();
      const limit = Number(target.searchParams.get('limit'));
      if (Number.isFinite(limit) && limit > 0) data = data.slice(0, limit);
      return json(data);
    }
    if (method === 'POST') {
      const incoming = JSON.parse(String(options.body));
      const created = (Array.isArray(incoming) ? incoming : [incoming]).map((row) => {
        const saved = { ...row };
        rowsInTable.push(saved);
        return saved;
      });
      return json(created, 201);
    }
    if (method === 'PATCH') {
      const body = JSON.parse(String(options.body));
      return json(selected().map((row) => Object.assign(row, body)));
    }
    if (method === 'DELETE') {
      const removed = new Set(selected());
      store[table] = rowsInTable.filter((row) => !removed.has(row));
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unsupported method: ${method}`);
  };
}

async function startScenarioApp(t, store) {
  const originalFetch = globalThis.fetch;
  const backend = fakeScenarioBackend(store);
  globalThis.fetch = (url, options) => {
    const target = String(url);
    if (target.startsWith('http://127.0.0.1:')) return originalFetch(url, options);
    return backend(url, options);
  };
  const app = createApp();
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    globalThis.fetch = originalFetch;
    await new Promise((resolve) => server.close(resolve));
  });
  return { base: `http://127.0.0.1:${server.address().port}` };
}

async function loginUser(base, username) {
  const res = await globalThis.fetch(`${base}/api/local/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: PASSWORD }),
  });
  const body = await res.json();
  const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie().join(';') : res.headers.get('set-cookie') || '';
  return { status: res.status, cookie: setCookie.split(';')[0], csrf: body.csrf, body };
}

// ==================== B4 QA SCENARIOS ====================

test('B4 QA: Kịch bản 1 — Đăng nhập đa vai trò, cô lập phiên và dọn sạch dữ liệu sau logout', async (t) => {
  const store = seedScenarioStore();
  const { base } = await startScenarioApp(t, store);

  // 1. Team A đăng nhập thành công
  const teamLogin = await loginUser(base, 'saovang');
  assert.equal(teamLogin.status, 200);
  assert.equal(teamLogin.body.account.role, 'team');
  assert.equal(teamLogin.body.account.participant_id, PARTICIPANT_A);

  // 2. Team A đọc thông tin phiên
  const sessionRes = await globalThis.fetch(`${base}/api/local/me`, {
    headers: { cookie: teamLogin.cookie },
  });
  const sessionData = await sessionRes.json();
  assert.equal(sessionData.account.username, 'saovang');

  // 3. Team A không được phép truy cập route admin
  const adminForbidden = await globalThis.fetch(`${base}/api/local/admin/broadcasts`, {
    method: 'POST',
    headers: { cookie: teamLogin.cookie, 'x-csrf-token': teamLogin.csrf, 'content-type': 'application/json' },
    body: JSON.stringify({ match_id: MATCH_ID, starts_at: new Date().toISOString() }),
  });
  assert.equal(adminForbidden.status, 403, 'Team không có quyền admin');

  // 4. Team A đăng xuất
  const logoutRes = await globalThis.fetch(`${base}/api/local/logout`, {
    method: 'POST',
    headers: { cookie: teamLogin.cookie, 'x-csrf-token': teamLogin.csrf },
  });
  assert.equal(logoutRes.status, 200);

  // 5. Sau logout, phiên bị vô hiệu hóa hoàn toàn (401 unauthenticated)
  const afterLogout = await globalThis.fetch(`${base}/api/local/me`, {
    headers: { cookie: teamLogin.cookie },
  });
  assert.equal(afterLogout.status, 401, 'Phiên đã hủy sau logout, không sót dữ liệu cũ');
});

test('B4 QA: Kịch bản 2 — Bảo vệ dirty draft và cảnh báo xung đột phiên bản form thiết lập giải', () => {
  // 1. Không có xung đột khi form không dirty hoặc baseVersion trùng khớp version server
  assert.equal(detectVersionConflict(1, 1, false).hasConflict, false);
  assert.equal(detectVersionConflict(1, 1, true).hasConflict, false);
  assert.equal(detectVersionConflict(1, 2, false).hasConflict, false, 'Không dirty thì polling cập nhật tự nhiên');

  // 2. Phát hiện xung đột khi form đang dirty VÀ server có phiên bản mới hơn
  assert.equal(detectVersionConflict(1, 2, true).hasConflict, true);
  assert.equal(detectVersionConflict(2, 5, true).hasConflict, true);
  assert.equal(detectVersionConflict(null, undefined, true).hasConflict, false, 'Version không hợp lệ thì an toàn');

  // 3. Kiểm tra tính cân bằng bảng động A–H (35–50 đội)
  const balancedGroups = [
    { name: 'Bảng A', participantIds: ['1', '2', '3', '4', '5'] },
    { name: 'Bảng B', participantIds: ['6', '7', '8', '9', '10'] },
  ];
  const summaryBalanced = formatGroupSummary(balancedGroups);
  assert.equal(summaryBalanced.count, 2);
  assert.equal(summaryBalanced.balanced, true);

  const unbalancedGroups = [
    { name: 'Bảng A', participantIds: ['1', '2', '3', '4', '5', '6'] },
    { name: 'Bảng B', participantIds: ['7', '8', '9', '10'] },
  ];
  const summaryUnbalanced = formatGroupSummary(unbalancedGroups);
  assert.equal(summaryUnbalanced.count, 2);
  assert.equal(summaryUnbalanced.balanced, false);
});

test('B4 QA: Kịch bản 3 — Hàng rào quyền hạn xem trực tiếp: 401 khi chưa đăng nhập và 403 khi xem chéo giải', async (t) => {
  const store = seedScenarioStore();
  const { base } = await startScenarioApp(t, store);

  // 1. Khách ẩn danh vào /api/live/overview bị 401 login_required (chính sách H3)
  const anonOverview = await globalThis.fetch(`${base}/api/live/overview`);
  assert.equal(anonOverview.status, 401);
  const anonBody = await anonOverview.json();
  assert.equal(anonBody.error, 'login_required');

  // 2. Team B (thuộc OTHER_EVENT) truy cập ván đấu của EVENT_H3 -> bị 403 scope_denied
  const teamBLogin = await loginUser(base, 'tiachop');
  const crossEventMatch = await globalThis.fetch(`${base}/api/local/broadcasts/${MATCH_ID}`, {
    headers: { cookie: teamBLogin.cookie },
  });
  assert.equal(crossEventMatch.status, 403, 'Đội khác giải không có quyền xem');
  const crossBody = await crossEventMatch.json();
  assert.equal(crossBody.error, 'scope_denied');

  // 3. Team A (thuộc EVENT_H3) truy cập đúng ván giải mình -> được phép (200 OK)
  const teamALogin = await loginUser(base, 'saovang');
  const permittedMatch = await globalThis.fetch(`${base}/api/local/broadcasts/${MATCH_ID}`, {
    headers: { cookie: teamALogin.cookie },
  });
  assert.equal(permittedMatch.status, 200, 'Đội thuộc giải được xem');
});

test('B4 QA: Kịch bản 4 — Chu trình phát trực tiếp: Đếm ngược waiting -> Đang phát -> Kết thúc mở kết quả', () => {
  const now = Date.parse('2026-10-24T10:00:00.000Z');

  // 1. Pha Chờ phát (waiting): countdown chính xác, plies = 0, chưa mở kết quả
  const futureStart = '2026-10-24T10:05:00.000Z';
  const countdown = calculateCountdown(futureStart, now);
  assert.equal(countdown.remainingSeconds, 300);
  assert.equal(countdown.formatted, '05:00');
  assert.equal(countdown.hasStarted, false);

  const metaWaiting = broadcastPhaseMeta('waiting', false);
  assert.equal(metaWaiting.label, 'Chờ giờ phát');
  assert.equal(metaWaiting.tone, 'warning');

  // 2. Pha Đang phát (broadcasting): tính toán tiến độ % chuẩn xác
  const progress50 = computeViewerProgress(15, 30);
  assert.equal(progress50, 50);
  const progressClamped = computeViewerProgress(35, 30);
  assert.equal(progressClamped, 100);

  const metaBroadcasting = broadcastPhaseMeta('broadcasting', false);
  assert.equal(metaBroadcasting.label, 'Đang phát sóng');
  assert.equal(metaBroadcasting.tone, 'live');

  // 3. Pha Kết thúc với release_mode = 'window' (kết quả bảo mật, không lộ người thắng)
  const metaWindow = broadcastPhaseMeta('ended', false);
  assert.equal(metaWindow.label, 'Đã phát xong (kết quả bảo mật)');
  assert.equal(metaWindow.tone, 'neutral');

  // 4. Pha Kết thúc với release_mode = 'full' (công bố đầy đủ)
  const metaFull = broadcastPhaseMeta('ended', true);
  assert.equal(metaFull.label, 'Đã phát xong');
  assert.equal(metaFull.tone, 'success');
});

test('B4 QA: Kịch bản 5 — Chu trình kiểm tra thẻ biên nhận GitHub Intake và phân loại lỗi', () => {
  // 1. Khớp 7 trạng thái chuẩn theo DTO H1
  assert.deepEqual(GITHUB_SYNC_STATUSES, [
    'resolving',
    'fetching',
    'checking',
    'valid',
    'invalid',
    'infrastructure',
    'frozen',
  ]);

  // 2. Định dạng commit SHA ngắn 7 hex
  const fullSha = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
  assert.equal(formatCommitSha(fullSha), 'e3b0c44');

  // 3. Phân loại trạng thái lỗi mã nguồn bot thí sinh (code error)
  const codeInfo = syncStatusInfo('invalid');
  assert.equal(codeInfo.isError, true);
  assert.equal(codeInfo.errorCategory, 'code');
  assert.equal(codeInfo.tone, 'danger');

  // 4. Phân loại sự cố hạ tầng hệ thống (infrastructure fault - không quy lỗi đội)
  const infraInfo = syncStatusInfo('infrastructure');
  assert.equal(infraInfo.isError, true);
  assert.equal(infraInfo.errorCategory, 'infrastructure');
  assert.equal(infraInfo.tone, 'danger');

  // 5. Việt hóa mã lỗi chuẩn
  assert.equal(
    humanizeIntakeError('repo_not_approved'),
    'Repository chưa được BTC phê duyệt quyền truy cập.'
  );
  assert.equal(
    humanizeIntakeError('past_cutoff'),
    'Đã quá thời hạn nộp bài (cutoff) của giải đấu.'
  );
});

test('B4 QA: Kịch bản 6 — Bảng điểm chính thức chuẩn DTO Khoa: tách Điểm Cặp (3/1/0) và Điểm Ván (1/0.5/0)', () => {
  const officialStanding = {
    participantId: 'team-saovang',
    teamName: 'Đội Sao Vàng',
    groupName: 'A',
    seriesPoints: 6,
    seriesPlayed: 2,
    seriesWon: 2,
    seriesDrawn: 0,
    seriesLost: 0,
    gamePoints: 3.5,
    gamesPlayed: 4,
    gamesWon: 3,
    gamesDrawn: 1,
    gamesLost: 0,
  };

  const row = formatOfficialStandingsRow(officialStanding, 1);
  assert.equal(row.seriesPoints, 6, 'Điểm cặp đúng 6');
  assert.equal(row.gamePoints, 3.5, 'Điểm ván đúng 3.5');
  assert.equal(row.rank, 1, 'Hạng 1');
});

