/**
 * githubIntake.js — Dịch vụ intake bài qua GitHub cho runtime shared (H1).
 *
 * - API KHÔNG clone, KHÔNG tải source, KHÔNG chạy git/Python: chỉ resolve repository ID +
 *   commit SHA, rồi ghi job/receipt trong transaction SQL (cutoff/freeze/membership/quota/
 *   idempotency do `mvp_github_intake` quyết định bằng clock DB).
 * - Receipt trả ra là whitelist: không storage path, không token, không raw lỗi GitHub.
 * - Worker (H2) sẽ claim job, tải đúng blob `bot.py` tại SHA, kiểm tra và cập nhật receipt.
 */

import { rows, rpc, uuid } from '../shared/client.js';
import { HttpError } from '../lib/httpError.js';
import config from '../config.js';
import { BOT_FILE_PATH, parseBranch, parseRepository, resolveIntakeTarget } from './githubRepo.js';

/** Trạng thái receipt hiển thị cho UI (khớp fixtures `githubSyncState.js` của Bảo). */
export const RECEIPT_STATUSES = Object.freeze(['resolving', 'fetching', 'checking', 'valid', 'invalid', 'infrastructure', 'frozen']);
/** Trạng thái nội bộ của job cho worker (không công khai lease token). */
export const JOB_STATUSES = Object.freeze(['queued', 'leased', 'running', 'completed', 'bot_fault', 'infra_fault', 'canceled']);
export const SOURCE_KIND = 'github';
const FROZEN_NOTE = 'Hạn cutoff đã qua hoặc giải đã bắt đầu; bài nộp được đóng băng.';

const fail = (status, code, message) => new HttpError(status, code, message);

const RPC_ERRORS = {
  event_not_found: () => fail(404, 'tournament_not_found', 'Không tìm thấy giải.'),
  event_frozen: () => fail(409, 'event_frozen', 'Giải đã bắt đầu hoặc đã khóa; không nhận bài mới.'),
  past_cutoff: () => fail(409, 'past_cutoff', 'Đã quá hạn nộp bài của giải.'),
  not_in_event: () => fail(403, 'scope_denied', 'Đội không thuộc giải này.'),
  repo_not_approved: () => fail(403, 'repo_not_approved', 'Repository chưa được BTC duyệt.'),
  repository_not_registered: () => fail(409, 'repository_not_registered', 'Đội chưa đăng ký repository cho giải này.'),
  repo_taken: () => fail(409, 'repo_taken', 'Repository đã được đội khác dùng trong giải này.'),
  repository_changed: () => fail(409, 'repository_changed', 'Repository/branch đã đổi; cần BTC duyệt lại.'),
  quota_exceeded: () => fail(429, 'quota_exceeded', 'Đã hết hạn mức kiểm tra commit mới trong 24 giờ.'),
  bad_request: () => fail(400, 'bad_intake', 'Yêu cầu intake không hợp lệ.'),
};

/** Map mã lỗi envelope của RPC thành HTTP error (không lộ chi tiết SQL). */
export function intakeError(code) {
  const build = RPC_ERRORS[code];
  return build ? build() : fail(503, 'shared_db_error', 'Thao tác DB chung thất bại.');
}

/** Receipt whitelist cho đội/admin. */
export function receiptView(row, eventStatus = 'draft') {
  if (!row) return null;
  const frozen = eventStatus && eventStatus !== 'draft';
  const base = {
    id: row.id,
    event_id: row.event_id,
    team_id: row.team_id,
    repo_id: Number(row.repo_id),
    repository: row.repository,
    branch: row.branch,
    commit_sha: row.commit_sha,
    resolved_at: row.resolved_at,
    status: frozen ? 'frozen' : row.status,
    source_kind: SOURCE_KIND,
    file_path: row.file_path,
    source_hash: row.source_hash || null,
    error: row.error || null,
    error_category: row.error_category || null,
    submission_id: row.submission_id || null,
    previous_valid_submission_id: row.previous_valid_submission_id || null,
    job_id: row.job_id || null,
  };
  return frozen ? { ...base, previous_status: row.status, note: FROZEN_NOTE } : base;
}

