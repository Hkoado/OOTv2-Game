import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { officialRouter } from '../server/routes/official.js';
import { HttpError } from '../server/lib/httpError.js';

const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const ROUND_ID = '22222222-2222-4222-8222-222222222222';
const TEAM_MEMBER = { id: 'user-team-1', role: 'team', participant_id: 'team-uuid-1' };
const TEAM_OUTSIDER = { id: 'user-team-2', role: 'team', participant_id: 'team-uuid-2' };
const ADMIN_USER = { id: 'admin-1', role: 'admin' };

function buildApp({ apiOverrides = {} } = {}) {
  const app = express();
  app.use(express.json());

  // Inject session account theo header x-test-user
  app.use((req, res, next) => {
    const roleHeader = req.headers['x-test-user'];
    if (roleHeader === 'admin') req.account = ADMIN_USER;
    else if (roleHeader === 'member') req.account = TEAM_MEMBER;
    else if (roleHeader === 'outsider') req.account = TEAM_OUTSIDER;
    // else anonymous: req.account = null
    next();
  });

  const mockApi = {
    findRound: async ({ eventId }) => (eventId === EVENT_ID ? ROUND_ID : null),
    setup: async () => ({ level: 'weekly' }),
    assertMember: async (eventId, account) => {
      if (account?.role === 'admin') return;
      if (account?.participant_id !== 'team-uuid-1') {
        throw new HttpError(403, 'scope_denied', 'Đội không thuộc giải này.');
      }
    },
    roundProgress: async () => ({ frozen: false }),
    groupStandings: async () => ({ complete: true, games: 12, groups: { A: [] } }),
    getRoundBroadcastStatuses: async () => [{ game_key: 'g1', isRevealed: true, isPublished: true, phase: 'ended' }],
    bracketProgress: async () => ({
      plan: {
        schemaVersion: 'campus-knockout.v1', level: 'weekly', seed: 42,
        qualifiers: [{ participantId: 'p1', groupName: 'A', seed: 1, rank: 1 }],
        bracket: { rounds: [{ stage: 'semifinal', matches: [{ id: 'sf1' }] }] },
      },
      expected: 1, resolved: 1, waiting: null, next: null,
      outcomes: { sf1: { complete: true, winnerParticipantId: 'p1', roundId: 'ko:semifinal:1' } },
    }),
    knockoutTickets: async () => {
      throw new HttpError(409, 'bracket_incomplete', 'Chưa xong bracket.');
    },
    listPublishedGames: async () => ({
      round_id: 'group', round_pk: ROUND_ID, event_id: EVENT_ID,
      games: [{ game_key: 'g1', broadcast: { phase: 'broadcasting', visible_plies: 5 } }],
    }),
    ...apiOverrides,
  };

  app.use(officialRouter({ api: mockApi }));

  // Error handler chuẩn
  app.use((err, req, res, next) => {
    res.status(err.status || 500).json({ error: err.code || 'internal_error', message: err.message });
  });

  return app;
}

async function request(app, method, path, { user, body } = {}) {
  const headers = {};
  if (user) headers['x-test-user'] = user;
  if (body) headers['content-type'] = 'application/json';

  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', async () => {
      const { port } = server.address();
      try {
        const response = await fetch(`http://127.0.0.1:${port}${path}`, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
        });
        const json = await response.json().catch(() => null);
        server.close(() => resolve({ status: response.status, body: json }));
      } catch (err) {
        server.close(() => reject(err));
      }
    });
  });
}

test('1. Anonymous truy cập các route published bị từ chối 401 login_required', async () => {
  const app = buildApp();
  const resStandings = await request(app, 'GET', `/events/${EVENT_ID}/official/published/standings`);
  assert.equal(resStandings.status, 401);
  assert.equal(resStandings.body.error, 'login_required');

  const resBracket = await request(app, 'GET', `/events/${EVENT_ID}/official/published/bracket`);
  assert.equal(resBracket.status, 401);

  const resTickets = await request(app, 'GET', `/events/${EVENT_ID}/official/published/tickets`);
  assert.equal(resTickets.status, 401);

  const resGames = await request(app, 'GET', `/events/${EVENT_ID}/official/published/games`);
  assert.equal(resGames.status, 401);
});

test('2. Đội thi ngoài giải bị từ chối 403 scope_denied', async () => {
  const app = buildApp();
  const res = await request(app, 'GET', `/events/${EVENT_ID}/official/published/standings`, { user: 'outsider' });
  assert.equal(res.status, 403);
  assert.equal(res.body.error, 'scope_denied');
});

test('3. Đội thi thuộc giải: khi vòng bảng chưa freeze thì nhận 409 round_not_published', async () => {
  const app = buildApp({
    apiOverrides: {
      roundProgress: async () => ({ frozen: false }),
    },
  });
  const res = await request(app, 'GET', `/events/${EVENT_ID}/official/published/standings`, { user: 'member' });
  assert.equal(res.status, 409);
  assert.equal(res.body.error, 'round_not_published');
});

