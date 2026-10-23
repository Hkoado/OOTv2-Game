import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BOT_WIRE_LIMITS, parseBotJson, validateBotResponse, buildCampusBotRequest, BotProtocolError } from '../server/contracts/botProtocol.js';
import { createCampusGame, applyCampusSetup } from '../server/judge/campusEngine.js';
import { runCampusMatch } from '../server/judge/campusMatchRunner.js';
import { createTrustedCampusSession, CampusInfrastructureError } from '../server/judge/campusTrustedSession.js';
import { resolvePython } from '../server/judge/botRunner.js';
import { EMPTY_MAP } from '../src/game/maps.js';
import { verifyCampusReplay } from '../server/replay/campusReplay.js';

const root = fileURLToPath(new URL('../examples/', import.meta.url));
const bot = { filePath: path.join(root, 'campus_bot.py'), allowedRoot: root };
const game = () => createCampusGame({ id: 'runtime-test', map: EMPTY_MAP, seed: 0 });
const request = () => buildCampusBotRequest(game(), 'red', 1, { responseWallMs: 3000 });
const skip = resolvePython() ? false : 'Python unavailable: trusted-dev integration NOT RUN';
function fixture(t, source) {
  const dir = mkdtempSync(path.join(tmpdir(), 'oot-campus-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const filePath = path.join(dir, 'bot.py'); writeFileSync(filePath, source);
  return { filePath, allowedRoot: dir };
}

test('bot.v1 strict parser rejects duplicate escaped keys, trailing data, depth, UTF-8 and nonfinite numbers', () => {
  for (const text of ['{"x":1,"x":2}', '{"x":1,"\\u0078":2}', '{"x":{"a":1,"a":2}}',
    '{"a":NaN}', '{"a":Infinity}', '{"a":1e999}', '{}{}', '[]', 'null', '{"a":01}', '{"a":1,}',
    '{"a":' + '['.repeat(18) + '0' + ']'.repeat(18) + '}', '{"x":"bad\nstring"}']) {
    assert.throws(() => parseBotJson(text), BotProtocolError, text);
  }
  assert.throws(() => parseBotJson(Buffer.from([0xff])), /UTF-8/);
  assert.throws(() => parseBotJson(' '.repeat(BOT_WIRE_LIMITS.responseBytes + 1)), { code: 'OUTPUT_LIMIT' });
  assert.deepEqual(parseBotJson('{"a":"\\\"hello","b":[true,false,null,-2.5e2]}'), { a: '"hello', b: [true, false, null, -250] });
});

test('bot.v1 responses bind exact request ID/kind/schema and observation preserves blue setup advantage', () => {
  let state = game();
  const red = buildCampusBotRequest(state, 'red', 1, { responseWallMs: 5000 });
  assert.equal(red.kind, 'setup'); assert.equal(red.game.unplaced.length, 9);
  const placements = red.game.unplaced.map((p, i) => ({ pieceId: p.id, square: red.game.availableSquares[i] }));
  const response = { protocolVersion: 'bot.v1', requestId: red.requestId, kind: 'setup', placements };
  assert.deepEqual(validateBotResponse(red, response), { placements });
  for (const bad of [{ ...response, extra: 1 }, { ...response, requestId: 'stale' }, { ...response, kind: 'move' },
    { ...response, placements: placements.slice(1) }, { ...response, protocolVersion: 1 }]) {
    assert.throws(() => validateBotResponse(red, bad), { code: 'PROTOCOL_ERROR' });
  }
  assert.throws(() => buildCampusBotRequest(state, 'blue', 2, { responseWallMs: 1000 }));
  state = applyCampusSetup(state, 'red', placements);
  const blue = buildCampusBotRequest(state, 'blue', 2, { responseWallMs: 5000 });
  assert.equal(blue.game.pieces.length, 9); assert.equal(blue.game.you, 'blue');
  blue.game.map.blocked.push('e5'); assert.deepEqual(state.map.blocked, []);
});

test('trusted persistent sample keeps one process across requests; environment secrets absent', { skip }, async (t) => {
  const trusted = fixture(t, `import sys,json,os\nn=0\nfor line in sys.stdin:\n r=json.loads(line);n+=1\n assert 'SUPABASE_SERVICE_ROLE_KEY' not in os.environ\n assert 'OOTV2_RUNTIME_TEST_SECRET' not in os.environ\n g=r['game']\n assert n==int(r['requestId'].split(':')[-1])\n print(json.dumps({'protocolVersion':'bot.v1','requestId':r['requestId'],'kind':'setup','placements':[{'pieceId':p['id'],'square':s} for p,s in zip(g['unplaced'],g['availableSquares'])]}),flush=True)\n`);
  process.env.OOTV2_RUNTIME_TEST_SECRET = 'test-only-not-a-real-secret';
  t.after(() => { delete process.env.OOTV2_RUNTIME_TEST_SECRET; });
  const session = await createTrustedCampusSession({ ...trusted, trusted: true });
  t.after(() => session.close());
  const pid = session.pid;
  assert.equal((await session.request(request())).placements.length, 9);
  const next = request(); next.requestId = 'runtime-test:2';
  assert.equal((await session.request(next)).placements.length, 9);
  assert.equal(session.pid, pid); assert.equal(session.metrics().cpuMeasured, false);
});

test('trusted transport requires opt-in and separates bad artifact from bot faults', async () => {
  await assert.rejects(createTrustedCampusSession(bot), { code: 'trusted_dev_required' });
  await assert.rejects(createTrustedCampusSession({ ...bot, filePath: 'missing.py', trusted: true }), CampusInfrastructureError);
});

for (const [label, source, code] of [
  ['partial line without flush/newline', "import sys,time\nsys.stdin.readline()\nsys.stdout.write('{}');sys.stdout.flush();time.sleep(10)", 'BOT_TIMEOUT'],
  ['stdout flood', "import sys\nsys.stdin.readline()\nprint('x'*20000,flush=True)", 'OUTPUT_LIMIT'],
  ['stderr flood', "import sys,time\nsys.stdin.readline()\nsys.stderr.write('x'*270000);sys.stderr.flush();time.sleep(10)", 'OUTPUT_LIMIT'],
  ['duplicate response', "import sys\nsys.stdin.readline()\nsys.stdout.write('{}\\n{}\\n');sys.stdout.flush()", 'PROTOCOL_ERROR'],
  ['crash', "import sys\nsys.stdin.readline()\nsys.exit(2)", 'BOT_CRASH'],
  ['duplicate key', "import sys,time\nsys.stdin.readline()\nprint('{\"x\":1,\"x\":2}',flush=True);time.sleep(10)", 'INVALID_JSON'],
]) {
  test(`trusted transport ${label} -> ${code}`, { skip }, async (t) => {
    const session = await createTrustedCampusSession({ ...fixture(t, source), trusted: true });
    t.after(() => session.close());
    const input = request(); input.limits.responseWallMs = code === 'BOT_TIMEOUT' ? 250 : 3000;
    await assert.rejects(session.request(input), { code });
    await session.close();
  });
}

test('Campus trusted sample vs sample produces verified deterministic Campus replay without MVP changes', { skip, timeout: 30000 }, async () => {
  const input = { id: 'sample-game', map: EMPTY_MAP, seed: 101, red: bot, blue: bot, trusted: true };
  const first = await runCampusMatch(input), second = await runCampusMatch(input);
  assert.equal(first.productionReady, false); assert.ok(first.plyCount <= 400);
  assert.equal(verifyCampusReplay(first.replay).finished, true);
  assert.equal(first.replay.contentHash, second.replay.contentHash);
  assert.ok(first.replay.events.length >= 3);
});

test('Campus active-side faults only; infrastructure/cancellation/cleanup never award bot losses', async () => {
  const seen = [];
  await assert.rejects(runCampusMatch({ id: 'infra', map: EMPTY_MAP, seed: 0,
    startSession: async () => { throw new CampusInfrastructureError('storage_unavailable'); } }), { code: 'storage_unavailable' });
  const outcome = await runCampusMatch({ id: 'fault', map: EMPTY_MAP, seed: 0, startSession: async () => ({
    request: async (input) => { seen.push(input.game.you); throw new BotProtocolError('BOT_TIMEOUT', 'fixture'); },
    metrics: () => ({}), close: async () => {},
  }) });
  assert.deepEqual(seen, ['red']); assert.equal(outcome.result, 'blue_win');
  assert.equal(outcome.replay.events[0].action.player, 'red');
  const signal = AbortSignal.abort();
  await assert.rejects(runCampusMatch({ id: 'abort', map: EMPTY_MAP, seed: 0, signal, startSession: async () => assert.fail() }), { code: 'match_cancelled' });
  await assert.rejects(runCampusMatch({ id: 'cleanup', map: EMPTY_MAP, seed: 0, startSession: async () => ({
    request: async () => { throw new BotProtocolError('BOT_CRASH', 'fixture'); }, metrics: () => ({}),
    close: async () => { throw new Error('fixture'); },
  }) }), { code: 'cleanup_not_confirmed' });
});

test('Campus semantic invalid setup is adjudicated, not mislabeled infrastructure', async () => {
  const outcome = await runCampusMatch({ id: 'setup-fault', map: EMPTY_MAP, seed: 0, startSession: async () => ({
    request: async () => ({ placements: [] }), metrics: () => ({}), close: async () => {},
  }) });
  assert.equal(outcome.result, 'blue_win'); assert.equal(outcome.reason, 'INVALID_SETUP');
  assert.equal(verifyCampusReplay(outcome.replay).ok, true);
});

test('Campus blue fault waits for red setup; illegal red move is attributed only to red', async () => {
  const makeSession = (faultPlayer, illegal = false) => async () => ({
    request: async (input) => {
      if (input.game.you === faultPlayer && (!illegal || input.kind === 'move')) {
        if (illegal) return { pieceId: 'blue_rock_0', to: 'z9' };
        throw new BotProtocolError('BOT_CRASH', 'fixture');
      }
      return { placements: input.game.unplaced.map((p, i) => ({ pieceId: p.id, square: input.game.availableSquares[i] })) };
    }, metrics: () => ({}), close: async () => {},
  });
  const blue = await runCampusMatch({ id: 'blue-fault', map: EMPTY_MAP, seed: 0, startSession: makeSession('blue') });
  assert.equal(blue.result, 'red_win'); assert.equal(blue.replay.events.length, 2);
  assert.equal(blue.replay.events[1].action.player, 'blue');
  const red = await runCampusMatch({ id: 'illegal', map: EMPTY_MAP, seed: 0, startSession: makeSession('red', true) });
  assert.equal(red.reason, 'ILLEGAL_MOVE'); assert.equal(red.result, 'blue_win');
});

test('Campus mid-request cancellation closes sessions once and returns infrastructure error', async () => {
  const controller = new AbortController(); let closed = 0, rejectRequest;
  const timer = setTimeout(() => controller.abort(), 30);
  try {
    await assert.rejects(runCampusMatch({ id: 'cancel-mid', map: EMPTY_MAP, seed: 0, signal: controller.signal,
      startSession: async () => ({
        request: () => new Promise((_, reject) => { rejectRequest = reject; }), metrics: () => ({}),
        close: async () => { if (closed++) return; rejectRequest(new CampusInfrastructureError('session_cancelled')); },
      }),
    }), { code: 'match_cancelled' });
    assert.ok(closed >= 1);
  } finally { clearTimeout(timer); }
});