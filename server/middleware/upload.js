import multer from 'multer';

import config from '../config.js';
import { badRequest } from '../lib/httpError.js';

/**
 * Upload bot dùng memoryStorage: file chỉ được ghi ra đĩa sau khi tên/đuôi/kích thước
 * đã hợp lệ, nên không để lại file rác khi upload sai.
 * - Tên file do server sinh (`<uuid>.py`), KHÔNG dùng `originalname`.
 * - MIME chỉ là tín hiệu phụ nên chỉ kiểm tra đuôi `.py`.
 * - Đúng 1 file ở trường `file`, tối đa 64 KiB.
 */
const memory = multer.memoryStorage();

const uploader = multer({
  storage: memory,
  limits: {
    fileSize: config.limits.maxSourceBytes,
    files: 1,
    fields: 4,
    parts: 6,
  },
  fileFilter(req, file, cb) {
    const name = file.originalname || '';
    if (!name.toLowerCase().endsWith('.py')) {
      const error = new Error('Chỉ chấp nhận file .py (không nhận ZIP/exe/định dạng khác)');
      error.code = 'BAD_EXTENSION';
      cb(error);
      return;
    }
    cb(null, true);
  },
});

/** Middleware nhận 1 file `file`; đổi lỗi multer thành HttpError 4xx rõ ràng. */
export function acceptBotUpload(req, res, next) {
  uploader.single('file')(req, res, (error) => {
    if (!error) {
      next();
      return;
    }
    if (error.code === 'LIMIT_FILE_SIZE') {
      next(badRequest('file_too_large', `File bot vượt quá ${config.limits.maxSourceBytes} bytes`));
      return;
    }
    if (error.code === 'BAD_EXTENSION') {
      next(badRequest('bad_extension', error.message));
      return;
    }
    if (error.code === 'LIMIT_UNEXPECTED_FILE') {
      next(badRequest('unexpected_file_field', 'Chỉ nhận 1 file ở trường `file`'));
      return;
    }
    next(badRequest('upload_failed', error.message));
  });
}

export default { acceptBotUpload };
