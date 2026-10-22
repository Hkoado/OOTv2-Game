/**
 * Test hàm thuần cho trang live (frontend) và helper server (lọc log, chuẩn hoá
 * query, trạng thái worker) + rate limiter trong RAM.
 *
 * Chạy: `node --test tests/liveView.test.js`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  appendLiveEvents,
  findTerminal,
  formatElapsed,
  liveStateLabel,
  moveCount,
  parseLiveHash,
  toReplayEvents,
} from '../src/tournament/portal/live/liveView.js';
import {
  computeWorkerState,
  normalizeAfterSeq,
  normalizeLimit,
  sanitizeOutputLine,
  shapeEventRow,
  splitOutputChunk,
} from '../server/services/liveView.js';
import { createRateLimiter } from '../server/lib/rateLimit.js';

test('liveView (web): parse hash #/live và gộp event theo seq', () => {
  assert.deepEqual(parseLiveHash('#/live'), { live: true, matchId: null });
  assert.deepEqual(parseLiveHash('#/live/abc-123'), { live: true, matchId: 'abc-123' });
  assert.deepEqual(parseLiveHash('#/live/'), { live: true, matchId: null });
  assert.equal(parseLiveHash('#/events').live, false);
  assert.equal(parseLiveHash('#/live/abc/extra').live, false);
  assert.equal(parseLiveHash('live').live, false);

  const merged = appendLiveEvents(
    [
      { seq: 1, kind: 'move', payload: { player: 'red' } },
      { seq: 2, kind: 'move', payload: { player: 'red' } },
    ],
    [
      { seq: 2, kind: 'move', payload: { player: 'blue' } },
      { seq: 3, kind: 'terminal', payload: { result: 'blue_win' } },
    ]
  );
  assert.deepEqual(merged.map((event) => event.seq), [1, 2, 3]);
  assert.equal(merged[1].payload.player, 'blue', 'event trùng seq được cập nhật');
  assert.equal(appendLiveEvents([{ seq: 1 }], []).length, 1);
  assert.deepEqual(appendLiveEvents(null, [{ seq: 1 }]).map((event) => event.seq), [1]);
});

test('liveView (web): chuyển event live sang replay + nhãn trạng thái', () => {
  const events = [
    { seq: 0, kind: 'initial', payload: { initial_pieces: [] } },
    { seq: 2, kind: 'move', payload: { player: 'blue', piece_id: 'b1', from: 80, to: 71 } },
    { seq: 1, kind: 'move', payload: { player: 'red', piece_id: 'r1', from: 0, to: 9, captured_piece_id: 'b9' } },
    { seq: 3, kind: 'terminal', payload: { result: 'red_win', reason: 'base_capture', ply_count: 2 } },
  ];

  const replayEvents = toReplayEvents(events);
  assert.deepEqual(replayEvents.map((event) => event.piece_id), ['r1', 'b1']);
  assert.equal(replayEvents[0].captured_piece_id, 'b9');
  assert.equal(replayEvents[1].captured_piece_id, null);

  assert.equal(moveCount(events), 2);
  assert.equal(findTerminal(events).result, 'red_win');
  assert.equal(findTerminal(events.slice(0, 2)), null);
  assert.equal(liveStateLabel({ status: 'running', hasInitial: true }), 'Đang thi đấu');
  assert.equal(liveStateLabel({ status: 'running', hasInitial: false }), 'Đang xếp quân');
  assert.equal(liveStateLabel({ status: 'finished', hasInitial: true }), 'Đã kết thúc');

  const started = new Date(Date.now() - 65_000).toISOString();
  assert.match(formatElapsed(started), /^01:0\d$/u);
  assert.equal(formatElapsed(null), '—');

test('liveView (server): lọc log bot và chuẩn hoá query', () => {
  assert.equal(sanitizeOutputLine('  hello\r\n', 400), 'hello');
  assert.equal(sanitizeOutputLine('\u0000\u0007', 400), '');
  assert.equal(sanitizeOutputLine('a'.repeat(10), 5), 'aaaa…');
  assert.deepEqual(splitOutputChunk('a\n\n b \r\nc', 400), ['a', 'b', 'c']);
  assert.deepEqual(splitOutputChunk(null), []);

  assert.equal(normalizeAfterSeq('12'), 12);
  assert.equal(normalizeAfterSeq('-3'), 0);
  assert.equal(normalizeAfterSeq('abc'), 0);
  assert.equal(normalizeAfterSeq(undefined), 0);

  assert.equal(normalizeLimit('50', { fallback: 100, max: 200 }), 50);
  assert.equal(normalizeLimit('9999', { fallback: 100, max: 200 }), 200);
  assert.equal(normalizeLimit('0', { fallback: 100 }), 100);

  assert.deepEqual(shapeEventRow({ seq: 2, kind: 'move', payload_json: '{"ply":2}' }), {
    seq: 2,
    kind: 'move',
    payload: { ply: 2 },
  });
  assert.equal(shapeEventRow({ seq: 1, kind: 'unknown', payload_json: '{}' }), null);
  assert.equal(shapeEventRow({ seq: 1, kind: 'move', payload_json: 'not-json' }), null);

  const fresh = computeWorkerState({ worker_id: 'host:123', heartbeat_at: new Date().toISOString() }, { now: Date.now() });
  assert.equal(fresh.alive, true);
  assert.equal(fresh.label, 'host:123');
  const stale = computeWorkerState(
    { worker_id: 'host:123', heartbeat_at: new Date(Date.now() - 60_000).toISOString() },
    { now: Date.now() }
  );
  assert.equal(stale.alive, false);
  assert.equal(computeWorkerState(null).alive, false);
});

test('rate limiter: chặn sau max request trong cửa sổ và trả Retry-After', () => {
  const limiter = createRateLimiter({ windowMs: 60_000, max: 2 });
  const req = { ip: '203.0.113.9', socket: {} };

  const makeRes = () => {
    const state = { status: 200, headers: {}, body: null };
    return {
      state,
      set(key, value) {
        state.headers[key] = value;
        return this;
      },
      status(code) {
        state.status = code;
        return this;
      },
      json(body) {
        state.body = body;
        return this;
      },
    };
  };

  let allowed = 0;
  for (let index = 0; index < 2; index += 1) limiter(req, makeRes(), () => { allowed += 1; });
  assert.equal(allowed, 2);

  const blocked = makeRes();
  limiter(req, blocked, () => { allowed += 1; });
  assert.equal(allowed, 2, 'request thứ 3 không được đi tiếp');
  assert.equal(blocked.state.status, 429);
  assert.equal(blocked.state.body.error, 'rate_limited');
  assert.ok(Number(blocked.state.headers['Retry-After']) >= 1);

  // IP khác vẫn có quota riêng.
  const other = makeRes();
  let otherAllowed = 0;
  limiter({ ip: '198.51.100.4', socket: {} }, other, () => { otherAllowed += 1; });
  assert.equal(otherAllowed, 1);
});

});
