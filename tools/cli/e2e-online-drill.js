/**
 * e2e-online-drill.js — E2E online trên DB dev (.envdev):
 * repo → cutoff capture → snapshot vòng bảng → chấm bằng engine thật → bảng xếp hạng
 * → knockout → vé. GitHub API được thay bằng test double tại lớp `fetch` (không có token/repo thật);
 * Supabase/Storage/engine (trusted-dev) là thật.
 *
 * An toàn:
 * - Từ chối chạy nếu `SUPABASE_URL` không phải project dev (`OOTV2_E2E_PROJECT_REF`,
 *   mặc định `wsyfcgurnrowcuefwynx`) → không ghi vào DB thật.
 * - Dữ liệu drill đặt tên `E2E drill <time>`; KHÔNG xoá bảng official (service_role chỉ SELECT),
 *   log in SQL dọn tay ở cuối.
 *
 * Chạy: node tools/cli/e2e-online-drill.js
 */

import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';

const ROOT = process.cwd();
const DEV_REF_DEFAULT = 'wsyfcgurnrowcuefwynx';

function loadDevEnv(file = '.envdev') {
  const text = readFileSync(`${ROOT}/${file}`, 'utf8');
  for (const line of text.split(/\r?\n/u)) {
    const match = /^([A-Za-z0-9_]+)=(.*)$/u.exec(line.trim());
    if (match && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/gu, '');
    }
  }
}
loadDevEnv(process.env.OOTV2_E2E_ENV_FILE || '.envdev');
process.env.OOTV2_ALLOW_TRUSTED_DEV = process.env.OOTV2_ALLOW_TRUSTED_DEV || '1';

const expectedRef = process.env.OOTV2_E2E_PROJECT_REF || DEV_REF_DEFAULT;
const projectRef = new URL(process.env.SUPABASE_URL || 'https://invalid').hostname.split('.')[0];
if (projectRef !== expectedRef) {
  console.error(`DỪNG: drill chỉ chạy trên DB dev (${expectedRef}), đang trỏ ${projectRef}.`);
  process.exit(2);
}

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

// ---------- GitHub test double (chỉ api.github.com) ----------
// Hai chiến thuật khác nhau để ván có thắng/thua (bot mẫu luôn chọn legalMoves[0] ⇒ mọi ván hòa do lặp thế cờ).
const BASE_SOURCE = readFileSync(`${ROOT}/examples/campus_bot.py`, 'utf8');
/** Bot mẫu luôn chọn legalMoves[0] ⇒ lặp thế cờ và hòa. Hai biến thể dưới đổi lựa chọn mỗi lượt. */
const withRotation = (step) => Buffer.from(`${BASE_SOURCE}

_SEQ = 0


def move(obs):
    global _SEQ
    moves = obs["legalMoves"]
    if not moves:
        raise ValueError("no legal moves")
    _SEQ += 1
    return moves[(_SEQ * ${step}) % len(moves)]
`, 'utf8');
const SOURCES = [withRotation(1), withRotation(2)];
const gitBlobSha = (buffer) => createHash('sha1').update(`blob ${buffer.length}\0`).update(buffer).digest('hex');
const repos = [1, 2, 3, 4].map((n) => {
  const name = `e2e-team-${n}`;
  const source = SOURCES[(n - 1) % SOURCES.length];
  return {
    n, name, owner: 'ootv2-e2e', repoId: 900000000 + n, source,
    blobSha: gitBlobSha(source),
    treeSha: createHash('sha1').update(`tree-${name}-${gitBlobSha(source)}`).digest('hex'),
    commitSha: createHash('sha1').update(`commit-${name}`).digest('hex'),
  };
});
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json' },
});
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input.url;
  if (!url.startsWith('https://api.github.com/')) return realFetch(input, init);
  const parts = new URL(url).pathname.split('/').filter(Boolean);
  if (parts[0] !== 'repos') return json({ message: 'not found' }, 404);
  const repo = repos.find((entry) => entry.name === parts[2] && entry.owner === parts[1]);
  if (!repo) return json({ message: 'not found' }, 404);
  const rest = parts.slice(3).join('/');
  if (rest === '') {
    return json({ id: repo.repoId, full_name: `${repo.owner}/${repo.name}`,
      html_url: `https://github.com/${repo.owner}/${repo.name}`, private: false, default_branch: 'main' });
  }
  if (rest.startsWith('commits/')) return json({ sha: repo.commitSha, commit: { message: 'e2e' } });
  if (rest === `git/commits/${repo.commitSha}`) return json({ sha: repo.commitSha, tree: { sha: repo.treeSha } });
  if (rest === `git/trees/${repo.treeSha}`) {
    return json({ sha: repo.treeSha, truncated: false, tree: [
      { path: 'bot.py', mode: '100644', type: 'blob', size: repo.source.length, sha: repo.blobSha },
    ] });
  }
  if (rest === `git/blobs/${repo.blobSha}`) {
    return json({ sha: repo.blobSha, encoding: 'base64', size: repo.source.length,
      content: repo.source.toString('base64') });
  }
  return json({ message: 'not found' }, 404);
};


