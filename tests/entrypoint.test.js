import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

import { isMainModule } from '../server/shared/entrypoint.js';

test('isMainModule nhận entrypoint qua đường dẫn tuyệt đối', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ootv2-entry-'));
  try {
    const file = join(dir, 'worker.js');
    writeFileSync(file, '// probe\n', 'utf8');
    assert.equal(isMainModule(pathToFileURL(file).href, file), true);
    assert.equal(isMainModule(pathToFileURL(join(dir, 'other.js')).href, file), false);
    assert.equal(isMainModule(pathToFileURL(file).href, undefined), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('isMainModule nhận release deploy qua symlink (current -> releases/<id>)', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'ootv2-release-'));
  try {
    const release = join(root, 'releases', '20261024T160212Z-de341e9f7a9e');
    mkdirSync(release, { recursive: true });
    const real = join(release, 'worker.js');
    writeFileSync(real, '// probe\n', 'utf8');
    const current = join(root, 'current');
    try {
      symlinkSync(release, current, process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
      t.skip(`cannot create symlink here: ${error.code}`);
      return;
    }
    // systemd gọi `node /srv/ootv2/current/worker.js`: argv giữ đường dẫn current, còn
    // import.meta.url đã bị Node realpath về releases/<id>. So sánh thô sẽ trả false và
    // service thoát 0 mà không chạy gì.
    assert.equal(isMainModule(pathToFileURL(real).href, join(current, 'worker.js')), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('worker entrypoints dùng isMainModule thay vì so sánh href thô', async () => {
  const { readFileSync } = await import('node:fs');
  for (const file of ['server/officialWorker.js', 'server/githubWorker.js']) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.match(source, /import \{ isMainModule \} from '\.\/shared\/entrypoint\.js'/);
    assert.match(source, /const isEntryPoint = isMainModule\(import\.meta\.url\);/);
    assert.doesNotMatch(source, /import\.meta\.url === pathToFileURL/);
  }
});

test('isMainModule không tự nhận chính helper là entrypoint', async () => {
  const { isMainModule } = await import('../server/shared/entrypoint.js');
  const helperUrl = new URL('../server/shared/entrypoint.js', import.meta.url).href;
  // Gọi thiếu metaUrl phải trả false (không được lấy import.meta.url của helper làm mặc định).
  assert.equal(isMainModule(undefined, new URL(import.meta.url).pathname), false);
  assert.equal(isMainModule(helperUrl, new URL(import.meta.url).pathname), false);
});
