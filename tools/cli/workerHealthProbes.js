/**
 * Phân loại phản hồi của các RPC preflight — logic thuần, không I/O.
 *
 * Tách khỏi `worker-health.js` để test được hành vi thật của guard: một probe chỉ PASS khi
 * DB trả đúng guard đã biết TRƯỚC khi truy vấn job. Mọi lỗi khác (404/PGRST202, 401, 500,
 * JSONB bất thường) đều FAIL; đặc biệt JSONB `ok:true` nghĩa là RPC đã claim/lease thật,
 * nên tuyệt đối không được coi là PASS.
 */

const ERROR_CODE = 'P0001';

/** PostgREST: `raise exception '<text>'` → 400 + {code:'P0001', message:'<text>'}. */
export function raisedGuard(body, expected = ['bad_worker', 'bad_lease']) {
  const code = typeof body?.code === 'string' ? body.code : '';
  const message = typeof body?.message === 'string' ? body.message : '';
  if (code !== ERROR_CODE) return null;
  return expected.find((name) => message.includes(name)) ?? null;
}

/** `mvp_github_claim` raise exception; guard `bad_worker` chạy trước truy vấn job. */
export function githubClaimHealthy({ status, body }) {
  if (status !== 400) return null;
  return raisedGuard(body, ['bad_worker', 'bad_lease']);
}

/** Official/manual claim trả JSONB HTTP 200; chỉ `ok:false` + guard mới chứng minh không lease. */
export function jsonbClaimHealthy({ status, body }, guard = 'bad_worker') {
  if (status !== 200) return null;
  if (body?.ok !== false) return null;
  return body?.error === guard ? guard : null;
}

/** Heartbeat manual từ chối duration trước UPDATE (200 + error `bad_lease`). */
export function jsonbGuardHealthy({ status, body }, guard) {
  if (status !== 200) return null;
  return body?.error === guard ? guard : null;
}
