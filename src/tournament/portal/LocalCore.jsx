import React, { useCallback, useEffect, useRef, useState } from 'react';
import { apiRequest, isSessionError, resetApiState } from './portalApi.js';
import { parseHashRoute, routeHash } from './tournamentView.js';
import { readRememberedAccount, saveRememberedAccount } from './rememberAccount.js';
import LoginScreen from './LoginScreen.jsx';
import TournamentWorkspace from './TournamentWorkspace.jsx';
import OfflinePlay from './OfflinePlay.jsx';
import LivePage from './live/LivePage.jsx';
import { parseLiveHash } from './live/liveView.js';

const EMPTY_BUSY = {
  login: false,
  teamCreate: false,
  password: false,
  profile: false,
  upload: false,
  event: false,
  start: false,
};

const CLOSED_REPLAY = { open: false, state: 'idle', data: null, error: '' };

export default function LocalCore({ theme, onToggleTheme }) {
  const [offline, setOffline] = useState(false);
  const [account, setAccount] = useState(null);
  const [events, setEvents] = useState([]);
  const [teams, setTeams] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [teamFilter, setTeamFilter] = useState('');
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [busy, setBusy] = useState(EMPTY_BUSY);
  const [toast, setToast] = useState(null);
  const [loginError, setLoginError] = useState('');
  const [loginNotice, setLoginNotice] = useState('');
  const [serverStatus, setServerStatus] = useState('checking');
  const [replay, setReplay] = useState(CLOSED_REPLAY);
  const [route, setRoute] = useState({ page: 'overview', eventId: null });
  const [remembered, setRemembered] = useState(() => readRememberedAccount(typeof window === 'undefined' ? null : window.localStorage));
  const [liveHash, setLiveHash] = useState(() => window.location.hash);

  const accountRef = useRef(null);
  const routeRef = useRef(route);
  const teamFilterRef = useRef('');
  const toastTimer = useRef(null);

  accountRef.current = account;
  routeRef.current = route;
  teamFilterRef.current = teamFilter;

  const notify = useCallback((message, tone = 'success') => {
    setToast({ message, tone, at: Date.now() });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 5200);
  }, []);

  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  // Trang khán giả `#/live` độc lập với đăng nhập; theo dõi hash để điều hướng nhẹ
  // không cần thêm react-router.
  useEffect(() => {
    const onHashChange = () => setLiveHash(window.location.hash);
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const setPending = useCallback((key, value) => {
    setBusy((current) => ({ ...current, [key]: value }));
  }, []);

  const expireSession = useCallback((message = 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.') => {
    resetApiState();
    setAccount(null);
    setEvents([]);
    setTeams([]);
    setAccounts([]);
    setSubmissions([]);
    setTeamFilter('');
    setDetail(null);
    setDetailError('');
    setReplay(CLOSED_REPLAY);
    setLoginError('');
    setLoginNotice(message);
    setRoute({ page: 'overview', eventId: null });
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }, []);

  const handleError = useCallback((error, { silent = false } = {}) => {
    if (isSessionError(error)) {
      expireSession();
      return;
    }
    if (!silent) notify(error.message || 'Thao tác thất bại.', 'danger');
  }, [expireSession, notify]);

  const checkHealth = useCallback(async () => {
    setServerStatus('checking');
    try {
      const response = await fetch('/api/health', { headers: { Accept: 'application/json' } });
      const data = await response.json().catch(() => ({}));
      setServerStatus(data?.ok ? 'online' : 'offline');
    } catch {
      setServerStatus('offline');
    }
  }, []);

  useEffect(() => {
    if (!account) checkHealth();
  }, [account, checkHealth]);

  const loadRoleData = useCallback(async () => {
    const current = accountRef.current;
    if (!current) return;
    const eventData = await apiRequest('/events');
    setEvents(Array.isArray(eventData.events) ? eventData.events : []);
    if (current.role === 'admin') {
      const roster = await apiRequest('/teams');
      setTeams(Array.isArray(roster.participants) ? roster.participants : []);
      setAccounts(Array.isArray(roster.accounts) ? roster.accounts : []);
      const filter = teamFilterRef.current;
      if (filter) {
        const data = await apiRequest(`/submissions?team=${encodeURIComponent(filter)}`);
        setSubmissions(Array.isArray(data.submissions) ? data.submissions : []);
      }
      return;
    }
    if (current.participant_id) {
      const data = await apiRequest(`/submissions?team=${encodeURIComponent(current.participant_id)}`);
      setSubmissions(Array.isArray(data.submissions) ? data.submissions : []);
    }
  }, []);

  const navigate = useCallback((page, eventId = null) => {
    const next = { page, eventId: eventId || null };
    const hash = routeHash(next);
    if (window.location.hash === hash) {
      setRoute(next);
      return;
    }
    window.location.hash = hash;
  }, []);

  useEffect(() => {
    if (!account) return undefined;
    const apply = () => setRoute(parseHashRoute(window.location.hash, account.role));
    apply();
    window.addEventListener('hashchange', apply);
    return () => window.removeEventListener('hashchange', apply);
  }, [account]);

  useEffect(() => {
    if (!account || !route.eventId) {
      setDetail(null);
      setDetailError('');
      setDetailLoading(false);
      return undefined;
    }
    let active = true;
    setDetailLoading(true);
    setDetailError('');
    apiRequest(`/events/${encodeURIComponent(route.eventId)}`)
      .then((data) => {
        if (active) setDetail(data);
      })
      .catch((error) => {
        if (!active) return;
        if (isSessionError(error)) expireSession();
        else setDetailError(error.message);
      })
      .finally(() => {
        if (active) setDetailLoading(false);
      });
    return () => {
      active = false;
    };
  }, [account, route.eventId, expireSession]);

  useEffect(() => {
    if (!account) return undefined;
    let stopped = false;
    let timer = null;
    let inFlight = false;

    const tick = async () => {
      if (stopped || inFlight) return;
      if (document.visibilityState === 'hidden') {
        timer = window.setTimeout(tick, 6000);
        return;
      }
      inFlight = true;
      try {
        await loadRoleData();
        const eventId = routeRef.current.eventId;
        if (eventId) {
          const data = await apiRequest(`/events/${encodeURIComponent(eventId)}`);
          if (!stopped) {
            setDetail(data);
            setDetailError('');
          }
        }
      } catch (error) {
        if (isSessionError(error)) {
          expireSession();
          return;
        }
      } finally {
        inFlight = false;
      }
      if (!stopped) timer = window.setTimeout(tick, 4000);
    };

    tick();
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        window.clearTimeout(timer);
        tick();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [account, loadRoleData, expireSession]);

  const runAction = useCallback(async (key, task, successMessage) => {
    setPending(key, true);
    try {
      await task();
      if (successMessage) notify(successMessage, 'success');
      return true;
    } catch (error) {
      handleError(error);
      return false;
    } finally {
      setPending(key, false);
    }
  }, [handleError, notify, setPending]);

  const signIn = useCallback(async ({ username, password, remember = false }) => {
    setLoginError('');
    setLoginNotice('');
    setPending('login', true);
    try {
      const data = await apiRequest('/login', {
        method: 'POST',
        body: { username, password, remember: remember === true },
      });
      setServerStatus('online');
      setAccount(data.account);
      setRoute(parseHashRoute(window.location.hash, data.account.role));
      saveRememberedAccount(window.localStorage, data.account.username, remember === true);
      setRemembered(readRememberedAccount(window.localStorage));
    } catch (error) {
      setLoginError(error.message || 'Đăng nhập thất bại.');
      if (!error.status || error.status >= 500) {
        setServerStatus('offline');
        checkHealth();
      }
    } finally {
      setPending('login', false);
    }
  }, [checkHealth, setPending]);

  const signOut = useCallback(async () => {
    try {
      await apiRequest('/logout', { method: 'POST' });
    } catch {
      /* đăng xuất local: bỏ qua lỗi mạng */
    }
    expireSession('Đã đăng xuất khỏi cổng giải đấu.');
  }, [expireSession, openReplayPayload]);

  const refresh = useCallback(async () => {
    try {
      await loadRoleData();
      const eventId = routeRef.current.eventId;
      if (eventId) {
        const data = await apiRequest(`/events/${encodeURIComponent(eventId)}`);
        setDetail(data);
        setDetailError('');
      }
    } catch (error) {
      handleError(error);
    }
  }, [handleError, loadRoleData]);

  const selectTeam = useCallback(async (teamId) => {
    teamFilterRef.current = teamId;
    setTeamFilter(teamId);
    setSubmissions([]);
    if (!teamId) return;
    try {
      const data = await apiRequest(`/submissions?team=${encodeURIComponent(teamId)}`);
      setSubmissions(Array.isArray(data.submissions) ? data.submissions : []);
    } catch (error) {
      handleError(error);
    }
  }, [handleError]);

  const saveProfile = useCallback((values) => runAction('profile', async () => {
    const data = await apiRequest('/profile', { method: 'PUT', body: values });
    setAccount(data.account);
    accountRef.current = data.account;
  }, 'Đã lưu hồ sơ đội.'), [runAction]);

  const createTeam = useCallback((values) => runAction('teamCreate', async () => {
    await apiRequest('/teams', { method: 'POST', body: values });
    await loadRoleData();
  }, `Đã cấp tài khoản cho đội ${values.name}.`), [loadRoleData, runAction]);

  const resetPassword = useCallback((accountId, password) => runAction('password', async () => {
    await apiRequest(`/accounts/${encodeURIComponent(accountId)}/password`, { method: 'POST', body: { password } });
  }, 'Đã đặt lại mật khẩu và thu hồi các phiên cũ.'), [runAction]);

  const uploadBot = useCallback(async (teamId, file) => {
    setPending('upload', true);
    try {
      const body = new FormData();
      body.append('file', file, file.name);
      const data = await apiRequest(`/submissions/${encodeURIComponent(teamId)}`, { method: 'POST', body });
      const valid = data.status === 'valid';
      notify(
        valid
          ? 'Bot hợp lệ. Server đã lưu bài, tính SHA-256 và cập nhật danh sách.'
          : `Đã nhận bài nhưng chưa hợp lệ: ${data.validation_error || data.status}`,
        valid ? 'success' : 'warning'
      );
      await loadRoleData();
      return true;
    } catch (error) {
      handleError(error);
      return false;
    } finally {
      setPending('upload', false);
    }
  }, [handleError, loadRoleData, notify, setPending]);

  const createEvent = useCallback((values) => runAction('event', async () => {
    const event = await apiRequest('/events', { method: 'POST', body: values });
    await loadRoleData();
    if (event?.id) navigate('events', event.id);
  }, 'Đã tạo thư mục giải. Có thể thêm đội và map sau.'), [loadRoleData, navigate, runAction]);

  const saveEvent = useCallback((eventId, values) => runAction('event', async () => {
    await apiRequest(`/events/${encodeURIComponent(eventId)}`, { method: 'PUT', body: values });
    const data = await apiRequest(`/events/${encodeURIComponent(eventId)}`);
    setDetail(data);
    await loadRoleData();
  }, 'Đã lưu thiết lập của giải.'), [loadRoleData, runAction]);

  const startEvent = useCallback((eventId) => runAction('start', async () => {
    await apiRequest(`/events/${encodeURIComponent(eventId)}/start`, { method: 'POST' });
    await loadRoleData();
    const data = await apiRequest(`/events/${encodeURIComponent(eventId)}`);
    setDetail(data);
  }, 'Giải đã bắt đầu. Bài nộp của các đội tham gia đã bị khóa.'), [loadRoleData, runAction]);

  const openReplayPayload = useCallback((data) => {
    if (!data || !data.replay) {
      setReplay({ open: true, state: 'error', data: null, error: 'Dữ liệu replay không hợp lệ.' });
      return;
    }
    setReplay({ open: true, state: 'ready', data, error: '' });
  }, []);

  const openReplay = useCallback(async (target) => {
    if (typeof target === 'object' && target !== null && target.replay) {
      openReplayPayload(target);
      return;
    }
    const matchId = target;
    setReplay({ open: true, state: 'loading', data: null, error: '' });
    try {
      const data = await apiRequest(`/matches/${encodeURIComponent(matchId)}/replay`);
      setReplay({ open: true, state: 'ready', data, error: '' });
    } catch (error) {
      if (isSessionError(error)) {
        setReplay(CLOSED_REPLAY);
        expireSession();
        return;
      }
      setReplay({ open: true, state: 'error', data: null, error: error.message || 'Không tải được replay.' });
    }
  }, [expireSession, openReplayPayload]);

  const closeReplay = useCallback(() => setReplay(CLOSED_REPLAY), []);

  const liveRoute = parseLiveHash(liveHash);
  if (liveRoute.live) {
    return (
      <LivePage
        account={account}
        matchId={liveRoute.matchId}
        theme={theme}
        onToggleTheme={onToggleTheme}
      />
    );
  }

  if (!account && offline) return <OfflinePlay onBack={() => setOffline(false)} />;
  if (!account) {
    return (
      <LoginScreen
        onSubmit={signIn}
        onOffline={() => setOffline(true)}
        busy={busy.login}
        error={loginError}
        notice={loginNotice}
        serverStatus={serverStatus}
        theme={theme}
        onToggleTheme={onToggleTheme}
        initialUsername={remembered.username}
        initialRemember={remembered.remember}
      />
    );
  }

  return (
    <TournamentWorkspace
      account={account}
      theme={theme}
      onToggleTheme={onToggleTheme}
      route={route}
      onNavigate={navigate}
      onLogout={signOut}
      events={events}
      teams={teams}
      accounts={accounts}
      submissions={submissions}
      teamFilter={teamFilter}
      onSelectTeam={selectTeam}
      detail={detail}
      detailLoading={detailLoading}
      detailError={detailError}
      busy={busy}
      toast={toast}
      onDismissToast={() => setToast(null)}
      replay={replay}
      onOpenReplay={openReplay}
      onOpenReplayPayload={openReplayPayload}
      onCloseReplay={closeReplay}
      actions={{ refresh, saveProfile, createTeam, resetPassword, uploadBot, createEvent, saveEvent, startEvent, onSessionExpired: expireSession }}
    />
  );
}

