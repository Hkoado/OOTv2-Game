/**
 * Official weekly group round: build a K2 snapshot from the real setup + accepted bots,
 * then open (or read) the persisted group round.
 *
 * Readiness is deliberately strict: every entrant must have one valid submission pinned
 * at/before cutoff. Missing bots are reported to BTC; they are never silently replaced
 * by an older submission or skipped from the schedule.
 */
import { rows, uuid } from '../shared/client.js';
import { HttpError } from '../lib/httpError.js';
import { setupFor } from '../shared/officialSetup.js';
import { createOfficialRoundSnapshot } from '../contracts/officialSnapshot.js';
import { createOfficialRuntimeIdentity } from '../judge/officialRuntime.js';
import { createOfficialGroupSchedule } from '../lib/officialGroups.js';
import { openOfficialRound, findOfficialRound, loadOfficialRound,
  nextPinnedGroupGame } from '../shared/officialSchedule.js';

const fail = (status, code, message) => new HttpError(status, code, message);
const ROUND_ID = 'group';
const isDate = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));

function pinTime(receipt, submission) {
  if (receipt) return Date.parse(receipt.resolved_at);
  return Date.parse(submission.created_at);
}

function botFrom(receipt, submission) {
  if (receipt) {
    return {
      participantId: submission.participant_id,
      submissionId: submission.id,
      artifactKey: submission.storage_path,
      sourceSha256: submission.sha256,
      sourceKind: 'github',
      repositoryId: String(receipt.repo_id),
      commitSha: String(receipt.commit_sha).toLowerCase(),
      resolvedAt: new Date(receipt.resolved_at).toISOString(),
    };
  }
  return {
    participantId: submission.participant_id,
    submissionId: submission.id,
    artifactKey: submission.storage_path,
    sourceSha256: submission.sha256,
    sourceKind: 'offline_file',
  };
}

/**
 * DB reads only. `clock` is injectable for tests; production uses server time.
 * Returns `{ snapshot, event, entries }`; throws HttpError with actionable readiness errors.
 */
export async function buildGroupSnapshot({ eventId, clock = Date.now } = {}) {
  uuid(eventId);
  const [events, entries] = await Promise.all([
    rows('tournaments', `id=eq.${uuid(eventId)}&select=id,name,status,seed`),
    rows('tournament_entries', `tournament_id=eq.${uuid(eventId)}&order=seed_order&select=id,participant_id,seed_order`),
  ]);
  const event = events[0];
  if (!event) throw fail(404, 'tournament_not_found', 'Không tìm thấy giải.');
  if (event.status !== 'draft') throw fail(409, 'event_frozen', 'Giải đã bắt đầu hoặc đã khóa.');
  const config = await setupFor(eventId);
  if (!config) throw fail(409, 'setup_missing', 'Giải chưa có thiết lập chính thức.');
  if (!config.mapsPublished || !config.mapPackVersion) {
    throw fail(409, 'map_not_published', 'BTC chưa công bố map pack chính thức.');
  }
  if (!isDate(config.cutoff)) throw fail(409, 'cutoff_missing', 'Giải chưa có cutoff hợp lệ.');
  if (clock() < Date.parse(config.cutoff)) throw fail(409, 'cutoff_not_reached', 'Chưa tới cutoff; chưa chốt bài.');
  if (entries.length < 4) throw fail(409, 'not_enough_teams', 'Cần ít nhất 4 đội cho vòng bảng.');
  if (entries.length > 56) throw fail(409, 'too_many_teams', 'Tối đa 56 đội.');

  const participantIds = entries.map((entry) => entry.participant_id);
  if (new Set(participantIds).size !== participantIds.length) throw fail(409, 'duplicate_team', 'Danh sách đội bị trùng.');
  const [submissions, receipts, participants] = await Promise.all([
    rows('submissions', `participant_id=in.(${participantIds.join(',')})&status=eq.valid`
      + '&order=created_at.desc&select=id,participant_id,storage_path,sha256,status,created_at'),
    rows('github_receipts', `event_id=eq.${uuid(eventId)}&status=eq.valid&team_id=in.(${participantIds.join(',')})`
      + '&select=team_id,submission_id,source_hash,commit_sha,repo_id,resolved_at'),
    rows('participants', `id=in.(${participantIds.join(',')})&select=id,name`),
  ]);
  const names = new Map(participants.map((team) => [team.id, team.name]));
  const receiptBySubmission = new Map(receipts.filter((receipt) => receipt.submission_id)
    .map((receipt) => [receipt.submission_id, receipt]));
  const cutoff = Date.parse(config.cutoff);
  const missing = [];
  const bots = [];
  for (const participantId of participantIds) {
    let best = null;
    for (const submission of submissions.filter((row) => row.participant_id === participantId)) {
      const receipt = receiptBySubmission.get(submission.id);
      const pinnedAt = pinTime(receipt, submission);
      if (!Number.isFinite(pinnedAt)) continue;
      if (receipt && receipt.source_hash !== submission.sha256) continue;
      if (pinnedAt > cutoff) continue;
      if (!best || pinnedAt > best.pinnedAt) best = { submission, receipt, pinnedAt };
    }
    if (!best) { missing.push(names.get(participantId) || participantId); continue; }
    bots.push(botFrom(best.receipt, best.submission));
  }
  if (missing.length) {
    throw fail(409, 'missing_submission', `Chưa có bot hợp lệ trước cutoff: ${missing.join(', ')}.`);
  }

  let snapshot;
  try {
    snapshot = createOfficialRoundSnapshot({
      eventId, roundId: ROUND_ID, seed: Number(event.seed), cutoff: config.cutoff,
      mapPackVersion: config.mapPackVersion,
      primaryMap: config.primaryMap, reserveMap: config.reserveMap,
      runtime: createOfficialRuntimeIdentity(), bots,
    });
  } catch (error) {
    throw fail(409, 'snapshot_invalid', `Không tạo được snapshot: ${error.message}`);
  }
  return { snapshot, event, entries };
}


