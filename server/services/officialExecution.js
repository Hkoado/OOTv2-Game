/** K3 official match execution: claimed job → verified pinned input → Campus runner →
 * accepted result. Every failure path is classified; infrastructure retries keep the same
 * input, bot faults stay engine results, and nothing falls back to the MVP runner.
 *
 * `startSessionFactory`, `runMatch`, `loadRound` and the job functions are injectable so
 * contract tests never touch Supabase Storage, Python or the DB.
 */
import config from '../config.js';
import { contentHash, mapHash } from '../contracts/canonical.js';
import { downloadStorageArtifact } from '../shared/artifactDownload.js';
import { hashBuffer, temporaryBot } from '../shared/artifacts.js';
import { loadOfficialRound } from '../shared/officialSchedule.js';
import { finishOfficialJob, failOfficialJob, heartbeatOfficialJob, officialGameInputHash } from '../shared/officialJobs.js';
import { createOfficialRuntimeIdentity, OFFICIAL_BUDGET } from '../judge/officialRuntime.js';
import { runCampusMatch } from '../judge/campusMatchRunner.js';
import { CampusInfrastructureError } from '../judge/campusTrustedSession.js';
import { createCampusSessionFactory } from '../judge/campusSandboxFactory.js';

export const OFFICIAL_EXECUTION_VERSION = 'campus-execution.v1';
/** A replay payload above this is rejected instead of silently truncated. */
export const MAX_REPLAY_BYTES = 256 * 1024;

/** Pinned runtime identity must equal the code/budget actually deployed now. */
export function verifyPinnedRuntime(pinned, { identity = createOfficialRuntimeIdentity() } = {}) {
  try {
    return Boolean(pinned) && pinned.runtimeVersion === identity.runtimeVersion
      && pinned.rulesVersion === identity.rulesVersion
      && pinned.protocolVersion === identity.protocolVersion
      && pinned.runtimeHash === identity.runtimeHash
      && pinned.budgetHash === identity.budgetHash;
  } catch {
    return false;
  }
}

/** Pinned input is unusable; retrying the same bytes cannot help. */
class OfficialInputError extends Error {
  constructor(code) { super(code); this.name = 'OfficialInputError'; this.code = code; }
}
const isInfrastructure = (error) => error instanceof CampusInfrastructureError
  || (error?.name === 'HttpError' && error.status >= 500)
  || (error?.name === 'ArtifactDownloadError'
    && ['storage_unavailable', 'download_timeout', 'download_cancelled'].includes(error.code));
const infraRetryable = (error) => !(error instanceof CampusInfrastructureError)
  || !['replay_verification_failed', 'cleanup_not_confirmed'].includes(error.code);

/** Bot pin must exist in the snapshot; no latest-submission lookup at run time. */
function pinnedBot(snapshot, participantId) {
  const bot = snapshot.bots.find((entry) => entry.participantId === participantId);
  if (!bot) throw new OfficialInputError('bot_not_pinned');
  return bot;
}

async function materializePinned(bot, { download = downloadStorageArtifact } = {}) {
  let bytes;
  try {
    bytes = await download(bot.artifactKey, { maxBytes: config.limits.maxSourceBytes });
  } catch (error) {
    // Transport/Storage failures are infrastructure, never "the bot is invalid".
    throw new CampusInfrastructureError(`artifact_unavailable:${error?.code ?? 'unknown'}`);
  }
  if (hashBuffer(bytes) !== bot.sourceSha256) throw new OfficialInputError('source_hash_mismatch');
  return temporaryBot(bytes);
}

function mapForSlot(snapshot, slot) {
  const entry = slot === 'reserve' ? snapshot.maps.reserve : snapshot.maps.primary;
  if (!entry) throw new OfficialInputError('map_missing');
  return entry;
}

/** Shared by the worker and by accepted-result replay verification. */
export function replayHashOf(replay) {
  return contentHash(replay);
}

/**
 * Runs one claimed job. The caller owns claiming; this function owns heartbeats,
 * input verification, cleanup and exactly one terminal report per attempt.
 * Returns `{ recorded, reason, result?, replayHash?, attempt }` and never throws for a
 * handled fault (only for a programming error in the injected functions).
 */
