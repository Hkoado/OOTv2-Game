import React, { useState, useEffect } from 'react';
import { Plus, ArrowRight, Swords, Sparkles, History, Trash2 } from 'lucide-react';

export default function Lobby({ onJoinRoom, onOpenRules }) {
  const [playerName, setPlayerName] = useState(() => {
    return localStorage.getItem('ottv2_player_name') || 'Người chơi ' + Math.floor(Math.random() * 900 + 100);
  });

  const [customRoomId, setCustomRoomId] = useState('');
  const [recentRooms, setRecentRooms] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('ottv2_recent_rooms') || '[]');
    } catch {
      return [];
    }
  });

  function handleSaveName(name) {
    setPlayerName(name);
    localStorage.setItem('ottv2_player_name', name);
  }

  function handleCreateRandomRoom() {
    const randomCode = 'OTT-' + Math.floor(1000 + Math.random() * 9000);
    // Xóa cache cũ nếu tình cờ trùng mã
    localStorage.removeItem(`ottv2_room_${randomCode}`);
    sessionStorage.setItem(`ottv2_creator_${randomCode}`, '1');
    saveRecentRoom(randomCode);
    onJoinRoom(randomCode, playerName, true);
  }

  function handleJoinCustomRoom(e) {
    e.preventDefault();
    if (!customRoomId.trim()) return;
    const cleanId = customRoomId.trim().toUpperCase();
    saveRecentRoom(cleanId);
    const isCreator = sessionStorage.getItem(`ottv2_creator_${cleanId}`) === '1';
    onJoinRoom(cleanId, playerName, isCreator);
  }

  function saveRecentRoom(roomId) {
    const updated = [roomId, ...recentRooms.filter((id) => id !== roomId)].slice(0, 5);
    setRecentRooms(updated);
    localStorage.setItem('ottv2_recent_rooms', JSON.stringify(updated));
  }

  function clearRecentRooms() {
    setRecentRooms([]);
    localStorage.removeItem('ottv2_recent_rooms');
  }

  return (
    <div className="lobby-container">
      <div className="lobby-hero">
        <div className="badge badge--green mb-3">
          <Sparkles className="w-3.5 h-3.5 inline mr-1" />
          Oẳn Tù Tì v2 Chiến Thuật (OTTv2)
        </div>
        <h1 className="lobby-hero__title">
          Đấu Trường Oẳn Tù Tì 9x9
        </h1>
        <p className="lobby-hero__subtitle">
          2 Người chơi trực tuyến · Bàn cờ 9x9 · Xếp quân 30s · Đột kích Nhà chính hoặc Diệt sạch 1 loại quân
        </p>

        {/* Cấu hình Tên người chơi */}
        <div className="player-name-card">
          <label className="player-name-label" htmlFor="player-name-input">
            Tên của bạn trong ván đấu:
          </label>
          <input
            id="player-name-input"
            type="text"
            className="input"
            value={playerName}
            onChange={(e) => handleSaveName(e.target.value)}
            placeholder="Nhập tên người chơi..."
            maxLength={20}
          />
        </div>
      </div>

      <div className="lobby-grid">
        {/* Khối 1: Tạo phòng mới */}
        <div className="lobby-col card">
          <div className="card-header">
            <Plus className="w-5 h-5 text-emerald-600" />
            <h2 className="card-title">Tạo phòng thi đấu mới</h2>
          </div>

          <p className="text-sm text-neutral-600 mb-4">
            Khởi tạo một phòng chơi mới hoàn toàn, hệ thống sẽ tạo mã phòng tự động để bạn gửi link cho bạn bè cùng vào so tài hoặc xem trực tiếp.
          </p>

          <button
            type="button"
            className="btn btn--primary btn--large w-full mb-3"
            onClick={handleCreateRandomRoom}
          >
            <Plus className="w-5 h-5" />
            <span>Tạo phòng ngay</span>
          </button>

          <div className="divider">
            <span>hoặc vào phòng có sẵn</span>
          </div>

          <form onSubmit={handleJoinCustomRoom} className="join-form">
            <input
              type="text"
              className="input"
              placeholder="Nhập mã phòng (ví dụ: OTT-8821)"
              value={customRoomId}
              onChange={(e) => setCustomRoomId(e.target.value)}
            />
            <button
              type="submit"
              className="btn btn--secondary"
              disabled={!customRoomId.trim()}
            >
              <span>Vào phòng</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>
        </div>

        {/* Khối 2: Phòng đã chơi gần đây & Luật chơi tóm tắt */}
        <div className="lobby-col card">
          <div className="card-header justify-between">
            <div className="flex items-center gap-2">
              <History className="w-5 h-5 text-emerald-600" />
              <h2 className="card-title">Phòng gần đây của bạn</h2>
            </div>
            {recentRooms.length > 0 && (
              <button
                type="button"
                className="text-xs text-neutral-400 hover:text-red-500 flex items-center gap-1"
                onClick={clearRecentRooms}
                title="Xóa lịch sử phòng"
              >
                <Trash2 className="w-3 h-3" />
                <span>Xóa</span>
              </button>
            )}
          </div>

          {recentRooms.length === 0 ? (
            <div className="p-4 text-center text-xs text-neutral-400 bg-slate-50 rounded border border-slate-100 mb-4">
              Bạn chưa có phòng nào gần đây. Hãy bấm <strong>Tạo phòng ngay</strong> ở bên cạnh để bắt đầu trận đấu!
            </div>
          ) : (
            <div className="room-list mb-4">
              {recentRooms.map((id) => (
                <div key={id} className="room-card">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm text-neutral-800 font-mono">
                      {id}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="btn btn--secondary btn--small"
                    onClick={() => {
                      saveRecentRoom(id);
                      const isCreator = sessionStorage.getItem(`ottv2_creator_${id}`) === '1';
                      onJoinRoom(id, playerName, isCreator);
                    }}
                  >
                    <span>Vào lại</span>
                    <ArrowRight className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="rules-preview-box">
            <div className="flex items-center justify-between mb-2">
              <span className="font-semibold text-sm text-neutral-700">Tóm tắt luật cốt lõi:</span>
              <button
                type="button"
                className="text-emerald-600 text-xs font-semibold hover:underline"
                onClick={onOpenRules}
              >
                Xem chi tiết →
              </button>
            </div>
            <ul className="text-xs text-neutral-500 space-y-1">
              <li>• Mỗi bên 9 quân (3 Búa, 3 Bao, 3 Kéo). Xếp trong 30s.</li>
              <li>• Đội Đỏ xếp trước (sân a1); Đội Xanh đi sau được xem Đỏ xếp quân (sân i9).</li>
              <li>• Đi 1 ô 8 hướng. Búa ăn Kéo, Kéo ăn Bao, Bao ăn Búa. Cùng loại chặn nhau.</li>
              <li>• Hệ thống chặn nước đi tự sát (không đi vào ô quân địch mạnh hơn).</li>
              <li>• Thắng khi: Đưa quân vào Nhà chính đối phương HOẶC Ăn sạch 1 loại quân.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
