import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Award,
  CheckCircle,
  CheckCircle2,
  ChevronRight,
  Clock,
  Eye,
  GitCommit,
  Play,
  Radio,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Snowflake,
  Swords,
  Trophy,
  Video,
  XCircle,
} from 'lucide-react';
import { Alert, Badge, ConfirmAction, DataTable, Field, Panel, Progress, Spinner } from './TournamentUi.jsx';
import { formatDateTime } from './tournamentView.js';
import {
  cancelOfficialJob,
  fetchOfficialBracket,
  fetchOfficialCutoffStatus,
  fetchOfficialProgress,
  fetchOfficialPublishedBracket,
  fetchOfficialPublishedGames,
  fetchOfficialPublishedStandings,
  fetchOfficialPublishedTickets,
  fetchOfficialRound,
  fetchOfficialStandings,
  fetchOfficialTickets,
  freezeOfficialRound,
  openNextKnockoutSeries,
  openOfficialRound,
  publishNextOfficialGame,
  requeueOfficialJob,
  syncGithubCutoff,
} from './officialRoundApi.js';
import OfficialBroadcastDialog from './OfficialBroadcastDialog.jsx';
import OfficialGameViewer from './OfficialGameViewer.jsx';

const shortHash = (value) => (value ? `${String(value).slice(0, 10)}…` : '—');

const STAGE_LABELS = {
  round16: 'Vòng 16',
  quarterfinal: 'Tứ kết',
  semifinal: 'Bán kết',
  third_place: 'Tranh hạng ba',
  final: 'Chung kết',
};

