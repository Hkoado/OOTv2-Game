import React, { useState } from 'react';
import { Copy, Check, Eye, BookOpen, LogOut, Swords } from 'lucide-react';
import { PLAYERS } from '../game/constants.js';

export default function Header({
  roomId,
  role,
  onOpenRules,
  onLeaveRoom,
}) {
  const [copied, setCopied] = useState(false);

  function handleCopyInvite() {
    const inviteUrl = window.location.origin + window.location.pathname + `?room=${roomId}`;
    navigator.clipboard?.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  let roleBadge = null;
  if (role === 'red') {
    roleBadge = <span className="badge badge--red">Bạn là: Đội Đỏ (P1)</span>;
  } else if (role === 'blue') {
    roleBadge = <span className="badge badge--blue">Bạn là: Đội Xanh (P2)</span>;
  } else {
    roleBadge = (
      <span className="badge badge--neutral">
        <Eye className="w-3.5 h-3.5 inline mr-1" /> Người xem (Spectator)
      </span>
    );
  }

  return (
    <header className="app-header">
      <div className="app-header__left">
        <div className="brand" onClick={onLeaveRoom} style={{ cursor: 'pointer' }}>
          <div className="brand__logo">
            <Swords className="w-5 h-5 text-emerald-700" />
          </div>
          <div className="brand__text">
            <span className="brand__name">OTT<span className="text-emerald-600">v2</span></span>
            <span className="brand__sub">Oẳn Tù Tì Chiến Thuật 9x9</span>
          </div>
        </div>

        {roomId && (
          <div className="room-pill">
            <span className="room-pill__label">Phòng:</span>
            <strong className="room-pill__code">{roomId}</strong>
            <button
              type="button"
              className="room-pill__copy-btn"
              onClick={handleCopyInvite}
              title="Sao chép link mời bạn bè"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Đã sao chép' : 'Sao chép link'}</span>
            </button>
          </div>
        )}
      </div>

      <div className="app-header__right">
        {roleBadge}

        <button
          type="button"
          className="btn btn--header"
          onClick={onOpenRules}
        >
          <BookOpen className="w-4 h-4" />
          <span>Luật chơi</span>
        </button>

        {roomId && (
          <button
            type="button"
            className="btn btn--header btn--header-danger"
            onClick={onLeaveRoom}
            title="Rời phòng về sảnh"
          >
            <LogOut className="w-4 h-4" />
            <span>Rời phòng</span>
          </button>
        )}
      </div>
    </header>
  );
}
