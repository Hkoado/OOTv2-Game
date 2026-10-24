/** PostgreSQL owns the single capture and atomic job/receipt creation.
 * Policy: first successful resolution after cutoff, not historical HEAD at cutoff.
 */
import { rows, rpc, uuid } from '../shared/client.js';
import { HttpError } from '../lib/httpError.js';
import { setupFor } from '../shared/officialSetup.js';
import { parseRepository, parseBranch, getBranchHead } from './githubRepo.js';

export const CUTOFF_CAPTURE_POLICY = 'cutoff-first-resolution.v1';
export const DEFAULT_BATCH_LIMIT = 5;
export const MAX_BATCH_LIMIT = 10;
export const MAX_BATCH_TIME_MS = 20000;

const fail = (code) => new HttpError(409, code, `Chưa thể chốt GitHub: ${code}.`);

export async function syncAllAtCutoff({ eventId, actor = null, clock = Date.now,
  getHead = getBranchHead, teamIds = null, limit = null, maxTimeMs = MAX_BATCH_TIME_MS } = {}) {
  uuid(eventId);
  const startTime = clock();
  const [event] = await rows('tournaments', `id=eq.${eventId}&select=id,status`);
  if (!event) throw new HttpError(404, 'tournament_not_found', 'Không tìm thấy giải.');
  if (event.status !== 'draft') throw fail('event_frozen');
  const config = await setupFor(eventId);
  if (!config?.cutoff || !Number.isFinite(Date.parse(config.cutoff))) throw fail('cutoff_missing');
  if (clock() < Date.parse(config.cutoff)) throw fail('cutoff_not_reached');

  let allApproved = await rows('repo_connections',
    `event_id=eq.${eventId}&approved=eq.true&select=*&order=team_id`);
  if (!allApproved.length) throw fail('no_approved_repositories');

  if (Array.isArray(teamIds) && teamIds.length > 0) {
    const filterSet = new Set(teamIds.map(String));
    allApproved = allApproved.filter((c) => filterSet.has(String(c.team_id)));
    if (!allApproved.length) throw fail('no_approved_repositories');
  }

  // Tải danh sách các capture đã có để xác định các đội đã pinned
  const existingCaptures = await rows('cutoff_captures',
    `event_id=eq.${eventId}&select=team_id,receipt_id,commit_sha,lease_until`);
  const pinnedTeams = new Set((existingCaptures || [])
    .filter((c) => Boolean(c.receipt_id))
    .map((c) => String(c.team_id)));

  // Bỏ qua các đội đã pin TRƯỚC KHI áp limit để không lãng phí slot batch
  const alreadyPinnedConnections = allApproved.filter((c) => pinnedTeams.has(String(c.team_id)));
  const pendingConnections = allApproved.filter((c) => !pinnedTeams.has(String(c.team_id)));

  // Giới hạn server-side cứng: không tin tưởng limit tùy tiện từ client
  const parsedLimit = Number.isInteger(Number(limit)) && Number(limit) > 0 ? Number(limit) : DEFAULT_BATCH_LIMIT;
  const effectiveLimit = Math.min(Math.max(1, parsedLimit), MAX_BATCH_LIMIT);
  const batch = pendingConnections.slice(0, effectiveLimit);

  const summary = {
    cutoff: config.cutoff,
    policy: CUTOFF_CAPTURE_POLICY,
    total: allApproved.length,
    batch_size: batch.length,
    queued: 0,
    skipped: alreadyPinnedConnections.length,
    failed: [],
  };

  for (const connection of batch) {
    // Ngắt an toàn nếu vượt quá time budget serverless (tránh timeout 30s của Vercel)
    if (clock() - startTime >= maxTimeMs) {
      summary.budget_exhausted = true;
      break;
    }

    try {
      const claim = await rpc('mvp_cutoff_claim', { p_event: eventId, p_team: connection.team_id });
      if (!claim?.ok) throw fail(claim?.error || 'capture_failed');
      if (claim.pinned) {
        pinnedTeams.add(String(connection.team_id));
        summary.skipped++;
        continue;
      }
      if (claim.busy) {
        summary.skipped++;
        continue;
      }
      const target = claim.connection;
      const repo = parseRepository(target.repository);
      const commitSha = String(await getHead(repo.fullName, parseBranch(target.branch))).toLowerCase();
      if (!/^[0-9a-f]{40}$/.test(commitSha)) throw fail('github_bad_response');
      const result = await rpc('mvp_cutoff_pin', { p_event: eventId, p_team: connection.team_id,
        p_token: claim.token, p_sha: commitSha, p_actor: actor?.id || null });
      if (!result?.ok) throw fail(result?.error || 'capture_failed');
      if (result.already_pinned) {
        pinnedTeams.add(String(connection.team_id));
        summary.skipped++;
      } else {
        pinnedTeams.add(String(connection.team_id));
        summary.queued++;
      }
    } catch (error) {
      // Never delete/compensate a pin: a timed-out transaction may have committed.
      // The reservation expires; the next attempt first consults the capture.
      summary.failed.push({ team_id: connection.team_id,
        error: /^[a-z_]{1,80}$/.test(error.code || '') ? error.code : 'capture_failed' });
    }
  }

  // Authoritative remaining: số đội chưa pin trong toàn bộ connections đang xét
  const pinnedCount = allApproved.filter((c) => pinnedTeams.has(String(c.team_id))).length;
  summary.remaining = Math.max(0, allApproved.length - pinnedCount);
  summary.complete = allApproved.length > 0 && summary.remaining === 0;

  return summary;
}

