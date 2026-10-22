import React from 'react';
import GameBoard from '../../ui/GameBoard.jsx';
export default function MapPreview({ map }) {
  return <figure className="tt-map-preview"><GameBoard map={map} title={map.id} readOnly /><figcaption>{map.id} · v{map.revision} · {map.blocked.length} ô cản · Hình vực biểu thị ô cản, không thể đi vào.</figcaption></figure>;
}
