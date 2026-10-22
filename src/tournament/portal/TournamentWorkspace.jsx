import React, { useEffect, useMemo, useState } from 'react';
import {
  BookOpen, ChevronRight, LayoutDashboard, LogOut, Menu, Moon, Sun, Trophy, UploadCloud, Users, X, Activity,
} from 'lucide-react';
import { navTitle, tournamentNavigation, isEventRunning, initials } from './tournamentView.js';
import { Badge } from './TournamentUi.jsx';
import ReplayDialog from './ReplayDialog.jsx';
import OverviewPage from './OverviewPage.jsx';
import TeamProfilePage from './TeamProfilePage.jsx';
import TeamsPage from './TeamsPage.jsx';
import SubmissionsPage from './SubmissionsPage.jsx';
import EventsPage from './EventsPage.jsx';
import EventDetailPage from './EventDetailPage.jsx';
import JudgePage from './JudgePage.jsx';
import GuidePage from './GuidePage.jsx';

const ICONS = {
  dashboard: LayoutDashboard,
  team: Users,
  bot: UploadCloud,
  events: Trophy,
  judge: Activity,
  guide: BookOpen,
};

const TOAST_ICONS = { success: '✓', warning: '!', danger: '×' };

export default function TournamentWorkspace({
  account,
  theme,
  onToggleTheme,
  route,
  onNavigate,
  onLogout,
  events,
  teams,
  accounts,
  submissions,
  teamFilter,
  onSelectTeam,
  detail,
  detailLoading,
  detailError,
  busy,
  toast,
  onDismissToast,
  replay,
  onOpenReplay,
  onCloseReplay,
  actions,
}) {
  const [navOpen, setNavOpen] = useState(false);
  const isAdmin = account.role === 'admin';
  const navItems = useMemo(() => tournamentNavigation(account.role), [account.role]);
  const activeEvent = useMemo(() => events.find((event) => isEventRunning(event.status)) || null, [events]);

  useEffect(() => {
    setNavOpen(false);
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [route.page, route.eventId]);

  const pageProps = {
    account,
    events,
    teams,
    accounts,
    submissions,
    teamFilter,
    onSelectTeam,
    detail,
    detailLoading,
    detailError,
    busy,
    actions,
    onNavigate,
    onOpenEvent: (eventId) => onNavigate('events', eventId),
  };

  return (
    <div className={`tt-shell${navOpen ? ' tt-shell--nav-open' : ''}`}>
      <a className="tt-skip" href="#tt-main">Bỏ qua điều hướng</a>

      {navOpen && <button type="button" className="tt-scrim" aria-label="Đóng menu" onClick={() => setNavOpen(false)} />}

      <aside className={`tt-sidebar${navOpen ? ' is-open' : ''}`} aria-label="Điều hướng giải đấu">
        <div className="tt-sidebar__brand">
          <span className="tt-brand__mark" aria-hidden="true"><Trophy size={20} /></span>
          <span className="tt-brand__text"><strong>OOTv2</strong><span>Bot League</span></span>
          <button type="button" className="tt-icon-btn tt-sidebar__close" onClick={() => setNavOpen(false)} aria-label="Đóng menu">
            <X size={18} />
          </button>
        </div>

        <div className="tt-sidebar__meta">
          <span className="tt-eyebrow">{isAdmin ? 'Ban tổ chức' : 'Đội thi đấu'}</span>
          <strong>{isAdmin ? 'Admin console' : account.name}</strong>
        </div>

        <nav className="tt-nav" aria-label="Các mục của cổng giải đấu">
          {navItems.map((item) => {
            const Icon = ICONS[item.icon] || LayoutDashboard;
            const active = route.page === item.id;
            return (
              <button
                key={item.id}
                type="button"
                className={`tt-nav__item${active ? ' is-active' : ''}`}
                aria-current={active ? 'page' : undefined}
                onClick={() => onNavigate(item.id)}
              >
                <Icon size={18} aria-hidden="true" />
                <span>{item.title}</span>
                {active && <ChevronRight size={16} className="tt-nav__chevron" aria-hidden="true" />}
              </button>
            );
          })}
        </nav>

        <div className="tt-sidebar__foot">
          <div className="tt-account tt-account--sidebar">
            <span className="tt-avatar" aria-hidden="true">{initials(account.name)}</span>
            <span className="tt-account__text"><strong>{account.name}</strong><span>@{account.username}</span></span>
          </div>
          <button type="button" className="tt-btn tt-btn--ghost tt-btn--block" onClick={onLogout}>
            <LogOut size={16} aria-hidden="true" />
            Đăng xuất
          </button>
        </div>
      </aside>

      <div className="tt-main">
        <header className="tt-topbar">
          <button
            type="button"
            className="tt-icon-btn tt-menu"
            onClick={() => setNavOpen(true)}
            aria-expanded={navOpen}
            aria-label="Mở menu điều hướng"
          >
            <Menu size={18} />
          </button>
          <div className="tt-topbar__title">
            <span className="tt-eyebrow">
              {isAdmin ? 'BTC' : 'Đội'} / {route.page === 'events' && route.eventId ? 'Chi tiết giải' : 'Cổng giải đấu'}
            </span>
            <strong>{navTitle(account.role, route.page)}</strong>
          </div>
          <div className="tt-topbar__right">
            {activeEvent ? (
              <button
                type="button"
                className="tt-live"
                onClick={() => onNavigate('events', activeEvent.id)}
                title={activeEvent.name}
              >
                <span className="tt-live__dot" aria-hidden="true" />
                <span className="tt-live__text">Đang chạy · {activeEvent.name}</span>
              </button>
            ) : (
              <span className="tt-live tt-live--idle"><span className="tt-live__dot" aria-hidden="true" />Local · MVP</span>
            )}
            <button
              type="button"
              className="tt-icon-btn"
              onClick={onToggleTheme}
              aria-label={theme === 'light' ? 'Chuyển sang theme tối' : 'Chuyển sang theme sáng'}
            >
              {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
            </button>
            <div className="tt-account tt-account--top">
              <span className="tt-avatar" aria-hidden="true">{initials(account.name)}</span>
              <span className="tt-account__text">
                <strong>{account.name}</strong>
                <Badge tone={isAdmin ? 'info' : 'accent'}>{isAdmin ? 'Admin' : 'Đội'}</Badge>
              </span>
            </div>
          </div>
        </header>

        <main className="tt-content" id="tt-main" tabIndex={-1}>
          {route.page === 'overview' && <OverviewPage {...pageProps} />}
          {route.page === 'team' && !isAdmin && <TeamProfilePage {...pageProps} />}
          {route.page === 'teams' && isAdmin && <TeamsPage {...pageProps} />}
          {route.page === 'bot' && <SubmissionsPage {...pageProps} />}
          {route.page === 'events' && (route.eventId
            ? <EventDetailPage {...pageProps} eventId={route.eventId} onOpenReplay={onOpenReplay} />
            : <EventsPage {...pageProps} />)}
          {route.page === 'judge' && isAdmin && <JudgePage actions={actions} onOpenReplay={onOpenReplay} />}
          {route.page === 'guide' && <GuidePage account={account} />}
        </main>

        <footer className="tt-foot">
          <span>OOTv2 · Giải đấu bot Oẳn Tù Tì 9×9</span>
          <span>Dữ liệu local SQLite · không có sandbox cấp hệ điều hành · chỉ dùng cho thành viên tin cậy</span>
        </footer>
      </div>

      {toast && (
        <div className="tt-toasts" role="status" aria-live="polite">
          <div className={`tt-toast tt-toast--${toast.tone || 'info'}`}>
            <span className="tt-toast__mark" aria-hidden="true">{TOAST_ICONS[toast.tone] || 'i'}</span>
            <span className="tt-toast__text">{toast.message}</span>
            <button type="button" className="tt-toast__close" onClick={onDismissToast} aria-label="Đóng thông báo">×</button>
          </div>
        </div>
      )}

      {replay.open && (
        <ReplayDialog state={replay.state} data={replay.data} error={replay.error} onClose={onCloseReplay} />
      )}
    </div>
  );
}

