import React, { useCallback, useEffect, useState } from 'react';
import { Activity, AlertTriangle, Clock3, ListChecks, RefreshCw } from 'lucide-react';
import { apiRequest, isSessionError } from './portalApi.js';
import { Alert, Badge, DataTable, Empty, Panel, Spinner, Stat } from './TournamentUi.jsx';
import { formatDateTime, formatDuration, matchOutcome, reasonLabel, stageLabel } from './tournamentView.js';
import JudgeMatchDialog from './JudgeMatchDialog.jsx';

const POLL_MS = 3000;

function clock(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  try {
    return new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(date);
  } catch {
    return date.toISOString().slice(11, 19);
  }
}

function MatchCell({ match }) {
  return (
    <td>
      <strong>{stageLabel(match.stage)}</strong>
      <span className="tt-cell-sub">{String(match.series_id || '').toUpperCase()} · lượt {match.game_no}</span>
    </td>
  );
}

function SidesCell({ match }) {
  return (
    <td>
      <span className="tt-side tt-side--red">{match.red?.name}</span>
      <span className="tt-cell-sub">vs</span>
      <span className="tt-side tt-side--blue">{match.blue?.name}</span>
    </td>
  );
}

function LogButton({ match, onOpen }) {
  return (
    <td>
      <button type="button" className="tt-btn tt-btn--ghost tt-btn--sm" onClick={() => onOpen(match.id)}>
        Nhật ký
      </button>
    </td>
  );
}

function WorkerPanel({ worker, counts, limits }) {
  return (
    <Panel
      title="Worker chấm bài"
      subtitle="Tiến trình chấm chạy tách khỏi web; web chỉ đọc trạng thái."
      actions={worker ? (
        <Badge tone={worker.alive ? 'live' : 'warning'} dot={worker.alive}>
          {worker.alive ? 'Đang hoạt động' : 'Mất tín hiệu'}
        </Badge>
      ) : <Badge tone="neutral">Chưa có nhịp tim</Badge>}
    >
      <dl className="tt-kv">
        <dt>Worker</dt>
        <dd><code>{worker?.id || '—'}</code></dd>
        <dt>Nhịp tim cuối</dt>
        <dd>{worker ? `${formatDateTime(worker.heartbeat_at)} · ${clock(worker.heartbeat_at)}` : '—'}</dd>
        <dt>Ván gần nhất</dt>
        <dd>{worker?.last_match_id ? <code>{worker.last_match_id.slice(0, 8)}…</code> : '—'}</dd>
        <dt>Hàng đợi</dt>
        <dd>{counts.pending} chờ · {counts.running} đang chấm</dd>
        <dt>Giới hạn</dt>
        <dd>
          {limits.max_plies ?? 200} nước/ván · setup {(limits.setup_timeout_ms ?? 3000) / 1000}s · mỗi nước {(limits.move_timeout_ms ?? 2000) / 1000}s
        </dd>
      </dl>
      {!worker?.alive && counts.pending > 0 && (
        <Alert tone="warning" title="Còn ván chờ nhưng worker không phản hồi">
          Chạy <code>npm run dev:worker</code> (hoặc <code>node server/worker.js</code>) để tiếp tục chấm. Ván đang chấm dở
          sẽ được khôi phục về hàng đợi khi worker khởi động lại.
        </Alert>
      )}
    </Panel>
  );
}

function StagePanel({ stages }) {
  return (
    <Panel title="Tiến độ theo vòng" subtitle="Chỉ đọc — số liệu lấy trực tiếp từ bảng matches.">
      <DataTable columns={['Vòng', 'Tổng', 'Chờ', 'Đang', 'Xong', 'Sự cố']} label="Tiến độ chấm theo vòng">
        {stages.map((stage) => (
          <tr key={stage.stage}>
            <td><strong>{stageLabel(stage.stage)}</strong></td>
            <td>{stage.total}</td>
            <td>{stage.pending}</td>
            <td>{stage.running}</td>
            <td>{stage.finished}</td>
            <td>{stage.failed ? <Badge tone="danger">{stage.failed}</Badge> : '—'}</td>
          </tr>
        ))}
      </DataTable>
    </Panel>
  );
}

