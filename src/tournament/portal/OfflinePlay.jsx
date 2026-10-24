import React, { useState } from 'react';
import { OTTPlayerCard, OTTTurnBadge, OTTUnitButton } from '../../ui/ott-v2-ui-kit/react/index.mjs';
import Board from '../../components/Board.jsx';
import { PIECE_LABELS } from '../../game/constants.js';
import { GAME_PHASES, createUnplacedPieces } from '../../game/gameState.js';
import { SAMPLE_MAPS } from '../../game/sampleMaps.js';
import { createOfflineGame, offlinePlayer, placeOfflinePiece, removeOfflinePiece, fillOfflineSetup, confirmOfflineSetup, moveOfflinePiece } from '../../game/offlineGame.js';
import { Alert, Panel } from './TournamentUi.jsx';

export default function OfflinePlay({ onBack }) {
  const [mapId, setMapId] = useState(SAMPLE_MAPS[0].map.id);
  const [state, setState] = useState(() => createOfflineGame(SAMPLE_MAPS[0].map));
  const [type, setType] = useState('rock');
  const [error, setError] = useState('');
  const player = offlinePlayer(state);
  const setup = [GAME_PHASES.SETUP_RED, GAME_PHASES.SETUP_BLUE].includes(state.phase);
  const finished = state.phase === GAME_PHASES.FINISHED;
  const name = player === 'red' ? 'Đỏ' : 'Xanh';
  const sample = SAMPLE_MAPS.find((item) => item.map.id === mapId);
  // Hot-seat privacy only: local state is not an adversarial security boundary.
  const boardState = setup ? { ...state, pieces: Object.fromEntries(Object.entries(state.pieces).filter(([, p]) => p.player === player)) } : state;
  function update(action) {
    try { setState(action(state)); setError(''); } catch (err) { setError(err.message); }
  }
  function restart(id = mapId) {
    setMapId(id); setState(createOfflineGame(SAMPLE_MAPS.find((item) => item.map.id === id).map)); setError(''); setType('rock');
  }
  return <main className="tt-offline tt-content">
    <header className="tt-page-head"><div><button className="tt-back" onClick={onBack}>← Đăng nhập</button><h1 className="tt-page-title">Chơi offline</h1><p className="tt-muted">Hai người cùng máy · Không cần tài khoản hoặc API</p></div></header>
    <div className="tt-offline__layout">
      <Board key={`${mapId}-${state.phase}`} gameState={boardState} role={player} selectedSetupType={type}
        onPlacePieceInSetup={(id, square) => update((s) => placeOfflinePiece(s, id, square))}
        onRemovePieceInSetup={(id) => update((s) => removeOfflinePiece(s, id))}
        onMakeMove={(id, to) => update((s) => moveOfflinePiece(s, id, to))} />
      <aside className="tt-stack">
        {['red', 'blue'].map((team) => <OTTPlayerCard key={team} team={team} name={team === 'red' ? 'Đội Đỏ' : 'Đội Xanh'} active={!finished && player === team} count={Object.values(state.pieces).filter((p) => p.player === team && p.alive).length} status={setup ? 'Xếp quân' : finished ? 'Kết thúc' : undefined} />)}
        <Panel title="Bàn chơi">
          <label className="tt-field">Map mẫu<select aria-label="Map mẫu" value={mapId} onChange={(e) => { if (window.confirm('Đổi map sẽ bắt đầu ván mới?')) restart(e.target.value); }}>{SAMPLE_MAPS.map((item) => <option key={item.map.id} value={item.map.id}>{item.name}</option>)}</select></label>
          <p className="tt-small">{sample.description}</p>
          <a className="tt-btn tt-btn--info" download={`${state.map.id}.json`} href={`data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(state.map, null, 2))}`}>Tải map mẫu JSON</a>
          <p className="tt-small tt-muted">Lửa cản Bao · Nước cản Kéo · Bụi cây cản Búa · Vực cản tất cả. Luật áp dụng cả khi xếp và đi quân.</p>
          <OTTTurnBadge team={player} number={state.history.length + 1} label={finished ? (state.winner ? `${state.winner === 'red' ? 'Đỏ' : 'Xanh'} thắng` : 'Hòa') : `${name} ${setup ? 'xếp quân' : 'đến lượt'}`} />
          {finished && <p>{state.winReason}</p>}
          {setup && <><div className="tt-offline__pieces">{Object.entries(PIECE_LABELS).map(([key, label]) => {
            const remaining = createUnplacedPieces(player).filter((p) => p.type === key && !state.pieces[p.id]).length;
            return <OTTUnitButton key={key} type={key} team={player} count={remaining} selected={type === key} disabled={!remaining} onClick={setType} />;
          })}</div><p className="tt-small tt-muted">Offline cho xếp tay: chọn quân rồi chọn ô sân nhà hợp lệ, hoặc dùng Xếp nhanh. Hai người lần lượt thao tác cùng máy; đội hình đối phương được ẩn trên bàn đến khi cả hai xác nhận. Khi thi bot, phải viết sẵn cả logic xếp quân và đi quân trong file Python, không xếp tay thay bot.</p>
            <div className="tt-form__actions"><button className="tt-btn tt-btn--info" onClick={() => update(fillOfflineSetup)}>Xếp nhanh</button><button className="tt-btn tt-btn--success" onClick={() => update(confirmOfflineSetup)}>Xác nhận</button></div></>}
          {error && <Alert tone="danger">{error}</Alert>}
          <button className="tt-btn tt-btn--warning" onClick={() => { if (window.confirm('Bắt đầu ván mới?')) restart(); }}>Ván mới</button>
        </Panel>
        <Panel title="Nước đi"><ol className="tt-offline__history">{state.history.map((text, i) => <li key={i}>{text}</li>)}</ol>{!state.history.length && <p className="tt-muted">Chưa có nước đi.</p>}</Panel>
      </aside>
    </div>
  </main>;
}