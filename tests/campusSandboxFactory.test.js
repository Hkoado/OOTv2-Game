import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ATTESTATION_PROFILE, assertCampusSandboxReady, createCampusSessionFactory, validateAttestation }
  from '../server/judge/campusSandboxFactory.js';

const sha = 'a'.repeat(64);
const iso = (ms) => new Date(ms).toISOString();
function attestation(overrides = {}) {
  return { profile: ATTESTATION_PROFILE, result: 'pass',
    createdAt: iso(Date.now() - 1000), expiresAt: iso(Date.now() + 3600_000),
    host: { kernel: '6.8.0-45-generic', arch: 'x86_64', wsl: false, distro: 'Ubuntu 24.04.3 LTS' },
    versions: { bubblewrap: 'bubblewrap 0.9.0', python: 'Python 3.12.3' },
    cgroupControllers: ['cpu', 'memory', 'pids'],
    seccomp: { mode: 'deny-list.v1', sha256: sha, blocked: 6, probe: true },
    selftest: { full: true, result: 'RESULT pass=14 fail=0' },
    limitations: [], ...overrides };
}
function withFile(t, doc) {
  const dir = mkdtempSync(path.join(tmpdir(), 'oot-attest-'));
  const file = path.join(dir, 'attestation.json');
  writeFileSync(file, typeof doc === 'string' ? doc : JSON.stringify(doc));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { dir, file };
}
const envFor = (file) => ({ OOTV2_CAMPUS_SANDBOX: 'linux-sandbox', OOTV2_SANDBOX_RUNNER: '/srv/ootv2/run-bot.sh',
  OOTV2_SANDBOX_ATTESTATION: file, OOTV2_SANDBOX_CGROUP_ROOT: '/sys/fs/cgroup/ootv2' });

test('attestation must be fresh, non-WSL and prove the seccomp profile', () => {
  const valid = attestation();
  assert.equal(validateAttestation(JSON.stringify(valid)).seccomp.mode, 'deny-list.v1');
  assert.throws(() => validateAttestation('not json'), { code: 'invalid_attestation' });
  assert.throws(() => validateAttestation(JSON.stringify(attestation({ result: 'dev-only' }))), { code: 'invalid_attestation' });
  assert.throws(() => validateAttestation(JSON.stringify(attestation({ expiresAt: iso(Date.now() - 1000) }))),
    { code: 'attestation_expired' });
  assert.throws(() => validateAttestation(JSON.stringify(attestation({ host: { kernel: '6.6.0-microsoft-standard-WSL2', wsl: true } }))),
    { code: 'wsl_not_production' });
  assert.equal(validateAttestation(JSON.stringify(attestation({ host: { kernel: '6.6.0-microsoft-standard-WSL2', wsl: true } })),
    { allowWsl: true }).host.wsl, true);
  assert.throws(() => validateAttestation(JSON.stringify(attestation({ seccomp: { mode: 'off', sha256: sha, probe: true } }))),
    { code: 'seccomp_not_attested' });
  assert.throws(() => validateAttestation(JSON.stringify(attestation({ seccomp: { mode: 'deny-list.v1', sha256: sha, probe: false } }))),
    { code: 'seccomp_not_attested' });
  assert.throws(() => validateAttestation(JSON.stringify(attestation({ seccomp: { mode: 'deny-list.v1', sha256: 'x', probe: true } }))),
    { code: 'invalid_attestation' });
  assert.throws(() => validateAttestation(JSON.stringify(attestation({ host: { kernel: '', wsl: false } }))),
    { code: 'invalid_attestation' });
});

