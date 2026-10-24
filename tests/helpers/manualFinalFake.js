/**
 * manualFinalFake.js — Mô phỏng transaction SQL của Chung kết thủ công trong test.
 *
 * SQL thật (`supabase/migrations/20261026100000_manual_final.sql`) là nguồn xác thực;
 * fake này chỉ giữ đúng *hợp đồng* để test producer/consumer mà không chạm DB:
 * - chọn/khóa chỉ trên bài valid, đợt intake;
 * - pair cần đợt locked + hai bài locked hợp lệ, idempotent theo key;
 * - cancel cần lý do, không hủy kết quả accepted;
 * - claim/finish/release fence theo lease token + generation, duplicate finish trả already_finished.
 */
import { randomUUID } from 'node:crypto';

const fail = (error) => ({ ok: false, error });
const clone = (value) => JSON.parse(JSON.stringify(value));

function table(store, name) {
  return store[name] || (store[name] = []);
}

function selectOne(store, name, predicate) {
  return table(store, name).find(predicate) || null;
}

/** Audit giả lập: SQL thật ghi bằng `mvp_manual_final_log` trong cùng transaction. */
function logAction(store, { eventId, entity, entityId, action, actor = null, reason = null, detail = {} }) {
  const rows = table(store, 'manual_final_audit');
  rows.push({
    id: rows.length + 1,
    event_id: eventId,
    entity,
    entity_id: entityId,
    action,
    actor,
    reason,
    detail,
    created_at: new Date().toISOString(),
  });
}

export function installManualFinalRpc(store) {
  store.__rpc = {
    async mvp_manual_final_select({ p_submission, p_actor }) {
      const submission = selectOne(store, 'manual_final_submissions', (row) => row.id === p_submission);
      if (!submission) return fail('submission_not_found');
      const event = selectOne(store, 'manual_final_events', (row) => row.id === submission.event_id);
      if (!event) return fail('event_not_found');
      if (event.status !== 'intake') return fail('event_not_open');
      if (submission.locked_at) return fail('submission_locked');
      if (selectOne(store, 'manual_final_submissions',
        (row) => row.event_id === submission.event_id && row.team_id === submission.team_id && row.locked_at)) {
        return fail('submission_locked');
      }
      if (submission.status !== 'valid') return fail('submission_not_valid');
      for (const row of table(store, 'manual_final_submissions')) {
        if (row.event_id === submission.event_id && row.team_id === submission.team_id
          && row.id !== submission.id && row.selected_at) {
          row.selected_at = null;
          row.selected_by = null;
        }
      }
      submission.selected_at = new Date().toISOString();
      submission.selected_by = p_actor;
      logAction(store, { eventId: submission.event_id, entity: 'submission', entityId: submission.id,
        action: 'select', actor: p_actor, detail: { team_id: submission.team_id, sha256: submission.sha256 } });
      return { ok: true, submission_id: submission.id, team_id: submission.team_id,
        sha256: submission.sha256, selected_at: submission.selected_at };
    },

    async mvp_manual_final_lock({ p_event, p_team, p_actor }) {
      const event = selectOne(store, 'manual_final_events', (row) => row.id === p_event);
      if (!event) return fail('event_not_found');
      if (event.status !== 'intake') return fail('event_not_open');
      if (!selectOne(store, 'manual_final_teams', (row) => row.event_id === p_event && row.team_id === p_team)) {
        return fail('not_in_event');
      }
      const locked = selectOne(store, 'manual_final_submissions',
        (row) => row.event_id === p_event && row.team_id === p_team && row.locked_at);
      if (locked) {
        return { ok: true, already_locked: true, submission_id: locked.id, sha256: locked.sha256,
          locked_at: locked.locked_at };
      }
      const selected = selectOne(store, 'manual_final_submissions',
        (row) => row.event_id === p_event && row.team_id === p_team && row.selected_at);
      if (!selected) return fail('not_selected');
      if (selected.status !== 'valid') return fail('submission_not_valid');
      selected.locked_at = new Date().toISOString();
      selected.locked_by = p_actor;
      logAction(store, { eventId: p_event, entity: 'submission', entityId: selected.id,
        action: 'lock', actor: p_actor, detail: { team_id: p_team, sha256: selected.sha256 } });
      return { ok: true, already_locked: false, submission_id: selected.id, sha256: selected.sha256,
        locked_at: selected.locked_at };
    },
  };
  addPairRpc(store.__rpc, store);
  addJobRpc(store.__rpc, store);
  return store.__rpc;
}


