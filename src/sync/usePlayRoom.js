import { useEffect, useState, useRef, useCallback } from 'react';
import { playhtml } from 'playhtml';
import {
  createNewGame,
  GAME_PHASES,
  startSetupRed,
  completeSetupRed,
  completeSetupBlue,
  executeMove,
  autoPlaceRemaining,
} from '../game/gameState.js';
import { PLAYERS } from '../game/constants.js';

function getOrCreateClientId() {
  let id = sessionStorage.getItem('ottv2_client_id');
  if (!id) {
    id = 'user_' + Math.random().toString(36).substring(2, 9);
    sessionStorage.setItem('ottv2_client_id', id);
  }
  return id;
}

function getStoredPlayerName() {
  return localStorage.getItem('ottv2_player_name') || 'Người chơi';
}

export function usePlayRoom(roomId, playerName = '') {
  const clientId = useRef(getOrCreateClientId()).current;
  const effectivePlayerName = playerName || getStoredPlayerName();

  const [gameState, setGameState] = useState(() => {
    try {
      const saved = localStorage.getItem(`ottv2_room_${roomId}`);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.roomId === roomId) return parsed;
      }
    } catch {
      // Bỏ qua lỗi parse
    }
    return createNewGame(roomId);
  });

  // Khi roomId thay đổi -> reset ngay sang phòng mới
  useEffect(() => {
    if (!roomId) return;
    let initialForRoom = createNewGame(roomId);
    try {
      const saved = localStorage.getItem(`ottv2_room_${roomId}`);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.roomId === roomId) {
          initialForRoom = parsed;
        }
      }
    } catch {
      // ignore
    }
    setGameState(initialForRoom);
    stateRef.current = initialForRoom;
    setRole('spectator');
  }, [roomId]);

  const [role, setRole] = useState('spectator'); // 'red' | 'blue' | 'spectator'
  const [isConnected, setIsConnected] = useState(false);
  const [connectedUsersCount, setConnectedUsersCount] = useState(1);

  const broadcastChannelRef = useRef(null);
  const stateRef = useRef(gameState);
  stateRef.current = gameState;

  // Cập nhật và phát tán state mới tới tất cả các client trong phòng
  const syncState = useCallback((newState) => {
    stateRef.current = newState;
    setGameState(newState);

    try {
      localStorage.setItem(`ottv2_room_${roomId}`, JSON.stringify(newState));
    } catch {
      // Bỏ qua lỗi storage
    }

    // 1. Đồng bộ qua BroadcastChannel (rất nhanh cho các tab trên cùng máy)
    if (broadcastChannelRef.current) {
      broadcastChannelRef.current.postMessage({
        type: 'STATE_UPDATE',
        state: newState,
        senderId: clientId,
      });
    }

    // 2. Đồng bộ qua playhtml data element
    try {
      const syncEl = document.getElementById('ottv2-shared-sync');
      if (syncEl) {
        const handle = playhtml.getHandle?.('ottv2-shared-sync');
        if (handle) {
          handle.setData({
            state: newState,
            senderId: clientId,
            timestamp: Date.now(),
          });
        }
      }
    } catch {
      // Fallback nếu playhtml đang kết nối
    }
  }, [clientId, roomId]);

  // Khởi tạo BroadcastChannel và playhtml
  useEffect(() => {
    if (!roomId) return;

    // 1. BroadcastChannel
    const bc = new BroadcastChannel(`ottv2_bc_${roomId}`);
    broadcastChannelRef.current = bc;

    bc.onmessage = (event) => {
      const { type, state, senderId, requestState } = event.data || {};
      if (type === 'STATE_UPDATE' && state && senderId !== clientId) {
        if (state.updatedAt > (stateRef.current?.updatedAt || 0)) {
          setGameState(state);
          stateRef.current = state;
        }
      } else if (type === 'REQUEST_STATE' && senderId !== clientId) {
        // Gửi state hiện tại cho client mới vào
        if (stateRef.current) {
          bc.postMessage({
            type: 'STATE_UPDATE',
            state: stateRef.current,
            senderId: clientId,
          });
        }
      }
    };

    // Báo cho các client khác gửi state
    bc.postMessage({ type: 'REQUEST_STATE', senderId: clientId });

    // 2. Tích hợp playhtml
    let isSubscribed = true;
    try {
      playhtml.init({
        room: `ottv2_room_${roomId}`,
      }).then(() => {
        if (!isSubscribed) return;
        setIsConnected(true);

        // Đăng ký custom element đồng bộ
        try {
          playhtml.register('ottv2-shared-sync', {
            defaultData: { state: stateRef.current, senderId: clientId, timestamp: Date.now() },
            updateElement: ({ data }) => {
              if (data && data.state && data.senderId !== clientId) {
                if (data.state.updatedAt > (stateRef.current?.updatedAt || 0)) {
                  setGameState(data.state);
                  stateRef.current = data.state;
                }
              }
            },
          });
        } catch {
          // Bỏ qua nếu đã đăng ký
        }
      }).catch(() => {
        // Nếu không kết nối được PartyKit server, vẫn hoạt động bình thường qua BroadcastChannel
        setIsConnected(true);
      });
    } catch {
      setIsConnected(true);
    }

    return () => {
      isSubscribed = false;
      bc.close();
    };
  }, [roomId, clientId]);

  // Quản lý việc ngồi vào ghế (Seats)
  useEffect(() => {
    if (!gameState) return;

    const currentRed = gameState.seats[PLAYERS.RED];
    const currentBlue = gameState.seats[PLAYERS.BLUE];

    // Xác định role của client hiện tại
    if (currentRed?.id === clientId) {
      setRole('red');
    } else if (currentBlue?.id === clientId) {
      setRole('blue');
    } else {
      setRole('spectator');
    }

    // Tự động nhận ghế nếu còn trống
    if (!currentRed) {
      // Chiếm ghế Đỏ
      const nextSeats = {
        ...gameState.seats,
        [PLAYERS.RED]: { id: clientId, name: effectivePlayerName },
      };
      syncState({
        ...gameState,
        seats: nextSeats,
        updatedAt: Date.now(),
      });
    } else if (currentRed.id !== clientId && !currentBlue) {
      // Chiếm ghế Xanh
      const nextSeats = {
        ...gameState.seats,
        [PLAYERS.BLUE]: { id: clientId, name: effectivePlayerName },
      };
      // Khi đã có đủ 2 người chơi, tự động bắt đầu SETUP_RED
      const nextState = {
        ...gameState,
        seats: nextSeats,
        phase: gameState.phase === GAME_PHASES.WAITING ? GAME_PHASES.SETUP_RED : gameState.phase,
        setupDeadline: gameState.phase === GAME_PHASES.WAITING ? Date.now() + 30000 : gameState.setupDeadline,
        updatedAt: Date.now(),
      };
      syncState(nextState);
    }
  }, [gameState, clientId, effectivePlayerName, syncState]);

  // Đếm ngược 30s cho giai đoạn Xếp quân
  useEffect(() => {
    if (!gameState || !gameState.setupDeadline) return;
    if (gameState.phase !== GAME_PHASES.SETUP_RED && gameState.phase !== GAME_PHASES.SETUP_BLUE) return;

    const interval = setInterval(() => {
      const now = Date.now();
      if (now >= gameState.setupDeadline) {
        clearInterval(interval);
        // Hết 30s -> tự động hoàn thành xếp quân
        if (gameState.phase === GAME_PHASES.SETUP_RED) {
          const redPieces = Object.values(gameState.pieces).filter((p) => p.player === PLAYERS.RED);
          const unplacedRed = gameState.unplacedPieces[PLAYERS.RED] || [];
          const allRed = [...redPieces, ...unplacedRed];
          const nextState = completeSetupRed(gameState, allRed);
          syncState(nextState);
        } else if (gameState.phase === GAME_PHASES.SETUP_BLUE) {
          const bluePieces = Object.values(gameState.pieces).filter((p) => p.player === PLAYERS.BLUE);
          const unplacedBlue = gameState.unplacedPieces[PLAYERS.BLUE] || [];
          const allBlue = [...bluePieces, ...unplacedBlue];
          const nextState = completeSetupBlue(gameState, allBlue);
          syncState(nextState);
        }
      }
    }, 500);

    return () => clearInterval(interval);
  }, [gameState, syncState]);

  // Hành động: Người chơi đặt/thay đổi vị trí quân trong lúc Setup theo loại quân (type) hoặc id
  const handlePlacePieceInSetup = useCallback((pieceIdOrType, targetSquare) => {
    const currentState = stateRef.current;
    if (!currentState) return;

    const isRedTurn = currentState.phase === GAME_PHASES.SETUP_RED && role === 'red';
    const isBlueTurn = currentState.phase === GAME_PHASES.SETUP_BLUE && role === 'blue';

    if (!isRedTurn && !isBlueTurn) return;

    const player = isRedTurn ? PLAYERS.RED : PLAYERS.BLUE;

    // Tìm quân: có thể là ID cụ thể hoặc Type ('rock' | 'paper' | 'scissors')
    const unplaced = currentState.unplacedPieces[player] || [];
    let pieceToPlace = null;

    if (['rock', 'paper', 'scissors'].includes(pieceIdOrType)) {
      // Chọn quân chưa đặt đầu tiên có type tương ứng
      pieceToPlace = unplaced.find((p) => p.type === pieceIdOrType && !p.square);
      if (!pieceToPlace) return; // Đã hết quân loại này
    } else {
      pieceToPlace = currentState.pieces[pieceIdOrType] || unplaced.find((p) => p.id === pieceIdOrType);
    }

    if (!pieceToPlace || pieceToPlace.player !== player) return;

    // Kiểm tra xem ô targetSquare có quân nào của mình chưa
    const existingOccupant = Object.values(currentState.pieces).find(
      (p) => p.alive && p.square === targetSquare && p.id !== pieceToPlace.id
    );

    const newPieces = { ...currentState.pieces };
    let newUnplaced = unplaced.filter((p) => p.id !== pieceToPlace.id);

    if (existingOccupant) {
      if (pieceToPlace.square) {
        // Đổi chỗ 2 quân trên bàn cờ
        existingOccupant.square = pieceToPlace.square;
        newPieces[existingOccupant.id] = existingOccupant;
      } else {
        // Thu hồi quân cũ về khay unplaced
        existingOccupant.square = null;
        newUnplaced.push(existingOccupant);
        delete newPieces[existingOccupant.id];
      }
    }

    newPieces[pieceToPlace.id] = {
      ...pieceToPlace,
      square: targetSquare,
    };

    syncState({
      ...currentState,
      pieces: newPieces,
      unplacedPieces: {
        ...currentState.unplacedPieces,
        [player]: newUnplaced,
      },
      updatedAt: Date.now(),
    });
  }, [role, syncState]);

  // Hành động: Nhấc một quân trên bàn cờ về khay trong lúc Setup
  const handleRemovePieceFromBoardInSetup = useCallback((pieceId) => {
    const currentState = stateRef.current;
    if (!currentState) return;

    const isRedTurn = currentState.phase === GAME_PHASES.SETUP_RED && role === 'red';
    const isBlueTurn = currentState.phase === GAME_PHASES.SETUP_BLUE && role === 'blue';
    if (!isRedTurn && !isBlueTurn) return;

    const player = isRedTurn ? PLAYERS.RED : PLAYERS.BLUE;
    const piece = currentState.pieces[pieceId];
    if (!piece || piece.player !== player) return;

    const newPieces = { ...currentState.pieces };
    delete newPieces[pieceId];

    const newUnplaced = [...(currentState.unplacedPieces[player] || []), { ...piece, square: null }];

    syncState({
      ...currentState,
      pieces: newPieces,
      unplacedPieces: {
        ...currentState.unplacedPieces,
        [player]: newUnplaced,
      },
      updatedAt: Date.now(),
    });
  }, [role, syncState]);

  // Hành động: Xếp ngẫu nhiên nhanh trong lúc Setup
  const handleQuickAutoPlace = useCallback(() => {
    const currentState = stateRef.current;
    if (!currentState) return;

    const isRedTurn = currentState.phase === GAME_PHASES.SETUP_RED && role === 'red';
    const isBlueTurn = currentState.phase === GAME_PHASES.SETUP_BLUE && role === 'blue';

    if (!isRedTurn && !isBlueTurn) return;

    const player = isRedTurn ? PLAYERS.RED : PLAYERS.BLUE;
    const currentPlaced = Object.values(currentState.pieces).filter((p) => p.player === player);
    const unplaced = currentState.unplacedPieces[player] || [];
    const allPieces = [...currentPlaced, ...unplaced];

    // Reset ô và xếp lại ngẫu nhiên 9 ô
    const cleared = allPieces.map((p) => ({ ...p, square: null }));
    const placed = autoPlaceRemaining(cleared, player);

    const newPieces = { ...currentState.pieces };
    placed.forEach((p) => {
      newPieces[p.id] = p;
    });

    syncState({
      ...currentState,
      pieces: newPieces,
      unplacedPieces: {
        ...currentState.unplacedPieces,
        [player]: [],
      },
      updatedAt: Date.now(),
    });
  }, [role, syncState]);

  // Hành động: Xác nhận xếp quân xong
  const handleConfirmSetup = useCallback(() => {
    const currentState = stateRef.current;
    if (!currentState) return;

    if (currentState.phase === GAME_PHASES.SETUP_RED && role === 'red') {
      const redPieces = Object.values(currentState.pieces).filter((p) => p.player === PLAYERS.RED);
      const unplacedRed = currentState.unplacedPieces[PLAYERS.RED] || [];
      const allRed = [...redPieces, ...unplacedRed];
      const nextState = completeSetupRed(currentState, allRed);
      syncState(nextState);
    } else if (currentState.phase === GAME_PHASES.SETUP_BLUE && role === 'blue') {
      const bluePieces = Object.values(currentState.pieces).filter((p) => p.player === PLAYERS.BLUE);
      const unplacedBlue = currentState.unplacedPieces[PLAYERS.BLUE] || [];
      const allBlue = [...bluePieces, ...unplacedBlue];
      const nextState = completeSetupBlue(currentState, allBlue);
      syncState(nextState);
    }
  }, [role, syncState]);

  // Hành động: Đi một nước trong trận đấu
  const handleMakeMove = useCallback((pieceId, targetSquare) => {
    const currentState = stateRef.current;
    if (!currentState || currentState.phase !== GAME_PHASES.PLAYING) return;
    if (currentState.turn !== role) return;

    try {
      const nextState = executeMove(currentState, role, pieceId, targetSquare);
      syncState(nextState);
    } catch (err) {
      console.warn('Lỗi nước đi:', err.message);
    }
  }, [role, syncState]);

  // Hành động: Chơi lại ván mới
  const handleRestartGame = useCallback(() => {
    const freshState = createNewGame(roomId);
    freshState.seats = stateRef.current.seats; // Giữ nguyên 2 người chơi
    freshState.phase = GAME_PHASES.SETUP_RED;
    freshState.setupDeadline = Date.now() + 30000;
    syncState(freshState);
  }, [roomId, syncState]);

  return {
    gameState,
    role,
    clientId,
    isConnected,
    connectedUsersCount,
    handlePlacePieceInSetup,
    handleRemovePieceFromBoardInSetup,
    handleQuickAutoPlace,
    handleConfirmSetup,
    handleMakeMove,
    handleRestartGame,
  };
}
