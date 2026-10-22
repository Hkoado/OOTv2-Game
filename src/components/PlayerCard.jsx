import React from 'react';
import { OTTPlayerCard, OTTPiece } from '../ui/ott-v2-ui-kit/react/index.mjs';
import { getRemainingPieceCounts } from '../game/rules.js';
export default function PlayerCard({ player, seat, pieces = {}, isTurn, isMyCard }) {
  const counts = getRemainingPieceCounts(pieces, player);
  return <div>
    <OTTPlayerCard team={player} name={seat ? seat.name : 'Đang chờ người chơi…'} active={isTurn} count={Object.values(counts).reduce((a, b) => a + b, 0)} status={isMyCard ? 'Bạn' : undefined} />
    <div className="piece-counts-grid">{Object.entries(counts).map(([type, count]) => <span key={type} className="piece-count-pill"><OTTPiece type={type} team={player} size={32} /><span>{count}/3</span></span>)}</div>
  </div>;
}
