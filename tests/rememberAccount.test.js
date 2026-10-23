/**
 * rememberAccount.test.js — "Ghi nhớ tài khoản" chỉ lưu username, không lưu bí mật.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  REMEMBER_KEY,
  clearRememberedAccount,
  readRememberedAccount,
  saveRememberedAccount,
} from '../src/tournament/portal/rememberAccount.js';

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    dump: () => Object.fromEntries(map),
  };
}

test('save/read/clear: chỉ lưu username hợp lệ, không lưu mật khẩu hay token', () => {
  const storage = fakeStorage();
  assert.deepEqual(saveRememberedAccount(storage, '  doi1  ', true), { username: 'doi1', remember: true });
  const saved = JSON.parse(storage.getItem(REMEMBER_KEY));
  assert.deepEqual(saved, { username: 'doi1', remember: true });
  assert.equal(Object.keys(saved).includes('password'), false, 'không được lưu mật khẩu');
  assert.deepEqual(readRememberedAccount(storage), { username: 'doi1', remember: true });

  // Tắt ghi nhớ => xoá bản đã lưu.
  assert.deepEqual(saveRememberedAccount(storage, 'doi1', false), { username: '', remember: false });
  assert.equal(storage.getItem(REMEMBER_KEY), null);
  assert.deepEqual(readRememberedAccount(storage), { username: '', remember: false });

  saveRememberedAccount(storage, 'admin', true);
  clearRememberedAccount(storage);
  assert.equal(storage.getItem(REMEMBER_KEY), null);
});

test('read: dữ liệu hỏng, sai schema hoặc username không hợp lệ đều trả rỗng', () => {
  const cases = [
    '{not-json',
    JSON.stringify({ username: 'a', remember: true }),
    JSON.stringify({ username: 'has space', remember: true }),
    JSON.stringify({ username: '<script>', remember: true }),
    JSON.stringify({ username: 'doi1', remember: 'yes' }),
    JSON.stringify(null),
  ];
  for (const raw of cases) {
    assert.deepEqual(readRememberedAccount(fakeStorage({ [REMEMBER_KEY]: raw })), { username: '', remember: false }, raw);
  }
  assert.deepEqual(readRememberedAccount(null), { username: '', remember: false });
  assert.deepEqual(readRememberedAccount({}), { username: '', remember: false });
});

test('save: username không hợp lệ thì không ghi; storage lỗi không làm sập đăng nhập', () => {
  const storage = fakeStorage();
  assert.deepEqual(saveRememberedAccount(storage, 'ab', true), { username: '', remember: false });
  assert.equal(storage.getItem(REMEMBER_KEY), null, 'username < 3 ký tự không được lưu');

  const broken = {
    getItem: () => null,
    setItem: () => {
      throw new Error('quota');
    },
    removeItem: () => {},
  };
  assert.deepEqual(saveRememberedAccount(broken, 'doi1', true), { username: 'doi1', remember: true });
  assert.equal(readRememberedAccount(broken).username, '');
});
