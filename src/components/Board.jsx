import React, { useState } from 'react';
import Square from './Square.jsx';
import Piece from './Piece.jsx';
import {
  BOARD_SIZE,
  FILES,
  RANKS,
  coordsToSquare,
  getSquareZone,
  PLAYERS,
} from '../game/constants.js';
import { getValidMoves } from '../game/rules.js';
import { GAME_PHASES } from '../game/gameState.js';

export default function Board({
  gameState,
  role, // 'red' | 'blue' | 'spectator'
  onMakeMove,
  onPlacePieceInSetup,
  onRemovePieceInSetup,
  selectedSetupType,
}) {
  const [selectedPieceId, setSelectedPieceId] = useState(null);

  const {
    phase,
    pieces = {},
    turn,
    lastMove,
  } = gameState || {};

  const isPlaying = phase === GAME_PHASES.PLAYING;
  const isMyTurn = isPlaying && turn === role;
  const isRedSetup = phase === GAME_PHASES.SETUP_RED && role === 'red';
  const isBlueSetup = phase === GAME_PHASES.SETUP_BLUE && role === 'blue';
  const isSetupMode = isRedSetup || isBlueSetup;

  // Tính các nước đi hợp lệ cho quân đang chọn
  const validMoves = isMyTurn && selectedPieceId ? getValidMoves(pieces, selectedPieceId) : [];
  const validMoveMap = new Map();
  validMoves.forEach((m) => validMoveMap.set(m.square, m));

  // Xử lý khi click vào 1 ô trên bàn cờ
  function handleSquareClick(square, zone) {
    // 1. Trong giai đoạn xếp quân
    if (isSetupMode) {
      const allowedZone = isRedSetup ? 'red-home' : 'blue-home';
      if (zone === allowedZone) {
        const existingOccupant = Object.values(pieces).find(
          (p) => p.alive && p.square === square && p.player === role
        );

        if (existingOccupant && !selectedSetupType) {
          // Nhấc quân ra khỏi bàn cờ nếu click vào quân của mình mà không chọn loại nào
          onRemovePieceInSetup?.(existingOccupant.id);
        } else if (selectedSetupType) {
          // Đặt loại quân đang chọn vào ô này
          onPlacePieceInSetup?.(selectedSetupType, square);
        }
      }
      return;
    }

    // 2. Trong giai đoạn thi đấu
    if (!isMyTurn) return;

    // Nếu click vào một ô đích hợp lệ -> đi quân
    if (validMoveMap.has(square)) {
      onMakeMove?.(selectedPieceId, square);
      setSelectedPieceId(null);
      return;
    }

    // Nếu click vào quân của mình -> chọn quân đó
    const clickedPiece = Object.values(pieces).find(
      (p) => p.alive && p.square === square && p.player === role
    );
    if (clickedPiece) {
      setSelectedPieceId(clickedPiece.id === selectedPieceId ? null : clickedPiece.id);
    } else {
      setSelectedPieceId(null);
    }
  }

  // Tạo ma trận các ô cờ 9x9 (Hàng từ 9 xuống 1, cột từ a đến i theo góc nhìn tiêu chuẩn)
  const rows = [];
  for (let r = 9; r >= 1; r--) {
    const cols = [];
    for (let c = 1; c <= 9; c++) {
      const square = coordsToSquare(c, r);
      const zone = getSquareZone(square);
      const piece = Object.values(pieces).find((p) => p.alive && p.square === square);

      const isSelected = selectedPieceId && piece?.id === selectedPieceId;
      const isSelectable = isMyTurn && piece?.player === role;
      const validTarget = validMoveMap.get(square);

      const isLastMoveFrom = lastMove?.from === square;
      const isLastMoveTo = lastMove?.to === square;

      // Nhãn góc bàn cờ (tọa độ cờ vua)
      const fileLabel = r === 1 ? FILES[c - 1] : null;
      const rankLabel = c === 1 ? r : null;

      cols.push(
        <Square
          key={square}
          square={square}
          zone={zone}
          piece={piece}
          isSelected={isSelected}
          isValidTarget={!!validTarget}
          targetType={validTarget?.type}
          isLastMoveFrom={isLastMoveFrom}
          isLastMoveTo={isLastMoveTo}
          fileLabel={fileLabel}
          rankLabel={rankLabel}
          onClick={() => handleSquareClick(square, zone)}
        >
          {piece && (
            <Piece
              piece={piece}
              isSelected={isSelected}
              isSelectable={isSelectable}
              onClick={(e) => {
                e.stopPropagation();
                handleSquareClick(square, zone);
              }}
            />
          )}
        </Square>
      );
    }
    rows.push(cols);
  }

  return (
    <div className="board-wrapper">
      <div className="board-grid">
        {rows.flat()}
      </div>

      {/* Chú thích các khu vực trên bàn cờ */}
      <div className="board-legend">
        <div className="board-legend__item">
          <span className="legend-box legend-box--red" />
          <span>Sân nhà Đỏ (28 ô, quanh a1)</span>
        </div>
        <div className="board-legend__item">
          <span className="legend-box legend-box--border" />
          <span>Ranh giới 3 đường chéo (25 ô)</span>
        </div>
        <div className="board-legend__item">
          <span className="legend-box legend-box--blue" />
          <span>Sân nhà Xanh (28 ô, quanh i9)</span>
        </div>
      </div>
    </div>
  );
}
