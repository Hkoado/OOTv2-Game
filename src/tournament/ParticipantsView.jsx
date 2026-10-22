import React, { useState } from 'react';
import { RefreshCw, Upload, UserPlus } from 'lucide-react';
import { labelOf, SUBMISSION_STATUS_LABELS } from './labels.js';

/** Một dòng đội: trạng thái submission mới nhất + form upload bot riêng. */
function ParticipantRow({ participant, busy, onUploadBot }) {
  const [file, setFile] = useState(null);
  const [inputKey, setInputKey] = useState(0);
  const latest = participant.latest_submission;
  const hasValid = Boolean(participant.latest_valid_submission_id);

  return (
    <tr>
      <td className="cell-name">{participant.name}</td>
      <td>
        {latest ? (
          <span className={`chip chip--${latest.status === 'valid' ? 'ok' : 'warn'}`}>
            {labelOf(SUBMISSION_STATUS_LABELS, latest.status)}
          </span>
        ) : (
          <span className="chip chip--neutral">Chưa upload</span>
        )}
      </td>
      <td className="cell-error">{latest?.validation_error || '—'}</td>
      <td>
        <div className="upload-cell">
          <input
            key={inputKey}
            type="file"
            accept=".py,text/x-python"
            className="file-input"
            onChange={(event) => setFile(event.target.files?.[0] || null)}
          />
          <button
            type="button"
            className="btn btn--small"
            disabled={!file || busy}
            onClick={async () => {
              const ok = await onUploadBot(participant.id, file);
              if (ok) {
                setFile(null);
                setInputKey((key) => key + 1);
              }
            }}
          >
            <Upload className="w-3.5 h-3.5" /> Upload
          </button>
        </div>
      </td>
      <td>
        {hasValid ? (
          <span className="chip chip--ok">Đủ điều kiện thi đấu</span>
        ) : (
          <span className="chip chip--warn">Cần bot hợp lệ</span>
        )}
      </td>
    </tr>
  );
}



export default function ParticipantsView({
  participants,
  busy,
  adminKey,
  onAdminKeyChange,
  apiBase,
  onApiBaseChange,
  sampleBotUrl,
  onCreateParticipant,
  onUploadBot,
  onRefresh,
  error,
}) {
  const [name, setName] = useState('');
  const validCount = participants.filter((item) => item.latest_valid_submission_id).length;

  return (
    <div className="tournament-columns">
      <section className="card panel">
        <div className="panel__head">
          <h3 className="panel__title">1. Tạo đội và upload bot Python</h3>
          <button type="button" className="btn btn--secondary btn--small" onClick={onRefresh} disabled={busy}>
            <RefreshCw className="w-3.5 h-3.5" /> Làm mới
          </button>
        </div>

        <p className="panel__hint">
          Chỉ nhận <strong>một file .py</strong> (≤ 256 KiB, Python 3.12+, thư viện chuẩn). Không nhận ZIP,
          package hay file thực thi. Bot chỉ được chạy trên máy local tin cậy.
        </p>

        <form
          className="inline-form"
          onSubmit={async (event) => {
            event.preventDefault();
            const created = await onCreateParticipant(name);
            if (created) setName('');
          }}
        >
          <input
            className="text-input"
            placeholder="Tên đội (1–40 ký tự)"
            value={name}
            maxLength={40}
            onChange={(event) => setName(event.target.value)}
          />
          <button type="submit" className="btn btn--small" disabled={busy || name.trim().length < 1}>
            <UserPlus className="w-3.5 h-3.5" /> Tạo đội
          </button>
        </form>

        {error && <p className="notice notice--warn">{error}</p>}

        <div className="sample-bot">
          <span className="text-xs">
            Bot mẫu đúng giao thức:{' '}
            <a href={sampleBotUrl} target="_blank" rel="noreferrer">
              /api/sample-bot
            </a>{' '}
            (tương ứng <code>examples/sample_bot.py</code>)
          </span>
          <span className="text-xs muted">
            Giao thức: đọc JSON 1 dòng ở stdin, in JSON 1 dòng ở stdout; lỗi hoặc timeout là xử thua.
          </span>
        </div>
      </section>

      <section className="card panel">
        <div className="panel__head">
          <h3 className="panel__title">
            2. Danh sách đội ({participants.length} đội, {validCount} có bot hợp lệ)
          </h3>
        </div>

        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Đội</th>
                <th>Submission mới nhất</th>
                <th>Lỗi kiểm tra</th>
                <th>Upload bot</th>
                <th>Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {participants.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    Chưa có đội nào. Tạo đội rồi upload file .py ở đây.
                  </td>
                </tr>
              )}
              {participants.map((participant) => (
                <ParticipantRow
                  key={participant.id}
                  participant={participant}
                  busy={busy}
                  onUploadBot={onUploadBot}
                />
              ))}
            </tbody>
          </table>
        </div>

        <div className="admin-box">
          <label className="admin-box__field">
            <span>Khóa admin local (gửi qua x-admin-key)</span>
            <input
              className="text-input"
              type="password"
              value={adminKey}
              placeholder="VD: local-admin-key"
              onChange={(event) => onAdminKeyChange(event.target.value)}
            />
          </label>
          <label className="admin-box__field">
            <span>API base (để trống = dùng Vite proxy /api)</span>
            <input
              className="text-input"
              value={apiBase}
              placeholder="http://127.0.0.1:3001"
              onChange={(event) => onApiBaseChange(event.target.value)}
            />
          </label>
        </div>
      </section>
    </div>
  );
}
