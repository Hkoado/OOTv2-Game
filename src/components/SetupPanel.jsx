import React, { useState, useEffect } from 'react';
import { PLAYERS, PIECE_TYPES, PIECE_LABELS } from '../game/constants.js';
import { GAME_PHASES } from '../game/gameState.js';
import { PieceSvg } from './PieceIcons.jsx';
import { Dices, Check, Clock } from 'lucide-react';

export default function SetupPanel({
  gameState,
  role,
  selectedSetupType,
  onSelectSetupType,
  onQuickAutoPlace,
  onConfirmSetup,
}) {
  const { phase, setupDeadline, unplacedPieces = {} } = gameState || {};
  const [timeLeft, setTimeLeft] = useState(30);

  useEffect(() => {
    if (!setupDeadline) return;
    const timer = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((setupDeadline - Date.now()) / 1000));
      setTimeLeft(remaining);
    }, 200);
    return () => clearInterval(timer);
  }, [setupDeadline]);

  const isRedPhase = phase === GAME_PHASES.SETUP_RED;
  const isBluePhase = phase === GAME_PHASES.SETUP_BLUE;

  const isMyTurn = (isRedPhase && role === 'red') || (isBluePhase && role === 'blue');
  const activePlayer = isRedPhase ? PLAYERS.RED : PLAYERS.BLUE;
  const activePlayerName = isRedPhase ? 'Đội Đỏ' : 'Đội Xanh';
  const isRed = activePlayer === PLAYERS.RED;

  const unplacedList = unplacedPieces[activePlayer] || [];

  // Đếm số quân chưa xếp của từng loại
  const counts = {
    [PIECE_TYPES.ROCK]: unplacedList.filter((p) => p.type === PIECE_TYPES.ROCK).length,
    [PIECE_TYPES.PAPER]: unplacedList.filter((p) => p.type === PIECE_TYPES.PAPER).length,
    [PIECE_TYPES.SCISSORS]: unplacedList.filter((p) => p.type === PIECE_TYPES.SCISSORS).length,
  };

  const totalRemaining = unplacedList.length;

  // Tự động chọn loại quân còn số lượng > 0 nếu loại hiện tại đã hết
  useEffect(() => {
    if (isMyTurn && (!selectedSetupType || counts[selectedSetupType] === 0)) {
      if (counts[PIECE_TYPES.ROCK] > 0) onSelectSetupType(PIECE_TYPES.ROCK);
      else if (counts[PIECE_TYPES.PAPER] > 0) onSelectSetupType(PIECE_TYPES.PAPER);
      else if (counts[PIECE_TYPES.SCISSORS] > 0) onSelectSetupType(PIECE_TYPES.SCISSORS);
    }
  }, [isMyTurn, counts, selectedSetupType, onSelectSetupType]);

  const pieceTypes = [
    { type: PIECE_TYPES.ROCK, label: 'Đấm' },
    { type: PIECE_TYPES.PAPER, label: 'Lá' },
    { type: PIECE_TYPES.SCISSORS, label: 'Kéo' },
  ];

  return (
    <div className="setup-panel-side card">
      {/* Tiêu đề & Đồng hồ đếm ngược */}
      <div className="setup-panel-side__top">
        <div className="badge badge--green">Xếp quân: 30s</div>
        <div className={`countdown-timer ${timeLeft <= 5 ? 'countdown-timer--urgent' : ''}`}>
          <Clock className="w-4 h-4" />
          <span>{timeLeft}s</span>
        </div>
      </div>

      <h3 className="setup-panel-side__heading">
        {isMyTurn ? 'Chọn quân để đặt lên bàn cờ' : `${activePlayerName} đang xếp...`}
      </h3>

      <p className="setup-panel-side__desc">
        {isBluePhase
          ? 'Đội Xanh đi sau: Nhìn thấy quân Đỏ trên bàn cờ để khắc chế!'
          : 'Đội Đỏ xếp trước: Đặt vào 28 ô sân nhà quanh ô a1.'}
      </p>

      {isMyTurn ? (
        <div className="setup-panel-side__body">
          {/* Danh sách 3 khung tròn chọn quân */}
          <div className="compact-piece-selector">
            {pieceTypes.map(({ type, label }) => {
              const count = counts[type];
              const isSelected = selectedSetupType === type && count > 0;
              const isDepleted = count === 0;

              return (
                <div
                  key={type}
                  onClick={() => count > 0 && onSelectSetupType(type)}
                  className={`selector-item ${isSelected ? 'selector-item--selected' : ''} ${
                    isDepleted ? 'selector-item--depleted' : ''
                  }`}
                  title={`${label}: còn ${count} quân`}
                >
                  <div
                    className={`selector-circle ${
                      isRed ? 'selector-circle--red' : 'selector-circle--blue'
                    }`}
                  >
                    <PieceSvg type={type} className="selector-svg" />
                  </div>

                  <div className="selector-info">
                    <span className="selector-count">* {count}</span>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="setup-panel-guide">
            <span className="text-xs text-neutral-600 block mb-1">
              👉 <strong>Cách 1:</strong> Chọn loại quân ở trên, bấm ô trống sân nhà để đặt.
            </span>
            <span className="text-xs text-neutral-600 block">
              👉 <strong>Cách 2:</strong> Bấm vào quân đã xếp trên bàn cờ để đổi chỗ hoặc nhấc về khay.
            </span>
          </div>

          {/* Các nút hành động */}
          <div className="setup-panel-side__actions">
            <button
              type="button"
              className="btn btn--secondary w-full"
              onClick={onQuickAutoPlace}
            >
              <Dices className="w-4 h-4" />
              <span>Xếp ngẫu nhiên nhanh</span>
            </button>

            <button
              type="button"
              className="btn btn--primary w-full"
              onClick={onConfirmSetup}
            >
              <Check className="w-4 h-4" />
              <span>
                {totalRemaining === 0
                  ? 'Xác nhận sẵn sàng'
                  : `Xong (tự điền ${totalRemaining} quân)`}
              </span>
            </button>
          </div>
        </div>
      ) : (
        <div className="setup-panel-side__waiting">
          <div className="spinner" />
          <div className="text-sm text-neutral-600">
            {role === 'blue' && isRedPhase ? (
              <p>
                Bạn là <strong>Đội Xanh</strong>. Đội Đỏ đang xếp quân trước (còn <strong>{timeLeft}s</strong>).
                <br />
                <span className="text-xs text-neutral-500 mt-1 block">
                  💡 Bạn sẽ được xếp quân ngay sau đó và được nhìn thấy toàn bộ quân Đỏ để khắc chế!
                </span>
              </p>
            ) : role === 'red' && isBluePhase ? (
              <p>
                Đội Đỏ đã xếp xong! Chờ <strong>Đội Xanh</strong> hoàn tất dàn quân (còn <strong>{timeLeft}s</strong>).
              </p>
            ) : (
              <p>
                Chế độ xem: Chờ <strong>{activePlayerName}</strong> hoàn tất dàn quân (còn <strong>{timeLeft}s</strong>).
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
