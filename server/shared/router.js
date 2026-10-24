import { Router } from 'express';
import { HttpError } from '../lib/httpError.js';
import { requireLocalAdmin } from './accounts.js';
import { acceptBotUpload } from '../middleware/upload.js';
import * as accounts from './accounts.js';
import * as participants from './participants.js';
import * as tournaments from './tournaments.js';
import { getSharedJudgeMatch, getSharedJudgeOverview } from './judgeMonitor.js';
import { listBotOutput } from './live.js';
import * as githubIntake from '../services/githubIntake.js';
import * as githubCutoff from '../services/githubCutoff.js';
import * as officialRounds from '../services/officialRounds.js';
import * as publication from './publication.js';
import { rows, uuid } from './client.js';
import { isAllowedOrigin } from '../lib/origin.js';
import config from '../config.js';
import { onlineUploadDecision } from './uploadPolicy.js';
import { manualFinalRouter } from '../routes/manualFinal.js';
import { EMPTY_MAP } from '../../src/game/maps.js';

const forbidden=()=>new HttpError(403,'scope_denied','Không có quyền truy cập dữ liệu này.');
/**
 * Cookie session: HttpOnly + SameSite=strict, thêm `Secure` khi request đi qua HTTPS.
 * Path `/api` (không chỉ `/api/local`) vì `/api/live/*` cũng dùng `requireSession`.
 * `LEGACY_COOKIE_PATH` là path cũ: phải xoá khi login/logout, nếu không browser còn gửi
 * cookie cũ (path dài hơn được gửi trước) và phiên mới bị che.
 */
const COOKIE_PATH='/api';
const LEGACY_COOKIE_PATH='/api/local';
const cookieOptions=(req,maxAge=accounts.SESSION_MS)=>({httpOnly:true,sameSite:'strict',path:COOKIE_PATH,maxAge,secure:req.secure});
const clearCookieOptions=(req)=>({httpOnly:true,sameSite:'strict',path:COOKIE_PATH,secure:req.secure});
const legacyClearCookieOptions=(req)=>({httpOnly:true,sameSite:'strict',path:LEGACY_COOKIE_PATH,secure:req.secure});
export async function checkStage(account,id,stage=null) {
  uuid(id);
  if (account.role==='admin') return;
  const [entry]=await rows('tournament_entries',`tournament_id=eq.${id}&participant_id=eq.${uuid(account.participant_id)}`);
  if (!entry) throw forbidden();
  if (stage&&stage!=='group') {
    const matches=await rows('matches',`tournament_id=eq.${id}&stage=eq.${stage}&or=(red_entry_id.eq.${entry.id},blue_entry_id.eq.${entry.id})`);
    if (!matches.length) throw forbidden();
  }
}
/**
 * Bracket dựng từ dữ liệu đã lọc công bố (không đọc DB lần nữa, không lộ ván chưa phát).
 * Dùng hàm thuần của Khoa (`seriesFrom`) để không phải sửa module scheduler.
 */
export function bracketFromData(tournaments, data) {
  const semifinals = tournaments.seriesFrom(data, 'semifinal');
  const final = tournaments.seriesFrom(data, 'final')[0] || null;
  const winner = final?.winner_entry_id ? data.entries.find((entry) => entry.id === final.winner_entry_id) : null;
  return {
    tournament_id: data.event.id,
    status: data.event.status,
    semifinals,
    final,
    champion: winner ? { entry_id: winner.id, name: winner.participant_name, participant_id: winner.participant_id } : null,
    tie_breaker: 'seed_order',
  };
}

