import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Moon, Sun, Trophy, WifiOff } from 'lucide-react';
import LiveBoard from './LiveBoard.jsx';
import { fetchLiveEvents, fetchLiveMatch, fetchLiveOverview } from './liveApi.js';
import { appendLiveEvents, findTerminal, formatElapsed, liveStateLabel, moveCount } from './liveView.js';
import { RESULT_LABELS, STAGE_LABELS, TOURNAMENT_STATUS_LABELS, labelOf } from '../../labels.js';

const POLL_MS = 2000;
const HIDDEN_POLL_MS = 6000;

/**
 * Trang khán giả công khai (`#/live`) — không cần đăng nhập.
 *
 * Poll 2 giây/lần (Cloudflare Tunnel cắt request ở 100 s nên polling an toàn hơn
 * SSE ở giai đoạn này). Dữ liệu chỉ là L1: bàn cờ + nước đi; log bot không được
 * trả về ở API công khai.
 */
export default function LivePage({ matchId = null, theme, onToggleTheme }) {
  const [overview, setOverview] = useState(null);
  const [overviewError, setOverviewError] = useState('');
  const [selectedId, setSelectedId] = useState(matchId);
  const [snapshot, setSnapshot] = useState(null);
  const [events, setEvents] = useState([]);
  const [error, setError] = useState('');
  const [now, setNow] = useState(() => Date.now());

  const selectedRef = useRef(selectedId);
  const lastSeqRef = useRef(0);
  selectedRef.current = selectedId;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  // Tổng quan giải + danh sách ván đang chạy (poll độc lập với ván đang xem).
  useEffect(() => {
    let stopped = false;
    let timer = null;
    const tick = async () => {
      try {
        const data = await fetchLiveOverview();
        if (stopped) return;
        setOverview(data);
        setOverviewError('');
        if (!selectedRef.current) {
          const next = data.matches?.[0]?.id || data.recent_finished?.[0]?.id || null;
          if (next) setSelectedId(next);
        }
      } catch (caught) {
        if (!stopped) setOverviewError(caught.message || 'Không tải được tổng quan giải.');
      }
      if (!stopped) {
        timer = window.setTimeout(tick, document.visibilityState === 'hidden' ? HIDDEN_POLL_MS : POLL_MS);
      }
    };
    tick();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, []);

  // Đổi ván: tải snapshot mới, xoá event cũ để không trộn bàn cờ hai ván.
  useEffect(() => {
    setSnapshot(null);
    setEvents([]);
    setError('');
    lastSeqRef.current = 0;
    if (!selectedId) return undefined;

    let stopped = false;
    fetchLiveMatch(selectedId)
      .then((data) => {
        if (!stopped) setSnapshot(data);
      })
      .catch((caught) => {
        if (!stopped) setError(caught.message || 'Không tải được ván đấu.');
      });
    return () => {
      stopped = true;
    };
  }, [selectedId]);

  // Poll event của ván đang chọn; `reset` xảy ra khi ván được chạy lại.
  useEffect(() => {
    if (!selectedId) return undefined;
    let stopped = false;
    let timer = null;

    const tick = async () => {
      if (document.visibilityState === 'hidden') {
        timer = window.setTimeout(tick, HIDDEN_POLL_MS);
        return;
      }
      try {
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
        setError('');
      } catch (caught) {
        if (!stopped) setError(caught.message || 'Mất kết nối tới máy chủ giải đấu.');
      }
      if (!stopped) timer = window.setTimeout(tick, POLL_MS);
    };

    tick();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [selectedId]);

  const event = overview?.event || null;
  const running = overview?.matches || [];
  const recent = overview?.recent_finished || [];
  const match = snapshot?.match || null;
  const terminal = findTerminal(events);
  const finished = match?.status === 'finished' || Boolean(terminal);
  const result = terminal?.result || match?.result || null;
  const statusLabel = liveStateLabel({ status: match?.status, hasInitial: snapshot?.live?.has_initial });
  const elapsed = match?.started_at ? formatElapsed(match.started_at, now) : '—';
  const nextMatch = useMemo(() => running.find((item) => item.id !== selectedId) || null, [running, selectedId]);
  const moves = moveCount(events);
  const workerAlive = Boolean(overview?.worker?.alive);

  return (
    <main className="live-page">
      <header className="live-header">
        <a className="tt-brand" href="#/live" aria-label="OOTv2 Live">
          <span className="tt-brand__mark"><img src="/logo.png" alt="" /></span>
          <span className="tt-brand__text"><strong>OOTv2</strong><span>Live</span></span>
        </a>
        <div className="live-header__event">
          <span className="tt-eyebrow">Đang diễn ra</span>
          <strong>{event?.name || 'Chưa có giải nào'}</strong>
          <span className="tt-small tt-muted">
            {event ? labelOf(TOURNAMENT_STATUS_LABELS, event.status) : 'Chờ BTC mở giải'}
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

      {(overviewError || error) && <p className="tt-alert tt-alert--warning">{error || overviewError}</p>}

      <div className="live-layout">
        <aside className="live-sidebar">
          <div className="live-sidebar__head">
            <h2>Đang thi đấu</h2>
            <span className={`live-pill ${workerAlive ? 'live-pill--on' : 'live-pill--off'}`}>
              {workerAlive ? 'Worker đang chấm' : 'Worker chưa chạy'}
            </span>
          </div>
          {running.length === 0 ? (
            <p className="tt-small tt-muted">Hiện không có ván nào đang chạy.</p>
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
                    <span className="live-match__meta">{item.ply} nước · đang đấu</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <h3 className="live-sidebar__sub">Ván đã xong</h3>
          {recent.length === 0 ? (
            <p className="tt-small tt-muted">Chưa có ván nào kết thúc.</p>
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
                    <span className="live-match__meta">{labelOf(RESULT_LABELS, item.result)} · {item.ply_count ?? 0} nước</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="live-sidebar__foot">
            <span className="tt-small tt-muted">
              Tổng {overview?.counts?.total ?? 0} ván · xong {overview?.counts?.finished ?? 0} · chờ{' '}
              {overview?.counts?.pending ?? 0}
            </span>
          </div>
        </aside>

        <section className="live-stage" aria-live="polite">
          <div className="live-stage__head">
            <div className="live-stage__title">
              <span className={`tt-badge ${finished ? 'tt-badge' : 'tt-badge tt-badge--live'}`}>
                <span className="tt-badge__dot" />
                {statusLabel}
              </span>
              <h1>{match ? `${match.red.name} vs ${match.blue.name}` : 'Đang chọn ván đấu'}</h1>
              <p className="tt-small tt-muted">
                {match
                  ? `${labelOf(STAGE_LABELS, match.stage)} · ván ${match.game_no} · ${moves} nước · ${elapsed}`
                  : 'Bấm một ván bên trái để xem bàn cờ.'}
              </p>
            </div>
            {finished && result && (
              <div className="live-result">
                <Trophy size={18} />
                <strong>{labelOf(RESULT_LABELS, result)}</strong>
              </div>
            )}
          </div>

          {nextMatch && finished && (
            <button
              type="button"
              className="tt-btn tt-btn--info tt-btn--block live-next"
              onClick={() => setSelectedId(nextMatch.id)}
            >
              Xem trận tiếp theo: {nextMatch.red.name} vs {nextMatch.blue.name}
            </button>
          )}

          <LiveBoard snapshot={snapshot} events={events} />

          {!overview && !overviewError && (
            <p className="tt-small tt-muted live-loading">
              <Loader2 size={16} className="tt-spinner__icon" /> Đang kết nối máy chủ giải đấu…
            </p>
          )}
          {!workerAlive && overview && (
            <p className="tt-alert tt-alert--warning">
              <WifiOff size={16} /> Worker chấm bài chưa chạy hoặc vừa dừng: bàn cờ sẽ đứng yên cho tới khi BTC khởi
              động lại worker.
            </p>
          )}

          <p className="live-privacy tt-small tt-muted">
            Khán giả xem công khai bàn cờ và nước đi. Log bot (stdout/stderr) chỉ đội sở hữu và BTC xem được.
          </p>
        </section>
      </div>
    </main>
  );
}
