/**
 * BTC/operator: enqueue the one-shot GitHub cutoff pull for an event.
 * Usage: npm run github:cutoff -- <eventId>
 * The admin API is the normal path; this CLI is for local operations/drills.
 */
import '../../server/config.js';
import { syncAllAtCutoff } from '../../server/services/githubCutoff.js';

const eventId = process.argv[2];
if (!eventId) {
  console.error('Usage: npm run github:cutoff -- <eventId>');
  process.exit(2);
}
try {
  const summary = await syncAllAtCutoff({ eventId, actor: null });
  console.log(JSON.stringify(summary, null, 2));
  process.exit(summary.failed.length === 0 ? 0 : 1);
} catch (error) {
  console.error(JSON.stringify({ error: error.code || error.message }, null, 2));
  process.exit(1);
}
