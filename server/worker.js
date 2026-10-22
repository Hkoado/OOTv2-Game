/**
 * worker.js — Tiến trình worker: poll SQLite, chạy TUẦN TỰ 1 trận tại một thời điểm.
 *
 * - Không có API nào gọi trực tiếp bot runner; chỉ worker là nơi chạy code Python.
 * - Khôi phục match `running` chưa có kết quả về `pending` khi boot (chạy lại bằng
 *   đúng seed và submission snapshot cũ).
 * - Mọi lỗi bot được xử lý thành kết quả trận; worker không crash vì bot lỗi.
 *
 * Cách chạy: `npm run dev:worker` (vòng lặp), hoặc `node server/worker.js --once`
 * để chạy tối đa 1 trận (dùng cho test), `--drain` để chạy tới khi hết việc.
 */

import { hostname } from 'node:os';
import { pathToFileURL } from 'node:url';

import config from './config.js';
import { getDb, initDb, nowIso, recoverUnfinishedMatches } from './db.js';
import { REASONS, RESULTS, PROTOCOL_VERSION } from './judge/gameAdapter.js';
import { runMatch } from './judge/matchRunner.js';
import { advanceTournament, computeBracket, getTournament } from './services/tournaments.js';
import { heartbeatWorker, recordMatchLog } from './services/judgeMonitor.js';
import { FAILURE_REASONS } from './services/judgeView.js';
import {
  pruneLiveHistory,
  recordBotOutput,
  recordLiveMove,
  recordLiveTerminal,
  startLiveMatch,
} from './services/liveEvents.js';
import { sharedEnabled } from './shared/client.js';
import { runSharedWorker } from './shared/worker.js';

/** Nhãn worker hiển thị trong portal admin: `hostname:pid` (không phải bí mật). */
export function workerLabel() {
  return `${hostname().slice(0, 40)}:${process.pid}`;
}


const STAGE_FOR_STATUS = {
  group_running: 'group',
  semifinal_running: 'semifinal',
  final_running: 'final',
};

export function currentRunningTournament() {
  return (
    getDb()
      .prepare(
        `SELECT * FROM tournaments
         WHERE status IN ('group_running','semifinal_running','final_running')
         ORDER BY started_at, id LIMIT 1`
      )
      .get() || null
  );
}

function loadMatch(matchId) {
  return getDb()
    .prepare(
      `SELECT m.id, m.tournament_id, m.stage, m.series_id, m.game_no, m.seed, m.started_at,
              rp.name AS red_name, bp.name AS blue_name,
              rs.storage_path AS red_path, bs.storage_path AS blue_path
       FROM matches m
       JOIN tournament_entries re ON re.id = m.red_entry_id
       JOIN participants rp ON rp.id = re.participant_id
       LEFT JOIN submissions rs ON rs.id = re.submission_id
       JOIN tournament_entries be ON be.id = m.blue_entry_id
       JOIN participants bp ON bp.id = be.participant_id
       LEFT JOIN submissions bs ON bs.id = be.submission_id
       WHERE m.id = ?`
    )
    .get(matchId);
}

/** Claim 1 match `pending` của stage hiện tại; claim nằm trong transaction. */
export function claimNextMatch(tournament) {
  const stage = STAGE_FOR_STATUS[tournament.status];
  if (!stage) return null;
  const db = getDb();
  const claim = db.transaction(() => {
    const candidate = db
      .prepare(
        `SELECT id FROM matches
         WHERE tournament_id = ? AND stage = ? AND status = 'pending'
         ORDER BY series_id, game_no LIMIT 1`
      )
      .get(tournament.id, stage);
    if (!candidate) return null;
    const info = db
      .prepare(
        "UPDATE matches SET status = 'running', started_at = ? WHERE id = ? AND status = 'pending'"
      )
      .run(nowIso(), candidate.id);
    return info.changes === 1 ? loadMatch(candidate.id) : null;
  });
  return claim();
}

/**
 * Ghi kết quả + replay + nhật ký chấm trong transaction, chỉ khi match còn `running`
 * (chống đúp điểm). `meta.worker`/`meta.elapsedMs` là thông tin quan sát, không ảnh
 * hưởng kết quả trận.
 */
export function recordResult(matchId, outcome, { worker = null, elapsedMs = null } = {}) {
  const db = getDb();
  const finish = db.transaction(() => {
    const info = db
      .prepare(
        `UPDATE matches
         SET status = 'finished', result = ?, reason = ?, ply_count = ?, replay_json = ?, finished_at = ?
         WHERE id = ? AND status = 'running'`
      )
      .run(
        outcome.result,
        outcome.reason,
        outcome.ply_count,
        JSON.stringify(outcome.replay),
        nowIso(),
        matchId
      );
    if (info.changes !== 1) return false;
    const failed = FAILURE_REASONS.includes(outcome.reason);
    recordMatchLog({
      matchId,
      notes: Array.isArray(outcome.notes) ? outcome.notes : [],
      error: failed ? outcome.notes?.[0] || outcome.reason : null,
      worker,
      elapsedMs,
    });
    return true;
  });
  return finish();
}

function brokenMatchOutcome(match, message) {
  return {
    result: RESULTS.DRAW,
    reason: REASONS.INTERNAL_ERROR,
    winner: null,
    ply_count: 0,
    notes: [message],
    replay: {
      protocol_version: PROTOCOL_VERSION,
      match_id: match.id,
      seed: match.seed,
      initial_pieces: [],
      events: [],
      result: RESULTS.DRAW,
      reason: REASONS.INTERNAL_ERROR,
    },
  };
}

