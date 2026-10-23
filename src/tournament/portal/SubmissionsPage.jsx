import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { campusBotDownload } from './campusBotDownload.js';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Download,
  GitBranch,
  Github,
  Lock,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  UploadCloud,
} from 'lucide-react';
import { Alert, Badge, DataTable, Field, Panel, Spinner } from './TournamentUi.jsx';
import {
  botState,
  formatDateTime,
  shortSha,
  submissionFreeze,
  submissionState,
  teamBotState,
  validateRepository,
} from './tournamentView.js';
import {
  formatCommitSha,
  formatReceipt,
  humanizeIntakeError,
  syncStatusInfo,
} from './githubSyncState.js';
import {
  fetchLatestGithubSubmission,
  fetchRepositoryConnection,
  fetchRepoSyncJob,
  requestGithubSubmission,
  revokeRepositoryConnection,
  saveRepositoryConnection,
} from './githubApi.js';

const MAX_BYTES = 256 * 1024;

export default function SubmissionsPage({
  account,
  events = [],
  teams = [],
  submissions = [],
  teamFilter = '',
  onSelectTeam,
  actions,
  busy,
}) {
  const isAdmin = account.role === 'admin';
  const formRef = useRef(null);
  const pollTimerRef = useRef(null);

  // Selected event (default to first active event or first event)
  const [selectedEventId, setSelectedEventId] = useState(() => {
    const active = events.find((e) => e.status !== 'finished');
    return active ? active.id : events[0]?.id || '';
  });

  // Keep selectedEventId valid if events list changes
  useEffect(() => {
    if (!selectedEventId && events.length > 0) {
      const active = events.find((e) => e.status !== 'finished');
      setSelectedEventId(active ? active.id : events[0].id);
    }
  }, [events, selectedEventId]);

  const selectedEvent = useMemo(
    () => events.find((e) => e.id === selectedEventId) || null,
    [events, selectedEventId]
  );

  const selectedTeam = useMemo(
    () => teams.find((team) => team.id === teamFilter) || null,
    [teams, teamFilter]
  );

  const targetId = isAdmin ? teamFilter : account.participant_id;

  // Local state for GitHub Intake
  const [connection, setConnection] = useState(null);
  const [connectionLoading, setConnectionLoading] = useState(false);
  const [repoInput, setRepoInput] = useState('');
  const [branchInput, setBranchInput] = useState('main');
  const [repoError, setRepoError] = useState('');
  const [receipt, setReceipt] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [syncNotice, setSyncNotice] = useState(null);
  const [offlineUploadError, setOfflineUploadError] = useState('');

  const frozen = submissionFreeze(events);
  const isEventFrozen = selectedEvent && selectedEvent.status !== 'draft';
  const bot = botState(submissions);

  // Load connection and latest receipt whenever selectedEvent or targetId changes
  const loadGithubStatus = useCallback(async () => {
    if (!selectedEventId || !targetId) {
      setConnection(null);
      setReceipt(null);
      return;
    }
    setConnectionLoading(true);
    setSyncNotice(null);
    try {
      const conn = await fetchRepositoryConnection(selectedEventId, isAdmin ? targetId : null);
      setConnection(conn);
      if (conn?.repository) {
        setRepoInput(conn.repository);
        setBranchInput(conn.branch || 'main');
      } else if (!isAdmin && account.repository) {
        setRepoInput(account.repository);
        setBranchInput(account.branch || 'main');
      }

      const latest = await fetchLatestGithubSubmission(selectedEventId, isAdmin ? targetId : null);
      if (latest?.receipt) {
        setReceipt(formatReceipt(latest.receipt));
      } else {
        setReceipt(null);
      }
    } catch {
      // Fallback silently if offline or endpoint not reachable
      setConnection(null);
      setReceipt(null);
    } finally {
      setConnectionLoading(false);
    }
  }, [selectedEventId, targetId, isAdmin, account.repository, account.branch]);

  useEffect(() => {
    loadGithubStatus();
    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, [loadGithubStatus]);

  // Handle repository registration or update
  async function handleSaveRepository(e) {
    e.preventDefault();
    setRepoError('');
    setSyncNotice(null);
    const repoTrimmed = repoInput.trim();
    const branchTrimmed = branchInput.trim() || 'main';

    const err = validateRepository(repoTrimmed);
    if (err) {
      setRepoError(err);
      return;
    }

    try {
      const updated = await saveRepositoryConnection(selectedEventId, {
        repository: repoTrimmed,
        branch: branchTrimmed,
        team: isAdmin ? targetId : null,
      });
      setConnection(updated);
      setSyncNotice({
        tone: updated?.approved ? 'success' : 'warning',
        message: updated?.approved
          ? 'Đã cập nhật repository và được phê duyệt.'
          : 'Đã gửi đăng ký repository. Repository đang chờ BTC phê duyệt quyền truy cập.',
      });
    } catch (error) {
      setRepoError(humanizeIntakeError(error.code, error.message));
    }
  }

  // Admin approves repository connection
  async function handleApproveRepository() {
    if (!connection || !targetId || !selectedEventId) return;
    setSyncNotice(null);
    try {
      const updated = await saveRepositoryConnection(selectedEventId, {
        repository: connection.repository,
        branch: connection.branch,
        team: targetId,
      });
      setConnection(updated);
      setSyncNotice({ tone: 'success', message: 'Đã phê duyệt quyền repository cho đội.' });
    } catch (error) {
      setSyncNotice({ tone: 'danger', message: humanizeIntakeError(error.code, error.message) });
    }
  }

  // Admin revokes repository approval
  async function handleRevokeRepository() {
    if (!targetId || !selectedEventId) return;
    if (typeof window !== 'undefined' && window.confirm && !window.confirm('Bạn có chắc chắn muốn thu hồi phê duyệt repository này? Mọi tác vụ đồng bộ đang chờ sẽ bị hủy.')) {
      return;
    }
    setSyncNotice(null);
    try {
      const revoked = await revokeRepositoryConnection(selectedEventId, targetId);
      setConnection(revoked);
      setSyncNotice({ tone: 'warning', message: 'Đã thu hồi phê duyệt repository của đội.' });
      const latest = await fetchLatestGithubSubmission(selectedEventId, isAdmin ? targetId : null);
      if (latest?.receipt) {
        setReceipt(formatReceipt(latest.receipt));
      }
    } catch (error) {
      setSyncNotice({ tone: 'danger', message: humanizeIntakeError(error.code, error.message) });
    }
  }

  // Request GitHub sync & poll job status
  async function handleRequestSync() {
    if (!selectedEventId || !targetId) return;
    setSyncing(true);
    setSyncNotice(null);

    try {
      const res = await requestGithubSubmission(selectedEventId, {
        team: isAdmin ? targetId : null,
      });

      if (res?.receipt) {
        const formatted = formatReceipt(res.receipt);
        setReceipt(formatted);
      }

      const jobId = res?.job?.id;
      if (jobId && ['resolving', 'fetching', 'checking'].includes(res?.receipt?.status)) {
        pollJob(jobId);
      } else {
        setSyncing(false);
      }
    } catch (error) {
      setSyncing(false);
      setSyncNotice({
        tone: 'danger',
        message: humanizeIntakeError(error.code, error.message),
      });
    }
  }

  function pollJob(jobId) {
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    pollTimerRef.current = setTimeout(async () => {
      try {
        const jobData = await fetchRepoSyncJob(jobId);
        if (jobData?.receipt) {
          const updatedReceipt = formatReceipt(jobData.receipt);
          setReceipt(updatedReceipt);

          if (['resolving', 'fetching', 'checking'].includes(updatedReceipt.status)) {
            pollJob(jobId);
            return;
          }
        }
      } catch {
        // Polling error: will terminate polling
      }
      setSyncing(false);
      actions.refresh();
    }, 2500);
  }

  // Offline direct file upload fallback for Admin / Giám thị
  async function handleOfflineUpload(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const file = form.elements.file?.files?.[0];
    if (!file) {
      setOfflineUploadError('Chọn một file .py trước khi nộp.');
      return;
    }
    if (!/\.py$/i.test(file.name)) {
      setOfflineUploadError('Chỉ nhận đúng một file Python (.py).');
      return;
    }
    if (file.size > MAX_BYTES) {
      setOfflineUploadError(`File ${Math.ceil(file.size / 1024)} KiB vượt giới hạn ${MAX_BYTES / 1024} KiB.`);
      return;
    }
    setOfflineUploadError('');
    const ok = await actions.uploadBot(targetId, file);
    if (ok) form.reset();
  }

  const receiptStatus = receipt ? syncStatusInfo(receipt.status) : null;
  const isApproved = connection?.approved === true;
  const canSync = isApproved && !isEventFrozen && (!frozen || isAdmin) && Boolean(targetId);

  return (
    <>
      <header className="tt-page-head">
        <div>
          <p className="tt-eyebrow">{isAdmin ? 'Ban tổ chức · nhận bài & duyệt repo' : 'Đội thi · nộp bài GitHub'}</p>
          <h1 className="tt-page-title">{isAdmin ? 'Quản lý bài nộp & đồng bộ GitHub' : 'Bot & đồng bộ GitHub'}</h1>
          <p className="tt-page-lead">
            Chế độ nộp bài chính thức: Đội đăng ký repository GitHub và branch; BTC duyệt quyền; server ghi nhận
            commit SHA và kiểm tra tự động. Không yêu cầu upload mã nguồn thủ công qua web.
          </p>
        </div>
        <a className="tt-btn" href={campusBotDownload} download="bot.py">
          <Download size={16} aria-hidden="true" />
          Tải bot mẫu
        </a>
      </header>

      {/* Warning if tournament is running/frozen */}
      {isEventFrozen && (
        <Alert tone="warning" title={`Bài nộp đang khóa · ${selectedEvent.name}`}>
          Giải đấu đã bắt đầu hoặc quá hạn nộp bài. Bài nộp của các đội tham gia đã được đóng băng cho giải này.
        </Alert>
      )}

      {/* Admin: Select Team Filter */}
      {isAdmin && (
        <Panel
          title="Chọn đội cần thao tác"
          subtitle="Admin có thể xem trạng thái repo, duyệt quyền truy cập và đồng bộ bài thay cho đội."
          actions={selectedTeam ? <Badge tone={teamBotState(selectedTeam).tone}>{teamBotState(selectedTeam).label}</Badge> : null}
        >
          <Field label="Đội thi đấu">
            <select value={teamFilter} onChange={(e) => onSelectTeam(e.target.value)}>
              <option value="">— Chọn đội thi đấu —</option>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                  {team.latest_valid_submission_id ? ' (đã có bot hợp lệ)' : ' (chưa có bot hợp lệ)'}
                </option>
              ))}
            </select>
          </Field>
          {!selectedTeam && <p className="tt-muted">Vui lòng chọn một đội để kiểm tra hoặc phê duyệt repository.</p>}
        </Panel>
      )}

      {/* Event Selection if multiple events exist */}
      {events.length > 1 && (
        <Panel title="Giải đấu áp dụng" subtitle="Bài nộp và quyền repository được quản lý riêng theo từng giải đấu.">
          <Field label="Giải đấu">
            <select value={selectedEventId} onChange={(e) => setSelectedEventId(e.target.value)}>
              {events.map((ev) => (
                <option key={ev.id} value={ev.id}>
                  {ev.name} ({ev.status === 'draft' ? 'Đang mở nộp' : 'Đã khóa/đang chạy'})
                </option>
              ))}
            </select>
          </Field>
        </Panel>
      )}

      {/* Status Highlights */}
      <section className="tt-stats" aria-label="Trạng thái bài nộp">
        <div className={`tt-stat tt-stat--${bot.hasValid ? 'success' : 'warning'}`}>
          <span className="tt-stat__label">Bot hợp lệ</span>
          <strong className="tt-stat__value">{bot.hasValid ? 'Có' : 'Chưa'}</strong>
          <span className="tt-stat__hint">{bot.validCount} bản vượt kiểm tra</span>
        </div>
        <div className="tt-stat">
          <span className="tt-stat__label">Repository GitHub</span>
          <strong className="tt-stat__value tt-stat__value--small">
            {connection ? (isApproved ? 'Đã duyệt' : 'Chờ duyệt') : 'Chưa liên kết'}
          </strong>
          <span className="tt-stat__hint">{connection ? connection.branch || 'main' : 'Chưa đăng ký'}</span>
        </div>
        <div className="tt-stat">
          <span className="tt-stat__label">Commit mới nhất</span>
          <strong className="tt-stat__value tt-stat__value--small">
            {receipt?.shortSha ? receipt.shortSha : '—'}
          </strong>
          <span className="tt-stat__hint">{receipt?.statusMeta?.label || 'Chưa đồng bộ'}</span>
        </div>
      </section>

      {/* Main GitHub Intake Section */}
      <div className="tt-grid tt-grid--2 tt-grid--form">
        {/* Panel 1: Repository Connection & Sync CTA */}
        <Panel
          title="Kết nối GitHub & Đồng bộ"
          subtitle="Khai báo repository công khai trên github.com và nhánh chứa file bot.py."
          actions={
            connection ? (
              <Badge tone={isApproved ? 'success' : 'warning'}>
                {isApproved ? 'Đã duyệt' : 'Chờ BTC duyệt'}
              </Badge>
            ) : null
          }
        >
          {connectionLoading ? (
            <Spinner label="Đang kiểm tra trạng thái kết nối GitHub…" />
          ) : (
            <>
              {syncNotice && <Alert tone={syncNotice.tone}>{syncNotice.message}</Alert>}

              <form className="tt-form" onSubmit={handleSaveRepository}>
                <Field
                  label="URL Repository GitHub"
                  hint="Chỉ nhận repository HTTPS dạng https://github.com/owner/repo."
                  error={repoError}
                >
                  <input
                    type="url"
                    value={repoInput}
                    disabled={isEventFrozen || syncing}
                    onChange={(e) => {
                      setRepoInput(e.target.value);
                      setRepoError('');
                    }}
                    placeholder="https://github.com/team/ootv2-bot"
                    required
                  />
                </Field>

                <Field label="Nhánh (Branch)" hint="Nhánh chứa file bot.py (mặc định: main).">
                  <input
                    type="text"
                    value={branchInput}
                    disabled={isEventFrozen || syncing}
                    onChange={(e) => setBranchInput(e.target.value)}
                    placeholder="main"
                    required
                  />
                </Field>

                <div className="tt-form__actions">
                  <button
                    type="submit"
                    className="tt-btn"
                    disabled={isEventFrozen || syncing || !targetId}
                  >
                    <Github size={16} aria-hidden="true" />
                    Lưu & Đăng ký repository
                  </button>

                  {/* Admin Approve Button */}
                  {isAdmin && connection && !connection.approved && (
                    <button
                      type="button"
                      className="tt-btn tt-btn--success"
                      onClick={handleApproveRepository}
                      disabled={syncing}
                    >
                      <ShieldCheck size={16} aria-hidden="true" />
                      Phê duyệt repository này
                    </button>
                  )}

                  {/* Admin Revoke Button */}
                  {isAdmin && connection && connection.approved && (
                    <button
                      type="button"
                      className="tt-btn tt-btn--danger"
                      onClick={handleRevokeRepository}
                      disabled={syncing}
                    >
                      <ShieldAlert size={16} aria-hidden="true" />
                      Thu hồi phê duyệt
                    </button>
                  )}
                </div>
              </form>

              {/* Sync Action & Receipt Status */}
              <div style={{ marginTop: '1.5rem', paddingTop: '1.25rem', borderTop: '1px solid var(--tt-border, #e2e8f0)' }}>
                <h4>Đồng bộ commit mới</h4>
                <p className="tt-muted" style={{ fontSize: '0.9rem', marginBottom: '1rem' }}>
                  Hệ thống sẽ lấy commit SHA mới nhất trên nhánh đã duyệt, kiểm tra kích thước, UTF-8 và chạy smoke test.
                </p>

                <div className="tt-form__actions" style={{ marginBottom: '1rem' }}>
                  <button
                    type="button"
                    className="tt-btn tt-btn--primary"
                    onClick={handleRequestSync}
                    disabled={!canSync || syncing}
                  >
                    {syncing ? <RefreshCw size={16} className="tt-spin" aria-hidden="true" /> : <GitBranch size={16} aria-hidden="true" />}
                    {syncing ? 'Đang kiểm tra bot…' : 'Đồng bộ commit mới từ GitHub'}
                  </button>

                  {!isApproved && connection && (
                    <span className="tt-muted" style={{ fontSize: '0.85rem' }}>
                      Cần BTC phê duyệt repository trước khi đồng bộ.
                    </span>
                  )}
                  {isEventFrozen && (
                    <span className="tt-muted" style={{ fontSize: '0.85rem' }}>
                      Giải đấu đã đóng nộp bài.
                    </span>
                  )}
                </div>

                {/* Receipt Card Display */}
                {receipt && (
                  <div
                    className="tt-receipt-card"
                    style={{
                      background: 'var(--tt-bg-subtle, #f8fafc)',
                      padding: '1rem',
                      borderRadius: '8px',
                      border: '1px solid var(--tt-border, #e2e8f0)',
                      marginTop: '1rem',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                      <strong>Biên nhận đồng bộ (Receipt)</strong>
                      <Badge tone={receiptStatus.tone}>{receiptStatus.label}</Badge>
                    </div>

                    <dl className="tt-deflist" style={{ margin: 0, fontSize: '0.9rem' }}>
                      <div>
                        <dt>Commit SHA</dt>
                        <dd>
                          <code title={receipt.commitSha}>{receipt.shortSha}</code>{' '}
                          <span className="tt-muted" style={{ fontSize: '0.8rem' }}>({receipt.commitSha})</span>
                        </dd>
                      </div>
                      <div>
                        <dt>Nhánh / File</dt>
                        <dd><code>{receipt.branch}</code> / <code>{receipt.filePath}</code></dd>
                      </div>
                      <div>
                        <dt>Thời điểm</dt>
                        <dd>{formatDateTime(receipt.resolvedAt)}</dd>
                      </div>
                      {receipt.sourceHash && (
                        <div>
                          <dt>Hash mã nguồn</dt>
                          <dd><code>{shortSha(receipt.sourceHash)}</code></dd>
                        </div>
                      )}
                    </dl>

                    <div style={{ marginTop: '0.75rem' }}>
                      {receipt.status === 'valid' && (
                        <Alert tone="success" title="Bot hợp lệ">
                          {receiptStatus.summary}
                        </Alert>
                      )}
                      {receipt.status === 'invalid' && (
                        <Alert tone="danger" title="Bot không hợp lệ (Lỗi mã nguồn)">
                          {receipt.error || receiptStatus.summary}
                          <p style={{ marginTop: '0.35rem', fontSize: '0.85rem' }}>
                            Đội vui lòng sửa mã nguồn trên GitHub và bấm <strong>Đồng bộ commit mới</strong> để nộp lại.
                          </p>
                        </Alert>
                      )}
                      {receipt.status === 'infrastructure' && (
                        <Alert tone="danger" title="Sự cố kết nối / Hạ tầng">
                          {receipt.error || receiptStatus.summary}
                          <p style={{ marginTop: '0.35rem', fontSize: '0.85rem' }}>
                            Đây là sự cố mạng hoặc giới hạn GitHub. Bản bot hợp lệ trước đó vẫn được bảo toàn.
                          </p>
                        </Alert>
                      )}
                      {['resolving', 'fetching', 'checking'].includes(receipt.status) && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--tt-text-muted)' }}>
                          <Spinner label={receiptStatus.summary} />
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </Panel>

        {/* Panel 2: Quy định kỹ thuật & Fallback Offline cho Admin */}
        <div className="tt-stack">
          <Panel title="Quy định nộp bài GitHub" subtitle="Điều lệ giải Campus và hướng dẫn triển khai.">
            <ul className="tt-bullets">
              <li>Mỗi đội liên kết <strong>1 repository GitHub</strong> duy nhất cho mỗi giải đấu.</li>
              <li>Repository cần để chế độ <strong>Public</strong> (hoặc cấu hình quyền cho ứng dụng BTC).</li>
              <li>Mã nguồn bot phải đặt tại đường dẫn gốc: <code>bot.py</code>.</li>
              <li><strong>Python 3.12+</strong>, chỉ sử dụng thư viện chuẩn; không hỗ trợ cài package ngoài.</li>
              <li>Giới hạn file: tối đa <strong>256 KiB</strong>, mã hóa UTF-8 chuẩn.</li>
              <li>Mỗi commit SHA mới được tính vào hạn mức quota kiểm tra trong 24 giờ.</li>
            </ul>
          </Panel>

          {/* Admin Offline USB Fallback Upload */}
          {isAdmin && (
            <Panel
              title="Nộp file trực tiếp (Giám thị / Offline)"
              subtitle="Chế độ dự phòng khi thi đấu tập trung tại phòng máy hoặc mất kết nối Internet; nhận file bot.py qua USB."
            >
              <form className="tt-form" ref={formRef} onSubmit={handleOfflineUpload}>
                <Field
                  label="File bot (.py) từ USB"
                  hint={`Dành cho giám thị nộp hộ đội ${selectedTeam ? selectedTeam.name : '(chưa chọn)'}. Tối đa 256 KiB.`}
                >
                  <input
                    type="file"
                    name="file"
                    accept=".py"
                    required
                    disabled={!targetId || busy?.upload}
                  />
                </Field>
                {offlineUploadError && <Alert tone="danger">{offlineUploadError}</Alert>}
                <div className="tt-form__actions">
                  <button
                    type="submit"
                    className="tt-btn"
                    disabled={!targetId || busy?.upload}
                  >
                    <UploadCloud size={16} aria-hidden="true" />
                    {busy?.upload ? 'Đang nộp…' : 'Nộp file USB'}
                  </button>
                  {!targetId && <span className="tt-muted">Chọn một đội ở trên trước khi nộp file.</span>}
                </div>
              </form>
            </Panel>
          )}
        </div>
      </div>

      {/* Panel: History of Submissions */}
      <Panel
        title="Lịch sử các phiên bản bot"
        subtitle={selectedTeam ? selectedTeam.name : isAdmin ? 'Chọn đội để xem lịch sử' : 'Bài nộp của đội bạn'}
        actions={<Badge tone="neutral">{bot.total} bản</Badge>}
      >
        {bot.total ? (
          <DataTable columns={['Thời điểm', 'SHA-256', 'Trạng thái', 'Ghi chú / Lỗi']} label="Lịch sử bài nộp">
            {submissions.map((row) => {
              const state = submissionState(row.status);
              return (
                <tr key={row.id}>
                  <td>{formatDateTime(row.created_at)}</td>
                  <td><code>{shortSha(row.sha256)}</code></td>
                  <td><Badge tone={state.tone}>{state.label}</Badge></td>
                  <td className="tt-cell-wrap">{row.validation_error || <span className="tt-muted">—</span>}</td>
                </tr>
              );
            })}
          </DataTable>
        ) : (
          <p className="tt-muted">
            {isAdmin && !teamFilter
              ? 'Chọn một đội ở danh sách phía trên để xem lịch sử bài nộp.'
              : 'Chưa có bản bot nào được ghi nhận. Hãy liên kết repository GitHub và bấm Đồng bộ commit mới.'}
          </p>
        )}
      </Panel>
    </>
  );
}
