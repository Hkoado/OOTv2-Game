/**
 * tournaments.js — Tạo giải, chốt submission, chia bảng, sinh trận, standings, bracket
 * và tiến vòng bảng -> bán kết -> chung kết. Toàn bộ là thao tác SQLite đồng bộ,
 * gói trong transaction để chạy lại không sinh trận trùng / cộng điểm trùng.
 */

import { getDb, newId, nowIso } from '../db.js';
import { badRequest, conflict, notFound } from '../lib/httpError.js';
import { deriveSeed, randomSeed } from '../judge/rng.js';
import { RESULTS, REASONS } from '../judge/gameAdapter.js';

/** Chia bảng theo seed: A = 1,4,5,8 — B = 2,3,6,7 (chuẩn cho 8 đội). */
export const GROUP_SEEDS = {
  A: [1, 4, 5, 8],
  B: [2, 3, 6, 7],
};

export const RUNNING_STATUSES = ['group_running', 'semifinal_running', 'final_running'];
export const POINTS = { win: 3, draw: 1, loss: 0 };
export const TIE_BREAKERS = ['points', 'wins', 'win_loss_difference', 'seed_order'];

/** Sáu cặp đấu trong một bảng 4 đội, mỗi cặp 2 lượt đổi màu. */
export function groupPairs() {
  const pairs = [];
  for (let first = 0; first < 4; first += 1) {
    for (let second = first + 1; second < 4; second += 1) {
      pairs.push([first, second]);
    }
  }
  return pairs;
}

export function createTournament({ name, participantIds }) {
  const db = getDb();
  const trimmedName = typeof name === 'string' ? name.trim() : '';
  if (trimmedName.length < 1 || trimmedName.length > 80) {
    throw badRequest('bad_name', 'Tên giải phải từ 1 đến 80 ký tự');
  }
  if (!Array.isArray(participantIds) || participantIds.length !== 8) {
    throw badRequest('bad_participants', 'Cần đúng 8 participantIds');
  }
  const uniqueIds = new Set(participantIds);
  if (uniqueIds.size !== 8) {
    throw badRequest('bad_participants', 'participantIds bị trùng');
  }

  const seed = randomSeed();
  const tournamentId = newId();
  const createdAt = nowIso();
  const findValidSubmission = db.prepare(
    `SELECT id FROM submissions WHERE participant_id = ? AND status = 'valid'
     ORDER BY created_at DESC, rowid DESC LIMIT 1`
  );
  const findParticipant = db.prepare('SELECT id, name FROM participants WHERE id = ?');

  const create = db.transaction(() => {
    db.prepare(
      `INSERT INTO tournaments (id, name, status, seed, created_at) VALUES (?, ?, 'draft', ?, ?)`
    ).run(tournamentId, trimmedName, seed, createdAt);

    participantIds.forEach((participantId, index) => {
      const participant = findParticipant.get(participantId);
      if (!participant) {
        throw badRequest('unknown_participant', `Không tìm thấy đội: ${participantId}`);
      }
      if (!findValidSubmission.get(participantId)) {
        throw badRequest(
          'missing_valid_submission',
          `Đội ${participant.name} chưa có submission hợp lệ`
        );
      }
      db.prepare(
        `INSERT INTO tournament_entries (id, tournament_id, participant_id, submission_id, seed_order, group_name)
         VALUES (?, ?, ?, NULL, ?, NULL)`
      ).run(newId(), tournamentId, participantId, index + 1);
    });
  });

  create();
  return getTournament(tournamentId);
}

function entryRows(tournamentId) {
  return getDb()
    .prepare(
      `SELECT e.id, e.tournament_id, e.participant_id, e.submission_id, e.seed_order, e.group_name,
              p.name AS participant_name, s.status AS submission_status
       FROM tournament_entries e
       JOIN participants p ON p.id = e.participant_id
       LEFT JOIN submissions s ON s.id = e.submission_id
       WHERE e.tournament_id = ?
       ORDER BY e.seed_order`
    )
    .all(tournamentId);
}

