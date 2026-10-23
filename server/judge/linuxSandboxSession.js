/** Node session over the Linux bwrap/cgroup runner. Enforces wall/CPU budgets
 * from cgroup counters and reports the seccomp mode, but does not attest the host:
 * productionReady stays false until the VM/attestation checklist is met.
 */
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { resolveBotPath } from './botRunner.js';
import { CampusInfrastructureError } from './campusTrustedSession.js';
import { BOT_WIRE_LIMITS, BotProtocolError, parseBotJson, validateBotResponse } from '../contracts/botProtocol.js';

const CPU_MAX = /^\d{1,9} \d{1,9}$/;
const CGROUP_ID = /^[A-Za-z0-9_-]{8,64}$/;
const SECCOMP_MODES = new Set(['deny-list.v1', 'off']);
const fail = (code) => new CampusInfrastructureError(code);
function readUsec(file) {
  const match = /^usage_usec (\d+)$/m.exec(readFileSync(file, 'utf8'));
  return match ? Number(match[1]) : null;
}
function readNumber(file) {
  const value = Number(readFileSync(file, 'utf8').trim());
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}
function readOomKills(file) {
  const match = /^oom_kill (\d+)$/m.exec(readFileSync(file, 'utf8'));
  return match ? Number(match[1]) : 0;
}
const defaultKill = (child) => {
  if (process.platform === 'win32' && child.pid) {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'],
      { windowsHide: true, stdio: 'ignore', timeout: 3000, shell: false });
  } else {
    child.kill('SIGTERM');
    setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL'); }, 2000).unref?.();
  }
};
function assertPositiveInt(value, min, max, code) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw fail(code);
  return value;
}

