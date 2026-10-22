/**
 * Artifact tải về từ Supabase Storage phải theo `config.limits.maxSourceBytes` (256 KiB),
 * không còn hard-code 64 KiB. Không gọi mạng: `fetch` được mock.
 *
 * Chạy: `node --test tests/artifactsLimit.test.js`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('shared artifacts: nhận tới maxSourceBytes và từ chối vượt hạn mức', async (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'oot-artifact-limit-'));
  process.env.OOTV2_DATA_DIR = dir;

  const { default: config } = await import('../server/config.js');
  const { materialize, hashBuffer } = await import('../server/shared/artifacts.js');
  assert.equal(config.limits.maxSourceBytes, 256 * 1024);

  const originalFetch = globalThis.fetch;
  const oldUrl = process.env.SUPABASE_URL;
  const oldKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = 'https://example.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only';
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (oldUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = oldKey;
    rmSync(dir, { recursive: true, force: true });
  });

  const atLimit = Buffer.alloc(config.limits.maxSourceBytes, 0x20);
  globalThis.fetch = async () => new Response(atLimit);
  const bot = await materialize({
    storage_path: '00000000-0000-0000-0000-000000000002.py',
    sha256: hashBuffer(atLimit),
  });
  assert.match(bot.file, /\.py$/u);
  bot.cleanup();

  const tooBig = Buffer.alloc(config.limits.maxSourceBytes + 1, 0x20);
  globalThis.fetch = async () => new Response(tooBig);
  await assert.rejects(
    materialize({ storage_path: '00000000-0000-0000-0000-000000000003.py', sha256: hashBuffer(tooBig) }),
    /integrity/u,
  );
});
