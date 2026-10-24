/**
 * vercelPath.js — Dựng lại URL gốc cho Express khi chạy trên Vercel.
 *
 * Vì sao cần: với project không framework, Vercel tạo 1 function cho mỗi file trong
 * `api/` và chỉ match function `api/[...path].js` cho **một** segment (`/api/health`).
 * Path sâu hơn (`/api/local/login`) không khớp function nào nên trả 404 của Vercel.
 *
 * Cách xử lý: `vercel.json` rewrite mọi `/api/*` về function `/api` kèm query nội bộ
 * `__ootv2_path=<phần còn lại>` (đúng hướng dẫn "configure rewrites to send your API
 * paths to the same function" của Vercel). Hàm này dựng lại path đầy đủ rồi mới đưa
 * request vào Express, và **luôn xoá** tham số nội bộ để handler không nhìn thấy nó.
 *
 * Không đặt helper này trong `api/`: mỗi file trong `api/` bị Vercel deploy thành
 * một function riêng.
 */

/** Tên tham số nội bộ do rewrite của Vercel sinh ra (không phải tham số của API). */
export const INTERNAL_PATH_PARAM = '__ootv2_path';

/** Các path của function mà rewrite trỏ tới; chỉ khi đó mới dùng tham số nội bộ. */
const REWRITE_TARGETS = new Set(['/api', '/api/index']);

/** Chỉ nhận phần path an toàn: chữ, số, `-`, `_`, `.`, `~`, `/`; không `..`. */
const SAFE_PATH_RE = /^(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9\-._~/]*$/u;

/**
 * Chuẩn hoá `req.url` trước khi giao cho Express.
 *
 * - URL bình thường (không có `__ootv2_path`) được trả nguyên.
 * - `__ootv2_path` luôn bị xoá khỏi query.
 * - Chỉ dựng lại path khi request đang trỏ đúng vào function rewrite (`/api`), nên
 *   client tự thêm tham số này vào một path thật sẽ không đổi được route.
 *
 * @param {string} rawUrl `req.url` (path + query).
 * @returns {string} URL đã chuẩn hoá.
 */
export function restoreApiUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || rawUrl === '') return rawUrl;
  const queryIndex = rawUrl.indexOf('?');
  if (queryIndex === -1) return rawUrl;

  const path = rawUrl.slice(0, queryIndex);
  const params = new URLSearchParams(rawUrl.slice(queryIndex + 1));
  if (!params.has(INTERNAL_PATH_PARAM)) return rawUrl;

  const rest = (params.get(INTERNAL_PATH_PARAM) || '').split('#')[0].replace(/^\/+/u, '');
  params.delete(INTERNAL_PATH_PARAM);

  const target = REWRITE_TARGETS.has(path) && SAFE_PATH_RE.test(rest)
    ? `/api${rest ? `/${rest}` : ''}`
    : path;
  const query = params.toString();
  return query ? `${target}?${query}` : target;
}