test('4. Đội thi thuộc giải: khi vòng bảng đã freeze và đã phát sóng hết thì nhận standings published', async () => {
  const app = buildApp({
    apiOverrides: {
      roundProgress: async () => ({ frozen: true }),
      getRoundBroadcastStatuses: async () => [{ game_key: 'g1', isRevealed: true }],
      groupStandings: async () => ({ complete: true, games: 12, groups: { A: [] } }),
    },
  });
  const res = await request(app, 'GET', `/events/${EVENT_ID}/official/published/standings`, { user: 'member' });
  assert.equal(res.status, 200);
  assert.equal(res.body.published, true);
  assert.equal(res.body.complete, true);
  assert.equal(res.body.event_id, EVENT_ID);
});

test('5. Đội thi thuộc giải: bracket published chỉ mở khi vòng bảng đã freeze và phát sóng', async () => {
  const appFrozenFalse = buildApp({
    apiOverrides: { roundProgress: async () => ({ frozen: false }) },
  });
  const resDenied = await request(appFrozenFalse, 'GET', `/events/${EVENT_ID}/official/published/bracket`, { user: 'member' });
  assert.equal(resDenied.status, 409);
  assert.equal(resDenied.body.error, 'round_not_published');

  const appFrozenTrue = buildApp({
    apiOverrides: {
      roundProgress: async () => ({ frozen: true }),
      getRoundBroadcastStatuses: async () => [{ game_key: 'g1', isRevealed: true }],
    },
  });
  const resOk = await request(appFrozenTrue, 'GET', `/events/${EVENT_ID}/official/published/bracket`, { user: 'member' });
  assert.equal(resOk.status, 200);
  assert.equal(resOk.body.published, true);
  assert.equal(resOk.body.series.length, 1);
  assert.equal(resOk.body.series[0].match_id, 'sf1');
});

test('6. Đội thi thuộc giải: vé chung kết trả 409 tickets_not_published khi chưa hoàn thành', async () => {
  const appIncomplete = buildApp({
    apiOverrides: {
      knockoutTickets: async () => { throw new HttpError(409, 'bracket_incomplete', 'Chưa xong'); },
    },
  });
  const resIncomplete = await request(appIncomplete, 'GET', `/events/${EVENT_ID}/official/published/tickets`, { user: 'member' });
  assert.equal(resIncomplete.status, 409);
  assert.equal(resIncomplete.body.error, 'tickets_not_published');

  const appComplete = buildApp({
    apiOverrides: {
      knockoutTickets: async () => ({
        ranking: [{ participant_id: 'p1', rank: 1 }],
        tickets: { awarded: [{ participant_id: 'p1' }], reserves: [], vacant: 0 },
      }),
    },
  });
  const resComplete = await request(appComplete, 'GET', `/events/${EVENT_ID}/official/published/tickets`, { user: 'member' });
  assert.equal(resComplete.status, 200);
  assert.equal(resComplete.body.published, true);
  assert.equal(resComplete.body.tickets.awarded.length, 1);
});

test('7. Đội thi thuộc giải: lấy danh sách các ván đã công bố qua published/games', async () => {
  const app = buildApp();
  const res = await request(app, 'GET', `/events/${EVENT_ID}/official/published/games`, { user: 'member' });
  assert.equal(res.status, 200);
  assert.equal(res.body.published, true);
  assert.equal(res.body.games.length, 1);
  assert.equal(res.body.games[0].game_key, 'g1');
});

test('8. Đội thi gọi các route admin điều hành bị chặn 403 admin_required', async () => {
  const app = buildApp();
  const resProgress = await request(app, 'GET', `/events/${EVENT_ID}/official/progress`, { user: 'member' });
  assert.equal(resProgress.status, 403);
  assert.equal(resProgress.body.error, 'admin_required');

  const resPublish = await request(app, 'POST', `/events/${EVENT_ID}/official/publish`, { user: 'member', body: {} });
  assert.equal(resPublish.status, 403);
  assert.equal(resPublish.body.error, 'admin_required');
});