export async function getCutoffStatus({ eventId, clock = Date.now } = {}) {
  uuid(eventId);
  const [event] = await rows('tournaments', `id=eq.${eventId}&select=id,status`);
  if (!event) throw new HttpError(404, 'tournament_not_found', 'Không tìm thấy giải.');
  const config = await setupFor(eventId);
  const cutoffTime = config?.cutoff && Number.isFinite(Date.parse(config.cutoff)) ? config.cutoff : null;
  const reached = cutoffTime ? clock() >= Date.parse(cutoffTime) : false;

  const [connections, captures] = await Promise.all([
    rows('repo_connections', `event_id=eq.${eventId}&approved=eq.true&select=team_id,repository,branch&order=team_id`),
    rows('cutoff_captures', `event_id=eq.${eventId}&select=team_id,commit_sha,captured_at,receipt_id,lease_until`),
  ]);

  const capturesByTeam = new Map((captures || []).map((c) => [c.team_id, c]));
  const teams = [];
  let pinnedCount = 0;
  let busyCount = 0;

  for (const conn of (connections || [])) {
    const cap = capturesByTeam.get(conn.team_id);
    let status = 'pending';
    if (cap?.receipt_id) {
      status = 'pinned';
      pinnedCount++;
    } else if (cap?.lease_until && Date.parse(cap.lease_until) > clock()) {
      status = 'busy';
      busyCount++;
    }
    teams.push({
      team_id: conn.team_id,
      repository: conn.repository,
      branch: conn.branch,
      status,
      commit_sha: cap?.commit_sha ?? null,
      captured_at: cap?.captured_at ?? null,
      receipt_id: cap?.receipt_id ?? null,
    });
  }

  const total = (connections || []).length;
  const complete = total > 0 && pinnedCount === total;

  return {
    event_id: eventId,
    event_status: event.status,
    cutoff: cutoffTime,
    policy: CUTOFF_CAPTURE_POLICY,
    reached,
    total_approved: total,
    pinned_count: pinnedCount,
    busy_count: busyCount,
    pending_count: Math.max(0, total - pinnedCount),
    complete,
    teams,
  };
}

export default { syncAllAtCutoff, getCutoffStatus, CUTOFF_CAPTURE_POLICY, DEFAULT_BATCH_LIMIT, MAX_BATCH_LIMIT, MAX_BATCH_TIME_MS };
