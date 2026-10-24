/**
 * K3 online orchestration: publish exactly one pinned game at a time, enqueue it, and
 * aggregate only accepted results. No fake games, no colors derived from future results,
 * no manual DB edit path. Persistence stays in `mvp_official_*`; this module is the
 * service layer Huy wires into admin routes and Bảo into the admin UI.
 */
import { HttpError } from '../lib/httpError.js';
import { rows } from '../shared/client.js';
import { loadOfficialRound, appendOfficialGame, freezeOfficialRound,
  nextPinnedGroupGame } from '../shared/officialSchedule.js';
import { enqueueOfficialJob, officialGameInputHash, cancelOfficialJob,
  requeueOfficialJob } from '../shared/officialJobs.js';
import { computeOfficialGroupStandings, createOfficialGroupSchedule } from '../lib/officialGroups.js';
import { seedOfficialQualifiers } from '../lib/officialBracket.js';
import { COLOR_POLICY } from '../lib/officialColors.js';

export const OFFICIAL_ORCHESTRATION_VERSION = 'official-orchestration.v1';
const fail = (status, code, message) => new HttpError(status, code, message);
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

function assertRoundId(value) {
  if (!UUID.test(value ?? '')) throw fail(400, 'bad_round_id', 'roundId không hợp lệ.');
  return value;
}

/** Canonical input hash for a persisted game, shared with the worker. */
export function inputHashFor(round, game) {
  return officialGameInputHash({ snapshotHash: round.snapshot.contentHash, game,
    runtime: round.snapshot.runtime });
}

/** Accepted results only; a pending game is never turned into a forfeit or draw. */
export function acceptedResults(round) {
  return round.games.filter((game) => game.result !== null).map((game) => ({
    gameId: game.gameKey, result: game.result,
    redParticipantId: game.redParticipantId, blueParticipantId: game.blueParticipantId,
  }));
}

function pendingGame(round) {
  return round.games.find((game) => game.result === null) ?? null;
}

export function gameDto(round, game) {
  return { roundId: round.roundId, seq: game.seq, gameKey: game.gameKey, stage: game.stage,
    groupName: game.groupName ?? null, gameNo: game.gameNo ?? null, seed: game.seed,
    mapSlot: game.mapSlot, mapHash: game.mapHash, mapPackVersion: game.mapPackVersion,
    redParticipantId: game.redParticipantId, blueParticipantId: game.blueParticipantId,
    colorPolicy: game.colorPolicy };
}

/** Idempotent: re-running publishes nothing twice and never rewrites a pinned game. */
export async function enqueuePinnedGame({ round, game }) {
  const inputHash = inputHashFor(round, game);
  const enqueued = await enqueueOfficialJob({ roundId: round.roundId, gameKey: game.gameKey, inputHash });
  return { ...gameDto(round, game), jobId: enqueued.jobId, jobStatus: enqueued.status,
    created: enqueued.created };
}

/**
 * Called by BTC/automation while a round is open. If a game is pending it is only
 * (re)enqueued; the next game is appended with the persisted chain head as fence.
 */
export async function publishNextGame({ roundId } = {}) {
  assertRoundId(roundId);
  const round = await loadOfficialRound({ roundId });
  if (round.frozen) return { status: 'frozen', roundId, game: null };
  const pending = pendingGame(round);
  if (pending) return { status: 'pending', roundId, game: await enqueuePinnedGame({ round, game: pending }) };
  if (round.snapshot.roundId !== 'group') {
    throw fail(409, 'not_group_round', 'Vòng này không dùng lịch vòng bảng; dùng API knockout.');
  }
  const next = nextPinnedGroupGame({ snapshot: round.snapshot, games: round.games });
  if (!next) return { status: 'complete', roundId, game: null };
  await appendOfficialGame({ roundId, expectedPrefix: round.chainHash, game: next });
  const persisted = await loadOfficialRound({ roundId });
  const appended = persisted.games.find((game) => game.gameKey === next.gameKey);
  if (!appended) throw fail(503, 'append_not_visible', 'Ván vừa pin chưa đọc lại được.');
  return { status: 'published', roundId, game: await enqueuePinnedGame({ round: persisted, game: appended }) };
}

