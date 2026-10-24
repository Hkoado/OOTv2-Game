/** Selects the campus session implementation. Fails closed: the Linux sandbox
 * requires a fresh host attestation, an explicit runner path and seccomp on.
 *
 * `trusted-dev` (bot Python chạy trực tiếp trên host) là chế độ **phải opt-in tường minh**
 * bằng `OOTV2_ALLOW_TRUSTED_DEV=1` hoặc `allowTrustedDev: true`. Trước đây nó là mặc
 * định im lặng, nên quên đặt `OOTV2_CAMPUS_SANDBOX` là worker chạy bot học sinh trên máy
 * host với toàn bộ quyền đọc file/mạng của tiến trình Node. Không có opt-in thì throw
 * `trusted_dev_not_enabled`; worker chính thức/manual vì thế dừng ngay khi thiếu sandbox.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createLinuxSandboxSession } from './linuxSandboxSession.js';
import { createTrustedCampusSession, CampusInfrastructureError } from './campusTrustedSession.js';

export const ATTESTATION_PROFILE = 'ootv2-sandbox-attestation.v1';
/** Cờ opt-in cho `trusted-dev`; chỉ đặt trên máy dev tin cậy, không đặt trên server công khai. */
export const TRUSTED_DEV_ENV = 'OOTV2_ALLOW_TRUSTED_DEV';
const fail = (code) => new CampusInfrastructureError(code);


export function validateAttestation(text, { now = Date.now(), allowWsl = false } = {}) {
  let doc;
  try { doc = JSON.parse(text); } catch { throw fail('invalid_attestation'); }
  if (doc?.profile !== ATTESTATION_PROFILE || doc.result !== 'pass') throw fail('invalid_attestation');
  const expires = Date.parse(doc.expiresAt);
  if (!Number.isFinite(expires) || expires <= now) throw fail('attestation_expired');
  if (doc.host?.wsl === true && allowWsl !== true) throw fail('wsl_not_production');
  if (doc.seccomp?.mode !== 'deny-list.v1' || doc.seccomp?.probe !== true) throw fail('seccomp_not_attested');
  if (!/^[a-f0-9]{64}$/.test(doc.seccomp?.sha256 ?? '')) throw fail('invalid_attestation');
  if (typeof doc.host?.kernel !== 'string' || doc.host.kernel.length < 3) throw fail('invalid_attestation');
  return Object.freeze({ profile: doc.profile, expiresAt: doc.expiresAt, host: doc.host,
    seccomp: doc.seccomp, selftest: doc.selftest });
}

export function createCampusSessionFactory({ env = process.env, now = Date.now(), platform = process.platform,
  allowWsl = false, allowTrustedDev = false, createSandbox = createLinuxSandboxSession,
  createTrusted = createTrustedCampusSession } = {}) {
  const mode = env.OOTV2_CAMPUS_SANDBOX ?? 'trusted-dev';
  if (mode === 'trusted-dev') {
    // Không tự bật: thiếu opt-in tường minh thì dừng (fail-closed), không chạy bot trên host.
    if (allowTrustedDev !== true && env[TRUSTED_DEV_ENV] !== '1') throw fail('trusted_dev_not_enabled');
    const factory = async ({ trusted, ...side } = {}) => {
      if (trusted !== true) throw fail('trusted_dev_required');
      return createTrusted({ ...side, trusted: true });
    };
    factory.mode = mode;
    factory.trustedDev = true;
    return factory;
  }
  if (mode !== 'linux-sandbox') throw fail('invalid_sandbox_mode');
  if (platform !== 'linux') throw fail('sandbox_platform_unsupported');
  if (env.OOTV2_SANDBOX_SECCOMP === 'off') throw fail('seccomp_disabled');
  const runnerPath = env.OOTV2_SANDBOX_RUNNER;
  if (typeof runnerPath !== 'string' || !path.isAbsolute(runnerPath)) throw fail('invalid_runner');
  const attestationPath = env.OOTV2_SANDBOX_ATTESTATION;
  if (typeof attestationPath !== 'string' || !path.isAbsolute(attestationPath)) throw fail('invalid_attestation');
  let text;
  try { text = readFileSync(attestationPath, 'utf8'); } catch { throw fail('attestation_unavailable'); }
  const attestation = validateAttestation(text, { now, allowWsl: allowWsl || env.OOTV2_SANDBOX_ALLOW_WSL === '1' });
  const cgroupRoot = env.OOTV2_SANDBOX_CGROUP_ROOT || '/sys/fs/cgroup/ootv2-sandbox';
  const factory = async (side = {}) => {
    if (typeof side.filePath !== 'string' || typeof side.allowedRoot !== 'string') throw fail('invalid_artifact');
    const session = await createSandbox({ filePath: side.filePath, allowedRoot: side.allowedRoot, runnerPath,
      cgroupRoot, seccompMode: 'deny-list.v1',
      ...(Number.isSafeInteger(side.responseTotalMs) ? { responseTotalMs: side.responseTotalMs } : {}),
      ...(Number.isSafeInteger(side.cpuTotalMs) ? { cpuTotalMs: side.cpuTotalMs } : {}) });
    session.attestation = attestation;
    return session;
  };
  factory.mode = mode;
  factory.trustedDev = false;
  factory.attestation = attestation;
  return factory;
}

/**
 * Preflight lúc khởi động worker: cấu hình sandbox phải dùng được NGAY (Linux + attestation
 * còn hạn, hoặc opt-in trusted-dev), không đợi tới job đầu tiên mới lỗi rồi retry vô hạn.
 */
export function assertCampusSandboxReady(options = {}) {
  const factory = createCampusSessionFactory(options);
  return { mode: factory.mode, trustedDev: factory.trustedDev === true };
}
