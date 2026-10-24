import { randomUUID } from 'node:crypto';
import { rows, rpc, uuid } from './client.js';
import { HttpError } from '../lib/httpError.js';
import { normalizeMap, EMPTY_MAP } from '../../src/game/maps.js';
import { randomSeed, deriveSeed } from '../judge/rng.js';
import { GROUP_SEEDS, TIE_BREAKERS } from '../lib/tournamentFormat.js';
import { setupFor, saveOfficialSetup, officialView } from './officialSetup.js';
import { matchMapSnapshot } from '../contracts/mapSnapshot.js';

const fail = (status,code,message) => new HttpError(status,code,message);
const stageStatus = {group_running:'group',semifinal_running:'semifinal',final_running:'final'};
export async function loadEvent(id) {
  uuid(id);
  const [events,entries,matches,participants] = await Promise.all([
    rows('tournaments',`id=eq.${id}`),rows('tournament_entries',`tournament_id=eq.${id}&order=seed_order`),
    rows('matches',`tournament_id=eq.${id}&order=stage,series_id,game_no`),rows('participants'),
  ]);
  if (!events[0]) throw fail(404,'tournament_not_found','Không tìm thấy giải.');
  const names = new Map(participants.map((p)=>[p.id,p.name]));
  return { event:events[0],entries:entries.map((e)=>({...e,participant_name:names.get(e.participant_id)})),matches };
}
export async function getTournament(id) {
  const {event,entries,matches} = await loadEvent(id);
  const submissions = await rows('submissions','select=id,status');
  const status = new Map(submissions.map((s)=>[s.id,s.status]));
  const config = await setupFor(id);
  return {...event,...(config ? officialView({ ...event, entries }, config) : { profile: 'mvp.v1' }),map:event.map_json?JSON.parse(event.map_json):EMPTY_MAP,
    entries:entries.map((e)=>({...e,submission_status:status.get(e.submission_id)||null})),
    match_counts:{total:matches.length,finished:matches.filter((m)=>m.status==='finished').length}};
}
export async function listTournaments() {
  const [events,matches] = await Promise.all([rows('tournaments','order=created_at.desc,id'),rows('matches','select=tournament_id,status')]);
  return events.map((t)=>({...t,match_total:matches.filter((m)=>m.tournament_id===t.id).length,match_finished:matches.filter((m)=>m.tournament_id===t.id&&m.status==='finished').length}));
}
function validateIds(ids) {
  if (!Array.isArray(ids)||ids.length>8||new Set(ids).size!==ids.length) throw fail(400,'bad_participants','Chọn tối đa 8 đội không trùng.');
  ids.forEach(uuid);
}
function mapValue(map) {
  try { return normalizeMap(map); } catch { throw fail(400,'bad_map','Map không hợp lệ.'); }
}
export async function createTournament({name,participantIds=[],competition={}}) {
  return getTournament(await saveOfficialSetup({ name, participantIds, competition }));
}
// Kept only for historical compatibility; portal creates official setups exclusively.
export async function createLegacyTournament({name,participantIds=[],map=EMPTY_MAP}) {
  if (typeof name!=='string'||name.trim().length<1||name.trim().length>80) throw fail(400,'bad_name','Tên giải phải từ 1 đến 80 ký tự.');
  validateIds(participantIds);
  const event = {id:randomUUID(),name:name.trim(),seed:randomSeed(),created_at:new Date().toISOString(),map_json:JSON.stringify(mapValue(map))};
  await rpc('mvp_draft_save',{p_event:event,p_entries:participantIds.map((id,i)=>({id:randomUUID(),participant_id:id,seed_order:i+1}))});
  return getTournament(event.id);
}
export async function updateTournamentDraft(id,{participantIds,map,competition,expectedVersion}) {
  const event = await getTournament(id);
  if (event.status!=='draft') throw fail(409,'event_frozen','Giải đã khóa.');
  if (event.competition) {
    if (!Number.isInteger(expectedVersion) || expectedVersion !== event.version) throw fail(409,'event_conflict','Thiết lập đã thay đổi hoặc thiếu phiên bản. Làm mới trước khi lưu.');
    await saveOfficialSetup({ id, name: event.name, participantIds: participantIds ?? event.entries.map((e)=>e.participant_id),
      competition: competition ?? event.competition, expected: event.version });
    return getTournament(id);
  }
  const ids = participantIds??event.entries.map((e)=>e.participant_id);
  validateIds(ids);
  await rpc('mvp_draft_save',{p_event:{id,map_json:JSON.stringify(mapValue(map??event.map))},p_entries:ids.map((pid,i)=>({id:randomUUID(),participant_id:pid,seed_order:i+1})),p_expected:event.version});
  return getTournament(id);
}
function seriesGames(event,stage,series,a,b) {
  // Snapshot map chốt ngay khi lên lịch: sửa map của giải sau đó không làm lệch ván đã tạo.
  const snapshot = eventSnapshot(event);
  return [[a,b],[b,a]].map(([red,blue],i)=>({id:randomUUID(),stage,series_id:series,game_no:i+1,red_entry_id:red.id,blue_entry_id:blue.id,seed:deriveSeed(event.seed,stage,series,i+1),map_json:snapshot.json,map_hash:snapshot.hash}));
}
/** Map đã lưu của giải; giải cũ không có `map_json` => bàn mở MVP. */
function eventMapOf(event) {
  if (!event||!event.map_json) return undefined;
  try { return JSON.parse(event.map_json); } catch { throw fail(409,'bad_event_map','Map của giải không đọc được.'); }
}
/** Snapshot chuẩn hoá + hash; map hỏng thì chặn lên lịch thay vì tạo ván thiếu dữ liệu. */
function eventSnapshot(event) {
  try { return matchMapSnapshot(eventMapOf(event)); }
  catch { throw fail(409,'bad_event_map','Map của giải không hợp lệ, không thể lên lịch trận.'); }
}
export async function startTournament(id) {
  const {event,entries} = await loadEvent(id);
  if (await setupFor(id)) throw fail(409,'official_scheduler_not_ready','Thiết lập chính thức đã lưu; chưa nối scheduler/snapshot/runner chính thức. Không chạy bằng MVP.');
  if (event.status!=='draft') throw fail(409,'already_started','Giải đã bắt đầu.');
  const map = event.map_json?JSON.parse(event.map_json):EMPTY_MAP;
  if (map.schemaVersion === 'map.v2' || map.blocked.length) throw fail(409,'map_runner_unavailable','Worker MVP chưa hỗ trợ map v2 hoặc ô cản.');
  if (entries.length!==8) throw fail(400,'need_eight_entries','Giải phải có đúng 8 đội.');
  const submissions = await rows('submissions','status=eq.valid&order=created_at.desc,id.desc');
  const snapshots = entries.map((e)=>{
    const s = submissions.find((s)=>s.participant_id===e.participant_id);
    if (!s) throw fail(400,'missing_valid_submission',`Đội ${e.participant_name} chưa có bot hợp lệ.`);
    return {id:e.id,submission_id:s.id,group_name:Object.keys(GROUP_SEEDS).find((g)=>GROUP_SEEDS[g].includes(e.seed_order))};
  });
  const games = [];
  for (const group of ['A','B']) {
    const teams = entries.filter((e)=>snapshots.find((s)=>s.id===e.id).group_name===group);
    for (let i=0;i<teams.length;i++) for (let j=i+1;j<teams.length;j++) games.push(...seriesGames(event,'group',`g${group}_${teams[i].seed_order}-${teams[j].seed_order}`,teams[i],teams[j]));
  }
  const ok = await rpc('mvp_stage_commit',{p_id:id,p_expected:'draft',p_next:'group_running',p_games:games,p_snapshots:snapshots});
  if (!ok) throw fail(409,'event_conflict','Giải đã thay đổi.');
  return getTournament(id);
}
export function standingsFrom({event,entries,matches}) {
  const table = new Map(entries.map((e)=>[e.id,{entry_id:e.id,participant_id:e.participant_id,name:e.participant_name,seed_order:e.seed_order,group_name:e.group_name,played:0,wins:0,draws:0,losses:0,points:0,win_loss_difference:0}]));
  const group = matches.filter((m)=>m.stage==='group');
  for (const m of group.filter((m)=>m.status==='finished')) {
    const red=table.get(m.red_entry_id),blue=table.get(m.blue_entry_id);
    if (!red||!blue) continue;
    red.played++;blue.played++;
    if (m.result==='draw') {red.draws++;blue.draws++;red.points++;blue.points++;}
    else {const [winner,loser]=m.result==='red_win'?[red,blue]:[blue,red];winner.wins++;winner.points+=3;loser.losses++;}
  }
  const sorted=[...table.values()].map((r)=>({...r,win_loss_difference:r.wins-r.losses})).sort((a,b)=>b.points-a.points||b.wins-a.wins||b.win_loss_difference-a.win_loss_difference||a.seed_order-b.seed_order);
  return {tournament_id:event.id,status:event.status,groups:Object.fromEntries(['A','B'].map((g)=>[g,sorted.filter((r)=>r.group_name===g).map((r,i)=>({...r,rank:i+1}))])),tie_breakers:TIE_BREAKERS,group_stage_complete:group.length>0&&group.every((m)=>m.status==='finished'),matches:{total:group.length,finished:group.filter((m)=>m.status==='finished').length}};
}
export const computeStandings = async(id)=>standingsFrom(await loadEvent(id));
export function seriesFrom(data,stage) {
  const byId=new Map(data.entries.map((e)=>[e.id,e])),groups=new Map();
  for (const game of data.matches.filter((m)=>m.stage===stage)) {if (!groups.has(game.series_id)) groups.set(game.series_id,[]);groups.get(game.series_id).push(game);}
  return [...groups].map(([series_id,games])=>{
    const first=games[0],sides=[first.red_entry_id,first.blue_entry_id].map((id)=>({entry_id:id,name:byId.get(id).participant_name,seed_order:byId.get(id).seed_order}));
    const tally=Object.fromEntries(sides.map((s)=>[s.entry_id,0]));
    for (const g of games) if (g.status==='finished'&&g.result!=='draw') tally[g.result==='red_win'?g.red_entry_id:g.blue_entry_id]++;
    const complete=games.every((g)=>g.status==='finished');
    const winner=complete?[...sides].sort((a,b)=>tally[b.entry_id]-tally[a.entry_id]||a.seed_order-b.seed_order)[0]:null;
    return {series_id,stage,sides,games:games.map((g)=>({id:g.id,game_no:g.game_no,status:g.status,result:g.result,reason:g.reason,ply_count:g.ply_count,red:{entry_id:g.red_entry_id,name:byId.get(g.red_entry_id).participant_name},blue:{entry_id:g.blue_entry_id,name:byId.get(g.blue_entry_id).participant_name}})),games_won:tally,complete,winner_entry_id:winner?.entry_id||null,winner_name:winner?.name||null};
  }).sort((a,b)=>a.series_id.localeCompare(b.series_id));
}
export async function computeBracket(id) {
  const data=await loadEvent(id),semifinals=seriesFrom(data,'semifinal'),finals=seriesFrom(data,'final'),final=finals[0];
  const winner=final?.winner_entry_id?data.entries.find((e)=>e.id===final.winner_entry_id):null;
  return {tournament_id:id,status:data.event.status,semifinals,final:final||null,champion:winner?{entry_id:winner.id,name:winner.participant_name,participant_id:winner.participant_id}:null,tie_breaker:'seed_order'};
}
export async function listMatches(id,stage) {
  const data=await loadEvent(id),entries=new Map(data.entries.map((e)=>[e.id,e]));
  const side=(id)=>{const e=entries.get(id);return {entry_id:id,participant_id:e.participant_id,name:e.participant_name,seed_order:e.seed_order};};
  return data.matches.filter((m)=>!stage||m.stage===stage).map((m)=>({id:m.id,tournament_id:id,stage:m.stage,series_id:m.series_id,game_no:m.game_no,seed:Number(m.seed),status:m.status,result:m.result,reason:m.reason,ply_count:m.ply_count,map_hash:m.map_hash||null,started_at:m.started_at,finished_at:m.finished_at,red:side(m.red_entry_id),blue:side(m.blue_entry_id)}));
}
export async function advanceTournament(id) {
  const data=await loadEvent(id),{event,entries,matches}=data,stage=stageStatus[event.status];
  const current=matches.filter((m)=>m.stage===stage);
  if (!stage||!current.length||current.some((m)=>m.status!=='finished')) return {advanced:false,status:event.status};
  const byId=new Map(entries.map((e)=>[e.id,e]));let next,games=[];
  if (stage==='group') {
    const {groups}=standingsFrom(data);next='semifinal_running';
    if (!groups?.A?.[0]?.entry_id || !groups?.A?.[1]?.entry_id || !groups?.B?.[0]?.entry_id || !groups?.B?.[1]?.entry_id) {
      return { advanced: false, status: event.status };
    }
    games=[...seriesGames(event,'semifinal','sf1',byId.get(groups.A[0].entry_id),byId.get(groups.B[1].entry_id)),...seriesGames(event,'semifinal','sf2',byId.get(groups.B[0].entry_id),byId.get(groups.A[1].entry_id))];
  } else if (stage==='semifinal') {
    const winners=seriesFrom(data,'semifinal').map((s)=>byId.get(s.winner_entry_id)).sort((a,b)=>a.seed_order-b.seed_order);
    if (!winners[0] || !winners[1]) return { advanced: false, status: event.status };
    next='final_running';games=seriesGames(event,'final','final',winners[0],winners[1]);
  } else next='finished';
  const advanced=await rpc('mvp_stage_commit',{p_id:id,p_expected:event.status,p_next:next,p_games:games});
  return {advanced,status:advanced?next:event.status};
}