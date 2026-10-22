import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { existsSync } from 'node:fs';

import { startTestEnv } from './helpers/testEnv.js';
import { ensureFakeGitRepos, resolveGitRepoUrl } from '../server/services/fakeGitRepos.js';
import { syncBotFromGit } from '../server/services/gitSync.js';
import { checkAndAutoPull } from '../server/services/autoPuller.js';

test('fakeGitRepos: creates local git repositories and resolves mock URLs', async () => {
  const env = await startTestEnv({ withServer: false });
  try {
    const fakeDir = ensureFakeGitRepos();
    assert.equal(existsSync(path.join(fakeDir, 'sample-bot', '.git')), true);
    assert.equal(existsSync(path.join(fakeDir, 'sample-bot', 'bot.py')), true);

    const resolved = resolveGitRepoUrl('https://github.com/mock/sample-bot');
    assert.equal(resolved.startsWith('file:'), true);
    assert.equal(resolved.includes('sample-bot'), true);

    // Non-mock URL remains unchanged
    assert.equal(
      resolveGitRepoUrl('https://github.com/user/real-repo'),
      'https://github.com/user/real-repo'
    );
  } finally {
    env.cleanup();
  }
});

test('gitSync: pulls sample bot from mock git repo, validates it and saves submission', async () => {
  const env = await startTestEnv({ withServer: false });
  try {
    const { createParticipant } = await import('../server/services/participants.js');
    const { initAccounts, createAccount } = await import('../server/services/localAccounts.js');
    initAccounts();

    const account = await createAccount({
      username: 'gitteama',
      password: 'password123456',
      name: 'Git Team A',
      role: 'team',
    });

    const res = await syncBotFromGit({
      participantId: account.participant_id,
      repositoryUrl: 'https://github.com/mock/sample-bot',
      branch: 'master',
      accountId: account.id,
    });

    assert.equal(res.ok, true);
    assert.equal(res.submission.status, 'valid');
    assert.equal(res.submission.source_type, 'git');
    assert.equal(res.submission.repo_url, 'https://github.com/mock/sample-bot');
    assert.equal(typeof res.commitSha, 'string');
    assert.equal(res.commitSha.length >= 7, true);
    assert.equal(res.submission.commit_sha, res.commitSha);
  } finally {
    env.cleanup();
  }
});

test('gitSync: invalid bot syntax in git repo is marked invalid and stores validation error', async () => {
  const env = await startTestEnv({ withServer: false });
  try {
    const { createParticipant } = await import('../server/services/participants.js');
    const participant = createParticipant('Git Team Broken');

    const res = await syncBotFromGit({
      participantId: participant.id,
      repositoryUrl: 'https://github.com/mock/syntax-error-bot',
      branch: 'master',
    });

    assert.equal(res.ok, true);
    assert.equal(res.submission.status, 'invalid');
    assert.equal(typeof res.submission.validation_error, 'string');
  } finally {
    env.cleanup();
  }
});

test('autoPuller: syncs all teams in draft tournament with deadlines', async () => {
  const env = await startTestEnv({ withServer: false });
  try {
    const { createTournament } = await import('../server/services/tournaments.js');
    const { initAccounts, createAccount, updateProfile } = await import('../server/services/localAccounts.js');
    initAccounts();

    const acc1 = await createAccount({
      username: 'autopull_team1',
      password: 'password123456',
      name: 'AutoPull Team 1',
      role: 'team',
    });
    updateProfile(acc1.id, {
      members: 'Alice',
      contact: 'alice@test.local',
      repository: 'https://github.com/mock/sample-bot',
      branch: 'master',
    });

    // Create tournament with passed deadline
    const pastDeadline = new Date(Date.now() - 60000).toISOString();
    const tournament = createTournament({
      name: 'Auto Pull Test Cup',
      participantIds: [acc1.participant_id],
      deadline: pastDeadline,
    });

    const reports = await checkAndAutoPull({ tournamentId: tournament.id });
    assert.equal(reports.length, 1);
    assert.equal(reports[0].tournamentId, tournament.id);
    assert.equal(reports[0].results.length, 1);
    assert.equal(reports[0].results[0].synced, true);
    assert.equal(reports[0].results[0].status, 'valid');
  } finally {
    env.cleanup();
  }
});

