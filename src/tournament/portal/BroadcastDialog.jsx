import React, { useMemo, useState } from 'react';
import { Calendar, Clock, Radio, X } from 'lucide-react';
import { Alert, Field } from './TournamentUi.jsx';
import { parseCutoffDetails, toLocalDatetimeInput } from './officialSetupView.js';
import { scheduleBroadcast } from './live/publicationApi.js';

export default function BroadcastDialog({ match, open, onClose, onScheduled }) {
  if (!open || !match) return null;

  // Default starts_at to now + 5 minutes
  const [startsAt, setStartsAt] = useState(() => {
    const future = new Date(Date.now() + 5 * 60 * 1000);
    return toLocalDatetimeInput(future.toISOString());
  });
  const [plyIntervalMs, setPlyIntervalMs] = useState(2000);
  const [releaseMode, setReleaseMode] = useState('full');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const timeDetails = useMemo(() => parseCutoffDetails(startsAt), [startsAt]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (!timeDetails.utcIso) {
      setError('Vui lòng chọn thời gian bắt đầu phát hợp lệ.');
      return;
    }

    setBusy(true);
    try {
      await scheduleBroadcast({
        matchId: match.id,
        startsAt: timeDetails.utcIso,
        plyIntervalMs: Number(plyIntervalMs),
        releaseMode,
      });
      if (onScheduled) onScheduled();
      onClose();
    } catch (err) {
      setError(err.message || 'Lỗi khi đặt lịch phát trận đấu.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="tt-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="broadcast-title">
      <div className="tt-modal" style={{ maxWidth: '520px', width: '90%' }}>
        <header className="tt-modal__head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 id="broadcast-title" className="tt-modal__title" style={{ margin: 0, fontSize: '1.25rem' }}>
              Đặt lịch phát sóng trận đấu
            </h2>
            <p className="tt-muted" style={{ margin: '0.25rem 0 0', fontSize: '0.9rem' }}>
              {match.red?.name} vs {match.blue?.name} (Ván {match.game_no})
            </p>
          </div>
          <button type="button" className="tt-icon-btn" onClick={onClose} aria-label="Đóng">
            <X size={18} />
          </button>
        </header>

        <form onSubmit={handleSubmit} style={{ marginTop: '1rem' }}>
          {error && <Alert tone="danger">{error}</Alert>}

          <Field label="Thời điểm bắt đầu phát sóng">
            <input
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              required
            />
            <div style={{ fontSize: '0.85rem', marginTop: '0.35rem' }}>
              {timeDetails.utcIso ? (
                <>
                  <div><strong>Địa phương:</strong> {timeDetails.localDisplay}</div>
                  <div><strong>Chuẩn UTC:</strong> <code>{timeDetails.utcIso}</code></div>
                  {timeDetails.isPast && (
                    <div style={{ color: 'var(--tt-danger, #e53e3e)', marginTop: '0.2rem' }}>
                      ⚠️ Thời điểm này đã ở quá khứ; ván sẽ bắt đầu phát ngay lập tức.
                    </div>
                  )}
                </>
              ) : (
                <span className="tt-muted">{timeDetails.hint}</span>
              )}
            </div>
          </Field>

          <Field label="Nhịp phát">
            <select
              value={plyIntervalMs}
              onChange={(e) => setPlyIntervalMs(Number(e.target.value))}
            >
              <option value="500">500 ms (Rất nhanh · 2 nước/giây)</option>
              <option value="1000">1.000 ms (Nhanh · 1 nước/giây)</option>
              <option value="2000">2.000 ms (Tiêu chuẩn · 1 nước/2 giây)</option>
              <option value="3000">3.000 ms (Vừa phải · 1 nước/3 giây)</option>
              <option value="5000">5.000 ms (Chậm rãi · 1 nước/5 giây)</option>
            </select>
          </Field>

          <Field label="Chế độ công bố kết quả">
            <select value={releaseMode} onChange={(e) => setReleaseMode(e.target.value)}>
              <option value="full">
                Mở toàn bộ sau khi phát xong (Công bố kết quả, mở replay & log)
              </option>
              <option value="window">
                Chỉ mở nước theo mốc thời gian (Bảo mật kết quả cuối trận)
              </option>
            </select>
          </Field>

          <div className="tt-form__actions" style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1.5rem' }}>
            <button type="button" className="tt-btn tt-btn--ghost" onClick={onClose} disabled={busy}>
              Hủy
            </button>
            <button type="submit" className="tt-btn tt-btn--success" disabled={busy}>
              <Radio size={16} aria-hidden="true" />
              {busy ? 'Đang lưu lịch…' : 'Xác nhận đặt lịch phát'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