/** Job view: không trả `lease_token`/`requested_by`. */
export function jobView(row) {
  if (!row) return null;
  return {
    id: row.id,
    event_id: row.event_id,
    team_id: row.team_id,
    status: row.status,
    attempt: Number(row.attempt || 0),
    available_at: row.available_at || null,
    error: row.error || null,
    error_category: row.error_category || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  };
}

/** Connection (repo đội đã đăng ký/duyệt). */
export function connectionView(row) {
  if (!row) return null;
  return {
    id: row.id,
    event_id: row.event_id,
    team_id: row.team_id,
    repo_id: Number(row.repo_id),
    repository: row.repository,
    branch: row.branch,
    file_path: row.file_path,
    approved: row.approved === true,
    status: row.approved === true ? 'approved' : 'pending_approval',
    updated_at: row.updated_at || null,
  };
}


/** Đội được thao tác: team chỉ chính mình; admin phải chỉ định `team`. */
export function scopeTeam(account, requested) {
  const own = account?.participant_id || null;
  if (account?.role === 'admin') {
    if (!requested) throw fail(400, 'missing_team', 'Admin phải chỉ định team.');
    return uuid(requested);
  }
  if (!own) throw fail(403, 'scope_denied', 'Tài khoản không gắn với đội.');
  if (requested && requested !== own) throw fail(403, 'scope_denied', 'Không thao tác thay đội khác.');
  return uuid(own);
}

async function loadEvent(eventId) {
  const [event] = await rows('tournaments', `id=eq.${uuid(eventId)}&select=id,status`);
  if (!event) throw fail(404, 'tournament_not_found', 'Không tìm thấy giải.');
  return event;
}

/** H2: đội chỉ đọc dữ liệu của giải mình tham gia (admin bỏ qua). */
async function requireEventMember(eventId, account) {
  if (account?.role === 'admin') return;
  if (!account?.participant_id) throw fail(403, 'scope_denied', 'Cần tài khoản đội thuộc giải.');
  const [entry] = await rows(
    'tournament_entries',
    `tournament_id=eq.${uuid(eventId)}&participant_id=eq.${uuid(account.participant_id)}&select=id`
  );
  if (!entry) throw fail(403, 'scope_denied', 'Đội không thuộc giải này.');
}

/** Đăng ký repository cho đội; chỉ admin mới set `approved = true`. */
export async function putConnection({ eventId, teamId, repository, branch, account }) {
  const event = await loadEvent(eventId);
  await requireEventMember(eventId, account);
  if (event.status !== 'draft') throw fail(409, 'event_frozen', 'Giải đã bắt đầu hoặc đã khóa; không đổi repository.');
  const target = await resolveIntakeTarget({ repository, branch: branch || 'main' });
  const result = await rpc('mvp_repo_connection_upsert', {
    p_event: uuid(eventId),
    p_team: uuid(teamId),
    p_repository: target.repository,
    p_repo_id: target.repoId,
    p_branch: target.branch,
    p_file_path: BOT_FILE_PATH,
    p_approved: account?.role === 'admin',
    p_actor: account?.id || null,
  });
  if (!result?.ok) throw intakeError(result?.error);
  return { connection: connectionView(result.connection) };
}

export async function getConnection({ eventId, teamId, account }) {
  await loadEvent(eventId);
  await requireEventMember(eventId, account);
  const [connection] = await rows('repo_connections', `event_id=eq.${uuid(eventId)}&team_id=eq.${uuid(teamId)}`);
  return { connection: connectionView(connection) };
}

/** Admin thu hồi duyệt repo: hủy job đang chờ, đóng băng receipt chưa kết thúc. */
export async function revokeConnection({ eventId, teamId, account }) {
  const result = await rpc('mvp_repo_connection_revoke', {
    p_event: uuid(eventId),
    p_team: uuid(teamId),
    p_actor: account?.id || null,
  });
  if (!result?.ok) throw intakeError(result?.error);
  return { connection: connectionView(result.connection), canceled_jobs: Number(result.canceled_jobs || 0) };
}

/** Số job intake chưa kết thúc của giải (start phải đợi freeze xong). */
export async function pendingJobCount(eventId) {
  const pending = await rows(
    'repo_sync_jobs',
    `event_id=eq.${uuid(eventId)}&status=in.(queued,leased,running)&select=id`
  );
  return pending.length;
}


