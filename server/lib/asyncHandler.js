/**
 * asyncHandler — chuyển rejection của handler async thành `next(error)` để
 * error middleware chung xử lý (hoạt động với mọi bản Express, không phụ thuộc
 * hành vi auto-forward của Express 5).
 */
export function asyncHandler(handler) {
  return function wrapped(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

export default { asyncHandler };
