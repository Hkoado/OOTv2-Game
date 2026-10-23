import { randomBytes, randomUUID, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { rows, rpc, insert, remove, update, uuid } from './client.js';
import { HttpError } from '../lib/httpError.js';
import { normalizeParticipantName } from '../lib/names.js';

const derive = promisify(scrypt);
export const COOKIE_NAME = 'oot_local_session';
export const SESSION_MS = 8 * 60 * 60 * 1000;
/** "Ghi nhớ tài khoản": phiên dài 30 ngày. Client chỉ lưu username, KHÔNG lưu mật khẩu/token. */
export const REMEMBER_MS = 30 * 24 * 60 * 60 * 1000;
export const sessionTtlMs = (remember) => (remember === true ? REMEMBER_MS : SESSION_MS);

/** Guard dùng chung cho các route chỉ admin (đặt ở đây vì không còn driver SQLite). */
export function requireLocalAdmin(req, res, next) {
  if (req.account?.role !== 'admin') return next(new HttpError(403, 'admin_required', 'Chỉ admin được thao tác.'));
  next();
}
const hash = (value) => createHash('sha256').update(value).digest('hex');
const fail = (status, code, message) => new HttpError(status, code, message);
export const view = (row, name) => ({ id: row.id, username: row.username, role: row.role, participant_id: row.participant_id, name: name || row.username, members: row.members, contact: row.contact, repository: row.repository, branch: row.branch });
async function encode(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) throw fail(400,'bad_password','Mật khẩu phải từ 12 đến 128 ký tự.');
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${(await derive(password,salt,64)).toString('hex')}`;
}
export async function listAccounts() {
  const [accounts, teams] = await Promise.all([rows('accounts','order=created_at,id'),rows('participants')]);
  const names = new Map(teams.map((t) => [t.id,t.name]));
  return accounts.map((a) => view(a,names.get(a.participant_id)));
}
export async function createAccount({ username, password, name, role = 'team' }) {
  if (typeof username !== 'string' || !/^[a-zA-Z0-9_.-]{3,40}$/.test(username) || !['admin','team'].includes(role)) throw fail(400,'bad_account','Tài khoản/vai trò không hợp lệ.');
  const created_at = new Date().toISOString();
  const participant = role === 'team' ? { id:randomUUID(),name:normalizeParticipantName(name),created_at } : null;
  if (participant) participant.name_key = participant.name.toLocaleLowerCase('en-US');
  const account = { id:randomUUID(),username:username.toLowerCase(),password_hash:await encode(password),role,participant_id:participant?.id || null,members:'',contact:'',repository:'',branch:'main',created_at };
  await rpc('mvp_account_create',{p_account:account,p_participant:participant});
  return view(account,participant?.name);
}
export async function login(username,password,{ remember = false } = {}) {
  if (typeof username !== 'string' || !/^[a-zA-Z0-9_.-]{3,40}$/.test(username) || typeof password !== 'string' || password.length>128) throw fail(401,'invalid_login','Sai tài khoản hoặc mật khẩu.');
  const [row] = await rows('accounts',`username=eq.${username.toLowerCase()}`);
  const encoded = row?.password_hash || `${'0'.repeat(32)}:${'0'.repeat(128)}`;
  const [salt,expected] = encoded.split(':');
  const actual = await derive(password,salt,64);
  if (!row || !/^[a-f0-9]{128}$/.test(expected) || !timingSafeEqual(actual,Buffer.from(expected,'hex'))) throw fail(401,'invalid_login','Sai tài khoản hoặc mật khẩu.');
  const token = randomBytes(32).toString('hex'),csrf = randomBytes(32).toString('hex');
  const expiresAt = Date.now() + sessionTtlMs(remember);
  await remove('sessions',`expires_at=lte.${Date.now()}`);
  await insert('sessions',{token_hash:hash(token),account_id:row.id,csrf,expires_at:expiresAt});
  const team = row.participant_id ? (await rows('participants',`id=eq.${row.participant_id}`))[0] : null;
  return {
    token,
    csrf,
    account: view(row, team?.name),
    remember: remember === true,
    session_expires_at: new Date(expiresAt).toISOString(),
  };
}
export async function requireSession(req,res,next) {
  try {
    const token = (req.headers.cookie || '').split(';').map((p)=>p.trim()).find((p)=>p.startsWith(`${COOKIE_NAME}=`))?.slice(COOKIE_NAME.length+1);
    if (!token || !/^[a-f0-9]{64}$/.test(token)) throw fail(401,'login_required','Vui lòng đăng nhập.');
    const [session] = await rows('sessions',`token_hash=eq.${hash(token)}&expires_at=gt.${Date.now()}`);
    if (!session) throw fail(401,'login_required','Vui lòng đăng nhập.');
    const [account] = await rows('accounts',`id=eq.${session.account_id}`);
    if (!account) throw fail(401,'login_required','Vui lòng đăng nhập.');
    const team = account.participant_id ? (await rows('participants',`id=eq.${account.participant_id}`))[0] : null;
    req.account = view(account,team?.name); req.session = { csrf:session.csrf,tokenHash:session.token_hash };
    if (!['GET','HEAD','OPTIONS'].includes(req.method) && req.get('x-csrf-token')!==session.csrf) throw fail(403,'csrf_required','Phiên thao tác không hợp lệ.');
    next();
  } catch (error) { next(error); }
}
export const logout = (session) => remove('sessions',`token_hash=eq.${session.tokenHash}`);
export async function resetPassword(id,password) {
  if (!await rpc('mvp_password_reset',{p_id:uuid(id),p_hash:await encode(password)})) throw fail(404,'unknown_account','Không tìm thấy tài khoản.');
}
export async function updateProfile(id,body) {
  const values = {};
  for (const key of ['members','contact','repository','branch']) {
    if (typeof body[key]!=='string' || body[key].length>(key==='members'?2000:300)) throw fail(400,'bad_profile','Thông tin hồ sơ không hợp lệ.');
    values[key] = body[key].trim();
  }
  if (!values.branch || /[\x00-\x20]/.test(values.branch)) throw fail(400,'bad_branch','Branch không hợp lệ.');
  if (values.repository) {
    let url; try { url = new URL(values.repository); } catch { throw fail(400,'bad_repository','URL GitHub không hợp lệ.'); }
    if (url.origin!=='https://github.com' || url.username || url.password || url.search || url.hash || !/^\/[a-zA-Z0-9-]+\/[a-zA-Z0-9_.-]+\/?$/.test(url.pathname)) throw fail(400,'bad_repository','Chỉ nhận repository HTTPS github.com không chứa token.');
  }
  const [account] = await update('accounts',`id=eq.${uuid(id)}`,values);
  const team = account.participant_id ? (await rows('participants',`id=eq.${account.participant_id}`))[0] : null;
  return view(account,team?.name);
}