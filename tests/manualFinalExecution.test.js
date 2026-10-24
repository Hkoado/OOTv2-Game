/**
 * manualFinalExecution.test.js — Consumer worker queue Chung kết thủ công (mock, không DB/Python).
 *
 * Bảo vệ contract Huy ↔ Khoa:
 * - `validate`: static UTF-8/size → protocol smoke Campus v2 trong session sandbox → finish valid/invalid.
 * - `match`: snapshot pin (schema/provenance/event/vòng/ván/seed/map/runtime) + đúng submission đã khóa.
 * - Phân loại lỗi: bot/input là kết quả (không retry mù), Storage/sandbox retry cùng input,
 *   lỗi không hồi phục dừng ở `infra_fault`; `lease_lost` không bao giờ tính là đã ghi.
 * - Bot lỗi ngay setup (0 ply) ghi `bot_fault` thay vì bịa kết quả/đổi sang hạ tầng.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';

import { contentHash, mapHash } from '../server/contracts/canonical.js';
import { HttpError } from '../server/lib/httpError.js';
import { ArtifactDownloadError } from '../server/shared/artifactDownload.js';
import { CampusInfrastructureError } from '../server/judge/campusTrustedSession.js';
import { BotProtocolError } from '../server/contracts/botProtocol.js';
import { createOfficialRuntimeIdentity } from '../server/judge/officialRuntime.js';
import { SAMPLE_MAPS } from '../src/game/sampleMaps.js';
import { executeManualFinalJob, verifyManualSnapshot } from '../server/services/manualFinalExecution.js';

const MAP = SAMPLE_MAPS[0].map;
const RUNTIME = createOfficialRuntimeIdentity();
const EVENT = '11111111-1111-4111-8111-111111111111';
const RED_TEAM = '22222222-2222-4222-8222-222222222222';
const BLUE_TEAM = '33333333-3333-4333-8333-333333333333';
const RED_SUB = '44444444-4444-4444-8444-444444444444';
const BLUE_SUB = '55555555-5555-4555-8555-555555555555';
const MATCH = '66666666-6666-4666-8666-666666666666';
const SOURCE = 'print("campus bot")\n';
const SHA = createHash('sha256').update(Buffer.from(SOURCE, 'utf8')).digest('hex');
/** Bot test giả lập bot.v1 hợp lệ: xếp 9 ô theo `availableSquaresByType`, đi nước hợp lệ đầu tiên. */
function placementsFrom(observation) {
  const used = new Set();
  return observation.unplaced.map((piece) => {
    const squares = observation.availableSquaresByType?.[piece.type] || observation.availableSquares;
    const square = squares.find((candidate) => !used.has(candidate));
    used.add(square);
    return { pieceId: piece.id, square };
  });
}

function fakeFactory({ onSetup } = {}) {
  const factory = async ({ name }) => ({
    profile: `test-${name}`, metrics: () => ({ cpuMeasured: false, memoryMeasured: false }),
    async request(request) {
      if (request.kind === 'setup') {
        if (onSetup) {
          const override = onSetup(request);
          if (override !== undefined) return { placements: override };
        }
        return { placements: placementsFrom(request.game) };
      }
      const move = request.game.legalMoves?.[0];
      if (!move) throw new BotProtocolError('ILLEGAL_MOVE', 'no legal move');
      return move;
    },
    async close() {},
  });
  factory.mode = 'trusted-dev';
  return factory;
}

function validateJob(overrides = {}) {
  return {
    jobId: randomUUID(), kind: 'validate', eventId: EVENT, roundNo: 1,
    submissionId: RED_SUB, matchId: null, inputHash: SHA, token: randomUUID(),
    generation: 1, attempt: 1, match: null,
    submission: { id: RED_SUB, team_id: RED_TEAM, storage_path: `${RED_SUB}.py`,
      sha256: SHA, byte_size: Buffer.byteLength(SOURCE) },
    ...overrides,
  };
}

function pinnedSnapshot(overrides = {}) {
  const snapshot = {
    schemaVersion: 'manual-final-match.v1', provenance: 'manual_final', eventId: EVENT,
    roundNo: 1, seriesId: 'FINAL', gameNo: 1, seed: 12345, mapHash: mapHash(MAP), map: MAP,
    runtime: RUNTIME, colorPolicy: 'manual-final.red-first.v1',
    red: { teamId: RED_TEAM, submissionId: RED_SUB, sha256: SHA,
      byteSize: Buffer.byteLength(SOURCE), filename: 'bot.py',
      receivedAt: '2026-10-24T00:00:00.000Z', sourceKind: 'manual_final' },
    blue: { teamId: BLUE_TEAM, submissionId: BLUE_SUB, sha256: SHA,
      byteSize: Buffer.byteLength(SOURCE), filename: 'bot.py',
      receivedAt: '2026-10-24T00:00:00.000Z', sourceKind: 'manual_final' },
    ...overrides,
  };
  return snapshot;
}

