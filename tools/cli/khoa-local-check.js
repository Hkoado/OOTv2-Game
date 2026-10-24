/** Local-only evidence capture. No DB/network, no credentials, no deployment. */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const folder = new URL('../../data/khoa-current/', import.meta.url);
mkdirSync(folder, { recursive: true });
const tasks = [
  ['full', process.execPath, ['--test', '--test-concurrency=1', 'tests/*.test.js']],
  ['build', process.execPath, ['node_modules/vite/bin/vite.js', 'build']],
  ['diff', 'git', ['diff', '--check']],
  ['shell', 'wsl.exe', ['-d', 'Ubuntu', '--', 'bash', '-lc',
    'bash -n /mnt/d/OOTv2-Game/tools/provision/deploy-release.sh /mnt/d/OOTv2-Game/tools/provision/workerctl.sh /mnt/d/OOTv2-Game/tools/provision/install-judge.sh']],
];
const results = [];
for (const [name, command, args] of tasks) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', timeout: 180000, windowsHide: true });
  writeFileSync(new URL(`${name}.log`, folder), (result.stdout ?? '') + (result.stderr ?? ''));
  results.push({ name, exit: result.status, error: result.error?.message ?? null });
  writeFileSync(new URL('results.json', folder), JSON.stringify({ complete: false, results }, null, 2));
}
writeFileSync(new URL('results.json', folder), JSON.stringify({ complete: true, results }, null, 2));