/** Progress DTO (admin/UI). Score detail stays server-side until publication. */
export async function roundProgress({ roundId } = {}, { loadRound = loadOfficialRound } = {}) {
  assertRoundId(roundId);
  const round = await loadRound({ roundId });
  const jobs = await rows('official_jobs',
    `round_pk=eq.${roundId}&select=id,game_key,status,attempt,error,error_category`);
  const byStatus = jobs.reduce((acc, job) => {
    acc[job.status] = (acc[job.status] ?? 0) + 1;
    return acc;
  }, {});
  const pending = pendingGame(round);
  return { roundId, eventId: round.eventId, round: round.snapshot.roundId, frozen: round.frozen,
    games: { total: round.games.length, finished: round.games.filter((game) => game.result !== null).length },
    jobs: { total: jobs.length, byStatus,
      failed: jobs.filter((job) => job.status === 'failed').slice(0, 50).map((job) => ({
        jobId: job.id, gameKey: job.game_key, attempt: job.attempt,
        error: job.error, category: job.error_category })) },
    pending: pending ? gameDto(round, pending) : null };
}

/** Standings/qualifiers from accepted results only. Throws instead of inventing scores. */
export async function groupStandings({ roundId } = {}) {
  assertRoundId(roundId);
  const round = await loadOfficialRound({ roundId });
  let standings;
  try {
    standings = computeOfficialGroupStandings({
      participantIds: round.snapshot.bots.map((bot) => bot.participantId),
      seed: round.snapshot.seed, mapHash: round.snapshot.maps.primary.hash,
      mapPackVersion: round.snapshot.mapPackVersion, results: acceptedResults(round),
      colorPolicy: COLOR_POLICY,
    });
  } catch (error) {
    throw fail(409, 'standings_invalid', `Không tính được bảng: ${error.message}`);
  }
  const qualifiers = standings.complete ? seedOfficialQualifiers(standings, round.snapshot.seed) : null;
  return { roundId, complete: standings.complete, games: standings.games,
    series: standings.series, tieBreakers: standings.tieBreakers, groups: standings.groups,
    qualifiers: qualifiers ? qualifiers.entrants.map((row) => ({
      participantId: row.participantId, groupName: row.groupName, seed: row.seed, rank: row.rank,
      seriesPoints: row.seriesPoints, gamePoints: row.gamePoints })) : null };
}

/** Freeze only when the schedule is complete and every game has an accepted result. */
export async function freezeGroupRound({ roundId, expectedGames } = {},
  { loadRound = loadOfficialRound, freeze = freezeOfficialRound } = {}) {
  assertRoundId(roundId);
  const round = await loadRound({ roundId });
  if (round.snapshot.roundId !== 'group') {
    throw fail(409, 'not_group_round', 'Chỉ đóng băng vòng bảng bằng thao tác này.');
  }
  const schedule = createOfficialGroupSchedule({
    participantIds: round.snapshot.bots.map((bot) => bot.participantId),
    seed: round.snapshot.seed,
    mapHash: round.snapshot.maps.primary.hash,
    mapPackVersion: round.snapshot.mapPackVersion,
  });
  const expected = schedule.games.length;
  if (Number.isInteger(expectedGames) && expectedGames !== expected) {
    throw fail(400, 'bad_expected_games', 'Số ván kỳ vọng không khớp lịch vòng bảng chính thức.');
  }
  if (round.games.length !== expected) {
    throw fail(409, 'incomplete_schedule', 'Lịch vòng bảng chưa được pin đầy đủ.');
  }
  const result = await freeze({ roundId, expectedGames: expected });
  return { ...result, expectedGames: expected };
}

/** Operator cancel/rerun: reason mandatory, accepted results are never replaced. */
export async function cancelGameJob({ jobId, actor, reason } = {}) {
  if (typeof reason !== 'string' || !reason.trim()) throw fail(400, 'reason_required', 'Hủy job phải có lý do.');
  return cancelOfficialJob({ jobId, actor, reason: reason.trim() });
}

export async function requeueGameJob({ jobId, actor, reason } = {}) {
  if (typeof reason !== 'string' || !reason.trim()) throw fail(400, 'reason_required', 'Chấm lại phải có lý do.');
  return requeueOfficialJob({ jobId, actor, reason: reason.trim() });
}
