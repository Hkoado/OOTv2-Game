import React, { useMemo, useState } from 'react';
import { Check, Trophy, X } from 'lucide-react';
import { Alert, Badge, ConfirmAction, Field, Panel, Progress } from './TournamentUi.jsx';
import EventList from './EventList.jsx';
import { eligibleTeams, FORMAT, isEventRunning, teamBotState } from './tournamentView.js';

export default function EventsPage({ account, events, teams, actions, busy, onOpenEvent }) {
  const isAdmin = account.role === 'admin';
  const [name, setName] = useState('');
  const [selected, setSelected] = useState([]);
  const [formError, setFormError] = useState('');
  const eligible = useMemo(() => eligibleTeams(teams), [teams]);
  const selectedTeams = eligible.filter((team) => selected.includes(team.id));

  function toggle(teamId) {
    setFormError('');
    setSelected((current) => {
      if (current.includes(teamId)) return current.filter((id) => id !== teamId);
      if (current.length >= FORMAT.teams) {
        setFormError(`Chỉ chọn đúng ${FORMAT.teams} đội. Bỏ một đội trước khi thêm đội khác.`);
        return current;
      }
      return [...current, teamId];
    });
  }

  async function createEvent(event) {
    event.preventDefault();
    if (name.trim().length < 1) {
      setFormError('Đặt tên giải trước khi tạo.');
      return;
    }
    if (selected.length !== FORMAT.teams) {
      setFormError(`Cần chọn đúng ${FORMAT.teams} đội có bot hợp lệ.`);
      return;
    }
    const created = await actions.createEvent({ name: name.trim(), participantIds: selected });
    if (created) {
      setName('');
      setSelected([]);
      setFormError('');
    }
  }

  const running = events.filter((event) => isEventRunning(event.status)).length;

  return (
    <>
      <header className="tt-page-head">
        <div>
          <p className="tt-eyebrow">{isAdmin ? 'Ban tổ chức · điều hành' : 'Đội thi · lịch đấu'}</p>
          <h1 className="tt-page-title">{isAdmin ? 'Quản lý giải đấu' : 'Giải đấu của đội'}</h1>
          <p className="tt-page-lead">
            {isAdmin
              ? `Mỗi giải gồm ${FORMAT.teams} đội: ${FORMAT.groupGames} ván vòng bảng, ${FORMAT.semifinalGames} ván bán kết và ${FORMAT.finalGames} ván chung kết. Bắt đầu giải sẽ khóa bài nộp của các đội tham gia.`
              : `Đội chỉ thấy giải mình tham gia. ${FORMAT.totalGames} ván mỗi giải, kết quả và replay cập nhật khi worker chấm xong từng ván.`}
          </p>
        </div>
        <div className="tt-page-actions">
          <Badge tone={running ? 'live' : 'neutral'} dot={running > 0}>{running ? `${running} giải đang chạy` : 'Không có giải chạy'}</Badge>
          <Badge tone="neutral">{events.length} giải</Badge>
        </div>
      </header>

      {isAdmin && (
        <Panel
          title="Tạo giải mới"
          subtitle={`Chỉ đội có ít nhất một bot hợp lệ mới được chọn. Hiện có ${eligible.length}/${teams.length} đội đủ điều kiện.`}
          actions={<Badge tone={selected.length === FORMAT.teams ? 'success' : 'warning'}>{selected.length}/{FORMAT.teams} đội</Badge>}
        >
          <form className="tt-form" onSubmit={createEvent}>
            <Field label="Tên giải" hint="Tối đa 80 ký tự. Ví dụ: OOTv2 Campus Cup · Tuần 4.">
              <input
                name="name"
                maxLength={80}
                required
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  setFormError('');
                }}
                placeholder="OOTv2 Campus Cup · Tuần 4"
              />
            </Field>

            {eligible.length < FORMAT.teams ? (
              <Alert tone="warning" title={`Chưa đủ ${FORMAT.teams} đội có bot hợp lệ`}>
                Hiện có {eligible.length} đội đủ điều kiện. Nhắc các đội còn lại nộp bot trước khi tạo giải.
              </Alert>
            ) : (
              <div className="tt-picker" role="group" aria-label="Chọn đội tham gia giải">
                {eligible.map((team) => {
                  const checked = selected.includes(team.id);
                  const state = teamBotState(team);
                  return (
                    <label key={team.id} className={`tt-picker__item${checked ? ' is-checked' : ''}`}>
                      <input type="checkbox" checked={checked} onChange={() => toggle(team.id)} />
                      <span className="tt-picker__check" aria-hidden="true">{checked ? <Check size={14} /> : null}</span>
                      <span className="tt-picker__text">
                        <strong>{team.name}</strong>
                        <em><Badge tone={state.tone}>{state.label}</Badge></em>
                      </span>
                    </label>
                  );
                })}
              </div>
            )}

            <Progress value={(selected.length / FORMAT.teams) * 100} label="Đội đã chọn" />

            {selectedTeams.length > 0 && (
              <div className="tt-chips">
                {selectedTeams.map((team) => (
                  <button key={team.id} type="button" className="tt-chip" onClick={() => toggle(team.id)} aria-label={`Bỏ ${team.name}`}>
                    {team.name}
                    <X size={12} aria-hidden="true" />
                  </button>
                ))}
              </div>
            )}

            {formError && <Alert tone="danger">{formError}</Alert>}

            <div className="tt-form__actions">
              <button type="submit" className="tt-btn tt-btn--primary" disabled={busy?.event || selected.length !== FORMAT.teams}>
                <Trophy size={16} aria-hidden="true" />
                {busy?.event ? 'Đang tạo giải…' : 'Tạo giải & xếp lịch'}
              </button>
              <span className="tt-muted">Seed được server sinh ngẫu nhiên và lưu lại để tái lập.</span>
            </div>
          </form>
        </Panel>
      )}

      <Panel
        title={isAdmin ? 'Tất cả giải' : 'Giải đội tham gia'}
        subtitle={events.length ? `${events.length} giải · mới nhất trước` : 'Chưa có dữ liệu'}
      >
        <EventList
          events={events}
          onOpen={onOpenEvent}
          renderActions={
            isAdmin
              ? (event) => (event.status === 'draft' ? (
                <ConfirmAction
                  label="Bắt đầu giải"
                  confirmLabel={`Khóa bài ${FORMAT.teams} đội`}
                  tone="primary"
                  busy={busy?.start}
                  onConfirm={() => actions.startEvent(event.id)}
                />
              ) : null)
              : undefined
          }
          emptyTitle={isAdmin ? 'Chưa tạo giải nào' : 'Đội chưa tham gia giải nào'}
          emptyDescription={isAdmin
            ? `Khi có đủ ${FORMAT.teams} đội với bot hợp lệ, tạo giải ở biểu mẫu phía trên để sinh ${FORMAT.totalGames} ván.`
            : 'BTC sẽ thêm đội vào giải khi mùa giải bắt đầu.'}
        />
      </Panel>
    </>
  );
}
