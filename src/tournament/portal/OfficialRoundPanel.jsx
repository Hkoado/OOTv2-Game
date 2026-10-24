import React, { useEffect, useState } from 'react';
import { Swords } from 'lucide-react';
import { Alert, Badge, Panel, Spinner } from './TournamentUi.jsx';
import { formatDateTime } from './tournamentView.js';
import { fetchOfficialRound, openOfficialRound, syncGithubCutoff } from './officialRoundApi.js';

const shortHash = (value) => (value ? `${String(value).slice(0, 10)}…` : '—');

export default function OfficialRoundPanel({ event, admin, busy, actions }) {
  const [round, setRound] = useState(null);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncSummary, setSyncSummary] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let alive = true;
    if (!admin || !event.competition) { setLoading(false); return () => { alive = false; }; }
    setLoading(true);
    setError('');
    fetchOfficialRound(event.id)
      .then((data) => { if (alive) setRound(data); })
      .catch((err) => { if (alive) setError(err.message || 'Không tải được vòng bảng.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [event.id, event.competition, admin]);

  if (!event.competition) return null;
  if (!admin) return null;

  const cutoff = event.competition.cutoff ? Date.parse(event.competition.cutoff) : NaN;
  const cutoffPassed = Number.isFinite(cutoff) && Date.now() >= cutoff;
  const canOpen = admin && event.status === 'draft' && event.competition.mapsPublished === true
    && cutoffPassed && !opening && !syncing && !busy?.event;

  async function handleSync() {
    setSyncing(true);
    setError('');
    setNotice('');
    try {
      const summary = await syncGithubCutoff(event.id);
      setSyncSummary(summary);
      setNotice(`Đã xếp ${summary.queued} job; bỏ qua ${summary.skipped}; lỗi ${summary.failed.length}.`);
    } catch (err) {
      setError(err.message || 'Không chốt được GitHub.');
    } finally {
      setSyncing(false);
    }
  }

  async function handleOpen() {
    setOpening(true);
    setError('');
    setNotice('');
    try {
      const result = await openOfficialRound(event.id);
      setRound(result.round);
      setNotice(result.alreadyOpen ? 'Vòng bảng đã có; đang dùng snapshot đã khóa.' : 'Đã chốt bài và mở vòng bảng.');
      actions.refresh();
    } catch (err) {
      setError(err.message || 'Không mở được vòng bảng.');
    } finally {
      setOpening(false);
    }
  }

  const action = round ? (
    <Badge tone={round.frozen ? 'success' : 'live'} dot={!round.frozen}>
      {round.frozen ? 'Đã khóa' : 'Đang chạy'}
    </Badge>
  ) : (
    <Badge tone="warning">Chưa mở</Badge>
  );

  return (
    <Panel title="Vòng bảng chính thức" subtitle="Snapshot khóa bot, map, runtime và seed trước khi chấm." actions={action}>
      {loading ? <Spinner label="Đang tải vòng bảng…" /> : null}
      {error && <Alert tone="danger" title="Không thao tác được">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      {!loading && round ? (
        <div className="tt-stack">
          <div className="tt-grid tt-grid--3">
            <div><span className="tt-muted">Tiến độ</span><strong>{round.games.finished}/{round.games.total} ván</strong></div>
            <div><span className="tt-muted">Cutoff</span><strong>{formatDateTime(round.snapshot.cutoff)}</strong></div>
            <div><span className="tt-muted">Snapshot</span><code title={round.snapshot.contentHash}>{shortHash(round.snapshot.contentHash)}</code></div>
          </div>
          {round.next ? (
            <Alert tone="info" title={`Ván kế tiếp · bảng ${round.next.groupName} · ván ${round.next.gameNo}`}>
              <strong>{round.next.red.name}</strong> (Đỏ) <Swords size={14} aria-hidden="true" />{' '}
              <strong>{round.next.blue.name}</strong> (Xanh)
            </Alert>
          ) : (
            <Alert tone="info">Không còn ván kế tiếp hoặc ván trước chưa có kết quả.</Alert>
          )}
        </div>
      ) : null}

      {!loading && !round ? (
        <div className="tt-stack">
          <p className="tt-muted">
            Bước 1: sau cutoff, chốt GitHub một lần cho tất cả repo đã duyệt và để worker tải bài.
            Bước 2: mở vòng bảng để khóa snapshot. Cả hai thao tác đều idempotent.
            {' '}SHA là lần resolve thành công đầu tiên sau cutoff, không phải xác minh HEAD lịch sử tại deadline.
          </p>
          {!event.competition.mapsPublished ? <Alert tone="warning">Cần công bố map pack trước.</Alert> : null}
          {!cutoffPassed ? <Alert tone="warning">Chưa tới cutoff; chưa thể chốt bài.</Alert> : null}
          {admin ? (
            <div className="tt-form__actions">
              <button type="button" className="tt-btn" onClick={handleSync}
                disabled={!canOpen || syncing || busy?.event}>
                {syncing ? 'Đang chốt GitHub…' : '1. Chốt GitHub lúc cutoff'}
              </button>
              <button type="button" className="tt-btn tt-btn--primary" onClick={handleOpen} disabled={!canOpen}>
                {opening ? 'Đang mở…' : '2. Mở vòng bảng'}
              </button>
            </div>
          ) : (
            <p className="tt-muted">Chỉ BTC mới mở được vòng bảng.</p>
          )}
          {syncSummary ? (
            <Alert tone={syncSummary.failed.length ? 'warning' : 'success'}>
              Đã xếp {syncSummary.queued} job, bỏ qua {syncSummary.skipped}, lỗi {syncSummary.failed.length}.
              {' '}Chạy worker tải bài trước khi mở vòng.
            </Alert>
          ) : null}
        </div>
      ) : null}
    </Panel>
  );
}
