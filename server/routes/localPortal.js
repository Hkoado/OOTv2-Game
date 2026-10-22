import { Router } from 'express';
import { asyncHandler } from '../lib/asyncHandler.js';
import { HttpError } from '../lib/httpError.js';
import { getDb } from '../db.js';
import { acceptBotUpload } from '../middleware/upload.js';
import { createSubmission, listParticipants, listSubmissions } from '../services/participants.js';
import { createTournament, updateTournamentDraft, startTournament, listTournaments, getTournament, computeStandings, computeBracket, listMatches } from '../services/tournaments.js';
import { getMatchDetail, getMatchReplay } from '../services/matches.js';
import { COOKIE_NAME, SESSION_MS, login, logout, requireSession, requireLocalAdmin, listAccounts, createAccount, resetPassword, updateProfile } from '../services/localAccounts.js';
import { getJudgeMatch, getJudgeOverview } from '../services/judgeMonitor.js';
import { isAllowedOrigin } from '../lib/origin.js';

const forbidden = () => new HttpError(403, 'scope_denied', 'Không có quyền truy cập dữ liệu này.');
/** Cookie session: HttpOnly + SameSite=strict, thêm `Secure` khi request đi qua HTTPS. */
const cookieOptions = (req) => ({ httpOnly: true, sameSite: 'strict', path: '/api/local', maxAge: SESSION_MS, secure: req.secure });
const clearCookieOptions = (req) => ({ httpOnly: true, sameSite: 'strict', path: '/api/local', secure: req.secure });

function checkStage(account, tournamentId, stage = null) {
  if (account.role === 'admin') return;
  const entry = getDb().prepare('SELECT id FROM tournament_entries WHERE tournament_id=? AND participant_id=?').get(tournamentId, account.participant_id);
  if (!entry) throw forbidden();
  if (stage && stage !== 'group') {
    const participating = getDb().prepare('SELECT id FROM matches WHERE tournament_id=? AND stage=? AND (red_entry_id=? OR blue_entry_id=?)').get(tournamentId, stage, entry.id, entry.id);
    if (!participating) throw forbidden();
  }
}

export function localPortalRouter() {
  const router = Router();
  const attempts = new Map();
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const origin = req.get('origin');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && origin && !isAllowedOrigin(req, origin)) return next(forbidden());
    next();
  });
  router.post('/login', asyncHandler(async (req, res) => {
    const now = Date.now();
    for (const [key, value] of attempts) if (value.until < now) attempts.delete(key);
    // `req.ip` là IP thật sau `trust proxy`; dùng socket làm fallback khi proxy tắt.
    const key = req.ip || req.socket.remoteAddress;
    const attempt = attempts.get(key) || { count: 0, until: now + 60000 };
    if (++attempt.count > 15) throw new HttpError(429, 'login_rate_limit', 'Quá nhiều lần đăng nhập. Thử lại sau một phút.');
    attempts.set(key, attempt);
    const result = await login(req.body?.username, req.body?.password);
    attempts.delete(key);
    res.cookie(COOKIE_NAME, result.token, cookieOptions(req));
    res.json({ account: result.account, csrf: result.csrf });
  }));
  router.use(requireSession);
  router.get('/me', (req, res) => res.json({ account: req.account, csrf: req.session.csrf }));
  router.post('/logout', (req, res) => {
    logout(req.session);
    res.clearCookie(COOKIE_NAME, clearCookieOptions(req));
    res.json({ ok: true });
  });
  router.put('/profile', (req, res) => res.json({ account: updateProfile(req.account.id, req.body || {}) }));
  router.get('/teams', requireLocalAdmin, (req, res) => res.json({ accounts: listAccounts(), participants: listParticipants() }));
  router.post('/teams', requireLocalAdmin, asyncHandler(async (req, res) => res.status(201).json(await createAccount({ ...req.body, role: 'team' }))));
  router.post('/accounts/:id/password', requireLocalAdmin, asyncHandler(async (req, res) => {
    await resetPassword(req.params.id, req.body?.password);
    res.json({ ok: true });
  }));
  router.get('/submissions', (req, res) => res.json({ submissions: listSubmissions(req.account.role === 'admin' ? String(req.query.team || '') : req.account.participant_id) }));
  // Quan sát chấm bài (chỉ đọc, chỉ admin): tiến độ, worker, sự cố và nhật ký từng ván.
  router.get('/admin/judge', requireLocalAdmin, (req, res) => {
    const eventId = typeof req.query.event === 'string' && req.query.event ? req.query.event : null;
    res.json(getJudgeOverview({ eventId }));
  });
  router.get('/admin/judge/matches/:id', requireLocalAdmin, (req, res) => {
    res.json(getJudgeMatch(req.params.id));
  });
  router.post('/submissions/:team', (req, res, next) => {
    if (req.account.role !== 'admin' && req.account.participant_id !== req.params.team) return next(forbidden());
    if (req.account.role !== 'admin' && getDb().prepare(`SELECT e.id FROM tournament_entries e JOIN tournaments t ON t.id=e.tournament_id
      WHERE e.participant_id=? AND t.status IN ('group_running','semifinal_running','final_running')`).get(req.params.team)) {
      return next(new HttpError(409, 'round_frozen', 'Đội đang thi giải đã khóa bài. Chờ giải kết thúc để nộp bản mới.'));
    }
    next();
  }, acceptBotUpload, asyncHandler(async (req, res) => {
    const row = await createSubmission(req.params.team, req.file);
    res.status(201).json({ id: row.id, status: row.status, sha256: row.sha256, validation_error: row.validation_error });
  }));
  router.get('/events', (req, res) => {
    const events = listTournaments().filter((event) => req.account.role === 'admin' || getDb().prepare('SELECT id FROM tournament_entries WHERE tournament_id=? AND participant_id=?').get(event.id, req.account.participant_id));
    res.json({ events });
  });
  router.post('/events', requireLocalAdmin, (req, res) => res.status(201).json(createTournament(req.body || {})));
  router.put('/events/:id', requireLocalAdmin, (req, res) => res.json(updateTournamentDraft(req.params.id, req.body || {})));
  router.post('/events/:id/start', requireLocalAdmin, (req, res) => res.json(startTournament(req.params.id)));
  router.get('/events/:id', (req, res) => {
    checkStage(req.account, req.params.id);
    const matches = listMatches(req.params.id).filter((match) => {
      try { checkStage(req.account, req.params.id, match.stage); return true; } catch { return false; }
    });
    // Legacy bracket exposes later stages, so only admins receive it here.
    res.json({ event: getTournament(req.params.id), standings: computeStandings(req.params.id), matches, bracket: req.account.role === 'admin' ? computeBracket(req.params.id) : null });
  });
  router.get('/matches/:id/replay', (req, res) => {
    const match = getMatchDetail(req.params.id);
    checkStage(req.account, match.tournament_id, match.stage);
    res.json({ match, replay: getMatchReplay(match.id) });
  });
  return router;
}