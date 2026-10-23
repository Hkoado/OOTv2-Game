import config from '../config.js';
import { HttpError } from '../lib/httpError.js';

/** Kiểm tra cấu hình Supabase mà không gọi mạng (dùng lúc boot để fail fast). */
export function assertSharedConfig() {
  connection();
}

function connection() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Thiếu SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY trong .env. Driver SQLite đã bị bỏ.');
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('SUPABASE_URL không phải URL hợp lệ.');
  }
  if (parsed.protocol !== 'https:') throw new Error('Supabase URL phải dùng HTTPS.');
  return { url: parsed.origin, key };
}

export async function request(endpoint, { method = 'GET', body, headers = {}, raw = false } = {}) {
  const { url, key } = connection();
  let response;
  try {
    response = await fetch(`${url}${endpoint}`, {
      method, headers: { apikey: key, Authorization: `Bearer ${key}`, ...(body && !Buffer.isBuffer(body) ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
  } catch { throw new HttpError(503, 'database_unavailable', 'Không kết nối được DB chung. Không có driver dự phòng.'); }
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    const code = detail.code;
    if (code === '23505') throw new HttpError(409, 'duplicate_record', 'Dữ liệu trùng hoặc đang có giải hoạt động.');
    if (code === '40001') throw new HttpError(409, 'event_conflict', 'Dữ liệu đã thay đổi. Hãy tải lại.');
    throw new HttpError(response.status >= 500 ? 503 : 400, 'shared_db_error', 'Thao tác DB chung thất bại. Kiểm tra migration/cấu hình hoặc dữ liệu đầu vào.');
  }
  if (raw) return Buffer.from(await response.arrayBuffer());
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

export const rpc = (name, body) => request(`/rest/v1/rpc/${name}`, { method: 'POST', body });
export async function rows(table, query = '') {
  const result = [];
  const params = new URLSearchParams(query);
  if (!params.has('select')) params.set('select', '*');
  for (let offset = 0; ; offset += 1000) {
    const page = await request(`/rest/v1/mvp_${table}?${params}`, { headers: { Range: `${offset}-${offset + 999}`, 'Range-Unit': 'items' } });
    result.push(...page);
    if (page.length < 1000) return result;
  }
}
export const insert = (table, body) => request(`/rest/v1/mvp_${table}`, { method: 'POST', body, headers: { Prefer: 'return=representation' } });
export const update = (table, query, body) => request(`/rest/v1/mvp_${table}?${query}`, { method: 'PATCH', body, headers: { Prefer: 'return=representation' } });
export const remove = (table, query) => request(`/rest/v1/mvp_${table}?${query}`, { method: 'DELETE' });
export function uuid(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new HttpError(400, 'bad_id', 'ID không hợp lệ.');
  return value;
}
export async function health() { await rows('imports', 'limit=1'); return { driver: 'supabase', profile: 'mvp.v1', workerLeases: true }; }
export const cacheRoot = config.artifactCacheDir;