export async function createLinuxSandboxSession({ filePath, allowedRoot, runnerPath, launch,
  memoryBytes = 134217728, pids = 16, cpuMax = '100000 100000', timeoutMs = 60000,
  responseTotalMs = 45000, cpuTotalMs = 20000, cgroupRoot = '/sys/fs/cgroup/ootv2-sandbox',
  cgroupId = randomUUID(), measureResources = process.platform === 'linux',
  seccompMode = 'deny-list.v1', spawnProcess = spawn, killProcess = defaultKill,
  runnerEnv = { PATH: '/usr/bin:/bin' } } = {}) {
  if (process.platform !== 'linux' && typeof launch !== 'function') throw fail('sandbox_platform_unsupported');
  if (typeof runnerPath !== 'string' || !path.isAbsolute(runnerPath)) throw fail('invalid_runner');
  if (typeof spawnProcess !== 'function' || typeof killProcess !== 'function') throw fail('invalid_spawn');
  if (!runnerEnv || typeof runnerEnv !== 'object' || Array.isArray(runnerEnv)
    || Object.values(runnerEnv).some((value) => typeof value !== 'string')) throw fail('invalid_env');
  if (!CPU_MAX.test(cpuMax)) throw fail('invalid_limits');
  assertPositiveInt(memoryBytes, 33554432, 2147483648, 'invalid_limits');
  assertPositiveInt(pids, 4, 256, 'invalid_limits');
  assertPositiveInt(timeoutMs, 1000, 120000, 'invalid_limits');
  assertPositiveInt(responseTotalMs, 1, 120000, 'invalid_limits');
  assertPositiveInt(cpuTotalMs, 100, 120000, 'invalid_limits');
  if (typeof cgroupRoot !== 'string' || !path.isAbsolute(cgroupRoot) || cgroupRoot.includes('..')) {
    throw fail('invalid_cgroup');
  }
  if (!CGROUP_ID.test(cgroupId)) throw fail('invalid_cgroup');
  if (!SECCOMP_MODES.has(seccompMode)) throw fail('invalid_seccomp');
  if (typeof measureResources !== 'boolean') throw fail('invalid_limits');
  let resolved;
  try { resolved = resolveBotPath(filePath, allowedRoot); } catch { throw fail('invalid_artifact'); }
  const cpuSeconds = Math.min(120, Math.ceil(cpuTotalMs / 1000) + 5);
  const cgroupDir = path.join(cgroupRoot, cgroupId);
  const args = ['--bot', resolved, '--timeout-ms', String(timeoutMs), '--memory-bytes', String(memoryBytes),
    '--pids', String(pids), '--cpu-max', cpuMax, '--cpu-seconds', String(cpuSeconds),
    '--cgroup-root', cgroupRoot, '--cgroup-id', cgroupId, '--seccomp-mode', seccompMode];
  let command = runnerPath; let commandArgs = args;
  if (typeof launch === 'function') {
    const launched = launch(runnerPath, args);
    if (!launched || typeof launched.command !== 'string' || !Array.isArray(launched.args)
      || launched.args.some((value) => typeof value !== 'string')) throw fail('invalid_launch');
    command = launched.command; commandArgs = launched.args;
  }
  let child;
  try {
    child = spawnProcess(command, commandArgs, {
      cwd: path.dirname(resolved), env: runnerEnv, shell: false, windowsHide: true,
      detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch { throw fail('sandbox_spawn_failed'); }
  let closed = false, closing = false, fault = null, active = null, timer = null, cleanupPromise = null;
  let stdoutBytes = 0, stderrBytes = 0, waitedMs = 0, buffer = Buffer.alloc(0), sandboxError = null;
  let cpuTimer = null, cpuBase = null, cpuLast = null, oomBase = null, peakBytes = null;
  const closedPromise = new Promise((resolve) => child.once('close', () => { closed = true; resolve(); }));
  function snapshot() {
    if (!measureResources) return null;
    try {
      return { cpu: readUsec(path.join(cgroupDir, 'cpu.stat')),
        memory: readNumber(path.join(cgroupDir, 'memory.current')),
        peak: readNumber(path.join(cgroupDir, 'memory.peak')),
        oom: readOomKills(path.join(cgroupDir, 'memory.events')) };
    } catch { return null; }
  }
  function ensureCpuBase() {
    if (!measureResources || cpuBase !== null) return;
    const current = snapshot();
    if (current && current.cpu !== null) { cpuBase = current.cpu; cpuLast = current.cpu; oomBase = current.oom; }
  }
  function stopCpuWatch() { if (cpuTimer) clearInterval(cpuTimer); cpuTimer = null; }
  function startCpuWatch() {
    if (!measureResources || cpuTimer) return;
    ensureCpuBase();
    if (cpuBase === null) return;
    cpuTimer = setInterval(() => {
      const current = snapshot();
      if (!current || current.cpu === null) return;
      cpuLast = current.cpu;
      if (current.cpu - cpuBase > cpuTotalMs * 1000) {
        stopCpuWatch();
        failSession(new BotProtocolError('BOT_CPU_LIMIT', 'CPU budget exhausted'));
      }
    }, 50);
    cpuTimer.unref?.();
  }
  function rejectActive(error) {
    if (!active) return;
    const current = active; active = null;
    clearTimeout(timer); timer = null; stopCpuWatch();
    waitedMs += performance.now() - current.started;
    current.reject(error);
  }
  function failSession(error) {
    if (!fault) fault = error;
    stopCpuWatch();
    rejectActive(fault);
    if (!closed) killProcess(child);
  }
  child.on('error', () => failSession(fail('sandbox_spawn_failed')));
  child.stdin.on('error', () => { if (!closing) failSession(new BotProtocolError('BOT_CRASH', 'Bot input closed')); });
  child.on('close', (code) => {
    if (closing) return;
    if (code === 78 || sandboxError) failSession(fail('sandbox_unavailable'));
    else if (code === 124) failSession(new BotProtocolError('BOT_TIMEOUT', 'Sandbox wall timeout'));
    else if (code === 137) failSession(new BotProtocolError('BOT_MEMORY_LIMIT', 'Sandbox memory limit'));
    else failSession(new BotProtocolError('BOT_CRASH', 'Bot exited before game completion'));
  });
  child.stderr.on('data', (chunk) => {
    stderrBytes += chunk.length;
    if (stderrBytes > BOT_WIRE_LIMITS.stderrBytes) {
      failSession(new BotProtocolError('OUTPUT_LIMIT', 'stderr budget exceeded')); return;
    }
    const text = chunk.toString('utf8');
    if (!sandboxError && /^sandbox: /m.test(text)) sandboxError = text.trim().slice(0, 120);
  });
  child.stdout.on('data', (chunk) => {
    if (fault || closing) return;
    stdoutBytes += chunk.length;
    if (stdoutBytes > BOT_WIRE_LIMITS.stdoutBytes) {
      failSession(new BotProtocolError('OUTPUT_LIMIT', 'stdout budget exceeded')); return;
    }
    if (!active || active.received) {
      failSession(new BotProtocolError('PROTOCOL_ERROR', 'Unsolicited bot output')); return;
    }
    buffer = Buffer.concat([buffer, chunk]);
    const newline = buffer.indexOf(10);
    if (buffer.length > BOT_WIRE_LIMITS.responseBytes) {
      failSession(new BotProtocolError('OUTPUT_LIMIT', 'Response line budget exceeded')); return;
    }
    if (newline < 0) return;
    if (newline !== buffer.length - 1) {
      failSession(new BotProtocolError('PROTOCOL_ERROR', 'Extra output for request')); return;
    }
    try {
      const response = parseBotJson(buffer.subarray(0, newline));
      const result = validateBotResponse(active.request, response);
      buffer = Buffer.alloc(0); active.received = true;
      // Yield to pending I/O so an immediately duplicated line is not reattributed.
      setImmediate(() => {
        if (!active || fault) return;
        const current = active; active = null;
        clearTimeout(timer); timer = null; stopCpuWatch();
        const stats = snapshot();
        if (stats && stats.cpu !== null) cpuLast = stats.cpu;
        if (stats && stats.peak !== null) peakBytes = stats.peak;
        waitedMs += performance.now() - current.started;
        current.resolve(result);
      });
    } catch (error) { failSession(error); }
  });
  return {
    profile: 'linux-sandbox.v2', pid: child.pid, productionReady: false,
    limitations: ['No host attestation', 'Deny-list seccomp, not an allowlist',
      'WSL shares the Windows kernel (dev only)'],
    request(request) {
      if (fault) return Promise.reject(fault);
      if (closed || closing) return Promise.reject(fail('session_closed'));
      if (active) return Promise.reject(fail('concurrent_bot_request'));
      const input = Buffer.from(`${JSON.stringify(request)}\n`);
      if (input.length > BOT_WIRE_LIMITS.requestBytes) return Promise.reject(fail('input_budget'));
      const budget = Math.min(request?.limits?.responseWallMs ?? 0, responseTotalMs - waitedMs);
      if (!Number.isSafeInteger(budget) || budget <= 0) {
        return Promise.reject(new BotProtocolError('BOT_TIMEOUT', 'Total response wall budget exhausted'));
      }
      ensureCpuBase();
      startCpuWatch();
      return new Promise((resolve, reject) => {
        active = { request, resolve, reject, received: false, started: performance.now() };
        timer = setTimeout(() => failSession(new BotProtocolError('BOT_TIMEOUT', 'Response wall budget exhausted')), budget);
        child.stdin.write(input, (error) => {
          if (error && !closing) failSession(new BotProtocolError('BOT_CRASH', 'Bot input failed'));
        });
      });
    },
    metrics() {
      const stats = snapshot();
      if (stats && stats.peak !== null) peakBytes = stats.peak;
      const measured = measureResources && cpuBase !== null && cpuLast !== null;
      return { stdoutBytes, stderrBytes, responseWallMs: waitedMs,
        cpuMeasured: measured, cpuUsec: measured ? Math.max(0, cpuLast - cpuBase) : null,
        memoryMeasured: measureResources && stats !== null,
        memoryPeakBytes: peakBytes,
        oomKills: stats ? Math.max(0, stats.oom - (oomBase ?? stats.oom)) : null,
        cpuBudgetMs: cpuTotalMs, seccomp: seccompMode, cgroup: measureResources ? cgroupDir : null,
        sandboxProfile: 'linux-sandbox.v2' };
    },
    close() {
      if (cleanupPromise) return cleanupPromise;
      cleanupPromise = (async () => {
        closing = true;
        rejectActive(fail('session_cancelled'));
        child.stdin.destroy();
        if (!closed) killProcess(child);
        let timeout;
        try {
          await Promise.race([closedPromise, new Promise((_, reject) => {
            timeout = setTimeout(() => reject(fail('cleanup_not_confirmed')), 5000);
          })]);
        } finally { clearTimeout(timeout); }
      })();
      return cleanupPromise;
    },
  };
}
