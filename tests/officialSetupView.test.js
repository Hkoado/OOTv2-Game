import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectVersionConflict,
  formatGroupSummary,
  parseCutoffDetails,
  toLocalDatetimeInput,
} from '../src/tournament/portal/officialSetupView.js';

test('toLocalDatetimeInput converts ISO to YYYY-MM-DDTHH:mm safely', () => {
  assert.equal(toLocalDatetimeInput(null), '');
  assert.equal(toLocalDatetimeInput(''), '');
  assert.equal(toLocalDatetimeInput('invalid-date'), '');
  const iso = '2026-11-01T13:00:00.000Z';
  const local = toLocalDatetimeInput(iso);
  assert.match(local, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
});

test('parseCutoffDetails handles empty, invalid, future and past dates', () => {
  const empty = parseCutoffDetails('');
  assert.equal(empty.utcIso, null);
  assert.equal(empty.isValid, true);
  assert.match(empty.hint, /Chưa đặt cutoff/);

  const invalid = parseCutoffDetails('not-a-datetime');
  assert.equal(invalid.isValid, false);
  assert.equal(invalid.utcIso, null);

  const futureNow = Date.parse('2026-10-24T00:00:00.000Z');
  const future = parseCutoffDetails('2026-11-01T20:00', futureNow);
  assert.equal(future.isValid, true);
  assert.ok(future.utcIso);
  assert.equal(future.isPast, false);
  assert.ok(future.localDisplay);
  assert.match(future.hint, /Server lưu chuẩn UTC/);

  const past = parseCutoffDetails('2026-10-01T10:00', futureNow);
  assert.equal(past.isValid, true);
  assert.equal(past.isPast, true);
  assert.match(past.hint, /đã trôi qua/);
});

test('detectVersionConflict warns only when draft is dirty and server has newer version', () => {
  // Not dirty: no conflict even if server is newer
  assert.equal(detectVersionConflict(1, 2, false).hasConflict, false);

  // Dirty but versions match: no conflict
  assert.equal(detectVersionConflict(1, 1, true).hasConflict, false);

  // Dirty and server is ahead: conflict detected
  const conflict = detectVersionConflict(1, 2, true);
  assert.equal(conflict.hasConflict, true);
  assert.match(conflict.message, /v2/);
  assert.match(conflict.message, /v1/);

  // Invalid numbers safe
  assert.equal(detectVersionConflict(null, undefined, true).hasConflict, false);
});

test('formatGroupSummary formats single and multiple dynamic groups A–H with balance', () => {
  const empty = formatGroupSummary([]);
  assert.equal(empty.count, 0);
  assert.equal(empty.label, 'Chưa có bảng đấu');

  const single = formatGroupSummary([{ name: 'A', participantIds: ['t1', 't2', 't3', 't4'] }]);
  assert.equal(single.count, 1);
  assert.equal(single.label, 'Bảng A');
  assert.equal(single.balanced, true);

  const fourGroups = formatGroupSummary([
    { name: 'A', participantIds: ['1', '2', '3', '4', '5'] },
    { name: 'B', participantIds: ['6', '7', '8', '9'] },
    { name: 'C', participantIds: ['10', '11', '12', '13'] },
    { name: 'D', participantIds: ['14', '15', '16', '17'] },
  ]);
  assert.equal(fourGroups.count, 4);
  assert.equal(fourGroups.label, 'Bảng A – Bảng D (4 bảng)');
  assert.equal(fourGroups.balanced, true);
  assert.match(fourGroups.details, /Cân bằng bảng đạt chuẩn/);

  const eightGroups = formatGroupSummary([
    { name: 'A', participantIds: ['1', '2', '3', '4', '5'] },
    { name: 'B', participantIds: ['6', '7', '8', '9', '10'] },
    { name: 'C', participantIds: ['11', '12', '13', '14', '15'] },
    { name: 'D', participantIds: ['16', '17', '18', '19', '20'] },
    { name: 'E', participantIds: ['21', '22', '23', '24'] },
    { name: 'F', participantIds: ['25', '26', '27', '28'] },
    { name: 'G', participantIds: ['29', '30', '31', '32'] },
    { name: 'H', participantIds: ['33', '34', '35', '36'] },
  ]);
  assert.equal(eightGroups.count, 8);
  assert.equal(eightGroups.label, 'Bảng A – Bảng H (8 bảng)');
  assert.equal(eightGroups.balanced, true);
});
