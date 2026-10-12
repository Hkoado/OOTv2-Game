import { createHash } from 'node:crypto';
import { rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import config from '../config.js';
import { getDb, newId, nowIso } from '../db.js';
import { badRequest, conflict, notFound } from '../lib/httpError.js';
import { validateBotFile } from './botValidation.js';

const NAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} _.\-]*$/u;

/** Chuẩn hoá + kiểm tra tên đội (trim 1–40 ký tự, không ký tự điều khiển). */
export function normalizeParticipantName(rawName) {
  if (typeof rawName !== 'string') {
    throw badRequest('bad_name', 'name phải là chuỗi');
  }
  const name = rawName.trim();
  if (name.length < 1 || name.length > 40) {
    throw badRequest('bad_name', 'Tên đội phải từ 1 đến 40 ký tự sau khi trim');
  }
  if (!NAME_PATTERN.test(name)) {
    throw badRequest('bad_name', 'Tên đội chỉ gồm chữ, số, khoảng trắng, _ . -');
  }
  return name;
}

export function createParticipant(rawName) {
  const db = getDb();
  const name = normalizeParticipantName(rawName);
  const nameKey = name.toLocaleLowerCase('en-US');

  const existing = db.prepare('SELECT id FROM participants WHERE name_key = ?').get(nameKey);
  if (existing) {
    throw conflict('duplicate_name', `Đã có đội trùng tên: ${name}`);
  }

  const participant = { id: newId(), name, created_at: nowIso() };
  db.prepare('INSERT INTO participants (id, name, name_key, created_at) VALUES (?, ?, ?, ?)').run(
    participant.id,
    participant.name,
    nameKey,
    participant.created_at
  );
  return participant;
}

function latestSubmissionFor(participantId, onlyValid = false) {
  const db = getDb();
  const sql = onlyValid
    ? `SELECT id, participant_id, sha256, status, validation_error, created_at
       FROM submissions WHERE participant_id = ? AND status = 'valid'
       ORDER BY created_at DESC, rowid DESC LIMIT 1`
    : `SELECT id, participant_id, sha256, status, validation_error, created_at
       FROM submissions WHERE participant_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`;
  return db.prepare(sql).get(participantId) || null;
}

export function listParticipants() {
  const db = getDb();
  const rows = db.prepare('SELECT id, name, created_at FROM participants ORDER BY created_at, id').all();
  return rows.map((row) => {
    const latest = latestSubmissionFor(row.id);
    const latestValid = latestSubmissionFor(row.id, true);
    return {
      ...row,
      latest_submission: latest,
      latest_valid_submission_id: latestValid ? latestValid.id : null,
    };
  });
}

export function getParticipant(participantId) {
  const db = getDb();
  const row = db.prepare('SELECT id, name, created_at FROM participants WHERE id = ?').get(participantId);
  if (!row) throw notFound('participant_not_found', 'Không tìm thấy đội');
  return row;
}

export function listSubmissions(participantId) {
  getParticipant(participantId);
  const db = getDb();
  // Không trả `storage_path` hay nội dung source ra ngoài.
  return db
    .prepare(
      `SELECT id, participant_id, sha256, status, validation_error, created_at
       FROM submissions WHERE participant_id = ? ORDER BY created_at DESC, rowid DESC`
    )
    .all(participantId);
}

export function getSubmissionRecord(submissionId) {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM submissions WHERE id = ?')
    .get(submissionId);
  if (!row) throw notFound('submission_not_found', 'Không tìm thấy submission');
  return row;
}

/**
 * Lưu submission mới: ghi file server-generated -> validate (cú pháp + smoke test)
 * -> cập nhật `status`/`validation_error`. File không hợp lệ bị xoá khỏi đĩa.
 * @param {string} participantId
 * @param {{ buffer: Buffer, originalname: string }} upload file từ multer memoryStorage
 */
export async function createSubmission(participantId, upload) {
  if (!upload || !Buffer.isBuffer(upload.buffer)) {
    throw badRequest('missing_file', 'Thiếu file bot trong trường `file`');
  }

  const db = getDb();
  getParticipant(participantId);

  const submissionId = newId();
  const storagePath = path.join(config.submissionsDir, `${submissionId}.py`);
  writeFileSync(storagePath, upload.buffer);

  const sha256 = createHash('sha256').update(upload.buffer).digest('hex');

  db.prepare(
    `INSERT INTO submissions (id, participant_id, storage_path, sha256, status, validation_error, created_at)
     VALUES (?, ?, ?, ?, 'uploaded', NULL, ?)`
  ).run(submissionId, participantId, storagePath, sha256, nowIso());

  let validation;
  try {
    validation = await validateBotFile(storagePath);
  } catch (error) {
    validation = { ok: false, error: 'validation_crashed', message: error.message };
  }

  if (validation.ok) {
    db.prepare(`UPDATE submissions SET status = 'valid', validation_error = NULL WHERE id = ?`).run(
      submissionId
    );
  } else {
    db.prepare(`UPDATE submissions SET status = 'invalid', validation_error = ? WHERE id = ?`).run(
      `${validation.error}: ${validation.message}`.slice(0, 500),
      submissionId
    );
    try {
      rmSync(storagePath, { force: true });
    } catch {
      /* dọn dẹp best-effort */
    }
  }

  return getSubmissionRecord(submissionId);
}

export default { createParticipant };