async function main() {
  const [{ insert, rows }, { saveOfficialSetup }, githubIntake, githubCutoff, { processGithubJob },
    { createCutoffWorkerDeps }, officialRounds, orchestration, knockout, jobs, { executeOfficialJob }] = await Promise.all([
    import('../../server/shared/client.js'),
    import('../../server/shared/officialSetup.js'),
    import('../../server/services/githubIntake.js'),
    import('../../server/services/githubCutoff.js'),
    import('../../server/shared/githubConsumer.js'),
    import('../../server/shared/githubWorkerDeps.js'),
    import('../../server/services/officialRounds.js'),
    import('../../server/services/officialOrchestration.js'),
    import('../../server/services/officialKnockout.js'),
    import('../../server/shared/officialJobs.js'),
    import('../../server/services/officialExecution.js'),
  ]);
  const { SAMPLE_MAPS } = await import('../../src/game/sampleMaps.js');

  const stamp = new Date().toISOString();
  const deadline = Date.now() + Number(process.env.OOTV2_E2E_BUDGET_MS || 15 * 60 * 1000);
  const admin = { id: randomUUID(), role: 'admin' };
  let eventId = null;
  let roundId = null;
  try {
    const teams = [1, 2, 3, 4].map((n) => ({ id: randomUUID(), name: `E2E Team ${n} ${stamp.slice(11, 19)}` }));
    await insert('participants', teams.map((team) => ({
      ...team, name_key: team.name.toLocaleLowerCase('en-US'), created_at: stamp,
    })));
    check('seed 4 đội', true, teams.map((team) => team.id).join(','));

    eventId = await saveOfficialSetup({
      name: `E2E drill ${stamp}`,
      participantIds: teams.map((team) => team.id),
      competition: {
        level: 'weekly', mapsPublished: true, mapPackVersion: 'e2e-pack-1',
        cutoff: new Date(Date.now() + 20_000).toISOString(),
        primaryMap: SAMPLE_MAPS[0].map, reserveMap: SAMPLE_MAPS[1].map,
      },
    });
    check('tạo giải official (4 đội, map v2 công bố, cutoff đã qua)', Boolean(eventId), eventId);

    for (const [index, team] of teams.entries()) {
      const repo = repos[index];
      const repository = `https://github.com/${repo.owner}/${repo.name}`;
      await githubIntake.putConnection({ eventId, teamId: team.id, repository, branch: 'main', account: admin });
      await githubIntake.requestSubmission({ eventId, teamId: team.id, repository, branch: 'main', account: admin });
    }
    check('đăng ký + duyệt 4 repo, xếp job intake', true);

    const deps = createCutoffWorkerDeps();
    for (let i = 0; i < 12; i += 1) {
      const outcome = await processGithubJob({ enabled: true, workerId: `e2e-intake-${process.pid}`, ...deps });
      if (!outcome.processed) break;
    }
    const receipts = await rows('github_receipts', `event_id=eq.${eventId}&select=status,source_hash,submission_id`);
    check('intake: 4 receipt valid + submission',
      receipts.filter((row) => row.status === 'valid' && row.submission_id).length === 4,
      JSON.stringify(receipts.map((row) => row.status)));

    // Chờ cutoff thật (server/DB clock) rồi mới capture; không sửa dữ liệu để "vượt" cutoff.
    const [eventRow] = await rows('tournaments', `id=eq.${eventId}&select=id`);
    check('giải tồn tại trước cutoff', Boolean(eventRow));
    for (let i = 0; i < 30; i += 1) {
      const [setup] = await rows('official_setups', `tournament_id=eq.${eventId}&select=config`);
      const cutoffAt = Date.parse(setup?.config?.cutoff ?? '');
      if (Number.isFinite(cutoffAt) && Date.now() > cutoffAt) break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    await githubCutoff.syncAllAtCutoff({ eventId, actor: admin });
    const captures = await rows('cutoff_captures', `event_id=eq.${eventId}&select=team_id,receipt_id,commit_sha`);
    check('cutoff capture: 4 đội được pin SHA',
      captures.filter((row) => row.receipt_id && row.commit_sha).length === 4, `captured=${captures.length}`);


    const opened = await officialRounds.openGroupRound({ eventId });
    roundId = opened.round.roundId;
    const planned = opened.round.games.total;
    check('mở vòng bảng từ snapshot chính thức', planned > 0, JSON.stringify(opened.round.games));

    const drainOfficial = async (label) => {
      let executed = 0;
      for (;;) {
        if (Date.now() > deadline) throw new Error('budget_exceeded');
        const job = await jobs.claimOfficialJob({ workerId: `e2e-judge-${process.pid}`, leaseSeconds: 300 });
        if (!job) return executed;
        const outcome = await executeOfficialJob(job, { leaseSeconds: 300,
          logger: { log() {}, warn() {}, error() {} } });
        executed += 1;
        log(`${label} ${job.gameKey}`, outcome);
      }
    };

    let stall = 0;
    let finishedBefore = 0;
    for (let i = 0; i < 200; i += 1) {
      const published = await orchestration.publishNextGame({ roundId });
      if (['complete', 'frozen'].includes(published.status)) break;
      await drainOfficial('group');
      const snapshot = await orchestration.roundProgress({ roundId });
      if (snapshot.games.finished <= finishedBefore) {
        stall += 1;
        if (stall >= 3) throw new Error(`group_stalled:${snapshot.games.finished}/${planned}`);
      } else {
        stall = 0;
      }
      finishedBefore = snapshot.games.finished;
      if (Date.now() > deadline) throw new Error('budget_exceeded');
    }
    const groupProgress = await orchestration.roundProgress({ roundId });
    check('chấm xong toàn bộ ván vòng bảng', groupProgress.games.total === planned
      && groupProgress.games.finished === planned, JSON.stringify({ ...groupProgress.games, planned }));

    const standings = await orchestration.groupStandings({ roundId });
    check('standings đủ kết quả accepted + qualifiers',
      standings.complete === true && Boolean(standings.qualifiers),
      JSON.stringify({ qualifiers: standings.qualifiers?.length ?? 0 }));

    const frozen = await orchestration.freezeGroupRound({ roundId, expectedGames: planned });
    const afterFreeze = await orchestration.roundProgress({ roundId });
    check('khóa vòng bảng', frozen.alreadyFrozen === false && afterFreeze.frozen === true,
      JSON.stringify({ ...frozen, frozen: afterFreeze.frozen }));

    let last = null;
    let knockoutError = null;
    try {
      for (let i = 0; i < 16; i += 1) {
        last = await knockout.openNextKnockoutSeries({ groupRoundId: roundId, level: 'weekly' });
        log('knockout step', { status: last.status, matchId: last.matchId ?? null });
        if (['bracket_complete', 'blocked'].includes(last.status)) break;
        await drainOfficial('knockout');
      }
    } catch (error) {
      knockoutError = error.code || error.message;
    }
    if (knockoutError) {
      check('knockout: BLOCKED (không phải PASS)', false, knockoutError === 'capture_roster_mismatch'
        ? 'capture_roster_mismatch — cần migration 20261026120000 (nới roster cho round knockout)'
        : `${knockoutError} — series không kết thúc được (thường do mọi ván hòa); cần BTC/Khoa chốt tie-break`);
    } else {
      const bracket = await knockout.bracketProgress({ groupRoundId: roundId, level: 'weekly' });
      check('knockout hoàn tất', last?.status === 'bracket_complete',
        JSON.stringify({ status: last?.status ?? null, resolved: bracket.resolved, expected: bracket.expected }));

      if (last?.status === 'bracket_complete') {
        const tickets = await knockout.knockoutTickets({ groupRoundId: roundId, level: 'weekly' });
        check('xếp hạng + cấp vé', Array.isArray(tickets.tickets) && tickets.tickets.length === 2,
          JSON.stringify(tickets.tickets));
        log('ranking head', tickets.ranking?.slice(0, 3));
      }
    }


    // Replay/accepted result: games giữ `replay_hash`; payload replay nằm ở attempts (bounded 256 KiB).
    const games = await rows('official_games', `round_pk=eq.${roundId}&select=game_key,result,replay_hash`);
    const attempts = await rows('official_job_attempts',
      `round_pk=eq.${roundId}&select=game_key,outcome,replay`);
    const finished = games.filter((game) => game.result !== null);
    const withReplay = attempts.filter((row) => row.outcome === 'succeeded' && row.replay != null);
    check('ván accepted có replay_hash + replay trong attempts', finished.length > 0
      && finished.every((game) => typeof game.replay_hash === 'string')
      && withReplay.length >= finished.length,
      JSON.stringify({ finished: finished.length, withReplay: withReplay.length }));

    // Publication: hiện chỉ hỗ trợ profile MVP (mvp_matches) — official chưa có lịch phát.
    check('publication official: CHƯA hỗ trợ (gap, không phải PASS)', false,
      'mvp_match_broadcasts chỉ tham chiếu mvp_matches; official_games chưa có lịch phát');
  } catch (error) {
    check(`E2E lỗi: ${error.message}`, false);
  } finally {
    globalThis.fetch = realFetch;
    if (eventId) {
      console.log(`[e2e] dữ liệu drill: event=${eventId}${roundId ? ` round=${roundId}` : ''}`);
      console.log('[e2e] dọn tay bằng owner/Management API trên các bảng: '
        + 'mvp_official_jobs, mvp_official_job_attempts, mvp_official_games, mvp_official_rounds, '
        + 'mvp_cutoff_captures, mvp_github_receipts, mvp_repo_sync_jobs, mvp_repo_connections, '
        + `mvp_submissions, mvp_tournament_entries, mvp_official_setups, mvp_tournaments (event=${eventId})`);
    }
    const failed = results.filter((row) => !row.ok).length;
    console.log(`\n${failed ? 'FAIL' : 'PASS'} ${results.length - failed}/${results.length} E2E checks`);
    process.exitCode = failed ? 1 : 0;
  }
}

main().catch((error) => {
  console.error(`[e2e] lỗi không bắt được: ${error.message}`);
  process.exitCode = 1;
});

const log = (label, value) => console.log(`[e2e] ${label}: ${typeof value === 'string' ? value : JSON.stringify(value)}`);
