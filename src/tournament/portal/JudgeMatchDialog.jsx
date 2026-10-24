import React, { useEffect, useRef, useState } from 'react';
import { Eye, X } from 'lucide-react';
import { apiRequest, isSessionError } from './portalApi.js';
import { Alert, Badge, Spinner } from './TournamentUi.jsx';
import { formatDateTime, formatDuration, matchOutcome, reasonLabel, stageLabel } from './tournamentView.js';

/**
 * JudgeMatchDialog — chi tiết nhật ký chấm của 1 ván (Mức 2), chỉ admin.
 * Dữ liệu lấy qua `GET /api/local/admin/judge/matches/:id`; server đã lọc đường dẫn file.
 */
export default function JudgeMatchDialog({ matchId, onClose, onOpenReplay, onExpired }) {
  const [state, setState] = useState({ status: 'loading', data: null, error: '' });
  const closeRef = useRef(null);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const data = await apiRequest(`/admin/judge/matches/${encodeURIComponent(matchId)}`, { signal: controller.signal });
        setState({ status: 'ready', data, error: '' });
      } catch (error) {
        if (error?.name === 'AbortError') return;
        if (isSessionError(error)) {
          onExpired?.();
          return;
        }
        setState({ status: 'error', data: null, error: error.message || 'Không tải được nhật ký chấm.' });
      }
    })();
    return () => controller.abort();
  }, [matchId, onExpired]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  const match = state.data?.match;
  const log = match?.log;
  const outcome = match ? matchOutcome(match) : null;

  return (
    <div
      className="tt-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="tt-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={match ? `Nhật ký chấm ${match.red?.name} và ${match.blue?.name}` : 'Nhật ký chấm bài'}
      >
        <header className="tt-dialog__head">
          <div>
            <p className="tt-eyebrow">Nhật ký chấm · chỉ admin</p>
            <h2 className="tt-dialog__title">
              {match ? `${match.red?.name} vs ${match.blue?.name}` : 'Đang tải nhật ký'}
            </h2>
            {match && (
              <p className="tt-dialog__meta">
                {stageLabel(match.stage)} · {String(match.series_id || '').toUpperCase()} · lượt {match.game_no}
                {outcome ? ` · ${outcome.label}` : ''}
              </p>
            )}
          </div>
          <button ref={closeRef} type="button" className="tt-icon-btn" onClick={onClose} aria-label="Đóng nhật ký">
            <X size={18} />
          </button>
        </header>

        <div className="tt-dialog__body">
          {state.status === 'loading' && <Spinner label="Đang tải nhật ký chấm…" />}
          {state.status === 'error' && (
            <Alert tone="warning" title="Chưa xem được nhật ký">{state.error}</Alert>
          )}

          {state.status === 'ready' && match && (
            <div className="tt-stack">
              <dl className="tt-kv">
                <dt>Kết quả</dt>
                <dd><Badge tone={outcome?.tone || 'neutral'}>{outcome?.label || '—'}</Badge></dd>
                <dt>Lý do</dt>
                <dd>{reasonLabel(match.reason)}</dd>
                <dt>Số nước</dt>
                <dd>{match.ply_count ?? '—'}</dd>
                <dt>Thời gian chấm</dt>
                <dd>{formatDuration(match.elapsed_ms ?? log?.elapsed_ms)}</dd>
                <dt>Bắt đầu</dt>
                <dd>{formatDateTime(match.started_at)}</dd>
                <dt>Kết thúc</dt>
                <dd>{formatDateTime(match.finished_at)}</dd>
                <dt>Worker</dt>
                <dd><code>{log?.worker || '—'}</code></dd>
              </dl>

              {log?.error && (
                <Alert tone="danger" title="Lỗi khi chấm">
                  <p className="tt-log__error-text">{log.error}</p>
                </Alert>
              )}

              {log?.notes?.length ? (
                <div>
                  <p className="tt-eyebrow">Ghi chú của worker ({log.notes.length})</p>
                  <ol className="tt-log">
                    {log.notes.map((note, index) => (
                      <li key={`${index}-${note.slice(0, 12)}`}>{note}</li>
                    ))}
                  </ol>
                </div>
              ) : (
                !log?.error && (
                  <Alert tone="info" title="Chưa có ghi chú cho ván này">
                    Ván được chấm trước khi bật nhật ký, hoặc không có bất thường để ghi. Từ bản này,
                    mọi ván đều lưu ghi chú, lỗi bot và thời gian chấm.
                  </Alert>
                )
              )}

              <div className="tt-dialog__actions">
                <button
                  type="button"
                  className="tt-btn tt-btn--info"
                  onClick={() => onOpenReplay(match.id)}
                  disabled={!state.data?.replay_available}
                  title={state.data?.replay_available ? 'Xem lại ván đấu' : 'Replay chỉ mở khi ván đã kết thúc'}
                >
                  <Eye size={16} aria-hidden="true" />
                  Xem replay
                </button>
                <button type="button" className="tt-btn tt-btn--ghost" onClick={onClose}>Đóng</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
