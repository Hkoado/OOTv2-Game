import React from 'react';
import {
  ArrowRight, CheckCircle2, Circle, FileCode2, ShieldCheck, Swords, Trophy, UploadCloud, Users,
} from 'lucide-react';
import { Badge, Panel, Progress, Stat } from './TournamentUi.jsx';
import EventList from './EventList.jsx';
import {
  botState, eventProgress, eventStatusLabel, eligibleTeams, formatDateTime, isEventRunning,
  teamBotState,
} from './tournamentView.js';

function Checklist({ items }) {
  return (
    <ul className="tt-checklist">
      {items.map((item) => (
        <li key={item.label} className={item.done ? 'is-done' : ''}>
          {item.done ? <CheckCircle2 size={17} aria-hidden="true" /> : <Circle size={17} aria-hidden="true" />}
          <span className="tt-checklist__text"><strong>{item.label}</strong>{item.hint && <em>{item.hint}</em>}</span>
          {item.action}
        </li>
      ))}
    </ul>
  );
}

function OverviewHead({ account, isAdmin, onNavigate }) {
  return (
    <header className="tt-page-head">
      <div>
        <p className="tt-eyebrow">{isAdmin ? 'Ban tổ chức · vận hành giải' : 'Đội thi · mùa giải local'}</p>
        <h1 className="tt-page-title">{isAdmin ? 'Bảng điều khiển giải đấu' : `Xin chào, ${account.name}`}</h1>
        <p className="tt-page-lead">
          {isAdmin
            ? 'Thiết lập giải tuần, tháng, kỳ theo điều lệ; theo dõi đội, bài nộp và tiến độ. Giải chính thức chưa bật chấm bằng scheduler MVP.'
            : 'Nộp bot, theo dõi bảng đấu và xem lại từng ván. Bot của đội được khóa khi giải bắt đầu.'}
        </p>
      </div>
      <div className="tt-page-actions">
        {isAdmin ? (
          <>
            <button type="button" className="tt-btn tt-btn--primary" onClick={() => onNavigate('events')}>
              <Trophy size={16} aria-hidden="true" />
              Quản lý giải
            </button>
            <button type="button" className="tt-btn" onClick={() => onNavigate('teams')}>
              <Users size={16} aria-hidden="true" />
              Cấp tài khoản
            </button>
          </>
        ) : (
          <>
            <button type="button" className="tt-btn tt-btn--primary" onClick={() => onNavigate('bot')}>
              <UploadCloud size={16} aria-hidden="true" />
              Nộp / cập nhật bot
            </button>
            <button type="button" className="tt-btn" onClick={() => onNavigate('events')}>
              <Swords size={16} aria-hidden="true" />
              Xem giải
            </button>
          </>
        )}
      </div>
    </header>
  );
}

