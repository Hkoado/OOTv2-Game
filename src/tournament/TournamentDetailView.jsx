import React from 'react';
import { ArrowLeft, Crown, Film, Play, RefreshCw } from 'lucide-react';
import ReplayBoard from './ReplayBoard.jsx';
import {
  MATCH_STATUS_LABELS,
  REASON_LABELS,
  RESULT_LABELS,
  TOURNAMENT_STATUS_LABELS,
  labelOf,
} from './labels.js';

/** Bảng xếp hạng một bảng đấu (3 điểm thắng / 1 điểm hòa / 0 điểm thua). */
function StandingsTable({ groupName, rows }) {
  return (
    <div className="standings">
      <h4 className="standings__title">Bảng {groupName}</h4>
      <table className="data-table data-table--compact">
        <thead>
          <tr>
            <th>Hạng</th>
            <th>Đội</th>
            <th>Trận</th>
            <th>Thắng</th>
            <th>Hòa</th>
            <th>Thua</th>
            <th>HS</th>
            <th>Điểm</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={8} className="muted">
                Chưa chia bảng (giải chưa start).
              </td>
            </tr>
          )}
          {rows.map((row, index) => (
            <tr key={row.entry_id} className={index < 2 && rows.length > 1 ? 'row--qualified' : ''}>
              <td>{index + 1}</td>
              <td className="cell-name">{row.name}</td>
              <td>{row.played}</td>
              <td>{row.wins}</td>
              <td>{row.draws}</td>
              <td>{row.losses}</td>
              <td>{row.win_loss_difference}</td>
              <td>
                <strong>{row.points}</strong>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Thẻ một series bán kết/chung kết: 2 lượt, đội thắng series được tô nổi. */
function SeriesCard({ title, series, onOpenReplay }) {
  if (!series) {
    return (
      <div className="series-card series-card--empty">
        <h4 className="series-card__title">{title}</h4>
        <p className="muted text-xs">Chưa xác định (đang chờ kết quả vòng trước).</p>
      </div>
    );
  }

  return (
    <div className="series-card">
      <h4 className="series-card__title">
        {title} <span className="muted text-xs">{series.series_id}</span>
      </h4>
      <div className="series-card__sides">
        {series.sides.map((side) => (
          <div
            key={side.entry_id}
            className={`series-side ${series.winner_entry_id === side.entry_id ? 'series-side--winner' : ''}`}
          >
            <span className="series-side__name">{side.name}</span>
            <span className="series-side__score">{series.games_won[side.entry_id] ?? 0}</span>
            <span className="muted text-xs">seed {side.seed_order}</span>
          </div>
        ))}
      </div>
      <ul className="series-games">
        {series.games.map((game) => (
          <li key={game.id}>
            <span className="muted text-xs">Lượt {game.game_no}</span>
            <span className="text-xs">
              {game.red.name} (Đỏ) vs {game.blue.name} (Xanh)
            </span>
            <span className={`chip chip--${game.status === 'finished' ? 'ok' : 'neutral'}`}>
              {labelOf(MATCH_STATUS_LABELS, game.status)}
            </span>
            {game.status === 'finished' && (
              <span className="text-xs">
                {labelOf(RESULT_LABELS, game.result)} · {labelOf(REASON_LABELS, game.reason)}
              </span>
            )}
            <button
              type="button"
              className="btn btn--secondary btn--small"
              disabled={game.status !== 'finished'}
              onClick={() => onOpenReplay(game.id)}
            >
              <Film className="w-3.5 h-3.5" /> Replay
            </button>
          </li>
        ))}
      </ul>
      {series.complete ? (
        <p className="text-xs">
          Đội đi tiếp: <strong>{series.winner_name}</strong>
        </p>
      ) : (
        <p className="text-xs muted">Đang chờ hoàn tất series…</p>
      )}
    </div>
  );
}


/** Trang chi tiết giải: bracket, hai bảng xếp hạng, danh sách game và replay. */
export default function TournamentDetailView({
  detail,
  standings,
  bracket,
  matches,
  busy,
  replay,
  replayError,
  onBack,
  onStart,
  onRefresh,
  onOpenReplay,
  onCloseReplay,
}) {
  const groups = standings?.groups || { A: [], B: [] };
  const champion = bracket?.champion || null;
  const counts = detail?.match_counts || { total: 0, finished: 0 };

  return (
    <div className="tournament-detail">
      <div className="panel__head">
        <div className="detail-title">
          <button type="button" className="btn btn--secondary btn--small" onClick={onBack}>
            <ArrowLeft className="w-3.5 h-3.5" /> Danh sách giải
          </button>
          <h3 className="panel__title">{detail?.name || 'Đang tải…'}</h3>
          <span className={`chip chip--${detail?.status === 'finished' ? 'ok' : 'neutral'}`}>
            {labelOf(TOURNAMENT_STATUS_LABELS, detail?.status)}
          </span>
          <span className="chip chip--neutral">
            {counts.finished}/{counts.total} game
          </span>
        </div>
        <div className="row-actions">
          <button type="button" className="btn btn--secondary btn--small" onClick={onRefresh} disabled={busy}>
            <RefreshCw className="w-3.5 h-3.5" /> Làm mới
          </button>
          {detail?.status === 'draft' && (
            <button type="button" className="btn btn--small" disabled={busy} onClick={onStart}>
              <Play className="w-3.5 h-3.5" /> Start giải
            </button>
          )}
        </div>
      </div>

      {champion && (
        <div className="champion-banner">
          <Crown className="w-5 h-5" />
          <span>
            Vô địch: <strong>{champion.name}</strong>
          </span>
        </div>
      )}

      {replayError && <p className="notice notice--warn">{replayError}</p>}
      {replay && (
        <section className="card panel">
          <div className="panel__head">
            <h3 className="panel__title">Xem lại trận đấu</h3>
            <button type="button" className="btn btn--secondary btn--small" onClick={onCloseReplay}>
              Đóng replay
            </button>
          </div>
          <ReplayBoard match={replay.match} replay={replay.data} />
        </section>
      )}

      <section className="card panel">
        <h3 className="panel__title">Bracket bán kết → chung kết</h3>
        <div className="bracket">
          {[0, 1].map((index) => (
            <SeriesCard
              key={`sf-${index}`}
              title={`Bán kết ${index + 1}`}
              series={(bracket?.semifinals || [])[index] || null}
              onOpenReplay={onOpenReplay}
            />
          ))}
          <SeriesCard title="Chung kết" series={bracket?.final || null} onOpenReplay={onOpenReplay} />
        </div>
        <p className="panel__hint">
          Bán kết: A1–B2 và B1–A2 (2 lượt, đổi màu). Hòa series thì đội có seed nhỏ hơn đi tiếp.
        </p>
      </section>


      <section className="card panel">
        <h3 className="panel__title">Bảng xếp hạng vòng bảng</h3>
        <div className="standings-grid">
          <StandingsTable groupName="A" rows={groups.A || []} />
          <StandingsTable groupName="B" rows={groups.B || []} />
        </div>
        <p className="panel__hint">
          Điểm: thắng 3 · hòa 1 · thua 0. Ưu tiên xếp hạng: điểm → số thắng → hiệu số → seed.
          {standings?.group_stage_complete ? ' Vòng bảng đã hoàn tất.' : ' Vòng bảng đang diễn ra.'}
        </p>
      </section>

      <section className="card panel">
        <h3 className="panel__title">Danh sách game ({matches.length})</h3>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Vòng</th>
                <th>Series</th>
                <th>Lượt</th>
                <th>Đỏ</th>
                <th>Xanh</th>
                <th>Trạng thái</th>
                <th>Kết quả</th>
                <th>Nước</th>
                <th>Replay</th>
              </tr>
            </thead>
            <tbody>
              {matches.length === 0 && (
                <tr>
                  <td colSpan={9} className="muted">
                    Chưa có game nào (start giải để sinh lịch đấu).
                  </td>
                </tr>
              )}
              {matches.map((match) => (
                <tr key={match.id}>
                  <td>{labelOf({ group: 'Bảng', semifinal: 'BK', final: 'CK' }, match.stage, match.stage)}</td>
                  <td className="cell-mono">{match.series_id}</td>
                  <td>{match.game_no}</td>
                  <td className="cell-name">{match.red.name}</td>
                  <td className="cell-name">{match.blue.name}</td>
                  <td>
                    <span className={`chip chip--${match.status === 'finished' ? 'ok' : 'neutral'}`}>
                      {labelOf(MATCH_STATUS_LABELS, match.status)}
                    </span>
                  </td>
                  <td>
                    {match.status === 'finished'
                      ? `${labelOf(RESULT_LABELS, match.result)} (${labelOf(REASON_LABELS, match.reason)})`
                      : '—'}
                  </td>
                  <td>{match.ply_count ?? '—'}</td>
                  <td>
                    <button
                      type="button"
                      className="btn btn--secondary btn--small"
                      disabled={match.status !== 'finished'}
                      onClick={() => onOpenReplay(match.id)}
                    >
                      <Film className="w-3.5 h-3.5" /> Xem
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
