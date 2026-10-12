import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Bot, RefreshCw, Users } from 'lucide-react';
import {
  getAdminKey,
  getApiBase,
  setAdminKey as persistAdminKey,
  setApiBase as persistApiBase,
  tournamentApi,
} from './api.js';
import ParticipantsView from './ParticipantsView.jsx';
import TournamentsView from './TournamentsView.jsx';
import TournamentDetailView from './TournamentDetailView.jsx';
import './tournament.css';

/** Polling 2–3 giây theo doc 03 §5 (không thêm WebSocket cho MVP). */
const POLL_MS = 3000;

/**
 * Tab "Giải đấu bot": sở hữu toàn bộ dữ liệu tournament (participants, giải, bracket, replay).
 * Không đụng tới `usePlayRoom` hay state của phòng chơi người thật.
 */
export default function TournamentApp() {
  const [tab, setTab] = useState('teams');
  const [adminKey, setAdminKeyState] = useState(() => getAdminKey());
  const [apiBase, setApiBaseState] = useState(() => getApiBase());
  const [apiOk, setApiOk] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [tournaments, setTournaments] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [standings, setStandings] = useState(null);
  const [bracket, setBracket] = useState(null);
  const [matches, setMatches] = useState([]);
  const [replay, setReplay] = useState(null);
  const [replayError, setReplayError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const busyRef = useRef(false);

  const refreshBase = useCallback(async () => {
    try {
      const [participantData, tournamentData] = await Promise.all([
        tournamentApi.listParticipants(),
        tournamentApi.listTournaments(),
      ]);
      setParticipants(participantData.participants || []);
      setTournaments(tournamentData.tournaments || []);
      setApiOk(true);
    } catch (fetchError) {
      setApiOk(false);
      if (fetchError.code !== 'network_error') setError(fetchError.message);
    }
  }, []);

  const refreshDetail = useCallback(async (tournamentId) => {
    if (!tournamentId) return;
    try {
      const [detailData, standingsData, bracketData, matchData] = await Promise.all([
        tournamentApi.getTournament(tournamentId),
        tournamentApi.getStandings(tournamentId),
        tournamentApi.getBracket(tournamentId),
        tournamentApi.listTournamentMatches(tournamentId),
      ]);
      setDetail(detailData);
      setStandings(standingsData);
      setBracket(bracketData);
      setMatches(matchData.matches || []);
      setApiOk(true);
    } catch (fetchError) {
      setApiOk(false);
      if (fetchError.code !== 'network_error') setError(fetchError.message);
    }
  }, []);

  // Polling danh sách đội/giải; tạm dừng khi đang có thao tác ghi để tránh đè state.
  useEffect(() => {
    refreshBase();
    const timer = setInterval(() => {
      if (!busyRef.current) refreshBase();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [refreshBase]);

  // Polling chi tiết giải đang mở (chỉ khi người dùng đã chọn giải).
  useEffect(() => {
    if (!selectedId) return undefined;
    refreshDetail(selectedId);
    const timer = setInterval(() => {
      if (!busyRef.current) refreshDetail(selectedId);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [selectedId, refreshDetail]);

  /** Bọc thao tác ghi: bật busy, hiển thị lỗi gọn, luôn trả boolean cho UI. */
  async function run(action, successMessage) {
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await action();
      if (successMessage) setNotice(successMessage);
      return result === undefined ? true : result;
    } catch (actionError) {
      setError(`${actionError.message}${actionError.code ? ` [${actionError.code}]` : ''}`);
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function handleAdminKeyChange(value) {
    setAdminKeyState(value);
    persistAdminKey(value);
  }


  function handleApiBaseChange(value) {
    setApiBaseState(value);
    persistApiBase(value);
  }

  const handleCreateParticipant = (name) =>
    run(async () => {
      await tournamentApi.createParticipant(name);
      await refreshBase();
      setNotice(`Đã tạo đội “${name.trim()}”. Giờ upload file .py cho đội này.`);
      return true;
    });

  const handleUploadBot = (participantId, file) =>
    run(async () => {
      const submission = await tournamentApi.uploadBot(participantId, file);
      await refreshBase();
      if (submission.status === 'valid') {
        setNotice(`Bot ${file.name} hợp lệ (sha256 ${submission.sha256.slice(0, 12)}…).`);
      } else {
        setError(`Bot ${file.name} không hợp lệ: ${submission.validation_error || 'không rõ lý do'}`);
      }
      return submission.status === 'valid';
    });

  const handleCreateTournament = (name, participantIds) =>
    run(async () => {
      const tournament = await tournamentApi.createTournament(name, participantIds);
      await refreshBase();
      setSelectedId(tournament.id);
      setDetail(tournament);
      setNotice(`Đã tạo giải “${tournament.name}” (draft). Bấm Start để sinh lịch đấu.`);
      return true;
    });

  const handleStartTournament = (tournamentId) =>
    run(async () => {
      await tournamentApi.startTournament(tournamentId);
      await Promise.all([refreshBase(), refreshDetail(tournamentId)]);
      setSelectedId(tournamentId);
      setNotice('Đã start giải. Mở terminal khác chạy `npm run dev:worker` để chạy các game.');
      return true;
    });

  const handleOpenReplay = async (matchId) => {
    setReplayError(null);
    try {
      const [matchData, replayData] = await Promise.all([
        tournamentApi.getMatch(matchId),
        tournamentApi.getReplay(matchId),
      ]);
      setReplay({ match: matchData, data: replayData });
    } catch (replayFetchError) {
      setReplay(null);
      setReplayError(`Không tải được replay: ${replayFetchError.message}`);
    }
  };

  function handleBack() {
    setSelectedId(null);
    setDetail(null);
    setStandings(null);
    setBracket(null);
    setMatches([]);
    setReplay(null);
    setReplayError(null);
  }

  const sampleBotUrl = tournamentApi.sampleBotUrl();


  return (
    <div className="tournament-app">
      <div className="tournament-app__bar">
        <div className="tournament-app__tabs">
          <button
            type="button"
            className={`app-tab ${tab === 'teams' ? 'app-tab--active' : ''}`}
            onClick={() => setTab('teams')}
          >
            <Bot className="w-4 h-4" /> Đội &amp; Bot
          </button>
          <button
            type="button"
            className={`app-tab ${tab === 'tournament' ? 'app-tab--active' : ''}`}
            onClick={() => setTab('tournament')}
          >
            <Users className="w-4 h-4" /> Giải đấu
          </button>
        </div>

        <div className="tournament-app__status">
          <span className={`chip chip--${apiOk === false ? 'warn' : apiOk ? 'ok' : 'neutral'}`}>
            {apiOk === false ? 'API chưa kết nối' : apiOk ? 'API local OK' : 'Đang kiểm tra API…'}
          </span>
          <button
            type="button"
            className="btn btn--secondary btn--small"
            onClick={() => {
              refreshBase();
              if (selectedId) refreshDetail(selectedId);
            }}
            disabled={busy}
          >
            <RefreshCw className="w-3.5 h-3.5" /> Làm mới
          </button>
        </div>
      </div>

      {apiOk === false && (
        <div className="notice notice--warn">
          <AlertTriangle className="w-4 h-4" /> Không gọi được API tournament. Hãy chạy{' '}
          <code>npm run dev:api</code> (127.0.0.1:3001) và mở UI qua <code>npm run dev</code> để dùng Vite
          proxy <code>/api</code>.
        </div>
      )}

      {notice && <p className="notice notice--ok">{notice}</p>}
      {error && <p className="notice notice--warn">Lỗi: {error}</p>}

      {tab === 'teams' ? (
        <ParticipantsView
          participants={participants}
          busy={busy}
          adminKey={adminKey}
          onAdminKeyChange={handleAdminKeyChange}
          apiBase={apiBase}
          onApiBaseChange={handleApiBaseChange}
          sampleBotUrl={sampleBotUrl}
          onCreateParticipant={handleCreateParticipant}
          onUploadBot={handleUploadBot}
          onRefresh={refreshBase}
          error={null}
        />
      ) : selectedId ? (
        <TournamentDetailView
          detail={detail}
          standings={standings}
          bracket={bracket}
          matches={matches}
          busy={busy}
          replay={replay}
          replayError={replayError}
          onBack={handleBack}
          onStart={() => handleStartTournament(selectedId)}
          onRefresh={() => refreshDetail(selectedId)}
          onOpenReplay={handleOpenReplay}
          onCloseReplay={() => setReplay(null)}
        />
      ) : (
        <TournamentsView
          tournaments={tournaments}
          participants={participants}
          busy={busy}
          onCreateTournament={handleCreateTournament}
          onStartTournament={handleStartTournament}
          onOpenTournament={(tournamentId) => setSelectedId(tournamentId)}
          onRefresh={refreshBase}
        />
      )}
    </div>
  );
}
