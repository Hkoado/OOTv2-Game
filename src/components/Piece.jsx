import React from 'react';
import { PLAYERS, PIECE_LABELS } from '../game/constants.js';
import { PieceSvg } from './PieceIcons.jsx';

export default function Piece({
  piece,
  isSelected = false,
  isSelectable = false,
  onClick,
  size = 'medium', // 'small' | 'medium' | 'large'
}) {
  if (!piece) return null;

  const isRed = piece.player === PLAYERS.RED;
  const label = PIECE_LABELS[piece.type];

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!isSelectable && !onClick}
      className={`piece piece--${isRed ? 'red-solid' : 'blue-solid'} piece--${size} ${
        isSelected ? 'piece--selected' : ''
      } ${isSelectable ? 'piece--selectable' : ''}`}
      title={`${isRed ? 'Đội Đỏ' : 'Đội Xanh'} - ${label}`}
    >
      <PieceSvg type={piece.type} className="piece__svg" />
    </button>
  );
}
