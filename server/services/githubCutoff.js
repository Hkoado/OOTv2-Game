/** PostgreSQL owns the single capture and atomic job/receipt creation.
 * Policy: first successful resolution after cutoff, not historical HEAD at cutoff.
 */
import { rows, rpc, uuid } from '../shared/client.js';
import { HttpError } from '../lib/httpError.js';
import { setupFor } from '../shared/officialSetup.js';
import { parseRepository, parseBranch, getBranchHead } from './githubRepo.js';

export const CUTOFF_CAPTURE_POLICY = 'cutoff-first-resolution.v1';
const fail = (code) => new HttpError(409, code, `Chưa thể chốt GitHub: ${code}.`);

export async function syncAllAtCutoff({ eventId, actor = null, clock = Date.now,
  getHead = getBranchHead, teamIds = null, limit = null } = {}) {
  uuid(eventId);
  const [event] = await rows('tournaments', `id=eq.${eventId}&select=id,status`);
  if (!event) throw new HttpError(404, 'tournament_not_found', 'Không tìm thấy giải.');
  if (event.status !== 'draft') throw fail('event_frozen');
  const config = await setupFor(eventId);
  if (!config?.cutoff || !Number.isFinite(Date.parse(config.cutoff))) throw fail('cutoff_missing');
  if (clock() < Date.parse(config.cutoff)) throw fail('cutoff_not_reached');
  let connections = await rows('repo_connections',
    `event_id=eq.${eventId}&approved=eq.true&select=*&order=team_id`);
  if (!connections.length) throw fail('no_approved_repositories');

  if (Array.isArray(teamIds) && teamIds.length > 0) {
    const filterSet = new Set(teamIds.map(String));
    connections = connections.filter((c) => filterSet.has(String(c.team_id)));
    if (!connections.length) throw fail('no_approved_repositories');
  }

  if (Number.isInteger(limit) && limit > 0) {
    connections = connections.slice(0, limit);
  }

  const summary = { cutoff: config.cutoff, policy: CUTOFF_CAPTURE_POLICY, total: connections.length,
    queued: 0, skipped: 0, failed: [] };

  for (const connection of connections) {
    try {
      const claim = await rpc('mvp_cutoff_claim', { p_event: eventId, p_team: connection.team_id });
      if (!claim?.ok) throw fail(claim?.error || 'capture_failed');
      if (claim.pinned || claim.busy) { summary.skipped++; continue; }
      const target = claim.connection;
      const repo = parseRepository(target.repository);
      const commitSha = String(await getHead(repo.fullName, parseBranch(target.branch))).toLowerCase();
      if (!/^[0-9a-f]{40}$/.test(commitSha)) throw fail('github_bad_response');
      const result = await rpc('mvp_cutoff_pin', { p_event: eventId, p_team: connection.team_id,
        p_token: claim.token, p_sha: commitSha, p_actor: actor?.id || null });
      if (!result?.ok) throw fail(result?.error || 'capture_failed');
      if (result.already_pinned) summary.skipped++;
      else summary.queued++;
    } catch (error) {
      // Never delete/compensate a pin: a timed-out transaction may have committed.
      // The reservation expires; the next attempt first consults the capture.
      summary.failed.push({ team_id: connection.team_id,
        error: /^[a-z_]{1,80}$/.test(error.code || '') ? error.code : 'capture_failed' });
    }
  }

  summary.remaining = summary.failed.length;
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

export default { syncAllAtCutoff, getCutoffStatus, CUTOFF_CAPTURE_POLICY };
