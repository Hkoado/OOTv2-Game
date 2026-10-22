import React, { useState } from 'react';
import GameBoard from '../ui/GameBoard.jsx';

import {
  getSquareZone,
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
  const [selectedSetupPieceId, setSelectedSetupPieceId] = useState(null);

  const {
    phase,
    pieces = {},
    turn,
    lastMove,
    map = null,
  } = gameState || {};

  const isPlaying = phase === GAME_PHASES.PLAYING;
  const isMyTurn = isPlaying && turn === role;
  const isRedSetup = phase === GAME_PHASES.SETUP_RED && role === 'red';
  const isBlueSetup = phase === GAME_PHASES.SETUP_BLUE && role === 'blue';
  const isSetupMode = isRedSetup || isBlueSetup;
  const allowedSetupZone = isRedSetup ? 'red-home' : isBlueSetup ? 'blue-home' : null;

  // Tính các nước đi hợp lệ cho quân đang chọn trong giai đoạn thi đấu
  const validMoves = isMyTurn && selectedPieceId ? getValidMoves(pieces, selectedPieceId, map) : [];
  const validMoveMap = new Map();
  validMoves.forEach((m) => validMoveMap.set(m.square, m));

  // Xử lý khi click vào 1 ô trên bàn cờ
  function handleSquareClick(square, zone) {
    if (map?.blocked?.includes(square)) return;
    // 1. GIAI ĐOẠN XẾP QUÂN
    if (isSetupMode) {
      if (zone !== allowedSetupZone) return;

      const existingOccupant = Object.values(pieces).find(
        (p) => p.alive && p.square === square && p.player === role
      );

      // Nếu đang chọn một quân trên bàn cờ để di chuyển / đổi vị trí
      if (selectedSetupPieceId) {
        if (existingOccupant && existingOccupant.id === selectedSetupPieceId) {
          // Bấm lại chính quân đó -> Bỏ chọn
          setSelectedSetupPieceId(null);
          return;
        }

        // Di chuyển hoặc đổi chỗ quân đã chọn tới ô này
        onPlacePieceInSetup?.(selectedSetupPieceId, square);
        setSelectedSetupPieceId(null);
        return;
      }

      // Nếu click vào một quân đã đặt trên sân của mình -> Chọn quân đó để đổi chỗ / nhấc
      if (existingOccupant) {
        setSelectedSetupPieceId(existingOccupant.id);
        return;
      }

      // Nếu click vào một ô trống trong sân nhà -> Đặt loại quân đang chọn từ khay
      if (selectedSetupType) {
        onPlacePieceInSetup?.(selectedSetupType, square);
      }
      return;
    }

    // 2. GIAI ĐOẠN THI ĐẤU
    if (!isMyTurn) return;

    // Nếu click vào một ô đích hợp lệ -> Đi quân
    if (validMoveMap.has(square)) {
      onMakeMove?.(selectedPieceId, square);
      setSelectedPieceId(null);
      return;
    }

    // Nếu click vào quân của mình -> Chọn quân đó
    const clickedPiece = Object.values(pieces).find(
      (p) => p.alive && p.square === square && p.player === role
    );
    if (clickedPiece) {
      setSelectedPieceId(clickedPiece.id === selectedPieceId ? null : clickedPiece.id);
    } else {
      setSelectedPieceId(null);
    }
  }

  return (
    <div className="game-board-layout">
      <GameBoard pieces={pieces} map={map} lastMove={lastMove}
        selectedSquare={pieces[isSetupMode ? selectedSetupPieceId : selectedPieceId]?.square || null}
        validMoves={validMoves} orientation={role === 'blue' ? 'blue' : 'red'}
        readOnly={!isMyTurn && !isSetupMode}
        onSquareClick={(square) => handleSquareClick(square, getSquareZone(square))} />

      {/* Chú thích hướng dẫn thao tác trong lúc xếp quân */}
      {isSetupMode && selectedSetupPieceId && (
        <div className="setup-piece-action-bar">
          <span className="text-xs text-neutral-700">
            Đang chọn quân: bấm vào ô sân nhà khác để <strong>chuyển/đổi chỗ</strong>
          </span>
          <button
            type="button"
            className="btn btn--small btn--secondary text-xs"
            onClick={(e) => {
              e.stopPropagation();
              onRemovePieceInSetup?.(selectedSetupPieceId);
              setSelectedSetupPieceId(null);
            }}
          >
            Nhấc về khay
          </button>
        </div>
      )}

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
