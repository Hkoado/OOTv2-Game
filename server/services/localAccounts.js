import { randomBytes, scrypt, createHash, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { getDb, newId, nowIso } from '../db.js';
import { badRequest, conflict, unauthorized, HttpError } from '../lib/httpError.js';
import { createParticipant } from './participants.js';

const derive = promisify(scrypt);
export const COOKIE_NAME = 'oot_local_session';
export const SESSION_MS = 8 * 60 * 60 * 1000;
const hash = (value) => createHash('sha256').update(value).digest('hex');

export function initAccounts() {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS local_accounts (
      id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','team')),
      participant_id TEXT UNIQUE REFERENCES participants(id),
      members TEXT NOT NULL DEFAULT '', contact TEXT NOT NULL DEFAULT '',
      repository TEXT NOT NULL DEFAULT '', branch TEXT NOT NULL DEFAULT 'main',
      created_at TEXT NOT NULL,
      CHECK ((role='admin' AND participant_id IS NULL) OR (role='team' AND participant_id IS NOT NULL))
    );
    CREATE TABLE IF NOT EXISTS local_sessions (
      token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES local_accounts(id) ON DELETE CASCADE,
      csrf TEXT NOT NULL, expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS local_sessions_expiry ON local_sessions(expires_at);
  `);
}

function checkPassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) {
    throw badRequest('bad_password', 'Mật khẩu phải từ 12 đến 128 ký tự.');
  }
}

async function passwordHash(password) {
  checkPassword(password);
  const salt = randomBytes(16).toString('hex');
  const key = await derive(password, salt, 64);
  return `${salt}:${key.toString('hex')}`;
}

export function accountView(row) {
  return { id: row.id, username: row.username, role: row.role, participant_id: row.participant_id,
    name: row.name || row.username, members: row.members, contact: row.contact,
    repository: row.repository, branch: row.branch };
}

const SELECT = `SELECT a.*, p.name FROM local_accounts a LEFT JOIN participants p ON p.id=a.participant_id`;

export function listAccounts() {
  return getDb().prepare(`${SELECT} ORDER BY a.created_at, a.id`).all().map(accountView);
}

export async function createAccount({ username, password, name, role = 'team' }) {
  if (typeof username !== 'string' || !/^[a-zA-Z0-9_.-]{3,40}$/.test(username)) {
    throw badRequest('bad_username', 'Tên đăng nhập: 3–40 ký tự chữ, số, _ . -');
  }
  if (!['admin', 'team'].includes(role)) throw badRequest('bad_role', 'Vai trò không hợp lệ.');
  const normalized = username.toLowerCase();
  const encoded = await passwordHash(password);
  return getDb().transaction(() => {
    if (getDb().prepare('SELECT id FROM local_accounts WHERE username=?').get(normalized)) {
      throw conflict('duplicate_username', 'Tên đăng nhập đã tồn tại.');
    }
    const participant = role === 'team' ? createParticipant(name) : null;
    const id = newId();
    getDb().prepare(`INSERT INTO local_accounts(id, username, password_hash, role, participant_id, created_at)
      VALUES(?,?,?,?,?,?)`).run(id, normalized, encoded, role, participant?.id || null, nowIso());
    return accountView(getDb().prepare(`${SELECT} WHERE a.id=?`).get(id));
  })();
}

export async function login(username, password) {
  if (typeof username !== 'string' || typeof password !== 'string' || username.length > 40 || password.length > 128) {
    throw unauthorized('invalid_login', 'Sai tài khoản hoặc mật khẩu.');
  }
  const row = getDb().prepare(`${SELECT} WHERE a.username=?`).get(username.toLowerCase());
  const [salt, expected] = (row?.password_hash || `${'0'.repeat(32)}:${'0'.repeat(128)}`).split(':');
  const actual = await derive(password, salt, 64);
  if (!row || !timingSafeEqual(actual, Buffer.from(expected, 'hex'))) {
    throw unauthorized('invalid_login', 'Sai tài khoản hoặc mật khẩu.');
  }
  getDb().prepare('DELETE FROM local_sessions WHERE expires_at<=?').run(Date.now());
  const token = randomBytes(32).toString('hex');
  const csrf = randomBytes(32).toString('hex');
  getDb().prepare('INSERT INTO local_sessions VALUES(?,?,?,?)').run(hash(token), row.id, csrf, Date.now() + SESSION_MS);
  return { token, csrf, account: accountView(row) };
}

export function readSession(req) {
  const token = (req.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE_NAME}=`))?.slice(COOKIE_NAME.length + 1);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const row = getDb().prepare(`SELECT a.*, p.name, s.csrf FROM local_accounts a
    LEFT JOIN participants p ON p.id=a.participant_id JOIN local_sessions s ON s.account_id=a.id
    WHERE s.token_hash=? AND s.expires_at>?`).get(hash(token), Date.now());
  return row ? { account: accountView(row), csrf: row.csrf, tokenHash: hash(token) } : null;
}

export function requireSession(req, res, next) {
  const session = readSession(req);
  if (!session) return next(unauthorized('login_required', 'Vui lòng đăng nhập.'));
  req.session = session;
  req.account = session.account;
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('x-csrf-token') !== session.csrf) {
    return next(new HttpError(403, 'csrf_required', 'Phiên thao tác không hợp lệ. Hãy tải lại trang.'));
  }
  next();
}

export function requireLocalAdmin(req, res, next) {
  if (req.account?.role !== 'admin') return next(new HttpError(403, 'admin_required', 'Chỉ admin được thao tác.'));
  next();
}

export function logout(session) {
  getDb().prepare('DELETE FROM local_sessions WHERE token_hash=?').run(session.tokenHash);
}

export async function resetPassword(accountId, password) {
  const encoded = await passwordHash(password);
  const changed = getDb().prepare('UPDATE local_accounts SET password_hash=? WHERE id=?').run(encoded, accountId);
  if (!changed.changes) throw badRequest('unknown_account', 'Không tìm thấy tài khoản.');
  getDb().prepare('DELETE FROM local_sessions WHERE account_id=?').run(accountId);
}

export function updateProfile(id, body) {
  const values = ['members', 'contact', 'repository', 'branch'].map((key) => {
    const value = body[key];
    if (typeof value !== 'string' || value.length > (key === 'members' ? 2000 : 300)) throw badRequest('bad_profile', 'Thông tin hồ sơ không hợp lệ.');
    return value.trim();
  });
  const [, , repository, branch] = values;
  if (repository) {
    let url;
    try { url = new URL(repository); } catch { throw badRequest('bad_repository', 'URL GitHub không hợp lệ.'); }
    if (url.origin !== 'https://github.com' || url.username || url.password || url.search || url.hash || !/^\/[a-zA-Z0-9-]+\/[a-zA-Z0-9_.-]+\/?$/.test(url.pathname)) {
      throw badRequest('bad_repository', 'Chỉ nhận URL repository HTTPS trên github.com, không kèm token.');
    }
  }
  if (!branch || /[\x00-\x20]/.test(branch)) throw badRequest('bad_branch', 'Branch không hợp lệ.');
  getDb().prepare('UPDATE local_accounts SET members=?, contact=?, repository=?, branch=? WHERE id=?').run(...values, id);
  return accountView(getDb().prepare(`${SELECT} WHERE a.id=?`).get(id));
}