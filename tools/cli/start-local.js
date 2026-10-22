import { spawn } from 'node:child_process';
import { mkdirSync, openSync, closeSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import config, { ROOT_DIR } from '../../server/config.js';

const manifest = path.join(config.dataDir, 'local-processes.json');
if (!existsSync(path.join(ROOT_DIR, 'dist', 'index.html'))) throw new Error('Chạy npm run build trước.');
if (existsSync(manifest)) {
  const old = JSON.parse(readFileSync(manifest, 'utf8'));
  const live = old.filter((item) => { try { process.kill(item.pid, 0); return true; } catch { return false; } });
  if (live.length) throw new Error('Các tiến trình local cũ còn chạy. Xem data/local-processes.json, không tự khởi động worker thứ hai.');
}
async function portAvailable(port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => server.close(resolve));
  });
}
await portAvailable(3000); await portAvailable(config.port);
mkdirSync(config.dataDir, { recursive: true });
const records = [];
for (const [name, args] of [
  ['api', ['server/index.js']],
  ['worker', ['server/worker.js']],
  ['web', ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '3000', '--strictPort']],
]) {
  const log = path.join(config.dataDir, `local-${name}.log`);
  const fd = openSync(log, 'a');
  const child = spawn(process.execPath, args, { cwd: ROOT_DIR, detached: true, windowsHide: true, stdio: ['ignore', fd, fd] });
  child.unref(); closeSync(fd);
  records.push({ name, pid: child.pid, log });
}
writeFileSync(manifest, JSON.stringify(records, null, 2));
console.log('Đã yêu cầu khởi chạy. Kiểm tra health trước khi dùng: http://127.0.0.1:3001/api/health');
console.log('Web: http://127.0.0.1:3000/ — mở lên luôn là màn hình đăng nhập giải đấu.');
console.log(`PID/log: ${manifest}. Chỉ local trusted-only, không mở port ra Internet.`);