/** Real Linux sandbox acceptance; only repository fixtures, no DB/API/queue access.
 * Must run under tools/provision/test-main-gates.sh, never on the API host.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { createCampusSessionFactory, assertCampusSandboxReady } from '../../server/judge/campusSandboxFactory.js';
import { runCampusMatch } from '../../server/judge/campusMatchRunner.js';
import { createCampusGame } from '../../server/judge/campusEngine.js';
import { buildCampusBotRequest } from '../../server/contracts/botProtocol.js';
import { createOfficialRuntimeIdentity, OFFICIAL_BUDGET } from '../../server/judge/officialRuntime.js';
import { verifyCampusReplay } from '../../server/replay/campusReplay.js';
import { SAMPLE_MAPS } from '../../src/game/sampleMaps.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
if (process.platform !== 'linux' || process.getuid?.() !== 0 || process.env.OOTV2_ISOLATED_DRILL !== '1'
  || process.env.NODE_ENV !== 'production' || !process.env.OOTV2_SANDBOX_CGROUP_ROOT?.startsWith('/sys/fs/cgroup/ootv2-drill-')) {
  throw new Error('isolated_linux_drill_required');
}
const receiptPath = process.env.OOTV2_SANDBOX_ATTESTATION;
const receipt = readFileSync(receiptPath);
const scratch = mkdtempSync(path.join(tmpdir(), 'ootv2-main-gates-'));
const checks = [];
const active = new Set();
const source = readFileSync(path.join(root, 'examples/campus_bot.py'));
const bot = path.join(scratch, 'bot.py');
writeFileSync(bot, source, { mode: 0o600 });
const side = { filePath: bot, allowedRoot: scratch, ...OFFICIAL_BUDGET };
const check = async (name, run) => {
  try { await run(); checks.push({ name, ok: true }); console.log(`PASS ${name}`); }
  catch (error) { checks.push({ name, ok: false, code: error.code ?? error.name }); console.error(`FAIL ${name}: ${error.code ?? error.message}`); }
};
const create = async (factory, input = side) => {
  const session = await factory(input); active.add(session); return session;
};
const close = async (session) => { await session.close(); active.delete(session); };
const request = (id) => buildCampusBotRequest(createCampusGame({ id, seed: 42, map: SAMPLE_MAPS[0].map }), 'red', 1,
  { responseWallMs: 5000, cpuRemainingMs: OFFICIAL_BUDGET.cpuTotalMs });
const emptyCgroups = () => {
  try { return readdirSync(process.env.OOTV2_SANDBOX_CGROUP_ROOT).filter((name) => !name.startsWith('cgroup.')
    && !name.startsWith('cpu.') && !name.startsWith('memory.') && !name.startsWith('pids.')).length === 0; }
  catch (error) { if (error.code === 'ENOENT') return true; throw error; }
};

try {
  await check('production preflight and full attestation', () => {
    assert.deepEqual(assertCampusSandboxReady(), { mode: 'linux-sandbox', trustedDev: false });
  });
  const factory = createCampusSessionFactory();
  await check('expired receipt blocks a long-lived factory before spawn', async () => {
    const doc = JSON.parse(receipt);
    doc.expiresAt = new Date(Date.now() - 1000).toISOString();
    try {
      writeFileSync(receiptPath, JSON.stringify(doc));
      await assert.rejects(factory(side), { code: 'attestation_expired' });
    } finally { writeFileSync(receiptPath, receipt); }
  });
  await check('runner hash mismatch fails closed', async () => {
    const doc = JSON.parse(receipt); doc.artifacts.runner = '0'.repeat(64);
    try {
      writeFileSync(receiptPath, JSON.stringify(doc));
      await assert.rejects(factory(side), { code: 'sandbox_artifact_mismatch' });
    } finally { writeFileSync(receiptPath, receipt); }
  });
  await check('two concurrent sessions have separate cgroups and exact pinned limits', async () => {
    const sessions = await Promise.all([create(factory), create(factory)]);
    try {
      const responses = await Promise.all(sessions.map((session, i) => session.request(request(`parallel-${i}`))));
      assert.ok(responses.every((response) => response.placements.length === 9));
      const metrics = sessions.map((session) => session.metrics());
      assert.notEqual(metrics[0].cgroup, metrics[1].cgroup);
      for (const metric of metrics) {
        assert.equal(readFileSync(path.join(metric.cgroup, 'memory.max'), 'utf8').trim(), String(OFFICIAL_BUDGET.memoryBytes));
        assert.equal(readFileSync(path.join(metric.cgroup, 'pids.max'), 'utf8').trim(), String(OFFICIAL_BUDGET.pids));
        assert.equal(readFileSync(path.join(metric.cgroup, 'memory.swap.max'), 'utf8').trim(), '0');
        assert.equal(metric.cpuBudgetMs, OFFICIAL_BUDGET.cpuTotalMs);
      }
    } finally { await Promise.all(sessions.map(close)); }
    assert.ok(emptyCgroups());
  });
  await check('real Campus v2 match uses sealed setup and produces verified replay', async () => {
    const outcome = await runCampusMatch({ id: 'main-gates', seed: 4242, map: SAMPLE_MAPS[0].map,
      red: { ...side, name: 'red' }, blue: { ...side, name: 'blue' }, startSession: factory });
    assert.ok(['red_win', 'blue_win', 'draw'].includes(outcome.result));
    assert.equal(verifyCampusReplay(outcome.replay).ok, true);
    assert.deepEqual(outcome.sandboxProfiles, ['linux-sandbox.v2']);
    assert.ok(emptyCgroups());
  });
  await check('interrupted match is infrastructure, cleans up, next match can recover', async () => {
    const controller = new AbortController();
    const sleeping = path.join(root, 'sandbox/fixtures/sleep.py');
    const interrupt = setTimeout(() => controller.abort(), 500);
    try {
      await assert.rejects(runCampusMatch({ id: 'interrupt', seed: 5, map: SAMPLE_MAPS[0].map,
        red: { filePath: sleeping, allowedRoot: path.dirname(sleeping), ...OFFICIAL_BUDGET },
        blue: side, startSession: factory, signal: controller.signal }), { code: 'match_cancelled' });
    } finally { clearTimeout(interrupt); }
    assert.ok(emptyCgroups());
    const session = await create(factory);
    try { assert.equal((await session.request(request('recovered'))).placements.length, 9); }
    finally { await close(session); }
  });
  await check('stdout flood stays bounded through real Node adapter', async () => {
    const flood = path.join(root, 'sandbox/fixtures/flood.py');
    const session = await create(factory, { ...side, filePath: flood, allowedRoot: path.dirname(flood) });
    try { await assert.rejects(session.request(request('flood')), (error) => ['OUTPUT_LIMIT', 'PROTOCOL_ERROR'].includes(error.code)); }
    finally { await close(session); }
    assert.ok(emptyCgroups());
  });
  await check('all fixture cgroups cleaned', async () => {
    await sleep(100);
    assert.ok(emptyCgroups());
  });
} finally {
  await Promise.allSettled([...active].map((session) => session.close()));
  writeFileSync(receiptPath, receipt);
  rmSync(scratch, { recursive: true, force: true });
}
const identity = createOfficialRuntimeIdentity();
console.log(JSON.stringify({ schemaVersion: 'sandbox-main-gates.v1', runtimeVersion: identity.runtimeVersion,
  runtimeHash: identity.runtimeHash, budgetHash: identity.budgetHash,
  fixtureSha256: createHash('sha256').update(source).digest('hex'), checks,
  database: 'NOT_RUN', serviceDeployment: 'NOT_RUN', result: checks.every((item) => item.ok) ? 'pass' : 'fail' }));
process.exitCode = checks.every((item) => item.ok) ? 0 : 1;