export function sharedRouter() {
  const router=Router(),attempts=new Map();
  router.use((req,res,next)=>{
    res.set('Cache-Control','no-store');
    const origin=req.get('origin');
    if (!['GET','HEAD','OPTIONS'].includes(req.method)&&origin&&!isAllowedOrigin(req,origin)) return next(forbidden());
    next();
  });
  router.post('/login',async(req,res)=>{
    const now=Date.now();for (const [k,v] of attempts) if (v.until<now) attempts.delete(k);
    // `req.ip` là IP thật sau `trust proxy`; dùng socket làm fallback khi proxy tắt.
    const key=req.ip||req.socket.remoteAddress;
    const entry=attempts.get(key)||{count:0,until:now+60000};attempts.set(key,entry);
    if (++entry.count>15) throw new HttpError(429,'login_rate_limit','Thử lại sau một phút.');
    const result=await accounts.login(req.body?.username,req.body?.password,{remember:req.body?.remember===true});attempts.delete(key);
    // Đặt cookie mới trước, rồi xoá cookie path cũ (client cũ có thể còn gửi kèm).
    res.cookie(accounts.COOKIE_NAME,result.token,cookieOptions(req,accounts.sessionTtlMs(result.remember)));
    res.clearCookie(accounts.COOKIE_NAME,legacyClearCookieOptions(req));
    res.json({account:result.account,csrf:result.csrf,remember:result.remember,session_expires_at:result.session_expires_at});
  });
  router.use(accounts.requireSession);
  router.get('/me',(req,res)=>res.json({account:req.account,csrf:req.session.csrf}));
  router.post('/logout',async(req,res)=>{await accounts.logout(req.session);res.clearCookie(accounts.COOKIE_NAME,clearCookieOptions(req));res.clearCookie(accounts.COOKIE_NAME,legacyClearCookieOptions(req));res.json({ok:true});});
  // Chung kết thủ công (BTC-only): module riêng, không mở cổng upload online của đội.
  router.use('/manual-finals', manualFinalRouter());
  router.put('/profile',async(req,res)=>res.json({account:await accounts.updateProfile(req.account.id,req.body||{})}));
  router.get('/teams',requireLocalAdmin,async(req,res)=>{
    const [a,p]=await Promise.all([accounts.listAccounts(),participants.listParticipants()]);res.json({accounts:a,participants:p});
  });
  router.post('/teams',requireLocalAdmin,async(req,res)=>res.status(201).json(await accounts.createAccount({...req.body,role:'team'})));
  router.post('/accounts/:id/password',requireLocalAdmin,async(req,res)=>{await accounts.resetPassword(req.params.id,req.body?.password);res.json({ok:true});});
  router.get('/submissions',async(req,res)=>{
    const id=req.account.role==='admin'?String(req.query.team||''):req.account.participant_id;
    if (!id) {res.json({submissions:[]});return;}
    res.json({submissions:await participants.listSubmissions(id)});
  });
  router.post('/submissions/:team',async(req,res,next)=>{
    // H2: upload HTTP mặc định tắt (đội nộp qua GitHub); admin chỉ khi BTC opt-in trusted-dev.
    const decision=onlineUploadDecision({role:req.account.role,allowOnline:config.uploads.allowOnlineAdmin});
    if (!decision.allowed) throw new HttpError(403,decision.error,decision.message);
    if (req.account.role!=='admin'&&req.account.participant_id!==req.params.team) throw forbidden();
    if (req.account.role!=='admin') {
      const [entries,events]=await Promise.all([rows('tournament_entries',`participant_id=eq.${uuid(req.params.team)}`),rows('tournaments','status=in.(group_running,semifinal_running,final_running)')]);
      if (entries.some((e)=>events.some((t)=>t.id===e.tournament_id))) throw new HttpError(409,'round_frozen','Đội đang thi giải đã khóa bài.');
    }
    next();
  },acceptBotUpload,async(req,res)=>res.status(201).json(await participants.createSubmission(req.params.team,req.file)));
  // GitHub intake (H1): đội đăng ký repo/branch; chỉ admin duyệt (approved=true).
  // API chỉ resolve metadata + SHA, không clone/tải source; receipt trả whitelist.
  router.get('/events/:id/repositories',requireLocalAdmin,async(req,res)=>res.json(await githubIntake.listConnections({eventId:req.params.id})));
  router.get('/events/:id/repository',async(req,res)=>{
    const teamId=githubIntake.scopeTeam(req.account,typeof req.query.team==='string'?req.query.team:null);
    res.json(await githubIntake.getConnection({eventId:req.params.id,teamId,account:req.account}));
  });
  router.put('/events/:id/repository',async(req,res)=>{
    const teamId=githubIntake.scopeTeam(req.account,req.body?.team);
    res.json(await githubIntake.putConnection({eventId:req.params.id,teamId,repository:req.body?.repository,branch:req.body?.branch,account:req.account}));
  });
  // Admin thu hồi duyệt repo: hủy job đang chờ + đóng băng receipt chưa kết thúc.
  router.delete('/events/:id/repository',requireLocalAdmin,async(req,res)=>{
    const teamId=githubIntake.scopeTeam(req.account,req.query.team??req.body?.team);
    res.json(await githubIntake.revokeConnection({eventId:req.params.id,teamId,account:req.account}));
  });
  router.post('/events/:id/submissions/from-github',async(req,res)=>{
    const teamId=githubIntake.scopeTeam(req.account,req.body?.team);
    res.status(202).json(await githubIntake.requestSubmission({eventId:req.params.id,teamId,repository:req.body?.repository,branch:req.body?.branch,account:req.account}));
  });
  // BTC: đúng cutoff, pull một lần cho tất cả repo đã duyệt; job thành công không chạy lại.
  router.post('/events/:id/github-cutoff-sync',requireLocalAdmin,async(req,res)=>{
    res.status(202).json(await githubCutoff.syncAllAtCutoff({eventId:req.params.id,actor:req.account}));
  });
  router.get('/events/:id/submissions/from-github',async(req,res)=>{
    const teamId=githubIntake.scopeTeam(req.account,typeof req.query.team==='string'?req.query.team:null);
    res.json(await githubIntake.getLatest({eventId:req.params.id,teamId,account:req.account}));
  });
  router.get('/repo-sync-jobs/:id',async(req,res)=>res.json(await githubIntake.getJob({jobId:req.params.id,account:req.account})));
  // H3: lịch phát + gói dữ liệu phát. Mọi mốc tính bằng giờ server; đội phải thuộc giải.
  router.get('/events/:id/broadcasts',async(req,res)=>res.json(await publication.listBroadcastsForEvent({eventId:req.params.id,account:req.account})));
  router.get('/broadcasts/:matchId',async(req,res)=>res.json(await publication.viewerPackage({matchId:req.params.matchId,afterSeq:req.query.afterSeq,account:req.account})));
  router.post('/admin/broadcasts',requireLocalAdmin,async(req,res)=>res.status(201).json(await publication.scheduleBroadcast({matchId:req.body?.match_id,startsAt:req.body?.starts_at,plyIntervalMs:req.body?.ply_interval_ms,releaseMode:req.body?.release_mode,actor:req.account.id})));
  router.post('/admin/broadcasts/:matchId/cancel',requireLocalAdmin,async(req,res)=>res.json(await publication.cancelBroadcast({matchId:req.params.matchId})));
  // Quan sát chấm bài (chỉ admin, chỉ đọc): shape cố định cho UI.
  router.get('/admin/judge',requireLocalAdmin,async(req,res)=>res.json(await getSharedJudgeOverview({eventId:typeof req.query.event==='string'&&req.query.event?req.query.event:null})));
  router.get('/admin/judge/matches/:id',requireLocalAdmin,async(req,res)=>res.json(await getSharedJudgeMatch(req.params.id)));
  router.get('/events',async(req,res)=>{
    let events=await tournaments.listTournaments();
    if (req.account.role!=='admin') {const entries=await rows('tournament_entries',`participant_id=eq.${uuid(req.account.participant_id)}`);events=events.filter((t)=>entries.some((e)=>e.tournament_id===t.id));}
    res.json({events: req.account.role === 'admin' ? events : events.map(({ map_json, ...event }) => event)});
  });
  router.post('/events',requireLocalAdmin,async(req,res)=>res.status(201).json(await tournaments.createTournament(req.body||{})));
  router.put('/events/:id',requireLocalAdmin,async(req,res)=>res.json(await tournaments.updateTournamentDraft(req.params.id,req.body||{})));
  router.post('/events/:id/start',requireLocalAdmin,async(req,res)=>{
    // H2: freeze phải đợi job intake xong (hoặc BTC hủy/thu hồi repo), không bỏ qua bài đang chờ.
    const pending=await githubIntake.pendingJobCount(req.params.id);
    if (pending>0) throw new HttpError(409,'repo_sync_pending',`Còn ${pending} job GitHub chưa xong; đợi chấm xong hoặc BTC thu hồi repo rồi thử lại.`);
    res.json(await tournaments.startTournament(req.params.id));
  });
  // K2 weekly group round: chốt snapshot từ setup + bot hợp lệ rồi mở vòng (admin).
  router.get('/events/:id/official-round',requireLocalAdmin,async(req,res)=>res.json(await officialRounds.getGroupRound({eventId:req.params.id})));
  router.post('/events/:id/official-round',requireLocalAdmin,async(req,res)=>{
    const result=await officialRounds.openGroupRound({eventId:req.params.id});
    res.status(result.alreadyOpen?200:201).json(result);
  });
  router.get('/events/:id',async(req,res)=>{
    const id=req.params.id;await checkStage(req.account,id);
    const event = await tournaments.getTournament(id);
    if (event.competition) {
      if (req.account.role !== 'admin' && !event.competition.mapsPublished) {
        event.map = EMPTY_MAP;
        event.map_json = null;
        event.competition = { ...event.competition, primaryMap: EMPTY_MAP, reserveMap: EMPTY_MAP };
      }
      res.json({event,standings:{groups:{}},matches:[],bracket:null}); return;
    }
    const matches = await tournaments.listMatches(id);
    if (req.account.role==='admin') {
      const [standings,bracket]=await Promise.all([tournaments.computeStandings(id),tournaments.computeBracket(id)]);
      res.json({event,standings,matches,bracket});
      return;
    }
    // H3: đội chỉ thấy ván đã công bố đầy đủ; standings/bracket tính lại từ đúng tập đã mở.
    const [publicMatches, data] = await Promise.all([tournaments.listMatches(id), tournaments.loadEvent(id)]);
    const { reveal } = await publication.publishedMatchSets(id);
    const rawVisible = data.matches.filter((match) => reveal.has(match.id));
    const visible = publicMatches.filter((match) => reveal.has(match.id));
    const scoped = { event: data.event, entries: data.entries, matches: rawVisible };
    res.json({ event, standings: tournaments.standingsFrom(scoped), matches: visible, bracket: bracketFromData(tournaments, scoped) });
  });
  router.get('/matches/:id/replay',async(req,res)=>{
    const [row]=await rows('matches',`id=eq.${uuid(req.params.id)}`);
    if (!row) throw new HttpError(404,'match_not_found','Không tìm thấy trận.');
    await checkStage(req.account,row.tournament_id,row.stage);
    // H3: replay chỉ mở khi lịch phát đã phát hết và release_mode = full (admin bỏ qua).
    if (req.account.role!=='admin') {
      const { info } = await publication.broadcastStateForMatch(row.id);
      if (!info.reveal_result) throw new HttpError(404,'replay_not_ready','Replay chưa được công bố.');
    }
    if (row.status!=='finished'||!row.replay_json) throw new HttpError(404,'replay_not_ready','Replay chưa sẵn sàng.');
    const matches=await tournaments.listMatches(row.tournament_id),m=matches.find((m)=>m.id===row.id);
    res.json({match:{...m,replay_url:`/api/local/matches/${row.id}/replay`},replay:JSON.parse(row.replay_json)});
  });
  // Log bot (L2): đội chỉ thấy bên của mình, admin thấy cả hai. Không công khai.
  router.get('/live/matches/:id/bot-output', async (req, res) => {
    const matchId = uuid(req.params.id);
    const [match] = await rows('matches', `id=eq.${matchId}&select=id,red_entry_id,blue_entry_id`);
    if (!match) throw new HttpError(404, 'match_not_found', 'Không tìm thấy ván đấu.');
    let side = null;
    if (req.account.role === 'admin') {
      side = ['red', 'blue'].includes(req.query.side) ? req.query.side : null;
    } else {
      const entries = await rows(
        'tournament_entries',
        `id=in.(${match.red_entry_id},${match.blue_entry_id})&select=id,participant_id`
      );
      const mine = entries.find((entry) => entry.participant_id === req.account.participant_id);
      if (!mine) throw forbidden();
      side = mine.id === match.red_entry_id ? 'red' : 'blue';
    }
    // H3: log bot có thể lộ nước đi sớm; đội chỉ đọc khi ván đã công bố đầy đủ.
    if (req.account.role !== 'admin') {
      const { info } = await publication.broadcastStateForMatch(matchId);
      if (!info.reveal_result) throw new HttpError(404, 'broadcast_not_published', 'Ván chưa được công bố.');
    }
    res.json({ match_id: matchId, ...(await listBotOutput(matchId, { side, afterId: req.query.after, limit: req.query.limit })) });
  });
  return router;
}