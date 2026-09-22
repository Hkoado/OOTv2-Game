import React, { useState, useEffect } from 'react';
import Header from './components/Header.jsx';
import Lobby from './components/Lobby.jsx';
import Board from './components/Board.jsx';
import SetupPanel from './components/SetupPanel.jsx';
import PlayerCard from './components/PlayerCard.jsx';
import MoveHistory from './components/MoveHistory.jsx';
import GameOverModal from './components/GameOverModal.jsx';
import RulesModal from './components/RulesModal.jsx';
import { usePlayRoom } from './sync/usePlayRoom.js';
import { GAME_PHASES } from './game/gameState.js';
import { PLAYERS, PIECE_TYPES } from './game/constants.js';
import { Users, UserCheck, Copy, Swords, Sparkles, Clock, Check } from 'lucide-react';

// Component con cho phòng chơi, sử dụng key={roomId} để reset sạch sẽ mỗi khi đổi phòng
function RoomView({ roomId, playerName, onLeaveRoom, onRoleChange }) {
  const {
    gameState,
    role,
    isHost,
    clientId,
    isConnected,
    handleApprovePlayer,
    handlePlacePieceInSetup,
    handleRemovePieceFromBoardInSetup,
    handleQuickAutoPlace,
    handleConfirmSetup,
    handleMakeMove,
    handleRestartGame,
  } = usePlayRoom(roomId, playerName);

  const [selectedSetupType, setSelectedSetupType] = useState(PIECE_TYPES.ROCK);

  // Báo role ra ngoài để Header hiển thị đúng vai trò
  useEffect(() => {
    onRoleChange?.(role);
  }, [role, onRoleChange]);

  const {
    phase = GAME_PHASES.WAITING,
    seats = {},
    participants = [],
    turn = PLAYERS.RED,
    pieces = {},
    winner = null,
    winReason = null,
    history = [],
    lastMove = null,
  } = gameState || {};

  const isSetupPhase = phase === GAME_PHASES.SETUP_RED || phase === GAME_PHASES.SETUP_BLUE;
  const isPlayingPhase = phase === GAME_PHASES.PLAYING;
  const isWaitingPhase = phase === GAME_PHASES.WAITING;

  // Lọc danh sách đối thủ tiềm năng (không phải Host/Red)
  const candidateOpponents = participants.filter(
    (p) => p.id !== gameState?.hostId && p.id !== seats?.[PLAYERS.RED]?.id
  );

  return (
    <div className="room-game-layout">
      {/* 1. KHỐI DUYỆT NGƯỜI CHƠI TRONG GIAI ĐOẠN CHỜ (WAITING) */}
      {isWaitingPhase && (
        <div className="waiting-approval-banner card">
          <div className="waiting-approval-top">
            <div className="flex items-center gap-3">
              <div className="waiting-icon-box">
                <Users className="w-5 h-5 text-emerald-700" />
              </div>
              <div>
                <h3 className="font-bold text-sm text-neutral-800 flex items-center gap-2">
                  Phòng thi đấu: <span className="font-mono text-emerald-700">{roomId}</span>
                </h3>
                <p className="text-xs text-neutral-500">
                  {isHost
                    ? 'Bạn là Chủ phòng (Đội Đỏ). Hãy duyệt người bạn muốn đấu cùng từ danh sách bên dưới để bắt đầu trận!'
                    : 'Bạn đang trong phòng chờ. Hãy đợi Chủ phòng duyệt bạn vào Đội Xanh để bắt đầu!'}
                </p>
              </div>
            </div>

            <button
              type="button"
              className="btn btn--secondary btn--small"
              onClick={() => {
                const inviteUrl = window.location.href;
                navigator.clipboard?.writeText(inviteUrl);
                alert('Đã sao chép link mời: ' + inviteUrl);
              }}
            >
              <Copy className="w-3.5 h-3.5" />
              <span>Sao chép link phòng</span>
            </button>
          </div>

          {/* Danh sách thành viên trong phòng */}
          <div className="waiting-participants-section">
            <div className="waiting-participants-header">
              <span className="font-semibold text-xs text-neutral-700">
                Thành viên trong phòng ({participants.length}):
              </span>
              <span className="text-xs text-neutral-400">
                {isHost ? '👉 Bấm "Duyệt làm Đội Xanh" để chốt đấu thủ' : 'Chờ Chủ phòng lựa chọn'}
              </span>
            </div>

            <div className="waiting-participants-grid">
              {participants.map((p) => {
                const isThisHost = p.id === gameState?.hostId || p.id === seats?.[PLAYERS.RED]?.id;
                const isMe = p.id === clientId;

                return (
                  <div key={p.id} className="participant-item">
                    <div className="flex items-center gap-2">
                      <span className="participant-icon">{isThisHost ? '👑' : '👤'}</span>
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-xs text-neutral-800">{p.name}</span>
                          {isMe && <span className="badge badge--small badge--blue">Bạn</span>}
                          {isThisHost && <span className="badge badge--small badge--red">Chủ phòng</span>}
                        </div>
                        <span className="text-[11px] text-neutral-400">
                          {isThisHost ? 'Đội Đỏ (Chủ trì)' : 'Ứng viên chờ duyệt'}
                        </span>
                      </div>
                    </div>

                    {/* Nút duyệt dành riêng cho Chủ phòng */}
                    {isHost && !isThisHost && (
                      <button
                        type="button"
                        className="btn btn--primary btn--small"
                        onClick={() => handleApprovePlayer(p.id)}
                        title="Chọn người chơi này làm đối thủ Đội Xanh"
                      >
                        <UserCheck className="w-3.5 h-3.5" />
                        <span>Duyệt làm Đội Xanh</span>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {isHost && candidateOpponents.length === 0 && (
              <div className="waiting-empty-note">
                Chưa có ai vào phòng. Hãy gửi link hoặc mã phòng <strong>{roomId}</strong> cho bạn bè để cùng chơi!
              </div>
            )}
          </div>
        </div>
      )}

      {/* 2. BỐ CỤC CHÍNH: BÀN CỜ BÊN TRÁI, THAO TÁC / THÔNG TIN BÊN PHẢI */}
      <div className="game-stage-layout">
        {/* CỘT TRÁI: Bàn cờ 9x9 */}
        <div className="stage-board-column">
          <Board
            gameState={gameState}
            role={role}
            onMakeMove={handleMakeMove}
            onPlacePieceInSetup={handlePlacePieceInSetup}
            onRemovePieceInSetup={handleRemovePieceFromBoardInSetup}
            selectedSetupType={selectedSetupType}
          />
        </div>

        {/* CỘT PHẢI: Bảng xếp quân (khi Setup) / Hướng dẫn chờ (khi Waiting) / Thẻ đấu thủ (khi Playing) */}
        <div className="stage-controls-column">
          {isSetupPhase ? (
            <SetupPanel
              gameState={gameState}
              role={role}
              selectedSetupType={selectedSetupType}
              onSelectSetupType={setSelectedSetupType}
              onQuickAutoPlace={handleQuickAutoPlace}
              onConfirmSetup={handleConfirmSetup}
            />
          ) : isWaitingPhase ? (
            <div className="waiting-rules-side card">
              <div className="card-header">
                <Swords className="w-5 h-5 text-emerald-600" />
                <h3 className="card-title">Quy trình bắt đầu</h3>
              </div>
              <div className="text-xs text-neutral-600 space-y-2.5">
                <div className="p-2.5 bg-emerald-50 rounded border border-emerald-100">
                  <strong>1. Duyệt đấu thủ:</strong> Chủ phòng chọn 1 người làm <strong>Đội Xanh</strong>.
                </div>
                <div className="p-2.5 bg-slate-50 rounded border border-slate-200">
                  <strong>2. Chế độ Người xem:</strong> Những ai không được duyệt hoặc vào sau khi trận bắt đầu sẽ tự động chuyển thành <strong>Người xem (Spectator)</strong>.
                </div>
                <div className="p-2.5 bg-slate-50 rounded border border-slate-200">
                  <strong>3. Xếp quân (30s):</strong> Đội Đỏ xếp trước (28 ô quanh a1). Đội Xanh xếp sau và nhìn thấy thế trận Đỏ để khắc chế (28 ô quanh i9).
                </div>
              </div>
            </div>
          ) : (
            /* Khi đang thi đấu: hiển thị thông tin 2 đấu thủ và biên bản nước đi */
            <div className="in-game-sidebar">
              <div className="players-stack">
                <PlayerCard
                  player={PLAYERS.BLUE}
                  seat={seats[PLAYERS.BLUE]}
                  pieces={pieces}
                  isTurn={isPlayingPhase && turn === PLAYERS.BLUE}
                  isMyCard={role === 'blue'}
                />

                <PlayerCard
                  player={PLAYERS.RED}
                  seat={seats[PLAYERS.RED]}
                  pieces={pieces}
                  isTurn={isPlayingPhase && turn === PLAYERS.RED}
                  isMyCard={role === 'red'}
                />
              </div>

              <MoveHistory
                history={history}
                lastMove={lastMove}
              />
            </div>
          )}
        </div>
      </div>

      {/* Modal kết thúc ván đấu */}
      <GameOverModal
        winner={winner}
        reason={winReason}
        role={role}
        onRestart={handleRestartGame}
        onBackToLobby={onLeaveRoom}
      />
    </div>
  );
}

export default function App() {
  const [currentRoomId, setCurrentRoomId] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('room') || null;
  });

  const [playerName, setPlayerName] = useState(() => {
    return localStorage.getItem('ottv2_player_name') || 'Người chơi';
  });

  const [activeRole, setActiveRole] = useState('spectator');
  const [isRulesOpen, setIsRulesOpen] = useState(false);

  // Đồng bộ URL khi vào/rời phòng
  useEffect(() => {
    const url = new URL(window.location.href);
    if (currentRoomId) {
      url.searchParams.set('room', currentRoomId);
    } else {
      url.searchParams.delete('room');
    }
    window.history.replaceState({}, '', url.toString());
  }, [currentRoomId]);

  function handleJoinRoom(roomId, name) {
    if (name) setPlayerName(name);
    setCurrentRoomId(roomId);
  }

  function handleLeaveRoom() {
    setCurrentRoomId(null);
    setActiveRole('spectator');
  }

  return (
    <div className="app-container">
      {/* Element ẩn cho playhtml data binding */}
      <div id="ottv2-shared-sync" can-play style={{ display: 'none' }} />

      <Header
        roomId={currentRoomId}
        role={currentRoomId ? activeRole : null}
        onOpenRules={() => setIsRulesOpen(true)}
        onLeaveRoom={handleLeaveRoom}
      />

      <main className="main-content">
        {!currentRoomId ? (
          <Lobby
            onJoinRoom={handleJoinRoom}
            onOpenRules={() => setIsRulesOpen(true)}
          />
        ) : (
          /* Sử dụng key={currentRoomId} để buộc React unmount và tái tạo RoomView mới toanh */
          <RoomView
            key={currentRoomId}
            roomId={currentRoomId}
            playerName={playerName}
            onLeaveRoom={handleLeaveRoom}
            onRoleChange={setActiveRole}
          />
        )}
      </main>

      <RulesModal
        isOpen={isRulesOpen}
        onClose={() => setIsRulesOpen(false)}
      />
    </div>
  );
}
