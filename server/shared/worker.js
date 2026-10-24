import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import { rpc, rows, update, health } from './client.js';
import { materialize } from './artifacts.js';
import { runMatch } from '../judge/matchRunner.js';
import { resolveMatchMap } from '../contracts/mapSnapshot.js';
import { advanceTournament } from './tournaments.js';
import { recordSharedMatchLog } from './judgeMonitor.js';
import { validateBotFile } from '../services/botValidation.js';
import {
  startLiveMatch,
  recordLiveMove,
  recordLiveTerminal,
  recordBotOutput,
  heartbeatLiveWorker,
  pruneLiveHistory,
} from './live.js';
import { FAILURE_REASONS } from '../services/judgeView.js';

/**
 * Hàng đợi ghi live tuần tự: `runMatch` gọi observer đồng bộ, nhưng mỗi lần ghi
 * Supabase là một HTTP request. Xếp hàng để không bắn 200 request song song và
 * để thứ tự event không phụ thuộc may mắn. Lỗi ghi live không được làm hỏng trận.
 */
function liveQueue() {
  let tail = Promise.resolve();
  return {
    push(task) {
      tail = tail.then(task).catch(() => {});
      return tail;
    },
    flush: () => tail,
  };
}

/**
 * Chấm thử các bài vừa upload (`status = 'uploaded'`) trên worker, KHÔNG trên API.
 * - Tải artifact từ Storage, kiểm hash/kích thước, chạy syntax + protocol smoke.
 * - Kết quả ghi `valid`/`invalid` để BTC chốt được snapshot.
 * - Lỗi hạ tầng (mạng/Storage) giữ nguyên `uploaded` để lần poll sau thử lại;
 *   không bao giờ đánh dấu bài là sai vì lỗi của máy chấm.
 */
export async function validatePendingSubmissions({ limit = 4 } = {}) {
  const pending = await rows('submissions', `status=eq.uploaded&order=created_at.asc&limit=${limit}`);
  let done = 0;
  for (const submission of pending) {
    let local = null;
    try {
      local = await materialize(submission);
      const result = await validateBotFile(local.file);
      await update('submissions', `id=eq.${submission.id}`, {
        status: result.ok ? 'valid' : 'invalid',
        validation_error: result.ok ? null : `${result.error}: ${result.message}`.slice(0, 500),
      });
      done += 1;
    } catch {
      // Giữ `uploaded` cho lần chạy sau.
    } finally {
      if (local) local.cleanup();
    }
  }
  return done;
}

/**
 * Map dùng cho MỘT ván của runtime shared: ưu tiên snapshot ghi trên `mvp_matches`;
 * ván tạo trước migration (`map_json` NULL) dùng map hiện tại của giải.
 * Trả `{ map, hash, source, error }`; `error` khác null nghĩa là KHÔNG được chạy bot.
 */
export async function matchMapFor(match) {
  const eventMapJson = match.map_json
    ? null
    : ((await rows('tournaments', `id=eq.${match.tournament_id}&select=map_json`))[0]?.map_json ?? null);
  return resolveMatchMap({ map_json: match.map_json, map_hash: match.map_hash, eventMapJson });
}

