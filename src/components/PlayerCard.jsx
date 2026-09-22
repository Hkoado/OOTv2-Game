import React from 'react';
import { PLAYERS, PIECE_TYPES } from '../game/constants.js';
import { getRemainingPieceCounts } from '../game/rules.js';
import { PieceSvg } from './PieceIcons.jsx';

export default function PlayerCard({
  player, // 'red' | 'blue'
  seat,   // { id, name }
  pieces = {},
  isTurn,
  isMyCard,
}) {
  const isRed = player === PLAYERS.RED;
  const counts = getRemainingPieceCounts(pieces, player);

  return (
    <div
      className={`player-card player-card--${isRed ? 'red' : 'blue'} ${
        isTurn ? 'player-card--active' : ''
      }`}
    >
      <div className="player-card__top">
        <div className="player-card__avatar">
          {isRed ? '🔴' : '🔵'}
        </div>
        <div className="player-card__info">
          <div className="player-card__name-row">
            <span className="player-card__name">
              {seat ? seat.name : 'Đang chờ người chơi...'}
            </span>
            {isMyCard && <span className="player-card__you-badge">Bạn</span>}
          </div>
          <span className="player-card__role-label">
            {isRed ? 'Đội Đỏ (Nhà a1)' : 'Đội Xanh (Nhà i9)'}
          </span>
        </div>
      </div>

      {/* Thống kê quân còn lại từng loại */}
      <div className="piece-counts-grid">
        <div
          className={`piece-count-pill ${
            counts[PIECE_TYPES.ROCK] === 0 ? 'piece-count-pill--dead' : ''
          }`}
          title="Đấm còn lại"
        >
          <div className={`mini-pill-circle ${isRed ? 'mini-pill-circle--red' : 'mini-pill-circle--blue'}`}>
            <PieceSvg type="rock" className="w-3.5 h-3.5" />
          </div>
          <span className="pill-val">{counts[PIECE_TYPES.ROCK]}/3</span>
        </div>

        <div
          className={`piece-count-pill ${
            counts[PIECE_TYPES.PAPER] === 0 ? 'piece-count-pill--dead' : ''
          }`}
          title="Lá còn lại"
        >
          <div className={`mini-pill-circle ${isRed ? 'mini-pill-circle--red' : 'mini-pill-circle--blue'}`}>
            <PieceSvg type="paper" className="w-3.5 h-3.5" />
          </div>
          <span className="pill-val">{counts[PIECE_TYPES.PAPER]}/3</span>
        </div>

        <div
          className={`piece-count-pill ${
            counts[PIECE_TYPES.SCISSORS] === 0 ? 'piece-count-pill--dead' : ''
          }`}
          title="Kéo còn lại"
        >
          <div className={`mini-pill-circle ${isRed ? 'mini-pill-circle--red' : 'mini-pill-circle--blue'}`}>
            <PieceSvg type="scissors" className="w-3.5 h-3.5" />
          </div>
          <span className="pill-val">{counts[PIECE_TYPES.SCISSORS]}/3</span>
        </div>
      </div>

      {isTurn && (
        <div className="turn-indicator">
          <span className="turn-indicator__dot" />
          <span>Đang đến lượt đi</span>
        </div>
      )}
    </div>
  );
}
