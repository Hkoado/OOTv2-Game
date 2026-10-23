import React, { useEffect, useMemo, useState } from 'react';
import { LEVEL_LABELS, MAX_OFFICIAL_TEAMS, competitionPreview, normalizeCompetition } from '../../game/competition.js';
import { SAMPLE_MAPS } from '../../game/sampleMaps.js';
import { Alert, Badge, DataTable, Field, Panel } from './TournamentUi.jsx';
import MapPreview from './MapPreview.jsx';
import {
  detectVersionConflict,
  formatGroupSummary,
  parseCutoffDetails,
  toLocalDatetimeInput,
} from './officialSetupView.js';

export default function OfficialSetupPanel({ event, teams, actions, busy, admin }) {
  const [ids, setIds] = useState(() => event.entries.map((entry) => entry.participant_id));
  const [config, setConfig] = useState(event.competition);
  const [cutoff, setCutoff] = useState(() => toLocalDatetimeInput(event.competition.cutoff));
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);
  const [baseVersion, setBaseVersion] = useState(event.version);

  const editable = admin && event.status === 'draft';

  // Automatically keep local draft in sync with server polling IF user has not made local edits.
  useEffect(() => {
    if (!dirty) {
      setIds(event.entries.map((entry) => entry.participant_id));
      setConfig(event.competition);
      setCutoff(toLocalDatetimeInput(event.competition.cutoff));
      setBaseVersion(event.version);
      setError('');
    }
  }, [event, dirty]);

  const change = (key, value) => {
    setConfig((old) => ({ ...old, [key]: value }));
    setDirty(true);
  };

  const cutoffDetails = useMemo(() => parseCutoffDetails(cutoff), [cutoff]);
  const conflict = useMemo(
    () => detectVersionConflict(baseVersion, event.version, dirty),
    [baseVersion, event.version, dirty]
  );

  let preview;
  try {
    preview = competitionPreview(ids, Number(event.seed), config);
  } catch {
    preview = event.setup_preview;
  }

  const groupSummary = useMemo(() => formatGroupSummary(preview.groups), [preview.groups]);

  const names = useMemo(
    () =>
      new Map([
        ...event.entries.map((entry) => [entry.participant_id, entry.participant_name]),
        ...teams.map((team) => [team.id, team.name]),
      ]),
    [event.entries, teams]
  );

  async function save(e) {
    e.preventDefault();
    setError('');

    let competition;
    try {
      competition = normalizeCompetition({
        ...config,
        cutoff: cutoffDetails.utcIso,
      });
    } catch (err) {
      setError(err.message);
      return;
    }

    try {
      const ok = await actions.saveEvent(event.id, {
        participantIds: ids,
        competition,
        expectedVersion: baseVersion,
      });
      if (ok) {
        setConfig(competition);
        setBaseVersion((version) => version + 1);
        setDirty(false);
        setError('');
      } else {
        setError(
          `Không thể lưu thiết lập giải. Có thể do xung đột phiên bản (v${baseVersion} vs v${event.version}) hoặc lỗi kết nối. Hãy kiểm tra hoặc nạp lại bản server.`
        );
      }
    } catch (err) {
      setError(err.message || 'Lỗi khi lưu thiết lập giải.');
    }
  }

  function reloadFromServer() {
    if (dirty && !window.confirm('Bỏ các thay đổi chưa lưu và nạp lại bản mới nhất từ server?')) return;
    setIds(event.entries.map((entry) => entry.participant_id));
    setConfig(event.competition);
    setCutoff(toLocalDatetimeInput(event.competition.cutoff));
    setBaseVersion(event.version);
    setDirty(false);
    setError('');
  }

  async function importMap(e, key) {
    try {
      const file = e.target.files?.[0];
      if (!file) return;
      if (file.size > 16384) throw new Error('File map JSON tối đa 16 KiB.');
      const normalized = normalizeCompetition({ ...config, [key]: JSON.parse(await file.text()) });
      change(key, normalized[key]);
      setError('');
    } catch (err) {
      setError(err.message);
    }
    e.target.value = '';
  }

  return (
    <>
      <Alert tone="warning" title="Thiết lập giải chính thức · không phải giải MVP 8 đội">
        {preview.executionBlocker} Đây là dự kiến cấu hình theo điều lệ, chưa khóa roster/bốc thăm, chưa công bố map pack hoặc nhận bài qua GitHub.
      </Alert>

      {conflict.hasConflict && (
        <Alert tone="danger" title="Phát hiện xung đột phiên bản">
          {conflict.message}
          <div className="tt-form__actions" style={{ marginTop: '0.5rem' }}>
            <button type="button" className="tt-btn tt-btn--sm" onClick={reloadFromServer}>
              Nạp lại bản server (v{event.version})
            </button>
          </div>
        </Alert>
      )}

      <Panel
        title={`Giải ${LEVEL_LABELS[config.level] || config.level} · ${ids.length} đội tham gia`}
        subtitle="Điều lệ Campus: tối đa 56 đội; cấu hình, roster và seed lưu trữ trên server."
        actions={
          <Badge tone={preview.setupReady ? 'success' : 'warning'}>
            {preview.setupReady ? 'Thiết lập đầy đủ' : 'Chưa hoàn tất'}
          </Badge>
        }
      >
        <form className="tt-form" onSubmit={save}>
          <fieldset disabled={!editable || busy?.event}>
            <div className="tt-grid tt-grid--2">
              <Field label="Cấp giải">
                <select value={config.level} onChange={(e) => change('level', e.target.value)}>
                  {Object.entries(LEVEL_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>

              <Field
                label="Cutoff nhận bài"
                hint={`Giờ địa phương máy bạn (${cutoffDetails.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone}); server lưu UTC.`}
              >
                <input
                  type="datetime-local"
                  value={cutoff}
                  onChange={(e) => {
                    setCutoff(e.target.value);
                    setDirty(true);
                  }}
                />
                <div className="tt-cutoff-preview" style={{ fontSize: '0.85rem', marginTop: '0.35rem' }}>
                  {cutoffDetails.utcIso ? (
                    <>
                      <div>
                        <strong>Địa phương:</strong> {cutoffDetails.localDisplay} ({cutoffDetails.timeZone})
                      </div>
                      <div>
                        <strong>Chuẩn UTC:</strong> <code>{cutoffDetails.utcIso}</code>
                      </div>
                      {cutoffDetails.isPast && (
                        <div style={{ color: 'var(--tt-danger, #e53e3e)', marginTop: '0.2rem' }}>
                          ⚠️ Thời điểm cutoff này đã trôi qua so với giờ hiện tại của bạn.
                        </div>
                      )}
                    </>
                  ) : (
                    <span className="tt-muted">{cutoffDetails.hint}</span>
                  )}
                </div>
              </Field>

              <Field
                label="Phiên bản map pack công bố"
                hint="Nhãn phiên bản map pack sẽ gắn vào snapshot vòng đấu (ví dụ: pack-v1.0 hoặc week-1-official)."
              >
                <input
                  value={config.mapPackVersion}
                  maxLength={80}
                  placeholder="ví dụ: week-1-official"
                  onChange={(e) => change('mapPackVersion', e.target.value)}
                />
              </Field>

              <Field label="Số tuần / tháng" hint="Áp dụng khi tính chu kỳ giải tháng (1 đến 6 tuần).">
                <input
                  type="number"
                  min="1"
                  max="6"
                  value={config.weeksPerMonth}
                  onChange={(e) => change('weeksPerMonth', Number(e.target.value))}
                />
              </Field>

              <Field label="Số tháng / kỳ" hint="Kỳ 3 tháng cho phép ngoại lệ 6 đội với 2 bye. Kỳ 4 tháng yêu cầu đủ 8 đội.">
                <select
                  value={config.monthsPerSemester}
                  onChange={(e) => change('monthsPerSemester', Number(e.target.value))}
                >
                  <option value="3">3 tháng (cho phép ngoại lệ 6 đội có 2 bye)</option>
                  <option value="4">4 tháng (chuẩn 8 đội)</option>
                </select>
              </Field>
            </div>

            <p className="tt-muted">
              Vé mặc định: 2 vé tháng / tuần; 2 vé kỳ / tháng. Vòng chung kết tháng và kỳ bắt buộc xác minh thành tích
              cấp vé trước khi xếp hạt giống, không dùng thứ tự chọn danh sách đội.
            </p>

            {editable && (
              <section>
                <h3>
                  Roster thi đấu · {ids.length}/{MAX_OFFICIAL_TEAMS} đội
                </h3>
                <p className="tt-muted" style={{ marginBottom: '0.5rem' }}>
                  Chọn các đội tham gia giải. Thứ tự tick không làm thay đổi kết quả bốc thăm (server sắp xếp danh sách theo canonical ID trước khi bốc).
                </p>
                <div className="tt-picker">
                  {teams.map((team) => (
                    <label className="tt-picker__item" key={team.id}>
                      <input
                        type="checkbox"
                        checked={ids.includes(team.id)}
                        disabled={!ids.includes(team.id) && ids.length >= MAX_OFFICIAL_TEAMS}
                        onChange={(e) => {
                          setIds((old) =>
                            e.target.checked ? [...old, team.id] : old.filter((id) => id !== team.id)
                          );
                          setDirty(true);
                        }}
                      />
                      <span>{team.name}</span>
                    </label>
                  ))}
                </div>
              </section>
            )}

            <div className="tt-grid tt-grid--2">
              {[
                ['primaryMap', 'Map chính'],
                ['reserveMap', 'Map dự phòng'],
              ].map(([key, label]) => {
                const map = config[key];
                const known = SAMPLE_MAPS.find((item) => JSON.stringify(item.map) === JSON.stringify(map));
                return (
                  <section key={key}>
                    <Field label={label}>
                      <select
                        value={known?.map.id ?? 'custom'}
                        onChange={(e) => {
                          const found = SAMPLE_MAPS.find((item) => item.map.id === e.target.value);
                          if (found) change(key, found.map);
                        }}
                      >
                        {!known && <option value="custom">{map.id} (bản đồ tùy chỉnh)</option>}
                        {SAMPLE_MAPS.map((item) => (
                          <option value={item.map.id} key={item.map.id}>
                            {item.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <MapPreview map={map} />
                    {editable && (
                      <Field label={`Nhập ${label.toLowerCase()} từ file JSON (map.v1)`}>
                        <input type="file" accept=".json,application/json" onChange={(e) => importMap(e, key)} />
                      </Field>
                    )}
                  </section>
                );
              })}
            </div>
          </fieldset>

          {error && <Alert tone="danger">{error}</Alert>}

          {editable && (
            <div className="tt-form__actions" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <button className="tt-btn tt-btn--primary" disabled={busy?.event}>
                {busy?.event ? 'Đang lưu…' : 'Lưu thiết lập chính thức'}
              </button>
              {dirty && <span className="tt-muted">Có thay đổi chưa lưu (bảng dự kiến hiển thị theo bản nháp).</span>}
              <button
                type="button"
                className="tt-btn tt-btn--ghost"
                disabled={busy?.event}
                onClick={reloadFromServer}
              >
                Nạp bản server · v{event.version}
              </button>
            </div>
          )}
        </form>
      </Panel>

      <Panel
        title="Dự kiến phân bảng & lịch theo điều lệ"
        subtitle="Tính toán xác định từ seed lưu của giải và roster canonical. Đây CHƯA PHẢI kết quả bốc thăm đã khóa."
        actions={<Badge tone="neutral">{groupSummary.label}</Badge>}
      >
        <p>
          <strong>{preview.groupCount}</strong> bảng · <strong>{preview.qualifierPairs}</strong> cặp /{' '}
          <strong>{preview.qualifierGames}</strong> ván vòng loại (2 ván đổi màu Đỏ/Xanh mỗi cặp) ·{' '}
          <strong>{preview.finalists}</strong> đội vào chung kết · <strong>{preview.byes}</strong> suất bye.
        </p>
        <p className="tt-muted">
          Cách tính điểm: Ván thắng 1 / hòa 0,5 / thua 0; Cặp thắng 3 / hòa 1 / thua 0 điểm bảng. Knockout bán kết 4 ván,
          chung kết 6 ván; hòa thêm đúng 2 ván phụ rồi mới xét ưu tiên hạt giống. Có ván tranh hạng ba, không kết thúc sớm.
        </p>
        <p className="tt-muted">
          Profile thi đấu: <code>{preview.rulesVersion || 'ott-campus.v1'}</code>, tối đa 400 plies; worker MVP hiện tại chưa chạy profile này.
        </p>

        {preview.blockers.map((blocker) => (
          <Alert key={blocker} tone="warning">
            {blocker}
          </Alert>
        ))}

        {preview.groups.length > 0 && (
          <>
            <div style={{ marginBottom: '0.5rem' }}>
              <span className="tt-muted">{groupSummary.details}</span>
            </div>
            <DataTable columns={['Bảng', 'Số đội', 'Danh sách đội (dự kiến theo seed)']} label="Dự kiến chia bảng">
              {preview.groups.map((group) => (
                <tr key={group.name}>
                  <td>
                    <strong>Bảng {group.name}</strong>
                  </td>
                  <td>{group.participantIds.length} đội</td>
                  <td>{group.participantIds.map((id) => names.get(id) || id).join(', ')}</td>
                </tr>
              ))}
            </DataTable>
          </>
        )}

        {!preview.groupCount && (
          <p className="tt-muted">
            Giải tháng / kỳ sử dụng bracket loại trực tiếp 8 đội. Ngoại lệ 6 đội (kỳ 3 tháng) có 2 bye cho seed 1–2 sau khi
            xếp hạng thành tích cấp vé. Thứ tự hạt giống chính thức sẽ được cấp trước khi bốc thăm knockout.
          </p>
        )}
      </Panel>
    </>
  );
}
