import React, { useState } from 'react';
import { FolderPlus } from 'lucide-react';
import { Field, Panel } from './TournamentUi.jsx';
import EventList from './EventList.jsx';

export default function EventsPage({ account, events, actions, busy, onOpenEvent }) {
  const [name, setName] = useState('');
  const admin = account.role === 'admin';
  async function create(event) {
    event.preventDefault();
    if (await actions.createEvent({ name: name.trim() })) setName('');
  }
  return <>
    <header className="tt-page-head"><h1 className="tt-page-title">{admin ? 'Giải đấu' : 'Giải của đội'}</h1></header>
    {admin && <Panel title="Tạo thư mục giải" subtitle="Thêm đội và chọn map sau. Chưa xếp lịch hoặc khóa bài.">
      <form className="tt-form" onSubmit={create}><Field label="Tên giải"><input name="name" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="Campus Cup · Tuần 1" /></Field>
        <div><button className="tt-btn tt-btn--primary" disabled={busy?.event || !name.trim()}><FolderPlus size={16} />{busy?.event ? 'Đang tạo…' : 'Tạo giải'}</button></div>
      </form>
    </Panel>}
    <Panel title={admin ? 'Các thư mục giải' : 'Giải tham gia'}>
      <EventList events={events} onOpen={onOpenEvent} emptyTitle="Chưa có giải đấu" emptyDescription={admin ? 'Tạo giải trước, bổ sung danh sách đội khi sẵn sàng.' : 'BTC sẽ thêm đội vào giải.'} />
    </Panel>
  </>;
}