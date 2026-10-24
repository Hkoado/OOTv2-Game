import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_WORKER_CONFIG, WORKER_CONFIG_VERSION, parseWorkerConfig, workerPaths,
} from '../tools/production/workerConfig.js';

test('defaults are valid, frozen and derive paths from the VM directory', () => {
  const config = parseWorkerConfig({});
  assert.equal(config.schemaVersion, WORKER_CONFIG_VERSION);
  assert.deepEqual(config, parseWorkerConfig(DEFAULT_WORKER_CONFIG));
  assert.deepEqual(workerPaths(config), {
    keyPath: 'D:\\OOTv2-VM\\judge_ed25519',
    publicKeyPath: 'D:\\OOTv2-VM\\judge_ed25519.pub',
    knownHostsPath: 'D:\\OOTv2-VM\\known_hosts',
  });
  assert.equal(Object.isFrozen(config), true);
});

test('any local machine path and resource budget is accepted', () => {
  const config = parseWorkerConfig({
    schemaVersion: WORKER_CONFIG_VERSION, vmName: 'Judge-02', vmDirectory: 'C:\\VMs\\ootv2',
    switchName: 'Internal-LAN', wslDistribution: 'Ubuntu-24.04', cpuCount: 8, memoryGiB: 8, sshUser: 'judge_ops',
  });
  assert.equal(config.vmDirectory, 'C:\\VMs\\ootv2');
  assert.equal(config.cpuCount, 8);
});

test('unknown keys, versions and unsafe paths are rejected with stable codes', () => {
  const cases = [
    [{ unexpected: true }, 'unknown_worker_config_key'],
    [{ schemaVersion: 'ootv2-worker-config.v0' }, 'unsupported_worker_config_version'],
    [{ vmName: 'bad name' }, 'invalid_vm_name'],
    [{ vmDirectory: 'relative\\path' }, 'invalid_vm_directory'],
    [{ vmDirectory: 'D:\\VM\\..\\escape' }, 'invalid_vm_directory'],
    [{ vmDirectory: 'D:\\VM with space' }, 'invalid_vm_directory'],
    [{ vmDirectory: '\\\\server\\share' }, 'invalid_vm_directory'],
    [{ switchName: ' ' }, 'invalid_switch_name'],
    [{ wslDistribution: 'Ubuntu; rm -rf /' }, 'invalid_wsl_distribution'],
    [{ cpuCount: 1 }, 'invalid_cpu_count'],
    [{ cpuCount: 9 }, 'invalid_cpu_count'],
    [{ cpuCount: 4.5 }, 'invalid_cpu_count'],
    [{ memoryGiB: 1 }, 'invalid_memory_gib'],
    [{ sshUser: 'Root User' }, 'invalid_ssh_user'],
    [{ sshUser: '-x' }, 'invalid_ssh_user'],
  ];
  for (const [overrides, code] of cases) {
    assert.throws(() => parseWorkerConfig(overrides), { code }, JSON.stringify(overrides));
  }
  assert.throws(() => parseWorkerConfig(null), { code: 'invalid_worker_config' });
  assert.throws(() => parseWorkerConfig([]), { code: 'invalid_worker_config' });
});

test('committed example matches the schema and contains no secrets', () => {
  const example = JSON.parse(readFileSync(new URL('../tools/vm/worker.config.example.json', import.meta.url), 'utf8'));
  const config = parseWorkerConfig(example);
  assert.equal(config.vmName, DEFAULT_WORKER_CONFIG.vmName);
  const text = JSON.stringify(example).toLowerCase();
  for (const word of ['key', 'token', 'password', 'secret', 'supabase']) assert.equal(text.includes(word), false);
});
