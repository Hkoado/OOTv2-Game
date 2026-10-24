import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Award, Calendar, Eye, Radio, RefreshCw, Swords, XCircle } from 'lucide-react';
import DraftEventEditor from './DraftEventEditor.jsx';
import MapPreview from './MapPreview.jsx';
import OfficialSetupPanel from './OfficialSetupPanel.jsx';
import BroadcastDialog from './BroadcastDialog.jsx';
import ManualFinalsPanel from './ManualFinalsPanel.jsx';
import {
  Alert, Badge, ConfirmAction, DataTable, Empty, Panel, Progress, Spinner,
} from './TournamentUi.jsx';
import {
  eventProgress, eventStatusLabel, eventTone, formatDateTime, matchOutcome, standingFor,
  stageLabel, stageSummary,
} from './tournamentView.js';
import { broadcastPhaseMeta, formatOfficialStandingsRow } from './live/publicationView.js';
import { cancelBroadcast, fetchEventBroadcasts } from './live/publicationApi.js';

const STAGES = [
  { id: 'all', label: 'Tất cả' },
  { id: 'group', label: 'Vòng bảng' },
  { id: 'semifinal', label: 'Bán kết' },
  { id: 'final', label: 'Chung kết' },
];

function StandingsTable({ group, rows, highlightId, complete, isOfficial = false }) {
  const columns = isOfficial
    ? ['#', 'Đội', 'Trận cặp', 'T-H-B cặp', 'Điểm cặp (3/1/0)', 'Điểm ván (1/0.5/0)']
    : ['#', 'Đội', 'Tr', 'T', 'H', 'B', 'HS', 'Điểm'];

  return (
    <Panel
      title={`Bảng ${group}`}
      subtitle={complete ? 'Đã hoàn tất vòng bảng' : 'Đang cập nhật'}
      actions={<Badge tone={complete ? 'success' : 'live'} dot={!complete}>{complete ? 'Xong' : 'Live'}</Badge>}
    >
      {rows.length ? (
        <DataTable columns={columns} label={`Bảng xếp hạng bảng ${group}`}>
          {rows.map((rawRow, index) => {
            const row = isOfficial ? formatOfficialStandingsRow(rawRow, index + 1) : rawRow;
            const mine = (row.participantId || row.participant_id) === highlightId;
            return (
              <tr key={row.entry_id || row.participantId || index} className={mine ? 'is-mine' : undefined}>
                <td><span className={`tt-rank${index === 0 ? ' tt-rank--first' : ''}`}>{index + 1}</span></td>
                <td><strong>{row.name}</strong>{mine && <span className="tt-cell-sub">đội của bạn</span>}</td>
                {isOfficial ? (
                  <>
                    <td>{row.seriesPlayed}</td>
                    <td>{row.seriesWon}-{row.seriesDrawn}-{row.seriesLost}</td>
                    <td><strong>{row.seriesPoints}</strong></td>
                    <td>{row.gamePoints}</td>
                  </>
                ) : (
                  <>
                    <td>{row.played}</td>
                    <td>{row.wins}</td>
                    <td>{row.draws}</td>
                    <td>{row.losses}</td>
                    <td>{row.win_loss_difference > 0 ? `+${row.win_loss_difference}` : row.win_loss_difference}</td>
                    <td><strong>{row.points}</strong></td>
                  </>
                )}
              </tr>
            );
          })}
        </DataTable>
      ) : (
        <p className="tt-muted">Bảng chưa có đội. Server sẽ điền khi giải bắt đầu.</p>
      )}
    </Panel>
  );
}

function SeriesCard({ series, title }) {
  if (!series) {
    return (
      <div className="tt-series tt-series--empty">
        <span className="tt-eyebrow">{title}</span>
        <p className="tt-muted">Chưa xác định cặp đấu.</p>
      </div>
    );
  }
  return (
    <div className={`tt-series${series.complete ? ' tt-series--done' : ''}`}>
      <div className="tt-series__head">
        <span className="tt-eyebrow">{title}</span>
        {series.winner_name ? <Badge tone="success">{series.winner_name} đi tiếp</Badge> : <Badge tone="live" dot>Chưa ngã ngũ</Badge>}
      </div>
      <div className="tt-series__games">
        {(series.games || []).map((game) => (
          <div key={game.id} className="tt-series__game">
            <span>Lượt {game.game_no}</span>
            <span className="tt-series__sides">
              <em className="tt-side tt-side--red">{game.red?.name}</em>
              <span aria-hidden="true">vs</span>
              <em className="tt-side tt-side--blue">{game.blue?.name}</em>
            </span>
            <Badge tone={matchOutcome(game).tone}>{matchOutcome(game).label}</Badge>
          </div>
        ))}
      </div>
    </div>
  );
}