function matchJob(overrides = {}) {
  const snapshot = overrides.snapshot ?? pinnedSnapshot();
  const snapshotHash = contentHash(snapshot);
  const match = {
    id: MATCH, series_id: 'FINAL', game_no: 1, red_team_id: RED_TEAM, blue_team_id: BLUE_TEAM,
    red_submission_id: RED_SUB, blue_submission_id: BLUE_SUB, map_hash: mapHash(MAP),
    seed: 12345, snapshot_hash: snapshotHash, snapshot,
    ...overrides.match,
  };
  return {
    jobId: randomUUID(), kind: 'match', eventId: EVENT, roundNo: 1, submissionId: null,
    matchId: MATCH, inputHash: match.snapshot_hash, token: randomUUID(), generation: 2,
    attempt: 1, submission: null, match,
  };
}

function downloads(bytes = Buffer.from(SOURCE, 'utf8')) {
  const calls = [];
  const download = async (key, options) => {
    calls.push({ key, options });
    if (bytes instanceof Error) throw bytes;
    return bytes;
  };
  return { download, calls };
}

function submissionRow(id, teamId) {
  return { id, event_id: EVENT, team_id: teamId, storage_path: `${id}.py`, sha256: SHA,
    byte_size: Buffer.byteLength(SOURCE), status: 'valid', locked_at: '2026-10-24T00:00:00.000Z' };
}

function recorder() {
  const finishes = [];
  const releases = [];
  return {
    finishes, releases,
    finish: async (payload) => { finishes.push(payload); return { applied: true, alreadyFinished: false }; },
    release: async (payload) => { releases.push(payload); return { ok: true, status: 'queued' }; },
  };
}

test('verifyManualSnapshot chấp nhận snapshot pin đúng, từ chối mọi sai lệch', () => {
  const good = verifyManualSnapshot(matchJob(), { identity: RUNTIME });
  assert.equal(good.snapshot.seriesId, 'FINAL');
  assert.equal(good.match.snapshot_hash, contentHash(pinnedSnapshot()));

  const base = pinnedSnapshot();
  const cases = {
    snapshot_schema_mismatch: matchJob({ snapshot: pinnedSnapshot({ schemaVersion: 'manual-final-match.v0' }) }),
    provenance_mismatch: matchJob({ snapshot: pinnedSnapshot({ provenance: 'github' }) }),
    map_hash_mismatch: matchJob({ snapshot: pinnedSnapshot({ mapHash: 'a'.repeat(64) }) }),
    runtime_mismatch: matchJob({ snapshot: pinnedSnapshot({ runtime: { ...RUNTIME, budgetHash: 'b'.repeat(64) } }) }),
    red_submission_mismatch: matchJob({ snapshot: pinnedSnapshot({ red: { ...base.red, submissionId: BLUE_SUB } }) }),
  };
  for (const [expected, job] of Object.entries(cases)) {
    assert.throws(() => verifyManualSnapshot(job, { identity: RUNTIME }),
      (error) => error.code === expected, `phải từ chối: ${expected}`);
  }
});

test('validate: artifact đúng hash + bot Campus v2 hợp lệ → finish valid', async () => {
  const { download, calls } = downloads();
  const rec = recorder();
  const result = await executeManualFinalJob(validateJob(), {
    download, finish: rec.finish, release: rec.release,
    startSessionFactory: fakeFactory, identity: RUNTIME,
  });
  assert.equal(result.status, 'valid');
  assert.equal(result.recorded, true);
  assert.equal(calls[0].key, `${RED_SUB}.py`);
  assert.equal(rec.releases.length, 0);
  assert.deepEqual(rec.finishes[0].outcome, { status: 'valid', source_hash: SHA });
});

