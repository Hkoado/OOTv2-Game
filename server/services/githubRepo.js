/**
 * githubRepo.js — Resolve metadata GitHub cho intake bài (H1).
 *
 * Quy tắc bảo mật:
 * - Chỉ gọi `https://api.github.com` (host cố định), không nhận URL tuỳ ý từ client (chống SSRF).
 * - KHÔNG clone, KHÔNG tải source, KHÔNG chạy git/Python: chỉ đọc metadata repo + commit SHA.
 * - Token (nếu có) chỉ nằm trong header `Authorization`, không bao giờ vào URL/log/response.
 * - Mọi response bị giới hạn thời gian và kích thước; redirect bị từ chối.
 */

import { HttpError } from '../lib/httpError.js';
import config from '../config.js';

export const GITHUB_API_BASE = 'https://api.github.com';
/** Đường dẫn file bot cố định trong repo đội (điều lệ). */
export const BOT_FILE_PATH = 'bot.py';
const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u;
const NAME_RE = /^[A-Za-z0-9_.-]{1,100}$/u;
const BRANCH_RE = /^[A-Za-z0-9._/-]{1,120}$/u;

/**
 * Chuẩn hoá repository HTTPS GitHub canonical: `https://github.com/<owner>/<name>`.
 * Từ chối token trong URL, query/hash, cổng lạ, host khác và path lồng nhau.
 */
export function parseRepository(value) {
  if (typeof value !== 'string') throw new HttpError(400, 'bad_repository', 'Repository phải là URL GitHub.');
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new HttpError(400, 'bad_repository', 'URL GitHub không hợp lệ.');
  }
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port) {
    throw new HttpError(400, 'bad_repository', 'Chỉ nhận https://github.com/<owner>/<repo>.');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new HttpError(400, 'bad_repository', 'URL không được chứa token, query hoặc fragment.');
  }
  const match = /^\/([^/]+)\/([^/]+?)\/?$/u.exec(url.pathname);
  if (!match || !OWNER_RE.test(match[1]) || !NAME_RE.test(match[2])) {
    throw new HttpError(400, 'bad_repository', 'Đường dẫn repository phải có dạng /owner/name.');
  }
  const owner = match[1];
  const name = match[2];
  return { owner, name, fullName: `${owner}/${name}`, repository: `https://github.com/${owner}/${name}` };
}

/** Branch hợp lệ theo git ref đơn giản; chặn ký tự điều khiển, `..`, ref đặc biệt. */
export function parseBranch(value) {
  const branch = typeof value === 'string' ? value.trim() : '';
  if (!branch || !BRANCH_RE.test(branch) || branch.includes('..') || branch.startsWith('/')
    || branch.endsWith('/') || branch.endsWith('.') || branch.endsWith('.lock') || branch.startsWith('refs/')) {
    throw new HttpError(400, 'bad_branch', 'Branch không hợp lệ.');
  }
  return branch;
}

async function readJson(response, maxBytes) {
  let buffer;
  try {
    buffer = Buffer.from(await response.arrayBuffer());
  } catch {
    throw new HttpError(502, 'github_bad_response', 'Không đọc được phản hồi GitHub.');
  }
  if (buffer.length > maxBytes) throw new HttpError(502, 'github_bad_response', 'Phản hồi GitHub vượt quá giới hạn.');
  try {
    return JSON.parse(buffer.toString('utf8'));
  } catch {
    throw new HttpError(502, 'github_bad_response', 'GitHub trả dữ liệu không phải JSON.');
  }
}

async function githubGet(path, { fetchImpl = globalThis.fetch, token = config.github.token, timeoutMs = config.github.timeoutMs, maxBytes = config.github.maxResponseBytes } = {}) {
  const url = `${GITHUB_API_BASE}${path}`;
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: {
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'ootv2-intake',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      // GitHub API không cần redirect; từ chối để không forward credential sang host khác.
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      throw new HttpError(504, 'github_timeout', 'GitHub phản hồi quá chậm; thử lại sau.');
    }
    throw new HttpError(503, 'github_unavailable', 'Không kết nối được GitHub; thử lại sau.');
  }
  if (response.status === 404) throw new HttpError(404, 'repository_not_found', 'Không tìm thấy repository hoặc branch trên GitHub.');
  if (response.status === 401) throw new HttpError(502, 'github_auth_failed', 'GitHub từ chối credential của BTC; kiểm tra cấu hình.');
  if (response.status === 429 || (response.status === 403 && response.headers?.get?.('x-ratelimit-remaining') === '0')) {
    throw new HttpError(503, 'github_rate_limited', 'GitHub đang giới hạn truy cập; thử lại sau.');
  }
  if (response.status === 403) throw new HttpError(502, 'github_forbidden', 'BTC chưa có quyền đọc repository này (cần GitHub App hoặc BTC duyệt).');
  if (!response.ok) throw new HttpError(502, 'github_error', `GitHub trả mã ${response.status}.`);
  return readJson(response, maxBytes);
}

/** `GET /repos/{owner}/{name}` → numeric repository ID (không phụ thuộc owner/name đổi tên). */
export async function getRepository(fullName, options) {
  const body = await githubGet(`/repos/${fullName}`, options);
  const id = body?.id;
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new HttpError(502, 'github_bad_response', 'GitHub không trả repository ID hợp lệ.');
  }
  return {
    id,
    fullName: typeof body.full_name === 'string' ? body.full_name : fullName,
    private: body.private === true,
    defaultBranch: typeof body.default_branch === 'string' ? body.default_branch : '',
  };
}

/** `GET /repos/{owner}/{name}/commits/{branch}` → full 40-hex SHA của HEAD branch. */
export async function getBranchHead(fullName, branch, options) {
  const body = await githubGet(`/repos/${fullName}/commits/${encodeURIComponent(branch)}`, options);
  const sha = typeof body?.sha === 'string' ? body.sha.toLowerCase() : '';
  if (!/^[0-9a-f]{40}$/u.test(sha)) {
    throw new HttpError(502, 'github_bad_response', 'GitHub không trả commit SHA đầy đủ (40 ký tự hex).');
  }
  return sha;
}

/**
 * Resolve repo + HEAD SHA của branch **một lần** trước transaction DB.
 * Không tải blob `bot.py`; worker BTC (H2) sẽ tải đúng SHA này.
 */
export async function resolveIntakeTarget({ repository, branch }, options = {}) {
  const target = parseRepository(repository);
  const ref = parseBranch(branch);
  const repo = await getRepository(target.fullName, options);
  const commitSha = await getBranchHead(target.fullName, ref, options);
  return {
    repository: target.repository,
    fullName: repo.fullName,
    repoId: repo.id,
    branch: ref,
    commitSha,
    private: repo.private,
    defaultBranch: repo.defaultBranch,
  };
}

export default {
  GITHUB_API_BASE,
  BOT_FILE_PATH,
  parseRepository,
  parseBranch,
  getRepository,
  getBranchHead,
  resolveIntakeTarget,
};

