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

function getOrCreateClientId(roomId) {
  if (typeof window !== 'undefined' && !window.name) {
    window.name = 'ottv2_win_' + Math.random().toString(36).substring(2, 9);
  }
  const winKey = typeof window !== 'undefined' ? window.name : 'server';
  const key = `ottv2_client_${roomId}_${winKey}`;
  let id = sessionStorage.getItem(key);
  if (!id) {
    id = 'user_' + Math.random().toString(36).substring(2, 9) + '_' + Date.now().toString(36);
    sessionStorage.setItem(key, id);
  }
  return id;
}

function getStoredPlayerName() {
  return localStorage.getItem('ottv2_player_name') || 'Người chơi';
}

function sanitizeRoomId(id) {
  return (id || 'ROOM').replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
}

// So sánh state đến với state hiện tại: ưu tiên version (đơn điệu, đáng tin cậy),
// chỉ dùng updatedAt (đồng hồ máy) làm tiêu chí phụ khi version bằng nhau, để tránh
// lệch giờ giữa 2 máy làm mất nước đi/trạng thái mới hơn.
function shouldAcceptIncomingState(incoming, current) {
  if (!incoming) return false;
  if (!current) return true;
  const incomingVersion = incoming.version || 0;
  const currentVersion = current.version || 0;
  if (incomingVersion !== currentVersion) return incomingVersion > currentVersion;
  return (incoming.updatedAt || 0) > (current.updatedAt || 0);
}

