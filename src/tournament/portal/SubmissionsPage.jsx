import React, { useRef, useState } from 'react';
import { Download, Lock, UploadCloud } from 'lucide-react';
import { Alert, Badge, DataTable, Field, Panel } from './TournamentUi.jsx';
import {
  botState, formatDateTime, shortSha, submissionFreeze, submissionState, teamBotState,
} from './tournamentView.js';

const MAX_BYTES = 64 * 1024;

export default function SubmissionsPage({ account, events, teams, submissions, teamFilter, onSelectTeam, actions, busy }) {
  const isAdmin = account.role === 'admin';
  const formRef = useRef(null);
  const [error, setError] = useState('');
  const frozen = submissionFreeze(events);
  const bot = botState(submissions);
  const selectedTeam = teams.find((team) => team.id === teamFilter) || null;
  const targetId = isAdmin ? teamFilter : account.participant_id;
  const canUpload = Boolean(targetId) && (isAdmin || !frozen);

  async function handleUpload(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const file = form.elements.file?.files?.[0];
    if (!file) {
      setError('Chọn một file .py trước khi nộp.');
      return;
    }
    if (!/\.py$/i.test(file.name)) {
      setError('Chỉ nhận đúng một file Python (.py). Không nhận ZIP, package hay URL.');
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(`File ${Math.ceil(file.size / 1024)} KiB vượt giới hạn 64 KiB.`);
      return;
    }
    setError('');
    const ok = await actions.uploadBot(targetId, file);
    if (ok) form.reset();
  }

  return (
    <>
      <header className="tt-page-head">
        <div>
          <p className="tt-eyebrow">{isAdmin ? 'Ban tổ chức · nhận bài' : 'Đội thi · bài nộp'}</p>
          <h1 className="tt-page-title">{isAdmin ? 'Bài nộp & kiểm tra bot' : 'Bot & bài nộp'}</h1>
          <p className="tt-page-lead">
            Hệ thống chỉ nhận một file Python dùng thư viện chuẩn. Server lưu file với tên sinh tự động, tính
            SHA-256 và chạy smoke test; bot không được quyền quyết định kết quả trận.
          </p>
        </div>
        <a className="tt-btn" href="/api/sample-bot" download="sample_bot.py">
          <Download size={16} aria-hidden="true" />
          Tải bot mẫu
        </a>
      </header>

      {frozen && !isAdmin && (
        <Alert tone="warning" title={`Bài nộp đang khóa · ${frozen.name}`}>
          Đội đang thi trong giải chạy. Chờ giải kết thúc để nộp phiên bản mới; server cũng chặn thao tác này.
        </Alert>
      )}

      {isAdmin && (
        <Panel
          title="Chọn đội cần xem"
          subtitle="Admin có thể nộp hộ khi đội gặp sự cố, không bị khóa bởi vòng đang chạy."
          actions={selectedTeam ? <Badge tone={teamBotState(selectedTeam).tone}>{teamBotState(selectedTeam).label}</Badge> : null}
        >
          <Field label="Đội">
            <select value={teamFilter} onChange={(event) => onSelectTeam(event.target.value)}>
              <option value="">— Chọn đội —</option>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}{team.latest_valid_submission_id ? '' : ' (chưa có bot hợp lệ)'}
                </option>
              ))}
            </select>
          </Field>
          {!selectedTeam && <p className="tt-muted">Chọn một đội để xem lịch sử và nộp bài thay.</p>}
        </Panel>
      )}

      <section className="tt-stats" aria-label="Trạng thái bài nộp">
        <div className={`tt-stat tt-stat--${bot.hasValid ? 'success' : 'warning'}`}>
          <span className="tt-stat__label">Bot hợp lệ</span>
          <strong className="tt-stat__value">{bot.hasValid ? 'Có' : 'Chưa'}</strong>
          <span className="tt-stat__hint">{bot.validCount} bài vượt kiểm tra</span>
        </div>
        <div className="tt-stat">
          <span className="tt-stat__label">Tổng bài đã nhận</span>
          <strong className="tt-stat__value">{bot.total}</strong>
          <span className="tt-stat__hint">{bot.failedCount} bài lỗi</span>
        </div>
        <div className="tt-stat">
          <span className="tt-stat__label">Bài mới nhất</span>
          <strong className="tt-stat__value tt-stat__value--small">{bot.latest ? formatDateTime(bot.latest.created_at) : '—'}</strong>
          <span className="tt-stat__hint">{bot.latest ? `SHA ${shortSha(bot.latest.sha256)}` : 'Chưa có dữ liệu'}</span>
        </div>
      </section>

      <div className="tt-grid tt-grid--2 tt-grid--form">
        <Panel title="Nộp bot" subtitle="Nộp bài mới không xóa lịch sử; hệ thống dùng bài hợp lệ mới nhất khi giải bắt đầu.">
          <form className="tt-form" ref={formRef} onSubmit={handleUpload}>
            <Field label="File bot (.py)" hint="Tối đa 64 KiB. Validation chạy code trên máy BTC, không có sandbox.">
              <input type="file" name="file" accept=".py" required disabled={!canUpload || busy?.upload} />
            </Field>
            {error && <Alert tone="danger">{error}</Alert>}
            <div className="tt-form__actions">
              <button type="submit" className="tt-btn tt-btn--primary" disabled={!canUpload || busy?.upload}>
                {frozen && !isAdmin ? <Lock size={16} aria-hidden="true" /> : <UploadCloud size={16} aria-hidden="true" />}
                {busy?.upload ? 'Đang kiểm tra…' : 'Nộp & kiểm tra bot'}
              </button>
              {!canUpload && <span className="tt-muted">Cần chọn đội và mở khóa vòng đấu trước khi nộp.</span>}
            </div>
          </form>
        </Panel>

        <Panel title="Yêu cầu kỹ thuật" subtitle="Theo protocol MVP, không phải Campus persistent.">
          <ul className="tt-bullets">
            <li><strong>Python 3.12+</strong>, chỉ thư viện chuẩn; không cài package.</li>
            <li>Một file <code>.py</code> duy nhất; không ZIP, không source URL.</li>
            <li>Bot nhận JSON qua stdin và trả JSON qua stdout; không tự ghi kết quả.</li>
            <li>Mỗi request là một tiến trình mới; bot không giữ trạng thái giữa các nước.</li>
            <li>Server giới hạn thời gian, kích thước output và số nước (tối đa 200 plies).</li>
          </ul>
          <Alert tone="info" title="Bot mẫu">
            Dùng <a href="/api/sample-bot" download="sample_bot.py">sample_bot.py</a> làm khung rồi thay phần chọn nước.
            Đọc thêm tại <code>docs/02_BOT_WORKER_PROTOCOL.md</code>.
          </Alert>
        </Panel>
      </div>

      <Panel
        title="Lịch sử bài nộp"
        subtitle={selectedTeam ? selectedTeam.name : isAdmin ? 'Chọn đội để xem lịch sử' : 'Bài nộp của đội bạn'}
        actions={<Badge tone="neutral">{bot.total} bản</Badge>}
      >
        {bot.total ? (
          <DataTable columns={['Thời điểm', 'SHA-256', 'Trạng thái', 'Lỗi kiểm tra']} label="Lịch sử bài nộp">
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
            {isAdmin && !teamFilter ? 'Chọn một đội ở khung phía trên để xem lịch sử bài nộp.' : 'Chưa có bài nộp nào. Nộp file .py đầu tiên để hệ thống kiểm tra.'}
          </p>
        )}
      </Panel>
    </>
  );
}
