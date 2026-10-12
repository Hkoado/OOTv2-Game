/**
 * api.js — Client HTTP mỏng cho API tournament (M5).
 *
 * Quy ước:
 * - Mặc định gọi URL TƯƠNG ĐỐI `/api/...` để Vite dev proxy (`vite.config.js`) chuyển
 *   tiếp sang `127.0.0.1:3001`, tránh CORS. Có thể ghi đè bằng `VITE_API_BASE` lúc build
 *   hoặc `localStorage.ottv2_api_base` trên trình duyệt.
 * - Không bao giờ hiển thị `storage_path`/source bot: các view này lấy nguyên response
 *   đã được server lọc sẵn.
 */

const STORAGE_KEYS = {
  apiBase: 'ottv2_api_base',
  adminKey: 'ottv2_admin_key',
};

const envBase = typeof import.meta !== 'undefined' ? import.meta.env?.VITE_API_BASE : undefined;

function trimSlashes(value) {
  return String(value).replace(/\/+$/, '');
}

/** Base URL của API; rỗng nghĩa là dùng đường dẫn tương đối qua Vite proxy. */
export function getApiBase() {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEYS.apiBase);
    if (stored) return trimSlashes(stored);
  } catch {
    /* chế độ private / chặn storage: bỏ qua */
  }
  return envBase ? trimSlashes(envBase) : '';
}

export function setApiBase(value) {
  try {
    if (value) window.localStorage.setItem(STORAGE_KEYS.apiBase, trimSlashes(value));
    else window.localStorage.removeItem(STORAGE_KEYS.apiBase);
  } catch {
    /* bỏ qua */
  }
}

/** Khóa admin local (`x-admin-key`), lưu trong localStorage cho tiện demo. */
export function getAdminKey() {
  try {
    return window.localStorage.getItem(STORAGE_KEYS.adminKey) || '';
  } catch {
    return '';
  }
}

export function setAdminKey(value) {
  try {
    if (value) window.localStorage.setItem(STORAGE_KEYS.adminKey, value);
    else window.localStorage.removeItem(STORAGE_KEYS.adminKey);
  } catch {
    /* bỏ qua */
  }
}

/** Gắn `{error, message, code, status}` vào Error để UI hiển thị gọn. */
function toApiError(status, payload) {
  const error = new Error(payload?.message || `Yêu cầu thất bại (HTTP ${status})`);
  error.code = payload?.error || `http_${status}`;
  error.status = status;
  return error;
}

async function request(path, { method = 'GET', json, file, admin = false } = {}) {
  const headers = {};
  let body;

  if (file) {
    const form = new FormData();
    // Trường đúng theo middleware multer của server (`acceptBotUpload`).
    form.append('file', file, file.name);
    body = form;
  } else if (json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(json);
  }

  if (admin) {
    const key = getAdminKey();
    if (key) headers['x-admin-key'] = key;
  }

  let response;
  try {
    response = await fetch(`${getApiBase()}${path}`, { method, headers, body });
  } catch {
    const error = new Error('Không kết nối được API (đã chạy `npm run dev:api` chưa?)');
    error.code = 'network_error';
    throw error;
  }

  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { error: 'bad_response', message: text.slice(0, 200) };
    }
  }

  if (!response.ok) throw toApiError(response.status, payload);
  return payload;
}

export const tournamentApi = {
  health: () => request('/api/health'),
  sampleBotUrl: () => `${getApiBase()}/api/sample-bot`,

  listParticipants: () => request('/api/participants'),
  createParticipant: (name) => request('/api/participants', { method: 'POST', json: { name } }),
  listSubmissions: (participantId) => request(`/api/participants/${participantId}/submissions`),
  uploadBot: (participantId, file) =>
    request(`/api/participants/${participantId}/submissions`, { method: 'POST', file }),

  listTournaments: () => request('/api/tournaments'),
  createTournament: (name, participantIds) =>
    request('/api/tournaments', { method: 'POST', json: { name, participantIds }, admin: true }),
  startTournament: (tournamentId) =>
    request(`/api/tournaments/${tournamentId}/start`, { method: 'POST', admin: true }),
  getTournament: (tournamentId) => request(`/api/tournaments/${tournamentId}`),
  getStandings: (tournamentId) => request(`/api/tournaments/${tournamentId}/standings`),
  getBracket: (tournamentId) => request(`/api/tournaments/${tournamentId}/bracket`),
  listTournamentMatches: (tournamentId) =>
    request(`/api/tournaments/${tournamentId}/matches`),

  getMatch: (matchId) => request(`/api/matches/${matchId}`),
  getReplay: (matchId) => request(`/api/matches/${matchId}/replay`),
};

export default tournamentApi;
