import React, { useState } from 'react';
import { SAMPLE_MAPS } from '../../game/sampleMaps.js';
import { normalizeMap } from '../../game/maps.js';
import { Alert, Panel } from './TournamentUi.jsx';
import MapPreview from './MapPreview.jsx';

export default function DraftEventEditor({ event, teams, actions, busy }) {
  const [ids, setIds] = useState(() => event.entries.map((entry) => entry.participant_id));
  const [map, setMap] = useState(event.map);
  const [error, setError] = useState('');
  async function importMap(e) {
    try {
      const file = e.target.files?.[0];
      if (!file) return;
      if (file.size > 16384) throw new Error('Map tối đa 16 KiB.');
      setMap(normalizeMap(JSON.parse(await file.text()))); setError('');
    } catch (err) { setError(err.message); }
    e.target.value = '';
  }
  const known = SAMPLE_MAPS.some((item) => item.map.id === map.id && JSON.stringify(item.map.blocked) === JSON.stringify(map.blocked));
  return <Panel title="Chuẩn bị giải" subtitle="Đội · Map · Sau đó bắt đầu. Thứ tự chọn là thứ tự seed MVP.">
    <form className="tt-form" onSubmit={async (e) => { e.preventDefault(); await actions.saveEvent(event.id, { participantIds: ids, map }); }}>
      <div className="tt-grid tt-grid--2"><section><h3>Đội tham gia · {ids.length}/8</h3>
        <div className="tt-picker">{teams.map((team) => <label className={`tt-picker__item${ids.includes(team.id) ? ' is-checked' : ''}`} key={team.id}>
          <input type="checkbox" checked={ids.includes(team.id)} disabled={busy?.event || (!ids.includes(team.id) && ids.length >= 8)} onChange={(e) => setIds(e.target.checked ? [...ids, team.id] : ids.filter((id) => id !== team.id))} />
          <span>{team.name}<small className="tt-cell-sub">{team.latest_valid_submission_id ? 'Có bot hợp lệ' : 'Chưa có bot hợp lệ'}{ids.includes(team.id) ? ` · Seed ${ids.indexOf(team.id) + 1}` : ''}</small></span>
        </label>)}</div>{!teams.length && <p className="tt-muted">Tạo tài khoản trong mục Đội & tài khoản, rồi quay lại thêm đội.</p>}</section>
        <section><label className="tt-field">Map riêng của giải<select aria-label="Map của giải" value={known ? map.id : 'custom'} onChange={(e) => setMap(SAMPLE_MAPS.find((item) => item.map.id === e.target.value).map)}>
          {!known && <option value="custom">{map.id} (đã nhập)</option>}
          {SAMPLE_MAPS.map((item) => <option key={item.map.id} value={item.map.id}>{item.name}</option>)}</select></label>
          <MapPreview map={map} /><label className="tt-field">Nhập map.v1 JSON<input type="file" accept=".json,application/json" onChange={importMap} /></label>
          {!!map.blocked.length && <Alert tone="warning">Map này dùng được khi chơi offline. Cần nối worker Campus trước khi chạy giải có ô cản.</Alert>}
        </section></div>
      {error && <Alert tone="danger">{error}</Alert>}
      <div><button className="tt-btn tt-btn--info" disabled={busy?.event}>{busy?.event ? 'Đang lưu…' : 'Lưu đội & map'}</button></div>
    </form>
  </Panel>;
}