function MatchTable({
  matches,
  broadcastsMap,
  onOpenReplay,
  onOpenBroadcastDialog,
  onCancelBroadcast,
  highlightId,
  isAdmin,
}) {
  if (!matches.length) {
    return <Empty title="Chưa có ván ở vòng này" description="Các ván sẽ xuất hiện khi BTC bắt đầu giải hoặc khi đội đi tiếp." />;
  }

  const columns = ['Ván', 'Đỏ', 'Xanh', 'Trạng thái chấm', 'Lịch phát sóng', 'Thao tác'];

  return (
    <DataTable columns={columns} label="Danh sách ván đấu">
      {matches.map((match) => {
        const outcome = matchOutcome(match);
        const mine = match.red?.participant_id === highlightId || match.blue?.participant_id === highlightId;
        const broadcast = broadcastsMap.get(match.id) || null;
        const bPhase = broadcast ? broadcastPhaseMeta(broadcast.phase, broadcast.reveal_result) : null;

        return (
          <tr key={match.id} className={mine ? 'is-mine' : undefined}>
            <td>
              <strong>{stageLabel(match.stage)}</strong>
              <span className="tt-cell-sub">{String(match.series_id || '').toUpperCase()} · lượt {match.game_no}</span>
            </td>
            <td><span className="tt-side tt-side--red">{match.red?.name}</span></td>
            <td><span className="tt-side tt-side--blue">{match.blue?.name}</span></td>
            <td>
              <Badge tone={outcome.tone} dot={match.status === 'running'}>{outcome.label}</Badge>
              {match.reason && <span className="tt-cell-sub">{match.reason}</span>}
            </td>
            <td>
              {broadcast ? (
                <div>
                  <Badge tone={bPhase.tone} dot={bPhase.isBroadcasting}>
                    {bPhase.label}
                  </Badge>
                  {broadcast.starts_at && (
                    <span className="tt-cell-sub">
                      {new Date(broadcast.starts_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  )}
                </div>
              ) : (
                <span className="tt-muted">Chưa đặt lịch</span>
              )}
            </td>
            <td>
              <div style={{ display: 'flex', gap: '0.25rem', alignItems: 'center' }}>
                <button
                  type="button"
                  className="tt-btn tt-btn--info tt-btn--sm"
                  onClick={() => onOpenReplay(match.id)}
                  disabled={match.status !== 'finished'}
                  title={match.status === 'finished' ? 'Xem lại ván đấu' : 'Replay chỉ mở khi ván đã kết thúc'}
                >
                  <Eye size={14} aria-hidden="true" />
                  Replay
                </button>

                {isAdmin && match.status === 'finished' && !broadcast && (
                  <button
                    type="button"
                    className="tt-btn tt-btn--sm"
                    onClick={() => onOpenBroadcastDialog(match)}
                    title="Đặt lịch phát sóng ván đấu"
                  >
                    <Radio size={14} aria-hidden="true" />
                    Đặt lịch
                  </button>
                )}

                {isAdmin && broadcast && broadcast.phase === 'waiting' && (
                  <button
                    type="button"
                    className="tt-btn tt-btn--danger tt-btn--sm"
                    onClick={() => onCancelBroadcast(match.id)}
                    title="Hủy lịch phát sóng"
                  >
                    <XCircle size={14} aria-hidden="true" />
                    Hủy lịch
                  </button>
                )}
              </div>
            </td>
          </tr>
        );
      })}
    </DataTable>
  );
}

export default function EventDetailPage({
  account, teams, detail, detailLoading, detailError, eventId, busy, actions, onNavigate, onOpenReplay, onOpenReplayPayload,
}) {
  const isAdmin = account.role === 'admin';
  const [stage, setStage] = useState('all');
  const [activeTab, setActiveTab] = useState('overview');
  const [broadcasts, setBroadcasts] = useState([]);
  const [schedulingMatch, setSchedulingMatch] = useState(null);

  useEffect(() => {
    setStage('all');
  }, [eventId]);

  const loadBroadcasts = async () => {
    if (!eventId) return;
    try {
      const list = await fetchEventBroadcasts(eventId);
      setBroadcasts(list);
    } catch {
      // Ignored for unauthenticated / legacy
    }
  };

  useEffect(() => {
    loadBroadcasts();
  }, [eventId]);

  const broadcastsMap = useMemo(() => {
    const map = new Map();
    for (const b of broadcasts) {
      if (b.match_id) map.set(b.match_id, b);
    }
    return map;
  }, [broadcasts]);

  const event = detail?.event || null;
  const standings = detail?.standings || null;
  const rawMatches = detail?.matches || [];
  const bracket = detail?.bracket || null;

  const matches = useMemo(() => {
    if (stage === 'all') return rawMatches;
    return rawMatches.filter((match) => match.stage === stage);
  }, [rawMatches, stage]);

  const summary = useMemo(() => stageSummary(rawMatches), [rawMatches]);
  const champion = bracket?.champion || null;
  const myStanding = standingFor(standings, account.participant_id);

  async function handleCancelBroadcast(matchId) {
    if (!window.confirm('Bạn có chắc muốn hủy lịch phát sóng của ván này?')) return;
    try {
      await cancelBroadcast(matchId);
      await loadBroadcasts();
      actions.refresh();
    } catch (err) {
      alert(err.message || 'Không thể hủy lịch phát.');
    }
  }

  const backButton = (
    <button type="button" className="tt-back" onClick={() => onNavigate('events')}>
      <ArrowLeft size={16} aria-hidden="true" />
      Danh sách giải
    </button>
  );

  if (!event) {
    return (
      <>
        {backButton}
        {detailLoading ? (
          <Panel><Spinner label="Đang tải bảng đấu…" /></Panel>
        ) : (
          <Alert tone={detailError ? 'danger' : 'warning'} title="Không mở được giải">
            {detailError || 'Giải không tồn tại hoặc tài khoản không có quyền xem.'}
            <div className="tt-form__actions">
              <button type="button" className="tt-btn tt-btn--sm" onClick={() => actions.refresh()}>
                <RefreshCw size={14} aria-hidden="true" />
                Thử lại
              </button>
            </div>
          </Alert>
        )}
      </>
    );
  }

  if (event.competition) return <>
    {backButton}
    <header className="tt-page-head">
      <div>
        <h1 className="tt-page-title">{event.name}</h1>
        <p>Thiết lập chính thức · seed {event.seed} · phiên bản {event.version}</p>
      </div>
      {isAdmin && (
        <div className="tt-page-actions">
          <button
            type="button"
            className={`tt-btn ${activeTab === 'finals' ? 'tt-btn--primary' : 'tt-btn--ghost'}`}
            onClick={() => setActiveTab(activeTab === 'finals' ? 'overview' : 'finals')}
          >
            <Swords size={16} aria-hidden="true" />
            {activeTab === 'finals' ? 'Quay lại thiết lập' : 'Chung kết thủ công'}
          </button>
        </div>
      )}
    </header>
    {activeTab === 'finals' && isAdmin ? (
      <ManualFinalsPanel event={event} teams={teams} actions={actions} busy={busy} admin={isAdmin} onOpenReplay={onOpenReplay} onOpenReplayPayload={onOpenReplayPayload} />
    ) : (
      <OfficialSetupPanel key={`${event.id}:${account.role}`} event={event} teams={teams} actions={actions} busy={busy} admin={isAdmin} />
    )}
  </>;

  const groupsList = Object.keys(standings?.groups || {});
  const displayGroups = groupsList.length > 0 ? groupsList : ['A', 'B'];

  return (
    <>
      {backButton}

      <header className="tt-page-head tt-page-head--detail">
        <div>
          <p className="tt-eyebrow">Giải đấu · {eventStatusLabel(event.status)}</p>
          <h1 className="tt-page-title">{event.name}</h1>
          <p className="tt-page-lead">
            Tạo lúc {formatDateTime(event.created_at)} · seed <code>{String(event.seed || '').slice(0, 12)}</code> ·{' '}
            {event.match_counts?.total ?? 0} ván đã sinh
          </p>
        </div>
        <div className="tt-page-actions">
          <Badge tone={eventTone(event.status)} dot>{eventStatusLabel(event.status)}</Badge>
          {isAdmin && (
            <button
              type="button"
              className={`tt-btn ${activeTab === 'finals' ? 'tt-btn--primary' : 'tt-btn--ghost'}`}
              onClick={() => setActiveTab(activeTab === 'finals' ? 'overview' : 'finals')}
            >
              <Swords size={15} aria-hidden="true" />
              {activeTab === 'finals' ? 'Bảng đấu & Lịch phát' : 'Chung kết thủ công'}
            </button>
          )}
          {isAdmin && event.status === 'draft' && event.entries.length === 8 && !event.map.blocked.length && (
            <ConfirmAction
              label="Bắt đầu giải"
              confirmLabel="Khóa bài & sinh lịch"
              tone="success"
              busy={busy?.start}
              onConfirm={() => actions.startEvent(event.id)}
            />
          )}
          <button type="button" className="tt-btn tt-btn--ghost" onClick={() => { actions.refresh(); loadBroadcasts(); }} disabled={detailLoading}>
            <RefreshCw size={15} aria-hidden="true" />
            Làm mới
          </button>
        </div>
      </header>

      {activeTab === 'finals' && isAdmin ? (
        <ManualFinalsPanel event={event} teams={teams} actions={actions} busy={busy} admin={isAdmin} onOpenReplay={onOpenReplay} onOpenReplayPayload={onOpenReplayPayload} />
      ) : (
        <>
          {event.status === 'draft' && isAdmin && <DraftEventEditor key={event.id} event={event} teams={teams} actions={actions} busy={busy} />}
      {event.status === 'draft' && <Panel title="Nội dung thư mục giải"><p>{event.entries.length}/8 đội · {event.map.id}</p><p className="tt-muted">Chỉ xếp lịch khi đủ 8 đội có bot hợp lệ và map được worker hỗ trợ.</p></Panel>}
      {event.status !== 'draft' && <Panel title="Map thi đấu"><MapPreview map={event.map} /></Panel>}
        <Panel title="Tiến độ giải">
        <Progress value={eventProgress({ match_total: event.match_counts?.total, match_finished: event.match_counts?.finished })} label={`${event.match_counts?.finished ?? 0}/${event.match_counts?.total ?? 0} ván đã chấm`} />
        <div className="tt-inline-facts">
          <span><Swords size={15} aria-hidden="true" />Vòng bảng {summary.group.finished}/{summary.group.total}</span>
          <span>Bán kết {summary.semifinal.finished}/{summary.semifinal.total}</span>
          <span>Chung kết {summary.final.finished}/{summary.final.total}</span>
          {myStanding && <Badge tone="accent">Bảng {myStanding.group} · hạng {myStanding.row.points} điểm</Badge>}
        </div>
      </Panel>

      {champion && (
        <div className="tt-champion">
          <Award size={26} aria-hidden="true" />
          <div>
            <span className="tt-eyebrow">Vô địch</span>
            <strong>{champion.name}</strong>
          </div>
          <Badge tone="success">Chung kết hoàn tất</Badge>
        </div>
      )}

      {/* Dynamic groups standings display */}
      <div className="tt-grid tt-grid--2">
        {displayGroups.map((groupKey) => (
          <StandingsTable
            key={groupKey}
            group={groupKey}
            rows={standings?.groups?.[groupKey] || []}
            highlightId={account.participant_id}
            complete={Boolean(standings?.group_stage_complete)}
            isOfficial={Boolean(event.competition)}
          />
        ))}
      </div>

      {isAdmin && bracket && (
        <Panel
          title="Nhánh loại trực tiếp"
          subtitle="Bán kết và chung kết đấu các ván đổi màu; hòa series thì xét ưu tiên theo điều lệ."
        >
          <div className="tt-bracket">
            <div className="tt-bracket__round">
              <span className="tt-eyebrow">Bán kết</span>
              {(bracket.semifinals || []).length ? (
                bracket.semifinals.map((series, index) => (
                  <SeriesCard key={series.series_id} series={series} title={`SF${index + 1}`} />
                ))
              ) : (
                <p className="tt-muted">Bán kết được sinh khi vòng bảng hoàn tất.</p>
              )}
            </div>
            <div className="tt-bracket__round">
              <span className="tt-eyebrow">Chung kết</span>
              <SeriesCard series={bracket.final} title="Final" />
            </div>
          </div>
        </Panel>
      )}

      <Panel
        title="Danh sách ván & Lịch phát"
        subtitle={isAdmin
          ? `${matches.length} ván · Chấm kín trên máy BTC; phát sóng theo lịch cho người xem.`
          : 'Danh sách ván đấu đã được BTC công bố theo lịch phát.'}
        actions={
          <div className="tt-filter-tabs">
            {STAGES.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`tt-filter-tab${stage === item.id ? ' is-active' : ''}`}
                onClick={() => setStage(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        }
      >
        <MatchTable
          matches={matches}
          broadcastsMap={broadcastsMap}
          onOpenReplay={onOpenReplay}
          onOpenBroadcastDialog={(m) => setSchedulingMatch(m)}
          onCancelBroadcast={handleCancelBroadcast}
          highlightId={account.participant_id}
          isAdmin={isAdmin}
        />
      </Panel>
      </>
      )}

      {/* Broadcast Scheduling Modal */}
      <BroadcastDialog
        match={schedulingMatch}
        open={Boolean(schedulingMatch)}
        onClose={() => setSchedulingMatch(null)}
        onScheduled={() => {
          loadBroadcasts();
          actions.refresh();
        }}
      />
    </>
  );
}
