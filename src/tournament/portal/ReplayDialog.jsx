import React, { Suspense, useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { Alert, Spinner } from './TournamentUi.jsx';
import { stageLabel } from './tournamentView.js';

/** Bàn cờ replay được tách chunk riêng: chỉ tải khi người dùng thực sự mở một ván. */
const ReplayBoard = React.lazy(() => import('../ReplayBoard.jsx'));

export default function ReplayDialog({ state, data, error, onClose }) {
  const closeRef = useRef(null);

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

  const match = data?.match;

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
        aria-label={match ? `Xem lại ${match.red?.name} và ${match.blue?.name}` : 'Xem lại ván đấu'}
      >
        <header className="tt-dialog__head">
          <div>
            <p className="tt-eyebrow">Replay · chỉ đọc</p>
            <h2 className="tt-dialog__title">
              {match ? `${match.red?.name} vs ${match.blue?.name}` : 'Đang tải replay'}
            </h2>
            {match && (
              <p className="tt-dialog__meta">
                {stageLabel(match.stage)} · lượt {match.game_no} · {match.ply_count ?? 0} nước
                {match.reason ? ` · ${match.reason}` : ''}
              </p>
            )}
          </div>
          <button ref={closeRef} type="button" className="tt-icon-btn" onClick={onClose} aria-label="Đóng replay">
            <X size={18} />
          </button>
        </header>
        <div className="tt-dialog__body">
          {state === 'loading' && <Spinner label="Đang tải seed, thế trận và danh sách nước đi…" />}
          {state === 'error' && <Alert tone="warning" title="Chưa xem được replay">{error}</Alert>}
          {state === 'ready' && data && (
            <Suspense fallback={<Spinner label="Đang tải bàn cờ…" />}>
              <ReplayBoard match={data.match} replay={data.replay} />
            </Suspense>
          )}
        </div>
      </div>
    </div>
  );
}