export function getTournament(tournamentId) {
  const db = getDb();
  const tournament = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(tournamentId);
  if (!tournament) throw notFound('tournament_not_found', 'Không tìm thấy giải');
  const entries = entryRows(tournamentId).map((row) => ({
    ...row,
    submission_status: row.submission_status || null,
  }));
  const counts = db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN status = 'finished' THEN 1 ELSE 0 END) AS finished
       FROM matches WHERE tournament_id = ?`
    )
    .get(tournamentId);
  return {
    ...tournament,
    entries,
    match_counts: {
      total: counts.total || 0,
      finished: counts.finished || 0,
    },
  };
}

export function listTournaments() {
  const db = getDb();
  return db
    .prepare(
      `SELECT t.*,
              (SELECT COUNT(*) FROM matches m WHERE m.tournament_id = t.id) AS match_total,
              (SELECT COUNT(*) FROM matches m WHERE m.tournament_id = t.id AND m.status = 'finished') AS match_finished
       FROM tournaments t ORDER BY t.created_at DESC, t.id`
    )
    .all();
}

function insertSeries(db, tournament, stage, seriesId, firstEntry, secondEntry) {
  const insert = db.prepare(
    `INSERT INTO matches
       (id, tournament_id, stage, series_id, game_no, red_entry_id, blue_entry_id, seed, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
  );
  // Lượt 1: đội seed tốt hơn đi Đỏ. Lượt 2 đảo màu để mỗi đội có 1 trận Đỏ/1 trận Xanh.
  insert.run(
    newId(), tournament.id, stage, seriesId, 1,
    firstEntry.id, secondEntry.id, deriveSeed(tournament.seed, stage, seriesId, 1)
  );
  insert.run(
    newId(), tournament.id, stage, seriesId, 2,
    secondEntry.id, firstEntry.id, deriveSeed(tournament.seed, stage, seriesId, 2)
  );
}

function freezeAndSeedGroups(tournamentId) {
  const db = getDb();
  const groupOfSeed = new Map();
  for (const [group, seeds] of Object.entries(GROUP_SEEDS)) {
    for (const seedOrder of seeds) groupOfSeed.set(seedOrder, group);
  }
  const findValid = db.prepare(
    `SELECT id FROM submissions WHERE participant_id = ? AND status = 'valid'
     ORDER BY created_at DESC, rowid DESC LIMIT 1`
  );
  const update = db.prepare(
    'UPDATE tournament_entries SET submission_id = ?, group_name = ? WHERE id = ?'
  );

  for (const entry of entryRows(tournamentId)) {
    const submission = findValid.get(entry.participant_id);
    if (!submission) {
      throw badRequest(
        'missing_valid_submission',
        `Đội ${entry.participant_name} chưa có submission hợp lệ để chốt`
      );
    }
    update.run(submission.id, groupOfSeed.get(entry.seed_order), entry.id);
  }
}

function createGroupMatches(tournament) {
  const db = getDb();
  const entries = entryRows(tournament.id);
  for (const group of ['A', 'B']) {
    const inGroup = entries.filter((entry) => entry.group_name === group);
    if (inGroup.length !== 4) {
      throw badRequest('bad_group', `Bảng ${group} phải có đúng 4 đội`);
    }
    for (const [first, second] of groupPairs()) {
      const entryA = inGroup[first];
      const entryB = inGroup[second];
      insertSeries(
        db,
        tournament,
        'group',
        `g${group}_${entryA.seed_order}-${entryB.seed_order}`,
        entryA,
        entryB
      );
    }
  }
}

/** Start giải: chốt 8 submission, chia bảng A/B và sinh 24 trận vòng bảng trong 1 transaction. */
export function startTournament(tournamentId) {
  const db = getDb();
  const tournament = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(tournamentId);
  if (!tournament) throw notFound('tournament_not_found', 'Không tìm thấy giải');
  if (tournament.status !== 'draft') {
    throw conflict('already_started', `Giải đang ở trạng thái ${tournament.status}`);
  }
  const placeholders = RUNNING_STATUSES.map(() => '?').join(', ');
  const running = db
    .prepare(`SELECT id, name FROM tournaments WHERE status IN (${placeholders})`)
    .get(...RUNNING_STATUSES);
  if (running) {
    throw conflict('tournament_running', `Giải "${running.name}" đang chạy, hãy đợi kết thúc`);
  }
  if (entryRows(tournamentId).length !== 8) {
    throw badRequest('need_eight_entries', 'Giải phải có đúng 8 đội trước khi start');
  }

  const start = db.transaction(() => {
    freezeAndSeedGroups(tournamentId);
    createGroupMatches(tournament);
    db.prepare("UPDATE tournaments SET status = 'group_running', started_at = ? WHERE id = ?").run(
      nowIso(),
      tournamentId
    );
  });
  start();

  return getTournament(tournamentId);
}

