import { spawn } from 'node:child_process';
import { readFileSync, rmSync, statSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import config from '../config.js';
import { getDb } from '../db.js';
import { badRequest } from '../lib/httpError.js';
import { createSubmission } from './participants.js';
import { updateAccountSyncStatus } from './localAccounts.js';
import { resolveGitRepoUrl } from './fakeGitRepos.js';
import { sharedEnabled } from '../shared/client.js';

function execGit(args, { cwd, timeout = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timer = null;

    if (timeout > 0) {
      timer = setTimeout(() => {
        child.kill();
        reject(new Error(`Git command timed out after ${timeout}ms`));
      }, timeout);
    }

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });

    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
      } else {
        const msg = stderr.trim() || stdout.trim() || `Exit code ${code}`;
        reject(new Error(msg));
      }
    });
  });
}

/**
 * Kéo bot từ Git repository (public GitHub hoặc file:// mock test),
 * trích xuất file bot.py, tính SHA-256 và tạo submission mới.
 */
export async function syncBotFromGit({
  participantId,
  repositoryUrl,
  branch = 'main',
  accountId = null,
}) {
  if (!repositoryUrl || typeof repositoryUrl !== 'string') {
    throw badRequest('bad_repository', 'Chưa có URL repository Git');
  }

  const resolvedUrl = resolveGitRepoUrl(repositoryUrl);
  const targetBranch = branch ? branch.trim() : 'main';
  const tempDir = path.join(os.tmpdir(), `ootv2-git-${randomUUID()}`);

  if (accountId && !sharedEnabled) {
    updateAccountSyncStatus(accountId, { status: 'syncing', error: null });
  }

  try {
    // Clone shallow 1 commit
    const cloneArgs = ['clone', '--depth', '1'];
    if (targetBranch) {
      cloneArgs.push('--branch', targetBranch);
    }
    cloneArgs.push(resolvedUrl, tempDir);

    await execGit(cloneArgs, { timeout: 30000 });

    // Lấy commit SHA hiện tại
    const revResult = await execGit(['rev-parse', 'HEAD'], { cwd: tempDir, timeout: 5000 });
    const commitSha = revResult.stdout.trim();

    // Tìm file bot.py ở root của repo
    const botPath = path.join(tempDir, 'bot.py');
    if (!existsSync(botPath)) {
      throw badRequest(
        'missing_bot_file',
        'Không tìm thấy file `bot.py` ở thư mục gốc của repository'
      );
    }

    const stat = statSync(botPath);
    if (!stat.isFile()) {
      throw badRequest('invalid_bot_file', '`bot.py` trong repository không phải là file thường');
    }
    if (stat.size === 0) {
      throw badRequest('empty_bot_file', 'File `bot.py` trong repository bị rỗng');
    }
    const maxBytes = 256 * 1024;
    if (stat.size > maxBytes) {
      throw badRequest(
        'file_too_large',
        `File bot.py (${Math.ceil(stat.size / 1024)} KiB) vượt giới hạn ${maxBytes / 1024} KiB`
      );
    }

    const buffer = readFileSync(botPath);

    // Xoá thư mục temp ngay khi đã đọc buffer
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      /* ignore temp cleanup */
    }

    // Tạo submission và chạy validation pipeline
    const submissionCreator = sharedEnabled
      ? (await import('../shared/participants.js')).createSubmission
      : createSubmission;

    const submission = await submissionCreator(
      participantId,
      { buffer, originalname: 'bot.py' },
      {
        commitSha,
        repoUrl: repositoryUrl,
        branch: targetBranch,
        sourceType: 'git',
      }
    );

    if (accountId && !sharedEnabled) {
      updateAccountSyncStatus(accountId, {
        status: submission.status,
        error: submission.validation_error || null,
      });
    }

    return {
      ok: true,
      submission,
      commitSha,
      repository: repositoryUrl,
      branch: targetBranch,
    };
  } catch (error) {
    // Dọn dẹp thư mục tạm
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }

    const errorMsg = error.message.slice(0, 300);
    if (accountId && !sharedEnabled) {
      updateAccountSyncStatus(accountId, {
        status: 'error',
        error: errorMsg,
      });
    }

    throw badRequest('git_sync_failed', `Đồng bộ Git thất bại: ${errorMsg}`);
  }
}

/**
 * Đồng bộ toàn bộ các đội có repo Git trong một giải đấu draft.
 */
export async function syncAllTournamentBots(tournamentId) {
  let entries;
  if (sharedEnabled) {
    const { rows, uuid } = await import('../shared/client.js');
    const [tEntries, pList, aList] = await Promise.all([
      rows('tournament_entries', `tournament_id=eq.${uuid(tournamentId)}`),
      rows('participants'),
      rows('accounts')
    ]);
    const pMap = new Map(pList.map(p => [p.id, p.name]));
    const aMap = new Map(aList.map(a => [a.participant_id, a]));
    entries = tEntries.map(e => ({
      entry_id: e.id,
      participant_id: e.participant_id,
      participant_name: pMap.get(e.participant_id) || 'Unknown',
      account_id: aMap.get(e.participant_id)?.id,
      repository: aMap.get(e.participant_id)?.repository || '',
      branch: aMap.get(e.participant_id)?.branch || 'main',
    }));
  } else {
    const db = getDb();
    entries = db
      .prepare(
        `SELECT e.id AS entry_id, e.participant_id, p.name AS participant_name,
                a.id AS account_id, a.repository, a.branch
         FROM tournament_entries e
         JOIN participants p ON p.id = e.participant_id
         LEFT JOIN local_accounts a ON a.participant_id = e.participant_id
         WHERE e.tournament_id = ?`
      )
      .all(tournamentId);
  }

  const results = [];
  for (const entry of entries) {
    if (!entry.repository) {
      results.push({
        participant_id: entry.participant_id,
        name: entry.participant_name,
        synced: false,
        reason: 'no_repository',
      });
      continue;
    }

    try {
      const res = await syncBotFromGit({
        participantId: entry.participant_id,
        repositoryUrl: entry.repository,
        branch: entry.branch || 'main',
        accountId: entry.account_id,
      });
      results.push({
        participant_id: entry.participant_id,
        name: entry.participant_name,
        synced: true,
        status: res.submission.status,
        commit_sha: res.commitSha,
        validation_error: res.submission.validation_error,
      });
    } catch (err) {
      results.push({
        participant_id: entry.participant_id,
        name: entry.participant_name,
        synced: false,
        reason: err.message,
      });
    }
  }

  return results;
}

export default { syncBotFromGit, syncAllTournamentBots };