test('validate: file nhị phân bị từ chối trước khi khởi động bot', async () => {
  const binary = Buffer.from([0x70, 0x00, 0x71]);
  const binaryHash = createHash('sha256').update(binary).digest('hex');
  const job = validateJob({
    inputHash: binaryHash,
    submission: { id: RED_SUB, team_id: RED_TEAM, storage_path: `${RED_SUB}.py`,
      sha256: binaryHash, byte_size: binary.length },
  });
  const { download } = downloads(binary);
  const rec = recorder();
  let factoryCalls = 0;
  const factory = async () => { factoryCalls += 1; throw new Error('không được chạy bot'); };
  const result = await executeManualFinalJob(job, { download, finish: rec.finish, release: rec.release,
    startSessionFactory: factory, identity: RUNTIME });
  assert.equal(result.status, 'invalid');
  assert.equal(result.reason, 'binary_file');
  assert.equal(factoryCalls, 0);
  assert.equal(rec.finishes[0].outcome.status, 'invalid');
});

test('validate: bot xếp sai → invalid và không retry', async () => {
  const { download } = downloads();
  const rec = recorder();
  const result = await executeManualFinalJob(validateJob(), {
    download, finish: rec.finish, release: rec.release, identity: RUNTIME,
    startSessionFactory: () => fakeFactory({ onSetup: () => [] }),
  });
  assert.equal(result.status, 'invalid');
  assert.equal(result.reason, 'INVALID_SETUP');
  assert.equal(rec.releases.length, 0);
  assert.equal(rec.finishes[0].outcome.status, 'invalid');
});

test('validate: lỗi Storage là hạ tầng, retry cùng input chứ không kết luận bot sai', async () => {
  const { download } = downloads(new ArtifactDownloadError('storage_unavailable'));
  const rec = recorder();
  const result = await executeManualFinalJob(validateJob(), {
    download, finish: rec.finish, release: rec.release, identity: RUNTIME,
    startSessionFactory: fakeFactory,
  });
  assert.equal(result.recorded, false);
  assert.equal(result.status, 'queued');
  assert.match(rec.releases[0].error, /artifact_unavailable/u);
  assert.equal(rec.releases[0].maxAttempts, undefined);
  assert.equal(rec.finishes.length, 0);
});


test('match: snapshot pin + hai bài đã khóa → accepted result có replay', async () => {
  const { download, calls } = downloads();
  const rec = recorder();
  let captured;
  const runMatch = async (input) => {
    captured = input;
    return { result: 'red_win', reason: 'BASE_REACHED', plyCount: 12,
      replay: { schemaVersion: 'campus-replay.v1', actions: [] } };
  };
  const result = await executeManualFinalJob(matchJob(), {
    download, finish: rec.finish, release: rec.release, runMatch, identity: RUNTIME,
    startSessionFactory: fakeFactory,
    loadSubmission: async ({ id }) => (id === RED_SUB
      ? submissionRow(RED_SUB, RED_TEAM) : submissionRow(BLUE_SUB, BLUE_TEAM)),
  });
  assert.equal(result.status, 'finished');
  assert.equal(result.result, 'red_win');
  assert.equal(result.plyCount, 12);
  assert.equal(result.recorded, true);
  assert.equal(calls.length, 2);
  assert.equal(captured.seed, 12345);
  assert.equal(mapHash(captured.map), mapHash(MAP));
  assert.equal(captured.red.name, RED_TEAM);
  assert.equal(captured.blue.name, BLUE_TEAM);
  const outcome = rec.finishes[0].outcome;
  assert.equal(outcome.status, 'finished');
  assert.equal(outcome.result, 'red_win');
  assert.equal(outcome.ply_count, 12);
  assert.equal(outcome.replay.schemaVersion, 'campus-replay.v1');
});

test('match: bot lỗi ngay setup (0 ply) ghi bot_fault, không bịa kết quả', async () => {
  const { download } = downloads();
  const rec = recorder();
  const result = await executeManualFinalJob(matchJob(), {
    download, finish: rec.finish, release: rec.release, identity: RUNTIME,
    startSessionFactory: fakeFactory,
    runMatch: async () => ({ result: 'red_win', reason: 'INVALID_SETUP', plyCount: 0,
      replay: { schemaVersion: 'campus-replay.v1', actions: [] } }),
    loadSubmission: async ({ id }) => (id === RED_SUB
      ? submissionRow(RED_SUB, RED_TEAM) : submissionRow(BLUE_SUB, BLUE_TEAM)),
  });
  assert.equal(result.status, 'bot_fault');
  assert.equal(rec.finishes[0].outcome.status, 'bot_fault');
  assert.equal(rec.finishes[0].outcome.error, 'setup_bot_fault');
});

