import test from 'node:test';
import assert from 'node:assert/strict';

import { startTestEnv, example } from './helpers/testEnv.js';
import { runMatch } from '../server/judge/matchRunner.js';
import { EMPTY_MAP } from '../src/game/maps.js';

test('Worker-Fix proposal: runMatch runs successfully with blocked map (twin-gates)', async () => {
  const env = await startTestEnv({ legacyAccess: true });
  try {
    const { participant: p1, submission: sub1 } = await env.createParticipantWithBot('Bot Red Obstacle', example('sample_bot.py'));
    const { participant: p2, submission: sub2 } = await env.createParticipantWithBot('Bot Blue Obstacle', example('sample_bot.py'));

    const db = env.db.getDb();
    const redPath = db.prepare('SELECT storage_path FROM submissions WHERE id = ?').get(sub1.id).storage_path;
    const bluePath = db.prepare('SELECT storage_path FROM submissions WHERE id = ?').get(sub2.id).storage_path;

    const twinGatesMap = {
      ...EMPTY_MAP,
      id: 'twin-gates',
      blocked: ['e4', 'e6'],
    };

    const outcome = await runMatch({
      matchId: 'match-obstacle-test',
      seed: 9999,
      red: { name: p1.name, filePath: redPath },
      blue: { name: p2.name, filePath: bluePath },
      map: twinGatesMap,
    });

    assert.equal(['red_win', 'blue_win', 'draw'].includes(outcome.result), true);
    assert.equal(outcome.replay.map.id, 'twin-gates');
    assert.deepEqual(outcome.replay.map.blocked, ['e4', 'e6']);
    assert.equal(outcome.notes.length === 0 || outcome.notes.includes('đạt giới hạn 200 plies'), true);
  } finally {
    env.cleanup();
  }
});

test('Worker-Fix proposal: startTournament and worker process match on blocked map when enabled', async () => {
  const prevEnv = process.env.OOTV2_ALLOW_BLOCKED_MAPS;
  process.env.OOTV2_ALLOW_BLOCKED_MAPS = '1';
  const env = await startTestEnv({ legacyAccess: true });
  try {
    const { createTournament, startTournament } = await import('../server/services/tournaments.js');
    const { processOneMatch } = await import('../server/worker.js');

    const participantIds = [];
    for (let i = 1; i <= 8; i++) {
      const { participant } = await env.createParticipantWithBot(`Team Obstacle ${i}`, example('sample_bot.py'));
      participantIds.push(participant.id);
    }

    const fourPillarsMap = {
      ...EMPTY_MAP,
      id: 'four-pillars',
      blocked: ['d4', 'f4', 'd6', 'f6'],
    };

    const t = createTournament({
      name: 'Giải Đấu Bốn Trụ',
      participantIds,
      map: fourPillarsMap,
    });

    // Start tournament succeeds on blocked map under proposal
    const started = startTournament(t.id);
    assert.equal(started.status, 'group_running');
    assert.equal(started.map.id, 'four-pillars');
    assert.equal(started.map.blocked.length, 4);

    // Worker can process match on this blocked map
    const step = await processOneMatch({ verbose: false });
    assert.equal(step.processed, true);
    assert.equal(step.advanced.status, 'group_running');

    // Verify match in DB has replay containing map info
    const db = env.db.getDb();
    const finishedMatch = db.prepare("SELECT replay_json FROM matches WHERE tournament_id = ? AND status = 'finished' LIMIT 1").get(t.id);
    assert.equal(Boolean(finishedMatch), true);
    const replay = JSON.parse(finishedMatch.replay_json);
    assert.equal(replay.map.id, 'four-pillars');
    assert.deepEqual(replay.map.blocked, ['d4', 'f4', 'd6', 'f6']);
  } finally {
    if (prevEnv === undefined) delete process.env.OOTV2_ALLOW_BLOCKED_MAPS;
    else process.env.OOTV2_ALLOW_BLOCKED_MAPS = prevEnv;
    env.cleanup();
  }
});