function matchRows(tournamentId, stage) {
  const db = getDb();
  const base = `
    SELECT m.*,
           re.seed_order AS red_seed_order, rp.name AS red_name, rp.id AS red_participant_id,
           be.seed_order AS blue_seed_order, bp.name AS blue_name, bp.id AS blue_participant_id
    FROM matches m
    JOIN tournament_entries re ON re.id = m.red_entry_id
    JOIN participants rp ON rp.id = re.participant_id
    JOIN tournament_entries be ON be.id = m.blue_entry_id
    JOIN participants bp ON bp.id = be.participant_id
    WHERE m.tournament_id = ?`;
  const rows = stage
    ? db
        .prepare(`${base} AND m.stage = ? ORDER BY m.stage, m.series_id, m.game_no`)
        .all(tournamentId, stage)
    : db.prepare(`${base} ORDER BY m.stage, m.series_id, m.game_no`).all(tournamentId);
  return rows;
}

/** Danh sách game cho UI: chỉ trả thông tin an toàn, không có replay/code bot. */
export function listMatches(tournamentId, stage) {
  const db = getDb();
  const exists = db.prepare('SELECT id FROM tournaments WHERE id = ?').get(tournamentId);
  if (!exists) throw notFound('tournament_not_found', 'Không tìm thấy giải');
  return matchRows(tournamentId, stage).map((row) => ({
    id: row.id,
    tournament_id: row.tournament_id,
    stage: row.stage,
    series_id: row.series_id,
    game_no: row.game_no,
    seed: row.seed,
    status: row.status,
    result: row.result,
    reason: row.reason,
    ply_count: row.ply_count,
    started_at: row.started_at,
    finished_at: row.finished_at,
    red: {
      entry_id: row.red_entry_id,
      participant_id: row.red_participant_id,
      name: row.red_name,
      seed_order: row.red_seed_order,
    },
    blue: {
      entry_id: row.blue_entry_id,
      participant_id: row.blue_participant_id,
      name: row.blue_name,
      seed_order: row.blue_seed_order,
    },
  }));
}

function compareStandings(a, b) {
  if (b.points !== a.points) return b.points - a.points;
  if (b.wins !== a.wins) return b.wins - a.wins;
  if (b.win_loss_difference !== a.win_loss_difference) {
    return b.win_loss_difference - a.win_loss_difference;
  }
  return a.seed_order - b.seed_order;
}

/** Bảng xếp hạng 3/1/0 tính trực tiếp từ các match `finished` của vòng bảng. */
export function computeStandings(tournamentId) {
  const db = getDb();
  const tournament = db.prepare('SELECT id, status FROM tournaments WHERE id = ?').get(tournamentId);
  if (!tournament) throw notFound('tournament_not_found', 'Không tìm thấy giải');

  const table = new Map();
  for (const entry of entryRows(tournamentId)) {
    table.set(entry.id, {
      entry_id: entry.id,
      participant_id: entry.participant_id,
      name: entry.participant_name,
      seed_order: entry.seed_order,
      group_name: entry.group_name,
      played: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      points: 0,
      win_loss_difference: 0,
    });
  }

  const finished = db
    .prepare(
      `SELECT red_entry_id, blue_entry_id, result FROM matches
       WHERE tournament_id = ? AND stage = 'group' AND status = 'finished'`
    )
    .all(tournamentId);

  for (const match of finished) {
    const red = table.get(match.red_entry_id);
    const blue = table.get(match.blue_entry_id);
    if (!red || !blue) continue;
    red.played += 1;
    blue.played += 1;
    if (match.result === RESULTS.RED_WIN) {
      red.wins += 1;
      red.points += POINTS.win;
      blue.losses += 1;
    } else if (match.result === RESULTS.BLUE_WIN) {
      blue.wins += 1;
      blue.points += POINTS.win;
      red.losses += 1;
    } else {
      red.draws += 1;
      blue.draws += 1;
      red.points += POINTS.draw;
      blue.points += POINTS.draw;
    }
  }

  const rows = [...table.values()];
  for (const row of rows) row.win_loss_difference = row.wins - row.losses;

  const groupCounts = db
    .prepare(
      `SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'finished' THEN 1 ELSE 0 END) AS done
       FROM matches WHERE tournament_id = ? AND stage = 'group'`
    )
    .get(tournamentId);

  return {
    tournament_id: tournamentId,
    status: tournament.status,
    groups: {
      A: rows.filter((row) => row.group_name === 'A').sort(compareStandings),
      B: rows.filter((row) => row.group_name === 'B').sort(compareStandings),
    },
    tie_breakers: TIE_BREAKERS,
    group_stage_complete: (groupCounts.total || 0) > 0 && groupCounts.total === groupCounts.done,
    matches: { total: groupCounts.total || 0, finished: groupCounts.done || 0 },
  };
}

