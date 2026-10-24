import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * `import.meta.url === pathToFileURL(process.argv[1]).href` không đủ khi release được
 * deploy qua symlink (`/srv/ootv2/current` → `releases/<id>`): Node realpath module URL còn
 * argv giữ nguyên đường dẫn `current`, nên service chạy bằng đường dẫn tuyệt đối sẽ thoát 0
 * mà không làm gì (im lặng, rất khó phát hiện). So sánh sau khi realpath cả hai phía.
 */
export function isMainModule(metaUrl, entryPath = process.argv[1]) {
  // Không đặt default `metaUrl = import.meta.url`: default parameter được đánh giá TRONG
  // module này, nên nó là URL của entrypoint.js chứ không phải của caller.
  if (typeof metaUrl !== 'string' || !metaUrl || !entryPath) return false;
  try {
    return realpathSync(fileURLToPath(metaUrl)) === realpathSync(entryPath);
  } catch {
    return false;
  }
}

export default { isMainModule };