export function usePlayRoom(roomId, playerName = '', isCreatorProp = false) {
  const isCreator = isCreatorProp || (sessionStorage.getItem(`ottv2_creator_${roomId}`) === '1');
  const clientId = useRef(getOrCreateClientId(roomId)).current;
  const effectivePlayerName = playerName || getStoredPlayerName();
  const cleanId = sanitizeRoomId(roomId);

  // Khởi tạo state: Nếu là Creator -> Chắc chắn luôn là Host (Đội Đỏ) ngay từ frame đầu tiên
  const [gameState, setGameState] = useState(() => {
    if (isCreator) {
      const initial = createNewGame(roomId);
      initial.hostId = clientId;
      initial.seats[PLAYERS.RED] = { id: clientId, name: effectivePlayerName };
      initial.participants = [
        { id: clientId, name: effectivePlayerName, isHost: true, joinedAt: Date.now() },
      ];
      try {
        localStorage.setItem(`ottv2_room_${roomId}`, JSON.stringify(initial));
      } catch {
        // ignore
      }
      return initial;
    }

    try {
      const saved = localStorage.getItem(`ottv2_room_${roomId}`);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.roomId === roomId && parsed.hostId) {
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

  // Xác định vai trò role:
  // - Người tạo phòng (isCreator): Luôn luôn là Đội Đỏ ('red')
  // - Người được duyệt vào ghế Blue: Là Đội Xanh ('blue')
  // - Tất cả người vào sau hoặc chưa được duyệt: Là Người xem ('spectator')
  const role = useMemo(() => {
    if (isCreator) return 'red';
    if (gameState?.seats?.[PLAYERS.RED]?.id === clientId) return 'red';
    if (gameState?.seats?.[PLAYERS.BLUE]?.id === clientId) return 'blue';
    return 'spectator';
  }, [gameState?.seats, clientId, isCreator]);

  const isHost = useMemo(() => {
    if (isCreator) return true;
    if (!gameState) return false;
    if (gameState.hostId === clientId) return true;
    if (gameState.seats?.[PLAYERS.RED]?.id === clientId) return true;
    return false;
  }, [gameState, clientId, isCreator]);

  const peerRef = useRef(null);
  const connectionsRef = useRef([]); // Host lưu danh sách kết nối client
  const hostConnRef = useRef(null);  // Guest kết nối tới Host
  const broadcastChannelRef = useRef(null);
  const playhtmlReadyRef = useRef(false); // true sau khi đã registerPlayEventListener xong

  // Gửi 1 trạng thái (không đổi version) ra toàn bộ kênh đang có - dùng lại được cho cả
  // broadcastState (khi có thay đổi thật) và cho nhịp "heartbeat" đồng bộ lại định kỳ, để
  // tự phục hồi khi 1 kênh nào đó (WebRTC vừa mở, playhtml chưa kịp đăng ký...) lỡ mất 1 lượt.
  const transmitState = useCallback((stateToSend) => {
    // 1. BroadcastChannel (đồng bộ tức thì 0ms giữa các tab cùng máy)
    if (broadcastChannelRef.current) {
      try {
        broadcastChannelRef.current.postMessage({
          type: 'STATE_UPDATE',
          state: stateToSend,
          senderId: clientId,
        });
      } catch {
        // ignore
      }
    }

    // 2. WebRTC PeerJS
    if (isHost) {
      connectionsRef.current.forEach((conn) => {
        if (conn && conn.open) {
          try {
            conn.send({ type: 'STATE_UPDATE', state: stateToSend, senderId: clientId });
          } catch {
            // ignore
          }
        }
      });
    } else if (hostConnRef.current && hostConnRef.current.open) {
      try {
        hostConnRef.current.send({ type: 'ACTION_STATE_UPDATE', state: stateToSend, senderId: clientId });
      } catch {
        // ignore
      }
    }

    // 3. playhtml event dispatch (PartyKit cloud sync)
    // Chỉ dispatch khi listener 'OTT_SYNC' đã registerPlayEventListener xong (tránh lỗi
    // "event not registered" do gọi dispatch sớm hơn thời điểm playhtml.init() resolve).
    if (playhtmlReadyRef.current) {
      try {
        playhtml.dispatchPlayEvent?.({
          type: 'OTT_SYNC',
          eventPayload: { state: stateToSend, senderId: clientId, timestamp: Date.now() },
        });
      } catch {
        // ignore
      }
    }
  }, [clientId, isHost]);

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

    transmitState(enrichedState);
  }, [roomId, transmitState]);

  // Nhịp đồng bộ định kỳ: mỗi bên tự gửi lại state mới nhất mình đang có, để nếu 1 nước đi/
  // 1 lần xếp quân bị rớt qua mọi kênh (mất kết nối tạm thời, race lúc mới join...) thì phía
  // còn lại vẫn tự bắt kịp trong vài giây sau, không bị "kẹt" chờ hết giờ mới thấy cập nhật.
  useEffect(() => {
    if (!roomId) return;
    const heartbeat = setInterval(() => {
      if (stateRef.current) {
        transmitState(stateRef.current);
      }
    }, 2500);
    return () => clearInterval(heartbeat);
  }, [roomId, transmitState]);

  // Xử lý khi có người mới xin vào phòng (dành cho Host)
  const handleIncomingJoin = useCallback((user) => {
    if (!user || !user.id) return;
    const cur = stateRef.current;
    if (!cur) return;
    const list = cur.participants || [];
    const exists = list.some((p) => p.id === user.id);
    if (!exists) {
      const nextParticipants = [
        ...list,
        { id: user.id, name: user.name, isHost: false, joinedAt: Date.now() },
      ];
      const updated = {
        ...cur,
        participants: nextParticipants,
        updatedAt: Date.now(),
      };
      broadcastState(updated);
    } else {
      // Gửi lại state mới nhất cho người vừa hỏi
      broadcastState(cur);
    }
  }, [broadcastState]);

  // Thiết lập các kênh kết nối Realtime (BroadcastChannel + playhtml + WebRTC PeerJS)
  useEffect(() => {
    if (!roomId) return;

    let isDestroyed = false;
    playhtmlReadyRef.current = false;

    // 1. Khởi tạo BroadcastChannel cho các tab cùng máy
    const bc = new BroadcastChannel(`ottv2_bc_${cleanId}`);
    broadcastChannelRef.current = bc;

    bc.onmessage = (event) => {
      const { type, state, senderId, user } = event.data || {};
      if (senderId === clientId) return;

      if (type === 'STATE_UPDATE' && state) {
        if (shouldAcceptIncomingState(state, stateRef.current)) {
          setGameState(state);
          stateRef.current = state;
        }
      } else if (type === 'JOIN_REQUEST' && user) {
        if (isHost || isCreator) {
          handleIncomingJoin(user);
        }
      } else if (type === 'ACTION_STATE_UPDATE' && state) {
        if ((isHost || isCreator) && shouldAcceptIncomingState(state, stateRef.current)) {
          setGameState(state);
          stateRef.current = state;
          broadcastState(state);
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
                if (shouldAcceptIncomingState(payload.state, stateRef.current)) {
                  setGameState(payload.state);
                  stateRef.current = payload.state;
                }
              }
            },
          });

          playhtml.registerPlayEventListener('OTT_JOIN', {
            onEvent: (payload) => {
              if (payload && payload.user && payload.senderId !== clientId) {
                if (isHost || isCreator) {
                  handleIncomingJoin(payload.user);
                }
              }
            },
          });

          // Chỉ đánh dấu "ready" (và chỉ gửi OTT_JOIN) SAU KHI đã đăng ký xong 2 listener
          // trên, tránh dispatch trước khi registerPlayEventListener chạy (playhtml sẽ từ
          // chối event với lỗi "event not registered" và người chơi mới sẽ không được
          // Host biết tới qua kênh cloud này).
          playhtmlReadyRef.current = true;
          if (!isCreator && !isHost) {
            playhtml.dispatchPlayEvent?.({
              type: 'OTT_JOIN',
              eventPayload: { user: { id: clientId, name: effectivePlayerName }, senderId: clientId },
            });
          }
        } catch {
          // ignore
        }
      }).catch(() => {
        setIsConnected(true);
      });
    } catch {
      setIsConnected(true);
    }

    // 3. WebRTC PeerJS: Kết nối P2P trực tiếp
    const hostPeerId = `ottv2_host_${cleanId}`;

    if (isCreator || isHost) {
      // Chủ phòng: Đăng ký Host Peer và lắng nghe kết nối từ các máy khác
      try {
        const hostPeer = new Peer(hostPeerId, { debug: 1 });
        peerRef.current = hostPeer;

        hostPeer.on('open', () => {
          if (isDestroyed) return;
          setIsConnected(true);
        });

        hostPeer.on('connection', (conn) => {
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
            if (data.type === 'JOIN_REQUEST' && data.user) {
              handleIncomingJoin(data.user);
            } else if (data.type === 'ACTION_STATE_UPDATE' && data.state) {
              if (shouldAcceptIncomingState(data.state, stateRef.current)) {
                setGameState(data.state);
                stateRef.current = data.state;
                broadcastState(data.state);
              }
            }
          });

          conn.on('close', () => {
            connectionsRef.current = connectionsRef.current.filter((c) => c !== conn);
          });
        });

        hostPeer.on('error', (err) => {
          console.warn('Host Peer notice:', err.type);
        });
      } catch (err) {
        console.warn('Host Peer init error:', err);
      }
    } else {
      // Khách vào phòng: Đăng ký Guest Peer và chủ động kết nối tới Host
      try {
        const guestPeerId = `ottv2_guest_${cleanId}_${clientId.replace(/[^a-zA-Z0-9]/g, '_')}`;
        const guestPeer = new Peer(guestPeerId, { debug: 1 });
        peerRef.current = guestPeer;

        let reconnectAttempts = 0;
        let reconnectTimer = null;

        // Kết nối tới Host, và TỰ THỬ LẠI nếu rớt/không mở được (mạng chập chờn, ICE lần đầu
        // thất bại...). Không có bước này thì 1 lần kết nối lỗi là Khách kẹt luôn tới hết ván,
        // chỉ còn trông chờ playhtml/BroadcastChannel - đúng kiểu triệu chứng "vào phòng không
        // thấy xếp quân, đợi hết giờ mới tự xếp" nếu 2 kênh còn lại cũng chậm/không sẵn sàng.
        const connectToHost = () => {
          if (isDestroyed) return;
          try {
            const conn = guestPeer.connect(hostPeerId, { reliable: true });
            hostConnRef.current = conn;

            conn.on('open', () => {
              reconnectAttempts = 0;
              conn.send({
                type: 'JOIN_REQUEST',
                user: { id: clientId, name: effectivePlayerName },
                senderId: clientId,
              });
              // Gửi lại action gần nhất (nếu có) để không bị mất nước đi/lượt xếp quân đã
              // thao tác trong lúc đang mất kết nối.
              if (stateRef.current) {
                conn.send({ type: 'ACTION_STATE_UPDATE', state: stateRef.current, senderId: clientId });
              }
            });

            conn.on('data', (data) => {
              if (!data) return;
              if (data.type === 'STATE_UPDATE' && data.state) {
                if (shouldAcceptIncomingState(data.state, stateRef.current)) {
                  setGameState(data.state);
                  stateRef.current = data.state;
                }
              }
            });

            const scheduleReconnect = () => {
              if (isDestroyed || reconnectTimer) return;
              reconnectAttempts += 1;
              const delay = Math.min(1000 * reconnectAttempts, 5000);
              reconnectTimer = setTimeout(() => {
                reconnectTimer = null;
                connectToHost();
              }, delay);
            };

            conn.on('close', scheduleReconnect);
            conn.on('error', scheduleReconnect);
          } catch (err) {
            console.warn('Guest connect to Host error:', err);
          }
        };

        guestPeer.on('open', () => {
          if (isDestroyed) return;
          setIsConnected(true);
          connectToHost();
        });

        guestPeer.on('disconnected', () => {
          if (isDestroyed) return;
          try {
            guestPeer.reconnect();
          } catch {
            // ignore
          }
        });

        guestPeer.on('error', (err) => {
          console.warn('Guest Peer notice:', err.type);
        });
      } catch (err) {
        console.warn('Guest Peer init error:', err);
      }
    }

    // 4. Nếu là Khách, phát thông báo JOIN_REQUEST qua BroadcastChannel ngay
    // (JOIN qua playhtml được gửi riêng, sau khi playhtml.init() đã resolve - xem trên)
    if (!isCreator && !isHost) {
      bc.postMessage({
        type: 'JOIN_REQUEST',
        user: { id: clientId, name: effectivePlayerName },
        senderId: clientId,
      });
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
  }, [roomId, cleanId, clientId, effectivePlayerName, isCreator, isHost, broadcastState, handleIncomingJoin]);

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