/** Chạy tối đa 1 trận. Trả về `{ processed, reason }` để vòng lặp quyết định sleep/dừng. */
export async function processOneMatch({ verbose = true } = {}) {
  const worker = workerLabel();
  heartbeatWorker({ workerId: worker });
  const tournament = currentRunningTournament();
  if (!tournament) {
    return { processed: false, reason: 'no_running_tournament' };
  }

  const match = claimNextMatch(tournament);
  if (!match) {
    const advanced = advanceTournament(tournament.id);
    if (verbose && advanced.advanced) {
      console.log(`[worker] giải ${tournament.name}: chuyển sang ${advanced.status}`);
    }
    return { processed: false, reason: 'no_pending_match', advanced };
  }

  const startedAt = Date.parse(match.started_at || '');
  const elapsed = () => (Number.isFinite(startedAt) ? Math.max(0, Date.now() - startedAt) : null);

  // Ghi live là best-effort: observer lỗi không được làm hỏng kết quả ván.
  const onLive = (event) => {
    if (event?.kind === 'initial') {
      startLiveMatch(match.id, { initialPieces: event.initialPieces, seed: event.seed });
    } else if (event?.kind === 'move') {
      recordLiveMove(match.id, event);
    }
  };
  const onBotOutput = config.live.botOutput
    ? (chunk) => recordBotOutput(match.id, chunk.side, chunk.stream, chunk.text)
    : undefined;

  let outcome;
  if (!match.red_path || !match.blue_path) {
    outcome = brokenMatchOutcome(match, 'Thiếu submission snapshot cho match');
  } else {
    try {
      outcome = await runMatch({
        matchId: match.id,
        seed: match.seed,
        red: { name: match.red_name, filePath: match.red_path },
        blue: { name: match.blue_name, filePath: match.blue_path },
        onLive,
        onBotOutput,
      });
    } catch (error) {
      outcome = brokenMatchOutcome(match, `runMatch throw: ${error.message}`);
    }
  }

  const recorded = recordResult(match.id, outcome, { worker, elapsedMs: elapsed() });
  // Mốc kết thúc cho khán giả (kể cả ván bị forfeit/thiếu dữ liệu), sau khi đã ghi kết quả.
  try {
    recordLiveTerminal(match.id, {
      result: outcome.result,
      reason: outcome.reason,
      ply_count: outcome.ply_count,
    });
  } catch (error) {
    if (verbose) console.log(`[worker] không ghi được mốc live của ${match.id}: ${error.message}`);
  }
  heartbeatWorker({ workerId: worker, lastMatchId: match.id });
  const advanced = advanceTournament(tournament.id);

  if (verbose) {
    console.log(
      `[worker] ${match.stage}/${match.series_id} game ${match.game_no}: `
        + `${match.red_name}(Đỏ) vs ${match.blue_name}(Xanh) -> ${outcome.result} `
        + `(${outcome.reason}, ${outcome.ply_count} plies)`
    );
    for (const note of outcome.notes) console.log(`[worker]   - ${note}`);
    if (advanced.advanced) console.log(`[worker] giải chuyển sang ${advanced.status}`);
    if (advanced.status === 'finished') {
      const bracket = computeBracket(tournament.id);
      console.log(`[worker] VÔ ĐỊCH: ${bracket.champion ? bracket.champion.name : 'không xác định'}`);
    }
  }

  return { processed: true, match, outcome, recorded, advanced };
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function runWorker({ once = false, drain = false } = {}) {
  if (sharedEnabled) return runSharedWorker({ once, drain });
  initDb();
  const recovered = recoverUnfinishedMatches();
  if (recovered > 0) {
    console.log(`[worker] khôi phục ${recovered} match 'running' chưa có kết quả về 'pending'`);
  }
  try {
    pruneLiveHistory();
  } catch (error) {
    console.log(`[worker] bỏ qua dọn dữ liệu live: ${error.message}`);
  }

  let stopping = false;
  const stop = () => {
    stopping = true;
    console.log('[worker] nhận tín hiệu dừng, kết thúc sau trận đang chạy...');
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  // Nhịp tim định kỳ: một ván dài (tới 200 nước, ~vài phút) không được làm portal
  // tưởng worker đã chết. Ghi bằng cùng connection SQLite nên rất nhẹ.
  const workerId = workerLabel();
  const beat = setInterval(() => {
    try {
      heartbeatWorker({ workerId });
    } catch {
      /* DB bận: nhịp sau sẽ thử lại */
    }
  }, 5000);

  while (!stopping) {
    const result = await processOneMatch();

    if (once) break;
    if (drain && !result.processed && !result.advanced) break;

    if (!result.processed) {
      await sleep(config.limits.workerPollMs);
    } else if (Number(config.limits.workerPauseMs) > 0) {
      // Chế độ demo: nghỉ giữa hai trận để khán giả xem kịp (mặc định 0 = không nghỉ).
      await sleep(Number(config.limits.workerPauseMs));
    }
  }
  clearInterval(beat);

  const tournament = currentRunningTournament();
  if (tournament) {
    const detail = getTournament(tournament.id);
    console.log(
      `[worker] dừng. Giải "${detail.name}": ${detail.match_counts.finished}/${detail.match_counts.total} game hoàn tất, status=${detail.status}`
    );
  }
  return true;
}

const isEntryPoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntryPoint) {
  runWorker({
    once: process.argv.includes('--once'),
    drain: process.argv.includes('--drain'),
  }).catch((error) => {
    console.error('[worker] lỗi nghiêm trọng:', error);
    process.exitCode = 1;
  });
}

export default { runWorker, processOneMatch };
