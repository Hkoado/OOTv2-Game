import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Clock,
  Eye,
  Loader2,
  Lock,
  Moon,
  Radio,
  Sun,
  Trophy,
  WifiOff,
} from 'lucide-react';
import LiveBoard from './LiveBoard.jsx';
import { fetchLiveEvents, fetchLiveMatch, fetchLiveOverview } from './liveApi.js';
import { fetchViewerPackage } from './publicationApi.js';
import {
  broadcastPhaseMeta,
  calculateCountdown,
  computeViewerProgress,
} from './publicationView.js';
import { appendLiveEvents, findTerminal, formatElapsed, liveStateLabel, moveCount } from './liveView.js';
import { RESULT_LABELS, STAGE_LABELS, TOURNAMENT_STATUS_LABELS, labelOf } from '../../labels.js';

const POLL_MS = 2000;
const HIDDEN_POLL_MS = 6000;

export default function LivePage({ matchId = null, theme, onToggleTheme }) {
  const [overview, setOverview] = useState(null);
  const [overviewError, setOverviewError] = useState('');
  const [isAuthRequired, setIsAuthRequired] = useState(false);
  const [selectedId, setSelectedId] = useState(matchId);
  const [snapshot, setSnapshot] = useState(null);
  const [events, setEvents] = useState([]);
  const [error, setError] = useState('');
  const [now, setNow] = useState(() => Date.now());

  // Scheduled broadcast stream package state (H3)
  const [broadcastInfo, setBroadcastInfo] = useState(null);

  const selectedRef = useRef(selectedId);
  const lastSeqRef = useRef(0);
  selectedRef.current = selectedId;

  // Local ticker for smooth countdown display
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  // Fetch overview of matches
  useEffect(() => {
    let stopped = false;
    let timer = null;

    const tick = async () => {
      try {
        const data = await fetchLiveOverview();
        if (stopped) return;
        setOverview(data);
        setOverviewError('');
        setIsAuthRequired(false);
        if (!selectedRef.current) {
          const next = data.matches?.[0]?.id || data.recent_finished?.[0]?.id || null;
          if (next) setSelectedId(next);
        }
      } catch (caught) {
        if (!stopped) {
          if (caught.status === 401 || caught.code === 'login_required') {
            setIsAuthRequired(true);
          }
          setOverviewError(caught.message || 'Không tải được tổng quan giải.');
        }
      }
      if (!stopped && !isAuthRequired) {
        timer = window.setTimeout(
          tick,
          document.visibilityState === 'hidden' ? HIDDEN_POLL_MS : POLL_MS
        );
      }
    };

    tick();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [isAuthRequired]);

  // When selected match changes: reset stream state and fetch snapshot
  useEffect(() => {
    setSnapshot(null);
    setEvents([]);
    setBroadcastInfo(null);
    setError('');
    lastSeqRef.current = 0;
    if (!selectedId) return undefined;

    let stopped = false;
    fetchLiveMatch(selectedId)
      .then((data) => {
        if (!stopped) setSnapshot(data);
      })
      .catch((caught) => {
        if (!stopped) {
          if (caught.status === 401 || caught.code === 'login_required') {
            setIsAuthRequired(true);
          }
          setError(caught.message || 'Không tải được ván đấu.');
        }
      });

    return () => {
      stopped = true;
    };
  }, [selectedId]);

  // Poll event stream with publication awareness (H3)
  useEffect(() => {
    if (!selectedId || isAuthRequired) return undefined;
    let stopped = false;
    let timer = null;

    const tick = async () => {
      if (document.visibilityState === 'hidden') {
        timer = window.setTimeout(tick, HIDDEN_POLL_MS);
        return;
      }

      let pollInterval = POLL_MS;

      try {
        // Try official scheduled publication stream first
        let streamPkg = null;
        try {
          streamPkg = await fetchViewerPackage(selectedId, lastSeqRef.current);
        } catch (e) {
          if (e.status === 401 || e.code === 'login_required') {
            setIsAuthRequired(true);
            return;
          }
          // If 404 broadcast_not_published or legacy fallback: fallback to fetchLiveEvents
        }

        if (stopped) return;

        if (streamPkg) {
          setBroadcastInfo(streamPkg);

          if (Array.isArray(streamPkg.events) && streamPkg.events.length) {
            setEvents((current) => appendLiveEvents(current, streamPkg.events));
            const maxSeq = Math.max(...streamPkg.events.map((ev) => Number(ev.seq) || 0));
            if (maxSeq > lastSeqRef.current) lastSeqRef.current = maxSeq;
          }

          if (streamPkg.next_poll_ms !== undefined) {
            if (streamPkg.next_poll_ms === null) {
              // Ended or stream complete: stop polling
              return;
            }
            pollInterval = streamPkg.next_poll_ms;
          }
        } else {
          // Standard live events fallback
          const chunk = await fetchLiveEvents(selectedId, lastSeqRef.current);
          if (stopped) return;
          if (chunk.reset) {
            const freshSnapshot = await fetchLiveMatch(selectedId);
            const freshEvents = await fetchLiveEvents(selectedId, 0);
            if (stopped) return;
            setSnapshot(freshSnapshot);
            setEvents(appendLiveEvents([], freshEvents.events || []));
            lastSeqRef.current = Number(freshEvents.latest_seq) || 0;
          } else {
            if (Array.isArray(chunk.events) && chunk.events.length) {
              setEvents((current) => appendLiveEvents(current, chunk.events));
            }
            lastSeqRef.current = Number(chunk.latest_seq) || 0;
          }
        }
        setError('');
      } catch (caught) {
        if (!stopped) setError(caught.message || 'Mất kết nối tới máy chủ giải đấu.');
      }

      if (!stopped) timer = window.setTimeout(tick, pollInterval);
    };

    tick();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [selectedId, isAuthRequired]);

  const event = overview?.event || null;
  const running = overview?.matches || [];
  const recent = overview?.recent_finished || [];
  const match = snapshot?.match || null;
  const terminal = findTerminal(events);

  // Determine finished state & result visibility based on publication (H3)
  const isScheduledBroadcast = Boolean(broadcastInfo);
  const isWaiting = broadcastInfo?.phase === 'waiting';
  const isBroadcasting = broadcastInfo?.phase === 'broadcasting';
  const isEnded = broadcastInfo?.phase === 'ended';
  const finished = isScheduledBroadcast
    ? isEnded
    : match?.status === 'finished' || Boolean(terminal);

  const canRevealResult = isScheduledBroadcast ? broadcastInfo?.reveal_result === true : finished;
  const result = canRevealResult ? (terminal?.result || match?.result || broadcastInfo?.result || null) : null;

  const phaseMeta = isScheduledBroadcast
    ? broadcastPhaseMeta(broadcastInfo.phase, broadcastInfo.reveal_result)
    : { label: liveStateLabel({ status: match?.status, hasInitial: snapshot?.live?.has_initial }), tone: finished ? 'neutral' : 'live' };

  const countdown = useMemo(() => {
    if (!isWaiting || !broadcastInfo?.starts_at) return null;
    return calculateCountdown(broadcastInfo.starts_at, now);
  }, [isWaiting, broadcastInfo?.starts_at, now]);

  const streamProgress = useMemo(() => {
    if (!isScheduledBroadcast) return 0;
    return computeViewerProgress(broadcastInfo?.visible_plies, broadcastInfo?.total_plies);
  }, [isScheduledBroadcast, broadcastInfo?.visible_plies, broadcastInfo?.total_plies]);

  const elapsed = match?.started_at ? formatElapsed(match.started_at, now) : '—';
  const nextMatch = useMemo(() => running.find((item) => item.id !== selectedId) || null, [running, selectedId]);
  const moves = moveCount(events);
  const workerAlive = Boolean(overview?.worker?.alive);

  return (
    <main className="live-page">
      <header className="live-header">
        <a className="tt-brand" href="#/live" aria-label="OOTv2 Live">
          <span className="tt-brand__mark"><Radio size={20} /></span>
          <span className="tt-brand__text"><strong>OOTv2</strong><span>Live Stream</span></span>
        </a>
        <div className="live-header__event">
          <span className="tt-eyebrow">Giải đấu</span>
          <strong>{event?.name || 'Đang cập nhật'}</strong>
          <span className="tt-small tt-muted">
            {event ? labelOf(TOURNAMENT_STATUS_LABELS, event.status) : 'Chờ BTC phát trận'}
          </span>
        </div>
        <div className="live-header__actions">
          <a className="tt-btn tt-btn--ghost tt-btn--sm" href="#/overview">Cổng giải đấu</a>
          {onToggleTheme && (
            <button type="button" className="tt-icon-btn" onClick={onToggleTheme} aria-label="Đổi theme sáng/tối">
              {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
            </button>
          )}
        </div>
      </header>

      {/* Auth required banner (H3 policy) */}
      {isAuthRequired && (
        <div className="tt-alert tt-alert--warning" style={{ margin: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <strong>Yêu cầu đăng nhập</strong>
            <p style={{ margin: '0.25rem 0 0' }}>
              Theo chính sách bảo mật H3 của giải, trang trực tiếp chỉ mở cho tài khoản đội thi đấu thuộc giải hoặc ban tổ chức.
            </p>
          </div>
          <a className="tt-btn tt-btn--primary tt-btn--sm" href="#/overview">
            Đăng nhập ngay
          </a>
        </div>
      )}

      {(overviewError || error) && !isAuthRequired && (
        <p className="tt-alert tt-alert--warning">{error || overviewError}</p>
      )}

      <div className="live-layout">
        <aside className="live-sidebar">
          <div className="live-sidebar__head">
            <h2>Lịch phát & Trực tiếp</h2>
            <span className={`live-pill ${workerAlive ? 'live-pill--on' : 'live-pill--off'}`}>
              {workerAlive ? 'Worker online' : 'Worker offline'}
            </span>
          </div>

          {running.length === 0 ? (
            <p className="tt-small tt-muted">Chưa có ván nào đang phát sóng.</p>
          ) : (
            <ul className="live-match-list">
              {running.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className={`live-match ${item.id === selectedId ? 'live-match--active' : ''}`}
                    onClick={() => setSelectedId(item.id)}
                  >
                    <span className="live-match__stage">{labelOf(STAGE_LABELS, item.stage)} · ván {item.game_no}</span>
                    <span className="live-match__teams">{item.red.name} <em>vs</em> {item.blue.name}</span>
                    <span className="live-match__meta">{item.ply ?? 0} nước · đang phát</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <h3 className="live-sidebar__sub">Ván đã công bố</h3>
          {recent.length === 0 ? (
            <p className="tt-small tt-muted">Chưa có ván nào đã phát xong.</p>
          ) : (
            <ul className="live-match-list live-match-list--muted">
              {recent.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className={`live-match ${item.id === selectedId ? 'live-match--active' : ''}`}
                    onClick={() => setSelectedId(item.id)}
                  >
                    <span className="live-match__stage">{labelOf(STAGE_LABELS, item.stage)} · ván {item.game_no}</span>
                    <span className="live-match__teams">{item.red.name} <em>vs</em> {item.blue.name}</span>
                    <span className="live-match__meta">
                      {item.result ? labelOf(RESULT_LABELS, item.result) : 'Đã phát xong'} · {item.ply_count ?? 0} nước
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="live-sidebar__foot">
            <span className="tt-small tt-muted">
              {overview?.counts?.finished ?? 0}/{overview?.counts?.total ?? 0} ván đã hoàn thành
            </span>
          </div>
        </aside>

        <section className="live-stage" aria-live="polite">
          <div className="live-stage__head">
            <div className="live-stage__title">
              <span className={`tt-badge tt-badge--${phaseMeta.tone}`}>
                <span className="tt-badge__dot" />
                {phaseMeta.label}
              </span>
              <h1>{match ? `${match.red.name} vs ${match.blue.name}` : 'Đang chọn ván đấu'}</h1>
              <p className="tt-small tt-muted">
                {match
                  ? `${labelOf(STAGE_LABELS, match.stage)} · ván ${match.game_no} · ${moves} nước hiển thị · ${elapsed}`
                  : 'Chọn một ván bên danh sách để xem bàn cờ.'}
              </p>
            </div>

            {finished && result && (
              <div className="live-result">
                <Trophy size={18} />
                <strong>{labelOf(RESULT_LABELS, result)}</strong>
              </div>
            )}
          </div>

          {/* Countdown view when waiting for scheduled broadcast starts_at */}
          {isWaiting && countdown && (
            <div
              className="live-countdown-card"
              style={{
                background: 'var(--tt-bg-subtle, #f8fafc)',
                border: '1px solid var(--tt-border, #e2e8f0)',
                borderRadius: '8px',
                padding: '1rem',
                marginBottom: '1rem',
                textAlign: 'center',
              }}
            >
              <Clock size={24} style={{ margin: '0 auto 0.5rem', color: 'var(--tt-accent, #3182ce)' }} />
              <h3 style={{ margin: '0 0 0.25rem' }}>Trận đấu sẽ bắt đầu phát sau:</h3>
              <div style={{ fontSize: '2rem', fontWeight: 'bold', fontFamily: 'monospace', letterSpacing: '2px' }}>
                {countdown.formatted}
              </div>
              <p className="tt-muted" style={{ margin: '0.25rem 0 0', fontSize: '0.85rem' }}>
                Thời điểm phát sóng: {new Date(broadcastInfo.starts_at).toLocaleString('vi-VN')}
              </p>
            </div>
          )}

          {/* Progress bar during live streaming */}
          {isBroadcasting && (
            <div style={{ marginBottom: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '0.25rem' }}>
                <span>Tiến độ phát sóng</span>
                <span>{broadcastInfo.visible_plies} / {broadcastInfo.total_plies} nước ({streamProgress}%)</span>
              </div>
              <div className="tt-progress__track" style={{ height: '6px' }}>
                <span className="tt-progress__fill" style={{ width: `${streamProgress}%` }} />
              </div>
            </div>
          )}

          {nextMatch && finished && (
            <button
              type="button"
              className="tt-btn tt-btn--info tt-btn--block live-next"
              onClick={() => setSelectedId(nextMatch.id)}
            >
              Xem ván tiếp theo: {nextMatch.red.name} vs {nextMatch.blue.name}
            </button>
          )}

          <LiveBoard snapshot={snapshot} events={events} />

          {!overview && !overviewError && !isAuthRequired && (
            <p className="tt-small tt-muted live-loading">
              <Loader2 size={16} className="tt-spinner__icon" /> Đang kết nối máy chủ giải đấu…
            </p>
          )}

          <p className="live-privacy tt-small tt-muted" style={{ marginTop: '1rem' }}>
            {canRevealResult
              ? 'Ván đấu đã kết thúc và công bố đầy đủ kết quả theo lịch phát.'
              : 'Trận đấu đang được chiếu theo nhịp giờ máy chủ. Kết quả và nước cờ tương lai được bảo vệ đến khi phát xong.'}
          </p>
        </section>
      </div>
    </main>
  );
}
