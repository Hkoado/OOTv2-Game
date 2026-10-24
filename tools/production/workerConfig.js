/**
 * Per-machine worker settings. Kept out of `.env` because these describe the host
 * (VM name, resources, SSH login), not secrets. Validated once in Node so the
 * Windows scripts and the docs cannot drift apart.
 */
export const WORKER_CONFIG_VERSION = 'ootv2-worker-config.v1';

export const DEFAULT_WORKER_CONFIG = Object.freeze({
  schemaVersion: WORKER_CONFIG_VERSION,
  vmName: 'OOTv2-Judge',
  vmDirectory: 'D:\\OOTv2-VM',
  switchName: 'Default Switch',
  wslDistribution: 'Ubuntu',
  cpuCount: 4,
  memoryGiB: 4,
  sshUser: 'ootv2',
});

const KEYS = Object.freeze(Object.keys(DEFAULT_WORKER_CONFIG).sort());
const VM_NAME = /^[A-Za-z0-9_-]{1,50}$/;
const WSL_DISTRO = /^[A-Za-z0-9._-]{1,64}$/;
const SSH_USER = /^[a-z_][a-z0-9_-]{0,31}$/;
const SWITCH_NAME = /^[A-Za-z0-9 ._-]{1,100}$/;
// Hyper-V paths are passed to tar/wsl/scp, so spaces and traversal stay rejected.
const WINDOWS_DIR = /^[A-Za-z]:\\(?:[A-Za-z0-9._-]+\\)*[A-Za-z0-9._-]+$/;

function fail(code) {
  throw Object.assign(new Error(code), { code });
}

/** Returns a normalized copy; throws `{ code }` with a stable machine-readable reason. */
export function parseWorkerConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('invalid_worker_config');
  const unknown = Object.keys(value).filter((key) => !KEYS.includes(key));
  if (unknown.length) fail('unknown_worker_config_key');
  const config = { ...DEFAULT_WORKER_CONFIG, ...value };
  if (config.schemaVersion !== WORKER_CONFIG_VERSION) fail('unsupported_worker_config_version');
  if (!VM_NAME.test(config.vmName ?? '')) fail('invalid_vm_name');
  if (typeof config.vmDirectory !== 'string' || !WINDOWS_DIR.test(config.vmDirectory)
    || config.vmDirectory.includes('..')) fail('invalid_vm_directory');
  if (!SWITCH_NAME.test(config.switchName ?? '') || config.switchName.trim() !== config.switchName) {
    fail('invalid_switch_name');
  }
  if (!WSL_DISTRO.test(config.wslDistribution ?? '')) fail('invalid_wsl_distribution');
  if (!Number.isInteger(config.cpuCount) || config.cpuCount < 2 || config.cpuCount > 8) fail('invalid_cpu_count');
  if (!Number.isInteger(config.memoryGiB) || config.memoryGiB < 2 || config.memoryGiB > 8) fail('invalid_memory_gib');
  if (!SSH_USER.test(config.sshUser ?? '')) fail('invalid_ssh_user');
  return Object.freeze({
    schemaVersion: WORKER_CONFIG_VERSION,
    vmName: config.vmName,
    vmDirectory: config.vmDirectory,
    switchName: config.switchName,
    wslDistribution: config.wslDistribution,
    cpuCount: config.cpuCount,
    memoryGiB: config.memoryGiB,
    sshUser: config.sshUser,
  });
}

/** Files derived from the VM directory keep host/guest layout in sync. */
export function workerPaths(config) {
  return Object.freeze({
    keyPath: `${config.vmDirectory}\\judge_ed25519`,
    publicKeyPath: `${config.vmDirectory}\\judge_ed25519.pub`,
    knownHostsPath: `${config.vmDirectory}\\known_hosts`,
  });
}
