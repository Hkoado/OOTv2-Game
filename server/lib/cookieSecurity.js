/**
 * cookieSecurity.js — quyết định cờ `Secure` cho cookie phiên.
 *
 * `req.secure` chỉ đúng khi Express tin `X-Forwarded-Proto` (xem `trustProxy` trong
 * config). Trên Vercel/Cloudflare, nếu `trust proxy` chưa khớp thì cookie phiên sẽ thiếu
 * `Secure` dù người dùng đang ở HTTPS. Đọc thẳng header chuyển tiếp là an toàn: kẻ tấn
 * công tự khai `https` chỉ làm cookie của chính họ chặt hơn (không gửi qua HTTP), không
 * ảnh hưởng người khác.
 */

/** @param {import('express').Request | undefined} req */
export function isSecureRequest(req) {
  if (req?.secure === true) return true;
  const header = typeof req?.get === 'function'
    ? req.get('x-forwarded-proto')
    : req?.headers?.['x-forwarded-proto'];
  return String(header || '').split(',')[0].trim().toLowerCase() === 'https';
}

export default isSecureRequest;
