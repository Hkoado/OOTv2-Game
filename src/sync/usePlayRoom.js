import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { playhtml } from 'playhtml';
import Peer from 'peerjs';
import {
  createNewGame,
  GAME_PHASES,
  completeSetupRed,
  completeSetupBlue,
  executeMove,
  autoPlaceRemaining,
  approveOpponent,
} from '../game/gameState.js';
import { PLAYERS } from '../game/constants.js';

function getOrCreateClientId() {
  let id = sessionStorage.getItem('ottv2_client_id');
  if (!id) {
    id = 'user_' + Math.random().toString(36).substring(2, 9) + '_' + Date.now().toString(36);
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

  // Khởi tạo state từ localStorage nếu có, hoặc tạo mới
  const [gameState, setGameState] = useState(() => {
    try {
      const saved = localStorage.getItem(`ottv2_room_${roomId}`);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.roomId === roomId) {
          return parsed;
        }
      }
    } catch {
      // ignore
    }
    return createNewGame(roomId);
  });

  const [isConnected, setIsConnected] = useState(false);

  const stateRef = useRef(gameState);
  stateRef.current = gameState;

  // Xác định vai trò role và isHost một cách tất định từ seats & hostId
  const role = useMemo(() => {
    if (gameState?.seats?.[PLAYERS.RED]?.id === clientId) return 'red';
    if (gameState?.seats?.[PLAYERS.BLUE]?.id === clientId) return 'blue';
    return 'spectator';
  }, [gameState?.seats, clientId]);

  const isHost = useMemo(() => {
    if (!gameState) return false;
    if (gameState.hostId === clientId) return true;
    if (gameState.seats?.[PLAYERS.RED]?.id === clientId) return true;
    // Nếu chưa có ai làm host và chưa có Red, người này có thể làm host
    if (!gameState.hostId && !gameState.seats?.[PLAYERS.RED]) return true;
    return false;
  }, [gameState, clientId]);

  const peerRef = useRef(null);
  const connectionsRef = useRef([]); // Host lưu danh sách kết nối client
  const hostConnRef = useRef(null);  // Guest kết nối tới Host
  const broadcastChannelRef = useRef(null);

  // Phát tán trạng thái mới tới toàn bộ kết nối
  const broadcastState = useCallback((newState) => {
    const enrichedState = {
      ...newState,
      version: (newState.version || stateRef.current?.version || 0) + 1,
      updatedAt: Date.now(),
    };

    stateRef.current = enrichedState;
    setGameState(enrichedState);

    try {
      localStorage.setItem(`ottv2_room_${roomId}`, JSON.stringify(enrichedState));
    } catch {
      // ignore
    }

    // 1. BroadcastChannel (rất nhanh cho các tab trên cùng máy)
    if (broadcastChannelRef.current) {
      try {
        broadcastChannelRef.current.postMessage({
          type: 'STATE_UPDATE',
          state: enrichedState,
          senderId: clientId,
        });
      } catch {
        // ignore
      }
    }

    // 2. WebRTC PeerJS
    if (isHost) {
      connectionsRef.current.forEach((conn) => {
        if (conn.open) {
          try {
            conn.send({ type: 'STATE_UPDATE', state: enrichedState, senderId: clientId });
          } catch {
            // ignore
          }
        }
      });
    } else if (hostConnRef.current && hostConnRef.current.open) {
      try {
        hostConnRef.current.send({ type: 'ACTION_STATE_UPDATE', state: enrichedState, senderId: clientId });
      } catch {
        // ignore
      }
    }

    // 3. playhtml event dispatch (PartyKit multi-client sync)
    try {
      playhtml.dispatchPlayEvent?.({
        type: 'OTT_SYNC',
        eventPayload: { state: enrichedState, senderId: clientId, timestamp: Date.now() },
      });
    } catch {
      // ignore
    }
  }, [clientId, roomId, isHost]);

  // Thiết lập các kênh kết nối Realtime (BroadcastChannel + playhtml + WebRTC)
  useEffect(() => {
    if (!roomId) return;

    let isDestroyed = false;

    // 1. Khởi tạo BroadcastChannel cho tab cùng máy
    const bc = new BroadcastChannel(`ottv2_bc_${cleanId}`);
    broadcastChannelRef.current = bc;

    bc.onmessage = (event) => {
      const { type, state, senderId, user, action } = event.data || {};
      if (senderId === clientId) return;

      if (type === 'STATE_UPDATE' && state) {
        const curVer = stateRef.current?.version || 0;
        const newVer = state.version || 0;
        if (newVer >= curVer || state.updatedAt > (stateRef.current?.updatedAt || 0)) {
          setGameState(state);
          stateRef.current = state;
        }
      } else if (type === 'JOIN_ROOM' && user) {
        // Nếu ta là Host, cập nhật danh sách người tham gia
        const cur = stateRef.current;
        if (cur && (cur.hostId === clientId || cur.seats?.[PLAYERS.RED]?.id === clientId)) {
          const exists = (cur.participants || []).some((p) => p.id === user.id);
          if (!exists) {
            const nextParticipants = [
              ...(cur.participants || []),
              { id: user.id, name: user.name, isHost: false, joinedAt: Date.now() },
            ];
            const updated = {
              ...cur,
              participants: nextParticipants,
            };
            broadcastState(updated);
          } else {
            // Gửi lại state mới nhất cho người vừa vào
            bc.postMessage({
              type: 'STATE_UPDATE',
              state: cur,
              senderId: clientId,
            });
          }
        }
      }
    };

    // 2. playhtml init (PartyKit cloud sync)
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
                const curVer = stateRef.current?.version || 0;
                const newVer = payload.state.version || 0;
                if (newVer >= curVer || payload.state.updatedAt > (stateRef.current?.updatedAt || 0)) {
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

    // 3. WebRTC PeerJS với ID độc nhất cho mỗi client để tránh lỗi ID taken
    const myPeerId = `ottv2_${cleanId}_${clientId.replace(/[^a-zA-Z0-9]/g, '_')}`;
    let peerInstance = null;

    try {
      peerInstance = new Peer(myPeerId, { debug: 1 });
      peerRef.current = peerInstance;

      peerInstance.on('open', () => {
        if (isDestroyed) return;
        setIsConnected(true);
      });

      // Lắng nghe kết nối P2P từ các client khác
      peerInstance.on('connection', (conn) => {
        connectionsRef.current.push(conn);

        conn.on('open', () => {
          if (stateRef.current) {
            conn.send({
              type: 'STATE_UPDATE',
              state: stateRef.current,
              senderId: clientId,
            });
          }
        });

        conn.on('data', (data) => {
          if (!data) return;
          if (data.type === 'STATE_UPDATE' && data.state) {
            const curVer = stateRef.current?.version || 0;
            const newVer = data.state.version || 0;
            if (newVer >= curVer || data.state.updatedAt > (stateRef.current?.updatedAt || 0)) {
              setGameState(data.state);
              stateRef.current = data.state;
            }
          } else if (data.type === 'ACTION_STATE_UPDATE' && data.state) {
            // Nhận cập nhật từ client và phát lại cho toàn phòng
            setGameState(data.state);
            stateRef.current = data.state;
            broadcastState(data.state);
          }
        });

        conn.on('close', () => {
          connectionsRef.current = connectionsRef.current.filter((c) => c !== conn);
        });
      });

      peerInstance.on('error', (err) => {
        console.warn('PeerJS status notice:', err.type);
      });
    } catch {
      // ignore
    }

    // 4. Khi vào phòng, tự động ghi danh hoặc xin vào danh sách người tham gia
    const current = stateRef.current;
    if (!current.hostId || current.hostId === clientId) {
      // Người đầu tiên tạo phòng -> Làm Host (Đội Đỏ)
      const hostGame = {
        ...current,
        hostId: clientId,
        seats: {
          ...current.seats,
          [PLAYERS.RED]: { id: clientId, name: effectivePlayerName },
        },
        participants: [
          { id: clientId, name: effectivePlayerName, isHost: true, joinedAt: Date.now() },
        ],
        updatedAt: Date.now(),
      };
      stateRef.current = hostGame;
      setGameState(hostGame);
      try {
        localStorage.setItem(`ottv2_room_${roomId}`, JSON.stringify(hostGame));
      } catch {
        // ignore
      }
    } else {
      // Khách vào phòng -> Thông báo JOIN_ROOM qua BroadcastChannel & playhtml
      bc.postMessage({
        type: 'JOIN_ROOM',
        user: { id: clientId, name: effectivePlayerName },
        senderId: clientId,
      });

      try {
        playhtml.dispatchPlayEvent?.({
          type: 'OTT_JOIN',
          eventPayload: { user: { id: clientId, name: effectivePlayerName }, senderId: clientId },
        });
      } catch {
        // ignore
      }
    }

    return () => {
      isDestroyed = true;
      bc.close();
      if (peerRef.current) {
        try {
          peerRef.current.destroy();
        } catch {
          // ignore
        }
      }
    };
  }, [roomId, cleanId, clientId, effectivePlayerName, broadcastState]);

  // Đếm ngược 30s Setup (Host điều phối tự động xếp quân khi hết giờ)
  useEffect(() => {
    if (!isHost) return;
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
    }, 400);

    return () => clearInterval(interval);
  }, [gameState, isHost, broadcastState]);

  // HÀNH ĐỘNG 1: Chủ phòng duyệt đối thủ vào Đội Xanh để bắt đầu trận đấu
  const handleApprovePlayer = useCallback((participantId) => {
    const currentState = stateRef.current;
    if (!currentState) return;
    if (!isHost && currentState.hostId !== clientId) return;

    const candidate = (currentState.participants || []).find((p) => p.id === participantId);
    if (!candidate) return;

    const nextState = approveOpponent(currentState, candidate);
    broadcastState(nextState);
  }, [clientId, isHost, broadcastState]);

  // HÀNH ĐỘNG 2: Xếp quân trong giai đoạn Setup (hỗ trợ đặt mới từ khay, di chuyển quân đã xếp, đổi chỗ 2 quân)
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
      // Tìm quân chưa đặt trong khay của loại này
      pieceToPlace = unplaced.find((p) => p.type === pieceIdOrType && !p.square);
      if (!pieceToPlace) return; // Đã đặt hết quân loại này
    } else {
      // Quân đã có trên bàn cờ hoặc ID cụ thể
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
        // Đổi chỗ 2 quân đang ở trên bàn cờ
        existingOccupant.square = pieceToPlace.square;
        newPieces[existingOccupant.id] = { ...existingOccupant };
      } else {
        // Thu hồi quân đang có tại ô này về khay unplaced
        existingOccupant.square = null;
        newUnplaced.push({ ...existingOccupant });
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
    });
  }, [role, broadcastState]);

  // HÀNH ĐỘNG 3: Nhấc một quân đã đặt trên bàn cờ về khay
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
    });
  }, [role, broadcastState]);

  // HÀNH ĐỘNG 4: Xếp ngẫu nhiên nhanh toàn bộ số quân
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
    });
  }, [role, broadcastState]);

  // HÀNH ĐỘNG 5: Xác nhận đã xếp quân xong
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

  // HÀNH ĐỘNG 6: Đi một nước cờ trong trận đấu
  const handleMakeMove = useCallback((pieceId, targetSquare) => {
    const currentState = stateRef.current;
    if (!currentState || currentState.phase !== GAME_PHASES.PLAYING) return;
    if (currentState.turn !== role) return;

    try {
      const nextState = executeMove(currentState, role, pieceId, targetSquare);
      broadcastState(nextState);
    } catch (err) {
      console.warn('Nước đi không hợp lệ:', err.message);
    }
  }, [role, broadcastState]);

  // HÀNH ĐỘNG 7: Chơi lại ván mới
  const handleRestartGame = useCallback(() => {
    const freshState = createNewGame(roomId);
    freshState.hostId = stateRef.current.hostId;
    freshState.seats = stateRef.current.seats;
    freshState.participants = stateRef.current.participants;
    freshState.phase = GAME_PHASES.SETUP_RED;
    freshState.setupDeadline = Date.now() + 30000;
    broadcastState(freshState);
  }, [roomId, broadcastState]);

  return {
    gameState,
    role,
    isHost,
    clientId,
    isConnected,
    handleApprovePlayer,
    handlePlacePieceInSetup,
    handleRemovePieceFromBoardInSetup,
    handleQuickAutoPlace,
    handleConfirmSetup,
    handleMakeMove,
    handleRestartGame,
  };
}
