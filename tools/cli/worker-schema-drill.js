/**
 * worker-schema-drill.js — bằng chứng "chốt schema" Huy ↔ Khoa trên project đích.
 *
 * Kiểm hành vi PostgreSQL thật mà worker official cần: claim đồng thời, heartbeat đúng/sai owner,
 * lease hết hạn + reclaim, worker cũ finish/fail bị fence, duplicate finish, retry cap, accepted
 * result 0-ply, lỗi hạ tầng không sinh forfeit, REST không ghi thẳng được bảng được bảo vệ.
 *
 * An toàn:
 * - Chỉ chạy khi truyền `--allow-project=<ref>` đúng bằng project trong SUPABASE_URL.
 * - Fixture tạo bằng Management API (owner) rồi xoá sạch ở cuối; không đụng dữ liệu giải thật.
 * - Không in token/service key. Exit 0 = mọi ca PASS.
 *
 * Chạy: node tools/cli/worker-schema-drill.js --allow-project=<ref>
 */

import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const args = process.argv.slice(2);
const allowFlag = args.find((value) => value.startsWith('--allow-project='));
const allowedRef = allowFlag ? allowFlag.slice('--allow-project='.length) : null;

if (!process.env.SUPABASE_URL) {
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/u)) {
    const match = /^([A-Za-z0-9_]+)=(.*)$/u.exec(line.trim());
    if (match && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/gu, '');
    }
  }
}

const base = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const ref = (() => {
  try {
    return new URL(base).hostname.split('.')[0];
  } catch {
    return '';
  }
})();
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const accessToken = process.env.SUPABASE_ACCESS_TOKEN;

if (!base || !serviceKey || !accessToken) {
  console.error('Thiếu SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ACCESS_TOKEN.');
  process.exit(2);
}
if (!allowedRef || allowedRef !== ref) {
  console.error(`DỪNG: cần --allow-project=${ref} (project trong SUPABASE_URL) để chạy drill.`);
  process.exit(2);
}

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

async function owner(sql) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`mgt_${response.status}: ${text.slice(0, 300)}`);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

