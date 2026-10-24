/**
 * manual-worker-drill.js — Drill 2 worker cho queue Chung kết thủ công.
 *
 * Chạy **đúng** worker loop + executor thật (`runOfficialWorker` →
 * `processManualFinalJob` → `executeManualFinalJob`); chỉ thay lớp I/O (DB/Storage/Python)
 * bằng queue in-memory mô phỏng đúng semantics của `20261026100000_manual_final.sql`:
 * - claim: requeue job `running` hết lease, chọn `queued` theo (created_at, id), cấp token +
 *   `generation + 1` + `attempt + 1` (tương đương `FOR UPDATE SKIP LOCKED` vì claim là atomic);
 * - finish: terminal → `already_finished`; sai token/generation → `lease_lost`; chưa terminal
 *   thì mới ghi đúng MỘT kết quả;
 * - release: chưa quá `max_attempts` thì về `queued` + backoff, quá thì `infra_fault`.
 *
 * Mục tiêu: chứng minh không chấm trùng, không ghi kết quả khi mất lease, retry giữ nguyên
 * input, và hai worker tranh job chỉ tạo một kết quả accepted.
 *
 *   node tools/cli/manual-worker-drill.js            # in PASS/FAIL từng kịch bản
 *   node tools/cli/manual-worker-drill.js --json out.json
 *
 * Đây là drill **hợp đồng + code path thật**, không thay thế drill VM/DB thật
 * (xem docs/DRILL-MANUAL-WORKER.md).
 */

