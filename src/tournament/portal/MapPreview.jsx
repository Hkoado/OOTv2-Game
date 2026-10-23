import React from 'react';
import GameBoard from '../../ui/GameBoard.jsx';
export default function MapPreview({ map }) {
  return <figure className="tt-map-preview"><GameBoard map={map} title={map.id} readOnly /><figcaption>{map.id} · v{map.revision} · {map.rulesVersion === 'ott-campus.v2'
    ? 'Lửa cản Bao · Nước cản Kéo · Bụi cây cản Búa · Vực cản tất cả.'
    : `${map.blocked.length} ô cản · Hình vực biểu thị ô cản, không thể đi vào.`}</figcaption>
    <a className="tt-btn" download={`${map.id}.json`} href={`data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(map, null, 2))}`}>Tải map JSON</a>
  </figure>;
}
