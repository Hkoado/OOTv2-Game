import React from 'react';
import { PIECE_ICONS } from '../game/constants.js';

/**
 * Icon quân cờ Oẳn Tù Tì gốc (✊, ✋, ✌️)
 * Không viền, không hiệu ứng
 */
export function PieceSvg({ type, className = "" }) {
  const icon = PIECE_ICONS[type] || '';
  return (
    <span className={`piece-symbol ${className}`} role="img" aria-label={type}>
      {icon}
    </span>
  );
}