import { createHash, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { contentHash, mapHash } from '../../server/contracts/canonical.js';
import { HttpError } from '../../server/lib/httpError.js';
import { CampusInfrastructureError } from '../../server/judge/campusTrustedSession.js';
import { createOfficialRuntimeIdentity } from '../../server/judge/officialRuntime.js';
import { createQueueProcessor, processManualFinalJob, runOfficialWorker }
  from '../../server/officialWorker.js';
import { executeManualFinalJob } from '../../server/services/manualFinalExecution.js';
import { SAMPLE_MAPS } from '../../src/game/sampleMaps.js';

export const DRILL_VERSION = 'manual-worker-drill.v1';
/** Source giả lập: UTF-8 hợp lệ để `validate` đi qua static check (không chạy Python). */
export const SOURCE = Buffer.from('print("campus drill bot")\n', 'utf8');
export const SHA = createHash('sha256').update(SOURCE).digest('hex');
const MAP = SAMPLE_MAPS[0].map;
const MAP_HASH = mapHash(MAP);
const RUNTIME = createOfficialRuntimeIdentity();
const TERMINAL = new Set(['completed', 'bot_fault', 'infra_fault']);
const uuid = () => randomUUID();
const quietLogger = { log() {}, warn() {}, error() {} };

/** Session giả: trả setup hợp lệ theo `availableSquaresByType` và nước đi hợp lệ đầu tiên. */
function placementsFrom(observation) {
  const used = new Set();
  return observation.unplaced.map((piece) => {
    const squares = observation.availableSquaresByType?.[piece.type] || observation.availableSquares;
    const square = squares.find((candidate) => !used.has(candidate));
    used.add(square);
    return { pieceId: piece.id, square };
  });
}

function fakeSessionFactory({ onSetup } = {}) {
  const factory = async ({ name }) => ({
    profile: `drill-${name}`, metrics: () => ({ cpuMeasured: false, memoryMeasured: false }),
    async request(request) {
      if (request.kind === 'setup') {
        const override = onSetup?.(request);
        return { placements: override ?? placementsFrom(request.game) };
      }
      const move = request.game.legalMoves?.[0];
      if (!move) throw new Error('no legal move');
      return move;
    },
    async close() {},
  });
  // Huy's factory gate: chỉ opt-in trusted-dev mới được truyền trusted=true.
  factory.mode = 'trusted-dev';
  factory.trustedDev = true;
  return factory;
}

/** Snapshot pin cho job `match`, cùng shape `server/services/manualFinal.js` tạo. */
export function drillSnapshot() {
  return {
    schemaVersion: 'manual-final-match.v1', provenance: 'manual_final',
    eventId: uuid(), roundNo: 1, seriesId: 'R1', gameNo: 1, seed: 424242,
    mapHash: MAP_HASH, map: MAP, runtime: RUNTIME, colorPolicy: 'manual-final.red-first.v1',
    red: { teamId: uuid(), submissionId: uuid(), sha256: SHA, byteSize: SOURCE.length,
      filename: 'bot.py', receivedAt: '2026-10-24T00:00:00.000Z', sourceKind: 'manual_final' },
    blue: { teamId: uuid(), submissionId: uuid(), sha256: SHA, byteSize: SOURCE.length,
      filename: 'bot.py', receivedAt: '2026-10-24T00:00:00.000Z', sourceKind: 'manual_final' },
  };
}

export function drillMatchJob(overrides = {}) {
  const snapshot = overrides.snapshot ?? drillSnapshot();
  const match = {
    id: uuid(), series_id: snapshot.seriesId, game_no: snapshot.gameNo,
    red_team_id: snapshot.red.teamId, blue_team_id: snapshot.blue.teamId,
    red_submission_id: snapshot.red.submissionId, blue_submission_id: snapshot.blue.submissionId,
    map_hash: MAP_HASH, seed: snapshot.seed, snapshot_hash: contentHash(snapshot), snapshot,
  };
  return {
    jobId: uuid(), kind: 'match', eventId: snapshot.eventId, roundNo: snapshot.roundNo,
    submissionId: null, matchId: match.id, inputHash: match.snapshot_hash, token: null,
    generation: 0, attempt: 0, submission: null, match,
  };
}

export function drillValidateJob() {
  const submissionId = uuid();
  return {
    jobId: uuid(), kind: 'validate', eventId: uuid(), roundNo: 1, submissionId,
    matchId: null, inputHash: SHA, token: null, generation: 0, attempt: 0, match: null,
    submission: { id: submissionId, team_id: uuid(), storage_path: `${uuid()}.py`,
      sha256: SHA, byte_size: SOURCE.length },
  };
}

/**
 * Queue in-memory mô phỏng SQL `mvp_manual_final_*`. Không DB/network/Python.
 * `claim` đồng bộ (không await) nên tương đương `FOR UPDATE SKIP LOCKED`: hai loop chỉ chen
 * nhau ở các `await` của executor.
 */
export function createDrillQueue({ jobs = [], maxAttempts = 3, leaseSeconds = 60 } = {}) {
  const clock = { ms: Date.parse('2026-10-24T00:00:00.000Z') };
  const rows = new Map(jobs.map((job) => [job.jobId, {
    ...job, status: 'queued', leaseToken: null, leaseUntil: null, workerId: null,
    generation: 0, attempt: 0, availableAt: clock.ms, maxAttempts, result: null,
    replay: null, error: null,
  }]));
  const artifacts = new Map();
  const submissions = new Map();
  const executions = [];
  const accepted = [];

  /** Đăng ký submission đã khóa đúng như bảng SQL để executor đọc lại theo ID. */
  const registerFromJob = (job) => {
    const side = (entry) => {
      if (!entry?.submissionId) return;
      submissions.set(entry.submissionId, { id: entry.submissionId, event_id: job.eventId,
        team_id: entry.teamId, storage_path: `${entry.submissionId}.py`, sha256: entry.sha256,
        byte_size: entry.byteSize, status: 'valid', locked_at: '2026-10-24T00:00:00.000Z' });
    };
    if (job.kind === 'match' && job.match?.snapshot) {
      side(job.match.snapshot.red);
      side(job.match.snapshot.blue);
    }
    if (job.kind === 'validate' && job.submission) {
      submissions.set(job.submission.id, { id: job.submission.id, event_id: job.eventId,
        team_id: job.submission.team_id, storage_path: job.submission.storage_path,
        sha256: job.submission.sha256, byte_size: job.submission.byte_size, status: 'valid',
        locked_at: '2026-10-24T00:00:00.000Z' });
    }
  };
  for (const job of jobs) registerFromJob(job);

  const toDto = (row) => ({
    jobId: row.jobId, kind: row.kind, eventId: row.eventId, roundNo: row.roundNo,
    submissionId: row.submissionId, matchId: row.matchId, inputHash: row.inputHash,
    token: row.leaseToken, generation: row.generation, attempt: row.attempt,
    submission: row.submission ? { ...row.submission } : null,
    match: row.match ? { ...row.match, snapshot: structuredClone(row.match.snapshot) } : null,
  });

  return {
    clock,
    rows,
    executions,
    accepted,
    now: () => clock.ms,
    advance: (ms) => { clock.ms += ms; },
    enqueue: (job) => {
      registerFromJob(job);
      rows.set(job.jobId, { ...job, status: 'queued', leaseToken: null, leaseUntil: null,
        workerId: null, generation: 0, attempt: 0, availableAt: clock.ms, maxAttempts,
        result: null, replay: null, error: null });
      return job.jobId;
    },
    row: (jobId) => rows.get(jobId),
    /** Claim: requeue lease hết hạn → chọn queued theo thứ tự → cấp token/generation/attempt. */
    claim: ({ worker, limit = 1, leaseSeconds: lease }) => {
      if (typeof worker !== 'string' || !worker.trim()) throw new HttpError(400, 'bad_worker', 'worker trống');
      const seconds = Math.min(900, Math.max(10, Number(lease) || leaseSeconds));
      for (const row of rows.values()) {
        if (row.status === 'running' && row.leaseUntil !== null && row.leaseUntil <= clock.ms) {
          row.status = 'queued'; row.leaseToken = null; row.leaseUntil = null;
        }
      }
      const picked = [...rows.values()]
        .filter((row) => row.status === 'queued' && row.availableAt <= clock.ms)
        .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
        .slice(0, Math.min(5, Math.max(1, limit)));
      const claimed = picked.map((row) => {
        row.status = 'running';
        row.leaseToken = uuid();
        row.leaseUntil = clock.ms + seconds * 1000;
        row.generation += 1;
        row.attempt += 1;
        row.workerId = worker.trim();
        return toDto(row);
      });
      return { jobs: claimed };
    },
    /** Fence đúng như SQL: terminal → already_finished; sai token/generation → lease_lost. */
    finish: async ({ jobId, token, generation, kind, outcome }) => {
      const row = rows.get(jobId);
      if (!row) throw new HttpError(400, 'job_not_found', 'job không tồn tại');
      if (TERMINAL.has(row.status)) {
        return { applied: false, alreadyFinished: true, leaseLost: false,
          jobStatus: row.status, matchStatus: row.result };
      }
      if (row.leaseToken !== token || row.generation !== generation) {
        return { applied: false, alreadyFinished: false, leaseLost: true,
          jobStatus: row.status, matchStatus: null };
      }
      if (row.status === 'canceled') throw new HttpError(400, 'job_canceled', 'job đã hủy');
      if (kind === 'validate') {
        if (!['valid', 'invalid', 'infrastructure'].includes(outcome?.status)) {
          throw new HttpError(400, 'bad_outcome', 'outcome validate sai');
        }
        if (outcome.status === 'valid' && outcome.source_hash !== row.submission?.sha256) {
          throw new HttpError(400, 'source_hash_mismatch', 'hash lệch');
        }
        row.status = outcome.status === 'valid' ? 'completed'
          : outcome.status === 'invalid' ? 'bot_fault' : 'infra_fault';
        row.error = outcome.status === 'valid' ? null : (outcome.error ?? 'bot_validation_failed');
      } else {
        if (!['finished', 'bot_fault', 'infra_fault'].includes(outcome?.status)) {
          throw new HttpError(400, 'bad_outcome', 'outcome match sai');
        }
        if (outcome.status === 'finished') {
          if (!['red_win', 'blue_win', 'draw'].includes(outcome.result)
            || !Number.isInteger(outcome.ply_count) || outcome.ply_count < 1
            || !outcome.replay || typeof outcome.replay !== 'object') {
            throw new HttpError(400, 'bad_outcome', 'outcome finished thiếu result/ply/replay');
          }
          row.status = 'completed';
          row.result = outcome.result;
          row.replay = outcome.replay;
          accepted.push({ jobId, result: outcome.result, plyCount: outcome.ply_count,
            replayHash: contentHash(outcome.replay), worker: row.workerId, generation });
        } else {
          row.status = outcome.status;
          row.error = outcome.error ?? outcome.status;
        }
      }
      row.leaseToken = null;
      row.leaseUntil = null;
      return { applied: true, alreadyFinished: false, leaseLost: false,
        jobStatus: row.status, matchStatus: row.result };
    },
    /** Hết lượt thử → infra_fault; còn lượt → queued + backoff, giữ nguyên input. */
    release: async ({ jobId, token, generation, error = null, maxAttempts: limit }) => {
      const row = rows.get(jobId);
      if (!row) throw new HttpError(400, 'job_not_found', 'job không tồn tại');
      if (row.leaseToken !== token || row.generation !== generation) {
        return { ok: false, leaseLost: true, status: null, attempt: null };
      }
      if (!['queued', 'running'].includes(row.status)) {
        return { ok: false, leaseLost: false, status: row.status, attempt: row.attempt };
      }
      const cap = Math.min(10, Math.max(1, Number(limit) || row.maxAttempts || 3));
      row.error = String(error ?? 'manual_final_infrastructure').slice(0, 200);
      if (row.attempt >= cap || row.attempt >= row.maxAttempts) {
        row.status = 'infra_fault';
        row.leaseToken = null; row.leaseUntil = null;
        return { ok: true, leaseLost: false, status: 'infra_fault', attempt: row.attempt };
      }
      row.status = 'queued';
      row.leaseToken = null; row.leaseUntil = null;
      row.availableAt = clock.ms + Math.min(300, 15 * Math.max(row.attempt, 1)) * 1000;
      return { ok: true, leaseLost: false, status: 'queued', attempt: row.attempt,
        availableAt: new Date(row.availableAt).toISOString() };
    },
    setArtifact: (key, buffer) => artifacts.set(key, buffer),
    download: async (key) => artifacts.get(key) ?? SOURCE,
    loadSubmission: async ({ id, eventId }) => submissions.get(id) ?? {
      id, event_id: eventId, team_id: null, storage_path: `${id}.py`, sha256: SHA,
      byte_size: SOURCE.length, status: 'valid', locked_at: '2026-10-24T00:00:00.000Z',
    },
    registerSubmission: (row) => submissions.set(row.id, row),
    startSessionFactory: () => fakeSessionFactory(),
    runMatch: async () => ({ result: 'red_win', reason: 'BASE_REACHED', plyCount: 12,
      replay: { schemaVersion: 'campus-replay.v1', actions: [] } }),
  };
}

/** Chạy N worker **thật** (`runOfficialWorker` → `processManualFinalJob` → executor thật). */
export async function runDrillWorkers({ queue, workers = ['manual-drill-a', 'manual-drill-b'],
  runMatch, startSessionFactory } = {}) {
  const run = async (workerId) => {
    const processor = createQueueProcessor({
      queues: ['manual'],
      handlers: {
        manual: (context) => processManualFinalJob({ ...context, claim: queue.claim,
          execute: async (job) => {
            queue.executions.push({ jobId: job.jobId, worker: workerId, attempt: job.attempt,
              generation: job.generation, inputHash: job.inputHash });
            return executeManualFinalJob(job, {
              download: queue.download, finish: queue.finish, release: queue.release,
              loadSubmission: queue.loadSubmission,
              runMatch: runMatch ?? queue.runMatch,
              startSessionFactory: startSessionFactory ?? queue.startSessionFactory,
              identity: RUNTIME, logger: quietLogger,
            });
          } }),
      },
    });
    return runOfficialWorker({ workerId, queues: ['manual'], drain: true,
      leaseSeconds: 120, manualLeaseSeconds: 120, pause: async () => {},
      processJob: processor, logger: quietLogger });
  };
  return Promise.all(workers.map((workerId) => run(workerId)));
}

/** Executor cho một job cụ thể (dùng khi cần điều khiển tay thứ tự claim/finish). */
export function drillExecute(queue, overrides = {}) {
  return (job) => executeManualFinalJob(job, {
    download: queue.download, finish: queue.finish, release: queue.release,
    loadSubmission: queue.loadSubmission, runMatch: queue.runMatch,
    startSessionFactory: queue.startSessionFactory, identity: RUNTIME,
    logger: quietLogger, ...overrides,
  });
}

const ok = (name, pass, detail) => ({ name, pass: pass === true, detail });

/** Kịch bản 1: hai worker tranh cùng một job → chỉ một lần chấm và một kết quả. */
async function scenarioSingleWinner() {
  const job = drillMatchJob();
  const queue = createDrillQueue({ jobs: [{ ...job, createdAt: 1 }] });
  await runDrillWorkers({ queue });
  const row = queue.row(job.jobId);
  const executions = queue.executions.filter((item) => item.jobId === job.jobId);
  return ok('2 worker tranh 1 job: chấm 1 lần, 1 accepted', row.status === 'completed'
    && queue.accepted.length === 1 && executions.length === 1,
  { status: row.status, accepted: queue.accepted.length, executions: executions.length });
}

/** Kịch bản 2: worker cũ mất lease không ghi được; worker mới ghi đúng một kết quả. */
async function scenarioLeaseSteal() {
  const job = drillMatchJob();
  const queue = createDrillQueue({ jobs: [{ ...job, createdAt: 1 }] });
  const stale = queue.claim({ worker: 'manual-drill-a', leaseSeconds: 60 }).jobs[0];
  queue.advance(61_000);
  const fresh = queue.claim({ worker: 'manual-drill-b', leaseSeconds: 60 }).jobs[0];
  const staleResult = await drillExecute(queue)(stale);
  const freshResult = await drillExecute(queue)(fresh);
  const row = queue.row(job.jobId);
  return ok('lease bị lấy: worker cũ lease_lost, chỉ worker mới ghi', staleResult.recorded === false
    && staleResult.status === 'lease_lost' && freshResult.recorded === true
    && queue.accepted.length === 1 && queue.accepted[0].worker === 'manual-drill-b'
    && fresh.generation === stale.generation + 1 && row.status === 'completed',
  { stale: staleResult.status, fresh: freshResult.status, accepted: queue.accepted.length,
    generation: { stale: stale.generation, fresh: fresh.generation } });
}

/** Kịch bản 3: lỗi sandbox → release retry, worker khác chấm lại đúng snapshot cũ. */
async function scenarioRetrySameInput() {
  const job = drillMatchJob();
  const queue = createDrillQueue({ jobs: [{ ...job, createdAt: 1 }] });
  const first = queue.claim({ worker: 'manual-drill-a', leaseSeconds: 60 }).jobs[0];
  let attempts = 0;
  const flaky = async (input) => {
    attempts += 1;
    if (attempts === 1) throw new CampusInfrastructureError('sandbox_unavailable');
    return { result: 'blue_win', reason: 'TYPE_ELIMINATED', plyCount: 9,
      replay: { schemaVersion: 'campus-replay.v1', actions: [{ ply: 9 }] } };
  };
  const firstResult = await drillExecute(queue, { runMatch: flaky })(first);
  queue.advance(20_000);
  const second = queue.claim({ worker: 'manual-drill-b', leaseSeconds: 60 }).jobs[0];
  const secondResult = await drillExecute(queue, { runMatch: flaky })(second);
  const row = queue.row(job.jobId);
  return ok('lỗi sandbox: retry cùng input, chỉ 1 accepted', firstResult.recorded === false
    && firstResult.status === 'queued' && second.inputHash === first.inputHash
    && contentHash(second.match.snapshot) === job.inputHash && second.attempt === 2
    && secondResult.recorded === true && row.status === 'completed'
    && queue.accepted.length === 1 && queue.accepted[0].result === 'blue_win',
  { first: firstResult.status, second: secondResult.status, attempt: second.attempt,
    accepted: queue.accepted.length });
}


/** Kịch bản 4: lỗi hạ tầng lặp lại → dừng ở infra_fault, không có kết quả cho đội. */
async function scenarioAttemptCap() {
  const job = drillMatchJob();
  const queue = createDrillQueue({ jobs: [{ ...job, createdAt: 1 }], maxAttempts: 2 });
  const failing = async () => { throw new CampusInfrastructureError('sandbox_unavailable'); };
  const statuses = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const claimed = queue.claim({ worker: `manual-drill-${attempt}`, leaseSeconds: 60 }).jobs[0];
    statuses.push((await drillExecute(queue, { runMatch: failing })(claimed)).status);
    queue.advance(20_000);
  }
  const row = queue.row(job.jobId);
  return ok('hết lượt retry: infra_fault, 0 accepted', row.status === 'infra_fault'
    && queue.accepted.length === 0 && statuses[0] === 'queued',
  { status: row.status, statuses, accepted: queue.accepted.length });
}

