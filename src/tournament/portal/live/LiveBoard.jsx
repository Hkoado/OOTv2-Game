import React, { useEffect, useMemo, useState } from 'react';
import { Pause, Play, SkipForward } from 'lucide-react';
import GameBoard from '../../../ui/GameBoard.jsx';
import { PIECE_LABELS, PLAYERS } from '../../../game/constants.js';
import { buildReplayFrames } from '../../replay.js';
import { REASON_LABELS, RESULT_LABELS, STAGE_LABELS, labelOf } from '../../labels.js';
import { findTerminal, moveCount, toReplayEvents } from './liveView.js';

/**
 * Bàn cờ read-only cho khán giả.
 *
 * Dữ liệu vào là snapshot công khai + danh sách event của `/api/live`; board được
 * dựng lại bằng đúng engine của `replay.js` nên khớp tuyệt đối với trọng tài server.
 * Mặc định "bám trực tiếp" (luôn ở nước mới nhất); khán giả có thể tạm dừng để tua.
 */
export default function LiveBoard({ snapshot, events }) {
  const match = snapshot?.match || null;
  const initialPieces = snapshot?.live?.initial_pieces || [];
  const replay = useMemo(
    () => ({ initial_pieces: initialPieces, events: toReplayEvents(events), map: snapshot?.map || undefined }),
    [initialPieces, events, snapshot?.map]
  );
  const parsed = useMemo(() => buildReplayFrames(replay), [replay]);
  const frames = parsed.frames;
  const lastIndex = Math.max(0, frames.length - 1);

  const [follow, setFollow] = useState(true);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (follow) setIndex(lastIndex);
  }, [follow, lastIndex]);

  useEffect(() => {
    // Chuyển ván → quay lại chế độ bám trực tiếp.
    setFollow(true);
    setIndex(0);
  }, [match?.id]);

  const terminal = findTerminal(events);
  const frame = frames[Math.min(index, lastIndex)] || frames[0];
  const finished = match?.status === 'finished' || Boolean(terminal);
  const result = terminal?.result || match?.result || null;
  const reason = terminal?.reason || match?.reason || null;

  const deadPieces = useMemo(() => {
    const buckets = { red: [], blue: [] };
    for (const piece of Object.values(frame?.pieces || {})) {
      if (piece.alive) continue;
      buckets[piece.player === PLAYERS.RED ? 'red' : 'blue'].push(piece.type);
    }
    return buckets;
  }, [frame]);

  return (
    <section className="live-board-card" aria-label="Bàn cờ trực tiếp">
      <header className="live-board-card__head">
        <div className="live-board-card__teams">
          <span className="live-team live-team--red">
            <span className="live-team__dot" aria-hidden="true" /> {match?.red?.name || 'Đỏ'}
          </span>
          <span className="live-board-card__vs">vs</span>
          <span className="live-team live-team--blue">
            <span className="live-team__dot" aria-hidden="true" /> {match?.blue?.name || 'Xanh'}
          </span>
        </div>
        <div className="live-board-card__meta">
          <span>{labelOf(STAGE_LABELS, match?.stage)}</span>
          {match?.game_no && <span>Ván {match.game_no}</span>}
          {match?.series_id && <span className="tt-muted">Series {match.series_id}</span>}
        </div>
      </header>

      {!snapshot && <p className="tt-alert">Đang tải thông tin ván đấu…</p>}
      {snapshot && !snapshot.live?.has_initial && !finished && (
        <p className="tt-alert">Hai đội đang xếp quân. Bàn cờ sẽ hiện ngay khi cả hai bên xếp xong.</p>
      )}
      {snapshot && !snapshot.live?.has_initial && finished && (
        <p className="tt-alert tt-alert--warning">
          Ván này kết thúc trước khi có dữ liệu bàn cờ trực tiếp (bot lỗi xếp quân hoặc dữ liệu cũ).
        </p>
      )}
      {parsed.error && <p className="tt-alert tt-alert--warning">{parsed.error}</p>}

      <div className={`live-board ${finished ? 'live-board--finished' : ''}`}>
        <GameBoard pieces={frame?.pieces} lastMove={frame?.lastMove} map={snapshot?.map || undefined} readOnly />
        {finished && (
          <div className="live-board__result">
            <strong>{labelOf(RESULT_LABELS, result)}</strong>
            <span>{labelOf(REASON_LABELS, reason)}</span>
          </div>
        )}
      </div>

      <div className="live-board-actions">
        <button
          type="button"
          className={`tt-btn tt-btn--sm ${follow ? 'tt-btn--primary' : 'tt-btn--ghost'}`}
          onClick={() => {
            if (!follow && index >= lastIndex) setIndex(0);
            setFollow((value) => !value);
          }}
          aria-pressed={follow}
        >
          {follow ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
          {follow ? 'Đang bám trực tiếp' : 'Tạm dừng xem lại'}
        </button>
        <button
          type="button"
          className="tt-btn tt-btn--ghost tt-btn--sm"
          onClick={() => setIndex(lastIndex)}
          disabled={index >= lastIndex}
        >
          <SkipForward className="w-4 h-4" /> Nước mới nhất
        </button>
        <span className="live-board-actions__count">
          {moveCount(events)} nước · đang xem <strong>{index}</strong>/{lastIndex}
        </span>
      </div>

      <input
        type="range"
        className="replay-range"
        min={0}
        max={lastIndex}
        value={Math.min(index, lastIndex)}
        aria-label="Tua lại các nước đã đi"
        onChange={(event) => {
          setFollow(false);
          setIndex(Number(event.target.value));
        }}
      />

      <div className="live-board-status">
        <span>
          Lượt: <strong>{frame?.turn === PLAYERS.RED ? 'Đỏ' : 'Xanh'}</strong>
        </span>
        <span className="live-board-status__move">{frame?.description}</span>
      </div>

      <div className="live-board-dead">
        <span className="tt-small tt-muted">Quân đã mất</span>
        <span className="tt-small">
          Đỏ: {deadPieces.red.length ? deadPieces.red.map((type) => PIECE_LABELS[type] || type).join(', ') : '—'}
        </span>
        <span className="tt-small">
          Xanh: {deadPieces.blue.length ? deadPieces.blue.map((type) => PIECE_LABELS[type] || type).join(', ') : '—'}
        </span>
      </div>
    </section>
  );
}
