import React from 'react';
import { Trophy, RotateCcw, Home, Award } from 'lucide-react';
import { PLAYERS } from '../game/constants.js';

export default function GameOverModal({
  winner, // 'red' | 'blue'
  reason,
  role,
  onRestart,
  onBackToLobby,
}) {
  if (!winner) return null;

  const isRedWinner = winner === PLAYERS.RED;
  const isWinnerMe = (isRedWinner && role === 'red') || (!isRedWinner && role === 'blue');
  const isSpectator = role === 'spectator';

  return (
    <div className="modal-overlay">
      <div className="modal-card">
        <div className="modal-card__badge">
          <Trophy className="w-12 h-12 text-yellow-500 mx-auto" />
        </div>

        <h2 className="modal-card__title">
          {isWinnerMe
            ? '🎉 CHIẾN THẮNG TUYỆT VỜI!'
            : isSpectator
            ? `🏆 ${isRedWinner ? 'ĐỘI ĐỎ' : 'ĐỘI XANH'} CHIẾN THẮNG!`
            : '💔 BẠN ĐÃ THẤT BẠI'}
        </h2>

        <div className="modal-card__winner-banner">
          <span className="winner-tag">
            {isRedWinner ? '🔴 Đội Đỏ Thắng' : '🔵 Đội Xanh Thắng'}
          </span>
        </div>

        <p className="modal-card__reason">
          <strong>Lý do chiến thắng:</strong> {reason}
        </p>

        <div className="modal-card__actions">
          {!isSpectator && (
            <button
              type="button"
              className="btn btn--primary"
              onClick={onRestart}
            >
              <RotateCcw className="w-4 h-4" />
              <span>Chơi lại ván mới</span>
            </button>
          )}

          <button
            type="button"
            className="btn btn--secondary"
            onClick={onBackToLobby}
          >
            <Home className="w-4 h-4" />
            <span>Rời về sảnh chính</span>
          </button>
        </div>
      </div>
    </div>
  );
}
