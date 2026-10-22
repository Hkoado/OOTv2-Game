import React from 'react';
import { Folder, ChevronRight } from 'lucide-react';
import { Badge, Empty, Progress } from './TournamentUi.jsx';
import {
  eventProgress, eventStatusLabel, eventTone, formatDateTime, isEventRunning,
} from './tournamentView.js';

export function EventCard({ event, onOpen, actions }) {
  const running = isEventRunning(event.status);
  return (
    <article className={`tt-event${running ? ' tt-event--live' : ''}`}>
      <div className="tt-event__top">
        <div className="tt-event__identity">
          <h3 className="tt-event__name">{event.name}</h3>
          <p className="tt-event__meta">
            <Folder size={16} aria-hidden="true" />
            <span>{formatDateTime(event.created_at)}</span>
            <span aria-hidden="true">·</span>
            <span>{event.status === 'draft' ? 'Đội / Map / Lịch đấu' : 'Kết quả / Replay'}</span>
          </p>
        </div>
        <Badge tone={eventTone(event.status)} dot={running}>{eventStatusLabel(event.status)}</Badge>
      </div>
      <Progress
        value={eventProgress(event)}
        label={`${event.match_finished || 0}/${event.match_total || 0} ván đã chấm`}
      />
      <div className="tt-event__foot">
        <span className="tt-event__hint">
          {running ? 'Đang thi đấu' : event.status === 'finished' ? 'Đã hoàn tất' : 'Bổ sung đội và map trong thư mục giải.'}
        </span>
        <div className="tt-event__actions">
          {actions}
          <button type="button" className="tt-btn tt-btn--ghost tt-btn--sm" onClick={() => onOpen(event.id)}>
            Mở giải
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
    </article>
  );
}

export default function EventList({ events, onOpen, renderActions, emptyTitle = 'Chưa có giải đấu', emptyDescription }) {
  const list = Array.isArray(events) ? events : [];
  if (!list.length) {
    return <Empty title={emptyTitle} description={emptyDescription} />;
  }
  return (
    <div className="tt-event-list">
      {list.map((event) => (
        <EventCard key={event.id} event={event} onOpen={onOpen} actions={renderActions ? renderActions(event) : null} />
      ))}
    </div>
  );
}
