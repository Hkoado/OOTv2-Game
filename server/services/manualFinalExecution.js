/**
 * manualFinalExecution.js — Consumer worker cho queue "Chung kết thủ công" (Huy → Khoa).
 *
 * Phạm vi (docs/18, docs/19):
 * - Nhận job đã claim từ `server/shared/manualFinalJobs.js` (RPC `mvp_manual_final_claim`).
 * - `validate`: tải artifact private, kiểm bytes/UTF-8/hash, rồi chạy protocol smoke
 *   Campus v2 (setup Đỏ → setup Xanh → một nước Đỏ) **trong session sandbox**.
 * - `match`: xác minh snapshot đã pin (schema/provenance/event/vòng/ván/seed/map/runtime),
 *   tải đúng hai submission đã khóa theo ID trong snapshot, chạy `runCampusMatch`, rồi ghi
 *   MỘT accepted result có fence lease token + generation.
 *
 * Ranh giới:
 * - Không có runner thứ hai, không dùng runner MVP, không chạy bot trong API/Vercel.
 * - Không lookup "bài mới nhất": mọi source đều đọc theo `submission_id` đã pin.
 * - Lỗi hạ tầng (Storage/sandbox/DB tạm thời) retry cùng input; lỗi bot là kết quả engine.
 * - Không tự bỏ gate sandbox/attestation: factory fail-closed như worker chính thức.
 *
 * Ghi chú contract đang mở: SQL `mvp_manual_final_finish` yêu cầu `ply_count >= 1`, nên một
 * ván kết thúc ngay ở setup (bot lỗi khi xếp quân, 0 ply) được ghi là `bot_fault` +
 * `error_code = setup_bot_fault`. Không tự sửa migration của Huy; xem docs/handoff/Khoa.md.
 */

import config from '../config.js';
import { contentHash, mapHash } from '../contracts/canonical.js';
import { rows } from '../shared/client.js';
import { downloadStorageArtifact } from '../shared/artifactDownload.js';
import { hashBuffer, temporaryBot } from '../shared/artifacts.js';
import { finishManualFinalJob, releaseManualFinalJob } from '../shared/manualFinalJobs.js';
import { inspectSourceBuffer } from './botValidation.js';
import { MANUAL_SNAPSHOT_VERSION } from './manualFinal.js';
import { replayHashOf, verifyPinnedRuntime } from './officialExecution.js';
import { OFFICIAL_BUDGET, createOfficialRuntimeIdentity } from '../judge/officialRuntime.js';
import { runCampusMatch } from '../judge/campusMatchRunner.js';
import { CampusInfrastructureError } from '../judge/campusTrustedSession.js';
import { createCampusSessionFactory } from '../judge/campusSandboxFactory.js';
import { applyCampusMove, applyCampusSetup, campusLegalMoves, createCampusGame,
  validateCampusSetup } from '../judge/campusEngine.js';
import { BotProtocolError, buildCampusBotRequest } from '../contracts/botProtocol.js';
import { SAMPLE_MAPS } from '../../src/game/sampleMaps.js';

export const MANUAL_EXECUTION_VERSION = 'manual-final-execution.v1';
/** Replay > 256 KiB bị từ chối thay vì cắt âm thầm (cùng profile với worker chính thức). */
export const MAX_REPLAY_BYTES = 256 * 1024;
/**
 * Queue manual chưa có RPC heartbeat, nên lease phải đủ dài cho trần thời gian đã pin:
 * 2 × responseTotalMs + setup + tải artifact. 300 s nằm dưới giới hạn 900 s của
 * `mvp_manual_final_claim`; heartbeat là việc tiếp theo của Huy (xem handoff Khoa).
 */
export const MANUAL_WORKER_LEASE_SECONDS = 300;

const SMOKE_SEED = 20260101;
const SMOKE_MAP = SAMPLE_MAPS[0].map;
const SHA256_RE = /^[0-9a-f]{64}$/u;
const STORAGE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.py$/u;

/** Input đã pin không dùng được; retry cùng bytes không thể thành công. */
class ManualInputError extends Error {
  constructor(code) { super(code); this.name = 'ManualInputError'; this.code = code; }
}