test('trusted-dev vẫn là mode mặc định nhưng phải opt-in tường minh (fail-closed)', async () => {
  const createTrusted = async (options) => ({ options });
  // Thiếu OOTV2_ALLOW_TRUSTED_DEV: không được dựng factory, không chạy bot trên host.
  assert.throws(() => createCampusSessionFactory({ env: {}, createTrusted }),
    { code: 'trusted_dev_not_enabled' });
  assert.throws(() => createCampusSessionFactory({ env: { OOTV2_ALLOW_TRUSTED_DEV: '0' }, createTrusted }),
    { code: 'trusted_dev_not_enabled' });
  assert.throws(() => assertCampusSandboxReady({ env: {}, createTrusted }),
    { code: 'trusted_dev_not_enabled' });

  const factory = createCampusSessionFactory({ env: { OOTV2_ALLOW_TRUSTED_DEV: '1' }, createTrusted });
  assert.equal(factory.mode, 'trusted-dev');
  assert.equal(factory.trustedDev, true, 'worker chỉ bật cờ trusted khi đã opt-in');
  await assert.rejects(factory({ filePath: '/x/bot.py' }), { code: 'trusted_dev_required' });
  const session = await factory({ filePath: '/x/bot.py', trusted: true });
  assert.equal(session.options.trusted, true);
  assert.deepEqual(assertCampusSandboxReady({ env: { OOTV2_ALLOW_TRUSTED_DEV: '1' }, createTrusted }),
    { mode: 'trusted-dev', trustedDev: true });
});

test('linux-sandbox factory fails closed without platform, seccomp, runner or receipt', async (t) => {
  const { file } = withFile(t, attestation());
  const base = envFor(file);
  assert.throws(() => createCampusSessionFactory({ env: base, platform: 'win32' }),
    { code: 'sandbox_platform_unsupported' });
  assert.throws(() => createCampusSessionFactory({ env: { ...base, OOTV2_SANDBOX_SECCOMP: 'off' }, platform: 'linux' }),
    { code: 'seccomp_disabled' });
  assert.throws(() => createCampusSessionFactory({ env: { ...base, OOTV2_SANDBOX_RUNNER: 'run-bot.sh' }, platform: 'linux' }),
    { code: 'invalid_runner' });
  assert.throws(() => createCampusSessionFactory({ env: { ...base, OOTV2_SANDBOX_ATTESTATION: '/nope.json' }, platform: 'linux' }),
    { code: 'attestation_unavailable' });
  assert.throws(() => createCampusSessionFactory({ env: base, platform: 'linux', now: Date.now() + 7200_000 }),
    { code: 'attestation_expired' });
  const wsl = withFile(t, attestation({ host: { kernel: '6.6.0-microsoft-standard-WSL2', wsl: true } }));
  assert.throws(() => createCampusSessionFactory({ env: envFor(wsl.file), platform: 'linux' }),
    { code: 'wsl_not_production' });
});

test('linux-sandbox factory passes artifact, runner, cgroup and seccomp to the adapter', async (t) => {
  const { file } = withFile(t, attestation());
  const calls = [];
  const factory = createCampusSessionFactory({ env: envFor(file), platform: 'linux',
    createSandbox: async (options) => { calls.push(options); return { profile: 'linux-sandbox.v2' }; } });
  assert.equal(factory.mode, 'linux-sandbox');
  assert.equal(factory.trustedDev, false, 'linux-sandbox không bao giờ bật cờ trusted-dev');
  assert.equal(factory.attestation.seccomp.sha256, sha);
  const session = await factory({ filePath: '/bots/a.py', allowedRoot: '/bots', responseTotalMs: 1234, cpuTotalMs: 5000 });
  assert.equal(session.profile, 'linux-sandbox.v2');
  assert.equal(session.attestation.seccomp.probe, true);
  assert.deepEqual(calls[0], { filePath: '/bots/a.py', allowedRoot: '/bots',
    runnerPath: '/srv/ootv2/run-bot.sh', cgroupRoot: '/sys/fs/cgroup/ootv2', seccompMode: 'deny-list.v1',
    responseTotalMs: 1234, cpuTotalMs: 5000 });
  await assert.rejects(factory({ filePath: '/bots/a.py' }), { code: 'invalid_artifact' });
});