/** Kịch bản 5: mất response rồi finish lại → already_finished, không nhân đôi kết quả. */
async function scenarioDuplicateFinish() {
  const job = drillMatchJob();
  const queue = createDrillQueue({ jobs: [{ ...job, createdAt: 1 }] });
  const claimed = queue.claim({ worker: 'manual-drill-a', leaseSeconds: 60 }).jobs[0];
  await drillExecute(queue)(claimed);
  const duplicate = await queue.finish({ jobId: job.jobId, token: claimed.token,
    generation: claimed.generation, kind: 'match',
    outcome: { status: 'finished', result: 'red_win', reason: 'BASE_REACHED', ply_count: 12,
      replay: { schemaVersion: 'campus-replay.v1', actions: [] } } });
  return ok('finish lặp: already_finished, 1 accepted', duplicate.alreadyFinished === true
    && duplicate.applied === false && queue.accepted.length === 1,
  { duplicate, accepted: queue.accepted.length });
}

/** Kịch bản 6: hai job + hai worker → mỗi job chấm đúng một lần, hai kết quả riêng. */
async function scenarioTwoJobs() {
  const jobs = [drillMatchJob(), drillMatchJob()];
  const queue = createDrillQueue({ jobs: jobs.map((job, index) => ({ ...job, createdAt: index + 1 })) });
  await runDrillWorkers({ queue });
  const perJob = jobs.map((job) => queue.executions.filter((item) => item.jobId === job.jobId).length);
  const acceptedJobs = new Set(queue.accepted.map((item) => item.jobId));
  return ok('2 job / 2 worker: mỗi job 1 lần chấm, 2 accepted', perJob.every((count) => count === 1)
    && queue.accepted.length === 2 && acceptedJobs.size === 2,
  { perJob, accepted: queue.accepted.length });
}




