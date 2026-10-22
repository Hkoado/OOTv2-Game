import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw, SkipBack, SkipForward } from 'lucide-react';
import GameBoard from '../ui/GameBoard.jsx';
import { PIECE_LABELS, PLAYERS } from '../game/constants.js';
import { buildReplayFrames } from './replay.js';
import { REASON_LABELS, RESULT_LABELS, labelOf } from './labels.js';

/**
 * Board read-only để xem lại trận đã kết thúc.
 * Dùng component OTTBoard qua adapter chung và KHÔNG truyền handler click,
 * nên người xem không thể đi quân.
 */
export default function ReplayBoard({ match, replay }) {
  const parsed = useMemo(() => buildReplayFrames(replay), [replay]);
  const frames = parsed.frames;
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);

  const lastIndex = frames.length - 1;
  const frame = frames[Math.min(index, lastIndex)] || frames[0];

  useEffect(() => {
    setIndex(0);
    setPlaying(false);
  }, [replay]);

  useEffect(() => {
    if (!playing || index >= lastIndex) return undefined;
    const timer = setTimeout(() => setIndex((current) => Math.min(current + 1, lastIndex)), 700);
    return () => clearTimeout(timer);
  }, [playing, index, lastIndex]);

  const deadPieces = useMemo(() => {
    const buckets = { red: [], blue: [] };
    for (const piece of Object.values(frame?.pieces || {})) {
      if (piece.alive) continue;
      buckets[piece.player === PLAYERS.RED ? 'red' : 'blue'].push(piece.type);
    }
    return buckets;
  }, [frame]);

  return (
    <div className="replay-viewer">
      <div className="replay-viewer__head">
        <div>
          <h4 className="replay-viewer__title">
            {match.red.name} <span className="tt-muted">(Đỏ)</span> vs {match.blue.name}{' '}
            <span className="tt-muted">(Xanh)</span>
          </h4>
          <p className="replay-viewer__meta">
            {labelOf(RESULT_LABELS, match.result)} · {labelOf(REASON_LABELS, match.reason)} ·{' '}
            {match.ply_count ?? 0} nước · seed {match.seed}
          </p>
        </div>
      </div>

      {parsed.error && <p className="tt-alert tt-alert--warning">{parsed.error}</p>}
      {lastIndex === 0 && !parsed.error && (
        <p className="tt-alert">
          Trận này kết thúc bằng quyết định của giải (bot lỗi khi xếp quân hoặc khi đi quân) nên không có
          nước đi để tua lại.
        </p>
      )}

      <div className="replay-board-layout"><GameBoard pieces={frame?.pieces} lastMove={frame?.lastMove} map={replay?.map} readOnly /></div>

      <div className="replay-controls">
        <button
          type="button"
          className="tt-btn tt-btn--ghost tt-btn--sm"
          onClick={() => setIndex(0)}
          disabled={index === 0}
        >
          <SkipBack className="w-4 h-4" /> Đầu
        </button>
        <button
          type="button"
          className="tt-btn tt-btn--ghost tt-btn--sm"
          onClick={() => setIndex((current) => Math.max(current - 1, 0))}
          disabled={index === 0}
        >
          <ChevronLeft className="w-4 h-4" /> Trước
        </button>
        <button
          type="button"
          className="tt-btn tt-btn--primary tt-btn--sm"
          onClick={() => {
            if (index >= lastIndex) setIndex(0);
            setPlaying((value) => !value);
          }}
          disabled={lastIndex === 0}
        >
          {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          {playing ? 'Tạm dừng' : 'Tự chạy'}
        </button>
        <button
          type="button"
          className="tt-btn tt-btn--ghost tt-btn--sm"
          onClick={() => setIndex((current) => Math.min(current + 1, lastIndex))}
          disabled={index >= lastIndex}
        >
          Sau <ChevronRight className="w-4 h-4" />
        </button>
        <button
          type="button"
          className="tt-btn tt-btn--ghost tt-btn--sm"
          onClick={() => setIndex(lastIndex)}
          disabled={index >= lastIndex}
        >
          Cuối <SkipForward className="w-4 h-4" />
        </button>
        <button type="button" className="tt-btn tt-btn--ghost tt-btn--sm" onClick={() => setIndex(0)}>
          <RotateCcw className="w-4 h-4" /> Xem lại
        </button>
      </div>

      <input
        type="range"
        className="replay-range"
        min={0}
        max={Math.max(lastIndex, 0)}
        value={index}
        onChange={(event) => setIndex(Number(event.target.value))}
      />

      <div className="replay-status">
        <span>
          Nước <strong>{index}</strong>/{lastIndex} · Lượt:{' '}
          <strong>{frame?.turn === PLAYERS.RED ? 'Đỏ' : 'Xanh'}</strong>
        </span>
        <span className="replay-status__move">{frame?.description}</span>
      </div>

      <div className="replay-dead">
        <span className="tt-small tt-muted">Quân đã mất</span>
        <span className="tt-small">
          Đỏ: {deadPieces.red.length ? deadPieces.red.map((type) => PIECE_LABELS[type]).join(', ') : '—'}
        </span>
        <span className="tt-small">
          Xanh: {deadPieces.blue.length ? deadPieces.blue.map((type) => PIECE_LABELS[type]).join(', ') : '—'}
        </span>
      </div>
    </div>
  );
}