export default function OfficialRoundPanel({ event, teams = [], admin, busy, actions }) {
  const [round, setRound] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState(() => (admin ? 'progress' : 'standings')); // 'progress' | 'standings' | 'bracket' | 'tickets' | 'games'

  // Sub-data states (§7)
  const [progress, setProgress] = useState(null);
  const [standings, setStandings] = useState(null);
  const [bracket, setBracket] = useState(null);
  const [tickets, setTickets] = useState(null);
  const [publishedGames, setPublishedGames] = useState(null);

  // Cutoff status state (Mục 2)
  const [cutoffStatus, setCutoffStatus] = useState(null);
  const [loadingCutoff, setLoadingCutoff] = useState(false);

  // Action states
  const [opening, setOpening] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [freezing, setFreezing] = useState(false);
  const [openingBracket, setOpeningBracket] = useState(false);
  const [syncSummary, setSyncSummary] = useState(null);

  // Error & Notice feedback
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Job action modal (Cancel / Requeue with mandatory reason)
  const [jobModal, setJobModal] = useState(null); // { type: 'cancel' | 'requeue', jobId: string, gameKey: string }
  const [jobReason, setJobReason] = useState('');
  const [jobReasonError, setJobReasonError] = useState('');
  const [submittingJobAction, setSubmittingJobAction] = useState(false);

  // Official Broadcast & Viewer Modals (§7 Publication)
  const [broadcastModal, setBroadcastModal] = useState(null); // { open: boolean, roundPk: string, gameKey: string, game: object }
  const [viewerModal, setViewerModal] = useState(null); // { open: boolean, roundPk: string, gameKey: string, game: object }

  // Map participantId -> name
  const teamNames = useMemo(() => {
    const map = new Map();
    if (Array.isArray(event?.entries)) {
      for (const entry of event.entries) {
        if (entry.participant_id) {
          map.set(entry.participant_id, entry.participant_name || entry.participant_id);
        }
      }
    }
    if (Array.isArray(teams)) {
      for (const team of teams) {
        if (team.id) {
          map.set(team.id, team.name || map.get(team.id) || team.id);
        }
      }
    }
    return map;
  }, [event?.entries, teams]);

  const getTeamName = (id) => (id ? teamNames.get(id) || `${id.slice(0, 8)}…` : '—');

  // Load basic official round overview (admin only)
  const loadRoundOverview = async (signal) => {
    if (!admin) return null;
    try {
      const data = await fetchOfficialRound(event.id, { signal });
      setRound(data);
      return data;
    } catch (err) {
      setError(err.message || 'Không tải được vòng bảng.');
      return null;
    }
  };

  // Load cutoff status (admin only)
  const loadCutoffStatus = async (signal) => {
    if (!admin) return null;
    setLoadingCutoff(true);
    try {
      const st = await fetchOfficialCutoffStatus(event.id, { signal });
      setCutoffStatus(st);
      return st;
    } catch {
      // Ignored if not found
      return null;
    } finally {
      setLoadingCutoff(false);
    }
  };

  // Load detailed §7 data when tab changes or refreshed
  const loadSectionData = async (tab, signal) => {
    setError('');
    try {
      if (admin) {
        // Luồng Admin
        if (tab === 'progress') {
          const prog = await fetchOfficialProgress(event.id, { signal });
          setProgress(prog);
          await loadCutoffStatus(signal);
        } else if (tab === 'standings') {
          const st = await fetchOfficialStandings(event.id, { signal });
          setStandings(st);
        } else if (tab === 'bracket') {
          const br = await fetchOfficialBracket(event.id, { signal });
          setBracket(br);
        } else if (tab === 'tickets') {
          const tk = await fetchOfficialTickets(event.id, { signal });
          setTickets(tk);
        }
      } else {
        // Luồng Đội thi / Thành viên giải (kết quả đã công bố)
        if (tab === 'standings') {
          const st = await fetchOfficialPublishedStandings(event.id, { signal });
          setStandings(st);
        } else if (tab === 'bracket') {
          const br = await fetchOfficialPublishedBracket(event.id, { signal });
          setBracket(br);
        } else if (tab === 'tickets') {
          const tk = await fetchOfficialPublishedTickets(event.id, { signal });
          setTickets(tk);
        } else if (tab === 'games') {
          const gms = await fetchOfficialPublishedGames(event.id, { signal });
          setPublishedGames(gms);
        }
      }
    } catch (err) {
      if (err?.status !== 404 && err?.status !== 409) {
        setError(err.message || 'Lỗi khi tải dữ liệu mục.');
      }
    }
  };

  useEffect(() => {
    let alive = true;
    if (!event?.competition) {
      setLoading(false);
      return () => { alive = false; };
    }
    setLoading(true);
    setError('');

    const controller = new AbortController();
    const init = admin
      ? loadRoundOverview(controller.signal).then(() => {
          if (alive) return loadSectionData(activeTab, controller.signal);
        })
      : loadSectionData(activeTab, controller.signal);

    Promise.resolve(init).finally(() => {
      if (alive) setLoading(false);
    });

    return () => {
      alive = false;
      controller.abort();
    };
  }, [event?.id, event?.competition, admin, activeTab]);

  if (!event?.competition) return null;

  const cutoff = event.competition.cutoff ? Date.parse(event.competition.cutoff) : NaN;
  const cutoffPassed = Number.isFinite(cutoff) && Date.now() >= cutoff;
  const canOpen = admin && event.status === 'draft' && event.competition.mapsPublished === true
    && cutoffPassed && !opening && !syncing && !busy?.event;

  // Handler: Sync GitHub at cutoff (All or targeted retry)
  async function handleSync(teamIds = null) {
    setSyncing(true);
    setError('');
    setNotice('');
    try {
      const summary = await syncGithubCutoff(event.id, { teamIds });
      setSyncSummary(summary);
      const status = await fetchOfficialCutoffStatus(event.id);
      if (status) setCutoffStatus(status);
      else setCutoffStatus(null);
      const failed = summary.failed?.length || 0;
      const remaining = Number.isFinite(status?.pending_count)
        ? status.pending_count
        : Number.isFinite(summary.remaining) ? summary.remaining : null;
      if (summary.complete === true && status?.complete !== false && remaining === 0 && failed === 0) {
        setNotice(`Đã ghim toàn bộ: thêm ${summary.queued} đội; bỏ qua ${summary.skipped}.`);
      } else if (summary.budget_exhausted || remaining > 0 || failed > 0 || status?.busy_count > 0) {
        const stillPending = remaining ?? 'chưa xác định';
        setNotice(`Batch này đã xử lý ${summary.queued}; bỏ qua ${summary.skipped}; lỗi ${failed}; còn ${stillPending} đội chưa ghim. Hãy làm mới hoặc retry batch tiếp theo.`);
      } else {
        setNotice(`Batch này đã xử lý ${summary.queued}; bỏ qua ${summary.skipped}. Chưa có xác nhận authoritative rằng toàn bộ đội đã ghim; hãy làm mới tiến độ.`);
      }
      if (!status) setError('Không tải lại được trạng thái authoritative cutoff. Kết quả batch chưa xác nhận đầy đủ; hãy làm mới tiến độ.');
    } catch (err) {
      setError(err.message || 'Không chốt được GitHub.');
    } finally {
      setSyncing(false);
    }
  }

  // Handler: Open Official Round
  async function handleOpen() {
    setOpening(true);
    setError('');
    setNotice('');
    try {
      const result = await openOfficialRound(event.id);
      setRound(result.round);
      setNotice(result.alreadyOpen ? 'Vòng bảng đã có; đang dùng snapshot đã khóa.' : 'Đã chốt bài và mở vòng bảng.');
      await loadSectionData('progress');
      if (actions?.refresh) actions.refresh();
    } catch (err) {
      setError(err.message || 'Không mở được vòng bảng.');
    } finally {
      setOpening(false);
    }
  }

  // Handler §7: Publish Next Game
  async function handlePublishNext() {
    setPublishing(true);
    setError('');
    setNotice('');
    try {
      const result = await publishNextOfficialGame(event.id);
      if (result.status === 'published') {
        setNotice(`Đã phát ván ${result.game?.gameKey} (${result.game?.groupName || ''}) và xếp vào hàng đợi.`);
      } else if (result.status === 'pending') {
        setNotice(`Ván ${result.game?.gameKey} đang chờ xử lý; đã xếp lại job.`);
      } else if (result.status === 'frozen') {
        setNotice('Vòng bảng đã đóng băng (frozen); không thể phát thêm ván.');
      } else if (result.status === 'complete') {
        setNotice('Tất cả ván vòng bảng đã được phát hoàn tất.');
      }
      await loadRoundOverview();
      await loadSectionData('progress');
    } catch (err) {
      setError(err.message || 'Không phát được ván kế tiếp.');
    } finally {
      setPublishing(false);
    }
  }

  // Handler §7: Freeze Round
  async function handleFreezeRound() {
    setFreezing(true);
    setError('');
    setNotice('');
    try {
      const result = await freezeOfficialRound(event.id);
      setNotice(`Đã đóng băng vòng bảng thành công (${result.expectedGames || 0} ván).`);
      await loadRoundOverview();
      await loadSectionData('progress');
    } catch (err) {
      setError(err.message || 'Không thể đóng băng vòng bảng.');
    } finally {
      setFreezing(false);
    }
  }

  // Handler §7: Open Next Knockout Series
  async function handleOpenBracketNext() {
    setOpeningBracket(true);
    setError('');
    setNotice('');
    try {
      const result = await openNextKnockoutSeries(event.id);
      if (result.status === 'opened') {
        setNotice(`Đã mở series ${result.matchId} (${result.roundId || ''}) và phát ván đầu tiên.`);
      } else if (result.status === 'advanced') {
        setNotice(`Đã phát ván kế tiếp cho series ${result.matchId}.`);
      } else if (result.status === 'bracket_complete') {
        setNotice('Toàn bộ nhánh Knockout đã hoàn tất.');
      } else if (result.status === 'blocked') {
        setNotice(`Chưa thể mở series kế tiếp: ${result.message || 'Đang chờ các cặp trước.'}`);
      }
      await loadSectionData('bracket');
    } catch (err) {
      setError(err.message || 'Không thể mở/tiến series knockout.');
    } finally {
      setOpeningBracket(false);
    }
  }

  // Handler §7: Confirm Job Action (Cancel or Requeue with mandatory reason)
  async function handleConfirmJobAction(e) {
    e.preventDefault();
    setJobReasonError('');
    const trimmed = (jobReason || '').trim();
    if (trimmed.length < 5 || trimmed.length > 400) {
      setJobReasonError('Lý do thao tác phải từ 5 đến 400 ký tự.');
      return;
    }

    setSubmittingJobAction(true);
    try {
      if (jobModal.type === 'cancel') {
        await cancelOfficialJob(jobModal.jobId, trimmed);
        setNotice(`Đã hủy job ${jobModal.gameKey} thành công (Lý do: "${trimmed}").`);
      } else if (jobModal.type === 'requeue') {
        await requeueOfficialJob(jobModal.jobId, trimmed);
        setNotice(`Đã xếp lại job ${jobModal.gameKey} thành công (Lý do: "${trimmed}").`);
      }
      setJobModal(null);
      await loadRoundOverview();
      await loadSectionData('progress');
    } catch (err) {
      setJobReasonError(err.message || 'Thao tác job thất bại.');
    } finally {
      setSubmittingJobAction(false);
    }
  }

  const actionBadge = round ? (
    <Badge tone={round.frozen ? 'success' : 'live'} dot={!round.frozen}>
      {round.frozen ? 'Đã khóa' : 'Đang chạy'}
    </Badge>
  ) : (
    <Badge tone="warning">Chưa mở</Badge>
  );

  return (
    <Panel
      title={admin ? 'Vòng đấu chính thức (K2 / K3)' : 'Kết quả thi đấu chính thức (Official Results)'}
      subtitle={
        admin
          ? 'Quản lý tiến độ vòng bảng, phát ván, bảng xếp hạng server và nhánh knockout chính thức.'
          : 'Bảng xếp hạng, nhánh knockout, vé chung kết và các luồng phát sóng trực tiếp từ Ban tổ chức.'
      }
      actions={actionBadge}
    >
      {loading ? <Spinner label="Đang nạp dữ liệu vòng chính thức…" /> : null}
      {error && <Alert tone="danger" title="Lỗi thao tác">{error}</Alert>}
      {notice && <Alert tone="success" onClose={() => setNotice('')}>{notice}</Alert>}

      {!loading ? (
        <div className="tt-stack">
          {/* Navigation Sub-Tabs */}
          <div className="tt-tabs-nav" style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid var(--border, #333)', paddingBottom: '0.5rem', flexWrap: 'wrap' }}>
            {admin && (
              <button
                type="button"
                className={`tt-btn tt-btn--sm ${activeTab === 'progress' ? 'tt-btn--primary' : 'tt-btn--ghost'}`}
                onClick={() => setActiveTab('progress')}
              >
                <Swords size={14} style={{ marginRight: '4px' }} />
                Tiến độ & Điều hành
              </button>
            )}
            <button
              type="button"
              className={`tt-btn tt-btn--sm ${activeTab === 'standings' ? 'tt-btn--primary' : 'tt-btn--ghost'}`}
              onClick={() => setActiveTab('standings')}
            >
              <Trophy size={14} style={{ marginRight: '4px' }} />
              Bảng xếp hạng
            </button>
            <button
              type="button"
              className={`tt-btn tt-btn--sm ${activeTab === 'bracket' ? 'tt-btn--primary' : 'tt-btn--ghost'}`}
              onClick={() => setActiveTab('bracket')}
            >
              <GitCommit size={14} style={{ marginRight: '4px' }} />
              Nhánh Knockout
            </button>
            <button
              type="button"
              className={`tt-btn tt-btn--sm ${activeTab === 'tickets' ? 'tt-btn--primary' : 'tt-btn--ghost'}`}
              onClick={() => setActiveTab('tickets')}
            >
              <Award size={14} style={{ marginRight: '4px' }} />
              Vé chung kết
            </button>
            {!admin && (
              <button
                type="button"
                className={`tt-btn tt-btn--sm ${activeTab === 'games' ? 'tt-btn--primary' : 'tt-btn--ghost'}`}
                onClick={() => setActiveTab('games')}
              >
                <Video size={14} style={{ marginRight: '4px' }} />
                Trực tiếp & Phát sóng
              </button>
            )}
          </div>

          {/* TAB 1 (Admin-only): PROGRESS & CONTROL */}
          {admin && activeTab === 'progress' && (
            <div className="tt-stack" style={{ gap: '1rem' }}>
              {round ? (
                <>
                  <div className="tt-grid tt-grid--3">
                    <div>
                      <span className="tt-muted">Tiến độ ván đấu</span>
                      <strong>{round.games?.finished || 0}/{round.games?.total || 0} ván</strong>
                    </div>
                    <div>
                      <span className="tt-muted">Thời điểm Cutoff</span>
                      <strong>{formatDateTime(round.snapshot?.cutoff)}</strong>
                    </div>
                    <div>
                      <span className="tt-muted">Mã Snapshot</span>
                      <code title={round.snapshot?.contentHash}>{shortHash(round.snapshot?.contentHash)}</code>
                    </div>
                  </div>

                  {/* Progress bar */}
                  <Progress
                    value={round.games?.total > 0 ? Math.round(((round.games?.finished || 0) / round.games.total) * 100) : 0}
                    label="Tiến độ hoàn thành vòng bảng"
                  />

                  {/* Job Breakdown if loaded */}
                  {progress?.jobs && (
                    <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
                      <span className="tt-muted">Hàng đợi Jobs:</span>
                      <Badge tone="neutral">Tổng: {progress.jobs.total}</Badge>
                      {Object.entries(progress.jobs.byStatus || {}).map(([st, cnt]) => (
                        <Badge
                          key={st}
                          tone={st === 'finished' ? 'success' : st === 'failed' ? 'danger' : st === 'running' ? 'live' : 'info'}
                        >
                          {st}: {cnt}
                        </Badge>
                      ))}
                    </div>
                  )}

                  {/* Pending Game Highlight with Live Broadcast action */}
                  {progress?.pending ? (
                    <Alert tone="live" title={`Ván đang phát / chờ chấm: ${progress.pending.gameKey}`}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                        <div>
                          Bảng {progress.pending.groupName || '—'} · Ván {progress.pending.gameNo || '—'}:{' '}
                          <strong>{getTeamName(progress.pending.redParticipantId)}</strong> (Đỏ) vs{' '}
                          <strong>{getTeamName(progress.pending.blueParticipantId)}</strong> (Xanh) · Seed: {progress.pending.seed}
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <button
                            type="button"
                            className="tt-btn tt-btn--info tt-btn--sm"
                            onClick={() => setViewerModal({ roundPk: round.roundId, gameKey: progress.pending.gameKey, game: progress.pending })}
                          >
                            <Eye size={12} style={{ marginRight: '3px' }} />
                            Xem phát sóng (Live)
                          </button>
                          <button
                            type="button"
                            className="tt-btn tt-btn--sm tt-btn--ghost"
                            onClick={() => setBroadcastModal({ roundPk: round.roundId, gameKey: progress.pending.gameKey, game: progress.pending })}
                          >
                            <Radio size={12} style={{ marginRight: '3px' }} />
                            Lịch phát
                          </button>
                        </div>
                      </div>
                    </Alert>
                  ) : round.next ? (
                    <Alert tone="info" title={`Ván kế tiếp trong lịch: ${round.next.gameKey}`}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                        <div>
                          Bảng {round.next.groupName} · Ván {round.next.gameNo}:{' '}
                          <strong>{round.next.red?.name || getTeamName(round.next.redParticipantId)}</strong> (Đỏ) vs{' '}
                          <strong>{round.next.blue?.name || getTeamName(round.next.blueParticipantId)}</strong> (Xanh)
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <button
                            type="button"
                            className="tt-btn tt-btn--info tt-btn--sm"
                            onClick={() => setViewerModal({ roundPk: round.roundId, gameKey: round.next.gameKey, game: round.next })}
                          >
                            <Eye size={12} style={{ marginRight: '3px' }} />
                            Xem phát sóng (Live)
                          </button>
                          <button
                            type="button"
                            className="tt-btn tt-btn--sm tt-btn--ghost"
                            onClick={() => setBroadcastModal({ roundPk: round.roundId, gameKey: round.next.gameKey, game: round.next })}
                          >
                            <Radio size={12} style={{ marginRight: '3px' }} />
                            Lịch phát
                          </button>
                        </div>
                      </div>
                    </Alert>
                  ) : (
                    <Alert tone="info">Không còn ván kế tiếp trong lịch hoặc vòng đấu đã kết thúc.</Alert>
                  )}

                  {/* BTC Operational Actions */}
                  <div className="tt-form__actions" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="tt-btn tt-btn--success"
                      onClick={handlePublishNext}
                      disabled={publishing || round.frozen || busy?.event}
                    >
                      <Play size={14} style={{ marginRight: '4px' }} />
                      {publishing ? 'Đang phát ván…' : 'Phát ván kế tiếp (Publish)'}
                    </button>

                    {!round.frozen && (
                      <ConfirmAction
                        label="Đóng băng vòng bảng (Freeze)"
                        confirmLabel="Chắc chắn đóng băng vòng bảng"
                        tone="warning"
                        busy={freezing}
                        onConfirm={handleFreezeRound}
                      />
                    )}
                  </div>
                </>
              ) : (
                <div className="tt-stack">
                  <p className="tt-muted">
                    Sau thời điểm cutoff ({formatDateTime(event.competition.cutoff)}), BTC thực hiện chốt GitHub một lần cho
                    các đội đã được duyệt rồi mở vòng đấu chính thức.
                  </p>
                  <div className="tt-form__actions" style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                      type="button"
                      className="tt-btn tt-btn--info"
                      onClick={() => handleSync()}
                      disabled={!cutoffPassed || syncing || opening}
                    >
                      <Clock size={14} style={{ marginRight: '4px' }} />
                      {syncing ? 'Đang chốt GitHub…' : 'Chốt GitHub toàn bộ đội (Cutoff Sync)'}
                    </button>
                    <button
                      type="button"
                      className="tt-btn tt-btn--success"
                      onClick={handleOpen}
                      disabled={!canOpen}
                    >
                      <Swords size={14} style={{ marginRight: '4px' }} />
                      {opening ? 'Đang mở vòng…' : 'Chốt bài & Mở vòng bảng (Open Round)'}
                    </button>
                  </div>
                </div>
              )}

              {/* Cutoff Batch Progress Widget (Mục 2) */}
              <div className="tt-stack" style={{ marginTop: '0.5rem', borderTop: '1px solid var(--border, #333)', paddingTop: '0.75rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
                  <h3 style={{ fontSize: '0.95rem', fontWeight: 600 }}>
                    Tiến độ chốt GitHub (Cutoff Batch Status)
                  </h3>
                  <button
                    type="button"
                    className="tt-btn tt-btn--sm tt-btn--ghost"
                    onClick={() => loadCutoffStatus()}
                    disabled={loadingCutoff}
                  >
                    <RefreshCw size={12} style={{ marginRight: '3px' }} />
                    Làm mới tiến độ
                  </button>
                </div>

                {cutoffStatus ? (
                  <div className="tt-stack" style={{ gap: '0.5rem' }}>
                    <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
                      <Badge tone={cutoffStatus.complete ? 'success' : 'warning'}>
                        {cutoffStatus.complete ? 'Đã ghim toàn bộ' : 'Chưa hoàn tất'}
                      </Badge>
                      <Badge tone="success">Đã ghim: {cutoffStatus.pinned_count} / {cutoffStatus.total_approved}</Badge>
                      {cutoffStatus.busy_count > 0 && <Badge tone="live">Đang xử lý: {cutoffStatus.busy_count}</Badge>}
                      {cutoffStatus.pending_count > 0 && <Badge tone="neutral">Chưa ghim: {cutoffStatus.pending_count}</Badge>}
                    </div>

                    {/* Retry button for pending/failed teams */}
                    {cutoffStatus.pending_count > 0 && cutoffPassed && (
                      <div style={{ marginTop: '0.25rem' }}>
                        <button
                          type="button"
                          className="tt-btn tt-btn--info tt-btn--sm"
                          onClick={() => {
                            const pendingTeamIds = (cutoffStatus.teams || [])
                              .filter((t) => t.status === 'pending')
                              .map((t) => t.team_id);
                            handleSync(pendingTeamIds);
                          }}
                          disabled={syncing}
                        >
                          <RotateCcw size={12} style={{ marginRight: '4px' }} />
                          {syncing ? 'Đang đồng bộ lại…' : `Đồng bộ lại ${cutoffStatus.pending_count} đội chưa ghim (Targeted Retry)`}
                        </button>
                      </div>
                    )}

                    <DataTable
                      columns={['Đội thi', 'Kho GitHub (Repo)', 'Branch', 'Trạng thái', 'Commit SHA']}
                      label="Danh sách cutoff các đội"
                    >
                      {(cutoffStatus.teams || []).map((t) => (
                        <tr key={t.team_id}>
                          <td><strong>{getTeamName(t.team_id)}</strong></td>
                          <td><code>{t.repository}</code></td>
                          <td>{t.branch}</td>
                          <td>
                            <Badge tone={t.status === 'pinned' ? 'success' : t.status === 'busy' ? 'live' : 'neutral'}>
                              {t.status === 'pinned' ? 'Đã ghim' : t.status === 'busy' ? 'Đang xử lý' : 'Chờ chốt'}
                            </Badge>
                          </td>
                          <td>
                            {t.commit_sha ? <code title={t.commit_sha}>{t.commit_sha.slice(0, 10)}…</code> : <span className="tt-muted">—</span>}
                          </td>
                        </tr>
                      ))}
                    </DataTable>
                  </div>
                ) : (
                  <p className="tt-muted" style={{ fontSize: '0.85rem' }}>
                    Chưa có dữ liệu tiến độ cutoff. Nhấn "Làm mới tiến độ" để kiểm tra.
                  </p>
                )}
              </div>

              {/* Failed Jobs List with Cancel / Requeue Actions */}
              {progress?.jobs?.failed && progress.jobs.failed.length > 0 && (
                <div className="tt-stack" style={{ marginTop: '0.5rem' }}>
                  <h3 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--color-danger, #e53e3e)' }}>
                    <AlertTriangle size={16} style={{ display: 'inline', verticalAlign: 'text-bottom', marginRight: '4px' }} />
                    Danh sách Job lỗi cần can thiệp ({progress.jobs.failed.length})
                  </h3>
                  <DataTable
                    columns={['Ván (GameKey)', 'Lần thử (Attempt)', 'Nhóm lỗi', 'Chi tiết lỗi', 'Thao tác']}
                    label="Danh sách jobs lỗi"
                  >
                    {progress.jobs.failed.map((fJob) => (
                      <tr key={fJob.gameKey}>
                        <td><strong>{fJob.gameKey}</strong></td>
                        <td>{fJob.attempt}</td>
                        <td><Badge tone="danger">{fJob.category || 'failed'}</Badge></td>
                        <td style={{ maxWidth: '300px', wordBreak: 'break-word', fontSize: '0.85rem' }}>
                          {fJob.error || 'Lỗi không xác định'}
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: '0.25rem' }}>
                            <button
                              type="button"
                              className="tt-btn tt-btn--warning tt-btn--sm"
                              onClick={() => {
                                setJobModal({ type: 'requeue', jobId: fJob.gameKey, gameKey: fJob.gameKey });
                                setJobReason('');
                                setJobReasonError('');
                              }}
                            >
                              <RotateCcw size={12} style={{ marginRight: '2px' }} />
                              Chấm lại
                            </button>
                            <button
                              type="button"
                              className="tt-btn tt-btn--sm tt-btn--danger"
                              onClick={() => {
                                setJobModal({ type: 'cancel', jobId: fJob.gameKey, gameKey: fJob.gameKey });
                                setJobReason('');
                                setJobReasonError('');
                              }}
                            >
                              <XCircle size={12} style={{ marginRight: '2px' }} />
                              Hủy
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </DataTable>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: STANDINGS (Pure Display - Calculated Authoritatively by Server) */}
          {activeTab === 'standings' && (
            <div className="tt-stack">
              {!standings ? (
                <Spinner label="Đang tải bảng xếp hạng chính thức từ máy chủ…" />
              ) : standings.published === false ? (
                <Alert tone="info" title="Vòng bảng đang diễn ra kín">
                  Bảng xếp hạng vòng bảng hiện đang được lưu kín theo đúng quy chế thi đấu. Điểm số và danh sách hạt giống
                  vượt qua vòng bảng sẽ được công bố chính thức ngay sau khi kết thúc và đóng băng vòng bảng.
                </Alert>
              ) : (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <p className="tt-muted" style={{ margin: 0 }}>
                      Bảng xếp hạng được tính toán bởi server từ các kết quả đã được xác nhận (accepted results).
                    </p>
                    <Badge tone={standings.complete ? 'success' : 'warning'}>
                      {standings.complete ? 'Đã hoàn tất vòng bảng' : 'Chưa hoàn tất'}
                    </Badge>
                  </div>

                  {Array.isArray(standings.groups) && standings.groups.length > 0 ? (
                    standings.groups.map((group) => (
                      <div key={group.name} className="tt-stack" style={{ marginTop: '0.5rem' }}>
                        <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>Bảng {group.name}</h3>
                        <DataTable
                          columns={['#', 'Đội thi', 'Trận Cặp (T-H-B)', 'Điểm Cặp', 'Ván đấu (T-B)', 'Điểm Ván']}
                          label={`Bảng xếp hạng ${group.name}`}
                        >
                          {group.rows.map((row) => (
                            <tr key={row.participantId}>
                              <td><strong>{row.rank}</strong></td>
                              <td>{getTeamName(row.participantId)}</td>
                              <td>{row.seriesPlayed} ({row.seriesWon}-{row.seriesDrawn}-{row.seriesLost})</td>
                              <td><strong>{row.seriesPoints}</strong></td>
                              <td>{row.gamesPlayed} ({row.gamesWon}-{row.gamesLost})</td>
                              <td>{row.gamePoints}</td>
                            </tr>
                          ))}
                        </DataTable>
                      </div>
                    ))
                  ) : (
                    <Alert tone="info">Chưa có dữ liệu bảng đấu.</Alert>
                  )}

                  {/* Qualifiers list if complete */}
                  {Array.isArray(standings.qualifiers) && standings.qualifiers.length > 0 && (
                    <div className="tt-stack" style={{ marginTop: '1rem' }}>
                      <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-primary, #3182ce)' }}>
                        <CheckCircle2 size={16} style={{ display: 'inline', verticalAlign: 'text-bottom', marginRight: '4px' }} />
                        Danh sách đội vượt qua vòng bảng ({standings.qualifiers.length})
                      </h3>
                      <DataTable columns={['Hạt giống (Seed)', 'Đội thi', 'Bảng gốc', 'Hạng bảng']} label="Đội đi tiếp">
                        {standings.qualifiers.map((q) => (
                          <tr key={q.participantId}>
                            <td><strong>#{q.seed}</strong></td>
                            <td>{getTeamName(q.participantId)}</td>
                            <td>Bảng {q.groupName}</td>
                            <td>Hạng {q.rank}</td>
                          </tr>
                        ))}
                      </DataTable>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* TAB 3: KNOCKOUT BRACKET */}
          {activeTab === 'bracket' && (
            <div className="tt-stack">
              {!bracket ? (
                <Spinner label="Đang nạp nhánh đấu knockout…" />
              ) : bracket.published === false ? (
                <Alert tone="info" title="Nhánh đấu Knockout chưa bắt đầu">
                  Nhánh đấu Knockout sẽ được khởi tạo và công bố chính thức sau khi vòng bảng hoàn tất.
                </Alert>
              ) : (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    {(admin || bracket.published !== false) && (
                      <>
                        <div>
                          <span className="tt-muted">Tiến độ series: </span>
                          <strong>{bracket.resolved} / {bracket.expected} series</strong>
                        </div>
                        <Badge tone={bracket.complete ? 'success' : 'live'}>
                          {bracket.complete ? 'Knockout hoàn tất' : 'Đang thi đấu'}
                        </Badge>
                      </>
                    )}
                  </div>

                    {!admin && bracket.published === true && bracket.complete === false && (
                      <Alert tone="info" title="Knockout đang được công bố theo lịch">
                        Trạng thái hoàn tất và các cặp đấu chưa công bố sẽ không hiển thị trước khi được mở.
                      </Alert>
                    )}

                  {admin && bracket.next && (
                    <Alert tone="info" title={`Series kế tiếp: ${bracket.next.match_id}`}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                        <div>
                          Giai đoạn: <strong>{STAGE_LABELS[bracket.next.stage] || bracket.next.stage}</strong> · Vòng: {bracket.next.round_id}
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <button
                            type="button"
                            className="tt-btn tt-btn--info tt-btn--sm"
                            onClick={() => setViewerModal({ roundPk: bracket.next.round_id, gameKey: `${bracket.next.match_id}:main:1`, game: bracket.next })}
                          >
                            <Eye size={12} style={{ marginRight: '3px' }} />
                            Xem phát sóng (Live)
                          </button>
                        </div>
                      </div>
                    </Alert>
                  )}

                  {admin && bracket.waiting && (
                    <Alert tone="warning">Đang chờ giải quyết series điều kiện trước khi mở cặp đấu mới.</Alert>
                  )}

                  {admin && (
                    <div className="tt-form__actions">
                      <button
                        type="button"
                        className="tt-btn tt-btn--success"
                        onClick={handleOpenBracketNext}
                        disabled={openingBracket || bracket.complete || !!bracket.waiting || busy?.event}
                      >
                        <ChevronRight size={14} style={{ marginRight: '4px' }} />
                        {openingBracket ? 'Đang mở…' : 'Mở / Tiến series kế tiếp'}
                      </button>
                    </div>
                  )}

                  <h3 style={{ fontSize: '1rem', fontWeight: 600, marginTop: '0.5rem' }}>Các trận đấu Knockout</h3>
                  <DataTable
                    columns={['Giai đoạn', 'Mã trận', 'Ván đã đấu', 'Đội thắng', 'Kết quả', 'Phát sóng']}
                    label="Danh sách series knockout"
                  >
                    {(bracket.series || []).map((s) => (
                      <tr key={s.match_id}>
                        <td><strong>{STAGE_LABELS[s.stage] || s.stage}</strong></td>
                        <td>{s.match_id}</td>
                        <td>{s.games_played} ván</td>
                        <td>
                          {s.winner_participant_id ? (
                            <span style={{ color: 'var(--color-success, #38a169)', fontWeight: 600 }}>
                              {getTeamName(s.winner_participant_id)}
                            </span>
                          ) : (
                            <span className="tt-muted">—</span>
                          )}
                        </td>
                        <td>
                          {s.complete ? (
                            <Badge tone="success">{s.reason || 'Hoàn thành'}</Badge>
                          ) : (
                            <Badge tone="neutral">Đang chờ</Badge>
                          )}
                        </td>
                        <td>
                          {s.round_id ? (
                            <div style={{ display: 'flex', gap: '0.25rem' }}>
                              <button
                                type="button"
                                className="tt-btn tt-btn--info tt-btn--sm"
                                onClick={() => setViewerModal({ roundPk: s.round_id, gameKey: `${s.match_id}:main:1`, game: s })}
                                title="Xem luồng phát sóng trực tiếp"
                              >
                                <Eye size={12} />
                              </button>
                              {admin && (
                                <button
                                  type="button"
                                  className="tt-btn tt-btn--sm tt-btn--ghost"
                                  onClick={() => setBroadcastModal({ roundPk: s.round_id, gameKey: `${s.match_id}:main:1`, game: s })}
                                  title="Đặt lịch phát sóng"
                                >
                                  <Radio size={12} />
                                </button>
                              )}
                            </div>
                          ) : (
                            <span className="tt-muted">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </DataTable>
                </>
              )}
            </div>
          )}

          {/* TAB 4: TICKETS (Strict structure: { awarded: [], reserves: [], vacant: n }) */}
          {activeTab === 'tickets' && (
            <div className="tt-stack" style={{ gap: '1rem' }}>
              {!tickets ? (
                <Spinner label="Đang kiểm tra phân bổ vé chung kết…" />
              ) : tickets.published === false ? (
                <Alert tone="info" title="Vé chung kết chưa công bố">
                  Vé chung kết chỉ được xác nhận và công bố chính thức sau khi vòng knockout kết thúc hoàn toàn.
                </Alert>
              ) : (
                <>
                  {/* Vacant warning if any */}
                  {Number(tickets?.tickets?.vacant) > 0 && (
                    <Alert tone="warning" title="Suất vé còn trống">
                      Hiện tại có <strong>{tickets.tickets.vacant}</strong> suất vé chưa được phân bổ do thiếu đội đủ điều kiện xếp hạng.
                    </Alert>
                  )}

                  {/* Awarded Tickets Table */}
                  <div className="tt-stack" style={{ gap: '0.5rem' }}>
                    <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-success, #38a169)' }}>
                      <Award size={16} style={{ display: 'inline', verticalAlign: 'text-bottom', marginRight: '4px' }} />
                      Danh sách vé chính thức ({tickets?.tickets?.awarded?.length || 0} vé)
                    </h3>
                    <DataTable columns={['Thứ hạng', 'Đội nhận vé', 'Hạt giống', 'Loại suất']} label="Bảng vé chính thức">
                      {(tickets?.tickets?.awarded || []).map((t, idx) => (
                        <tr key={t.participantId || idx}>
                          <td><strong>#{t.rank || idx + 1}</strong></td>
                          <td><strong>{getTeamName(t.participantId)}</strong></td>
                          <td>#{t.seed ?? '—'}</td>
                          <td><Badge tone="success">Vé Chính thức</Badge></td>
                        </tr>
                      ))}
                    </DataTable>
                  </div>

                  {/* Reserves Table */}
                  {Array.isArray(tickets?.tickets?.reserves) && tickets.tickets.reserves.length > 0 && (
                    <div className="tt-stack" style={{ gap: '0.5rem', marginTop: '0.5rem' }}>
                      <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-warning, #d69e2e)' }}>
                        Suất dự bị ({tickets.tickets.reserves.length} đội)
                      </h3>
                      <DataTable columns={['Thứ hạng', 'Đội dự bị', 'Hạt giống', 'Ghi chú']} label="Bảng vé dự bị">
                        {tickets.tickets.reserves.map((r, idx) => (
                          <tr key={r.participantId || idx}>
                            <td>#{r.rank || idx + 1}</td>
                            <td>{getTeamName(r.participantId)}</td>
                            <td>#{r.seed ?? '—'}</td>
                            <td><Badge tone="neutral">Dự bị</Badge></td>
                          </tr>
                        ))}
                      </DataTable>
                    </div>
                  )}

                  {/* Overall Ranking if available */}
                  {Array.isArray(tickets?.ranking) && tickets.ranking.length > 0 && (
                    <div className="tt-stack" style={{ gap: '0.5rem', marginTop: '0.5rem' }}>
                      <h3 style={{ fontSize: '0.95rem', fontWeight: 600 }}>Bảng xếp hạng chung cuộc</h3>
                      <DataTable columns={['Hạng', 'Đội thi', 'Giai đoạn dừng bước']} label="Bảng xếp hạng giải">
                        {tickets.ranking.map((rnk) => (
                          <tr key={rnk.participantId}>
                            <td><strong>#{rnk.rank}</strong></td>
                            <td>{getTeamName(rnk.participantId)}</td>
                            <td>{STAGE_LABELS[rnk.stage] || rnk.stage || 'Vòng bảng'}</td>
                          </tr>
                        ))}
                      </DataTable>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* TAB 5 (Team-only): PUBLISHED GAMES & LIVE STREAMS */}
          {!admin && activeTab === 'games' && (
            <div className="tt-stack" style={{ gap: '1rem' }}>
              {!publishedGames ? (
                <Spinner label="Đang nạp danh sách ván đấu đã công bố…" />
              ) : !publishedGames.games || publishedGames.games.length === 0 ? (
                <Alert tone="info" title="Chưa có ván đấu nào được công bố">
                  Các ván đấu chính thức sẽ xuất hiện tại đây khi Ban tổ chức lên lịch và phát sóng.
                </Alert>
              ) : (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="tt-muted">Danh sách các ván đấu chính thức được công bố ({publishedGames.games.length} ván)</span>
                    <button
                      type="button"
                      className="tt-btn tt-btn--sm tt-btn--ghost"
                      onClick={() => loadSectionData('games')}
                    >
                      <RefreshCw size={12} style={{ marginRight: '3px' }} />
                      Làm mới
                    </button>
                  </div>

                  <DataTable
                    columns={['Mã ván', 'Giai đoạn', 'Đội Đỏ', 'Đội Xanh', 'Lịch phát sóng', 'Xem trực tiếp']}
                    label="Danh sách ván official đã công bố"
                  >
                    {publishedGames.games.map((g) => {
                      const bc = g.broadcast || {};
                      const isLive = bc.phase === 'broadcasting';
                      const isWaiting = bc.phase === 'waiting';
                      const isEnded = bc.phase === 'ended';
                      return (
                        <tr key={g.game_key}>
                          <td><strong>{g.game_key}</strong></td>
                          <td>{STAGE_LABELS[g.stage] || g.stage || 'Vòng bảng'}</td>
                          <td><span className="tt-side tt-side--red">{getTeamName(g.red_participant_id)}</span></td>
                          <td><span className="tt-side tt-side--blue">{getTeamName(g.blue_participant_id)}</span></td>
                          <td>
                            <Badge tone={isLive ? 'live' : isEnded ? 'success' : isWaiting ? 'warning' : 'neutral'} dot={isLive}>
                              {isLive ? 'Đang chiếu' : isEnded ? 'Đã kết thúc' : isWaiting ? 'Sắp phát' : bc.phase}
                            </Badge>
                            {bc.starts_at && (
                              <span className="tt-cell-sub">
                                {new Date(bc.starts_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            )}
                          </td>
                          <td>
                            <button
                              type="button"
                              className="tt-btn tt-btn--info tt-btn--sm"
                              onClick={() =>
                                setViewerModal({
                                  roundPk: publishedGames.round_pk,
                                  gameKey: g.game_key,
                                  game: g,
                                })
                              }
                              title="Xem trực tiếp trên bàn cờ"
                            >
                              <Eye size={12} style={{ marginRight: '3px' }} />
                              Xem luồng
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </DataTable>
                </>
              )}
            </div>
          )}
        </div>
      ) : null}

      {/* MODAL: Mandatory Reason for Job Cancel or Requeue */}
      {jobModal && (
        <div className="tt-modal-backdrop" style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div className="tt-modal" style={{ backgroundColor: 'var(--bg-panel, #1a202c)', padding: '1.5rem', borderRadius: '8px', maxWidth: '480px', width: '90%', border: '1px solid var(--border, #333)' }}>
            <h3 style={{ marginTop: 0, fontSize: '1.1rem', fontWeight: 600 }}>
              {jobModal.type === 'cancel' ? 'Hủy ván đấu chính thức' : 'Chấm lại ván đấu chính thức'}
            </h3>
            <p className="tt-muted" style={{ fontSize: '0.875rem' }}>
              Ván: <strong>{jobModal.gameKey}</strong>. Thao tác này sẽ được ghi vào nhật ký kiểm toán (audit log) của hệ thống.
            </p>

            <form onSubmit={handleConfirmJobAction}>
              <Field
                label="Lý do thao tác (bắt buộc, từ 5 đến 400 ký tự)"
                error={jobReasonError}
                hint="Ví dụ: Worker node quá tải / timeout mạng ngoại vi / lỗi phân bổ tài nguyên"
              >
                <textarea
                  className="tt-input"
                  rows={3}
                  value={jobReason}
                  onChange={(e) => setJobReason(e.target.value)}
                  placeholder="Nhập lý do chi tiết..."
                  disabled={submittingJobAction}
                  style={{ width: '100%', resize: 'vertical' }}
                  required
                />
              </Field>

              <div className="tt-form__actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1rem' }}>
                <button
                  type="button"
                  className="tt-btn tt-btn--ghost"
                  onClick={() => setJobModal(null)}
                  disabled={submittingJobAction}
                >
                  Đóng
                </button>
                <button
                  type="submit"
                  className={`tt-btn ${jobModal.type === 'cancel' ? 'tt-btn--danger' : 'tt-btn--warning'}`}
                  disabled={submittingJobAction}
                >
                  {submittingJobAction ? 'Đang gửi…' : jobModal.type === 'cancel' ? 'Xác nhận Hủy' : 'Xác nhận Chấm lại'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DIALOG: Schedule Official Game Broadcast */}
      {broadcastModal && (
        <OfficialBroadcastDialog
          roundPk={broadcastModal.roundPk}
          gameKey={broadcastModal.gameKey}
          game={broadcastModal.game}
          open={Boolean(broadcastModal)}
          onClose={() => setBroadcastModal(null)}
          onScheduled={() => {
            setNotice(`Đã cập nhật lịch phát sóng cho ván ${broadcastModal.gameKey}.`);
            loadSectionData('progress');
          }}
        />
      )}

      {/* VIEWER: Official Game Stream Viewer */}
      {viewerModal && (
        <OfficialGameViewer
          roundPk={viewerModal.roundPk}
          gameKey={viewerModal.gameKey}
          game={viewerModal.game}
          map={round?.snapshot?.maps?.primary || event?.competition?.primaryMap}
          onClose={() => setViewerModal(null)}
          admin={admin}
        />
      )}
    </Panel>
  );
}
