import React, { useEffect, useRef } from 'react';
import { History, Swords } from 'lucide-react';

export default function MoveHistory({ history = [], lastMove }) {
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history.length]);

  return (
    <div className="move-history card">
      <div className="move-history__header">
        <History className="w-4 h-4 text-emerald-600" />
        <h4 className="move-history__title">Biên bản nước đi ({history.length})</h4>
      </div>

      <div className="move-history__list">
        {history.length === 0 ? (
          <div className="move-history__empty text-muted">
            Chưa có nước đi nào. Đội Đỏ sẽ đi trước!
          </div>
        ) : (
          history.map((entry, idx) => {
            const isCapture = entry.includes('Ăn');
            return (
              <div
                key={idx}
                className={`move-history__item ${
                  isCapture ? 'move-history__item--capture' : ''
                } ${idx === history.length - 1 ? 'move-history__item--latest' : ''}`}
              >
                {isCapture && <Swords className="w-3.5 h-3.5 text-red-500 inline-block mr-1 flex-shrink-0" />}
                <span>{entry}</span>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
