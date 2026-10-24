/**
 * api/index.js — Function `/api` trên Vercel.
 *
 * Vercel chỉ match `api/[...path].js` cho một segment, nên `vercel.json` rewrite các
 * path sâu hơn (`/api/local/login`, `/api/live/matches/...`) về đây kèm tham số nội bộ;
 * handler dùng chung dựng lại URL gốc trước khi vào Express.
 */
import handler from './[...path].js';

export default handler;
