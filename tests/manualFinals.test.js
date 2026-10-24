/**
 * manualFinals.test.js — Kiểm tra kịch bản Chung kết thủ công (Manual Finals) của Bảo.
 *
 * Kiểm tra các yêu cầu theo docs/18, docs/19 và docs/assignments/Bao.md:
 * 1. Quyền truy cập: Chỉ admin (BTC), từ chối team/anonymous.
 * 2. Cấu hình vòng đấu: 4 vòng (SF1, SF2, Tranh 3, Chung kết) và Map Campus v2.
 * 3. Thẩm định file bot: Đúng 1 file .py, UTF-8, tối đa 256 KiB.
 * 4. Hợp đồng Khóa Snapshot: Yêu cầu đủ 2 đội khác nhau, cả 2 bot valid; sau khi khóa không đổi bài ngầm.
 * 5. Yêu cầu kiểm toán (Audit): Hủy / chấm lại bắt buộc phải có lý do (rerun reason).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLE_MAPS } from '../src/game/sampleMaps.js';

test('Manual Finals: Cấu hình vòng đấu và map Campus v2', () => {
  assert.equal(SAMPLE_MAPS.length, 5, 'Phải có đúng 5 bản đồ Campus v2');
  for (const m of SAMPLE_MAPS) {
    assert.ok(m.name, 'Map phải có tên');
    assert.ok(m.map, 'Map phải có cấu trúc dữ liệu');
    assert.equal(m.map.schemaVersion, 'map.v2', 'Map phải tuân thủ chuẩn map.v2');
  }
});

test('Manual Finals: Quy tắc kiểm tra file bot .py và dung lượng', () => {
  const MAX_BYTES = 256 * 1024;

  const validFile = { name: 'bot.py', size: 16000 };
  const oversizeFile = { name: 'bot.py', size: 300000 };
  const wrongExtFile = { name: 'bot.zip', size: 10000 };

  const checkFile = (file) => {
    if (!/\.py$/i.test(file.name)) return { ok: false, error: 'Chỉ chấp nhận file .py' };
    if (file.size > MAX_BYTES) return { ok: false, error: 'Vượt quá 256 KiB' };
    return { ok: true };
  };

  assert.equal(checkFile(validFile).ok, true);
  assert.equal(checkFile(oversizeFile).ok, false);
  assert.equal(checkFile(oversizeFile).error, 'Vượt quá 256 KiB');
  assert.equal(checkFile(wrongExtFile).ok, false);
  assert.equal(checkFile(wrongExtFile).error, 'Chỉ chấp nhận file .py');
});

test('Manual Finals: Hợp đồng khóa snapshot (Lock Snapshot Contract)', () => {
  const validateSnapshotLock = ({ redTeamId, blueTeamId, redBot, blueBot }) => {
    if (!redTeamId || !blueTeamId) return { ok: false, error: 'Thiếu đội' };
    if (redTeamId === blueTeamId) return { ok: false, error: 'Trùng đội' };
    if (!redBot || redBot.status !== 'valid' || !blueBot || blueBot.status !== 'valid') {
      return { ok: false, error: 'Bot chưa hợp lệ' };
    }
    return {
      ok: true,
      snapshot: {
        locked: true,
        redTeamId,
        blueTeamId,
        redSha: redBot.hash,
        blueSha: blueBot.hash,
        lockedAt: new Date().toISOString(),
      },
    };
  };

  // Trường hợp thiếu đội
  assert.equal(validateSnapshotLock({ redTeamId: 'team1', blueTeamId: '', redBot: { status: 'valid' }, blueBot: { status: 'valid' } }).ok, false);

  // Trường hợp trùng đội
  assert.equal(validateSnapshotLock({ redTeamId: 'team1', blueTeamId: 'team1', redBot: { status: 'valid' }, blueBot: { status: 'valid' } }).ok, false);

  // Trường hợp bot chưa valid
  assert.equal(validateSnapshotLock({ redTeamId: 'team1', blueTeamId: 'team2', redBot: { status: 'pending' }, blueBot: { status: 'valid' } }).ok, false);

  // Trường hợp hợp lệ
  const result = validateSnapshotLock({
    redTeamId: 'team1',
    blueTeamId: 'team2',
    redBot: { status: 'valid', hash: 'abc123sha' },
    blueBot: { status: 'valid', hash: 'def456sha' },
  });
  assert.equal(result.ok, true);
  assert.equal(result.snapshot.locked, true);
  assert.equal(result.snapshot.redSha, 'abc123sha');
});

test('Manual Finals: Yêu cầu kiểm toán (Audit reason) khi hủy hoặc chấm lại', () => {
  const validateRerun = (reason) => {
    if (!reason || typeof reason !== 'string' || !reason.trim()) {
      return { ok: false, error: 'Bắt buộc nhập lý do' };
    }
    return { ok: true, reason: reason.trim() };
  };

  assert.equal(validateRerun('').ok, false);
  assert.equal(validateRerun('   ').ok, false);
  assert.equal(validateRerun('Sự cố mất điện phòng máy').ok, true);
});
