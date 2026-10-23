/**
 * tournamentFormat.js — Hằng số thể thức dùng chung (hàm thuần, không DB).
 *
 * Trước đây các hằng này nằm trong `services/tournaments.js` (driver SQLite).
 * Khi bỏ SQLite, chúng được tách ra đây để `shared/tournaments.js` vẫn dùng
 * đúng một nguồn: 8 đội, 2 bảng, điểm 3/1/0, tie-break theo seed.
 */

/** Chia bảng theo seed: A = 1,4,5,8 — B = 2,3,6,7 (chuẩn cho 8 đội). */
export const GROUP_SEEDS = Object.freeze({
  A: Object.freeze([1, 4, 5, 8]),
  B: Object.freeze([2, 3, 6, 7]),
});

export const RUNNING_STATUSES = Object.freeze(['group_running', 'semifinal_running', 'final_running']);
export const POINTS = Object.freeze({ win: 3, draw: 1, loss: 0 });
export const TIE_BREAKERS = Object.freeze(['points', 'wins', 'win_loss_difference', 'seed_order']);

export default { GROUP_SEEDS, RUNNING_STATUSES, POINTS, TIE_BREAKERS };