function ActivePanel({ active, onOpen }) {
  return (
    <Panel
      title="Đang chấm"
      subtitle="Mỗi thời điểm worker chỉ chạy một ván."
      actions={<Badge tone={active.length ? 'live' : 'neutral'} dot={Boolean(active.length)}>{active.length ? `${active.length} ván` : 'Rảnh'}</Badge>}
    >
      {active.length ? (
        <ul className="tt-log">
          {active.map((match) => (
            <li key={match.id} className="tt-active-row">
              <span>
                <strong>{match.red?.name}</strong> vs <strong>{match.blue?.name}</strong>
                <span className="tt-cell-sub">{stageLabel(match.stage)} · {String(match.series_id || '').toUpperCase()} · lượt {match.game_no}</span>
              </span>
              <span className="tt-inline-meta">
                <Clock3 size={14} aria-hidden="true" />
                {formatDuration(match.elapsed_ms)}
                <button type="button" className="tt-btn tt-btn--ghost tt-btn--sm" onClick={() => onOpen(match.id)}>
                  Chi tiết
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <Empty title="Không có ván đang chấm" description="Worker sẽ nhận ván kế tiếp khi hàng đợi còn việc." />
      )}
    </Panel>
  );
}

export default function JudgePage({ actions, onOpenReplay }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [auto, setAuto] = useState(true);
  const [selected, setSelected] = useState(null);
  const onExpired = actions?.onSessionExpired;

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const payload = await apiRequest('/admin/judge');
      setData(payload);
      setError('');
    } catch (requestError) {
      if (isSessionError(requestError)) {
        onExpired?.();
        return;
      }
      if (!silent) setError(requestError.message || 'Không tải được trạng thái chấm bài.');
    } finally {
      setLoading(false);
    }
  }, [onExpired]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!auto) return undefined;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') load({ silent: true });
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [auto, load]);

  const closeDialog = useCallback(() => setSelected(null), []);
  const openDialog = useCallback((matchId) => setSelected(matchId), []);
  const counts = data?.counts || { total: 0, pending: 0, running: 0, finished: 0, failed: 0 };
  const stages = data?.stages || [];

  return (
    <>
      <header className="tt-page-head">
        <div>
          <p className="tt-eyebrow">Ban tổ chức · quan sát chấm bài</p>
          <h1 className="tt-page-title">Chấm bài</h1>
          <p className="tt-page-lead">
            Theo dõi hàng đợi, tiến độ từng vòng, tình trạng worker và lý do bot bị xử thua.
            Trang chỉ đọc: server và worker vẫn là nguồn xác thực duy nhất cho kết quả.
          </p>
        </div>
        <div className="tt-page-actions">
          <button
            type="button"
            className={`tt-btn${auto ? ' tt-btn--primary' : ''}`}
            onClick={() => setAuto((value) => !value)}
            aria-pressed={auto}
            title="Bật/tắt tự động làm mới mỗi 3 giây"
          >
            <Activity size={16} aria-hidden="true" />
            {auto ? 'Tự động 3 s' : 'Đã tạm dừng'}
          </button>
          <button type="button" className="tt-btn" onClick={() => load()} disabled={loading}>
            <RefreshCw size={16} aria-hidden="true" className={loading ? 'tt-spin' : undefined} />
            Làm mới
          </button>
        </div>
      </header>

      {error && <Alert tone="danger" title="Không tải được trạng thái chấm bài">{error}</Alert>}
      {!data && loading && <Spinner label="Đang tải trạng thái chấm bài…" />}

      {data && (
        <>
          <p className="tt-muted">
            Cập nhật {clock(data.generated_at)} · driver <code>{data.driver}</code>
            {data.event ? <> · giải <strong>{data.event.name}</strong></> : null}
          </p>

          {data.logs_available === false && (
            <Alert tone="warning" title="Chưa có bảng nhật ký chấm">
              Driver DB chung cần migration <code>20261022150000_judge_monitor.sql</code>. Kết quả trận vẫn đúng;
              chỉ phần ghi chú chi tiết chưa đọc được.
            </Alert>
          )}

          {!data.event ? (
            <Empty
              title="Chưa có giải nào để chấm"
              description="Tạo giải 8 đội ở trang Quản lý giải, sau đó chạy worker để bắt đầu chấm."
            />
          ) : (
            <>
              <section className="tt-stats" aria-label="Chỉ số chấm bài">
                <Stat label="Chờ chấm" value={counts.pending} hint={`${counts.total} ván trong giải`} tone={counts.pending ? 'warning' : 'success'} icon={<Clock3 size={18} />} />
                <Stat label="Đang chấm" value={counts.running} hint="Worker chạy tuần tự 1 ván" tone={counts.running ? 'info' : 'neutral'} icon={<Activity size={18} />} />
                <Stat label="Đã chấm" value={`${counts.finished}/${counts.total}`} hint={`${Math.round((counts.finished / Math.max(1, counts.total)) * 100)}% tiến độ`} tone="success" icon={<ListChecks size={18} />} />
                <Stat label="Sự cố" value={counts.failed} hint="Bot lỗi hoặc lỗi hạ tầng" tone={counts.failed ? 'danger' : 'success'} icon={<AlertTriangle size={18} />} />
              </section>

              <div className="tt-grid tt-grid--2">
                <WorkerPanel worker={data.worker} counts={counts} limits={data.limits || {}} />
                <StagePanel stages={stages} />
              </div>

              <ActivePanel active={data.active || []} onOpen={openDialog} />

              <Panel
                title="Ván có sự cố"
                subtitle="Bot xếp sai, đi nước không hợp lệ, hoặc lỗi nội bộ của giải."
                actions={<Badge tone={counts.failed ? 'danger' : 'success'}>{counts.failed ? `${counts.failed} ván` : 'Sạch'}</Badge>}
              >
                {(data.issues || []).length ? (
                  <DataTable columns={['Ván', 'Cặp đấu', 'Lý do', 'Ghi chú', '']} label="Các ván có sự cố">
                    {(data.issues || []).map((match) => {
                      const note = match.log?.error || match.log?.notes?.[0] || '—';
                      return (
                        <tr key={match.id}>
                          <MatchCell match={match} />
                          <SidesCell match={match} />
                          <td><Badge tone="danger">{reasonLabel(match.reason)}</Badge></td>
                          <td><span className="tt-clip" title={note}>{note}</span></td>
                          <LogButton match={match} onOpen={openDialog} />
                        </tr>
                      );
                    })}
                  </DataTable>
                ) : (
                  <p className="tt-muted">Không có ván nào bị xử thua hay lỗi hạ tầng trong giải này.</p>
                )}
              </Panel>

              <Panel
                title="Vừa chấm xong"
                subtitle="8 ván gần nhất, kèm thời gian chấm và số nước."
                actions={<Badge tone="neutral">{counts.finished} ván</Badge>}
              >
                {(data.recent || []).length ? (
                  <DataTable columns={['Ván', 'Cặp đấu', 'Kết quả', 'Lý do', 'Nước', 'Thời gian', '']} label="Các ván vừa chấm">
                    {(data.recent || []).map((match) => (
                      <tr key={match.id}>
                        <MatchCell match={match} />
                        <SidesCell match={match} />
                        <td><Badge tone={matchOutcome(match).tone}>{matchOutcome(match).label}</Badge></td>
                        <td>{reasonLabel(match.reason)}</td>
                        <td>{match.ply_count ?? '—'}</td>
                        <td>{formatDuration(match.log?.elapsed_ms ?? match.elapsed_ms)}</td>
                        <LogButton match={match} onOpen={openDialog} />
                      </tr>
                    ))}
                  </DataTable>
                ) : (
                  <Empty title="Chưa chấm ván nào" description="Chạy worker để bắt đầu; kết quả sẽ xuất hiện tại đây." />
                )}
              </Panel>
            </>
          )}
        </>
      )}

      {selected && (
        <JudgeMatchDialog
          matchId={selected}
          onClose={closeDialog}
          onOpenReplay={(matchId) => {
            closeDialog();
            onOpenReplay?.(matchId);
          }}
          onExpired={() => {
            closeDialog();
            onExpired?.();
          }}
        />
      )}
    </>
  );
}
