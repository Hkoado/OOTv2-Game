import React from 'react';
import { BASES, PLAYERS, squareToCoords } from '../game/constants.js';

export default function Square({
  square,
  zone, // 'red-home' | 'blue-home' | 'border'
  piece,
  isSelected,
  isValidTarget,
  targetType, // 'move' | 'capture'
  isLastMoveFrom,
  isLastMoveTo,
  isSetupHome,
  onClick,
  showCoordinates,
  fileLabel,
  rankLabel,
  children,
}) {
  const isRedBase = square === BASES[PLAYERS.RED];
  const isBlueBase = square === BASES[PLAYERS.BLUE];

  let zoneClass = 'square--border';
  if (zone === 'red-home') zoneClass = 'square--red-home';
  else if (zone === 'blue-home') zoneClass = 'square--blue-home';

  return (
    <div
      onClick={onClick}
      className={`square ${zoneClass} ${isSetupHome ? 'square--setup-home' : ''} ${isSelected ? 'square--selected' : ''} ${
        isValidTarget ? `square--valid-target square--target-${targetType}` : ''
      } ${isLastMoveFrom ? 'square--last-from' : ''} ${
        isLastMoveTo ? 'square--last-to' : ''
      }`}
      data-square={square}
    >
      {/* Tọa độ cờ vua (Góc chữ cái & số) */}
      {fileLabel && <span className="square__file-label">{fileLabel}</span>}
      {rankLabel && <span className="square__rank-label">{rankLabel}</span>}

      {/* Đánh dấu Nhà chính a1 & i9 */}
      {isRedBase && (
        <span className="square__base-badge square__base-badge--red" title="Nhà chính Đội Đỏ (a1)">
          🏰 a1
        </span>
      )}
      {isBlueBase && (
        <span className="square__base-badge square__base-badge--blue" title="Nhà chính Đội Xanh (i9)">
          🏰 i9
        </span>
      )}

      {/* Dấu chấm gợi ý nước đi hợp lệ */}
      {isValidTarget && targetType === 'move' && (
        <div className="square__move-hint" />
      )}
      {isValidTarget && targetType === 'capture' && (
        <div className="square__capture-hint" />
      )}

      {/* Quân cờ hoặc nội dung bên trong */}
      {children}
    </div>
  );
}