const isBotFault = (error) => error?.name === 'BotProtocolError';
const isAbort = (error) => error instanceof CampusInfrastructureError && error.code === 'match_cancelled';
const isInfrastructure = (error) => error instanceof CampusInfrastructureError
  || (error?.name === 'ArtifactDownloadError'
    && ['storage_unavailable', 'download_timeout', 'download_cancelled'].includes(error.code))
  || (error?.name === 'HttpError' && error.status >= 500);
/** Retry vô ích: input/hạ tầng đã hỏng xác định, phải dừng ở `infra_fault`. */
const nonRetryableInfrastructure = (error) => error?.name === 'ArtifactDownloadError'
  || (error instanceof CampusInfrastructureError
    && ['replay_verification_failed', 'cleanup_not_confirmed', 'result_unsupported',
      'invalid_artifact', 'python_unavailable', 'replay_missing', 'replay_too_large'].includes(error.code));

function codeOf(error) {
  return String(error?.code ?? error?.message ?? 'execution_error').slice(0, 160);
}

function requireHash(value, code) {
  if (!SHA256_RE.test(String(value ?? ''))) throw new ManualInputError(code);
  return value;
}

/** Tải artifact private, kiểm dung lượng + sha256 trước khi ghi ra file tạm. */
async function materialize({ key, sha256, byteSize, download }) {
  if (!STORAGE_RE.test(String(key ?? ''))) throw new ManualInputError('storage_key_invalid');
  requireHash(sha256, 'source_hash_missing');
  let bytes;
  try {
    bytes = await download(key, { maxBytes: config.limits.maxSourceBytes });
  } catch (error) {
    // Transport/Storage hỏng không phải "bot sai"; phân loại lại ở tầng trên.
    throw new CampusInfrastructureError(`artifact_unavailable:${codeOf(error)}`);
  }
  if (bytes.length > config.limits.maxSourceBytes) throw new ManualInputError('source_size_limit');
  if (Number.isSafeInteger(byteSize) && byteSize > 0 && bytes.length !== byteSize) {
    throw new ManualInputError('source_size_mismatch');
  }
  if (hashBuffer(bytes) !== sha256) throw new ManualInputError('source_hash_mismatch');
  return { bytes, file: temporaryBot(bytes) };
}

function startSessionAdapter({ factory, budget }) {
  return async (side) => factory({ ...side,
    allowedRoot: side.allowedRoot ?? config.artifactCacheDir,
    responseTotalMs: budget.responseTotalMs, cpuTotalMs: budget.cpuTotalMs,
    trusted: factory.trustedDev === true });
}

/** Protocol smoke Campus v2: Đỏ xếp kín → Xanh xếp khi đã thấy Đỏ → một nước Đỏ hợp lệ. */
async function campusProtocolSmoke({ filePath, startSession, budget, signal }) {
  const sessions = [];
  try {
    let state = createCampusGame({ id: 'manual-validate', map: SMOKE_MAP, seed: SMOKE_SEED });
    let sequence = 0;
    const ask = async (player) => {
      if (signal?.aborted) throw new CampusInfrastructureError('match_cancelled');
      const isSetup = state.phase !== 'playing';
      const request = buildCampusBotRequest(state, player, ++sequence, {
        responseWallMs: isSetup ? budget.setupWallMs : budget.moveWallMs,
        cpuRemainingMs: budget.cpuTotalMs,
      });
      let entry = sessions.find((candidate) => candidate.player === player);
      if (!entry) {
        const session = await startSession({ name: `smoke-${player}`, filePath,
          allowedRoot: config.artifactCacheDir });
        entry = { player, session };
        sessions.push(entry);
      }
      return entry.session.request(request);
    };

    for (const player of ['red', 'blue']) {
      const response = await ask(player);
      const checked = validateCampusSetup(state, player, response?.placements);
      if (!checked.ok) throw new BotProtocolError('INVALID_SETUP', `Illegal setup (${checked.error})`);
      state = applyCampusSetup(state, player, response.placements);
    }

    const move = await ask('red');
    const legal = campusLegalMoves(state, 'red')
      .some((candidate) => candidate.pieceId === move?.pieceId && candidate.to === move?.to);
    if (!legal) throw new BotProtocolError('ILLEGAL_MOVE', 'Illegal move');
    state = applyCampusMove(state, 'red', move);
    return { ok: true, phase: state.phase, ply: state.ply };
  } finally {
    const closed = await Promise.allSettled(sessions.map((entry) => entry.session.close()));
    const failure = closed.find((result) => result.status === 'rejected');
    if (failure) throw new CampusInfrastructureError('cleanup_not_confirmed');
  }
}