function TeamOverview({ account, events, submissions, onNavigate, onOpenEvent }) {
  const bot = botState(submissions);
  const running = events.find((event) => isEventRunning(event.status)) || null;
  const totals = events.reduce(
    (acc, event) => ({
      total: acc.total + (Number(event.match_total) || 0),
      finished: acc.finished + (Number(event.match_finished) || 0),
    }),
    { total: 0, finished: 0 }
  );

  return (
    <>
      <section className="tt-stats" aria-label="Chỉ số của đội">
        <Stat
          label="Bot đang dùng"
          value={bot.hasValid ? 'Hợp lệ' : 'Chưa có'}
          hint={bot.latest ? `Bài mới nhất ${formatDateTime(bot.latest.created_at)}` : 'Chưa nộp file .py nào'}
          tone={bot.hasValid ? 'success' : 'warning'}
          icon={<FileCode2 size={18} />}
        />
        <Stat label="Bài đã nộp" value={bot.total} hint={`${bot.validCount} hợp lệ · ${bot.failedCount} lỗi`} icon={<UploadCloud size={18} />} />
        <Stat label="Giải tham gia" value={events.length} hint={running ? `Đang chạy: ${running.name}` : 'Chưa có giải đang chạy'} icon={<Trophy size={18} />} />
        <Stat label="Ván đã chấm" value={`${totals.finished}/${totals.total}`} hint="Tính trên các giải đội tham gia" icon={<Swords size={18} />} tone={totals.total ? 'info' : 'neutral'} />
      </section>

      <div className="tt-grid tt-grid--2">
        <Panel title="Việc cần làm" subtitle="Hoàn tất trước khi BTC khóa bài">
          <Checklist
            items={[
              {
                label: 'Có ít nhất một bot hợp lệ',
                hint: bot.hasValid ? 'Server đã kiểm tra cú pháp và smoke test.' : 'Nộp file .py để hệ thống kiểm tra.',
                done: bot.hasValid,
                action: !bot.hasValid ? (
                  <button type="button" className="tt-btn tt-btn--sm" onClick={() => onNavigate('bot')}>Nộp bot</button>
                ) : null,
              },
              {
                label: 'Hồ sơ đội đầy đủ',
                hint: account.members ? 'Đã có thành viên và liên hệ.' : 'Thêm thành viên và kênh liên hệ để BTC gọi khi cần.',
                done: Boolean(account.members && account.contact),
                action: !(account.members && account.contact) ? (
                  <button type="button" className="tt-btn tt-btn--sm" onClick={() => onNavigate('team')}>Bổ sung</button>
                ) : null,
              },
              {
                label: 'Khai báo repository GitHub',
                hint: account.repository ? `${account.repository} · branch ${account.branch}` : 'Chỉ lưu metadata, chưa đồng bộ code.',
                done: Boolean(account.repository),
                action: !account.repository ? (
                  <button type="button" className="tt-btn tt-btn--sm" onClick={() => onNavigate('team')}>Khai báo</button>
                ) : null,
              },
              {
                label: 'Sẵn sàng cho vòng đang chạy',
                hint: running ? `${running.name} · ${eventStatusLabel(running.status)}` : 'Chưa có giải nào của đội đang chạy.',
                done: Boolean(running),
              },
            ]}
          />
        </Panel>

        <Panel
          title="Giải đang theo dõi"
          subtitle={running ? 'Tiến độ được cập nhật mỗi 4 giây khi tab đang mở.' : 'Chưa có vòng nào đang chạy.'}
          actions={<Badge tone={running ? 'live' : 'neutral'} dot={Boolean(running)}>{running ? eventStatusLabel(running.status) : 'Chờ lịch'}</Badge>}
        >
          {running ? (
            <div className="tt-running">
              <h3 className="tt-running__name">{running.name}</h3>
              <p className="tt-running__meta">Bắt đầu {formatDateTime(running.created_at)} · tổng {running.match_total || 0} ván</p>
              <Progress value={eventProgress(running)} label="Tiến độ đã chấm" />
              <button type="button" className="tt-btn tt-btn--primary tt-btn--block" onClick={() => onOpenEvent(running.id)}>
                Mở bảng đấu
                <ArrowRight size={16} aria-hidden="true" />
              </button>
            </div>
          ) : (
            <div className="tt-note">
              <ShieldCheck size={17} aria-hidden="true" />
              <p>Khi BTC bắt đầu giải, bài nộp của đội sẽ khóa và bảng đấu xuất hiện tại đây.</p>
            </div>
          )}
        </Panel>
      </div>

      <EventPanel
        title="Giải gần đây"
        events={events}
        onNavigate={onNavigate}
        onOpenEvent={onOpenEvent}
        emptyTitle="Đội chưa tham gia giải nào"
        emptyDescription="BTC sẽ thêm đội vào giải khi đủ 8 đội có bot hợp lệ."
      />
    </>
  );
}

function EventPanel({ title, events, onNavigate, onOpenEvent, emptyTitle, emptyDescription, limit = 3 }) {
  const shown = events.slice(0, limit);
  return (
    <Panel
      title={title}
      subtitle={events.length ? `${events.length} giải trong hệ thống` : undefined}
      actions={(
        <button type="button" className="tt-btn tt-btn--ghost tt-btn--sm" onClick={() => onNavigate('events')}>
          Tất cả
          <ArrowRight size={14} aria-hidden="true" />
        </button>
      )}
    >
      <EventList
        events={shown}
        onOpen={onOpenEvent}
        emptyTitle={emptyTitle}
        emptyDescription={emptyDescription}
      />
    </Panel>
  );
}

