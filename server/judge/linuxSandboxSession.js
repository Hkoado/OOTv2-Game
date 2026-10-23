/** Node session over the Linux bwrap/cgroup runner. Never claims production isolation:
 * no seccomp/attestation and no per-request CPU/RAM measurement yet.
 */
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { resolveBotPath } from './botRunner.js';
import { CampusInfrastructureError } from './campusTrustedSession.js';
import { BOT_WIRE_LIMITS, BotProtocolError, parseBotJson, validateBotResponse } from '../contracts/botProtocol.js';

const CPU_MAX = /^\d{1,9} \d{1,9}$/;
const fail = (code) => new CampusInfrastructureError(code);
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
  memoryBytes = 268435456, pids = 32, cpuMax = '50000 100000', timeoutMs = 60000,
  responseTotalMs = 45000, spawnProcess = spawn, killProcess = defaultKill,
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
  let resolved;
  try { resolved = resolveBotPath(filePath, allowedRoot); } catch { throw fail('invalid_artifact'); }
  const args = ['--bot', resolved, '--timeout-ms', String(timeoutMs), '--memory-bytes', String(memoryBytes),
    '--pids', String(pids), '--cpu-max', cpuMax];
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
  const closedPromise = new Promise((resolve) => child.once('close', () => { closed = true; resolve(); }));
  function rejectActive(error) {
    if (!active) return;
    const current = active; active = null;
    clearTimeout(timer); timer = null;
    waitedMs += performance.now() - current.started;
    current.reject(error);
  }
  function failSession(error) {
    if (!fault) fault = error;
    rejectActive(fault);
    if (!closed) killProcess(child);
  }
  child.on('error', () => failSession(fail('sandbox_spawn_failed')));
  child.stdin.on('error', () => { if (!closing) failSession(new BotProtocolError('BOT_CRASH', 'Bot input closed')); });
  child.on('close', (code) => {
    if (closing) return;
    if (code === 78 || sandboxError) failSession(fail('sandbox_unavailable'));
    else if (code === 124) failSession(new BotProtocolError('BOT_TIMEOUT', 'Sandbox wall timeout'));
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
        clearTimeout(timer); timer = null;
        waitedMs += performance.now() - current.started;
        current.resolve(result);
      });
    } catch (error) { failSession(error); }
  });
  return {
    profile: 'linux-sandbox.v1', pid: child.pid, productionReady: false,
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
      return new Promise((resolve, reject) => {
        active = { request, resolve, reject, received: false, started: performance.now() };
        timer = setTimeout(() => failSession(new BotProtocolError('BOT_TIMEOUT', 'Response wall budget exhausted')), budget);
        child.stdin.write(input, (error) => {
          if (error && !closing) failSession(new BotProtocolError('BOT_CRASH', 'Bot input failed'));
        });
      });
    },
    metrics: () => ({ stdoutBytes, stderrBytes, responseWallMs: waitedMs, cpuMeasured: false,
      memoryMeasured: false, sandboxProfile: 'linux-sandbox.v1' }),
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