export async function processSharedMatch({workerId,run=runMatch,verbose=true}) {
  const match=await rpc('mvp_claim',{p_worker:workerId});
  if (!match) {
    const events=await rows('tournaments','status=in.(group_running,semifinal_running,final_running)');
    for (const event of events) await advanceTournament(event.id);
    return {processed:false};
  }
  const token=match.lease_token,locals=[];let heartbeatInFlight=null,lost=false;
  const beat=()=>{
    if (heartbeatInFlight) return heartbeatInFlight;
    heartbeatInFlight=rpc('mvp_heartbeat',{p_id:match.id,p_token:token}).then((ok)=>{if(!ok)lost=true;}).catch(()=>{lost=true;}).finally(()=>{heartbeatInFlight=null;});
    return heartbeatInFlight;
  };
  const interval=setInterval(beat,10000);interval.unref();
  try {
    // Snapshot hỏng hoặc hash lệch => lỗi hạ tầng, KHÔNG chạy bot với map khác.
    const mapInfo = await matchMapFor(match);
    if (mapInfo.error) throw new Error(`map_snapshot: ${mapInfo.error}`);
    const entries=await rows('tournament_entries',`tournament_id=eq.${match.tournament_id}`);
    const red=entries.find((e)=>e.id===match.red_entry_id),blue=entries.find((e)=>e.id===match.blue_entry_id);
    if (!red?.submission_id||!blue?.submission_id) throw new Error('missing_snapshot');
    const submissions=await rows('submissions',`id=in.(${red.submission_id},${blue.submission_id})`);
    const teams=await rows('participants',`id=in.(${red.participant_id},${blue.participant_id})`);
    for (const e of [red,blue]) locals.push(await materialize(submissions.find((s)=>s.id===e.submission_id)));
    if (lost) throw new Error('lease_lost');
    const live=liveQueue();
    const onLive=(event)=>{
      if (event?.kind==='initial') live.push(()=>startLiveMatch(match.id,{initialPieces:event.initialPieces,seed:event.seed}));
      else if (event?.kind==='move') live.push(()=>recordLiveMove(match.id,event));
    };
    const onBotOutput=(chunk)=>live.push(()=>recordBotOutput(match.id,chunk.side,chunk.stream,chunk.text));
    const outcome=await run({matchId:match.id,seed:Number(match.seed),map:mapInfo.map,red:{name:teams.find((p)=>p.id===red.participant_id).name,filePath:locals[0].file},blue:{name:teams.find((p)=>p.id===blue.participant_id).name,filePath:locals[1].file},onLive,onBotOutput});
    await live.flush();
    if (outcome.reason==='internal_error') throw new Error('judge_infrastructure');
    await recordLiveTerminal(match.id,{result:outcome.result,reason:outcome.reason,ply_count:outcome.ply_count}).catch(()=>{});
    await beat();
    if (lost) return {processed:true,recorded:false,reason:'lease_lost'};
    const recorded=await rpc('mvp_finish',{p_id:match.id,p_token:token,p_outcome:outcome});
    if (recorded) {
      // Quan sát (Mức 2): nhật ký là best-effort, không được đổi kết quả trận.
      const failed=FAILURE_REASONS.includes(outcome.reason);
      const startedAt=Date.parse(match.started_at||'');
      await recordSharedMatchLog({
        matchId:match.id,
        notes:Array.isArray(outcome.notes)?outcome.notes:[],
        error:failed?outcome.notes?.[0]||outcome.reason:null,
        worker:workerId,
        elapsedMs:Number.isFinite(startedAt)?Date.now()-startedAt:null,
      }).catch(()=>console.warn('[shared-worker] không ghi được nhật ký chấm; kiểm tra migration 20261022150000_judge_monitor.sql'));
      await advanceTournament(match.tournament_id);
    }
    if (verbose) console.log(`[shared-worker] ${match.id}: ${recorded?'accepted':'stale lease'}`);
    return {processed:true,recorded,matchId:match.id};
  } catch (error) {
    // Infrastructure/storage failures are retries, never bot forfeits or draws.
    await rpc('mvp_release',{p_id:match.id,p_token:token,p_error:'worker_infrastructure'}).catch(()=>{});
    if (verbose) console.error(`[shared-worker] ${match.id}: infrastructure failure (${String(error?.message||error).slice(0,200)}); lease released or expires`);
    return {processed:true,recorded:false,reason:'infrastructure'};
  } finally {
    clearInterval(interval);if(heartbeatInFlight)await heartbeatInFlight;
    for (const local of locals) local.cleanup();
  }
}
export async function runSharedWorker({once=false,drain=false}={}) {
  await health();
  // Dọn event/log của giải đã kết thúc > 2 ngày (best effort, không chặn chấm bài).
  await pruneLiveHistory().catch(()=>{});
  const workerId=`${hostname().slice(0,60)}:${process.pid}:${randomUUID()}`;
  let stop=false;const shutdown=()=>{stop=true;};
  process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
  try {
    while(!stop) {
      try {
        await heartbeatLiveWorker(workerId).catch(()=>{});
        // Nhận bài mới: chấm thử trên worker để API không bao giờ chạy code bot.
        await validatePendingSubmissions().catch(()=>{});
        const result=await processSharedMatch({workerId});
        if(once||(drain&&!result.processed))break;
        if(!result.processed||result.reason==='infrastructure')await sleep(3000);
      } catch (err) {console.error(`[shared-worker] Worker loop error: ${err?.message || err}; DB unavailable or local issue`);if(once)throw err;await sleep(5000);}
    }
  } finally {process.off('SIGINT',shutdown);process.off('SIGTERM',shutdown);}
}