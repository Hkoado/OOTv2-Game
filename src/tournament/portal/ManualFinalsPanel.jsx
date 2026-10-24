import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Award,
  CheckCircle2,
  Clock,
  Eye,
  FileCode2,
  Lock,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Swords,
  Trash2,
  UploadCloud,
  XCircle,
} from 'lucide-react';
import { Alert, Badge, ConfirmAction, DataTable, Field, Panel, Spinner } from './TournamentUi.jsx';
import { SAMPLE_MAPS } from '../../game/sampleMaps.js';
import { formatDateTime, formatDuration, reasonLabel } from './tournamentView.js';
import {
  cancelManualMatch,
  closeManualEvent,
  createManualEvent,
  createManualMatch,
  fetchManualEventDetail,
  fetchManualEvents,
  fetchManualMatchReplay,
  lockManualTeam,
  rerunManualMatch,
  selectManualSubmission,
  updateManualEventStatus,
  uploadManualSubmission,
} from './manualFinalApi.js';

const MAX_BYTES = 256 * 1024; // 256 KiB
const POLL_MS = 3000;

const LEVEL_NAMES = {
  weekly: 'Giải Tuần',
  monthly: 'Giải Tháng',
  semester: 'Giải Kỳ',
};

const STATUS_LABELS = {
  draft: 'Bản nháp (Draft)',
  intake: 'Đang nhận bài (Intake)',
  locked: 'Đã khóa bài (Locked)',
  closed: 'Đã đóng giải (Closed)',
};

const MATCH_STATUS_LABELS = {
  queued: 'Chờ worker',
  running: 'Đang chấm…',
  finished: 'Hoàn tất',
  bot_fault: 'Lỗi bot (Xử thua)',
  infra_fault: 'Lỗi hạ tầng',
  canceled: 'Đã hủy',
};

