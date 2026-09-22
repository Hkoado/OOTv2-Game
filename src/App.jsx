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

// Component con cho phòng chơi, sử dụng key={roomId} để reset sạch sẽ mỗi khi đổi phòng
function RoomView({ roomId, playerName, onLeaveRoom }) {
  const {
    gameState,
    role,
    clientId,
    isConnected,
    handlePlacePieceInSetup,
    handleRemovePieceFromBoardInSetup,
    handleQuickAutoPlace,
    handleConfirmSetup,
    handleMakeMove,
    handleRestartGame,
  } = usePlayRoom(roomId, playerName);

  const [selectedSetupType, setSelectedSetupType] = useState(PIECE_TYPES.ROCK);

  const {
    phase = GAME_PHASES.WAITING,
    seats = {},
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

  return (
    <div className="room-game-layout">
      {/* Banner khi đang chờ người thứ 2 */}
      {isWaitingPhase && (
        <div className="waiting-banner card">
          <div className="flex items-center gap-3">
            <div className="spinner" />
            <div>
              <h3 className="font-semibold text-neutral-800 text-sm">
                Đang chờ đối thủ tham gia phòng {roomId}...
              </h3>
              <p className="text-xs text-neutral-500">
                Hãy sao chép link phòng và gửi cho bạn bè để cùng thi đấu!
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
            Sao chép link mời
          </button>
        </div>
      )}

      {/* Bố cục chính: BÀN CỜ BÊN TRÁI, BẢNG CHỌN QUÂN & THÔNG TIN BÊN PHẢI */}
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

        {/* CỘT PHẢI: Danh sách quân khi xếp / Thẻ người chơi & Lịch sử khi thi đấu */}
        <div className="stage-controls-column">
          {/* Khi đang trong giai đoạn Xếp quân: hiển thị SetupPanel bên phải */}
          {isSetupPhase ? (
            <SetupPanel
              gameState={gameState}
              role={role}
              selectedSetupType={selectedSetupType}
              onSelectSetupType={setSelectedSetupType}
              onQuickAutoPlace={handleQuickAutoPlace}
              onConfirmSetup={handleConfirmSetup}
            />
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
  }

  return (
    <div className="app-container">
      {/* Element ẩn cho playhtml data binding */}
      <div id="ottv2-shared-sync" can-play style={{ display: 'none' }} />

      <Header
        roomId={currentRoomId}
        role={null}
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
