/**
 * helper cho test M3/M4: dựng API + DB trong thư mục tạm, KHÔNG đụng `data/` của repo.
 *
 * Lưu ý quan trọng: `server/config.js` đọc `process.env` ngay khi import, nên mọi
 * module server phải được import ĐỘNG sau khi đặt `OOTV2_DATA_DIR` / `OOTV2_ADMIN_KEY`.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// `server/config.js` chỉ đọc process.env MỘT lần cho cả process test, nên mọi
// startTestEnv() trong cùng file phải dùng chung một thư mục tạm.
let sharedDataDir = null;
let exitHookRegistered = false;

/** Xoá sạch dữ liệu để mỗi test bắt đầu từ DB trống. */
function resetTables(dbModule) {
  dbModule
    .getDb()
    .exec(
      `DELETE FROM matches;
       DELETE FROM tournament_entries;
       DELETE FROM tournaments;
       DELETE FROM submissions;
       DELETE FROM participants;`
    );
}

export const FIXTURES_DIR = path.join(here, '..', 'fixtures');
export const EXAMPLES_DIR = path.join(here, '..', '..', 'examples');

export function fixture(name) {
  return path.join(FIXTURES_DIR, name);
}

export function example(name) {
  return path.join(EXAMPLES_DIR, name);
}

/** Bot luôn hợp lệ khi setup và ở nước đi đầu, sau đó trả nước không hợp lệ. */
export function forfeitAfterFirstPlyBotPath() {
  return fixture('bot_illegal_after_first_ply.py');
}

function assertChanged(changed, matchId) {
  if (!changed) throw new Error(`không cập nhật được match ${matchId}`);
}

/**
 * Khởi động môi trường test đầy đủ: temp data dir + DB + Express app + HTTP server.
 * @returns {Promise<object>} env với `api()`, `uploadFile()`, `cleanup()`...
 */
export async function startTestEnv({ adminKey = 'test-admin-key', withServer = true } = {}) {
  if (!sharedDataDir) {
    sharedDataDir = mkdtempSync(path.join(os.tmpdir(), 'ootv2-test-'));
    process.env.OOTV2_DATA_DIR = sharedDataDir;
    process.env.OOTV2_DB_PATH = path.join(sharedDataDir, 'test.sqlite');
  }
  process.env.OOTV2_ADMIN_KEY = adminKey;
  const dataDir = sharedDataDir;

  const dbModule = await import('../../server/db.js');
  const config = (await import('../../server/config.js')).default;
  const { createApp } = await import('../../server/app.js');
  const participantsService = await import('../../server/services/participants.js');
  const tournamentsService = await import('../../server/services/tournaments.js');
  const matchesService = await import('../../server/services/matches.js');
  const worker = await import('../../server/worker.js');
  const { validateBotFile } = await import('../../server/services/botValidation.js');

  dbModule.initDb();
  resetTables(dbModule);

  if (!exitHookRegistered) {
    exitHookRegistered = true;
    // Windows có thể còn lock file WAL khi tiến trình còn chạy: chỉ dọn ở lúc thoát.
    process.on('exit', () => {
      try {
        rmSync(sharedDataDir, { recursive: true, force: true });
      } catch {
        /* thư mục temp, để lại cũng không sao */
      }
    });
  }

  const env = {
    dataDir,
    adminKey,
    config,
    db: dbModule,
    getDb: dbModule.getDb,
    participantsService,
    tournamentsService,
    matchesService,
    worker,
    validateBotFile,
    baseUrl: null,
    server: null,
  };

  /** Gọi API, trả về `{ status, body }` (body là text nếu response không phải JSON). */
  env.api = async function api(route, { method = 'GET', body, headers, admin = false } = {}) {
    const finalHeaders = { ...(headers || {}) };
    if (admin) finalHeaders['x-admin-key'] = adminKey;
    let payload;
    if (body !== undefined) {
      if (body instanceof FormData) {
        payload = body;
      } else {
        payload = JSON.stringify(body);
        finalHeaders['content-type'] = 'application/json';
      }
    }
    const response = await fetch(`${env.baseUrl}${route}`, {
      method,
      headers: finalHeaders,
      body: payload,
    });
    const text = await response.text();
    let parsed = text;
    try {
      parsed = text.length === 0 ? null : JSON.parse(text);
    } catch {
      /* giữ text thô */
    }
    return { status: response.status, body: parsed };
  };

  /** Upload file thật qua HTTP multipart (giống UI). */
  env.uploadFile = async function uploadFile(participantId, filePath, { filename } = {}) {
    const bytes = readFileSync(filePath);
    const form = new FormData();
    form.append(
      'file',
      new Blob([bytes], { type: 'text/x-python' }),
    filename || path.basename(filePath)
  );
  return env.api(`/api/participants/${participantId}/submissions`, { method: 'POST', body: form });
};


  /** Tạo participant + upload bot thành submission `valid`. */
  env.createParticipantWithBot = async function createParticipantWithBot(name, botPath) {
    const participant = participantsService.createParticipant(name);
    const filePath = botPath || example('sample_bot.py');
    const upload = await env.uploadFile(participant.id, filePath);
    if (upload.status !== 201) {
      throw new Error(`upload thất bại: ${upload.status} ${JSON.stringify(upload.body)}`);
    }
    if (upload.body.status !== 'valid') {
      throw new Error(`bot không hợp lệ: ${upload.body.validation_error}`);
    }
    return { participant, submission: upload.body };
  };

  /** Giả lập kết quả 1 match như worker ghi (dùng cho test luồng bracket). */
  env.finishMatch = function finishMatch(matchId, result, reason = 'base_capture') {
    const db = dbModule.getDb();
    const info = db
      .prepare(
        `UPDATE matches SET status = 'finished', result = ?, reason = ?, ply_count = 10,
                replay_json = ?, finished_at = ?
         WHERE id = ? AND status IN ('pending','running')`
      )
      .run(
        result,
        reason,
        JSON.stringify({
          protocol_version: 1,
          match_id: matchId,
          seed: 1,
          initial_pieces: [],
          events: [],
        }),
        dbModule.nowIso(),
        matchId
      );
    return info.changes === 1;
  };

  /** Kết quả match sao cho đội seed_order nhỏ hơn thắng (kịch bản xác định). */
  env.finishMatchLowerSeedWins = function finishMatchLowerSeedWins(matchId) {
    const db = dbModule.getDb();
    const row = db
      .prepare(
        `SELECT re.seed_order AS red_seed, be.seed_order AS blue_seed
         FROM matches m
         JOIN tournament_entries re ON re.id = m.red_entry_id
         JOIN tournament_entries be ON be.id = m.blue_entry_id
         WHERE m.id = ?`
      )
      .get(matchId);
    const result = row.red_seed < row.blue_seed ? 'red_win' : 'blue_win';
    assertChanged(env.finishMatch(matchId, result), matchId);
    return result;
  };

  env.cleanup = function cleanup() {
    try {
      dbModule.closeDb();
    } catch {
      /* ignore */
    }
    if (env.server) env.server.close();
  };

  if (withServer) {
    const app = createApp({ legacyAccess: true });
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    env.server = server;
    env.baseUrl = `http://127.0.0.1:${server.address().port}`;
  } else {
    env.baseUrl = 'http://127.0.0.1:0';
  }

  return env;
}

export default { startTestEnv, fixture, example };
