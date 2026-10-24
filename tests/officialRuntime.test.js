import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  OFFICIAL_BUDGET, OFFICIAL_RUNTIME_FILES, OFFICIAL_RUNTIME_VERSION,
  createOfficialRuntimeIdentity, verifyOfficialRuntimeIdentity,
} from '../server/judge/officialRuntime.js';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

function copyRuntime(root) {
  for (const relativePath of OFFICIAL_RUNTIME_FILES) {
    const target = path.join(root, relativePath);
    mkdirSync(path.dirname(target), { recursive: true });
    const text = readFileSync(path.join(ROOT, relativePath), 'utf8').replace(/\r\n/g, '\n');
    writeFileSync(target, text);
  }
}

test('runtime identity pins file hashes, rules, protocol and budget', () => {
  const identity = createOfficialRuntimeIdentity();
  assert.equal(identity.runtimeVersion, OFFICIAL_RUNTIME_VERSION);
  assert.equal(identity.rulesVersion, 'ott-campus.v2');
  assert.equal(identity.protocolVersion, 'bot.v1');
  assert.match(identity.runtimeHash, /^[a-f0-9]{64}$/);
  assert.match(identity.budgetHash, /^[a-f0-9]{64}$/);
  assert.equal(identity.files.length, OFFICIAL_RUNTIME_FILES.length);
  assert.ok(identity.files.every((file) => /^[a-f0-9]{64}$/.test(file.sha256)));
  assert.equal(verifyOfficialRuntimeIdentity(identity), true);
  assert.equal(Object.isFrozen(identity), true);
  assert.equal(Object.isFrozen(identity.budget), true);
});

test('runtime identity bỏ qua CRLF và đổi budgetHash khi đổi budget', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'ootv2-runtime-'));
  try {
    copyRuntime(root);
    const lf = createOfficialRuntimeIdentity({ rootDir: root });
    const file = path.join(root, OFFICIAL_RUNTIME_FILES[0]);
    writeFileSync(file, readFileSync(file, 'utf8').replace(/\n/g, '\r\n'));
    const crlf = createOfficialRuntimeIdentity({ rootDir: root });
    assert.equal(crlf.runtimeHash, lf.runtimeHash, 'line ending không được đổi hash');
    const changed = createOfficialRuntimeIdentity({
      rootDir: root, budget: { ...OFFICIAL_BUDGET, moveWallMs: 1200 },
    });
    assert.equal(changed.runtimeHash, lf.runtimeHash);
    assert.notEqual(changed.budgetHash, lf.budgetHash);
    assert.equal(verifyOfficialRuntimeIdentity(changed, { rootDir: root }), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('runtime identity từ chối file thiếu, budget sai và hash bị sửa', () => {
  const identity = createOfficialRuntimeIdentity();
  assert.equal(verifyOfficialRuntimeIdentity({ ...identity, runtimeHash: '0'.repeat(64) }), false);
  assert.equal(verifyOfficialRuntimeIdentity({ ...identity, budget: { ...OFFICIAL_BUDGET, pids: 0 } }), false);
  assert.throws(() => createOfficialRuntimeIdentity({ budget: { ...OFFICIAL_BUDGET, extra: 1 } }),
    /Invalid official budget keys/);
  const root = mkdtempSync(path.join(os.tmpdir(), 'ootv2-runtime-'));
  try {
    copyRuntime(root);
    unlinkSync(path.join(root, OFFICIAL_RUNTIME_FILES[0]));
    assert.throws(() => createOfficialRuntimeIdentity({ rootDir: root }));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
