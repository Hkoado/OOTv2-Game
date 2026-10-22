import { getDb, nowIso } from '../db.js';
import { syncAllTournamentBots } from './gitSync.js';

let pullTimer = null;

/**
 * Kiểm tra các giải đấu draft có cấu hình deadline.
 * Nếu đã tới hoặc qua deadline, tự động kéo code Git cho toàn bộ các đội.
 */
export async function checkAndAutoPull({ force = false, tournamentId = null } = {}) {
  const db = getDb();
  const now = nowIso();

  let query = "SELECT id, name, deadline, status FROM tournaments WHERE status = 'draft'";
  const params = [];
  if (tournamentId) {
    query += ' AND id = ?';
    params.push(tournamentId);
  }

  const drafts = db.prepare(query).all(...params);
  const reports = [];

  for (const tour of drafts) {
    const isDue = force || (tour.deadline && now >= tour.deadline);
    if (!isDue) continue;

    console.log(`[auto-pull] Đang tự động kéo code Git cho giải "${tour.name}" (deadline: ${tour.deadline || 'manual/force'})...`);
    try {
      const results = await syncAllTournamentBots(tour.id);
      reports.push({ tournamentId: tour.id, name: tour.name, results });
      console.log(`[auto-pull] Hoàn thành kéo code cho giải "${tour.name}": ${results.filter((r) => r.synced).length}/${results.length} đội.`);
    } catch (err) {
      console.error(`[auto-pull] Lỗi khi kéo code giải "${tour.name}":`, err.message);
    }
  }

  return reports;
}

/** Khởi động background worker kiểm tra deadline tự động */
export function startAutoPullTimer({ intervalMs = 20000 } = {}) {
  if (pullTimer) return pullTimer;
  pullTimer = setInterval(() => {
    checkAndAutoPull().catch((err) => {
      console.error('[auto-pull] Background check error:', err.message);
    });
  }, intervalMs);
  return pullTimer;
}

export function stopAutoPullTimer() {
  if (pullTimer) {
    clearInterval(pullTimer);
    pullTimer = null;
  }
}

export default { checkAndAutoPull, startAutoPullTimer, stopAutoPullTimer };