function addPairRpc(rpc, store) {
  rpc.mvp_manual_final_pair = async ({ p_payload, p_actor }) => {
    const event = selectOne(store, 'manual_final_events', (row) => row.id === p_payload.eventId);
    if (!event) return fail('event_not_found');
    const existing = selectOne(store, 'manual_final_matches',
      (row) => row.event_id === event.id && row.idempotency_key === p_payload.idempotencyKey);
    if (existing) {
      return { ok: true, idempotent: true, match_id: existing.id, status: existing.status,
        snapshot_hash: existing.snapshot_hash };
    }
    if (event.status !== 'locked') return fail('event_not_locked');
    const lockedFor = (teamId) => selectOne(store, 'manual_final_submissions',
      (row) => row.event_id === event.id && row.team_id === teamId && row.locked_at && row.status === 'valid');
    const red = lockedFor(p_payload.redTeamId);
    if (!red) return fail('red_submission_not_locked');
    const blue = lockedFor(p_payload.blueTeamId);
    if (!blue) return fail('blue_submission_not_locked');
    if (!p_payload.snapshot || p_payload.snapshot.mapHash !== event.map_hash
      || JSON.stringify(clone(p_payload.snapshot.map)) !== JSON.stringify(clone(event.map_json))) {
      return fail('snapshot_mismatch');
    }
    const match = {
      id: randomUUID(),
      event_id: event.id,
      round_no: event.round_no,
      series_id: p_payload.seriesId,
      game_no: p_payload.gameNo,
      red_team_id: red.team_id,
      blue_team_id: blue.team_id,
      red_submission_id: red.id,
      blue_submission_id: blue.id,
      map_hash: event.map_hash,
      seed: p_payload.seed,
      snapshot_hash: p_payload.snapshotHash,
      snapshot_json: p_payload.snapshot,
      status: 'queued',
      result: null,
      reason: null,
      ply_count: null,
      replay_json: null,
      requested_by: p_actor,
      requested_at: new Date().toISOString(),
      rerun_of: p_payload.rerunOf || null,
      idempotency_key: p_payload.idempotencyKey,
    };
    table(store, 'manual_final_matches').push(match);
    const job = {
      id: randomUUID(),
      event_id: event.id,
      round_no: event.round_no,
      kind: 'match',
      submission_id: null,
      match_id: match.id,
      input_hash: match.snapshot_hash,
      status: 'queued',
      attempt: 0,
      generation: 0,
      max_attempts: 3,
      lease_token: null,
      lease_until: null,
      available_at: new Date(Date.now() - 1000).toISOString(),
      created_at: new Date().toISOString(),
    };
    table(store, 'manual_final_jobs').push(job);
    logAction(store, { eventId: event.id, entity: 'match', entityId: match.id, action: 'pair',
      actor: p_actor, reason: p_payload.note || null,
      detail: { series_id: match.series_id, game_no: match.game_no, snapshot_hash: match.snapshot_hash } });
    return { ok: true, idempotent: false, match_id: match.id, job_id: job.id, status: match.status,
      snapshot_hash: match.snapshot_hash };
  };
  rpc.mvp_manual_final_cancel = async ({ p_match, p_actor, p_reason }) => {
    if (!p_reason || p_reason.trim().length < 5) return fail('reason_required');
    const match = selectOne(store, 'manual_final_matches', (row) => row.id === p_match);
    if (!match) return fail('match_not_found');
    if (match.status === 'finished') return fail('result_conflict');
    if (match.status === 'canceled') {
      return { ok: true, already_canceled: true, match_id: match.id, status: match.status };
    }
    const previous = match.status;
    match.status = 'canceled';
    match.canceled_at = new Date().toISOString();
    match.canceled_by = p_actor;
    match.cancel_reason = p_reason.trim();
    for (const job of table(store, 'manual_final_jobs')) {
      if (job.match_id === match.id && ['queued', 'running'].includes(job.status)) {
        job.status = 'canceled';
        job.error_code = 'match_canceled';
      }
    }
    logAction(store, { eventId: match.event_id, entity: 'match', entityId: match.id, action: 'cancel',
      actor: p_actor, reason: match.cancel_reason,
      detail: { previous_status: previous, snapshot_hash: match.snapshot_hash } });
    return { ok: true, already_canceled: false, match_id: match.id, status: match.status,
      previous_status: previous };
  };
}


