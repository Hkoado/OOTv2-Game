/**
 * uploadPolicy.js — Quyết định cổng upload file qua HTTP (H2).
 *
 * Hàm thuần để test cả hai chế độ mà không cần đổi env lúc chạy:
 * - Đội online: **luôn** bị chặn, nộp bằng GitHub (`POST /events/:id/submissions/from-github`).
 * - Admin/BTC: chỉ khi bật `OOTV2_ALLOW_ONLINE_UPLOAD=1` (trusted-dev/import offline).
 * Không chặn quy trình phát/thu file offline qua USB (không đi qua HTTP).
 */

export const UPLOAD_DISABLED = 'upload_disabled';

const ADMIN_MESSAGE = 'Upload file qua HTTP đang tắt. Bật OOTV2_ALLOW_ONLINE_UPLOAD=1 nếu BTC chủ động dùng trusted-dev.';
const TEAM_MESSAGE = 'Đội nộp bot qua GitHub (repo + branch). Upload file chỉ dành cho BTC/offline.';

/**
 * @param {{ role?: string, allowOnline?: boolean }} input
 * @returns {{ allowed: boolean, error: string|null, message: string|null }}
 */
export function onlineUploadDecision({ role, allowOnline = false } = {}) {
  if (role === 'admin' && allowOnline === true) {
    return { allowed: true, error: null, message: null };
  }
  return {
    allowed: false,
    error: UPLOAD_DISABLED,
    message: role === 'admin' ? ADMIN_MESSAGE : TEAM_MESSAGE,
  };
}

export default { UPLOAD_DISABLED, onlineUploadDecision };
