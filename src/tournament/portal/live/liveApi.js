/**
 * liveApi.js — Client đọc API công khai `/api/live` (không cần đăng nhập) và
 * endpoint L2 `/api/local/live/...` (chỉ dùng khi đã có phiên đội/admin).
 *
 * Khác `portalApi.js`: các hàm ở đây KHÔNG gửi CSRF, không giữ state phiên, vì
 * khán giả ẩn danh chỉ đọc dữ liệu L1.
 */

export class LiveApiError extends Error {
  constructor(message, { status = 0, code = 'request_failed' } = {}) {
    super(message);
    this.name = 'LiveApiError';
    this.status = status;
    this.code = code;
  }
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

async function liveRequest(path, { signal } = {}) {
  let response;
  try {
    response = await fetch(`/api/live${path}`, {
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
      signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new LiveApiError('Không kết nối được máy chủ giải đấu.', { code: 'network' });
  }

  const data = await readJson(response);
  if (!response.ok) {
    throw new LiveApiError(data.message || `Yêu cầu thất bại (HTTP ${response.status}).`, {
      status: response.status,
      code: data.error || 'request_failed',
    });
  }
  return data;
}

export function fetchLiveOverview({ signal } = {}) {
  return liveRequest('/overview', { signal });
}

export function fetchLiveMatch(matchId, { signal } = {}) {
  return liveRequest(`/matches/${encodeURIComponent(matchId)}`, { signal });
}

export function fetchLiveEvents(matchId, afterSeq = 0, { signal } = {}) {
  const safeSeq = Number.isFinite(Number(afterSeq)) && Number(afterSeq) > 0 ? Math.floor(Number(afterSeq)) : 0;
  return liveRequest(`/matches/${encodeURIComponent(matchId)}/events?afterSeq=${safeSeq}`, { signal });
}

/**
 * L2 — log bot của trận. Server tự xác định bên được xem từ phiên đăng nhập
 * (admin có thể truyền `side` để lọc); UI không được tự quyết định quyền.
 */
export async function fetchBotOutput(matchId, { after = 0, side = '', signal } = {}) {
  const params = new URLSearchParams();
  if (after) params.set('after', String(after));
  if (side) params.set('side', side);
  const query = params.toString();
  const response = await fetch(
    `/api/local/live/matches/${encodeURIComponent(matchId)}/bot-output${query ? `?${query}` : ''}`,
    { headers: { Accept: 'application/json' }, credentials: 'same-origin', signal }
  );
  const data = await readJson(response);
  if (!response.ok) {
    throw new LiveApiError(data.message || `Không tải được log bot (HTTP ${response.status}).`, {
      status: response.status,
      code: data.error || 'request_failed',
    });
  }
  return data;
}

export default { fetchLiveOverview, fetchLiveMatch, fetchLiveEvents, fetchBotOutput, LiveApiError };