/** Danh sách repo của giải cho BTC duyệt (admin-only route). */
export async function listConnections({ eventId }) {
  await loadEvent(eventId);
  const [connections, teams] = await Promise.all([
    rows('repo_connections', `event_id=eq.${uuid(eventId)}&order=created_at,id`),
    rows('participants'),
  ]);
  const names = new Map(teams.map((team) => [team.id, team.name]));
  return {
    connections: connections.map((row) => ({ ...connectionView(row), team_name: names.get(row.team_id) || null })),
  };
}

/**
 * Yêu cầu đồng bộ: resolve repo ID + HEAD SHA (một lần, không tải source),
 * sau đó để RPC kiểm cutoff/freeze/membership/quota/idempotency bằng clock DB.
 */
export async function requestSubmission({ eventId, teamId, repository, branch, account }) {
  const event = await loadEvent(eventId);
  await requireEventMember(eventId, account);
  if (event.status !== 'draft') throw fail(409, 'event_frozen', 'Giải đã bắt đầu hoặc đã khóa; không nhận bài mới.');
  const [connection] = await rows('repo_connections', `event_id=eq.${uuid(eventId)}&team_id=eq.${uuid(teamId)}`);
  if (!connection) throw fail(409, 'repository_not_registered', 'Đội chưa đăng ký repository cho giải này.');
  if (connection.approved !== true) throw fail(403, 'repo_not_approved', 'Repository chưa được BTC duyệt.');

  const wantedRepository = repository ? parseRepository(repository).repository : connection.repository;
  const wantedBranch = branch ? parseBranch(branch) : connection.branch;
  if (wantedRepository !== connection.repository || wantedBranch !== connection.branch) {
    throw fail(409, 'repository_changed', 'Repository/branch không khớp bản đã duyệt; cần BTC duyệt lại.');
  }

  const target = await resolveIntakeTarget({ repository: connection.repository, branch: connection.branch });
  if (target.repoId !== Number(connection.repo_id)) {
    throw fail(409, 'repository_changed', 'Repository đã đổi ID (đổi tên/chuyển nhượng); cần BTC duyệt lại.');
  }

  const result = await rpc('mvp_github_intake', {
    p_event: uuid(eventId),
    p_team: uuid(teamId),
    p_account: account?.id || null,
    p_repository: connection.repository,
    p_branch: connection.branch,
    p_file_path: BOT_FILE_PATH,
    p_repo_id: Number(connection.repo_id),
    p_commit_sha: target.commitSha,
    p_daily_quota: config.github.dailyQuota,
  });
  if (!result?.ok) throw intakeError(result?.error);
  return {
    created: result.created === true,
    receipt: receiptView(result.receipt, event.status),
    job: jobView(result.job),
  };
}

/** Job + receipt cho owner hoặc admin; không trả lease token. */
export async function getJob({ jobId, account }) {
  const [job] = await rows('repo_sync_jobs', `id=eq.${uuid(jobId)}`);
  if (!job) throw fail(404, 'job_not_found', 'Không tìm thấy job đồng bộ.');
  if (account?.role !== 'admin' && job.team_id !== account?.participant_id) {
    throw fail(403, 'scope_denied', 'Không xem được job của đội khác.');
  }
  const [receipt] = await rows('github_receipts', `job_id=eq.${job.id}`);
  const event = await loadEvent(job.event_id);
  return { job: jobView(job), receipt: receiptView(receipt, event.status) };
}

/** Trạng thái mới nhất cho UI khi mở trang (connection + receipt gần nhất). */
export async function getLatest({ eventId, teamId, account }) {
  const event = await loadEvent(eventId);
  await requireEventMember(eventId, account);
  const [connectionRows, receiptRows] = await Promise.all([
    rows('repo_connections', `event_id=eq.${uuid(eventId)}&team_id=eq.${uuid(teamId)}`),
    rows('github_receipts', `event_id=eq.${uuid(eventId)}&team_id=eq.${uuid(teamId)}&order=created_at.desc&limit=1`),
  ]);
  return {
    event: { id: event.id, status: event.status },
    connection: connectionView(connectionRows[0]),
    receipt: receiptView(receiptRows[0], event.status),
  };
}
