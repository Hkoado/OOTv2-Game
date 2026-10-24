import { randomUUID } from 'node:crypto';
import '../../server/config.js';
import { insert, remove, rows } from '../../server/shared/client.js';
import { syncAllAtCutoff } from '../../server/services/githubCutoff.js';
import { EMPTY_TERRAIN_MAP } from '../../src/game/maps.js';

const runId = randomUUID().slice(0, 8);
const cutoff = new Date(Date.now() - 3600_000).toISOString();
const now = new Date().toISOString();
const state = { eventId: randomUUID(), teams: [] };
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

async function cleanup() {
  await remove('github_receipts', `event_id=eq.${state.eventId}`).catch(() => {});
  await remove('repo_sync_jobs', `event_id=eq.${state.eventId}`).catch(() => {});
  await remove('repo_connections', `event_id=eq.${state.eventId}`).catch(() => {});
  await remove('submissions', `participant_id=in.(${state.teams.join(',')})`).catch(() => {});
  await remove('tournament_entries', `tournament_id=eq.${state.eventId}`).catch(() => {});
  await remove('official_setups', `tournament_id=eq.${state.eventId}`).catch(() => {});
  await remove('tournaments', `id=eq.${state.eventId}`).catch(() => {});
  for (const id of state.teams) await remove('participants', `id=eq.${id}`).catch(() => {});
}

try {
  // Legacy fixture/cleanup predates authoritative captures. Refuse before seeding:
  // its cleanup cannot delete captures and must not leave locked fixture data.
  let capturesAvailable = false;
  try { await rows('cutoff_captures', 'limit=1&select=event_id'); capturesAvailable = true; }
  catch (error) { if (error.code !== 'shared_db_error') throw error; }
  if (capturesAvailable) throw Object.assign(new Error('legacy_drill_requires_capture_upgrade'),
    { code: 'legacy_drill_requires_capture_upgrade' });
  state.teams = Array.from({ length: 2 }, () => randomUUID());
  for (const [index, id] of state.teams.entries()) {
    await insert('participants', [{ id, name: `Cutoff drill ${runId} ${index}`,
      name_key: `cutoff drill ${runId} ${index}`, created_at: now }]);
  }
  await insert('tournaments', [{ id: state.eventId, name: `Cutoff drill ${runId}`, status: 'draft',
    seed: 777, created_at: now, map_json: JSON.stringify(EMPTY_TERRAIN_MAP) }]);
  for (const [index, participantId] of state.teams.entries()) {
    await insert('tournament_entries', [{ id: randomUUID(), tournament_id: state.eventId,
      participant_id: participantId, seed_order: index + 1 }]);
    await insert('repo_connections', [{ id: randomUUID(), event_id: state.eventId, team_id: participantId,
      repo_id: 9000 + index, repository: `https://github.com/drill/repo-${runId}-${index}`,
      branch: 'main', file_path: 'bot.py', approved: true, approved_by: null,
      created_at: now, updated_at: now }]);
  }
  await insert('official_setups', [{ tournament_id: state.eventId, config: {
    schemaVersion: 'campus-setup.v1', level: 'weekly', cutoff, mapPackVersion: `cutoff-${runId}`,
    weeksPerMonth: 4, monthsPerSemester: 4, mapsPublished: true,
    primaryMap: EMPTY_TERRAIN_MAP, reserveMap: EMPTY_TERRAIN_MAP,
  } }]);

  const getHead = async () => 'a'.repeat(40);
  const first = await syncAllAtCutoff({ eventId: state.eventId, clock: () => Date.now(), getHead });
  check('tạo đúng 1 job/repo đã duyệt', first.queued === 2 && first.failed.length === 0,
    `queued=${first.queued}`);
  const jobs = await rows('repo_sync_jobs', `event_id=eq.${state.eventId}&select=id,status,commit_sha`);
  check('job queued + SHA đã pin', jobs.length === 2 && jobs.every((job) => job.status === 'queued'
    && job.commit_sha === 'a'.repeat(40)));
  const receipts = await rows('github_receipts', `event_id=eq.${state.eventId}&select=id,status`);
  check('receipt resolving', receipts.length === 2 && receipts.every((receipt) => receipt.status === 'resolving'));

  const second = await syncAllAtCutoff({ eventId: state.eventId, clock: () => Date.now(), getHead });
  check('chạy lại không tạo job mới', second.queued === 0 && second.skipped === 2, `skipped=${second.skipped}`);
} catch (error) {
  check('cutoff sync hoàn tất không lỗi', false, error.code || error.message);
} finally {
  await cleanup();
}

const failed = results.filter((item) => !item.ok);
console.log(`RESULT pass=${results.length - failed.length} fail=${failed.length}`);
process.exit(failed.length ? 1 : 0);
