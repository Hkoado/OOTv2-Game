import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createLinuxSandboxSession } from '../server/judge/linuxSandboxSession.js';

class FakeChild extends EventEmitter {
  constructor() {
    super();
    this.pid = 4242;
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.stdin = new EventEmitter();
    this.stdin.written = [];
    this.stdin.destroy = () => {};
    this.stdin.write = (chunk, callback) => {
      this.stdin.written.push(Buffer.from(chunk));
      if (callback) process.nextTick(callback);
      return true;
    };
    this.killed = [];
  }
  kill(signal) {
    this.killed.push(signal);
    setImmediate(() => this.emit('close', null));
    return true;
  }
}

function setup(t, overrides = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'oot-sandbox-session-'));
  const bot = path.join(root, 'bot.py');
  writeFileSync(bot, 'print("fixture")\n');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const child = new FakeChild();
  const calls = [];
  const options = {
    filePath: bot, allowedRoot: root, runnerPath: path.join(root, 'run-bot.sh'),
    launch: (runner, args) => ({ command: 'fake-runner', args }),
    spawnProcess: (command, args, spawnOptions) => {
      calls.push({ command, args, spawnOptions });
      return child;
    },
    killProcess: (target) => target.kill('SIGKILL'),
    responseTotalMs: 5000, timeoutMs: 4000, ...overrides,
  };
  return { root, bot, child, calls, options };
}
const request = (id, kind = 'move') => ({ protocolVersion: 'bot.v1', requestId: id, kind,
  game: {}, limits: { responseWallMs: 200, cpuRemainingMs: 1000 } });
const reply = (req, body) => `${JSON.stringify({ protocolVersion: 'bot.v1', requestId: req.requestId, kind: req.kind, ...body })}\n`;

test('sandbox session validates platform, runner, limits and artifact path', async (t) => {
  const { root, bot, options } = setup(t);
  if (process.platform !== 'linux') {
    await assert.rejects(createLinuxSandboxSession({ ...options, launch: undefined }), { code: 'sandbox_platform_unsupported' });
  }
  await assert.rejects(createLinuxSandboxSession({ ...options, runnerPath: 'relative.sh' }), { code: 'invalid_runner' });
  await assert.rejects(createLinuxSandboxSession({ ...options, memoryBytes: 1024 }), { code: 'invalid_limits' });
  await assert.rejects(createLinuxSandboxSession({ ...options, pids: 2 }), { code: 'invalid_limits' });
  await assert.rejects(createLinuxSandboxSession({ ...options, cpuMax: 'many' }), { code: 'invalid_limits' });
  await assert.rejects(createLinuxSandboxSession({ ...options, launch: () => null }), { code: 'invalid_launch' });
  await assert.rejects(createLinuxSandboxSession({ ...options, runnerEnv: { PATH: 1 } }), { code: 'invalid_env' });
  const outside = path.join(root, '..', 'outside.py');
  await assert.rejects(createLinuxSandboxSession({ ...options, filePath: outside }), { code: 'invalid_artifact' });
  await assert.rejects(createLinuxSandboxSession({ ...options, filePath: path.join(root, 'bot.txt') }), { code: 'invalid_artifact' });
  assert.ok(bot);
});

test('sandbox session round-trips bot.v1 setup and move responses', async (t) => {
  const { child, options } = setup(t);
  const session = await createLinuxSandboxSession(options);
  const setupRequest = request('game-1:1', 'setup');
  const setupPromise = session.request(setupRequest);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(JSON.parse(child.stdin.written[0].toString('utf8')).requestId, 'game-1:1');
  child.stdout.write(reply(setupRequest, { placements: Array.from({ length: 9 }, (_, index) => ({
    pieceId: `p${index + 1}`, square: `a${index + 1}`,
  })) }));
  const placements = await setupPromise;
  assert.equal(placements.placements.length, 9);

  const moveRequest = request('game-1:2', 'move');
  const movePromise = session.request(moveRequest);
  await new Promise((resolve) => setImmediate(resolve));
  child.stdout.write(reply(moveRequest, { pieceId: 'p1', to: 'a1' }));
  assert.deepEqual(await movePromise, { pieceId: 'p1', to: 'a1' });
  assert.ok(session.metrics().responseWallMs >= 0);
  await session.close();
});

