import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import { rpc, rows, health } from './client.js';
import { materialize } from './artifacts.js';
import { runMatch } from '../judge/matchRunner.js';
import { advanceTournament } from './tournaments.js';

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
    const entries=await rows('tournament_entries',`tournament_id=eq.${match.tournament_id}`);
    const red=entries.find((e)=>e.id===match.red_entry_id),blue=entries.find((e)=>e.id===match.blue_entry_id);
    if (!red?.submission_id||!blue?.submission_id) throw new Error('missing_snapshot');
    const submissions=await rows('submissions',`id=in.(${red.submission_id},${blue.submission_id})`);
    const teams=await rows('participants',`id=in.(${red.participant_id},${blue.participant_id})`);
    for (const e of [red,blue]) locals.push(await materialize(submissions.find((s)=>s.id===e.submission_id)));
    if (lost) throw new Error('lease_lost');
    const outcome=await run({matchId:match.id,seed:Number(match.seed),red:{name:teams.find((p)=>p.id===red.participant_id).name,filePath:locals[0].file},blue:{name:teams.find((p)=>p.id===blue.participant_id).name,filePath:locals[1].file}});
    if (outcome.reason==='internal_error') throw new Error('judge_infrastructure');
    await beat();
    if (lost) return {processed:true,recorded:false,reason:'lease_lost'};
    const recorded=await rpc('mvp_finish',{p_id:match.id,p_token:token,p_outcome:outcome});
    if (recorded) await advanceTournament(match.tournament_id);
    if (verbose) console.log(`[shared-worker] ${match.id}: ${recorded?'accepted':'stale lease'}`);
    return {processed:true,recorded,matchId:match.id};
  } catch {
    // Infrastructure/storage failures are retries, never bot forfeits or draws.
    await rpc('mvp_release',{p_id:match.id,p_token:token,p_error:'worker_infrastructure'}).catch(()=>{});
    if (verbose) console.error(`[shared-worker] ${match.id}: infrastructure failure; lease released or expires`);
    return {processed:true,recorded:false,reason:'infrastructure'};
  } finally {
    clearInterval(interval);if(heartbeatInFlight)await heartbeatInFlight;
    for (const local of locals) local.cleanup();
  }
}
export async function runSharedWorker({once=false,drain=false}={}) {
  await health();
  const workerId=`${hostname().slice(0,60)}:${process.pid}:${randomUUID()}`;
  let stop=false;const shutdown=()=>{stop=true;};
  process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
  try {
    while(!stop) {
      try {
        const result=await processSharedMatch({workerId});
        if(once||(drain&&!result.processed))break;
        if(!result.processed||result.reason==='infrastructure')await sleep(3000);
      } catch {console.error('[shared-worker] DB unavailable; no local fallback');if(once)throw new Error('Shared worker unavailable');await sleep(5000);}
    }
  } finally {process.off('SIGINT',shutdown);process.off('SIGTERM',shutdown);}
}