/** Gộp các game theo series_id và xác định đội thắng series. */
function buildSeries(tournamentId, stage) {
  const grouped = new Map();
  for (const row of matchRows(tournamentId, stage)) {
    if (!grouped.has(row.series_id)) grouped.set(row.series_id, []);
    grouped.get(row.series_id).push(row);
  }

  const series = [];
  for (const [seriesId, games] of grouped) {
    const tally = new Map();
    for (const game of games) {
      if (game.status !== 'finished') continue;
      const winnerEntryId =
        game.result === RESULTS.RED_WIN
          ? game.red_entry_id
          : game.result === RESULTS.BLUE_WIN
            ? game.blue_entry_id
            : null;
      if (winnerEntryId) tally.set(winnerEntryId, (tally.get(winnerEntryId) || 0) + 1);
    }

    const first = games[0];
    const sides = [
      { entry_id: first.red_entry_id, name: first.red_name, seed_order: first.red_seed_order },
      { entry_id: first.blue_entry_id, name: first.blue_name, seed_order: first.blue_seed_order },
    ];
    const allFinished = games.every((game) => game.status === 'finished');
    const gamesWon = {
      [sides[0].entry_id]: tally.get(sides[0].entry_id) || 0,
      [sides[1].entry_id]: tally.get(sides[1].entry_id) || 0,
    };

    // Hòa series -> đội có seed_order nhỏ hơn đi tiếp (doc 03 §3.5).
    let winnerEntryId = null;
    if (allFinished) {
      if (gamesWon[sides[0].entry_id] > gamesWon[sides[1].entry_id]) {
        winnerEntryId = sides[0].entry_id;
      } else if (gamesWon[sides[1].entry_id] > gamesWon[sides[0].entry_id]) {
        winnerEntryId = sides[1].entry_id;
      } else {
        winnerEntryId =
          sides[0].seed_order <= sides[1].seed_order ? sides[0].entry_id : sides[1].entry_id;
      }
    }

    series.push({
      series_id: seriesId,
      stage,
      sides,
      games: games.map((game) => ({
        id: game.id,
        game_no: game.game_no,
        status: game.status,
        result: game.result,
        reason: game.reason,
        ply_count: game.ply_count,
        red: { entry_id: game.red_entry_id, name: game.red_name },
        blue: { entry_id: game.blue_entry_id, name: game.blue_name },
      })),
      games_won: gamesWon,
      complete: allFinished,
      winner_entry_id: winnerEntryId,
      winner_name: winnerEntryId
        ? (sides.find((side) => side.entry_id === winnerEntryId) || {}).name || null
        : null,
    });
  }

  return series.sort((a, b) => a.series_id.localeCompare(b.series_id));
}

/** Bracket bán kết/chung kết + champion (không cần thư viện chart). */
export function computeBracket(tournamentId) {
  const db = getDb();
  const tournament = db.prepare('SELECT id, status FROM tournaments WHERE id = ?').get(tournamentId);
  if (!tournament) throw notFound('tournament_not_found', 'Không tìm thấy giải');
  const semifinals = buildSeries(tournamentId, 'semifinal');
  const finals = buildSeries(tournamentId, 'final');
  const final = finals[0] || null;
  let champion = null;
  if (final && final.complete && final.winner_entry_id) {
    const entry = entryRows(tournamentId).find((row) => row.id === final.winner_entry_id);
    champion = {
      entry_id: final.winner_entry_id,
      name: final.winner_name,
      participant_id: entry ? entry.participant_id : null,
    };
  }

  return {
    tournament_id: tournamentId,
    status: tournament.status,
    semifinals,
    final,
    champion,
  };
}

/** Tiến vòng giải ở đúng một bước, an toàn khi gọi lặp (worker poll nhiều lần):
 * group_running -> semifinal_running -> final_running -> finished.
 * Mỗi bước nằm trong 1 transaction, có guard chống sinh trận trùng.
 */
