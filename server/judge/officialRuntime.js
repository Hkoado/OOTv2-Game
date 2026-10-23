/**
 * Dấu vân tay runtime chính thức — phần tối thiểu cần pin trước khi mở vòng.
 *
 * `runtimeHash` = hash của đúng các file quyết định luật/kết quả + rules/protocol.
 * `budgetHash` = hash của giới hạn tài nguyên/thời gian. Tách hai hash để biết vì sao
 * một ván không tái lập được: đổi engine hay chỉ đổi budget.
 *
 * Không hash OS/Python/host: server chấm là nguồn xác thực; Python chỉ chạy bot,
 * không quyết định luật. Line ending được chuẩn hoá để Windows/Linux cho cùng hash.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { contentHash } from '../contracts/canonical.js';
import { ROOT_DIR } from '../config.js';
import { TERRAIN_RULES_VERSION } from '../../src/game/terrain.js';

export const OFFICIAL_RUNTIME_VERSION = 'campus-runtime.v1';
export const OFFICIAL_PROTOCOL_VERSION = 'bot.v1';

/** Danh sách đóng băng; thêm/bớt file phải bump runtimeVersion và review lại. */
export const OFFICIAL_RUNTIME_FILES = Object.freeze([
  'src/game/constants.js',
  'src/game/gameState.js',
  'src/game/rules.js',
  'src/game/maps.js',
  'src/game/terrain.js',
  'server/contracts/canonical.js',
  'server/contracts/botProtocol.js',
  'server/replay/campusReplay.js',
  'server/judge/gameAdapter.js',
  'server/judge/campusEngine.js',
  'server/judge/campusMatchRunner.js',
  'server/judge/campusTrustedSession.js',
  'server/judge/campusSandboxFactory.js',
  'server/judge/linuxSandboxSession.js',
]);

/** Giá trị mặc định cho mùa đầu; BTC có thể đổi nhưng phải tạo budgetHash mới. */
export const OFFICIAL_BUDGET = Object.freeze({
  setupWallMs: 5000,
  moveWallMs: 1000,
  responseTotalMs: 45000,
  cpuTotalMs: 30000,
  maxPlies: 400,
  maxSourceBytes: 256 * 1024,
  maxInputBytes: 64 * 1024,
  maxOutputBytes: 16 * 1024,
  memoryBytes: 256 * 1024 * 1024,
  pids: 32,
  sandboxProfile: 'linux-sandbox.v2',
});

const BUDGET_KEYS = Object.freeze(Object.keys(OFFICIAL_BUDGET).sort());
const normalizeText = (text) => text.replace(/\r\n/g, '\n');

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function validateBudget(budget) {
  if (!budget || Object.getPrototypeOf(budget) !== Object.prototype
    || Object.keys(budget).sort().join(',') !== BUDGET_KEYS.join(',')) {
    throw new Error('Invalid official budget keys');
  }
  for (const [key, value] of Object.entries(budget)) {
    if (key === 'sandboxProfile') {
      if (typeof value !== 'string' || value.length === 0 || value.length > 80) {
        throw new Error('Invalid official sandbox profile');
      }
    } else if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`Invalid official budget: ${key}`);
    }
  }
}

/** Đọc file từ repo và trả identity đã đóng băng. Ném lỗi nếu thiếu file/budget sai. */
export function createOfficialRuntimeIdentity({ rootDir = ROOT_DIR, budget = OFFICIAL_BUDGET } = {}) {
  validateBudget(budget);
  const files = OFFICIAL_RUNTIME_FILES.map((relativePath) => {
    const text = readFileSync(path.join(rootDir, relativePath), 'utf8');
    return { path: relativePath, sha256: contentHash({ text: normalizeText(text) }) };
  });
  const runtimeHash = contentHash({
    runtimeVersion: OFFICIAL_RUNTIME_VERSION,
    rulesVersion: TERRAIN_RULES_VERSION,
    protocolVersion: OFFICIAL_PROTOCOL_VERSION,
    files,
  });
  return freeze({
    runtimeVersion: OFFICIAL_RUNTIME_VERSION,
    rulesVersion: TERRAIN_RULES_VERSION,
    protocolVersion: OFFICIAL_PROTOCOL_VERSION,
    runtimeHash,
    budgetHash: contentHash(budget),
    files,
    budget: { ...budget },
  });
}

/** Dùng trước khi chấm: snapshot cũ chỉ chạy được nếu runtime hiện tại khớp hash đã pin. */
export function verifyOfficialRuntimeIdentity(identity, { rootDir = ROOT_DIR } = {}) {
  try {
    if (!identity || identity.runtimeVersion !== OFFICIAL_RUNTIME_VERSION
      || identity.rulesVersion !== TERRAIN_RULES_VERSION
      || identity.protocolVersion !== OFFICIAL_PROTOCOL_VERSION) return false;
    const expected = createOfficialRuntimeIdentity({ rootDir, budget: identity.budget });
    return identity.runtimeHash === expected.runtimeHash
      && identity.budgetHash === expected.budgetHash;
  } catch {
    return false;
  }
}
