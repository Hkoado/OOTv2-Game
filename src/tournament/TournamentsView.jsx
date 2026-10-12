import React, { useState } from 'react';
import { Play, PlusCircle, RefreshCw, Trophy } from 'lucide-react';
import { labelOf, TOURNAMENT_STATUS_LABELS } from './labels.js';

/**
 * Danh sách giải + form tạo giải 8 đội (chỉ local/dev, khóa bằng `x-admin-key`).
 */
export default function TournamentsView({
  tournaments,
  participants,
  busy,
  onCreateTournament,
  onStartTournament,
  onOpenTournament,
  onRefresh,
}) {
  const [name, setName] = useState('');
  const [selected, setSelected] = useState([]);

  const eligible = participants.filter((participant) => participant.latest_valid_submission_id);
  const ready = selected.length === 8;

  function toggle(participantId) {
    setSelected((current) =>
      current.includes(participantId)
        ? current.filter((id) => id !== participantId)
        : [...current, participantId]
    );
  }

  return (
    <div className="tournament-columns">
      <section className="card panel">
        <div className="panel__head">
          <h3 className="panel__title">Tạo giải đấu 8 bot</h3>
          <span className="chip chip--neutral">Đã chọn {selected.length}/8</span>
        </div>

        <input
          className="text-input text-input--wide"
          placeholder="Tên giải (1–80 ký tự)"
          value={name}
          maxLength={80}
          onChange={(event) => setName(event.target.value)}
        />

        <div className="pick-list">
          {eligible.length === 0 && (
            <p className="muted text-xs">
              Chưa có đội nào có bot hợp lệ. Sang tab “Đội & Bot” để tạo đội và upload file .py.
            </p>
          )}
          {eligible.map((participant) => (
            <label key={participant.id} className="pick-item">
              <input
                type="checkbox"
                checked={selected.includes(participant.id)}
                onChange={() => toggle(participant.id)}
              />
              <span>{participant.name}</span>
            </label>
          ))}
        </div>

        <button
          type="button"
          className="btn"
          disabled={busy || !ready || name.trim().length < 1}
          onClick={async () => {
            const created = await onCreateTournament(name, selected);
            if (created) {
              setName('');
              setSelected([]);
            }
          }}
        >
          <PlusCircle className="w-4 h-4" /> Tạo giải (draft)
        </button>
        <p className="panel__hint">
          Chia bảng theo seed: A = 1,4,5,8 · B = 2,3,6,7. Mỗi cặp đấu 2 lượt (đổi màu), tổng 24 game vòng
          bảng, rồi bán kết và chung kết.
        </p>
      </section>

      <section className="card panel">
        <div className="panel__head">
          <h3 className="panel__title">Danh sách giải ({tournaments.length})</h3>
          <button type="button" className="btn btn--secondary btn--small" onClick={onRefresh} disabled={busy}>
            <RefreshCw className="w-3.5 h-3.5" /> Làm mới
          </button>
        </div>

        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Giải</th>
                <th>Trạng thái</th>
                <th>Tiến độ game</th>
                <th>Hành động</th>
              </tr>
            </thead>
            <tbody>
              {tournaments.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted">
                    Chưa có giải nào.
                  </td>
                </tr>
              )}
              {tournaments.map((tournament) => (
                <tr key={tournament.id}>
                  <td className="cell-name">{tournament.name}</td>
                  <td>
                    <span className={`chip chip--${tournament.status === 'finished' ? 'ok' : 'neutral'}`}>
                      {labelOf(TOURNAMENT_STATUS_LABELS, tournament.status)}
                    </span>
                  </td>
                  <td>
                    {tournament.match_finished ?? 0}/{tournament.match_total ?? 0}
                  </td>
                  <td>
                    <div className="row-actions">
                      <button
                        type="button"
                        className="btn btn--secondary btn--small"
                        onClick={() => onOpenTournament(tournament.id)}
                      >
                        <Trophy className="w-3.5 h-3.5" /> Xem bảng đấu
                      </button>
                      {tournament.status === 'draft' && (
                        <button
                          type="button"
                          className="btn btn--small"
                          disabled={busy}
                          onClick={() => onStartTournament(tournament.id)}
                        >
                          <Play className="w-3.5 h-3.5" /> Start
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="panel__hint">
          Sau khi Start, chạy worker ở terminal riêng (<code>npm run dev:worker</code>) để chạy tuần tự từng
          game; trang này tự làm mới mỗi 3 giây.
        </p>
      </section>
    </div>
  );
}