/** Kịch bản 7: validate file nhị phân → invalid, không chạy bot, không có kết quả trận. */
async function scenarioValidateInvalid() {
  const binary = Buffer.from([0x70, 0x00, 0x71]);
  const hash = createHash('sha256').update(binary).digest('hex');
  const base = drillValidateJob();
  const job = { ...base, inputHash: hash,
    submission: { ...base.submission, sha256: hash, byte_size: binary.length } };
  const queue = createDrillQueue({ jobs: [{ ...job, createdAt: 1 }] });
  queue.setArtifact(job.submission.storage_path, binary);
  let factoryCalls = 0;
  const factory = () => { factoryCalls += 1; return fakeSessionFactory(); };
  const claimed = queue.claim({ worker: 'manual-drill-a', leaseSeconds: 60 }).jobs[0];
  const result = await drillExecute(queue, { startSessionFactory: factory })(claimed);
  const row = queue.row(job.jobId);
  return ok('validate nhị phân: invalid, không khởi động bot, 0 kết quả trận',
    result.status === 'invalid' && row.status === 'bot_fault' && factoryCalls === 0
      && queue.accepted.length === 0,
    { result: result.status, row: row.status, factoryCalls });
}

/** Kịch bản 8: validate bot Campus v2 hợp lệ → valid, không tạo kết quả trận. */
async function scenarioValidateValid() {
  const job = drillValidateJob();
  const queue = createDrillQueue({ jobs: [{ ...job, createdAt: 1 }] });
  const claimed = queue.claim({ worker: 'manual-drill-a', leaseSeconds: 60 }).jobs[0];
  const result = await drillExecute(queue)(claimed);
  const row = queue.row(job.jobId);
  return ok('validate hợp lệ: valid, 0 kết quả trận', result.status === 'valid'
    && row.status === 'completed' && queue.accepted.length === 0,
  { result: result.status, row: row.status });
}