const restHeaders = { apikey: serviceKey, authorization: `Bearer ${serviceKey}` };
async function rpc(name, body) {
  const response = await fetch(`${base}/rest/v1/rpc/${name}`, { method: 'POST',
    headers: { ...restHeaders, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: response.status, body: parsed };
}
async function rest(method, pathname, body) {
  const response = await fetch(`${base}/rest/v1/${pathname}`, { method,
    headers: { ...restHeaders, 'content-type': 'application/json', prefer: 'return=minimal' },
    body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, text: (await response.text()).slice(0, 160) };
}

const H = (char) => char.repeat(64);
const ids = { event: randomUUID(), round: randomUUID(), worker1: 'schema-drill-a', worker2: 'schema-drill-b' };
const GAME_MAIN = 'drill:main:1';
const GAME_RETRY = 'drill:retry:1';
const replay0Ply = {
  schemaVersion: 'campus-engine-replay.v1', rulesVersion: 'campus-rules.v2',
  config: { id: 'schema-drill', seed: 5, map: { rulesVersion: 'campus-rules.v2' } },
  mapHash: H('a'), initialStateHash: H('b'), events: [], result: 'red_win',
  terminationReason: 'INVALID_SETUP', contentHash: H('c'),
};
const REPLAY_HASH = H('d');
const stamp = new Date().toISOString();

async function cleanup() {
  await owner(`delete from public.mvp_official_broadcasts where round_pk = '${ids.round}';
    delete from public.mvp_official_job_attempts where round_pk = '${ids.round}';
    delete from public.mvp_official_jobs where round_pk = '${ids.round}';
    delete from public.mvp_official_games where round_pk = '${ids.round}';
    delete from public.mvp_official_rounds where id = '${ids.round}';
    delete from public.mvp_tournaments where id = '${ids.event}';
    delete from public.mvp_participants where id = '${ids.event}';`);
}

async function main() {
  try {
    await owner(`begin;
insert into public.mvp_participants(id,name,name_key,created_at) values
 ('${ids.event}','drill','drill-${ids.event}','${stamp}');
insert into public.mvp_tournaments(id,name,status,seed,created_at)
 values('${ids.event}','schema drill','draft',5,'${stamp}');
insert into public.mvp_official_rounds(id,event_id,round_id,snapshot,snapshot_hash,genesis_hash,chain_hash,game_count)
 values('${ids.round}','${ids.event}','ko:semifinal:1',
  jsonb_build_object('schemaVersion','campus-round-snapshot.v1','contentHash','${H('a')}',
   'eventId','${ids.event}','roundId','ko:semifinal:1','bots','[]'::jsonb,'cutoff','${stamp}'),
  '${H('a')}','${H('b')}','${H('c')}',2);
insert into public.mvp_official_games(round_pk,seq,game_key,stage,red_participant_id,blue_participant_id,
 seed,map_slot,map_hash,map_pack_version,chain_hash)
 values
 ('${ids.round}',1,'${GAME_MAIN}','semifinal','${ids.event}','${randomUUID()}',5,'primary','${H('e')}','drill-pack','${H('c')}'),
 ('${ids.round}',2,'${GAME_RETRY}','semifinal','${ids.event}','${randomUUID()}',5,'reserve','${H('f')}','drill-pack','${H('9')}');
commit;`);
    check('fixture round + 2 ván chưa chấm', true, ids.round);

    const enqueuedMain = await rpc('mvp_official_enqueue_job', { p_round: ids.round,
      p_game_key: GAME_MAIN, p_input_hash: H('1') });
    check('enqueue tạo đúng 1 job queued', enqueuedMain.body?.ok === true
      && enqueuedMain.body?.created === true, JSON.stringify(enqueuedMain.body));
    const mainJobId = enqueuedMain.body.job_id;

    // 1) Hai worker claim đồng thời: chỉ một lease hợp lệ.
    const [claimA, claimB] = await Promise.all([
      rpc('mvp_official_claim_job', { p_worker: ids.worker1, p_lease_seconds: 60 }),
      rpc('mvp_official_claim_job', { p_worker: ids.worker2, p_lease_seconds: 60 }),
    ]);
    const claimed = [claimA.body, claimB.body].filter((row) => row?.ok === true);
    const leased = claimed.map((row) => row.job).find((job) => job?.id === mainJobId);
    check('claim đồng thời: đúng một lease owner cho job', claimed.length === 1
      && Boolean(leased) && leased.attempt === 1 && leased.reclaimed === false,
    JSON.stringify({ claimA: claimA.body, claimB: claimB.body }));
    const token = leased.leaseToken;
    const generation = leased.generation;
    const ownerWorker = claimA.body?.job?.id === mainJobId ? ids.worker1 : ids.worker2;
    const otherWorker = ownerWorker === ids.worker1 ? ids.worker2 : ids.worker1;

    // 2) Heartbeat đúng owner / sai token.
    const goodBeat = await rpc('mvp_official_heartbeat_job',
      { p_job: mainJobId, p_token: token, p_generation: generation, p_lease_seconds: 60 });
    check('heartbeat đúng owner gia hạn được', goodBeat.body?.ok === true,
      JSON.stringify(goodBeat.body));
    const [beforeWrong] = await owner(
      `select lease_until from public.mvp_official_jobs where id = '${mainJobId}'`);
    const wrongBeat = await rpc('mvp_official_heartbeat_job', { p_job: mainJobId,
      p_token: randomUUID(), p_generation: generation, p_lease_seconds: 60 });
    const [afterWrong] = await owner(
      `select lease_until from public.mvp_official_jobs where id = '${mainJobId}'`);
    check('heartbeat sai token bị từ chối và không đổi lease',
      wrongBeat.body?.error === 'lease_lost' && beforeWrong.lease_until === afterWrong.lease_until,
    JSON.stringify({ wrongBeat: wrongBeat.body }));

    // 3) Lease hết hạn: heartbeat không được hồi sinh lease chết (20261026150000).
    await owner(`update public.mvp_official_jobs
      set lease_until = clock_timestamp() - interval '1 second' where id = '${mainJobId}'`);
    const beatExpired = await rpc('mvp_official_heartbeat_job',
      { p_job: mainJobId, p_token: token, p_generation: generation, p_lease_seconds: 60 });
    check('heartbeat trên lease đã hết hạn bị từ chối', beatExpired.body?.error === 'lease_lost',
      JSON.stringify(beatExpired.body));

    // 4) Worker cũ finish/fail khi lease hết hạn: bị fence, chưa có kết quả.
    const staleFinish = await rpc('mvp_official_finish_job', { p_job: mainJobId, p_token: token,
      p_generation: generation, p_result: 'red_win', p_replay_hash: REPLAY_HASH, p_replay: replay0Ply });
    const staleFail = await rpc('mvp_official_fail_job', { p_job: mainJobId, p_token: token,
      p_generation: generation, p_error: 'late', p_category: 'infrastructure', p_retryable: true });
    const [gameAfterStale] = await owner(
      `select result from public.mvp_official_games where round_pk = '${ids.round}'
        and game_key = '${GAME_MAIN}'`);
    check('worker cũ không finish/fail được sau khi lease hết hạn',
      staleFinish.body?.error === 'lease_lost' && staleFail.body?.error === 'lease_lost'
      && gameAfterStale.result === null,
    JSON.stringify({ finish: staleFinish.body, fail: staleFail.body, result: gameAfterStale.result }));

    // 5) Worker khác reclaim: attempt/generation tăng, attempt cũ bị fence.
    const reclaim = await rpc('mvp_official_claim_job',
      { p_worker: otherWorker, p_lease_seconds: 120 });
    const reclaimedJob = reclaim.body?.job;
    check('reclaim lease hết hạn sinh attempt mới',
      reclaim.body?.ok === true && reclaim.body?.reclaimed === true && reclaimedJob?.id === mainJobId
      && reclaimedJob.attempt === 2 && reclaimedJob.generation === generation + 1,
    JSON.stringify(reclaim.body));
    const [oldAttempt] = await owner(`select outcome from public.mvp_official_job_attempts
      where job_id = '${mainJobId}' and attempt = 1`);
    check('attempt cũ bị đánh dấu lease_expired', oldAttempt?.outcome === 'lease_expired',
      JSON.stringify(oldAttempt));

    // 6) Worker mới finish: accepted result + replay 0-ply (engine kết thúc trước nước đầu).
    const finish = await rpc('mvp_official_finish_job', { p_job: mainJobId,
      p_token: reclaimedJob.leaseToken, p_generation: reclaimedJob.generation,
      p_result: 'red_win', p_replay_hash: REPLAY_HASH, p_replay: replay0Ply });
    const [gameRow] = await owner(`select result, replay_hash, recorded_at is not null as recorded
      from public.mvp_official_games where round_pk = '${ids.round}' and game_key = '${GAME_MAIN}'`);
    const [jobRow] = await owner(`select status, result, replay_hash, lease_token, lease_until
      from public.mvp_official_jobs where id = '${mainJobId}'`);
    check('finish ghi accepted result + replay 0-ply, job succeeded, lease được giải phóng',
      finish.body?.ok === true && finish.body?.already_recorded === false
      && gameRow.result === 'red_win' && gameRow.replay_hash === REPLAY_HASH && gameRow.recorded === true
      && jobRow.status === 'succeeded' && jobRow.lease_token === null && jobRow.lease_until === null,
    JSON.stringify({ finish: finish.body, gameRow, jobRow }));

    const [attemptRow] = await owner(`select outcome, replay is not null as has_replay,
      jsonb_array_length(coalesce(replay->'events', '[]'::jsonb)) as events
      from public.mvp_official_job_attempts where job_id = '${mainJobId}' and attempt = 2`);
    check('attempt accepted giữ replay 0-ply', attemptRow?.outcome === 'succeeded'
      && attemptRow.has_replay === true && attemptRow.events === 0, JSON.stringify(attemptRow));

    // 7) Duplicate finish: idempotent, không tạo accepted thứ hai; kết quả khác là conflict.
    const duplicate = await rpc('mvp_official_finish_job', { p_job: mainJobId,
      p_token: reclaimedJob.leaseToken, p_generation: reclaimedJob.generation,
      p_result: 'red_win', p_replay_hash: REPLAY_HASH, p_replay: replay0Ply });
    const [succeededAttempts] = await owner(`select count(*)::int c from public.mvp_official_job_attempts
      where job_id = '${mainJobId}' and outcome = 'succeeded'`);
    const conflict = await rpc('mvp_official_finish_job', { p_job: mainJobId,
      p_token: reclaimedJob.leaseToken, p_generation: reclaimedJob.generation,
      p_result: 'blue_win', p_replay_hash: H('8'), p_replay: replay0Ply });
    check('duplicate finish idempotent, kết quả khác là result_conflict',
      duplicate.body?.ok === true && duplicate.body?.already_recorded === true
      && succeededAttempts.c === 1 && conflict.body?.error === 'result_conflict',
    JSON.stringify({ duplicate: duplicate.body, conflict: conflict.body, succeededAttempts }));

    // 8) Retry cap: lỗi hạ tầng retryable tới hạn thì terminal, không sinh forfeit.
    const enqueuedRetry = await rpc('mvp_official_enqueue_job', { p_round: ids.round,
      p_game_key: GAME_RETRY, p_input_hash: H('2') });
    check('enqueue job thứ hai sau khi claim xong', enqueuedRetry.body?.created === true,
      JSON.stringify(enqueuedRetry.body));
    let capped = null;
    for (let round = 1; round <= 4; round += 1) {
      await owner(`update public.mvp_official_jobs set available_at = clock_timestamp()
        where round_pk = '${ids.round}' and game_key = '${GAME_RETRY}'`);
      const claim = await rpc('mvp_official_claim_job', { p_worker: ids.worker1, p_lease_seconds: 60 });
      if (claim.body?.ok !== true) { capped = { stoppedAt: round, claim: claim.body }; break; }
      const fail = await rpc('mvp_official_fail_job', { p_job: claim.body.job.id,
        p_token: claim.body.job.leaseToken, p_generation: claim.body.job.generation,
        p_error: `infra ${round}`, p_category: 'infrastructure', p_retryable: true });
      capped = { stoppedAt: round, fail: fail.body };
      if (fail.body?.terminal === true) break;
    }
    const [retryJob] = await owner(`select status, attempt, max_attempts, error_category
      from public.mvp_official_jobs where round_pk = '${ids.round}' and game_key = '${GAME_RETRY}'`);
    const [retryGame] = await owner(`select result from public.mvp_official_games
      where round_pk = '${ids.round}' and game_key = '${GAME_RETRY}'`);
    const reClaim = await rpc('mvp_official_claim_job', { p_worker: ids.worker2, p_lease_seconds: 60 });
    check('retry cap: dừng đúng max_attempts, job failed, không có forfeit',
      retryJob.status === 'failed' && retryJob.attempt === retryJob.max_attempts
      && retryJob.error_category === 'infrastructure' && retryGame.result === null
      && (reClaim.body === null || reClaim.body?.ok !== true),
    JSON.stringify({ capped, retryJob, retryGame, reClaim: reClaim.body }));

    // 9) REST không ghi thẳng được bảng được bảo vệ.
    const patchJob = await rest('PATCH', `mvp_official_jobs?id=eq.${mainJobId}`, { error: 'x' });
    const patchGame = await rest('PATCH', `mvp_official_games?round_pk=eq.${ids.round}`, { result: 'draw' });
    const patchAttempt = await rest('PATCH', `mvp_official_job_attempts?job_id=eq.${mainJobId}`,
      { error_code: 'x' });
    check('REST PATCH jobs/games/attempts bị từ chối (42501)',
      patchJob.status === 403 && patchGame.status === 403 && patchAttempt.status === 403,
    JSON.stringify({ patchJob: patchJob.status, patchGame: patchGame.status,
      patchAttempt: patchAttempt.status }));
    const deleteGame = await rest('DELETE',
      `mvp_official_games?round_pk=eq.${ids.round}&game_key=eq.${encodeURIComponent(GAME_RETRY)}`);
    check('REST DELETE official_games bị từ chối', deleteGame.status === 403,
      `status=${deleteGame.status} ${deleteGame.text}`);
  } finally {
    await cleanup();
    const [left] = await owner(`select
      (select count(*) from public.mvp_official_jobs where round_pk = '${ids.round}')::int jobs,
      (select count(*) from public.mvp_official_games where round_pk = '${ids.round}')::int games,
      (select count(*) from public.mvp_official_rounds where id = '${ids.round}')::int rounds,
      (select count(*) from public.mvp_tournaments where id = '${ids.event}')::int events`);
    check('dọn sạch fixture (đếm lại 0)', left.jobs === 0 && left.games === 0 && left.rounds === 0
      && left.events === 0, JSON.stringify(left));
  }
  const failed = results.filter((row) => !row.ok).length;
  console.log(`\n${failed ? 'FAIL' : 'PASS'} ${results.length - failed}/${results.length} schema checks`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((error) => {
  console.error(`[schema-drill] lỗi: ${error.message}`);
  process.exitCode = 1;
});