export default function ManualFinalsPanel({ event, teams, actions, busy, admin, onOpenReplay, onOpenReplayPayload }) {
  const [eventsList, setEventsList] = useState([]);
  const [selectedEventId, setSelectedEventId] = useState('');
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionBusy, setActionBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [noticeMsg, setNoticeMsg] = useState('');

  // Form tạo đợt mới
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newLevel, setNewLevel] = useState('weekly');
  const [newRoundNo, setNewRoundNo] = useState(1);
  const [newMapIndex, setNewMapIndex] = useState(0);

  // Nạp bot theo đội
  const [uploadTeamId, setUploadTeamId] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);

  // Ghép cặp trận
  const [redTeamId, setRedTeamId] = useState('');
  const [blueTeamId, setBlueTeamId] = useState('');
  const [seriesId, setSeriesId] = useState('FINAL');
  const [gameNo, setGameNo] = useState(1);
  const [matchNote, setMatchNote] = useState('');

  // Modal Hủy / Rerun có audit reason
  const [auditDialog, setAuditDialog] = useState(null); // { type: 'cancel' | 'rerun', matchId }
  const [auditReason, setAuditReason] = useState('');

  // Tải danh sách đợt
  const loadEventsList = useCallback(async () => {
    try {
      const data = await fetchManualEvents();
      const list = Array.isArray(data.events) ? data.events : [];
      setEventsList(list);
      if (list.length > 0 && !selectedEventId) {
        setSelectedEventId(list[0].id);
      }
    } catch (err) {
      setErrorMsg(err.message || 'Không tải được danh sách đợt chung kết.');
    }
  }, [selectedEventId]);

  // Tải chi tiết đợt đang chọn
  const loadDetail = useCallback(async (eventId, { silent = false } = {}) => {
    if (!eventId) {
      setDetail(null);
      setLoading(false);
      return;
    }
    if (!silent) setLoading(true);
    try {
      const data = await fetchManualEventDetail(eventId);
      setDetail(data);
      setErrorMsg('');
    } catch (err) {
      setErrorMsg(err.message || 'Không tải được chi tiết đợt chung kết.');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadEventsList();
  }, [loadEventsList]);

  useEffect(() => {
    if (selectedEventId) {
      loadDetail(selectedEventId);
    }
  }, [selectedEventId, loadDetail]);

  // Polling cập nhật tiến trình ván đấu khi đang chấm
  useEffect(() => {
    if (!selectedEventId || !detail) return undefined;
    const hasActiveMatches = detail.matches?.some((m) => m.status === 'queued' || m.status === 'running');
    if (!hasActiveMatches) return undefined;

    const timer = setInterval(() => {
      loadDetail(selectedEventId, { silent: true });
    }, POLL_MS);

    return () => clearInterval(timer);
  }, [selectedEventId, detail, loadDetail]);

  if (!admin) {
    return (
      <Alert tone="warning" title="Quyền truy cập bị từ chối">
        Mục Chung kết thủ công chỉ dành riêng cho Ban tổ chức (Admin).
      </Alert>
    );
  }

  // Tạo đợt mới
  async function handleCreateEvent(e) {
    e.preventDefault();
    if (!newName.trim()) {
      setErrorMsg('Vui lòng nhập tên đợt chung kết.');
      return;
    }
    const teamIds = (Array.isArray(teams) ? teams : []).map((t) => t.id);
    if (teamIds.length < 2) {
      setErrorMsg('Cần ít nhất 2 đội trong hệ thống để tạo đợt chung kết.');
      return;
    }

    setActionBusy(true);
    setErrorMsg('');
    try {
      const mapObj = SAMPLE_MAPS[newMapIndex]?.map || SAMPLE_MAPS[0].map;
      const created = await createManualEvent({
        name: newName.trim(),
        level: newLevel,
        roundNo: Number(newRoundNo) || 1,
        teamIds,
        map: mapObj,
      });

      setShowCreateModal(false);
      setNewName('');
      setNoticeMsg(`Đã tạo thành công đợt "${created.name}".`);
      await loadEventsList();
      setSelectedEventId(created.id);
    } catch (err) {
      setErrorMsg(err.message || 'Tạo đợt thất bại.');
    } finally {
      setActionBusy(false);
    }
  }

  // Đổi trạng thái đợt
  async function handleStatusChange(targetStatus) {
    if (!selectedEventId) return;
    setActionBusy(true);
    setErrorMsg('');
    try {
      await updateManualEventStatus(selectedEventId, targetStatus);
      setNoticeMsg(`Đã chuyển trạng thái đợt sang "${STATUS_LABELS[targetStatus] || targetStatus}".`);
      await loadDetail(selectedEventId);
      await loadEventsList();
    } catch (err) {
      setErrorMsg(err.message || 'Chuyển trạng thái thất bại.');
    } finally {
      setActionBusy(false);
    }
  }

  // Nạp file bot cho đội
  async function handleUploadBot(e) {
    e.preventDefault();
    if (!uploadTeamId) {
      setErrorMsg('Vui lòng chọn đội cần nạp file.');
      return;
    }
    if (!selectedFile) {
      setErrorMsg('Vui lòng chọn một file bot (.py).');
      return;
    }
    if (!/\.py$/i.test(selectedFile.name)) {
      setErrorMsg('Chỉ chấp nhận file định dạng Python (.py).');
      return;
    }
    if (selectedFile.size > MAX_BYTES) {
      setErrorMsg(`Dung lượng file (${Math.ceil(selectedFile.size / 1024)} KiB) vượt giới hạn 256 KiB.`);
      return;
    }

    setActionBusy(true);
    setErrorMsg('');
    try {
      const res = await uploadManualSubmission(selectedEventId, {
        teamId: uploadTeamId,
        file: selectedFile,
      });
      setSelectedFile(null);
      const fileInput = document.getElementById('manual-file-input');
      if (fileInput) fileInput.value = '';

      setNoticeMsg(res.duplicate ? 'File bot trùng lặp với bản nạp trước đó.' : 'Đã nạp file bot thành công.');
      await loadDetail(selectedEventId);
    } catch (err) {
      setErrorMsg(err.message || 'Nạp file thất bại.');
    } finally {
      setActionBusy(false);
    }
  }

  // Chọn phiên bản bài nộp
  async function handleSelectSubmission(submissionId) {
    setActionBusy(true);
    setErrorMsg('');
    try {
      await selectManualSubmission(selectedEventId, submissionId);
      setNoticeMsg('Đã chọn phiên bản làm bài nộp chính thức.');
      await loadDetail(selectedEventId);
    } catch (err) {
      setErrorMsg(err.message || 'Chọn phiên bản thất bại.');
    } finally {
      setActionBusy(false);
    }
  }

  // Khóa bài nộp của đội
  async function handleLockTeam(teamId) {
    setActionBusy(true);
    setErrorMsg('');
    try {
      await lockManualTeam(selectedEventId, teamId);
      setNoticeMsg('Đã khóa bài thi đấu của đội thành công.');
      await loadDetail(selectedEventId);
    } catch (err) {
      setErrorMsg(err.message || 'Khóa bài nộp thất bại.');
    } finally {
      setActionBusy(false);
    }
  }

  // Yêu cầu ghép cặp và chấm trận
  async function handleCreateMatch(e) {
    e.preventDefault();
    if (!redTeamId || !blueTeamId) {
      setErrorMsg('Vui lòng chọn đủ cả 2 đội Đỏ và Xanh.');
      return;
    }
    if (redTeamId === blueTeamId) {
      setErrorMsg('Đội Đỏ và Đội Xanh không được trùng nhau.');
      return;
    }

    setActionBusy(true);
    setErrorMsg('');
    try {
      await createManualMatch(selectedEventId, {
        redTeamId,
        blueTeamId,
        seriesId: seriesId.trim() || 'MATCH',
        gameNo: Number(gameNo) || 1,
        note: matchNote.trim() || null,
      });

      setNoticeMsg('Đã tạo trận đấu và gửi yêu cầu chấm vào hàng đợi Worker.');
      await loadDetail(selectedEventId);
    } catch (err) {
      setErrorMsg(err.message || 'Tạo trận đấu thất bại.');
    } finally {
      setActionBusy(false);
    }
  }

  // Mở Replay ván đấu
  async function handleOpenReplay(matchId) {
    try {
      const data = await fetchManualMatchReplay(selectedEventId, matchId);
      if (data && data.replay) {
        if (onOpenReplayPayload) {
          onOpenReplayPayload(data);
        } else if (onOpenReplay) {
          onOpenReplay(data);
        }
      } else {
        alert('Ván đấu chưa có dữ liệu Replay.');
      }
    } catch (err) {
      alert(err.message || 'Không tải được Replay.');
    }
  }

  // Xác nhận Hủy hoặc Rerun có audit reason
  async function handleAuditAction() {
    if (!auditDialog || !auditReason.trim() || auditReason.trim().length < 5) {
      alert('Vui lòng nhập lý do giải trình ít nhất 5 ký tự.');
      return;
    }

    setActionBusy(true);
    setErrorMsg('');
    try {
      if (auditDialog.type === 'cancel') {
        await cancelManualMatch(selectedEventId, auditDialog.matchId, auditReason.trim());
        setNoticeMsg('Đã hủy trận đấu thành công.');
      } else {
        await rerunManualMatch(selectedEventId, auditDialog.matchId, auditReason.trim());
        setNoticeMsg('Đã đưa trận đấu vào hàng đợi chấm lại.');
      }
      setAuditDialog(null);
      setAuditReason('');
      await loadDetail(selectedEventId);
    } catch (err) {
      setErrorMsg(err.message || 'Thao tác thất bại.');
    } finally {
      setActionBusy(false);
    }
  }

  const currentEvent = detail?.event || null;
  const submissionsList = detail?.submissions || [];
  const matchesList = detail?.matches || [];
  const readiness = detail?.readiness || null;
  const auditList = detail?.audit || [];

  return (
    <div className="tt-stack" style={{ gap: '1.5rem' }}>
      {/* Cảnh báo hạ tầng */}
      <Alert tone="info" title="Chung kết thủ công tại phòng thi (BTC-Only API)">
        Giao diện điều hành chung kết thủ công đã kết nối trực tiếp với backend <code>/api/local/manual-finals</code>.
        Mọi thao tác nạp file, chọn bài, khóa snapshot và yêu cầu chấm đều được kiểm toán và thực thi qua Worker.
        <br />
        <span style={{ fontSize: '0.85em', opacity: 0.9 }}>
          * Yêu cầu kết nối API và máy chấm Worker; không hoạt động khi mất kết nối máy chủ.
        </span>
      </Alert>

      {errorMsg && <Alert tone="danger" title="Lỗi thao tác">{errorMsg}</Alert>}
      {noticeMsg && <Alert tone="success" title="Thông báo">{noticeMsg}</Alert>}

      {/* Thanh chọn đợt hoặc tạo đợt mới */}
      <Panel
        title="Quản lý đợt Chung kết thủ công"
        subtitle="Chọn đợt thi đấu hiện tại hoặc tạo đợt mới với map Campus v2."
        actions={
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <button
              type="button"
              className="tt-btn tt-btn--sm"
              onClick={() => setShowCreateModal(true)}
              disabled={actionBusy}
            >
              <Plus size={14} aria-hidden="true" />
              Tạo đợt mới
            </button>
            <button
              type="button"
              className="tt-btn tt-btn--ghost tt-btn--sm"
              onClick={() => {
                loadEventsList();
                if (selectedEventId) loadDetail(selectedEventId);
              }}
              disabled={loading || actionBusy}
            >
              <RefreshCw size={14} aria-hidden="true" />
            </button>
          </div>
        }
      >
        {eventsList.length > 0 ? (
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <Field label="Chọn đợt chung kết">
              <select
                value={selectedEventId}
                onChange={(e) => setSelectedEventId(e.target.value)}
                disabled={actionBusy}
              >
                {eventsList.map((ev) => (
                  <option key={ev.id} value={ev.id}>
                    {ev.name} ({ev.level_label || ev.level} · Vòng {ev.round_no}) — [{STATUS_LABELS[ev.status] || ev.status}]
                  </option>
                ))}
              </select>
            </Field>

            {currentEvent && (
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '1rem' }}>
                <Badge tone={currentEvent.status === 'locked' ? 'success' : currentEvent.status === 'intake' ? 'live' : 'neutral'}>
                  {STATUS_LABELS[currentEvent.status] || currentEvent.status}
                </Badge>

                {currentEvent.status === 'draft' && (
                  <button
                    type="button"
                    className="tt-btn tt-btn--primary tt-btn--sm"
                    onClick={() => handleStatusChange('intake')}
                    disabled={actionBusy}
                  >
                    Mở nhận bài (Open Intake)
                  </button>
                )}

                {currentEvent.status === 'intake' && (
                  <button
                    type="button"
                    className="tt-btn tt-btn--primary tt-btn--sm"
                    onClick={() => handleStatusChange('locked')}
                    disabled={actionBusy || (readiness && !readiness.can_lock_round)}
                    title={readiness && !readiness.can_lock_round ? 'Khóa tất cả các đội trước khi khóa vòng' : ''}
                  >
                    Khóa toàn đợt (Lock Round)
                  </button>
                )}

                {currentEvent.status === 'locked' && (
                  <button
                    type="button"
                    className="tt-btn tt-btn--ghost tt-btn--sm"
                    onClick={() => {
                      if (window.confirm('Bạn có chắc muốn đóng đợt chung kết này?')) {
                        handleStatusChange('closed');
                      }
                    }}
                    disabled={actionBusy}
                  >
                    Đóng giải (Close)
                  </button>
                )}
              </div>
            )}
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '1.5rem' }}>
            <p className="tt-muted">Chưa có đợt chung kết thủ công nào được tạo.</p>
            <button
              type="button"
              className="tt-btn tt-btn--primary"
              onClick={() => setShowCreateModal(true)}
            >
              <Plus size={16} aria-hidden="true" />
              Tạo đợt Chung kết đầu tiên
            </button>
          </div>
        )}
      </Panel>

      {loading && <Spinner label="Đang tải dữ liệu đợt chung kết…" />}

      {currentEvent && !loading && (
        <>
          {/* Thông tin đợt & Readiness */}
          <Panel
            title={`Chi tiết: ${currentEvent.name}`}
            subtitle={`Map: ${currentEvent.map?.name || 'Campus v2'} · Seed: ${currentEvent.seed} · Runtime: ${currentEvent.runtime?.runtimeVersion || 'official.v2'}`}
          >
            <div className="tt-grid tt-grid--3" style={{ gap: '1rem', marginBottom: '1rem' }}>
              <div>
                <span className="tt-muted">Cấp giải: </span>
                <strong>{currentEvent.level_label || currentEvent.level}</strong>
              </div>
              <div>
                <span className="tt-muted">Vòng thi đấu: </span>
                <strong>Vòng {currentEvent.round_no}</strong>
              </div>
              <div>
                <span className="tt-muted">Trạng thái: </span>
                <strong>{STATUS_LABELS[currentEvent.status] || currentEvent.status}</strong>
              </div>
            </div>

            {readiness && (
              <div style={{ padding: '0.75rem', background: 'var(--tt-bg-subtle, rgba(0,0,0,0.02))', borderRadius: '4px', fontSize: '0.9em' }}>
                <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
                  <span><strong>Tổng số đội:</strong> {readiness.teams}</span>
                  <span><strong>Đội đã khóa bài:</strong> {readiness.locked_teams}/{readiness.teams}</span>
                  <span><strong>Chờ thẩm định:</strong> {readiness.pending_validations}</span>
                  <span><strong>Trận đã xong:</strong> {readiness.matches?.finished ?? 0}</span>
                </div>
                {readiness.blockers && readiness.blockers.length > 0 && (
                  <div style={{ marginTop: '0.5rem', color: 'var(--tt-color-danger, #ef4444)' }}>
                    <strong>Điều kiện chưa sẵn sàng: </strong>
                    {readiness.blockers.join('; ')}
                  </div>
                )}
              </div>
            )}
          </Panel>

          {/* 1. Nạp file bot cho đội & Khóa bài */}
          <Panel
            title="1. Nạp file Bot (.py) & Khóa bài theo đội"
            subtitle="BTC tiếp nhận file từ thí sinh tại phòng thi và nạp trực tiếp qua form multipart."
          >
            {currentEvent.status === 'intake' ? (
              <form onSubmit={handleUploadBot} className="tt-form" style={{ marginBottom: '1.5rem' }}>
                <div className="tt-grid tt-grid--2" style={{ gap: '1rem' }}>
                  <Field label="Chọn đội nhận file">
                    <select
                      value={uploadTeamId}
                      onChange={(e) => setUploadTeamId(e.target.value)}
                      disabled={actionBusy}
                      required
                    >
                      <option value="">-- Chọn đội --</option>
                      {(detail.teams || []).map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                  </Field>

                  <Field label="File bot.py (Tối đa 256 KiB)">
                    <input
                      id="manual-file-input"
                      type="file"
                      accept=".py"
                      onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                      disabled={actionBusy}
                      required
                    />
                  </Field>
                </div>

                <div className="tt-form__actions" style={{ marginTop: '0.75rem' }}>
                  <button
                    type="submit"
                    className="tt-btn tt-btn--primary"
                    disabled={actionBusy || !uploadTeamId || !selectedFile}
                  >
                    <UploadCloud size={16} aria-hidden="true" />
                    {actionBusy ? 'Đang nạp…' : 'Nạp file bot'}
                  </button>
                </div>
              </form>
            ) : (
              <Alert tone="neutral">
                {currentEvent.status === 'draft'
                  ? 'Đợt đang ở trạng thái Bản nháp. Hãy nhấn "Mở nhận bài (Open Intake)" để bắt đầu nạp file.'
                  : 'Đợt đã khóa nhận bài hoặc đã đóng.'}
              </Alert>
            )}

            {/* Bảng danh sách bài nộp của các đội */}
            <h4>Danh sách bài nộp của các đội ({submissionsList.length} bản ghi)</h4>
            {submissionsList.length > 0 ? (
              <DataTable
                columns={['Đội thi', 'Tên file', 'SHA-256', 'Kích thước', 'Trạng thái', 'Phiên bản chính', 'Khóa bài', 'Thao tác']}
                label="Danh sách bài nộp"
              >
                {submissionsList.map((sub) => {
                  const teamName = detail.teams?.find((t) => t.id === sub.team_id)?.name || sub.team_id;
                  return (
                    <tr key={sub.id}>
                      <td><strong>{teamName}</strong></td>
                      <td><code>{sub.filename}</code></td>
                      <td><code title={sub.sha256}>{sub.sha256?.slice(0, 10)}…</code></td>
                      <td>{Math.round(sub.byte_size / 1024)} KiB</td>
                      <td>
                        <Badge tone={sub.status === 'valid' ? 'success' : sub.status === 'invalid' ? 'danger' : 'neutral'}>
                          {sub.status === 'valid' ? 'Hợp lệ' : sub.status === 'invalid' ? 'Không hợp lệ' : sub.status}
                        </Badge>
                      </td>
                      <td>
                        {sub.selected ? (
                          <Badge tone="accent">Bản chính thức</Badge>
                        ) : (
                          <button
                            type="button"
                            className="tt-btn tt-btn--ghost tt-btn--sm"
                            onClick={() => handleSelectSubmission(sub.id)}
                            disabled={actionBusy || sub.status !== 'valid' || sub.locked || currentEvent.status !== 'intake'}
                          >
                            Chọn bản này
                          </button>
                        )}
                      </td>
                      <td>
                        {sub.locked ? (
                          <Badge tone="success" dot>Đã khóa</Badge>
                        ) : (
                          <button
                            type="button"
                            className="tt-btn tt-btn--ghost tt-btn--sm"
                            onClick={() => handleLockTeam(sub.team_id)}
                            disabled={actionBusy || !sub.selected || sub.status !== 'valid' || currentEvent.status !== 'intake'}
                          >
                            <Lock size={12} aria-hidden="true" />
                            Khóa bài
                          </button>
                        )}
                      </td>
                      <td>
                        <span className="tt-muted">{formatDateTime(sub.received_at)}</span>
                      </td>
                    </tr>
                  );
                })}
              </DataTable>
            ) : (
              <p className="tt-muted">Chưa có bài nộp nào trong đợt này.</p>
            )}
          </Panel>

          {/* 2. Ghép cặp trận đấu & Gửi yêu cầu chấm */}
          <Panel
            title="2. Ghép cặp thi đấu & Yêu cầu chấm trận"
            subtitle="Chọn 2 đội đã khóa bài để tạo trận đấu trong đợt; kết quả do Worker Campus v2 chấm."
          >
            {currentEvent.status === 'locked' || currentEvent.status === 'intake' ? (
              <form onSubmit={handleCreateMatch} className="tt-form" style={{ marginBottom: '1.5rem' }}>
                <div className="tt-grid tt-grid--2" style={{ gap: '1rem' }}>
                  <Field label="Đội Đỏ (Red - Đi trước)">
                    <select
                      value={redTeamId}
                      onChange={(e) => setRedTeamId(e.target.value)}
                      disabled={actionBusy}
                      required
                    >
                      <option value="">-- Chọn đội Đỏ --</option>
                      {(detail.teams || []).map((t) => (
                        <option key={t.id} value={t.id} disabled={t.id === blueTeamId}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </Field>

                  <Field label="Đội Xanh (Blue - Đi sau)">
                    <select
                      value={blueTeamId}
                      onChange={(e) => setBlueTeamId(e.target.value)}
                      disabled={actionBusy}
                      required
                    >
                      <option value="">-- Chọn đội Xanh --</option>
                      {(detail.teams || []).map((t) => (
                        <option key={t.id} value={t.id} disabled={t.id === redTeamId}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </Field>

                  <Field label="Mã cặp / Series ID (Ví dụ: SF1, SF2, FINAL)">
                    <input
                      type="text"
                      value={seriesId}
                      onChange={(e) => setSeriesId(e.target.value)}
                      placeholder="FINAL"
                      disabled={actionBusy}
                      required
                    />
                  </Field>

                  <Field label="Lượt trận (Game No)">
                    <input
                      type="number"
                      min={1}
                      max={10}
                      value={gameNo}
                      onChange={(e) => setGameNo(e.target.value)}
                      disabled={actionBusy}
                      required
                    />
                  </Field>
                </div>

                <Field label="Ghi chú ván đấu (Tùy chọn)">
                  <input
                    type="text"
                    value={matchNote}
                    onChange={(e) => setMatchNote(e.target.value)}
                    placeholder="Ví dụ: Trận chung kết tranh cúp vô địch..."
                    disabled={actionBusy}
                  />
                </Field>

                <div className="tt-form__actions" style={{ marginTop: '0.75rem' }}>
                  <button
                    type="submit"
                    className="tt-btn tt-btn--primary"
                    disabled={actionBusy || !redTeamId || !blueTeamId || redTeamId === blueTeamId}
                  >
                    <Play size={16} aria-hidden="true" />
                    {actionBusy ? 'Đang tạo…' : 'Tạo ván & Gửi yêu cầu chấm'}
                  </button>
                </div>
              </form>
            ) : (
              <Alert tone="neutral">Đợt cần ở trạng thái Intake hoặc Locked để tạo trận đấu.</Alert>
            )}

            {/* Bảng danh sách ván đấu */}
            <h4>Danh sách các ván đấu ({matchesList.length} ván)</h4>
            {matchesList.length > 0 ? (
              <DataTable
                columns={['Series', 'Cặp đấu', 'Trạng thái', 'Kết quả Engine', 'Lý do', 'Số nước', 'Thao tác']}
                label="Danh sách ván đấu chung kết"
              >
                {matchesList.map((m) => (
                  <tr key={m.id}>
                    <td><strong>{m.series_id}</strong> · lượt {m.game_no}</td>
                    <td>
                      <span className="tt-side tt-side--red">{m.red?.name || m.red?.team_id}</span>
                      <span className="tt-cell-sub"> vs </span>
                      <span className="tt-side tt-side--blue">{m.blue?.name || m.blue?.team_id}</span>
                    </td>
                    <td>
                      <Badge tone={m.status === 'finished' ? 'success' : m.status === 'running' ? 'live' : m.status === 'queued' ? 'warning' : 'danger'}>
                        {MATCH_STATUS_LABELS[m.status] || m.status}
                      </Badge>
                    </td>
                    <td>
                      <strong>
                        {m.result === 'red_win' ? 'Đỏ thắng' : m.result === 'blue_win' ? 'Xanh thắng' : m.result === 'draw' ? 'Hòa' : '—'}
                      </strong>
                    </td>
                    <td>{reasonLabel(m.reason) || m.cancel_reason || '—'}</td>
                    <td>{m.ply_count !== null ? `${m.ply_count} plies` : '—'}</td>
                    <td>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        {m.replay_available && (
                          <button
                            type="button"
                            className="tt-btn tt-btn--ghost tt-btn--sm"
                            onClick={() => handleOpenReplay(m.id)}
                          >
                            <Eye size={14} aria-hidden="true" />
                            Replay
                          </button>
                        )}

                        {m.can_cancel && (
                          <button
                            type="button"
                            className="tt-btn tt-btn--ghost tt-btn--sm"
                            onClick={() => setAuditDialog({ type: 'cancel', matchId: m.id })}
                            disabled={actionBusy}
                          >
                            <XCircle size={14} aria-hidden="true" />
                            Hủy
                          </button>
                        )}

                        {m.can_rerun && (
                          <button
                            type="button"
                            className="tt-btn tt-btn--danger tt-btn--ghost tt-btn--sm"
                            onClick={() => setAuditDialog({ type: 'rerun', matchId: m.id })}
                            disabled={actionBusy}
                          >
                            <RotateCcw size={14} aria-hidden="true" />
                            Chấm lại
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </DataTable>
            ) : (
              <p className="tt-muted">Chưa có ván đấu nào được tạo trong đợt này.</p>
            )}
          </Panel>

          {/* 3. Nhật ký kiểm toán (Audit Trail) */}
          <Panel
            title="3. Nhật ký kiểm toán hành động (Audit Log)"
            subtitle="Toàn bộ hành động nạp bài, khóa, hủy và chấm lại đều được ghi nhận phục vụ thẩm định."
          >
            {auditList.length > 0 ? (
              <ul className="tt-log">
                {auditList.map((log) => (
                  <li key={log.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid var(--tt-color-border, #eee)' }}>
                    <span>
                      <strong>[{log.action}]</strong> {log.entity} (<code>{String(log.entity_id || '').slice(0, 8)}…</code>)
                      {log.reason && <span className="tt-muted"> — Lý do: "{log.reason}"</span>}
                    </span>
                    <span className="tt-muted" style={{ fontSize: '0.85em' }}>
                      {formatDateTime(log.created_at)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="tt-muted">Chưa có nhật ký kiểm toán nào.</p>
            )}
          </Panel>
        </>
      )}

      {/* Modal Tạo đợt mới */}
      {showCreateModal && (
        <div className="tt-dialog-backdrop">
          <div className="tt-dialog" style={{ maxWidth: '520px' }}>
            <div className="tt-dialog__head">
              <h2>Tạo đợt Chung kết thủ công mới</h2>
            </div>
            <form onSubmit={handleCreateEvent}>
              <div className="tt-dialog__body">
                <Field label="Tên đợt chung kết">
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Ví dụ: Chung kết Giải Mùa Thu 2026"
                    required
                  />
                </Field>

                <div className="tt-grid tt-grid--2" style={{ gap: '1rem', marginTop: '0.75rem' }}>
                  <Field label="Cấp giải">
                    <select value={newLevel} onChange={(e) => setNewLevel(e.target.value)}>
                      <option value="weekly">Giải Tuần (Weekly)</option>
                      <option value="monthly">Giải Tháng (Monthly)</option>
                      <option value="semester">Giải Kỳ (Semester)</option>
                    </select>
                  </Field>

                  <Field label="Số thứ tự vòng">
                    <input
                      type="number"
                      min={1}
                      max={20}
                      value={newRoundNo}
                      onChange={(e) => setNewRoundNo(e.target.value)}
                      required
                    />
                  </Field>
                </div>

                <Field label="Bản đồ thi đấu (Campus v2)">
                  <select
                    value={newMapIndex}
                    onChange={(e) => setNewMapIndex(Number(e.target.value))}
                  >
                    {SAMPLE_MAPS.map((m, idx) => (
                      <option key={m.id || idx} value={idx}>{m.name}</option>
                    ))}
                  </select>
                </Field>
              </div>

              <div className="tt-dialog__foot">
                <button
                  type="button"
                  className="tt-btn tt-btn--ghost"
                  onClick={() => setShowCreateModal(false)}
                  disabled={actionBusy}
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className="tt-btn tt-btn--primary"
                  disabled={actionBusy || !newName.trim()}
                >
                  {actionBusy ? 'Đang tạo…' : 'Xác nhận tạo đợt'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Hủy / Rerun với Audit Reason */}
      {auditDialog && (
        <div className="tt-dialog-backdrop">
          <div className="tt-dialog" style={{ maxWidth: '480px' }}>
            <div className="tt-dialog__head">
              <h2>{auditDialog.type === 'cancel' ? 'Xác nhận Hủy ván đấu' : 'Xác nhận Chấm lại (Rerun)'}</h2>
            </div>
            <div className="tt-dialog__body">
              <p style={{ margin: '0 0 0.75rem' }}>
                Hành động này sẽ được ghi vào nhật ký kiểm toán (Audit Log). Vui lòng nhập lý do giải trình:
              </p>
              <Field label="Lý do giải trình (Ít nhất 5 ký tự)">
                <textarea
                  rows={3}
                  value={auditReason}
                  onChange={(e) => setAuditReason(e.target.value)}
                  placeholder="Ví dụ: Sự cố gián đoạn kết nối máy chấm, hoặc nghi vấn lỗi bot..."
                  required
                />
              </Field>
            </div>
            <div className="tt-dialog__foot">
              <button
                type="button"
                className="tt-btn tt-btn--ghost"
                onClick={() => {
                  setAuditDialog(null);
                  setAuditReason('');
                }}
                disabled={actionBusy}
              >
                Đóng
              </button>
              <button
                type="button"
                className="tt-btn tt-btn--danger"
                disabled={actionBusy || !auditReason.trim() || auditReason.trim().length < 5}
                onClick={handleAuditAction}
              >
                {actionBusy ? 'Đang xử lý…' : 'Xác nhận'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