function AdminOverview({ events, teams, onNavigate, onOpenEvent }) {
  const eligible = eligibleTeams(teams);
  const missing = teams.filter((team) => !team.latest_valid_submission_id);
  const running = events.filter((event) => isEventRunning(event.status));
  const totals = events.reduce(
    (acc, event) => ({
      total: acc.total + (Number(event.match_total) || 0),
      finished: acc.finished + (Number(event.match_finished) || 0),
    }),
    { total: 0, finished: 0 }
  );

  return (
    <>
      <section className="tt-stats" aria-label="Chỉ số vận hành">
        <Stat label="Đội trong hệ thống" value={teams.length} hint={`${eligible.length} đội đủ điều kiện vào giải`} icon={<Users size={18} />} />
        <Stat
          label="Bot hợp lệ"
          value={`${eligible.length}/${teams.length}`}
          hint={missing.length ? `${missing.length} đội cần bổ sung bot` : 'Tất cả đội đã có bot'}
          tone={missing.length ? 'warning' : 'success'}
          icon={<FileCode2 size={18} />}
        />
        <Stat label="Giải đang chạy" value={running.length} hint={running.length ? 'Worker đang chấm tuần tự' : 'Không có vòng nào đang chạy'} icon={<Trophy size={18} />} tone={running.length ? 'info' : 'neutral'} />
        <Stat label="Ván đã chấm" value={`${totals.finished}/${totals.total}`} hint="Toàn bộ giải trong hệ thống" icon={<Swords size={18} />} />
      </section>

      <div className="tt-grid tt-grid--2">
        <Panel
          title="Cần xử lý"
          subtitle={missing.length ? 'Đội chưa có bot hợp lệ sẽ không thể vào giải.' : 'Không có việc tồn đọng.'}
          actions={<Badge tone={missing.length ? 'warning' : 'success'}>{missing.length ? `${missing.length} đội` : 'Sạch'}</Badge>}
        >
          {missing.length ? (
            <ul className="tt-issue-list">
              {missing.slice(0, 6).map((team) => {
                const state = teamBotState(team);
                return (
                  <li key={team.id}>
                    <span className="tt-issue-list__name">{team.name}</span>
                    <Badge tone={state.tone}>{state.label}</Badge>
                    <button type="button" className="tt-btn tt-btn--ghost tt-btn--sm" onClick={() => onNavigate('bot')}>
                      Xem bài nộp
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="tt-muted">Tất cả {teams.length} đội đã có ít nhất một bài nộp hợp lệ. Có thể tạo giải 8 đội.</p>
          )}
        </Panel>

        <Panel
          title="Vòng đang chạy"
          subtitle="Theo dõi tiến độ và mở bảng đấu khi cần can thiệp."
          actions={<button type="button" className="tt-btn tt-btn--ghost tt-btn--sm" onClick={() => onNavigate('events')}>Quản lý</button>}
        >
          {running.length ? (
            <div className="tt-stack">
              {running.map((event) => (
                <div key={event.id} className="tt-running tt-running--compact">
                  <div className="tt-running__row">
                    <h3 className="tt-running__name">{event.name}</h3>
                    <Badge tone="live" dot>{eventStatusLabel(event.status)}</Badge>
                  </div>
                  <Progress value={eventProgress(event)} label={`${event.match_finished || 0}/${event.match_total || 0} ván`} />
                  <button type="button" className="tt-btn tt-btn--ghost tt-btn--sm" onClick={() => onOpenEvent(event.id)}>
                    Mở bảng đấu
                    <ArrowRight size={14} aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="tt-muted">Chưa có giải đang chạy. Tạo giải mới khi đã đủ 8 đội có bot hợp lệ.</p>
          )}
        </Panel>
      </div>

      <EventPanel
        title="Giải gần đây"
        events={events}
        onNavigate={onNavigate}
        onOpenEvent={onOpenEvent}
        emptyTitle="Chưa có giải nào"
        emptyDescription="Tạo giải tại trang Quản lý giải sau khi có đủ 8 đội có bot hợp lệ."
      />
    </>
  );
}

export default function OverviewPage({ account, events, teams, submissions, onNavigate, onOpenEvent }) {
  const isAdmin = account.role === 'admin';
  return (
    <>
      <OverviewHead account={account} isAdmin={isAdmin} onNavigate={onNavigate} />
      {isAdmin ? (
        <AdminOverview events={events} teams={teams} onNavigate={onNavigate} onOpenEvent={onOpenEvent} />
      ) : (
        <TeamOverview account={account} events={events} submissions={submissions} onNavigate={onNavigate} onOpenEvent={onOpenEvent} />
      )}
    </>
  );
}