function addJobRpc(rpc, store) {
  const jobs = () => table(store, 'manual_final_jobs');
  const findJob = (id) => jobs().find((job) => job.id === id) || null;

  rpc.mvp_manual_final_claim = async ({ p_worker, p_limit, p_lease_seconds }) => {
    if (typeof p_worker !== 'string' || !p_worker.trim()) return fail('bad_worker');
    const now = Date.now();
    for (const job of jobs()) {
      if (job.status === 'running' && job.lease_until && Date.parse(job.lease_until) <= now) {
        job.status = 'queued';
        job.lease_token = null;
      }
    }
    const limit = Math.min(Math.max(Number(p_limit) || 1, 1), 5);
    const leaseMs = Math.min(Math.max(Number(p_lease_seconds) || 120, 10), 900) * 1000;
    const claimed = jobs()
      .filter((job) => job.status === 'queued'
        && Date.parse(job.available_at || '1970-01-01T00:00:00.000Z') <= now)
      .slice(0, limit);
    const out = claimed.map((job) => {
      job.status = 'running';
      job.lease_token = randomUUID();
      job.lease_until = new Date(now + leaseMs).toISOString();
      job.generation = Number(job.generation || 0) + 1;
      job.attempt = Number(job.attempt || 0) + 1;
      job.max_attempts = Number(job.max_attempts || 3);
      job.worker_id = p_worker.trim();
      if (job.match_id) {
        const match = selectOne(store, 'manual_final_matches', (row) => row.id === job.match_id);
        if (match && match.status === 'queued') match.status = 'running';
      }
      const submission = job.submission_id
        ? selectOne(store, 'manual_final_submissions', (row) => row.id === job.submission_id) : null;
      const match = job.match_id
        ? selectOne(store, 'manual_final_matches', (row) => row.id === job.match_id) : null;
      return {
        job_id: job.id,
        kind: job.kind,
        event_id: job.event_id,
        round_no: job.round_no,
        submission_id: job.submission_id,
        match_id: job.match_id,
        input_hash: job.input_hash,
        token: job.lease_token,
        generation: job.generation,
        attempt: job.attempt,
        submission: submission ? {
          id: submission.id, team_id: submission.team_id, storage_path: submission.storage_path,
          sha256: submission.sha256, byte_size: submission.byte_size,
        } : null,
        match: match ? {
          id: match.id, series_id: match.series_id, game_no: match.game_no,
          red_team_id: match.red_team_id, blue_team_id: match.blue_team_id,
          red_submission_id: match.red_submission_id, blue_submission_id: match.blue_submission_id,
          map_hash: match.map_hash, seed: match.seed, snapshot_hash: match.snapshot_hash,
          snapshot: match.snapshot_json,
        } : null,
      };
    });
    return { ok: true, jobs: out };
  };

  const fenced = (job, token, generation) => {
    if (!job) return fail('job_not_found');
    if (job.lease_token !== token || Number(job.generation) !== Number(generation)) return fail('lease_lost');
    return null;
  };
  addFinishRpc(rpc, store, findJob, fenced);
  addReleaseRpc(rpc, store, findJob, fenced);
}


