import React, { useState } from 'react';
import { LEVEL_LABELS, MAX_OFFICIAL_TEAMS, competitionPreview, normalizeCompetition } from '../../game/competition.js';
import { SAMPLE_MAPS } from '../../game/sampleMaps.js';
import { Alert, DataTable, Field, Panel } from './TournamentUi.jsx';
import MapPreview from './MapPreview.jsx';

function localDate(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export default function OfficialSetupPanel({ event, teams, actions, busy, admin }) {
  const [ids, setIds] = useState(() => event.entries.map((entry) => entry.participant_id));
  const [config, setConfig] = useState(event.competition);
  const [cutoff, setCutoff] = useState(() => localDate(event.competition.cutoff));
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);
  const [baseVersion, setBaseVersion] = useState(event.version);
  const editable = admin && event.status === 'draft';
  const change = (key, value) => { setConfig((old) => ({ ...old, [key]: value })); setDirty(true); };
  let preview;
  try { preview = competitionPreview(ids, Number(event.seed), config); } catch { preview = event.setup_preview; }
  const names = new Map([...event.entries.map((entry) => [entry.participant_id, entry.participant_name]), ...teams.map((team) => [team.id, team.name])]);
  async function save(e) {
    e.preventDefault();
    try {
      const competition = normalizeCompetition({ ...config, cutoff: cutoff ? new Date(cutoff).toISOString() : null });
      if (await actions.saveEvent(event.id, { participantIds: ids, competition, expectedVersion: baseVersion })) {
        setConfig(competition); setBaseVersion((version) => version + 1); setDirty(false); setError('');
      }
    } catch (err) { setError(err.message); }
  }
  async function importMap(e, key) {
    try {
      const file = e.target.files?.[0];
      if (!file) return;
      if (file.size > 16384) throw new Error('Map tối đa 16 KiB.');
      const normalized = normalizeCompetition({ ...config, [key]: JSON.parse(await file.text()) });
      change(key, normalized[key]); setError('');
    } catch (err) { setError(err.message); }
    e.target.value = '';
  }
  return <>
    <Alert tone="warning" title="Thiết lập giải chính thức · không phải giải MVP 8 đội">
      {preview.executionBlocker} Đây là dự kiến, chưa khóa roster/bốc thăm/công bố map hoặc nhận bài GitHub.
    </Alert>
    <Panel title={`Giải ${LEVEL_LABELS[config.level]} · ${ids.length} đội`} subtitle="Điều lệ Campus: tối đa 56 đội; roster và seed lưu trên server.">
      <form className="tt-form" onSubmit={save}>
        <fieldset disabled={!editable || busy?.event}>
          <div className="tt-grid tt-grid--2">
            <Field label="Cấp giải"><select value={config.level} onChange={(e) => change('level', e.target.value)}>
              {Object.entries(LEVEL_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select></Field>
            <Field label="Cutoff nhận bài" hint={`Giờ trên máy bạn (${Intl.DateTimeFormat().resolvedOptions().timeZone}); server lưu UTC. Chưa có job thực thi cutoff.`}>
              <input type="datetime-local" value={cutoff} onChange={(e) => { setCutoff(e.target.value); setDirty(true); }} />
            </Field>
            <Field label="Phiên bản map pack"><input value={config.mapPackVersion} maxLength={80} onChange={(e) => change('mapPackVersion', e.target.value)} /></Field>
            <Field label="Số tuần / tháng"><input type="number" min="1" max="6" value={config.weeksPerMonth} onChange={(e) => change('weeksPerMonth', Number(e.target.value))} /></Field>
            <Field label="Số tháng / kỳ"><select value={config.monthsPerSemester} onChange={(e) => change('monthsPerSemester', Number(e.target.value))}><option value="3">3 tháng</option><option value="4">4 tháng</option></select></Field>
          </div>
          <p>Vé mặc định: 2 vé tháng / tuần; 2 vé kỳ / tháng. Tháng/kỳ phải xác minh thành tích và vé trước khi seed, không dùng thứ tự chọn đội.</p>
          {editable && <section><h3>Roster · {ids.length}/{MAX_OFFICIAL_TEAMS}</h3><div className="tt-picker">
            {teams.map((team) => <label className="tt-picker__item" key={team.id}>
              <input type="checkbox" checked={ids.includes(team.id)} disabled={!ids.includes(team.id) && ids.length >= MAX_OFFICIAL_TEAMS}
                onChange={(e) => { setIds((old) => e.target.checked ? [...old, team.id] : old.filter((id) => id !== team.id)); setDirty(true); }} />
              <span>{team.name}</span>
            </label>)}
          </div></section>}
          <div className="tt-grid tt-grid--2">{[['primaryMap', 'Map chính'], ['reserveMap', 'Map dự phòng']].map(([key, label]) => {
            const map = config[key];
            const known = SAMPLE_MAPS.find((item) => JSON.stringify(item.map) === JSON.stringify(map));
            return <section key={key}><Field label={label}><select value={known?.map.id ?? 'custom'} onChange={(e) => change(key, SAMPLE_MAPS.find((item) => item.map.id === e.target.value).map)}>
              {!known && <option value="custom">{map.id} (đã nhập)</option>}
              {SAMPLE_MAPS.map((item) => <option value={item.map.id} key={item.map.id}>{item.name}</option>)}
            </select></Field><MapPreview map={map} />{editable && <Field label={`Nhập ${label.toLowerCase()} · map.v1 JSON`}><input type="file" accept=".json,application/json" onChange={(e) => importMap(e, key)} /></Field>}</section>;
          })}</div>
        </fieldset>
        {error && <Alert tone="danger">{error}</Alert>}
        {editable && <div><button className="tt-btn tt-btn--primary" disabled={busy?.event}>{busy?.event ? 'Đang lưu…' : 'Lưu thiết lập chính thức'}</button>{dirty && <span className="tt-muted"> Có thay đổi chưa lưu; bảng dưới là bản dự kiến.</span>}
          <button type="button" className="tt-btn tt-btn--ghost" disabled={busy?.event} onClick={() => {
            if (dirty && !window.confirm('Bỏ thay đổi chưa lưu và nạp bản server đang hiển thị?')) return;
            setIds(event.entries.map((entry) => entry.participant_id)); setConfig(event.competition);
            setCutoff(localDate(event.competition.cutoff)); setBaseVersion(event.version); setDirty(false); setError('');
          }}>Nạp bản server · v{event.version}</button>
        </div>}
      </form>
    </Panel>
    <Panel title="Dự kiến theo điều lệ" subtitle="Chia bảng tái lập bằng seed; đây chưa phải kết quả bốc thăm đã khóa.">
      <p>{preview.groupCount} bảng · {preview.qualifierPairs} cặp / {preview.qualifierGames} ván vòng loại · {preview.finalists} đội chung kết · {preview.byes} bye.</p>
      <p>Ván thắng 1 / hòa 0,5; cặp thắng 3 / hòa 1 điểm bảng. Knockout 4 ván, tranh nhất 6; hòa thêm đúng 2 ván rồi ưu tiên seed. Có tranh ba, không dừng sớm.</p>
      <p>Profile đích: ott-campus.v1, 400 plies; worker hiện tại chưa chạy profile này.</p>
      {preview.blockers.map((blocker) => <Alert key={blocker} tone="warning">{blocker}</Alert>)}
      {preview.groups.length > 0 && <DataTable columns={['Bảng', 'Số đội', 'Đội (dự kiến)']} label="Dự kiến chia bảng">
        {preview.groups.map((group) => <tr key={group.name}><td>{group.name}</td><td>{group.participantIds.length}</td><td>{group.participantIds.map((id) => names.get(id) || id).join(', ')}</td></tr>)}
      </DataTable>}
      {!preview.groupCount && <p>Tháng/kỳ dùng bracket 8; 6 đội có 2 bye cho seed 1–2 sau khi xếp theo thành tích cấp vé. Chưa gán seed trong màn thiết lập.</p>}
    </Panel>
  </>;
}