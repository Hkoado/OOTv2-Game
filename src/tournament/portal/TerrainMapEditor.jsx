import React, { useState } from 'react';
import GameBoard from '../../ui/GameBoard.jsx';
import { paintTerrain } from '../../game/mapEditor.js';
import { validateMap } from '../../game/maps.js';
import { TERRAIN_LABELS } from '../../game/terrain.js';
import { Field, Alert } from './TournamentUi.jsx';

export default function TerrainMapEditor({ map, onChange }) {
  const [brush, setBrush] = useState('fire');
  const validation = validateMap(map);
  return <div>
    <Field label="Bút địa hình · tự đối xứng 180°">
      <select value={brush} onChange={(e) => setBrush(e.target.value)}>
        <option value="">Xóa địa hình</option>
        {Object.entries(TERRAIN_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select>
    </Field>
    <GameBoard map={map} readOnly={false} allowTerrainEditing onSquareClick={(square) => onChange(paintTerrain(map, square, brush))} title="Bấm ô để xếp địa hình" />
    <Field label="Mã map"><input value={map.id} maxLength={64} onChange={(e) => onChange({ ...map, id: e.target.value })} /></Field>
    <Field label="Revision"><input type="number" min="1" value={map.revision} onChange={(e) => onChange({ ...map, revision: Number(e.target.value) })} /></Field>
    {!validation.ok && <Alert tone="warning">Map chưa hợp lệ: {validation.errors.join('; ')}</Alert>}
  </div>;
}