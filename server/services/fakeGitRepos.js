import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import config, { ROOT_DIR } from '../config.js';

const FAKE_REPOS_DIR = path.join(config.dataDir, 'fake-repos');

const FAKE_TEMPLATES = {
  'sample-bot': path.join(ROOT_DIR, 'examples', 'sample_bot.py'),
  'illegal-bot': path.join(ROOT_DIR, 'tests', 'fixtures', 'bot_illegal_move.py'),
  'hang-bot': path.join(ROOT_DIR, 'tests', 'fixtures', 'bot_hang.py'),
};

/**
 * Khởi tạo hoặc cập nhật các fake repository Git cục bộ trong data/fake-repos/.
 * Dùng để test git clone/pull không cần kết nối Internet hoặc token GitHub.
 */
export function ensureFakeGitRepos() {
  fs.mkdirSync(FAKE_REPOS_DIR, { recursive: true });

  for (const [name, sourceFile] of Object.entries(FAKE_TEMPLATES)) {
    const repoPath = path.join(FAKE_REPOS_DIR, name);
    const gitDir = path.join(repoPath, '.git');

    if (!fs.existsSync(gitDir)) {
      fs.mkdirSync(repoPath, { recursive: true });
      const botDest = path.join(repoPath, 'bot.py');
      if (fs.existsSync(sourceFile)) {
        fs.copyFileSync(sourceFile, botDest);
      } else {
        fs.writeFileSync(botDest, 'import sys\nprint("fake bot")\n', 'utf8');
      }

      spawnSync('git', ['init'], { cwd: repoPath, windowsHide: true });
      spawnSync('git', ['config', 'user.name', 'OOTv2 Bot'], { cwd: repoPath, windowsHide: true });
      spawnSync('git', ['config', 'user.email', 'bot@ootv2.local'], { cwd: repoPath, windowsHide: true });
      spawnSync('git', ['add', 'bot.py'], { cwd: repoPath, windowsHide: true });
      spawnSync('git', ['commit', '-m', 'Initial bot commit'], { cwd: repoPath, windowsHide: true });
    }
  }

  // Repository cho test syntax error
  const syntaxRepoPath = path.join(FAKE_REPOS_DIR, 'syntax-error-bot');
  if (!fs.existsSync(path.join(syntaxRepoPath, '.git'))) {
    fs.mkdirSync(syntaxRepoPath, { recursive: true });
    fs.writeFileSync(path.join(syntaxRepoPath, 'bot.py'), 'def syntax_error(\n', 'utf8');
    spawnSync('git', ['init'], { cwd: syntaxRepoPath, windowsHide: true });
    spawnSync('git', ['config', 'user.name', 'OOTv2 Bot'], { cwd: syntaxRepoPath, windowsHide: true });
    spawnSync('git', ['config', 'user.email', 'bot@ootv2.local'], { cwd: syntaxRepoPath, windowsHide: true });
    spawnSync('git', ['add', 'bot.py'], { cwd: syntaxRepoPath, windowsHide: true });
    spawnSync('git', ['commit', '-m', 'Broken bot commit'], { cwd: syntaxRepoPath, windowsHide: true });
  }

  return FAKE_REPOS_DIR;
}

/**
 * Phân giải repository URL: nếu là fake/mock link (e.g. https://github.com/mock/sample-bot),
 * ánh xạ sang URL file:// của repo cục bộ.
 */
export function resolveGitRepoUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return rawUrl;

  const trimmed = rawUrl.trim();
  const mockPrefix = /^https:\/\/github\.com\/(mock|fake)\/([a-zA-Z0-9_.-]+)\/?$/i;
  const match = trimmed.match(mockPrefix);

  if (match) {
    ensureFakeGitRepos();
    const repoName = match[2];
    const localPath = path.join(FAKE_REPOS_DIR, repoName);
    if (fs.existsSync(localPath)) {
      return pathToFileURL(localPath).href;
    }
  }

  return trimmed;
}

export default { ensureFakeGitRepos, resolveGitRepoUrl };