test('sandbox session rejects a wrong envelope and kills the runner', async (t) => {
  const { child, options } = setup(t);
  const session = await createLinuxSandboxSession(options);
  const req = request('bad:1');
  const pending = session.request(req);
  await new Promise((resolve) => setImmediate(resolve));
  child.stdout.write(`${JSON.stringify({ protocolVersion: 'bot.v1', requestId: 'other', kind: 'move',
    pieceId: 'p1', to: 'a1' })}\n`);
  await assert.rejects(pending, { code: 'PROTOCOL_ERROR' });
  assert.ok(child.killed.includes('SIGKILL'));
  await assert.rejects(session.request(req), { code: 'PROTOCOL_ERROR' });
});

test('sandbox session enforces per-request and output budgets before writing', async (t) => {
  const { child, options } = setup(t);
  const session = await createLinuxSandboxSession(options);
  await assert.rejects(session.request({ ...request('zero:1'), limits: { responseWallMs: 0 } }),
    { code: 'BOT_TIMEOUT' });
  assert.equal(child.stdin.written.length, 0);
  const req = request('flood:1');
  const pending = session.request(req);
  await new Promise((resolve) => setImmediate(resolve));
  child.stdout.write(Buffer.alloc(4 * 1024 * 1024 + 1, 32));
  await assert.rejects(pending, { code: 'OUTPUT_LIMIT' });
  assert.ok(child.killed.includes('SIGKILL'));
});

test('sandbox session maps wall timeout, runner exit and spawn failure', async (t) => {
  const timed = setup(t);
  const session = await createLinuxSandboxSession(timed.options);
  await assert.rejects(session.request({ ...request('slow:1'), limits: { responseWallMs: 25 } }),
    { code: 'BOT_TIMEOUT' });
  assert.ok(timed.child.killed.includes('SIGKILL'));

  const exited = setup(t);
  const second = await createLinuxSandboxSession(exited.options);
  const pending = second.request(request('exit:1'));
  await new Promise((resolve) => setImmediate(resolve));
  exited.child.emit('close', 78);
  await assert.rejects(pending, { code: 'sandbox_unavailable' });

  await assert.rejects(createLinuxSandboxSession({ ...timed.options,
    spawnProcess: () => { throw new Error('no runner'); } }), { code: 'sandbox_spawn_failed' });
});

test('sandbox session close cancels work and rejects later requests', async (t) => {
  const { child, options } = setup(t);
  const session = await createLinuxSandboxSession(options);
  const pending = session.request(request('close:1'));
  const cancelled = assert.rejects(pending, { code: 'session_cancelled' });
  await new Promise((resolve) => setImmediate(resolve));
  await session.close();
  await cancelled;
  await assert.rejects(session.request(request('close:2')), { code: 'session_closed' });
  assert.ok(child.killed.includes('SIGKILL'));
  await session.close();
});

test('sandbox session spawns the runner with explicit limits, no shell and empty env', async (t) => {
  const { child, calls, options } = setup(t, { memoryBytes: 67108864, pids: 16, cpuMax: '20000 100000' });
  const session = await createLinuxSandboxSession(options);
  assert.equal(session.profile, 'linux-sandbox.v1');
  assert.equal(session.productionReady, false);
  assert.equal(calls.length, 1);
  const { command, args, spawnOptions } = calls[0];
  assert.equal(command, 'fake-runner');
  assert.equal(spawnOptions.shell, false);
  assert.deepEqual(spawnOptions.env, { PATH: '/usr/bin:/bin' });
  assert.deepEqual(args.slice(0, 2), ['--bot', realpathSync(options.filePath)]);
  assert.deepEqual(args.slice(2), ['--timeout-ms', '4000', '--memory-bytes', '67108864',
    '--pids', '16', '--cpu-max', '20000 100000']);
  await session.close();
  assert.deepEqual(child.killed, ['SIGKILL']);
});