/** Kịch bản 9: bot lỗi setup (0 ply) → bot_fault, không bịa winner/không accepted. */
async function scenarioSetupBotFault() {
  const job = drillMatchJob();
  const queue = createDrillQueue({ jobs: [{ ...job, createdAt: 1 }] });
  const claimed = queue.claim({ worker: 'manual-drill-a', leaseSeconds: 60 }).jobs[0];
  const result = await drillExecute(queue, {
    runMatch: async () => ({ result: 'red_win', reason: 'INVALID_SETUP', plyCount: 0,
      replay: { schemaVersion: 'campus-replay.v1', actions: [] } }),
  })(claimed);
  const row = queue.row(job.jobId);
  return ok('bot lỗi setup 0 ply: bot_fault, 0 accepted', result.status === 'bot_fault'
    && row.status === 'bot_fault' && row.error === 'setup_bot_fault' && queue.accepted.length === 0,
  { result: result.status, row: row.status, error: row.error });
}


const SCENARIOS = [scenarioSingleWinner, scenarioLeaseSteal, scenarioRetrySameInput,
  scenarioAttemptCap, scenarioDuplicateFinish, scenarioTwoJobs, scenarioValidateInvalid,
  scenarioValidateValid, scenarioSetupBotFault];

/** Chạy toàn bộ drill; trả report JSON để CI/operator đối soát. */
export async function runDrill({ scenarios = SCENARIOS } = {}) {
  const results = [];
  for (const scenario of scenarios) {
    try {
      results.push(await scenario());
    } catch (error) {
      results.push(ok(`scenario:${scenario.name}`, false,
        { error: String(error?.code ?? error?.message ?? error) }));
    }
  }
  const pass = results.filter((item) => item.pass).length;
  return { version: DRILL_VERSION, total: results.length, pass, passAll: pass === results.length,
    scenarios: results };
}

async function main() {
  const args = process.argv.slice(2);
  const jsonIndex = args.indexOf('--json');
  const outPath = jsonIndex >= 0 ? args[jsonIndex + 1] : null;
  const report = await runDrill();
  for (const item of report.scenarios) {
    console.log(`${item.pass ? 'PASS' : 'FAIL'}  ${item.name}`
      + (item.pass ? '' : ` :: ${JSON.stringify(item.detail)}`));
  }
  console.log(`RESULT ${report.pass}/${report.total} kịch bản PASS (${report.version})`);
  if (outPath) writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
  if (!report.passAll) process.exitCode = 1;
}

const isEntryPoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) await main();