function addFinishRpc(rpc, store, findJob, fenced) {
  rpc.mvp_manual_final_finish = async ({ p_job, p_token, p_generation, p_outcome }) => {
    const job = findJob(p_job);
    if (!job) return fail('job_not_found');
    if (['completed', 'bot_fault', 'infra_fault'].includes(job.status)) {
      const match = job.match_id ? selectOne(store, 'manual_final_matches', (row) => row.id === job.match_id) : null;
      const submission = job.submission_id
        ? selectOne(store, 'manual_final_submissions', (row) => row.id === job.submission_id) : null;
      return { ok: true, applied: false, already_finished: true, job_status: job.status,
        match_id: job.match_id || null, match_status: match?.status || null,
        submission_id: job.submission_id || null, submission_status: submission?.status || null };
    }
    const rejected = fenced(job, p_token, p_generation);
    if (rejected) return rejected;
    if (job.status === 'canceled') return fail('job_canceled');
    const status = p_outcome?.status;
    if (job.kind === 'validate') {
      if (!['valid', 'invalid', 'infrastructure'].includes(status)) return fail('bad_outcome');
      const submission = selectOne(store, 'manual_final_submissions', (row) => row.id === job.submission_id);
      if (status === 'valid' && p_outcome.source_hash !== submission.sha256) return fail('source_hash_mismatch');
      submission.status = status;
      submission.error_code = status === 'valid' ? null : (p_outcome.error || 'bot_validation_failed');
      submission.error_message = status === 'valid' ? null : (p_outcome.message || null);
      job.status = status === 'valid' ? 'completed' : status === 'invalid' ? 'bot_fault' : 'infra_fault';
      job.lease_token = null;
      job.lease_until = null;
      job.finished_at = new Date().toISOString();
      return { ok: true, applied: true, already_finished: false, job_status: job.status,
        submission_id: submission.id, submission_status: submission.status };
    }
    const match = selectOne(store, 'manual_final_matches', (row) => row.id === job.match_id);
    if (status === 'finished') {
      if (!['red_win', 'blue_win', 'draw'].includes(p_outcome.result) || !p_outcome.replay) return fail('bad_outcome');
      match.status = 'finished';
      match.result = p_outcome.result;
      match.reason = p_outcome.reason || null;
      match.ply_count = p_outcome.ply_count;
      match.replay_json = JSON.stringify(p_outcome.replay);
      match.finished_at = new Date().toISOString();
      job.status = 'completed';
    } else if (['bot_fault', 'infra_fault'].includes(status)) {
      match.status = status;
      match.error_code = p_outcome.error || status;
      match.error_message = p_outcome.message || null;
      job.status = status;
    } else {
      return fail('bad_outcome');
    }
    job.lease_token = null;
    job.lease_until = null;
    job.finished_at = new Date().toISOString();
    return { ok: true, applied: true, already_finished: false, job_status: job.status,
      match_id: match.id, match_status: match.status, result: match.result || null,
      ply_count: match.ply_count ?? null, snapshot_hash: match.snapshot_hash };
  };
}


function addReleaseRpc(rpc, store, findJob, fenced) {
  rpc.mvp_manual_final_release = async ({ p_job, p_token, p_generation, p_error, p_max_attempts }) => {
    const job = findJob(p_job);
    const rejected = fenced(job, p_token, p_generation);
    if (rejected) return rejected;
    if (!['queued', 'running'].includes(job.status)) return fail('job_not_running');
    const max = Math.min(Math.max(Number(p_max_attempts) || 3, 1), 10);
    const message = p_error || 'manual_final_infrastructure';
    if (Number(job.attempt) >= max || Number(job.attempt) >= Number(job.max_attempts)) {
      job.status = 'infra_fault';
      job.error_code = message;
      job.lease_token = null;
      const match = job.match_id
        ? selectOne(store, 'manual_final_matches', (row) => row.id === job.match_id) : null;
      if (match) {
        match.status = 'infra_fault';
        match.error_code = message;
      }
      return { ok: true, applied: true, status: 'infra_fault', attempt: job.attempt,
        match_status: match?.status || null };
    }
    job.status = 'queued';
    job.lease_token = null;
    job.lease_until = null;
    job.error_code = message;
    job.available_at = new Date(Date.now() + Math.min(300, 15 * Math.max(Number(job.attempt), 1)) * 1000).toISOString();
    const match = job.match_id
      ? selectOne(store, 'manual_final_matches', (row) => row.id === job.match_id) : null;
    if (match && ['queued', 'running'].includes(match.status)) match.status = 'queued';
    return { ok: true, applied: true, status: 'queued', attempt: job.attempt, available_at: job.available_at };
  };
}

export { addJobRpc };

export default { installManualFinalRpc };
