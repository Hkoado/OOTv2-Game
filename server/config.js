import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Thư mục gốc repo (server/ nằm ngay dưới). */
export const ROOT_DIR = path.resolve(here, '..');

// Nạp .env nếu có (Node >= 21 có process.loadEnvFile, không cần dependency).
try {
  process.loadEnvFile(path.join(ROOT_DIR, '.env'));
} catch {
  // Không có .env là bình thường; toàn bộ giá trị đều có default an toàn.
}

function resolveFromRoot(value, fallback) {
  if (!value) return fallback;
  return path.isAbsolute(value) ? value : path.join(ROOT_DIR, value);
}

const dataDir = resolveFromRoot(process.env.OOTV2_DATA_DIR, path.join(ROOT_DIR, 'data'));

export const config = {
  /** Thư mục dữ liệu private (DB + bot upload). Không nằm trong public/, src/, dist/. */
  dataDir,
  submissionsDir: path.join(dataDir, 'submissions'),
  dbPath: resolveFromRoot(process.env.OOTV2_DB_PATH, path.join(dataDir, 'ootv2.sqlite')),

  /** MVP chỉ bind loopback. Không mở public khi chưa có sandbox cấp OS. */
  host: process.env.OOTV2_API_HOST || '127.0.0.1',
  port: Number(process.env.OOTV2_API_PORT || 3001),

  /** Khoá admin cho thao tác tạo/khởi động giải. Chỉ dùng cho demo local. */
  adminKey: process.env.OOTV2_ADMIN_KEY || 'local-dev-admin-key',

  /** Đường dẫn Python tuỳ chọn; để trống thì tự dò `python` / `py -3` / `python3`. */
  pythonBin: process.env.OOTV2_PYTHON_BIN || '',

  limits: {
    /** Kích thước tối đa file bot upload (64 KiB). */
    maxSourceBytes: 64 * 1024,
    /** Kích thước tối đa JSON gửi cho bot (64 KiB). */
    maxInputBytes: 64 * 1024,
    /** Giới hạn stdout/stderr mỗi luồng (16 KiB). */
    maxOutputBytes: 16 * 1024,
    /** Timeout mỗi request setup/move. */
    setupTimeoutMs: 3000,
    moveTimeoutMs: 2000,
    /** Số nước đi tối đa của cả hai bên cộng lại. */
    maxPlies: 200,
    /** Chu kỳ poll của worker khi chưa có match. */
    workerPollMs: 1000,
  },
};

export default config;
