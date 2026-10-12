/**
 * db.js — SQLite (better-sqlite3) + schema cho MVP. Không ORM, không service DB ngoài.
 * File DB nằm trong `data/` (private, đã gitignore), không nằm trong public/src/dist.
 */

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';

import config from './config.js';

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS participants (
  id          TEXT PRIMARY KEY,
  -- 'name' là tên hiển thị (đã trim); 'name_key' là tên lowercase để chặn trùng
  -- không phân biệt hoa/thường (yêu cầu doc 03 §6).
  name        TEXT NOT NULL UNIQUE,
  name_key    TEXT NOT NULL UNIQUE,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS submissions (
  id               TEXT PRIMARY KEY,
  participant_id   TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  storage_path     TEXT NOT NULL,
  sha256           TEXT NOT NULL,
  status           TEXT NOT NULL CHECK (status IN ('uploaded','valid','invalid')),
  validation_error TEXT,
  created_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_submissions_participant ON submissions(participant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS tournaments (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('draft','group_running','semifinal_running','final_running','finished')),
  seed        INTEGER NOT NULL,
  created_at  TEXT NOT NULL,
  started_at  TEXT,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS tournament_entries (
  id             TEXT PRIMARY KEY,
  tournament_id  TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  participant_id TEXT NOT NULL REFERENCES participants(id),
  submission_id  TEXT REFERENCES submissions(id),
  seed_order     INTEGER NOT NULL,
  group_name     TEXT CHECK (group_name IN ('A','B')),
  UNIQUE (tournament_id, participant_id),
  UNIQUE (tournament_id, seed_order)
);

CREATE TABLE IF NOT EXISTS matches (
  id            TEXT PRIMARY KEY,
  tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  stage         TEXT NOT NULL CHECK (stage IN ('group','semifinal','final')),
  series_id     TEXT NOT NULL,
  game_no       INTEGER NOT NULL CHECK (game_no IN (1,2)),
  red_entry_id  TEXT NOT NULL REFERENCES tournament_entries(id),
  blue_entry_id TEXT NOT NULL REFERENCES tournament_entries(id),
  seed          INTEGER NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('pending','running','finished')),
  result        TEXT CHECK (result IN ('red_win','blue_win','draw')),
  reason        TEXT,
  ply_count     INTEGER,
  replay_json   TEXT,
  started_at    TEXT,
  finished_at   TEXT,
  UNIQUE (tournament_id, stage, series_id, game_no)
);
CREATE INDEX IF NOT EXISTS idx_matches_status ON matches(status);
CREATE INDEX IF NOT EXISTS idx_matches_tournament ON matches(tournament_id, stage, status);
CREATE INDEX IF NOT EXISTS idx_matches_series ON matches(series_id);
`;

let db = null;

export function newId() {
  return randomUUID();
}

export function nowIso() {
  return new Date().toISOString();
}

/** Mở DB (mặc định `data/ootv2.sqlite`), tạo thư mục private và bảng nếu còn thiếu. */
export function initDb({ dbPath = config.dbPath, submissionsDir = config.submissionsDir } = {}) {
  if (db) return db;

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  fs.mkdirSync(submissionsDir, { recursive: true });

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA_SQL);
  return db;
}

export function getDb() {
  if (!db) throw new Error('DB chưa được khởi tạo; gọi initDb() trước');
  return db;
}

export function isDbReady() {
  return db !== null;
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

/**
 * Khôi phục sau crash: mọi match `running` chưa có kết quả trả về `pending`.
 * Chạy lại bằng đúng seed + submission snapshot cũ nên không đúp điểm.
 */
export function recoverUnfinishedMatches() {
  const database = getDb();
  const info = database
    .prepare(
      `UPDATE matches SET status = 'pending', started_at = NULL
       WHERE status = 'running' AND result IS NULL`
    )
    .run();
  return info.changes;
}

export default { initDb, getDb, closeDb, newId, nowIso, recoverUnfinishedMatches };
