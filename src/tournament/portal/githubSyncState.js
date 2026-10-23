/**
 * githubSyncState.js — DTO helpers and fixtures for official tournament GitHub intake.
 * Conforms to Huy's intake contract in docs/16 and docs/assignments/Huy.md.
 * Pure functions only — testable via node --test without DOM dependencies.
 */

export const GITHUB_SYNC_STATUSES = Object.freeze([
  'resolving',
  'fetching',
  'checking',
  'valid',
  'invalid',
  'infrastructure',
  'frozen',
]);

export const SYNC_STATUS_METADATA = Object.freeze({
  resolving: Object.freeze({
    label: 'Đang xác thực GitHub',
    tone: 'warning',
    inProgress: true,
    summary: 'API đang kiểm tra quyền truy cập repository, xác định ID số và lấy commit SHA mới nhất trên nhánh.',
  }),
  fetching: Object.freeze({
    label: 'Đang tải mã nguồn bot',
    tone: 'warning',
    inProgress: true,
    summary: 'Worker đang tải file bot.py tại commit SHA đã xác thực từ GitHub.',
  }),
  checking: Object.freeze({
    label: 'Đang kiểm tra bot',
    tone: 'warning',
    inProgress: true,
    summary: 'Worker đang kiểm tra giới hạn kích thước (tối đa 256 KiB), UTF-8 và chạy smoke test Python.',
  }),
  valid: Object.freeze({
    label: 'Bot hợp lệ',
    tone: 'success',
    isValid: true,
    summary: 'Bot đã vượt qua các bài kiểm tra và sẵn sàng làm ứng viên thi đấu cho vòng đấu.',
  }),
  invalid: Object.freeze({
    label: 'Bot không hợp lệ',
    tone: 'danger',
    isError: true,
    errorCategory: 'code',
    summary: 'Bot vi phạm quy tắc: lỗi cú pháp Python, timeout, chạy quá giới hạn hoặc trả nước đi sai luật.',
  }),
  infrastructure: Object.freeze({
    label: 'Sự cố kết nối / hạ tầng',
    tone: 'danger',
    isError: true,
    errorCategory: 'infrastructure',
    summary: 'Lỗi kết nối GitHub, mạng hoặc worker BTC. Bản bot hợp lệ trước đó (nếu có) được giữ nguyên.',
  }),
  frozen: Object.freeze({
    label: 'Đã khóa bài nộp',
    tone: 'neutral',
    isFrozen: true,
    summary: 'Thời hạn cutoff đã qua hoặc giải đấu đã bắt đầu; bài nộp không thể cập nhật.',
  }),
});

/**
 * Returns formatted status info for a GitHub sync status code.
 */
export function syncStatusInfo(status) {
  if (!status || typeof status !== 'string') {
    return {
      label: 'Chưa nộp bot',
      tone: 'neutral',
      inProgress: false,
      isValid: false,
      isError: false,
      isFrozen: false,
      summary: 'Đội chưa đăng ký repository GitHub hoặc chưa gửi yêu cầu đồng bộ.',
    };
  }
  const meta = SYNC_STATUS_METADATA[status];
  if (meta) return { ...meta };
  return {
    label: status,
    tone: 'neutral',
    inProgress: false,
    isValid: false,
    isError: false,
    isFrozen: false,
    summary: `Trạng thái: ${status}`,
  };
}

/**
 * Formats a full commit SHA to a 7-character short SHA.
 */
export function formatCommitSha(sha, length = 7) {
  if (!sha || typeof sha !== 'string') return '—';
  return sha.trim().slice(0, length);
}

/**
 * Standardises a GitHub submission receipt DTO.
 */
export function formatReceipt(receipt) {
  if (!receipt || typeof receipt !== 'object') return null;
  const status = receipt.status || 'unknown';
  const statusMeta = syncStatusInfo(status);
  const commitSha = typeof receipt.commit_sha === 'string' ? receipt.commit_sha : '';
  return {
    id: receipt.id || '',
    eventId: receipt.event_id || '',
    teamId: receipt.team_id || '',
    repoId: receipt.repo_id || null,
    repository: receipt.repository || '',
    branch: receipt.branch || 'main',
    commitSha,
    shortSha: formatCommitSha(commitSha),
    resolvedAt: receipt.resolved_at || null,
    status,
    statusMeta,
    error: receipt.error || '',
    errorCategory: receipt.error_category || statusMeta.errorCategory || null,
    sourceKind: receipt.source_kind || 'github',
    filePath: receipt.file_path || 'bot.py',
    sourceHash: receipt.source_hash || null,
    note: receipt.note || '',
  };
}