export async function executeOfficialJob(job, {
  runMatch = runCampusMatch,
  loadRound = loadOfficialRound,
  finish = finishOfficialJob,
  fail = failOfficialJob,
  heartbeat = heartbeatOfficialJob,
  startSessionFactory = createCampusSessionFactory,
  identity = createOfficialRuntimeIdentity(),
  budget = OFFICIAL_BUDGET,
  leaseSeconds = 120,
  heartbeatMs,
  logger = console,
} = {}) {
  if (!job || typeof job !== 'object') throw new Error('executeOfficialJob requires a claimed job');
  const abort = new AbortController();
  let leaseLost = false;
  let heartbeatFailure = null;
  const beatMs = Number.isSafeInteger(heartbeatMs) ? heartbeatMs : Math.max(5000, Math.floor(leaseSeconds * 1000 / 3));
  const timer = setInterval(() => {
    Promise.resolve(heartbeat({ jobId: job.id, token: job.leaseToken, generation: job.generation, leaseSeconds }))
      .then((ok) => { if (ok === false) { leaseLost = true; abort.abort(); } })
      .catch((error) => { heartbeatFailure = error; });
  }, beatMs);
  timer.unref?.();

  const report = (payload) => fail({ jobId: job.id, token: job.leaseToken, generation: job.generation, ...payload });
  const inputFault = async (code) => {
    await report({ error: code, category: 'input', retryable: false }).catch(() => {});
    return { recorded: false, reason: code, attempt: job.attempt, category: 'input' };
  };
  const infraFault = async (code, retryable = true) => {
    await report({ error: code, category: 'infrastructure', retryable }).catch(() => {});
    return { recorded: false, reason: code, attempt: job.attempt, category: 'infrastructure' };
  };

  const local = [];
  try {
    const round = await loadRound({ roundId: job.roundId });
    if (round.frozen) return await inputFault('round_frozen');
    const game = round.games.find((entry) => entry.gameKey === job.gameKey);
    if (!game) return await inputFault('game_not_found');
    if (game.result !== null) {
      return { recorded: true, reason: 'already_recorded', result: game.result,
        replayHash: game.replayHash, attempt: job.attempt };
    }
    if (officialGameInputHash({ snapshotHash: round.snapshot.contentHash, game,
      runtime: round.snapshot.runtime }) !== job.inputHash) return await inputFault('input_mismatch');
    if (!verifyPinnedRuntime(round.snapshot.runtime, { identity })) return await inputFault('runtime_mismatch');
    const map = mapForSlot(round.snapshot, game.mapSlot);
    if (map.hash !== game.mapHash || mapHash(map.map) !== game.mapHash
      || round.snapshot.mapPackVersion !== game.mapPackVersion) return await inputFault('map_mismatch');

    const redBot = pinnedBot(round.snapshot, game.redParticipantId);
    const blueBot = pinnedBot(round.snapshot, game.blueParticipantId);
    const redLocal = await materializePinned(redBot);
    local.push(redLocal);
    const blueLocal = await materializePinned(blueBot);
    local.push(blueLocal);
    if (leaseLost) return { recorded: false, reason: 'lease_lost', attempt: job.attempt };
    if (heartbeatFailure) throw heartbeatFailure;

    const factory = startSessionFactory();
    const startSession = async (side) => factory({ ...side,
      allowedRoot: side.allowedRoot ?? config.artifactCacheDir,
      responseTotalMs: budget.responseTotalMs, cpuTotalMs: budget.cpuTotalMs });
    const outcome = await runMatch({
      id: `${job.roundId}:${job.gameKey}`,
      map: map.map, seed: game.seed, signal: abort.signal,
      red: { name: redBot.participantId, filePath: redLocal.file, allowedRoot: config.artifactCacheDir },
      blue: { name: blueBot.participantId, filePath: blueLocal.file, allowedRoot: config.artifactCacheDir },
      // Chỉ adapter trusted-dev đã opt-in tường minh mới được bật cờ này (factory fail-closed).
      trusted: factory.trustedDev === true,
      startSession,
      setupWallMs: budget.setupWallMs, moveWallMs: budget.moveWallMs,
      responseTotalMs: budget.responseTotalMs,
    });
    if (leaseLost) return { recorded: false, reason: 'lease_lost', attempt: job.attempt };
    if (heartbeatFailure) throw heartbeatFailure;
    if (!['red_win', 'blue_win', 'draw'].includes(outcome?.result)) {
      throw new CampusInfrastructureError('result_unsupported');
    }
    const replay = outcome.replay;
    const replayHash = replayHashOf(replay);
    if (Buffer.byteLength(JSON.stringify(replay), 'utf8') > MAX_REPLAY_BYTES) {
      return await infraFault('replay_too_large', false);
    }
    const finished = await finish({ jobId: job.id, token: job.leaseToken, generation: job.generation,
      result: outcome.result, replayHash, replay });
    return { recorded: true, reason: outcome.reason ?? null, result: finished.result,
      replayHash, alreadyRecorded: finished.alreadyRecorded === true, attempt: job.attempt,
      plyCount: outcome.plyCount ?? null };
  } catch (error) {
    if (leaseLost || error?.code === 'lease_lost') {
      return { recorded: false, reason: 'lease_lost', attempt: job.attempt };
    }
    const code = String(error?.code ?? error?.message ?? 'execution_error').slice(0, 160);
    if (abort.signal.aborted) return await infraFault('worker_shutdown', true);
    if (error instanceof OfficialInputError) return await inputFault(code);
    if (isInfrastructure(error)) {
      logger.warn?.(`[official-worker] ${job.id} infrastructure: ${code}`);
      return await infraFault(code, infraRetryable(error));
    }
    // Unknown failure: retry the SAME input, never invent a result or a forfeit.
    logger.error?.(`[official-worker] ${job.id} unexpected: ${code}`);
    return await infraFault(code, true);
  } finally {
    clearInterval(timer);
    for (const item of local) item.cleanup();
  }
}
