import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const drill = readFileSync(new URL('../tools/cli/k2-schedule-drill.js', import.meta.url), 'utf8');

test('K2 drill chỉ thao tác dữ liệu do nó tạo và dọn đúng thứ tự FK', () => {
  assert.match(drill, /mvp_official_games', `round_pk=eq\.\$\{state\.roundId\}`/);
  assert.match(drill, /mvp_official_rounds', `event_id=eq\.\$\{state\.eventId\}`/);
  assert.match(drill, /mvp_tournament_entries', `tournament_id=eq\.\$\{state\.eventId\}`/);
  assert.match(drill, /mvp_tournaments', `id=eq\.\$\{state\.eventId\}`/);
  assert.match(drill, /mvp_participants', `id=eq\.\$\{id\}`/);
  assert.ok(drill.indexOf("remove('mvp_official_games'") < drill.indexOf("remove('mvp_official_rounds'"));
  assert.ok(drill.indexOf("remove('mvp_tournament_entries'") < drill.indexOf("remove('mvp_tournaments'"));
  assert.doesNotMatch(drill, /deleteRows\('mvp_/);
});

test('K2 drill phủ fencing, chain, result và freeze trên DB thật', () => {
  for (const name of ['open round trên DB thật', 'open lặp bị từ chối', '2 writer: đúng một append thắng',
    'writer thua trả stale_prefix', 'record lặp idempotent', 'record kết quả khác bị chặn',
    'freeze thiếu ván bị chặn', 'freeze đủ ván + frozen=true', 'freeze lặp idempotent']) {
    assert.ok(drill.includes(name), name);
  }
  assert.match(drill, /process\.exit\(failed\.length === 0 \? 0 : 1\)/);
  assert.doesNotMatch(drill, /process\.exitCode/);
  assert.match(drill, /nextPinnedGroupGame/);
  assert.match(drill, /stale_prefix/);
});
