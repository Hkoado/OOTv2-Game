import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GITHUB_SYNC_FIXTURES,
  GITHUB_SYNC_STATUSES,
  SYNC_STATUS_METADATA,
  formatCommitSha,
  formatReceipt,
  syncStatusInfo,
} from '../src/tournament/portal/githubSyncState.js';

test('GITHUB_SYNC_STATUSES covers exactly the 7 documented official intake statuses', () => {
  assert.deepEqual([...GITHUB_SYNC_STATUSES], [
    'resolving',
    'fetching',
    'checking',
    'valid',
    'invalid',
    'infrastructure',
    'frozen',
  ]);
  assert.equal(Object.keys(SYNC_STATUS_METADATA).length, 7);
});

test('syncStatusInfo maps each status to proper label, tone and classification flags', () => {
  const resolving = syncStatusInfo('resolving');
  assert.equal(resolving.label, 'Đang xác thực GitHub');
  assert.equal(resolving.tone, 'warning');
  assert.equal(resolving.inProgress, true);

  const fetching = syncStatusInfo('fetching');
  assert.equal(fetching.tone, 'warning');
  assert.equal(fetching.inProgress, true);

  const checking = syncStatusInfo('checking');
  assert.equal(checking.tone, 'warning');
  assert.equal(checking.inProgress, true);

  const valid = syncStatusInfo('valid');
  assert.equal(valid.label, 'Bot hợp lệ');
  assert.equal(valid.tone, 'success');
  assert.equal(valid.isValid, true);

  const invalid = syncStatusInfo('invalid');
  assert.equal(invalid.label, 'Bot không hợp lệ');
  assert.equal(invalid.tone, 'danger');
  assert.equal(invalid.isError, true);
  assert.equal(invalid.errorCategory, 'code');

  const infra = syncStatusInfo('infrastructure');
  assert.equal(infra.tone, 'danger');
  assert.equal(infra.isError, true);
  assert.equal(infra.errorCategory, 'infrastructure');

  const frozen = syncStatusInfo('frozen');
  assert.equal(frozen.label, 'Đã khóa bài nộp');
  assert.equal(frozen.tone, 'neutral');
  assert.equal(frozen.isFrozen, true);

  // Fallbacks
  assert.equal(syncStatusInfo(null).label, 'Chưa nộp bot');
  assert.equal(syncStatusInfo('unexpected_custom_status').label, 'unexpected_custom_status');
});

test('formatCommitSha trims commit hash safely', () => {
  assert.equal(formatCommitSha('d3b07384d113edec49eaa6238ad5ff00'), 'd3b0738');
  assert.equal(formatCommitSha(''), '—');
  assert.equal(formatCommitSha(null), '—');
  assert.equal(formatCommitSha('1234', 7), '1234');
});

test('formatReceipt standardises receipt DTO safely without secret leaks', () => {
  const nullReceipt = formatReceipt(null);
  assert.equal(nullReceipt, null);

  const validReceipt = formatReceipt(GITHUB_SYNC_FIXTURES.valid);
  assert.equal(validReceipt.status, 'valid');
  assert.equal(validReceipt.shortSha, 'a1b2c3d');
  assert.equal(validReceipt.statusMeta.isValid, true);
  assert.equal(validReceipt.sourceKind, 'github');
  assert.equal(validReceipt.filePath, 'bot.py');

  const infraReceipt = formatReceipt(GITHUB_SYNC_FIXTURES.infrastructure);
  assert.equal(infraReceipt.status, 'infrastructure');
  assert.equal(infraReceipt.errorCategory, 'infrastructure');
  assert.match(infraReceipt.error, /rate limit/i);
});

test('GITHUB_SYNC_FIXTURES contains valid, realistic fixtures for all 7 statuses', () => {
  for (const status of GITHUB_SYNC_STATUSES) {
    const fixture = GITHUB_SYNC_FIXTURES[status];
    assert.ok(fixture, `Missing fixture for status ${status}`);
    assert.equal(fixture.status, status);
    assert.ok(fixture.id);
    assert.ok(fixture.event_id);
    assert.ok(fixture.team_id);
    assert.equal(fixture.source_kind, 'github');
    assert.equal(fixture.file_path, 'bot.py');
    assert.match(fixture.repository, /^https:\/\/github\.com\//);
    assert.match(fixture.resolved_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  }
});

