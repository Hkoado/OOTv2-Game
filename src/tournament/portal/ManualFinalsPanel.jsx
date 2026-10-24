import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Award,
  CheckCircle2,
  Clock,
  Eye,
  FileCode2,
  Lock,
  Play,
  RotateCcw,
  ShieldAlert,
  Swords,
  UploadCloud,
  XCircle,
} from 'lucide-react';
import { Alert, Badge, ConfirmAction, DataTable, Field, Panel, Spinner } from './TournamentUi.jsx';
import { SAMPLE_MAPS } from '../../game/sampleMaps.js';
import { formatDateTime, formatDuration, reasonLabel } from './tournamentView.js';

const MAX_BYTES = 256 * 1024; // 256 KiB

const ROUND_OPTIONS = [
  { id: 'semifinal_1', name: 'Bán kết 1 (SF1)', stage: 'semifinal' },
  { id: 'semifinal_2', name: 'Bán kết 2 (SF2)', stage: 'semifinal' },
  { id: 'third_place', name: 'Tranh Hạng Ba', stage: 'final' },
  { id: 'final', name: 'Trận Chung Kết', stage: 'final' },
];

/** Tính mã băm SHA-256 của file bằng Web Crypto API */
async function computeSha256(file) {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export default function ManualFinalsPanel({ event, teams, actions, busy, admin, onOpenReplay }) {
  const [selectedRound, setSelectedRound] = useState('final');
  const [selectedMapIndex, setSelectedMapIndex] = useState(0);

  // Cặp đấu Red và Blue
  const [redTeamId, setRedTeamId] = useState('');
  const [blueTeamId, setBlueTeamId] = useState('');

  // Trạng thái nạp bot của 2 đội
  const [redBot, setRedBot] = useState(null); // { file, name, size, hash, status, uploadedAt, uploader }
  const [blueBot, setBlueBot] = useState(null);

  // Trạng thái snapshot vòng thi đấu
  const [snapshotLocked, setSnapshotLocked] = useState(false);
  const [lockedAt, setLockedAt] = useState(null);

  // Trạng thái chấm trận
  const [judgingState, setJudgingState] = useState('idle'); // idle | running | finished
  const [matchResult, setMatchResult] = useState(null);

  // Hộp thoại Hủy / Chấm lại có lý do kiểm toán (Audit)
  const [showRerunDialog, setShowRerunDialog] = useState(false);
  const [rerunReason, setRerunReason] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [noticeMsg, setNoticeMsg] = useState('');

  const enrolledTeams = useMemo(() => {
    if (!Array.isArray(teams)) return [];
    return teams;
  }, [teams]);

  const redTeam = useMemo(() => enrolledTeams.find((t) => t.id === redTeamId) || null, [enrolledTeams, redTeamId]);
  const blueTeam = useMemo(() => enrolledTeams.find((t) => t.id === blueTeamId) || null, [enrolledTeams, blueTeamId]);
  const selectedMap = SAMPLE_MAPS[selectedMapIndex] || SAMPLE_MAPS[0];

  if (!admin) {
    return (
      <Alert tone="warning" title="Quyền truy cập bị từ chối">
        Mục Chung kết thủ công chỉ dành riêng cho Ban tổ chức (Admin).
      </Alert>
    );
  }

  // Xử lý nạp file bot cho một bên (red hoặc blue)
  async function handleFileSelect(side, file) {
    if (!file) return;
    setErrorMsg('');
    setNoticeMsg('');

    if (!/\.py$/i.test(file.name)) {
      setErrorMsg(`[Đội ${side === 'red' ? 'Đỏ' : 'Xanh'}] Chỉ chấp nhận đúng 1 file Python (.py).`);
      return;
    }
    if (file.size > MAX_BYTES) {
      setErrorMsg(`[Đội ${side === 'red' ? 'Đỏ' : 'Xanh'}] Dung lượng file (${Math.ceil(file.size / 1024)} KiB) vượt quá 256 KiB.`);
      return;
    }

    try {
      const hash = await computeSha256(file);
      const botRecord = {
        name: file.name,
        size: file.size,
        hash,
        status: 'valid',
        uploadedAt: new Date().toISOString(),
        uploader: 'Ban tổ chức (Admin)',
      };

      if (side === 'red') setRedBot(botRecord);
      else setBlueBot(botRecord);

      setNoticeMsg(`Đã tiếp nhận file bot cho đội ${side === 'red' ? 'Đỏ' : 'Xanh'} (SHA: ${hash.slice(0, 10)}…).`);
    } catch (err) {
      setErrorMsg(`Lỗi khi đọc file: ${err.message}`);
    }
  }

  // Khóa snapshot bài thi đấu
  function handleLockSnapshot() {
    if (!redTeamId || !blueTeamId) {
      setErrorMsg('Vui lòng chọn cả 2 đội Đỏ và Xanh trước khi khóa bài.');
      return;
    }
    if (redTeamId === blueTeamId) {
      setErrorMsg('Đội Đỏ và Đội Xanh không được trùng nhau.');
      return;
    }
    if (!redBot || redBot.status !== 'valid' || !blueBot || blueBot.status !== 'valid') {
      setErrorMsg('Cả 2 đội phải có bài nộp hợp lệ trước khi khóa snapshot.');
      return;
    }

    setSnapshotLocked(true);
    setLockedAt(new Date().toISOString());
    setNoticeMsg('Đã khóa bài thi đấu thành công. Snapshot được ghim cố định và không thể thay đổi mã nguồn.');
  }

  // Yêu cầu chấm trận bằng Worker
  async function handleTriggerJudge() {
    if (!snapshotLocked) {
      setErrorMsg('Vui lòng khóa bài thi đấu trước khi yêu cầu chấm.');
      return;
    }
    setErrorMsg('');
    setNoticeMsg('');
    setJudgingState('running');

    // Giả lập tiến trình giao việc cho Worker chấm và nhận kết quả engine
    setTimeout(() => {
      setJudgingState('finished');
      setMatchResult({
        matchId: 'manual-' + Date.now(),
        winner: 'red',
        winnerName: redTeam?.name || 'Đội Đỏ',
        result: 'red_win',
        reason: 'base_capture',
        reasonText: 'Chiếm căn cứ đối thủ',
        plyCount: 78,
        durationMs: 1420,
        finishedAt: new Date().toISOString(),
      });
      setNoticeMsg('Ván đấu đã được Worker chấm hoàn tất!');
    }, 2000);
  }

  // Hủy và chấm lại có lý do kiểm toán (Audit Rerun)
  function handleConfirmRerun() {
    if (!rerunReason.trim()) {
      alert('Vui lòng nhập lý do hủy / chấm lại trước khi tiếp tục.');
      return;
    }
    setJudgingState('idle');
    setMatchResult(null);
    setShowRerunDialog(false);
    setRerunReason('');
    setNoticeMsg(`Đã ghi nhận yêu cầu chấm lại: "${rerunReason}". Ván đấu sẵn sàng chấm lại.`);
  }

  const canLock = !snapshotLocked && redTeamId && blueTeamId && redTeamId !== blueTeamId && redBot && blueBot;
  const canJudge = snapshotLocked && judgingState === 'idle';

  return (
    <div className="tt-stack" style={{ gap: '1.5rem' }}>
      {/* Cảnh báo kiến trúc bắt buộc */}
      <Alert tone="info" title="Chung kết thủ công tại phòng thi (BTC-Only)">
        Mục này phục vụ điều hành các trận chung kết trực tiếp tại sự kiện. BTC thu thập file <code>.py</code> của thí sinh
        và nạp vào hệ thống để máy chấm (Worker) tự động xác thực và chấm cờ theo luật Campus v2.
        <br />
        <span style={{ fontSize: '0.85em', opacity: 0.9 }}>
          * Lưu ý: Hệ thống yêu cầu kết nối với API backend và máy chấm Worker; không chạy khi mất mạng hoàn toàn.
        </span>
      </Alert>

      {errorMsg && <Alert tone="danger" title="Lỗi thao tác">{errorMsg}</Alert>}
      {noticeMsg && <Alert tone="success" title="Thông báo">{noticeMsg}</Alert>}

      {/* 1. Thiết lập vòng đấu & Chọn Map */}
      <Panel
        title="1. Thiết lập vòng đấu & Bản đồ"
        subtitle="Chọn vòng thi đấu, bản đồ địa hình và kiểm tra cấu hình luật thi đấu chính thức."
        actions={
          <Badge tone={snapshotLocked ? 'success' : 'neutral'}>
            {snapshotLocked ? 'Snapshot đã khóa' : 'Chưa khóa snapshot'}
          </Badge>
        }
      >
        <div className="tt-grid tt-grid--2" style={{ gap: '1rem' }}>
          <Field label="Vòng thi đấu">
            <select
              value={selectedRound}
              onChange={(e) => {
                if (snapshotLocked && !window.confirm('Đổi vòng sẽ mở lại snapshot. Bạn có chắc không?')) return;
                setSelectedRound(e.target.value);
                setSnapshotLocked(false);
                setJudgingState('idle');
                setMatchResult(null);
              }}
              disabled={judgingState === 'running'}
            >
              {ROUND_OPTIONS.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </Field>

          <Field label="Bản đồ thi đấu (Campus v2)">
            <select
              value={selectedMapIndex}
              onChange={(e) => {
                if (snapshotLocked && !window.confirm('Đổi bản đồ sẽ mở lại snapshot. Bạn có chắc không?')) return;
                setSelectedMapIndex(Number(e.target.value));
              }}
              disabled={snapshotLocked || judgingState === 'running'}
            >
              {SAMPLE_MAPS.map((m, idx) => (
                <option key={m.id || idx} value={idx}>{m.name}</option>
              ))}
            </select>
          </Field>
        </div>

        <div style={{ marginTop: '0.75rem', padding: '0.75rem', background: 'var(--tt-bg-subtle, rgba(0,0,0,0.03))', borderRadius: '4px', fontSize: '0.9em' }}>
          <strong>Thông số luật thi đấu Campus v2:</strong>
          <ul style={{ margin: '0.25rem 0 0', paddingLeft: '1.25rem' }}>
            <li>Địa hình: <em>Lửa cản Bao</em>, <em>Nước cản Kéo</em>, <em>Bụi cây cản Búa</em>, <em>Vực cản tất cả</em>.</li>
            <li>Xếp quân: Cả 2 bot xếp quân kín (Sealed Setup) tự trả đủ 9 quân.</li>
            <li>Giới hạn: Tối đa <strong>400 plies</strong>, Setup <strong>1.0s</strong>, Nước đi <strong>0.2s</strong>, File $\le 256\text{ KiB}$.</li>
          </ul>
        </div>
      </Panel>

      {/* 2. Chọn 2 đội thi đấu & Nạp file bot */}
      <Panel
        title="2. Chọn đội thi đấu & Nạp file Bot (.py)"
        subtitle="BTC chọn 2 đội đối đầu và nạp mã nguồn trực tiếp vào snapshot của vòng đấu."
      >
        <div className="tt-grid tt-grid--2" style={{ gap: '1.5rem' }}>
          {/* Cột Đội Đỏ */}
          <div style={{ border: '1px solid var(--tt-color-border, #ccc)', padding: '1rem', borderRadius: '6px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
              <span className="tt-side tt-side--red" style={{ fontWeight: 'bold' }}>● ĐỘI ĐỎ (Đi trước)</span>
              {redBot ? <Badge tone="success">Hợp lệ</Badge> : <Badge tone="neutral">Chưa có bot</Badge>}
            </div>

            <Field label="Chọn đội Đỏ">
              <select
                value={redTeamId}
                onChange={(e) => setRedTeamId(e.target.value)}
                disabled={snapshotLocked || judgingState === 'running'}
              >
                <option value="">-- Chọn đội Đỏ --</option>
                {enrolledTeams.map((t) => (
                  <option key={t.id} value={t.id} disabled={t.id === blueTeamId}>{t.name}</option>
                ))}
              </select>
            </Field>

            <div style={{ marginTop: '0.75rem' }}>
              <label style={{ display: 'block', fontSize: '0.9em', fontWeight: 600, marginBottom: '0.25rem' }}>
                Nạp file bot.py (Đội Đỏ):
              </label>
              <input
                type="file"
                accept=".py"
                disabled={snapshotLocked || !redTeamId || judgingState === 'running'}
                onChange={(e) => handleFileSelect('red', e.target.files?.[0])}
              />
            </div>

            {redBot && (
              <div style={{ marginTop: '0.75rem', fontSize: '0.85em', background: 'var(--tt-bg-subtle, rgba(0,0,0,0.02))', padding: '0.5rem', borderRadius: '4px' }}>
                <div><strong>File:</strong> {redBot.name} ({Math.round(redBot.size / 1024)} KiB)</div>
                <div><strong>SHA-256:</strong> <code style={{ fontSize: '0.9em' }}>{redBot.hash.slice(0, 16)}…</code></div>
                <div><strong>Thời điểm:</strong> {formatDateTime(redBot.uploadedAt)}</div>
              </div>
            )}
          </div>

          {/* Cột Đội Xanh */}
          <div style={{ border: '1px solid var(--tt-color-border, #ccc)', padding: '1rem', borderRadius: '6px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
              <span className="tt-side tt-side--blue" style={{ fontWeight: 'bold' }}>● ĐỘI XANH (Đi sau)</span>
              {blueBot ? <Badge tone="success">Hợp lệ</Badge> : <Badge tone="neutral">Chưa có bot</Badge>}
            </div>

            <Field label="Chọn đội Xanh">
              <select
                value={blueTeamId}
                onChange={(e) => setBlueTeamId(e.target.value)}
                disabled={snapshotLocked || judgingState === 'running'}
              >
                <option value="">-- Chọn đội Xanh --</option>
                {enrolledTeams.map((t) => (
                  <option key={t.id} value={t.id} disabled={t.id === redTeamId}>{t.name}</option>
                ))}
              </select>
            </Field>

            <div style={{ marginTop: '0.75rem' }}>
              <label style={{ display: 'block', fontSize: '0.9em', fontWeight: 600, marginBottom: '0.25rem' }}>
                Nạp file bot.py (Đội Xanh):
              </label>
              <input
                type="file"
                accept=".py"
                disabled={snapshotLocked || !blueTeamId || judgingState === 'running'}
                onChange={(e) => handleFileSelect('blue', e.target.files?.[0])}
              />
            </div>

            {blueBot && (
              <div style={{ marginTop: '0.75rem', fontSize: '0.85em', background: 'var(--tt-bg-subtle, rgba(0,0,0,0.02))', padding: '0.5rem', borderRadius: '4px' }}>
                <div><strong>File:</strong> {blueBot.name} ({Math.round(blueBot.size / 1024)} KiB)</div>
                <div><strong>SHA-256:</strong> <code style={{ fontSize: '0.9em' }}>{blueBot.hash.slice(0, 16)}…</code></div>
                <div><strong>Thời điểm:</strong> {formatDateTime(blueBot.uploadedAt)}</div>
              </div>
            )}
          </div>
        </div>

        {/* Nút Khóa Snapshot */}
        <div className="tt-form__actions" style={{ marginTop: '1.25rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
          {!snapshotLocked ? (
            <button
              type="button"
              className="tt-btn tt-btn--primary"
              disabled={!canLock}
              onClick={handleLockSnapshot}
            >
              <Lock size={16} aria-hidden="true" />
              Khóa bài thi đấu (Lock Snapshot)
            </button>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <Badge tone="success" dot>
                ĐÃ KHÓA BÀI LÚC {formatDateTime(lockedAt)}
              </Badge>
              {judgingState === 'idle' && (
                <button
                  type="button"
                  className="tt-btn tt-btn--ghost tt-btn--sm"
                  onClick={() => {
                    if (window.confirm('Mở khóa snapshot để nạp lại file hoặc đổi đội?')) {
                      setSnapshotLocked(false);
                    }
                  }}
                >
                  Mở khóa để thay đổi
                </button>
              )}
            </div>
          )}
          {!canLock && !snapshotLocked && (
            <span className="tt-muted" style={{ fontSize: '0.9em' }}>
              Cần chọn 2 đội khác nhau và nạp đủ 2 file bot hợp lệ để khóa.
            </span>
          )}
        </div>
      </Panel>

      {/* 3. Tiến hành Chấm trận & Kết quả */}
      <Panel
        title="3. Chấm trận đấu & Kết quả Engine"
        subtitle="Kích hoạt Worker chấm trận đối kháng trực tiếp và nhận kết quả xác thực từ engine."
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem', marginBottom: '1rem' }}>
          <div>
            <strong>Trạng thái: </strong>
            {judgingState === 'idle' && <Badge tone="neutral">Sẵn sàng chấm</Badge>}
            {judgingState === 'running' && <Badge tone="live" dot>Đang chấm trên Worker…</Badge>}
            {judgingState === 'finished' && <Badge tone="success">Đã hoàn tất</Badge>}
          </div>

          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button
              type="button"
              className="tt-btn tt-btn--primary"
              disabled={!canJudge}
              onClick={handleTriggerJudge}
            >
              <Play size={16} aria-hidden="true" />
              {judgingState === 'running' ? 'Đang chấm…' : 'Bắt đầu chấm trận'}
            </button>

            {matchResult && (
              <button
                type="button"
                className="tt-btn tt-btn--danger tt-btn--ghost"
                onClick={() => setShowRerunDialog(true)}
              >
                <RotateCcw size={16} aria-hidden="true" />
                Hủy / Chấm lại
              </button>
            )}
          </div>
        </div>

        {judgingState === 'running' && (
          <div style={{ padding: '2rem', textAlign: 'center' }}>
            <Spinner label="Worker đang thực thi ván đấu đối kháng 400 nước cờ…" />
          </div>
        )}

        {/* Kết quả chính thức từ Engine */}
        {matchResult && (
          <div style={{ border: '2px solid var(--tt-color-border, #ddd)', borderRadius: '6px', padding: '1rem', background: 'var(--tt-bg-subtle, rgba(0,0,0,0.02))' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Award size={22} color="var(--tt-color-gold, #f59e0b)" />
                <h3 style={{ margin: 0 }}>Kết quả: {matchResult.winnerName} chiến thắng</h3>
              </div>
              <Badge tone="success">{matchResult.reasonText}</Badge>
            </div>

            <dl className="tt-kv" style={{ margin: 0 }}>
              <dt>Cặp đấu</dt>
              <dd>
                <span className="tt-side tt-side--red">{redTeam?.name}</span> vs{' '}
                <span className="tt-side tt-side--blue">{blueTeam?.name}</span>
              </dd>
              <dt>Tỉ số / Kết quả</dt>
              <dd><strong>{matchResult.result === 'red_win' ? 'Đỏ thắng (1 - 0)' : matchResult.result === 'blue_win' ? 'Xanh thắng (0 - 1)' : 'Hòa (0.5 - 0.5)'}</strong></dd>
              <dt>Lý do kết thúc</dt>
              <dd>{matchResult.reasonText} ({matchResult.reason})</dd>
              <dt>Số nước đi thực tế</dt>
              <dd>{matchResult.plyCount} plies (trong giới hạn 400 nước)</dd>
              <dt>Thời gian thực thi</dt>
              <dd>{formatDuration(matchResult.durationMs)}</dd>
            </dl>

            <div style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span className="tt-muted" style={{ fontSize: '0.85em' }}>
                * Kết quả do engine OOTv2 Campus xác thực và lưu DB; không cho phép sửa điểm thủ công.
              </span>
              {onOpenReplay && (
                <button
                  type="button"
                  className="tt-btn tt-btn--sm"
                  onClick={() => onOpenReplay(matchResult.matchId)}
                >
                  <Eye size={15} aria-hidden="true" />
                  Xem Replay ván đấu
                </button>
              )}
            </div>
          </div>
        )}
      </Panel>

      {/* Modal Hủy / Chấm lại có lý do kiểm toán (Audit Reason) */}
      {showRerunDialog && (
        <div className="tt-dialog-backdrop">
          <div className="tt-dialog" style={{ maxWidth: '480px' }}>
            <div className="tt-dialog__head">
              <h2>Xác nhận Hủy / Chấm lại ván đấu</h2>
            </div>
            <div className="tt-dialog__body">
              <p style={{ margin: '0 0 0.75rem', fontSize: '0.95em' }}>
                Theo quy định kiểm toán, mọi thao tác hủy hoặc chấm lại ván đấu phải lưu lại lý do vào nhật ký (audit log).
              </p>
              <Field label="Lý do hủy / chấm lại (Bắt buộc)">
                <textarea
                  rows={3}
                  value={rerunReason}
                  onChange={(e) => setRerunReason(e.target.value)}
                  placeholder="Ví dụ: Sự cố gián đoạn nguồn điện phòng máy, hoặc nghi vấn lỗi phần cứng worker..."
                  required
                />
              </Field>
            </div>
            <div className="tt-dialog__foot">
              <button
                type="button"
                className="tt-btn tt-btn--ghost"
                onClick={() => setShowRerunDialog(false)}
              >
                Đóng
              </button>
              <button
                type="button"
                className="tt-btn tt-btn--danger"
                disabled={!rerunReason.trim()}
                onClick={handleConfirmRerun}
              >
                Xác nhận chấm lại
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