function nextGameView({ snapshot, games, names }) {
  const next = nextPinnedGroupGame({ snapshot, games });
  if (!next) return null;
  const side = (participantId) => ({ participantId, name: names.get(participantId) || null });
  return {
    seq: next.seq, gameKey: next.gameKey, groupName: next.groupName, gameNo: next.gameNo,
    seed: next.seed, mapSlot: next.mapSlot,
    red: side(next.redParticipantId), blue: side(next.blueParticipantId),
  };
}

/** Admin DTO for the persisted round; no full snapshot/artifact keys leak to UI. */
export async function groupRoundView({ roundId } = {}) {
  const round = await loadOfficialRound({ roundId });
  const participantIds = round.snapshot.bots.map((bot) => bot.participantId);
  const teams = await rows('participants', `id=in.(${participantIds.join(',')})&select=id,name`);
  const names = new Map(teams.map((team) => [team.id, team.name]));
  const schedule = createOfficialGroupSchedule({ participantIds, seed: round.snapshot.seed,
    mapHash: round.snapshot.maps.primary.hash, mapPackVersion: round.snapshot.mapPackVersion });
  return {
    roundId: round.roundId, eventId: round.eventId, round: 'group', frozen: round.frozen,
    snapshot: { contentHash: round.snapshot.contentHash, cutoff: round.snapshot.cutoff,
      seed: round.snapshot.seed, mapPackVersion: round.snapshot.mapPackVersion,
      runtimeVersion: round.snapshot.runtime.runtimeVersion, runtimeHash: round.snapshot.runtime.runtimeHash,
      budgetHash: round.snapshot.runtime.budgetHash, teamCount: participantIds.length },
    games: { total: schedule.games.length, finished: round.games.filter((game) => game.result).length },
    next: round.games.some((game) => !game.result) ? null
      : nextGameView({ snapshot: round.snapshot, games: round.games, names }),
  };
}

/** Idempotent admin action: build once, open once; repeated calls return the persisted round. */
export async function openGroupRound({ eventId, clock = Date.now } = {}) {
  const existing = await findOfficialRound({ eventId, roundId: ROUND_ID });
  if (existing) return { alreadyOpen: true, round: await groupRoundView({ roundId: existing }) };
  const { snapshot } = await buildGroupSnapshot({ eventId, clock });
  try {
    const opened = await openOfficialRound({ snapshot });
    return { alreadyOpen: false, round: await groupRoundView({ roundId: opened.roundId }) };
  } catch (error) {
    if (error.code !== 'round_exists') throw error;
    const raced = await findOfficialRound({ eventId, roundId: ROUND_ID });
    if (!raced) throw error;
    return { alreadyOpen: true, round: await groupRoundView({ roundId: raced }) };
  }
}

export async function getGroupRound({ eventId } = {}) {
  const roundId = await findOfficialRound({ eventId, roundId: ROUND_ID });
  if (!roundId) throw fail(404, 'round_not_found', 'Chưa mở vòng bảng chính thức.');
  return groupRoundView({ roundId });
}