/** Đọc submission theo đúng ID đã pin (không bao giờ chọn "bài mới nhất"). */
export async function loadPinnedSubmission({ id, eventId }) {
  const [row] = await rows('manual_final_submissions',
    `id=eq.${id}&event_id=eq.${eventId}&select=id,event_id,team_id,storage_path,sha256,byte_size,status,locked_at`);
  return row ?? null;
}

function assertPinnedSubmission(side, row, { eventId, pinned }) {
  if (row.event_id !== eventId) throw new ManualInputError('submission_event_mismatch');
  if (row.team_id !== pinned.teamId) throw new ManualInputError(`${side}_team_mismatch`);
  if (row.sha256 !== pinned.sha256) throw new ManualInputError(`${side}_source_hash_mismatch`);
  if (row.status !== 'valid') throw new ManualInputError(`${side}_submission_not_valid`);
  if (!row.locked_at) throw new ManualInputError(`${side}_submission_not_locked`);
  if (!STORAGE_RE.test(String(row.storage_path ?? ''))) throw new ManualInputError('storage_key_invalid');
  return row;
}

/**
 * Snapshot đã pin phải tự khớp chính nó, khớp job/match và khớp runtime đang chạy.
 * Không đọc lại map/runtime/bài từ bảng khác để "làm mới" ván.
 */
export function verifyManualSnapshot(job, { identity = createOfficialRuntimeIdentity() } = {}) {
  const snapshot = job?.match?.snapshot;
  const match = job?.match;
  if (!snapshot || typeof snapshot !== 'object') throw new ManualInputError('snapshot_missing');
  if (!match) throw new ManualInputError('match_missing');
  if (snapshot.schemaVersion !== MANUAL_SNAPSHOT_VERSION) throw new ManualInputError('snapshot_schema_mismatch');
  if (snapshot.provenance !== 'manual_final') throw new ManualInputError('provenance_mismatch');
  if (snapshot.eventId !== job.eventId) throw new ManualInputError('snapshot_event_mismatch');
  if (Number(snapshot.roundNo) !== job.roundNo) throw new ManualInputError('snapshot_round_mismatch');
  if (snapshot.seriesId !== match.series_id) throw new ManualInputError('snapshot_series_mismatch');
  if (Number(snapshot.gameNo) !== match.game_no) throw new ManualInputError('snapshot_game_mismatch');
  if (Number(snapshot.seed) !== match.seed) throw new ManualInputError('snapshot_seed_mismatch');
  if (contentHash(snapshot) !== match.snapshot_hash) throw new ManualInputError('snapshot_hash_mismatch');
  if (job.inputHash !== match.snapshot_hash) throw new ManualInputError('job_input_mismatch');
  if (!verifyPinnedRuntime(snapshot.runtime, { identity })) throw new ManualInputError('runtime_mismatch');
  if (snapshot.mapHash !== match.map_hash) throw new ManualInputError('map_hash_mismatch');
  if (mapHash(snapshot.map) !== snapshot.mapHash) throw new ManualInputError('map_content_mismatch');
  if (!snapshot.red || !snapshot.blue) throw new ManualInputError('side_missing');
  requireHash(snapshot.red.sha256, 'red_source_hash_missing');
  requireHash(snapshot.blue.sha256, 'blue_source_hash_missing');
  if (snapshot.red.submissionId !== match.red_submission_id) throw new ManualInputError('red_submission_mismatch');
  if (snapshot.blue.submissionId !== match.blue_submission_id) throw new ManualInputError('blue_submission_mismatch');
  if (snapshot.red.teamId !== match.red_team_id) throw new ManualInputError('red_team_mismatch');
  if (snapshot.blue.teamId !== match.blue_team_id) throw new ManualInputError('blue_team_mismatch');
  return { snapshot, match };
}

/** `finish` trả envelope; `leaseLost` không bao giờ được tính là đã ghi. */
function finishOutcome(result, status, extra = {}) {
  if (result?.leaseLost === true) {
    return { recorded: false, status: 'lease_lost', reason: 'lease_lost', ...extra };
  }
  return { recorded: result?.applied === true || result?.alreadyFinished === true, status, ...extra };
}