test('match: snapshot bị sửa → dừng ở infra_fault, không tải bài, không chạy bot', async () => {
  const { download, calls } = downloads();
  const rec = recorder();
  const result = await executeManualFinalJob(
    matchJob({ snapshot: pinnedSnapshot({ provenance: 'github' }) }),
    { download, finish: rec.finish, release: rec.release, identity: RUNTIME,
      runMatch: async () => assert.fail('không được chạy bot') });
  assert.equal(result.recorded, false);
  assert.equal(result.reason, 'provenance_mismatch');
  assert.equal(calls.length, 0);
  assert.equal(rec.releases[0].maxAttempts, 1);
});

test('match: source lệch hash là lỗi không hồi phục (infra_fault)', async () => {
  const tampered = Buffer.alloc(Buffer.byteLength(SOURCE), 0x23);
  const { download } = downloads(tampered);
  const rec = recorder();
  const result = await executeManualFinalJob(matchJob(), {
    download, finish: rec.finish, release: rec.release, identity: RUNTIME,
    startSessionFactory: fakeFactory,
    runMatch: async () => assert.fail('không được chạy bot'),
    loadSubmission: async ({ id }) => (id === RED_SUB
      ? submissionRow(RED_SUB, RED_TEAM) : submissionRow(BLUE_SUB, BLUE_TEAM)),
  });
  assert.equal(result.recorded, false);
  assert.equal(result.reason, 'source_hash_mismatch');
  assert.equal(rec.releases[0].maxAttempts, 1);
});

test('match: lease đã mất thì không tính là đã ghi kết quả', async () => {
  const { download } = downloads();
  const releases = [];
  const result = await executeManualFinalJob(matchJob(), {
    download, identity: RUNTIME, startSessionFactory: fakeFactory,
    finish: async () => ({ applied: false, alreadyFinished: false, leaseLost: true }),
    release: async (payload) => { releases.push(payload); return { ok: true, status: 'queued' }; },
    runMatch: async () => ({ result: 'blue_win', reason: 'BASE_REACHED', plyCount: 7,
      replay: { schemaVersion: 'campus-replay.v1', actions: [] } }),
    loadSubmission: async ({ id }) => (id === RED_SUB
      ? submissionRow(RED_SUB, RED_TEAM) : submissionRow(BLUE_SUB, BLUE_TEAM)),
  });
  assert.equal(result.recorded, false);
  assert.equal(result.status, 'lease_lost');
  assert.equal(releases.length, 0);
});

test('match: worker shutdown giữa ván → release cùng input, không có kết quả', async () => {
  const { download } = downloads();
  const rec = recorder();
  const controller = new AbortController();
  const result = await executeManualFinalJob(matchJob(), {
    download, finish: rec.finish, release: rec.release, identity: RUNTIME,
    startSessionFactory: fakeFactory, signal: controller.signal,
    runMatch: async () => { controller.abort(); throw new CampusInfrastructureError('match_cancelled'); },
    loadSubmission: async ({ id }) => (id === RED_SUB
      ? submissionRow(RED_SUB, RED_TEAM) : submissionRow(BLUE_SUB, BLUE_TEAM)),
  });
  assert.equal(result.recorded, false);
  assert.equal(result.reason, 'worker_shutdown');
  assert.equal(rec.releases[0].error, 'worker_shutdown');
  assert.equal(rec.finishes.length, 0);
});


test('match: DB từ chối outcome (4xx) → dừng infra_fault, không requeue vô hạn', async () => {
  const { download } = downloads();
  const releases = [];
  const result = await executeManualFinalJob(matchJob(), {
    download, identity: RUNTIME, startSessionFactory: fakeFactory,
    finish: async () => { throw new HttpError(400, 'bad_outcome', 'DB từ chối'); },
    release: async (payload) => { releases.push(payload); return { ok: true, status: 'infra_fault' }; },
    runMatch: async () => ({ result: 'red_win', reason: 'BASE_REACHED', plyCount: 9,
      replay: { schemaVersion: 'campus-replay.v1', actions: [] } }),
    loadSubmission: async ({ id }) => (id === RED_SUB
      ? submissionRow(RED_SUB, RED_TEAM) : submissionRow(BLUE_SUB, BLUE_TEAM)),
  });
  assert.equal(result.recorded, false);
  assert.equal(result.status, 'infra_fault');
  assert.equal(result.reason, 'bad_outcome');
  assert.equal(releases[0].maxAttempts, 1);
});

