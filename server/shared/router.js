import { Router } from 'express';
import { HttpError } from '../lib/httpError.js';
import { requireLocalAdmin } from '../services/localAccounts.js';
import { acceptBotUpload } from '../middleware/upload.js';
import * as accounts from './accounts.js';
import * as participants from './participants.js';
import * as tournaments from './tournaments.js';
import { rows, uuid } from './client.js';

const forbidden=()=>new HttpError(403,'scope_denied','Không có quyền truy cập dữ liệu này.');
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
export function sharedRouter() {
  const router=Router(),attempts=new Map();
  router.use((req,res,next)=>{
    res.set('Cache-Control','no-store');
    const origin=req.get('origin');
    if (!['GET','HEAD','OPTIONS'].includes(req.method)&&origin) {
      try {const url=new URL(origin);if (!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||!['http:','https:'].includes(url.protocol)) throw forbidden();} catch {return next(forbidden());}
    }
    next();
  });
  router.post('/login',async(req,res)=>{
    const now=Date.now();for (const [k,v] of attempts) if (v.until<now) attempts.delete(k);
    const entry=attempts.get(req.ip)||{count:0,until:now+60000};attempts.set(req.ip,entry);
    if (++entry.count>15) throw new HttpError(429,'login_rate_limit','Thử lại sau một phút.');
    const result=await accounts.login(req.body?.username,req.body?.password);attempts.delete(req.ip);
    res.cookie(accounts.COOKIE_NAME,result.token,{httpOnly:true,sameSite:'strict',path:'/api/local',maxAge:accounts.SESSION_MS});
    res.json({account:result.account,csrf:result.csrf});
  });
  router.use(accounts.requireSession);
  router.get('/me',(req,res)=>res.json({account:req.account,csrf:req.session.csrf}));
  router.post('/logout',async(req,res)=>{await accounts.logout(req.session);res.clearCookie(accounts.COOKIE_NAME,{path:'/api/local',sameSite:'strict',httpOnly:true});res.json({ok:true});});
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
    if (req.account.role!=='admin'&&req.account.participant_id!==req.params.team) throw forbidden();
    if (req.account.role!=='admin') {
      const [entries,events]=await Promise.all([rows('tournament_entries',`participant_id=eq.${uuid(req.params.team)}`),rows('tournaments','status=in.(group_running,semifinal_running,final_running)')]);
      if (entries.some((e)=>events.some((t)=>t.id===e.tournament_id))) throw new HttpError(409,'round_frozen','Đội đang thi giải đã khóa bài.');
    }
    next();
  },acceptBotUpload,async(req,res)=>res.status(201).json(await participants.createSubmission(req.params.team,req.file)));
  router.get('/events',async(req,res)=>{
    let events=await tournaments.listTournaments();
    if (req.account.role!=='admin') {const entries=await rows('tournament_entries',`participant_id=eq.${uuid(req.account.participant_id)}`);events=events.filter((t)=>entries.some((e)=>e.tournament_id===t.id));}
    res.json({events});
  });
  router.post('/events',requireLocalAdmin,async(req,res)=>res.status(201).json(await tournaments.createTournament(req.body||{})));
  router.put('/events/:id',requireLocalAdmin,async(req,res)=>res.json(await tournaments.updateTournamentDraft(req.params.id,req.body||{})));
  router.post('/events/:id/start',requireLocalAdmin,async(req,res)=>res.json(await tournaments.startTournament(req.params.id)));
  router.get('/events/:id',async(req,res)=>{
    const id=req.params.id;await checkStage(req.account,id);
    const [event,standings,matches,bracket]=await Promise.all([tournaments.getTournament(id),tournaments.computeStandings(id),tournaments.listMatches(id),req.account.role==='admin'?tournaments.computeBracket(id):null]);
    const allowed=[];
    for (const stage of ['group','semifinal','final']) {try {await checkStage(req.account,id,stage);allowed.push(stage);} catch(error) {if (error.status!==403&&error.statusCode!==403) {if(error.code!=='scope_denied') throw error;}}}
    res.json({event,standings,matches:matches.filter((m)=>allowed.includes(m.stage)),bracket});
  });
  router.get('/matches/:id/replay',async(req,res)=>{
    const [row]=await rows('matches',`id=eq.${uuid(req.params.id)}`);
    if (!row) throw new HttpError(404,'match_not_found','Không tìm thấy trận.');
    await checkStage(req.account,row.tournament_id,row.stage);
    if (row.status!=='finished'||!row.replay_json) throw new HttpError(404,'replay_not_ready','Replay chưa sẵn sàng.');
    const matches=await tournaments.listMatches(row.tournament_id),m=matches.find((m)=>m.id===row.id);
    res.json({match:{...m,replay_url:`/api/local/matches/${row.id}/replay`},replay:JSON.parse(row.replay_json)});
  });
  return router;
}