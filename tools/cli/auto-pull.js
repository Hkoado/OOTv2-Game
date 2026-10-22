import { initDb } from '../../server/db.js';
import { checkAndAutoPull } from '../../server/services/autoPuller.js';

initDb();

const args = process.argv.slice(2);
const force = args.includes('--force');
const tourIdx = args.indexOf('--tournament');
const tournamentId = tourIdx !== -1 ? args[tourIdx + 1] : null;

console.log('[cli:auto-pull] Bắt đầu kiểm tra và kéo code tự động...');
if (force) console.log('[cli:auto-pull] Chế độ --force: kéo bất kể deadline');
if (tournamentId) console.log(`[cli:auto-pull] Lọc theo giải ID: ${tournamentId}`);

const reports = await checkAndAutoPull({ force, tournamentId });
console.log(`[cli:auto-pull] Hoàn tất. Đã xử lý ${reports.length} giải đấu.`);
for (const report of reports) {
  console.log(`- Giải "${report.name}":`);
  for (const r of report.results) {
    console.log(`  + ${r.name}: ${r.synced ? `OK (SHA: ${r.commit_sha?.slice(0, 8)}, status: ${r.status})` : `Thất bại/Bỏ qua (${r.reason})`}`);
  }
}

