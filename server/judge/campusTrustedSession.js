/** Persistent transport for TRUSTED local fixtures only. NOT an OS sandbox.
 * Does not enforce CPU/RAM/cgroup freeze; never use for public student code.
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { resolveBotPath, resolvePython } from './botRunner.js';
import { BOT_WIRE_LIMITS, BotProtocolError, parseBotJson, validateBotResponse } from '../contracts/botProtocol.js';
import { isProduction } from '../lib/productionSafety.js';

export class CampusInfrastructureError extends Error {
  constructor(code) { super(code); this.name = 'CampusInfrastructureError'; this.code = code; }
}

export async function createTrustedCampusSession({ filePath, allowedRoot, trusted = false, responseTotalMs = 45000 }) {
  if (isProduction()) throw new CampusInfrastructureError('trusted_dev_forbidden');
  if (trusted !== true) throw new CampusInfrastructureError('trusted_dev_required');
  if (!Number.isSafeInteger(responseTotalMs) || responseTotalMs < 1) throw new CampusInfrastructureError('invalid_budget');
  let resolved;
  try { resolved = resolveBotPath(filePath, allowedRoot); } catch { throw new CampusInfrastructureError('invalid_artifact'); }
  const python = resolvePython();
  if (!python) throw new CampusInfrastructureError('python_unavailable');
  let workDir;
  try { workDir = mkdtempSync(path.join(tmpdir(), 'oot-campus-trusted-')); }
  catch { throw new CampusInfrastructureError('temporary_disk_unavailable'); }
  const env = { PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1' };
  for (const key of ['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP']) if (process.env[key]) env[key] = process.env[key];
  let child;
  try {
    child = spawn(python.cmd, [...python.args, '-I', '-S', '-B', resolved], {
      cwd: workDir, env, shell: false, windowsHide: true, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch { rmSync(workDir, { recursive: true, force: true }); throw new CampusInfrastructureError('python_spawn_failed'); }
  let closed = false, closing = false, fault = null, active = null, timer = null, cleanupPromise = null;
  let stdoutBytes = 0, stderrBytes = 0, waitedMs = 0, buffer = Buffer.alloc(0);
  const closedPromise = new Promise((resolve) => child.once('close', () => { closed = true; resolve(); }));
  function rejectActive(error) {
    if (!active) return;
    const current = active; active = null;
    clearTimeout(timer); timer = null;
    waitedMs += performance.now() - current.started;
    current.reject(error);
  }
  function fail(error) {
    if (!fault) fault = error;
    rejectActive(fault);
    if (!closed) child.kill('SIGKILL');
  }
  child.on('error', () => fail(new CampusInfrastructureError('python_spawn_failed')));
  child.stdin.on('error', () => { if (!closing) fail(new BotProtocolError('BOT_CRASH', 'Bot input closed')); });
  child.on('close', () => {
    if (!closing) fail(fault ?? new BotProtocolError('BOT_CRASH', 'Bot exited before game completion'));
  });
  child.stderr.on('data', (chunk) => {
    stderrBytes += chunk.length;
    if (stderrBytes > BOT_WIRE_LIMITS.stderrBytes) fail(new BotProtocolError('OUTPUT_LIMIT', 'stderr budget exceeded'));
    // Private output is counted but never copied into public results/logs or error text.
  });
  child.stdout.on('data', (chunk) => {
    if (fault || closing) return;
    stdoutBytes += chunk.length;
    if (stdoutBytes > BOT_WIRE_LIMITS.stdoutBytes) { fail(new BotProtocolError('OUTPUT_LIMIT', 'stdout budget exceeded')); return; }
    if (!active || active.received) { fail(new BotProtocolError('PROTOCOL_ERROR', 'Unsolicited bot output')); return; }
    buffer = Buffer.concat([buffer, chunk]);
    const newline = buffer.indexOf(10);
    if (buffer.length > BOT_WIRE_LIMITS.responseBytes) { fail(new BotProtocolError('OUTPUT_LIMIT', 'Response line budget exceeded')); return; }
    if (newline < 0) return;
    if (newline !== buffer.length - 1) { fail(new BotProtocolError('PROTOCOL_ERROR', 'Extra output for request')); return; }
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
    } catch (error) { fail(error); }
  });
  return {
    profile: 'trusted-dev-persistent.v1', pid: child.pid,
    request(request) {
      if (fault) return Promise.reject(fault);
      if (closed || closing) return Promise.reject(new CampusInfrastructureError('session_closed'));
      if (active) return Promise.reject(new CampusInfrastructureError('concurrent_bot_request'));
      const input = Buffer.from(JSON.stringify(request) + '\n');
      if (input.length > BOT_WIRE_LIMITS.requestBytes) return Promise.reject(new CampusInfrastructureError('input_budget'));
      const budget = Math.min(request.limits.responseWallMs, responseTotalMs - waitedMs);
      if (budget <= 0) return Promise.reject(new BotProtocolError('BOT_TIMEOUT', 'Total response wall budget exhausted'));
      return new Promise((resolve, reject) => {
        active = { request, resolve, reject, received: false, started: performance.now() };
        timer = setTimeout(() => fail(new BotProtocolError('BOT_TIMEOUT', 'Response wall budget exhausted')), budget);
        child.stdin.write(input, (error) => { if (error && !closing) fail(new BotProtocolError('BOT_CRASH', 'Bot input failed')); });
      });
    },
    metrics: () => ({ stdoutBytes, stderrBytes, responseWallMs: waitedMs, cpuMeasured: false, memoryMeasured: false }),
    close() {
      if (cleanupPromise) return cleanupPromise;
      cleanupPromise = (async () => {
        closing = true;
        rejectActive(new CampusInfrastructureError('session_cancelled'));
        child.stdin.destroy();
        if (!closed) {
          if (process.platform === 'win32' && child.pid) {
            spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 3000, shell: false });
          } else if (child.pid) {
            try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
          }
        }
        let timeout;
        try {
          await Promise.race([closedPromise, new Promise((_, reject) => {
            timeout = setTimeout(() => reject(new CampusInfrastructureError('cleanup_not_confirmed')), 5000);
          })]);
        } finally { clearTimeout(timeout); rmSync(workDir, { recursive: true, force: true }); }
      })();
      return cleanupPromise;
    },
  };
}