/**
 * reset-live-demo.js — Xoá các giải demo đang chạy để tạo lại giải mới.
 * Chỉ dùng cho dữ liệu demo trên máy phát triển; KHÔNG chạy trên dữ liệu thật.
 *
 * Chạy: `npm run demo:live:reset` hoặc `node tools/cli/reset-live-demo.js`.
 */
import { getDb, initDb } from '../../server/db.js';

initDb();
const db = getDb();
const running = db
  .prepare(
    `SELECT id, name, status FROM tournaments
     WHERE status IN ('group_running','semifinal_running','final_running')`
  )
  .all();

for (const row of running) {
  db.prepare('DELETE FROM tournaments WHERE id = ?').run(row.id);
}

console.log(
  running.length
    ? `Đã xoá ${running.length} giải đang chạy: ${running.map((row) => row.name).join(', ')}`
    : 'Không có giải nào đang chạy.'
);
