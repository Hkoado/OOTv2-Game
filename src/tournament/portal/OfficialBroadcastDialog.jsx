import React, { useEffect, useMemo, useState } from 'react';
import { Radio, X, AlertTriangle, Clock } from 'lucide-react';
import { Alert, Badge, Field } from './TournamentUi.jsx';
import { parseCutoffDetails, toLocalDatetimeInput } from './officialSetupView.js';
import { fetchOfficialBroadcastState, scheduleOfficialBroadcast } from './officialRoundApi.js';

export default function OfficialBroadcastDialog({ roundPk, gameKey, game, open, onClose, onScheduled }) {
  if (!open || !roundPk || !gameKey) return null;

  const [existing, setExisting] = useState(null);
  const [startsAt, setStartsAt] = useState(() => {
    const future = new Date(Date.now() + 2 * 60 * 1000);
    return toLocalDatetimeInput(future.toISOString());
  });
  const [plyIntervalMs, setPlyIntervalMs] = useState(2000);
  const [releaseMode, setReleaseMode] = useState('full');
  const [state, setState] = useState('scheduled');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const timeDetails = useMemo(() => parseCutoffDetails(startsAt), [startsAt]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchOfficialBroadcastState(roundPk, gameKey)
      .then((data) => {
        if (!alive || !data?.broadcast) return;
        const b = data.broadcast;
        setExisting(b);
        if (b.starts_at) setStartsAt(toLocalDatetimeInput(b.starts_at));
        if (b.ply_interval_ms) setPlyIntervalMs(b.ply_interval_ms);
        if (b.release_mode) setReleaseMode(b.release_mode);
        if (b.state) setState(b.state);
      })
      .catch((err) => {
        if (alive && err?.status !== 404) setError(err.message || 'Lỗi tải trạng thái phát sóng.');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => { alive = false; };
  }, [roundPk, gameKey]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (!timeDetails.utcIso) {
      setError('Vui lòng chọn thời gian bắt đầu phát hợp lệ.');
      return;
    }

    setBusy(true);
    try {
      await scheduleOfficialBroadcast(roundPk, gameKey, {
        startsAt: timeDetails.utcIso,
        plyIntervalMs: Number(plyIntervalMs),
        releaseMode,
        state,
      });
      if (onScheduled) onScheduled();
      onClose();
    } catch (err) {
      setError(err.message || 'Lỗi khi đặt lịch phát trận đấu.');
    } finally {
      setBusy(false);
    }
  }

  async function handleCancelBroadcast() {
    if (!window.confirm('Bạn có chắc chắn muốn hủy lịch phát sóng ván đấu này?')) return;
    setBusy(true);
    setError('');
    try {
      await scheduleOfficialBroadcast(roundPk, gameKey, {
        startsAt: timeDetails.utcIso || new Date().toISOString(),
        plyIntervalMs: Number(plyIntervalMs),
        releaseMode,
        state: 'canceled',
      });
      if (onScheduled) onScheduled();
      onClose();
    } catch (err) {
      setError(err.message || 'Không thể hủy lịch phát sóng.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="tt-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="official-broadcast-title"
      onKeyDown={(e) => { if (e.key === 'Escape' && !busy) onClose(); }}
    >
      <div className="tt-modal" style={{ maxWidth: '520px', width: '90%' }}>
        <header className="tt-modal__head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 id="official-broadcast-title" className="tt-modal__title" style={{ margin: 0, fontSize: '1.25rem' }}>
              Đặt lịch phát sóng ván chính thức
            </h2>
            <p className="tt-muted" style={{ margin: '0.25rem 0 0', fontSize: '0.9rem' }}>
              Ván: <strong>{gameKey}</strong> (Vòng official: {roundPk.slice(0, 8)}…)
            </p>
          </div>
          <button type="button" className="tt-icon-btn" onClick={onClose} aria-label="Đóng">
            <X size={18} />
          </button>
        </header>

        {existing && (
          <div style={{ marginTop: '0.75rem' }}>
            <Badge tone={existing.state === 'scheduled' ? 'live' : existing.state === 'ended' ? 'success' : 'danger'}>
              Trạng thái: {existing.state} ({existing.phase || '—'})
            </Badge>
            {existing.visible_plies !== undefined && (
              <span className="tt-muted" style={{ marginLeft: '0.5rem', fontSize: '0.85rem' }}>
                Đã phát: {existing.visible_plies}/{existing.total_plies} plies
              </span>
            )}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ marginTop: '1rem' }}>
          {error && <Alert tone="danger">{error}</Alert>}

          <Field
            label="Thời điểm bắt đầu phát sóng"
            hint={`Giờ máy bạn (${timeDetails.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone}); server lưu UTC.`}
          >
            <input
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              required
              disabled={busy}
            />
            <div style={{ fontSize: '0.85rem', marginTop: '0.35rem' }}>
              {timeDetails.utcIso ? (
                <>
                  <div><strong>Địa phương:</strong> {timeDetails.localDisplay}</div>
                  <div><strong>Chuẩn UTC:</strong> <code>{timeDetails.utcIso}</code></div>
                  {timeDetails.isPast && (
                    <div style={{ color: 'var(--color-danger, #e53e3e)', marginTop: '0.2rem' }}>
                      ⚠️ Thời điểm này đã ở quá khứ; ván sẽ bắt đầu phát ngay lập tức.
                    </div>
                  )}
                </>
              ) : (
                <span className="tt-muted">{timeDetails.hint}</span>
              )}
            </div>
          </Field>

          <Field
            label="Nhịp phát (Khoảng cách giữa các nước cờ)"
            hint="Thời gian máy chủ nhả từng nước cho người xem theo dõi."
          >
            <select
              value={plyIntervalMs}
              onChange={(e) => setPlyIntervalMs(Number(e.target.value))}
              disabled={busy}
            >
              <option value="500">500 ms (Rất nhanh · 2 nước/giây)</option>
              <option value="1000">1.000 ms (Nhanh · 1 nước/giây)</option>
              <option value="2000">2.000 ms (Tiêu chuẩn · 1 nước/2 giây)</option>
              <option value="3000">3.000 ms (Vừa phải · 1 nước/3 giây)</option>
              <option value="5000">5.000 ms (Chậm rãi · 1 nước/5 giây)</option>
            </select>
          </Field>

          <Field
            label="Chế độ công bố kết quả (Release Mode)"
            hint="Xác định quyền truy cập replay và kết quả sau khi ván đấu phát xong."
          >
            <select value={releaseMode} onChange={(e) => setReleaseMode(e.target.value)} disabled={busy}>
              <option value="full">
                Mở toàn bộ sau khi phát xong (Công bố kết quả, mở replay & log)
              </option>
              <option value="window">
                Chỉ mở nước theo mốc thời gian (Bảo mật kết quả cuối trận)
              </option>
            </select>
          </Field>

          <div className="tt-form__actions" style={{ display: 'flex', gap: '0.5rem', justifyContent: 'space-between', marginTop: '1.5rem' }}>
            {existing && existing.state !== 'canceled' && (
              <button
                type="button"
                className="tt-btn tt-btn--danger"
                onClick={handleCancelBroadcast}
                disabled={busy}
              >
                Hủy lịch phát
              </button>
            )}
            <div style={{ display: 'flex', gap: '0.5rem', marginLeft: 'auto' }}>
              <button type="button" className="tt-btn tt-btn--ghost" onClick={onClose} disabled={busy}>
                Đóng
              </button>
              <button type="submit" className="tt-btn tt-btn--primary" disabled={busy}>
                <Radio size={16} aria-hidden="true" style={{ marginRight: '4px' }} />
                {busy ? 'Đang lưu lịch…' : 'Lưu lịch phát sóng'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
