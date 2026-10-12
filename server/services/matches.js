/**
 * matches.js — Truy vấn match cho API. KHÔNG bao giờ trả đường dẫn file bot,
 * hash hay source code; chỉ trả tên người chơi, kết quả và replay (dữ liệu engine).
 */

import { getDb } from '../db.js';
import { notFound } from '../lib/httpError.js';

const MATCH_SELECT = `
  SELECT m.id, m.tournament_id, m.stage, m.series_id, m.game_no, m.seed, m.status,
         m.result, m.reason, m.ply_count, m.started_at, m.finished_at,
         m.red_entry_id, m.blue_entry_id,
         rp.name AS red_name, bp.name AS blue_name,
         t.name AS tournament_name, t.status AS tournament_status
  FROM matches m
  JOIN tournaments t ON t.id = m.tournament_id
  JOIN tournament_entries re ON re.id = m.red_entry_id
  JOIN participants rp ON rp.id = re.participant_id
  JOIN tournament_entries be ON be.id = m.blue_entry_id
  JOIN participants bp ON bp.id = be.participant_id
`;

export function toMatchView(row) {
  return {
    id: row.id,
    tournament_id: row.tournament_id,
    tournament_name: row.tournament_name,
    tournament_status: row.tournament_status,
    stage: row.stage,
    series_id: row.series_id,
    game_no: row.game_no,
    seed: row.seed,
    status: row.status,
    red: { participant_id: row.red_entry_id, name: row.red_name },
    blue: { participant_id: row.blue_entry_id, name: row.blue_name },
    result: row.result,
    reason: row.reason,
    ply_count: row.ply_count,
    started_at: row.started_at,
    finished_at: row.finished_at,
    replay_url: `/api/matches/${row.id}/replay`,
  };
}

export function getMatchRow(matchId) {
  return getDb().prepare(`${MATCH_SELECT} WHERE m.id = ?`).get(matchId) || null;
}

export function getMatchDetail(matchId) {
  const row = getMatchRow(matchId);
  if (!row) throw notFound('match_not_found', `Không tìm thấy match ${matchId}`);
  return toMatchView(row);
}

/** Danh sách match của 1 giải (dùng cho trang giải đấu / polling). */
export function listMatches({ tournamentId } = {}) {
  const db = getDb();
  const rows = tournamentId
    ? db
        .prepare(
          `${MATCH_SELECT} WHERE m.tournament_id = ?
           ORDER BY CASE m.stage WHEN 'group' THEN 0 WHEN 'semifinal' THEN 1 ELSE 2 END,
                    m.series_id, m.game_no`
        )
        .all(tournamentId)
    : db
        .prepare(
          `${MATCH_SELECT}
           ORDER BY m.created_at DESC, m.series_id, m.game_no LIMIT 200`
        )
        .all();
  return rows.map(toMatchView);
}

/**
 * Replay đã lưu (seed + trạng thái ban đầu + danh sách nước đi).
 * Chỉ có khi match `finished`; match đang chạy trả 404 để UI biết chưa xem được.
 */
export function getMatchReplay(matchId) {
  const row = getDb()
    .prepare('SELECT status, replay_json FROM matches WHERE id = ?')
    .get(matchId);
  if (!row) throw notFound('match_not_found', `Không tìm thấy match ${matchId}`);
  if (row.status !== 'finished' || !row.replay_json) {
    throw notFound('replay_not_ready', 'Replay chỉ có sau khi match kết thúc');
  }

  let replay;
  try {
    replay = JSON.parse(row.replay_json);
  } catch {
    throw notFound('replay_corrupt', 'Replay lưu trữ không đọc được');
  }
  return replay;
}

export default { getMatchDetail, listMatches, getMatchReplay, toMatchView };
