import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Clock,
  Eye,
  Play,
  Pause,
  RotateCcw,
  SkipBack,
  SkipForward,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  Radio,
  CheckCircle2,
  X,
} from 'lucide-react';
import { Alert, Badge, Progress, Spinner } from './TournamentUi.jsx';
import GameBoard from '../../ui/GameBoard.jsx';
import { buildReplayFrames } from '../replay.js';
import { RESULT_LABELS, REASON_LABELS, labelOf } from '../labels.js';
import { fetchOfficialGameViewer } from './officialRoundApi.js';
import { formatDateTime } from './tournamentView.js';

export default function OfficialGameViewer({ roundPk, gameKey, game, map, onClose, admin }) {
  const [data, setData] = useState(null); // Last server packet
  const [accumulatedEvents, setAccumulatedEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [authError, setAuthError] = useState(false);
  const [scopeError, setScopeError] = useState(false);
  const [notPublished, setNotPublished] = useState(false);

  // Playback / frame cursor
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const lastSeqRef = useRef(0);

  // Poll controller
  const [pollMs, setPollMs] = useState(2000);
  const [reconnecting, setReconnecting] = useState(false);

  // Countdown seconds based on server_time and starts_at
  const countdown = useMemo(() => {
    if (!data?.starts_at || !data?.server_time) return null;
    const startMs = Date.parse(data.starts_at);
    const serverMs = Date.parse(data.server_time);
    if (!Number.isFinite(startMs) || !Number.isFinite(serverMs)) return null;
    const diffSec = Math.ceil((startMs - serverMs) / 1000);
    return diffSec > 0 ? diffSec : 0;
  }, [data?.starts_at, data?.server_time]);

  // Build replay frames solely from accumulated events returned by server (NEVER load full hidden replay)
  const syntheticReplay = useMemo(() => {
    return {
      schemaVersion: 'campus-engine-replay.v1',
      map: map || null,
      events: accumulatedEvents,
      result: data?.reveal_result ? data?.result : null,
      terminationReason: data?.reveal_result ? data?.terminationReason : null,
    };
  }, [accumulatedEvents, map, data?.reveal_result, data?.result, data?.terminationReason]);

  const parsed = useMemo(() => buildReplayFrames(syntheticReplay), [syntheticReplay]);
  const frames = parsed.frames || [];
  const maxFrame = Math.max(0, frames.length - 1);
  const currentFrame = frames[Math.min(frameIndex, maxFrame)] || frames[0];

  // Reset / Reconnect function
  const handleResetReconnect = () => {
    setReconnecting(true);
    lastSeqRef.current = 0;
    setAccumulatedEvents([]);
    setFrameIndex(0);
    setPlaying(false);
    setError('');
    setAuthError(false);
    setScopeError(false);
    setNotPublished(false);
    fetchData(0).finally(() => setReconnecting(false));
  };

  const fetchData = async (afterSeq) => {
    try {
      const res = await fetchOfficialGameViewer(roundPk, gameKey, afterSeq);
      if (!res) return;

      setData(res);
      setLoading(false);
      setError('');
      setNotPublished(false);
      setScopeError(false);

      if (Array.isArray(res.events) && res.events.length > 0) {
        setAccumulatedEvents((prev) => {
          const mapById = new Map(prev.map((e) => [e.seq, e]));
          for (const ev of res.events) {
            mapById.set(ev.seq, ev);
          }
          const merged = Array.from(mapById.values()).sort((a, b) => (a.seq || 0) - (b.seq || 0));
          const maxSeq = Math.max(...merged.map((e) => e.seq || 0));
          if (maxSeq > lastSeqRef.current) lastSeqRef.current = maxSeq;
          return merged;
        });

        // Auto move cursor forward if already at the latest frame
        setFrameIndex((current) => (current >= maxFrame ? maxFrame + res.events.length : current));
      }

      if (res.next_poll_ms !== undefined) {
        setPollMs(res.next_poll_ms);
      }
    } catch (err) {
      setLoading(false);
      if (err?.status === 401 || err?.code === 'login_required') {
        setAuthError(true);
      } else if (err?.status === 403 || err?.code === 'scope_denied') {
        setScopeError(true);
      } else if (err?.status === 404 || err?.code === 'broadcast_not_published') {
        setNotPublished(true);
      } else {
        setError(err.message || 'Lỗi kết nối máy chủ phát sóng.');
      }
    }
  };

  // Initial fetch and polling loop
  useEffect(() => {
    let alive = true;
    let timer = null;

    const poll = async () => {
      if (!alive) return;
      if (document.visibilityState === 'hidden') {
        timer = window.setTimeout(poll, 6000);
        return;
      }

      await fetchData(lastSeqRef.current);

      if (!alive) return;

      // Stop polling if server signals null (ended or stream closed)
      if (pollMs === null || data?.phase === 'canceled') {
        return;
      }

      const delay = Math.max(1000, Number(pollMs) || 2000);
      timer = window.setTimeout(poll, delay);
    };

    poll();

    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [roundPk, gameKey, pollMs, data?.phase]);

  // Auto-playback of frames
  useEffect(() => {
    if (!playing || frameIndex >= maxFrame) return undefined;
    const interval = setTimeout(() => {
      setFrameIndex((cur) => Math.min(cur + 1, maxFrame));
    }, 700);
    return () => clearTimeout(interval);
  }, [playing, frameIndex, maxFrame]);

  // Auto pause when reaching the end of available plies
  useEffect(() => {
    if (frameIndex >= maxFrame && playing) {
      setPlaying(false);
    }
  }, [frameIndex, maxFrame, playing]);

  return (
    <div
      className="tt-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="official-viewer-title"
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
    >
      <div className="tt-modal" style={{ maxWidth: '880px', width: '95%', maxHeight: '92vh', overflowY: 'auto' }}>
        <header className="tt-modal__head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <h2 id="official-viewer-title" className="tt-modal__title" style={{ margin: 0, fontSize: '1.25rem' }}>
                Phát sóng chính thức · {gameKey}
              </h2>
              {data?.phase && (
                <Badge
                  tone={data.phase === 'broadcasting' ? 'live' : data.phase === 'ended' ? 'success' : 'warning'}
                  dot={data.phase === 'broadcasting'}
                >
                  {data.phase === 'waiting'
                    ? 'Chờ phát sóng'
                    : data.phase === 'broadcasting'
                    ? 'Đang phát sóng'
                    : data.phase === 'ended'
                    ? 'Đã kết thúc'
                    : 'Đã hủy'}
                </Badge>
              )}
            </div>
            <p className="tt-muted" style={{ margin: '0.25rem 0 0', fontSize: '0.85rem' }}>
              Vòng đấu: <code>{roundPk.slice(0, 8)}…</code> · Giờ máy chủ: {formatDateTime(data?.server_time)}
            </p>
          </div>
          <button type="button" className="tt-icon-btn" onClick={onClose} aria-label="Đóng">
            <X size={18} />
          </button>
        </header>

        {/* State Handlers */}
        {loading && <Spinner label="Đang kết nối luồng phát sóng máy chủ…" />}
        {authError && <Alert tone="danger" title="Yêu cầu đăng nhập">Bạn cần đăng nhập để xem phát sóng ván đấu chính thức.</Alert>}
        {scopeError && <Alert tone="danger" title="Từ chối truy cập">Bạn không thuộc danh sách thành viên của giải đấu này.</Alert>}
        {notPublished && (
          <Alert tone="warning" title="Chưa phát sóng">
            Ván đấu này chưa được Ban tổ chức công bố hoặc chưa bắt đầu giờ phát sóng.
          </Alert>
        )}
        {error && <Alert tone="danger" title="Lỗi">{error}</Alert>}

        {!loading && !authError && !scopeError && !notPublished && data && (
          <div className="tt-stack" style={{ gap: '1rem', marginTop: '1rem' }}>
            {/* Phase 1: Waiting & Countdown */}
            {data.phase === 'waiting' && (
              <div
                style={{
                  textAlign: 'center',
                  padding: '2rem 1rem',
                  backgroundColor: 'var(--bg-subtle, rgba(255,255,255,0.03))',
                  borderRadius: '8px',
                  border: '1px dashed var(--border, #444)',
                }}
              >
                <Clock size={36} style={{ color: 'var(--color-primary, #3182ce)', marginBottom: '0.5rem' }} />
                <h3 style={{ fontSize: '1.25rem', fontWeight: 600, margin: '0 0 0.5rem' }}>
                  Ván đấu sắp phát sóng
                </h3>
                <p className="tt-muted" style={{ margin: 0 }}>
                  Giờ bắt đầu: <strong>{formatDateTime(data.starts_at)}</strong> (theo giờ server)
                </p>
                {countdown !== null && countdown > 0 && (
                  <div style={{ marginTop: '1rem' }}>
                    <span style={{ fontSize: '2rem', fontWeight: 700, fontFamily: 'monospace', color: 'var(--color-primary, #3182ce)' }}>
                      {countdown}s
                    </span>
                    <p className="tt-muted" style={{ fontSize: '0.85rem' }}>Đang đếm ngược tới giờ khởi chiếu…</p>
                  </div>
                )}
              </div>
            )}

            {/* Phase 2: Live Stream or Ended Board */}
            {(data.phase === 'broadcasting' || data.phase === 'ended') && (
              <div className="tt-stack" style={{ gap: '0.75rem' }}>
                {/* Meta stats bar */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <div>
                    <span className="tt-muted">Tiến độ nước đi: </span>
                    <strong>{data.visible_plies || 0} / {data.total_plies || '—'} plies</strong>
                    <span className="tt-muted" style={{ marginLeft: '0.75rem' }}>Nước đang xem: </span>
                    <strong>{frameIndex}/{maxFrame}</strong>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <button
                      type="button"
                      className="tt-btn tt-btn--sm tt-btn--ghost"
                      onClick={handleResetReconnect}
                      disabled={reconnecting}
                    >
                      <RotateCcw size={12} style={{ marginRight: '3px' }} />
                      {reconnecting ? 'Đang nạp lại…' : 'Kết nối lại (Catch-up)'}
                    </button>
                    {data.reveal_result ? (
                      <Badge tone="success">
                        Kết quả: {labelOf(RESULT_LABELS, data.result)}
                      </Badge>
                    ) : (
                      <Badge tone="neutral">Kết quả: Đang bảo mật</Badge>
                    )}
                  </div>
                </div>

                {/* Progress track */}
                <Progress
                  value={data.total_plies > 0 ? Math.round(((data.visible_plies || 0) / data.total_plies) * 100) : 0}
                  label="Đồng bộ tiến độ phát sóng"
                />

                {/* Board display */}
                <div style={{ display: 'flex', justifyContent: 'center', padding: '0.5rem 0' }}>
                  <div style={{ width: '100%', maxWidth: '440px' }}>
                    <GameBoard
                      gameState={currentFrame}
                      map={map || syntheticReplay.map}
                      readOnly={true}
                    />
                  </div>
                </div>

                {/* Playback Controls */}
                <div className="tt-form__actions" style={{ justifyContent: 'center', display: 'flex', gap: '0.5rem' }}>
                  <button
                    type="button"
                    className="tt-btn tt-btn--sm"
                    onClick={() => { setPlaying(false); setFrameIndex(0); }}
                    disabled={frameIndex === 0}
                    title="Về nước đầu tiên"
                  >
                    <SkipBack size={14} />
                  </button>
                  <button
                    type="button"
                    className="tt-btn tt-btn--sm"
                    onClick={() => { setPlaying(false); setFrameIndex((i) => Math.max(0, i - 1)); }}
                    disabled={frameIndex === 0}
                    title="Lùi 1 nước"
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <button
                    type="button"
                    className={`tt-btn tt-btn--sm ${playing ? 'tt-btn--warning' : 'tt-btn--success'}`}
                    onClick={() => setPlaying(!playing)}
                    disabled={frameIndex >= maxFrame}
                    title={playing ? 'Tạm dừng' : 'Tự động phát'}
                  >
                    {playing ? <Pause size={14} /> : <Play size={14} />}
                  </button>
                  <button
                    type="button"
                    className="tt-btn tt-btn--sm"
                    onClick={() => { setPlaying(false); setFrameIndex((i) => Math.min(maxFrame, i + 1)); }}
                    disabled={frameIndex >= maxFrame}
                    title="Tiến 1 nước"
                  >
                    <ChevronRight size={14} />
                  </button>
                  <button
                    type="button"
                    className="tt-btn tt-btn--sm"
                    onClick={() => { setPlaying(false); setFrameIndex(maxFrame); }}
                    disabled={frameIndex >= maxFrame}
                    title="Tới nước mới nhất đã nhận"
                  >
                    <SkipForward size={14} />
                  </button>
                </div>

                {/* Move description */}
                <p className="tt-muted" style={{ textAlign: 'center', fontSize: '0.85rem', margin: 0 }}>
                  {currentFrame.description || 'Thế cờ trận đấu'}
                </p>

                {/* Final result badge only when revealed */}
                {data.reveal_result && data.result && (
                  <Alert tone="success" title="Trận đấu hoàn tất">
                    Kết quả chính thức: <strong>{labelOf(RESULT_LABELS, data.result)}</strong>
                    {data.terminationReason && <span> ({labelOf(REASON_LABELS, data.terminationReason)})</span>}
                  </Alert>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