export function advanceTournament(tournamentId) {
  const db = getDb();
  const tournament = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(tournamentId);
  if (!tournament) throw notFound('tournament_not_found', 'Không tìm thấy giải');

  let advancedTo = null;

  const step = db.transaction(() => {
    if (tournament.status === 'group_running') {
      const counts = db
        .prepare(
          `SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'finished' THEN 1 ELSE 0 END) AS done
           FROM matches WHERE tournament_id = ? AND stage = 'group'`
        )
        .get(tournamentId);
      if (!counts.total || counts.total !== counts.done) return;
      if (db.prepare("SELECT COUNT(*) AS c FROM matches WHERE tournament_id = ? AND stage = 'semifinal'").get(tournamentId).c === 0) {
        const standings = computeStandings(tournamentId);
        const byId = new Map(entryRows(tournamentId).map((entry) => [entry.id, entry]));
        const groupA = standings.groups.A;
        const groupB = standings.groups.B;
        if (groupA.length < 2 || groupB.length < 2) {
          throw badRequest('group_incomplete', 'Bảng chưa đủ dữ liệu để tạo bán kết');
        }
        // SF1: A1 vs B2 — SF2: B1 vs A2.
        insertSeries(db, tournament, 'semifinal', 'sf1', byId.get(groupA[0].entry_id), byId.get(groupB[1].entry_id));
        insertSeries(db, tournament, 'semifinal', 'sf2', byId.get(groupB[0].entry_id), byId.get(groupA[1].entry_id));
      }
      db.prepare("UPDATE tournaments SET status = 'semifinal_running' WHERE id = ?").run(tournamentId);
      advancedTo = 'semifinal_running';
      return;
    }

    if (tournament.status === 'semifinal_running') {
      const counts = db
        .prepare(
          `SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'finished' THEN 1 ELSE 0 END) AS done
           FROM matches WHERE tournament_id = ? AND stage = 'semifinal'`
        )
        .get(tournamentId);
      if (!counts.total || counts.total !== counts.done) return;
      if (db.prepare("SELECT COUNT(*) AS c FROM matches WHERE tournament_id = ? AND stage = 'final'").get(tournamentId).c === 0) {
        const semifinals = buildSeries(tournamentId, 'semifinal');
        const byId = new Map(entryRows(tournamentId).map((entry) => [entry.id, entry]));
        for (const series of semifinals) {
          if (!series.winner_entry_id) {
            throw conflict('series_undecided', `Chưa xác định đội thắng series ${series.series_id}`);
          }
        }
        const sf1 = semifinals.find((series) => series.series_id === 'sf1');
        const sf2 = semifinals.find((series) => series.series_id === 'sf2');
        // Chung kết: đội seed_order nhỏ hơn đi Đỏ ở lượt 1.
        const first = byId.get(sf1.winner_entry_id);
        const second = byId.get(sf2.winner_entry_id);
        const [redSide, blueSide] =
          first.seed_order <= second.seed_order ? [first, second] : [second, first];
        insertSeries(db, tournament, 'final', 'final', redSide, blueSide);
      }
      db.prepare("UPDATE tournaments SET status = 'final_running' WHERE id = ?").run(tournamentId);
      advancedTo = 'final_running';
      return;
    }

    if (tournament.status === 'final_running') {
      const counts = db
        .prepare(
          `SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'finished' THEN 1 ELSE 0 END) AS done
           FROM matches WHERE tournament_id = ? AND stage = 'final'`
        )
        .get(tournamentId);
      if (!counts.total || counts.total !== counts.done) return;
      const finalSeries = buildSeries(tournamentId, 'final')[0];
      if (!finalSeries || !finalSeries.winner_entry_id) {
        throw conflict('series_undecided', 'Chung kết chưa xác định được đội vô địch');
      }
      db.prepare("UPDATE tournaments SET status = 'finished', finished_at = ? WHERE id = ?").run(
        nowIso(),
        tournamentId
      );
      advancedTo = 'finished';
    }
  });

  step();
  return { advanced: advancedTo !== null, status: advancedTo || tournament.status };
}

/** Mã lý do hợp lệ cho một match (kiểm tra lại khi ghi kết quả). */
export const MATCH_REASONS = [
  REASONS.BASE_CAPTURE,
  REASONS.TYPE_ELIMINATED,
  REASONS.MOVE_LIMIT,
  REASONS.FORFEIT_SETUP,
  REASONS.FORFEIT_MOVE,
  REASONS.NO_LEGAL_MOVE,
  REASONS.INTERNAL_ERROR,
];

/** Nhãn lý do hiển thị cho UI (giữ nguyên mã máy để test được). */
export function isValidReason(reason) {
  return MATCH_REASONS.includes(reason);
}
