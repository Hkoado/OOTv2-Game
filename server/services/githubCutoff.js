/**
 * Cutoff sync (BTC flow): at the published cutoff, resolve each approved repo's branch
 * once, enqueue exactly one pull job per team, then never re-pull successful jobs.
 *
 * Existing worker jobs retry infrastructure failures up to the DB limit. A code-invalid
 * bot or an already queued/valid SHA is skipped; BTC must decide any manual exception.
 *
 * This service writes job+receipt directly (service_role) because the H1 RPC intentionally
 * rejects intake after cutoff. job insert is compensated if the receipt insert fails.
 */
import { randomUUID } from 'node:crypto';
import { rows, insert, remove, uuid } from '../shared/client.js';
import { HttpError } from '../lib/httpError.js';
import { setupFor } from '../shared/officialSetup.js';
import { parseRepository, parseBranch, getBranchHead } from './githubRepo.js';

const fail = (status, code, message) => new HttpError(status, code, message);
const isDate = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));

export async function syncAllAtCutoff({ eventId, actor = null, clock = Date.now, getHead = getBranchHead } = {}) {
  uuid(eventId);
  const events = await rows('tournaments', `id=eq.${uuid(eventId)}&select=id,status`);
  const event = events[0];
  if (!event) throw fail(404, 'tournament_not_found', 'Không tìm thấy giải.');
  if (event.status !== 'draft') throw fail(409, 'event_frozen', 'Giải đã bắt đầu hoặc đã khóa.');
  const config = await setupFor(eventId);
  if (!isDate(config?.cutoff)) throw fail(409, 'cutoff_missing', 'Giải chưa có cutoff hợp lệ.');
  if (clock() < Date.parse(config.cutoff)) throw fail(409, 'cutoff_not_reached', 'Chưa tới cutoff.');

  const connections = await rows('repo_connections',
    `event_id=eq.${uuid(eventId)}&approved=eq.true&select=*&order=team_id`);
  if (!connections.length) throw fail(409, 'no_approved_repositories', 'Chưa có repository nào được duyệt.');

  const summary = { cutoff: config.cutoff, queued: 0, skipped: 0, failed: [] };
  for (const connection of connections) {
    const base = { event_id: connection.event_id, team_id: connection.team_id,
      repo_id: Number(connection.repo_id), repository: connection.repository,
      branch: connection.branch, file_path: 'bot.py' };
    let commitSha;
    try {
      const repo = parseRepository(connection.repository);
      commitSha = await getHead(repo.fullName, parseBranch(connection.branch));
      if (!/^[0-9a-f]{40}$/i.test(String(commitSha))) throw new Error('bad_sha');
    } catch (error) {
      summary.failed.push({ team_id: connection.team_id, error: error.code || error.message || 'pull_failed' });
      continue;
    }
    commitSha = commitSha.toLowerCase();
    const same = await rows('github_receipts', `event_id=eq.${uuid(eventId)}&team_id=eq.${connection.team_id}`
      + `&repo_id=eq.${connection.repo_id}&commit_sha=eq.${commitSha}&file_path=eq.bot.py&select=id,status`);
    if (same.length) { summary.skipped++; continue; }

    const [previous] = await rows('submissions', `participant_id=eq.${connection.team_id}`
      + '&status=eq.valid&order=created_at.desc&limit=1&select=id');
    const now = new Date(clock()).toISOString();
    const jobId = randomUUID();
    const job = { id: jobId, ...base, commit_sha: commitSha, status: 'queued',
      attempt: 0, available_at: now, requested_by: actor?.id || null, created_at: now, updated_at: now };
    await insert('repo_sync_jobs', [job]);
    try {
      await insert('github_receipts', [{ id: randomUUID(), job_id: jobId, ...base, commit_sha: commitSha,
        status: 'resolving', source_hash: null, error: null, error_category: null,
        submission_id: null, previous_valid_submission_id: previous?.id || null,
        resolved_at: now, created_at: now, updated_at: now }]);
      summary.queued++;
    } catch (error) {
      await remove('repo_sync_jobs', `id=eq.${jobId}`).catch(() => {});
      throw error;
    }
  }
  return summary;
}

export default { syncAllAtCutoff };