/** Job `validate`: static UTF-8/size + protocol smoke trong sandbox. */
async function runValidate(job, { startSessionFactory, budget, signal, download, finish }) {
  const submission = job.submission;
  if (!submission) throw new ManualInputError('submission_missing');
  if (job.inputHash !== submission.sha256) throw new ManualInputError('job_input_mismatch');
  const { bytes, file } = await materialize({ key: submission.storage_path, sha256: submission.sha256,
    byteSize: submission.byte_size, download });
  try {
    const inspection = inspectSourceBuffer(bytes, bytes.length);
    if (!inspection.ok) {
      const result = await finish({ jobId: job.jobId, token: job.token, generation: job.generation,
        kind: 'validate', outcome: { status: 'invalid', error: inspection.error, message: inspection.message } });
      return finishOutcome(result, 'invalid', { reason: inspection.error, attempt: job.attempt });
    }
    const factory = startSessionFactory();
    const startSession = startSessionAdapter({ factory, budget });
    const smoke = await campusProtocolSmoke({ filePath: file.file, startSession, budget, signal });
    const result = await finish({ jobId: job.jobId, token: job.token, generation: job.generation,
      kind: 'validate', outcome: { status: 'valid', source_hash: submission.sha256 } });
    return finishOutcome(result, 'valid', { reason: null, plyCount: smoke.ply, attempt: job.attempt });
  } finally {
    file.cleanup();
  }
}

/** Job `match`: chạy Campus trên snapshot đã pin, ghi result/replay của accepted attempt. */
async function runMatchJob(job, { runMatch, startSessionFactory, identity, budget, signal,
  download, finish, loadSubmission }) {
  const { snapshot, match } = verifyManualSnapshot(job, { identity });
  const [redRow, blueRow] = await Promise.all([
    loadSubmission({ id: snapshot.red.submissionId, eventId: snapshot.eventId }),
    loadSubmission({ id: snapshot.blue.submissionId, eventId: snapshot.eventId }),
  ]);
  if (!redRow) throw new ManualInputError('red_submission_not_found');
  if (!blueRow) throw new ManualInputError('blue_submission_not_found');
  const red = assertPinnedSubmission('red', redRow, { eventId: snapshot.eventId, pinned: snapshot.red });
  const blue = assertPinnedSubmission('blue', blueRow, { eventId: snapshot.eventId, pinned: snapshot.blue });

  const redLocal = (await materialize({ key: red.storage_path, sha256: red.sha256,
    byteSize: Number(red.byte_size), download })).file;
  let blueLocal;
  try {
    blueLocal = (await materialize({ key: blue.storage_path, sha256: blue.sha256,
      byteSize: Number(blue.byte_size), download })).file;
    if (signal?.aborted) throw new CampusInfrastructureError('match_cancelled');

    const factory = startSessionFactory();
    const startSession = startSessionAdapter({ factory, budget });
    const outcome = await runMatch({
      id: `${match.id}:${match.series_id}:${match.game_no}`,
      map: snapshot.map, seed: match.seed, signal,
      red: { name: snapshot.red.teamId, filePath: redLocal.file, allowedRoot: config.artifactCacheDir },
      blue: { name: snapshot.blue.teamId, filePath: blueLocal.file, allowedRoot: config.artifactCacheDir },
      // Cùng gate với worker chính thức: factory đã fail-closed nếu chưa opt-in trusted-dev.
      trusted: factory.trustedDev === true,
      startSession,
      setupWallMs: budget.setupWallMs, moveWallMs: budget.moveWallMs,
      responseTotalMs: budget.responseTotalMs,
    });
    if (!['red_win', 'blue_win', 'draw'].includes(outcome?.result)) {
      throw new CampusInfrastructureError('result_unsupported');
    }
    const replay = outcome.replay;
    if (!replay || typeof replay !== 'object') throw new CampusInfrastructureError('replay_missing');
    if (Buffer.byteLength(JSON.stringify(replay), 'utf8') > MAX_REPLAY_BYTES) {
      throw new CampusInfrastructureError('replay_too_large');
    }
    const plyCount = Number(outcome.plyCount);
    if (!Number.isSafeInteger(plyCount) || plyCount < 0) {
      throw new CampusInfrastructureError('result_unsupported');
    }
    // Contract SQL hiện yêu cầu ply_count >= 1; bot lỗi ngay ở setup (0 ply) ghi `bot_fault`.
    if (plyCount === 0) {
      const result = await finish({ jobId: job.jobId, token: job.token, generation: job.generation,
        kind: 'match',
        outcome: { status: 'bot_fault', error: 'setup_bot_fault', message: String(outcome.reason ?? '') } });
      return finishOutcome(result, 'bot_fault', { reason: outcome.reason ?? 'setup_bot_fault', attempt: job.attempt });
    }
    const result = await finish({ jobId: job.jobId, token: job.token, generation: job.generation,
      kind: 'match',
      outcome: { status: 'finished', result: outcome.result, reason: outcome.reason ?? null,
        ply_count: plyCount, replay } });
    return finishOutcome(result, 'finished', { reason: outcome.reason ?? null,
      result: outcome.result, plyCount, replayHash: replayHashOf(replay), attempt: job.attempt });
  } finally {
    redLocal.cleanup();
    blueLocal?.cleanup();
  }
}

