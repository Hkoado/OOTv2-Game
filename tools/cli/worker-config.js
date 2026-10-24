/** Validate a worker config file and print the normalized JSON (never any secret).
 * Exit codes: 0 ok, 2 unreadable/invalid config. Used by tools/vm/Worker.ps1.
 */
import { readFileSync } from 'node:fs';
import { DEFAULT_WORKER_CONFIG, parseWorkerConfig, WORKER_CONFIG_VERSION } from '../production/workerConfig.js';

function emit(payload, code) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
  process.exitCode = code;
}

const target = process.argv[2];

if (process.argv.includes('--defaults')) {
  emit({ ok: true, schemaVersion: WORKER_CONFIG_VERSION, config: DEFAULT_WORKER_CONFIG }, 0);
} else if (!target) {
  emit({ ok: false, error: 'config_path_required' }, 2);
} else {
  let raw = null;
  try {
    raw = JSON.parse(readFileSync(target, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    emit({ ok: false, error: 'config_unreadable_or_not_json' }, 2);
  }
  if (raw !== null) {
    try {
      emit({ ok: true, config: parseWorkerConfig(raw) }, 0);
    } catch (error) {
      emit({ ok: false, error: error?.code || 'invalid_worker_config' }, 2);
    }
  }
}

