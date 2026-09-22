import { useEffect, useState, useRef, useCallback } from 'react';
import { playhtml } from 'playhtml';
import Peer from 'peerjs';
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

function sanitizeRoomId(id) {
  return (id || 'ROOM').replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
}

export function usePlayRoom(roomId, playerName = '') {
  const clientId = useRef(getOrCreateClientId()).current;
  const effectivePlayerName = playerName || getStoredPlayerName();
  const cleanId = sanitizeRoomId(roomId);
  const hostPeerId = `ottv2_host_${cleanId}`;

  const [gameState, setGameState] = useState(() => createNewGame(roomId));
  const [role, setRole] = useState('spectator'); // 'red' | 'blue' | 'spectator'
  const [isConnected, setIsConnected] = useState(false);

  const stateRef = useRef(gameState);
  stateRef.current = gameState;

  const peerRef = useRef(null);
  const connectionsRef = useRef([]); // Host lưu danh sách client
  const hostConnRef = useRef(null);  // Guest lưu kết nối tới Host
  const isHostRef = useRef(false);
  const broadcastChannelRef = useRef(null);

  // Phát tán trạng thái mới tới toàn bộ kết nối
  const broadcastState = useCallback((newState) => {
    stateRef.current = newState;
    setGameState(newState);

    try {
      localStorage.setItem(`ottv2_room_${roomId}`, JSON.stringify(newState));
    } catch {
      // ignore
    }

    // 1. BroadcastChannel (local tabs)
    if (broadcastChannelRef.current) {
      broadcastChannelRef.current.postMessage({
        type: 'STATE_UPDATE',
        state: newState,
        senderId: clientId,
      });
    }

    // 2. PeerJS WebRTC (kết nối giữa 2 máy tính qua Internet)
    if (isHostRef.current) {
      // Host gửi cho tất cả clients
      connectionsRef.current.forEach((conn) => {
        if (conn.open) {
          conn.send({ type: 'STATE_UPDATE', state: newState, senderId: clientId });
        }
      });
    } else if (hostConnRef.current && hostConnRef.current.open) {
      // Guest gửi lên Host để Host áp dụng & broadcast
      hostConnRef.current.send({ type: 'ACTION_STATE_UPDATE', state: newState, senderId: clientId });
    }

    // 3. playhtml event dispatch
    try {
      playhtml.dispatchPlayEvent?.({
        type: 'OTT_SYNC',
        eventPayload: { state: newState, senderId: clientId, timestamp: Date.now() },
      });
    } catch {
      // ignore
    }
  }, [clientId, roomId]);

  // Khởi tạo PeerJS WebRTC và playhtml
  useEffect(() => {
    if (!roomId) return;

    let isDestroyed = false;

    // Reset state ban đầu cho phòng mới
    const freshGame = createNewGame(roomId);
    setGameState(freshGame);
    stateRef.current = freshGame;

    // 1. BroadcastChannel
    const bc = new BroadcastChannel(`ottv2_bc_${cleanId}`);
    broadcastChannelRef.current = bc;
    bc.onmessage = (event) => {
      const { type, state, senderId } = event.data || {};
      if (type === 'STATE_UPDATE' && state && senderId !== clientId) {
        if (state.updatedAt > (stateRef.current?.updatedAt || 0)) {
          setGameState(state);
          stateRef.current = state;
        }
      }
    };

    // 2. playhtml init
    try {
      playhtml.init({
        room: `ottv2_${cleanId}`,
      }).then(() => {
        if (isDestroyed) return;
        setIsConnected(true);
        try {
          playhtml.registerPlayEventListener('OTT_SYNC', {
            onEvent: (payload) => {
              if (payload && payload.state && payload.senderId !== clientId) {
                if (payload.state.updatedAt > (stateRef.current?.updatedAt || 0)) {
                  setGameState(payload.state);
                  stateRef.current = payload.state;
                }
              }
            },
          });
        } catch {
          // ignore
        }
      }).catch(() => {
        setIsConnected(true);
      });
    } catch {
      setIsConnected(true);
    }

    // 3. WebRTC P2P qua PeerJS (Đảm bảo 100% kết nối giữa 2 máy khác nhau)
    // Thử làm Host trước
    const hostPeer = new Peer(hostPeerId, {
      debug: 1,
    });

    hostPeer.on('open', (id) => {
      if (isDestroyed) return;
      isHostRef.current = true;
      peerRef.current = hostPeer;
      setIsConnected(true);
      setRole('red');

      // Host tự động chiếm ghế Đỏ
      const hostGame = {
        ...stateRef.current,
        seats: {
          ...stateRef.current.seats,
          [PLAYERS.RED]: { id: clientId, name: effectivePlayerName },
        },
        updatedAt: Date.now(),
      };
      stateRef.current = hostGame;
      setGameState(hostGame);

      // Lắng nghe các máy khác kết nối tới
      hostPeer.on('connection', (conn) => {
        connectionsRef.current.push(conn);

        conn.on('open', () => {
          // Gửi toàn bộ trạng thái hiện tại cho máy mới kết nối
          conn.send({
            type: 'STATE_UPDATE',
            state: stateRef.current,
            senderId: clientId,
          });
        });

        conn.on('data', (data) => {
          if (!data) return;

          // Khách xin vào ghế
          if (data.type === 'REQUEST_JOIN') {
            const current = stateRef.current;
            let assignedRole = 'spectator';
            let nextSeats = { ...current.seats };
            let nextPhase = current.phase;
            let nextDeadline = current.setupDeadline;

            if (!nextSeats[PLAYERS.BLUE]) {
              assignedRole = 'blue';
              nextSeats[PLAYERS.BLUE] = { id: data.senderId, name: data.playerName };
              // Đủ 2 người -> Bắt đầu Xếp quân Đỏ 30s
              if (nextPhase === GAME_PHASES.WAITING) {
                nextPhase = GAME_PHASES.SETUP_RED;
                nextDeadline = Date.now() + 30000;
              }
            }

            const updated = {
              ...current,
              seats: nextSeats,
              phase: nextPhase,
              setupDeadline: nextDeadline,
              updatedAt: Date.now(),
            };

            stateRef.current = updated;
            setGameState(updated);

            // Phản hồi vai trò cho máy khách
            conn.send({
              type: 'ASSIGN_ROLE',
              role: assignedRole,
              state: updated,
            });

            // Phát cho tất cả các máy khác
            broadcastState(updated);
          } else if (data.type === 'ACTION_STATE_UPDATE' && data.state) {
            // Khách thực hiện nước đi / xếp quân
            if (data.state.updatedAt > (stateRef.current?.updatedAt || 0)) {
              stateRef.current = data.state;
              setGameState(data.state);
              broadcastState(data.state);
            }
          }
        });

        conn.on('close', () => {
          connectionsRef.current = connectionsRef.current.filter((c) => c !== conn);
        });
      });
    });

    hostPeer.on('error', (err) => {
      // Nếu ID Host đã tồn tại (tức đã có Máy 1 làm Host) -> Ta là Guest!
      if (err.type === 'unavailable-id') {
        hostPeer.destroy();
        isHostRef.current = false;

        const guestPeer = new Peer({ debug: 1 });
        peerRef.current = guestPeer;

        guestPeer.on('open', (guestId) => {
          if (isDestroyed) return;
          setIsConnected(true);

          // Kết nối tới Host của phòng này
          const conn = guestPeer.connect(hostPeerId, { reliable: true });
          hostConnRef.current = conn;

          conn.on('open', () => {
            // Xin tham gia phòng và đăng ký tên
            conn.send({
              type: 'REQUEST_JOIN',
              senderId: clientId,
              playerName: effectivePlayerName,
            });
          });

          conn.on('data', (data) => {
            if (!data) return;
            if (data.type === 'ASSIGN_ROLE') {
              setRole(data.role);
              if (data.state) {
                setGameState(data.state);
                stateRef.current = data.state;
              }
            } else if (data.type === 'STATE_UPDATE' && data.state) {
              setGameState(data.state);
              stateRef.current = data.state;
            }
          });
        });
      }
    });

    return () => {
      isDestroyed = true;
      bc.close();
      if (peerRef.current) {
        peerRef.current.destroy();
      }
    };
  }, [roomId, cleanId, clientId, effectivePlayerName, hostPeerId, broadcastState]);

  // Đếm ngược 30s Setup trên Host
  useEffect(() => {
    if (!isHostRef.current) return;
    if (!gameState || !gameState.setupDeadline) return;
    if (gameState.phase !== GAME_PHASES.SETUP_RED && gameState.phase !== GAME_PHASES.SETUP_BLUE) return;

    const interval = setInterval(() => {
      const now = Date.now();
      if (now >= gameState.setupDeadline) {
        clearInterval(interval);
        if (gameState.phase === GAME_PHASES.SETUP_RED) {
          const redPieces = Object.values(gameState.pieces).filter((p) => p.player === PLAYERS.RED);
          const unplacedRed = gameState.unplacedPieces[PLAYERS.RED] || [];
          const allRed = [...redPieces, ...unplacedRed];
          const nextState = completeSetupRed(gameState, allRed);
          broadcastState(nextState);
        } else if (gameState.phase === GAME_PHASES.SETUP_BLUE) {
          const bluePieces = Object.values(gameState.pieces).filter((p) => p.player === PLAYERS.BLUE);
          const unplacedBlue = gameState.unplacedPieces[PLAYERS.BLUE] || [];
          const allBlue = [...bluePieces, ...unplacedBlue];
          const nextState = completeSetupBlue(gameState, allBlue);
          broadcastState(nextState);
        }
      }
    }, 500);

    return () => clearInterval(interval);
  }, [gameState, broadcastState]);

  // Hành động: Xếp quân
  const handlePlacePieceInSetup = useCallback((pieceIdOrType, targetSquare) => {
    const currentState = stateRef.current;
    if (!currentState) return;

    const isRedTurn = currentState.phase === GAME_PHASES.SETUP_RED && role === 'red';
    const isBlueTurn = currentState.phase === GAME_PHASES.SETUP_BLUE && role === 'blue';
    if (!isRedTurn && !isBlueTurn) return;

    const player = isRedTurn ? PLAYERS.RED : PLAYERS.BLUE;
    const unplaced = currentState.unplacedPieces[player] || [];
    let pieceToPlace = null;

    if (['rock', 'paper', 'scissors'].includes(pieceIdOrType)) {
      pieceToPlace = unplaced.find((p) => p.type === pieceIdOrType && !p.square);
      if (!pieceToPlace) return;
    } else {
      pieceToPlace = currentState.pieces[pieceIdOrType] || unplaced.find((p) => p.id === pieceIdOrType);
    }

    if (!pieceToPlace || pieceToPlace.player !== player) return;

    const existingOccupant = Object.values(currentState.pieces).find(
      (p) => p.alive && p.square === targetSquare && p.id !== pieceToPlace.id
    );

    const newPieces = { ...currentState.pieces };
    let newUnplaced = unplaced.filter((p) => p.id !== pieceToPlace.id);

    if (existingOccupant) {
      if (pieceToPlace.square) {
        existingOccupant.square = pieceToPlace.square;
        newPieces[existingOccupant.id] = existingOccupant;
      } else {
        existingOccupant.square = null;
        newUnplaced.push(existingOccupant);
        delete newPieces[existingOccupant.id];
      }
    }

    newPieces[pieceToPlace.id] = {
      ...pieceToPlace,
      square: targetSquare,
    };

    broadcastState({
      ...currentState,
      pieces: newPieces,
      unplacedPieces: {
        ...currentState.unplacedPieces,
        [player]: newUnplaced,
      },
      updatedAt: Date.now(),
    });
  }, [role, broadcastState]);

  // Hành động: Nhấc quân về khay trong lúc Setup
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

    broadcastState({
      ...currentState,
      pieces: newPieces,
      unplacedPieces: {
        ...currentState.unplacedPieces,
        [player]: newUnplaced,
      },
      updatedAt: Date.now(),
    });
  }, [role, broadcastState]);

  // Hành động: Xếp nhanh
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

    const cleared = allPieces.map((p) => ({ ...p, square: null }));
    const placed = autoPlaceRemaining(cleared, player);

    const newPieces = { ...currentState.pieces };
    placed.forEach((p) => {
      newPieces[p.id] = p;
    });

    broadcastState({
      ...currentState,
      pieces: newPieces,
      unplacedPieces: {
        ...currentState.unplacedPieces,
        [player]: [],
      },
      updatedAt: Date.now(),
    });
  }, [role, broadcastState]);

  // Hành động: Xác nhận xếp quân
  const handleConfirmSetup = useCallback(() => {
    const currentState = stateRef.current;
    if (!currentState) return;

    if (currentState.phase === GAME_PHASES.SETUP_RED && role === 'red') {
      const redPieces = Object.values(currentState.pieces).filter((p) => p.player === PLAYERS.RED);
      const unplacedRed = currentState.unplacedPieces[PLAYERS.RED] || [];
      const allRed = [...redPieces, ...unplacedRed];
      const nextState = completeSetupRed(currentState, allRed);
      broadcastState(nextState);
    } else if (currentState.phase === GAME_PHASES.SETUP_BLUE && role === 'blue') {
      const bluePieces = Object.values(currentState.pieces).filter((p) => p.player === PLAYERS.BLUE);
      const unplacedBlue = currentState.unplacedPieces[PLAYERS.BLUE] || [];
      const allBlue = [...bluePieces, ...unplacedBlue];
      const nextState = completeSetupBlue(currentState, allBlue);
      broadcastState(nextState);
    }
  }, [role, broadcastState]);

  // Hành động: Đi một nước
  const handleMakeMove = useCallback((pieceId, targetSquare) => {
    const currentState = stateRef.current;
    if (!currentState || currentState.phase !== GAME_PHASES.PLAYING) return;
    if (currentState.turn !== role) return;

    try {
      const nextState = executeMove(currentState, role, pieceId, targetSquare);
      broadcastState(nextState);
    } catch (err) {
      console.warn('Lỗi nước đi:', err.message);
    }
  }, [role, broadcastState]);

  // Hành động: Chơi lại
  const handleRestartGame = useCallback(() => {
    const freshState = createNewGame(roomId);
    freshState.seats = stateRef.current.seats;
    freshState.phase = GAME_PHASES.SETUP_RED;
    freshState.setupDeadline = Date.now() + 30000;
    broadcastState(freshState);
  }, [roomId, broadcastState]);

  return {
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
  };
}