/**
 * Canonical test fixtures covering all 7 official states from Huy's DTO specification.
 */
export const GITHUB_SYNC_FIXTURES = Object.freeze({
  resolving: Object.freeze({
    id: 'rcpt_res_001',
    event_id: 'ev_campus_week_01',
    team_id: '10000000-0000-4000-8000-000000000001',
    repo_id: 987654321,
    repository: 'https://github.com/team-alpha/ootv2-bot',
    branch: 'main',
    commit_sha: 'd3b07384d113edec49eaa6238ad5ff0012345678',
    resolved_at: '2026-10-24T00:15:00.000Z',
    status: 'resolving',
    source_kind: 'github',
    file_path: 'bot.py',
  }),
  fetching: Object.freeze({
    id: 'rcpt_fetch_002',
    event_id: 'ev_campus_week_01',
    team_id: '10000000-0000-4000-8000-000000000002',
    repo_id: 987654322,
    repository: 'https://github.com/team-beta/ootv2-bot',
    branch: 'main',
    commit_sha: 'e4c18495e224fefd50fbb7349be6001123456789',
    resolved_at: '2026-10-24T00:14:00.000Z',
    status: 'fetching',
    source_kind: 'github',
    file_path: 'bot.py',
  }),
  checking: Object.freeze({
    id: 'rcpt_chk_003',
    event_id: 'ev_campus_week_01',
    team_id: '10000000-0000-4000-8000-000000000003',
    repo_id: 987654323,
    repository: 'https://github.com/team-gamma/ootv2-bot',
    branch: 'dev',
    commit_sha: 'f5d29506f335000e610cc8450cf711223456789a',
    resolved_at: '2026-10-24T00:13:00.000Z',
    status: 'checking',
    source_kind: 'github',
    file_path: 'bot.py',
  }),
  valid: Object.freeze({
    id: 'rcpt_val_004',
    event_id: 'ev_campus_week_01',
    team_id: '10000000-0000-4000-8000-000000000004',
    repo_id: 987654324,
    repository: 'https://github.com/team-delta/ootv2-bot',
    branch: 'main',
    commit_sha: 'a1b2c3d4e5f60718293a4b5c6d7e8f901234567b',
    resolved_at: '2026-10-24T00:10:00.000Z',
    status: 'valid',
    source_kind: 'github',
    file_path: 'bot.py',
    source_hash: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
  }),
  invalid: Object.freeze({
    id: 'rcpt_inv_005',
    event_id: 'ev_campus_week_01',
    team_id: '10000000-0000-4000-8000-000000000005',
    repo_id: 987654325,
    repository: 'https://github.com/team-epsilon/ootv2-bot',
    branch: 'main',
    commit_sha: 'b2c3d4e5f6a718293a4b5c6d7e8f90123456789c',
    resolved_at: '2026-10-24T00:08:00.000Z',
    status: 'invalid',
    source_kind: 'github',
    file_path: 'bot.py',
    error: 'SyntaxError: invalid syntax in bot.py at line 42',
    error_category: 'code',
  }),
  infrastructure: Object.freeze({
    id: 'rcpt_inf_006',
    event_id: 'ev_campus_week_01',
    team_id: '10000000-0000-4000-8000-000000000006',
    repo_id: 987654326,
    repository: 'https://github.com/team-zeta/ootv2-bot',
    branch: 'main',
    commit_sha: 'c3d4e5f6a7b8293a4b5c6d7e8f9012345678901d',
    resolved_at: '2026-10-24T00:05:00.000Z',
    status: 'infrastructure',
    source_kind: 'github',
    file_path: 'bot.py',
    error: 'GitHub API rate limit exceeded. Retry later.',
    error_category: 'infrastructure',
    previous_valid_submission_id: 'sub_prev_valid_001',
  }),
  frozen: Object.freeze({
    id: 'rcpt_frz_007',
    event_id: 'ev_campus_week_01',
    team_id: '10000000-0000-4000-8000-000000000007',
    repo_id: 987654327,
    repository: 'https://github.com/team-eta/ootv2-bot',
    branch: 'main',
    commit_sha: 'd4e5f6a7b8c93a4b5c6d7e8f901234567890123e',
    resolved_at: '2026-10-23T23:59:00.000Z',
    status: 'frozen',
    source_kind: 'github',
    file_path: 'bot.py',
    note: 'Hạn cutoff đã qua; bài nộp được đóng băng cho vòng đấu.',
  }),
});

export default {
  GITHUB_SYNC_STATUSES,
  SYNC_STATUS_METADATA,
  syncStatusInfo,
  formatCommitSha,
  formatReceipt,
  GITHUB_SYNC_FIXTURES,
};