test('9. Broadcast state: kiểm tra phân quyền đội thi và anonymous', async () => {
  const app = buildApp({
    apiOverrides: {
      broadcastState: async ({ account }) => {
        if (!account) throw new HttpError(401, 'login_required', 'Cần đăng nhập.');
        if (account.role !== 'admin' && account.participant_id !== 'team-uuid-1') {
          throw new HttpError(403, 'scope_denied', 'Không thuộc giải.');
        }
        return {
          broadcast: { phase: 'broadcasting', visible_plies: 2, total_plies: 10, reveal_result: false },
          round_id: 'group',
          game: { game_key: 'g1' },
        };
      },
    },
  });

  // Anonymous: 401
  const resAnon = await request(app, 'GET', `/official/rounds/${ROUND_ID}/games/g1/broadcast`);
  assert.equal(resAnon.status, 401);

  // Outsider: 403
  const resOutsider = await request(app, 'GET', `/official/rounds/${ROUND_ID}/games/g1/broadcast`, { user: 'outsider' });
  assert.equal(resOutsider.status, 403);
  assert.equal(resOutsider.body.error, 'scope_denied');

  // Member: 200
  const resMember = await request(app, 'GET', `/official/rounds/${ROUND_ID}/games/g1/broadcast`, { user: 'member' });
  assert.equal(resMember.status, 200);
  assert.equal(resMember.body.broadcast.phase, 'broadcasting');

  // Admin: 200
  const resAdmin = await request(app, 'GET', `/official/rounds/${ROUND_ID}/games/g1/broadcast`, { user: 'admin' });
  assert.equal(resAdmin.status, 200);
});

test('10. H2: Standings bị từ chối 409 khi vòng bảng đã freeze nhưng broadcast chưa reveal', async () => {
  const appUnrevealed = buildApp({
    apiOverrides: {
      roundProgress: async () => ({ frozen: true }),
      getRoundBroadcastStatuses: async () => [
        { game_key: 'g1', isRevealed: false, phase: 'broadcasting' },
      ],
    },
  });
  const res = await request(appUnrevealed, 'GET', `/events/${EVENT_ID}/official/published/standings`, { user: 'member' });
  assert.equal(res.status, 409);
  assert.equal(res.body.error, 'round_not_published');
});

test('11. H2: Bracket giấu outcome của series knockout chưa phát sóng hoàn tất đối với đội thi', async () => {
  const appKnockoutPartial = buildApp({
    apiOverrides: {
      roundProgress: async () => ({ frozen: true }),
      getRoundBroadcastStatuses: async (roundId) => {
        // Vòng bảng đã reveal
        if (roundId === ROUND_ID) return [{ game_key: 'g1', isRevealed: true }];
        // Trận knockout sf1 chưa reveal (đang phát)
        return [{ game_key: 'ko_sf1_g1', isRevealed: false }];
      },
      bracketProgress: async () => ({
        plan: {
          schemaVersion: 'campus-knockout.v1', level: 'weekly', seed: 42,
          qualifiers: [{ participantId: 'p1', groupName: 'A', seed: 1, rank: 1 }],
          bracket: { rounds: [{ stage: 'semifinal', matches: [{ id: 'sf1' }] }] },
        },
        expected: 1, resolved: 1, waiting: null, next: null,
        outcomes: { sf1: { complete: true, winnerParticipantId: 'p1', roundId: 'ko:semifinal:1' } },
      }),
    },
  });

  // Đội thi: kết quả sf1 bị giấu khỏi series
  const resMember = await request(appKnockoutPartial, 'GET', `/events/${EVENT_ID}/official/published/bracket`, { user: 'member' });
  assert.equal(resMember.status, 200);
  assert.equal(resMember.body.series.length, 0, 'Series chưa reveal bị loại khỏi DTO');

  // Admin xem nội bộ qua admin route vẫn thấy
  const resAdmin = await request(appKnockoutPartial, 'GET', `/events/${EVENT_ID}/official/bracket`, { user: 'admin' });
  assert.equal(resAdmin.status, 200);
  assert.equal(resAdmin.body.series.length, 1);
});

test('12. H2: Tickets bị từ chối 409 khi có series knockout chưa hoàn tất broadcast', async () => {
  const appTicketsUnrevealed = buildApp({
    apiOverrides: {
      getRoundBroadcastStatuses: async (roundId) => {
        if (roundId === ROUND_ID) return [{ game_key: 'g1', isRevealed: true }];
        return [{ game_key: 'ko_g1', isRevealed: false }];
      },
      bracketProgress: async () => ({
        plan: {
          schemaVersion: 'campus-knockout.v1', level: 'weekly', seed: 42,
          qualifiers: [{ participantId: 'p1', groupName: 'A', seed: 1, rank: 1 }],
          bracket: { rounds: [{ stage: 'semifinal', matches: [{ id: 'sf1' }] }] },
        },
        expected: 1, resolved: 1, waiting: null, next: null,
        outcomes: { sf1: { complete: true, winnerParticipantId: 'p1', roundId: 'ko:semifinal:1' } },
      }),
      knockoutTickets: async () => ({
        ranking: [{ participant_id: 'p1', rank: 1 }],
        tickets: { awarded: [{ participant_id: 'p1' }], reserves: [], vacant: 0 },
      }),
    },
  });

  const res = await request(appTicketsUnrevealed, 'GET', `/events/${EVENT_ID}/official/published/tickets`, { user: 'member' });
  assert.equal(res.status, 409);
  assert.equal(res.body.error, 'tickets_not_published');
});
