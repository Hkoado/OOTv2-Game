/** HttpError — lỗi API có mã máy đọc được, response dạng `{error, message}`. */
export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

export function badRequest(code, message) {
  return new HttpError(400, code, message);
}

export function notFound(code, message) {
  return new HttpError(404, code, message);
}

export function conflict(code, message) {
  return new HttpError(409, code, message);
}

export function unauthorized(code, message) {
  return new HttpError(401, code, message);
}

/** Gửi lỗi theo format thống nhất; không lộ stack/đường dẫn máy chủ ra client. */
export function sendError(res, error) {
  const status = error instanceof HttpError ? error.status : 500;
  const code = error instanceof HttpError ? error.code : 'internal_error';
  const message = error instanceof HttpError ? error.message : 'Lỗi máy chủ nội bộ';
  if (!(error instanceof HttpError)) {
    console.error('[api] lỗi không mong đợi:', error);
  }
  res.status(status).json({ error: code, message });
}

export default { HttpError, sendError };
