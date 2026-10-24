/**
 * rememberAccount.js — "Ghi nhớ tài khoản" ở màn đăng nhập.
 *
 * Chỉ lưu TÊN ĐĂNG NHẬP trên máy người dùng (localStorage); KHÔNG lưu mật khẩu,
 * phiên đăng nhập hay CSRF token. Hàm thuần nhận `storage` để test bằng `node --test`.
 */

export const REMEMBER_KEY = 'ootv2_remember_account';
const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,40}$/u;

const box = (storage) => (storage && typeof storage.getItem === 'function' ? storage : null);

/** Trả `{username, remember}` hợp lệ; dữ liệu hỏng/bị xoá => rỗng. */
export function readRememberedAccount(storage) {
  const store = box(storage);
  if (!store) return { username: '', remember: false };
  try {
    const raw = store.getItem(REMEMBER_KEY);
    if (!raw) return { username: '', remember: false };
    const parsed = JSON.parse(raw);
    const username = typeof parsed?.username === 'string' ? parsed.username.trim() : '';
    if (!USERNAME_RE.test(username) || parsed?.remember !== true) return { username: '', remember: false };
    return { username, remember: true };
  } catch {
    return { username: '', remember: false };
  }
}

/** Bật/tắt ghi nhớ; tắt hoặc username không hợp lệ thì xoá bản đã lưu. */
export function saveRememberedAccount(storage, username, remember) {
  const store = box(storage);
  const value = typeof username === 'string' ? username.trim() : '';
  if (!remember || !USERNAME_RE.test(value)) {
    clearRememberedAccount(store);
    return { username: '', remember: false };
  }
  try {
    store.setItem(REMEMBER_KEY, JSON.stringify({ username: value, remember: true }));
  } catch {
    // Storage đầy hoặc bị chặn: bỏ qua, không được làm hỏng đăng nhập.
  }
  return { username: value, remember: true };
}

export function clearRememberedAccount(storage) {
  const store = box(storage);
  try {
    store?.removeItem(REMEMBER_KEY);
  } catch {
    // ignore
  }
}

export default { REMEMBER_KEY, readRememberedAccount, saveRememberedAccount, clearRememberedAccount };