/**
 * Xử lý một job manual đã claim. Luôn kết thúc bằng finish hoặc release có fence;
 * `leaseLost` không bao giờ được coi là đã ghi.
 */
export async function executeManualFinalJob(job, {
  runMatch = runCampusMatch,
  startSessionFactory = createCampusSessionFactory,
  identity = createOfficialRuntimeIdentity(),
  budget = OFFICIAL_BUDGET,
  loadSubmission = loadPinnedSubmission,
  download = downloadStorageArtifact,
  finish = finishManualFinalJob,
  release = releaseManualFinalJob,
  signal,
  logger = console,
} = {}) {
  if (!job || typeof job !== 'object' || !job.jobId) throw new Error('executeManualFinalJob requires a claimed job');
  const deps = { runMatch, startSessionFactory, identity, budget, signal, download, finish, loadSubmission };
  try {
    if (job.kind === 'validate') return await runValidate(job, deps);
    if (job.kind === 'match') return await runMatchJob(job, deps);
    throw new ManualInputError('unsupported_kind');
  } catch (error) {
    if (error?.code === 'lease_lost') {
      return { recorded: false, status: 'lease_lost', reason: 'lease_lost', attempt: job.attempt };
    }
    const code = codeOf(error);
    if (isAbort(error)) {
      await release({ jobId: job.jobId, token: job.token, generation: job.generation,
        error: 'worker_shutdown' }).catch(() => null);
      return { recorded: false, status: 'released', reason: 'worker_shutdown', attempt: job.attempt };
    }
    if (isBotFault(error) && job.kind === 'validate') {
      const outcome = { status: 'invalid', error: code, message: String(error.message ?? '').slice(0, 400) };
      const result = await finish({ jobId: job.jobId, token: job.token, generation: job.generation,
        kind: 'validate', outcome });
      return finishOutcome(result, 'invalid', { reason: code, attempt: job.attempt });
    }
    if (error instanceof ManualInputError || isBotFault(error) || isInfrastructure(error)) {
      logger.warn?.(`[manual-worker] ${job.jobId} ${job.kind} rejected: ${code}`);
      const terminal = error instanceof ManualInputError || isBotFault(error) || nonRetryableInfrastructure(error);
      const released = await release({ jobId: job.jobId, token: job.token, generation: job.generation,
        error: code, ...(terminal ? { maxAttempts: 1 } : {}) }).catch((releaseError) => {
        logger.error?.(`[manual-worker] ${job.jobId} release failed: ${codeOf(releaseError)}`);
        return null;
      });
      return { recorded: false, status: released?.status ?? 'unknown', reason: code, attempt: job.attempt };
    }
    if (error?.name === 'HttpError') {
      // DB từ chối payload/lease (4xx): retry mù sẽ requeue vô hạn, nên dừng ở infra_fault.
      logger.error?.(`[manual-worker] ${job.jobId} ${job.kind} db rejected: ${code}`);
      const released = await release({ jobId: job.jobId, token: job.token, generation: job.generation,
        error: code, maxAttempts: 1 }).catch(() => null);
      return { recorded: false, status: released?.status ?? 'rejected', reason: code, attempt: job.attempt };
    }
    // Lỗi lập trình/DB: để loop backoff, không tự tạo kết quả hay cho đội thua.
    throw error;
  }
}

export default { executeManualFinalJob, verifyManualSnapshot, loadPinnedSubmission };

