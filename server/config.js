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

/**
 * Danh sách origin public được phép gọi API (`OOTV2_PUBLIC_ORIGIN`, phân tách bằng dấu phẩy).
 * Chỉ nhận http/https; dùng cho guard same-origin khi web chạy sau reverse proxy.
 */
function parsePublicOrigins(raw) {
  return (raw || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => {
      let url;
      try {
        url = new URL(value);
      } catch {
        throw new Error(`OOTV2_PUBLIC_ORIGIN không phải URL hợp lệ: ${value}`);
      }
      if (!['http:', 'https:'].includes(url.protocol)) {
        throw new Error(`OOTV2_PUBLIC_ORIGIN chỉ nhận http/https: ${value}`);
      }
      return url.origin;
    });
}

/**
 * Cấu hình `trust proxy` của Express cho `X-Forwarded-For`/`X-Forwarded-Proto`.
 * Mặc định `loopback`: chỉ tin proxy chạy cùng máy (Caddy/Nginx), không tin header
 * từ client ở xa. Đặt `0` để tắt hoàn toàn, hoặc số hop nếu proxy ở máy khác.
 */
function parseTrustProxy(raw) {
  const value = (raw || '').trim();
  if (!value) return 'loopback';
  if (['0', 'false', 'off', 'no'].includes(value.toLowerCase())) return false;
  if (/^\d+$/.test(value)) return Number(value);
  return value;
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

  /**
   * Origin public được phép gọi API thay đổi state, ví dụ
   * `OOTV2_PUBLIC_ORIGIN=https://ootv2.truong.edu.vn`.
   * Same-origin sau reverse proxy vẫn được chấp nhận dù không khai báo.
   */
  publicOrigins: parsePublicOrigins(process.env.OOTV2_PUBLIC_ORIGIN),

  /** Số hop proxy tin cậy cho `req.ip` (rate limit) và `req.secure` (cookie Secure). */
  trustProxy: parseTrustProxy(process.env.OOTV2_TRUST_PROXY),

  /** Đường dẫn Python tuỳ chọn; để trống thì tự dò `python` / `py -3` / `python3`. */
  pythonBin: process.env.OOTV2_PYTHON_BIN || '',

  limits: {
    /**
     * Kích thước tối đa file bot upload: 256 KiB (profile `bot.v1`).
     * Thay cho 64 KiB của MVP; bucket `ootv2-bots` phải được nâng cùng giới hạn bằng
     * `node tools/cli/setup-shared-storage.js` trước khi nhận bài mới.
     */
    maxSourceBytes: 256 * 1024,
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
