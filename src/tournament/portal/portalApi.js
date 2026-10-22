/**
 * portalApi.js — Client mỏng cho `/api/local` (cookie session + CSRF).
 *
 * - Luôn gửi cookie same-origin; không lưu token trong localStorage.
 * - CSRF token do server trả trong body mỗi response và được giữ trong bộ nhớ.
 * - Lỗi mạng/JSON được chuẩn hoá thành `PortalError` để UI hiển thị thống nhất.
 */

export class PortalError extends Error {
  constructor(message, { status = 0, code = 'request_failed' } = {}) {
    super(message);
    this.name = 'PortalError';
    this.status = status;
    this.code = code;
  }
}

let csrfToken = '';

export function setCsrfToken(value) {
  csrfToken = typeof value === 'string' ? value : '';
}

export function resetApiState() {
  csrfToken = '';
}

export function getCsrfToken() {
  return csrfToken;
}

export async function apiRequest(path, { method = 'GET', body, signal } = {}) {
  const headers = { Accept: 'application/json' };
  if (!['GET', 'HEAD'].includes(method)) headers['x-csrf-token'] = csrfToken;

  let payload;
  if (body instanceof FormData) {
    payload = body;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(`/api/local${path}`, {
      method,
      credentials: 'same-origin',
      headers,
      body: payload,
      signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new PortalError('Không kết nối được API local. Kiểm tra backend ở cổng 3001.', { code: 'network' });
  }

  const text = await response.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = {};
    }
  }
  if (data && typeof data.csrf === 'string') setCsrfToken(data.csrf);

  if (!response.ok) {
    throw new PortalError(data.message || `Yêu cầu thất bại (HTTP ${response.status}).`, {
      status: response.status,
      code: data.error || 'request_failed',
    });
  }
  return data;
}

export function isSessionError(error) {
  return error?.status === 401;
}

export default { apiRequest, PortalError, setCsrfToken, resetApiState, getCsrfToken, isSessionError };
