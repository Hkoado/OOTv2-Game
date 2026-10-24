/**
 * uploadIntake.test.js — API nhận bài chỉ kiểm tra tĩnh, không chạy Python.
 *
 * Bảo vệ quy tắc M1: upload không bao giờ spawn tiến trình, nên `inspectSourceBuffer`
 * phải là hàng rào duy nhất ở cổng nhận bài; phần chạy thử nằm ở worker.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const { inspectSourceBuffer } = await import('../server/services/botValidation.js');
const { default: config } = await import('../server/config.js');

test('nhận bài: chấp nhận source Python UTF-8 trong hạn mức', () => {
  const result = inspectSourceBuffer(Buffer.from('print("hello")\n'));
  assert.equal(result.ok, true);
  assert.equal(result.source, 'print("hello")\n');
});

test('nhận bài: từ chối file rỗng, binary và quá 256 KiB', () => {
  assert.equal(inspectSourceBuffer(Buffer.alloc(0)).error, 'empty_file');
  assert.equal(inspectSourceBuffer(Buffer.from([0x70, 0x00, 0x71])).error, 'binary_file');
  assert.equal(inspectSourceBuffer(Buffer.alloc(config.limits.maxSourceBytes + 1, 0x20)).error, 'file_too_large');
});

test('nhận bài: từ chối UTF-8 hỏng (ký tự thay thế)', () => {
  assert.equal(inspectSourceBuffer(Buffer.from([0x70, 0xff, 0xfe])).error, 'bad_encoding');
});
