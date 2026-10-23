import React, { useState } from 'react';
import { FolderPlus } from 'lucide-react';
import { Field, Panel } from './TournamentUi.jsx';
import EventList from './EventList.jsx';
import { LEVEL_LABELS } from '../../game/competition.js';

export default function EventsPage({ account, events, actions, busy, onOpenEvent }) {
  const [name, setName] = useState('');
  const [level, setLevel] = useState('weekly');
  const admin = account.role === 'admin';
  async function create(event) {
    event.preventDefault();
    if (await actions.createEvent({ name: name.trim(), competition: { level } })) setName('');
  }
  return <>
    <header className="tt-page-head"><h1 className="tt-page-title">{admin ? 'Giải đấu' : 'Giải của đội'}</h1></header>
    {admin && <Panel title="Thiết lập giải chính thức" subtitle="Tuần / tháng / kỳ theo điều lệ Campus. Không tạo mới giải MVP 8 đội; chưa chạy scheduler chính thức.">
      <form className="tt-form" onSubmit={create}><Field label="Tên giải"><input name="name" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="Campus Cup · Tuần 1" /></Field>
        <Field label="Cấp giải"><select value={level} onChange={(e) => setLevel(e.target.value)}>{Object.entries(LEVEL_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
        <div><button className="tt-btn tt-btn--primary" disabled={busy?.event || !name.trim()}><FolderPlus size={16} />{busy?.event ? 'Đang tạo…' : 'Tạo giải'}</button></div>
      </form>
    </Panel>}
    <Panel title={admin ? 'Các thư mục giải' : 'Giải tham gia'}>
      <EventList events={events} onOpen={onOpenEvent} emptyTitle="Chưa có giải đấu" emptyDescription={admin ? 'Tạo giải trước, bổ sung danh sách đội khi sẵn sàng.' : 'BTC sẽ thêm đội vào giải.'} />
    </Panel>
  </>;
}