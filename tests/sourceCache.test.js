import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { linkSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createSourceCache } from '../server/shared/sourceCache.js';

const hash = (source) => createHash('sha256').update(source).digest('hex');
function setup(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'oot-source-'));
  const cache = createSourceCache({ root });
  t.after(() => { cache.close(); rmSync(root, { recursive: true, force: true }); });
  const store = (text) => { const bytes = Buffer.from(text), id = hash(bytes); cache.put(bytes, id); return id; };
  return { root, cache, store };
}

test('cache roundtrip, deduplication and hash identity are independent of repo names', (t) => {
  const { root, cache, store } = setup(t);
  const id = store('print("trusted fixture")\n');
  assert.equal(store('print("trusted fixture")\n'), id);
  assert.equal(cache.read(id).toString(), 'print("trusted fixture")\n');
  assert.deepEqual(readdirSync(root).sort(), ['.owner', `${id}.py`].sort());
  if (process.platform !== 'win32') assert.equal(statSync(path.join(root, `${id}.py`)).mode & 0o777, 0o600);
});

test('cache rejects traversal, size overflow, wrong hashes without partial files', (t) => {
  const { root, cache } = setup(t);
  for (const id of ['../bot', 'A'.repeat(64), '', null]) assert.throws(() => cache.read(id), { code: 'invalid_hash' });
  for (const bytes of [Buffer.alloc(0), Buffer.alloc(262145), 'text']) {
    assert.throws(() => cache.put(bytes, 'a'.repeat(64)), { code: 'source_size' });
  }
  assert.throws(() => cache.put(Buffer.from('x'), 'a'.repeat(64)), { code: 'hash_mismatch' });
  assert.deepEqual(readdirSync(root), ['.owner']);
});

test('cache accepts exact size boundary and never silently repairs corrupt source', (t) => {
  const { root, cache } = setup(t);
  const source = Buffer.alloc(262144, 32), id = hash(source);
  cache.put(source, id); assert.deepEqual(cache.read(id), source);
  writeFileSync(path.join(root, `${id}.py`), 'tampered');
  assert.throws(() => cache.read(id), { code: 'hash_mismatch' });
  assert.throws(() => cache.put(source, id), { code: 'hash_mismatch' });
});

test('acquire pins through GC; nested releases are idempotent and buffers are private', (t) => {
  const { cache, store } = setup(t);
  const id = store('source'), first = cache.acquire(id), second = cache.acquire(id);
  first.source.fill(0); assert.equal(cache.read(id).toString(), 'source');
  try {
    assert.deepEqual(cache.gc({ retainedHashes: [], maxAgeMs: 0 }), []);
    first.release(); first.release();
    assert.deepEqual(cache.gc({ retainedHashes: [], maxAgeMs: 0 }), []);
    assert.throws(() => cache.close(), { code: 'cache_in_use' });
  } finally { first.release(); second.release(); }
  assert.deepEqual(cache.gc({ retainedHashes: [], maxAgeMs: 0 }), [id]);
  assert.equal(cache.read(id), null);
  assert.throws(() => cache.acquire(id), { code: 'cache_miss' });
});

test('GC preserves retained snapshot/appeal/export source and young files', (t) => {
  const { root, cache, store } = setup(t);
  const pinned = store('pinned'), old = store('old'), young = store('young');
  for (const id of [pinned, old]) utimesSync(path.join(root, `${id}.py`), 1, 1);
  assert.deepEqual(cache.gc({ retainedHashes: [pinned], maxAgeMs: 60000 }), [old]);
  assert.ok(cache.read(pinned)); assert.ok(cache.read(young));
});

test('GC requires explicit complete retention input and fails closed on missing pins', (t) => {
  const { cache, store } = setup(t); const id = store('keep until inventory valid');
  for (const options of [undefined, {}, { retainedHashes: [], maxAgeMs: -1 }, { retainedHashes: ['../x'], maxAgeMs: 0 }]) {
    assert.throws(() => cache.gc(options)); assert.ok(cache.read(id));
  }
  assert.throws(() => cache.gc({ retainedHashes: ['a'.repeat(64)], maxAgeMs: 0 }), { code: 'retained_source_missing' });
  assert.ok(cache.read(id));
});

test('cache excludes concurrent owners; close is idempotent and permits reopen', (t) => {
  const { root, cache, store } = setup(t); const id = store('persistent bytes');
  assert.throws(() => createSourceCache({ root }), { code: 'cache_busy' });
  cache.close(); cache.close();
  assert.throws(() => cache.read(id), { code: 'cache_closed' });
  const reopened = createSourceCache({ root });
  try { assert.equal(reopened.read(id).toString(), 'persistent bytes'); } finally { reopened.close(); }
});

test('GC ignores unrelated files and rejects oversized reads and source-shaped directories', (t) => {
  const { root, cache } = setup(t);
  writeFileSync(path.join(root, 'operator-note.txt'), 'keep');
  assert.deepEqual(cache.gc({ retainedHashes: [], maxAgeMs: 0 }), []);
  assert.ok(readdirSync(root).includes('operator-note.txt'));
  const invalid = 'b'.repeat(64); writeFileSync(path.join(root, `${invalid}.py`), Buffer.alloc(262145));
  assert.throws(() => cache.read(invalid), { code: 'source_size' });
  const directoryHash = 'c'.repeat(64); mkdirSync(path.join(root, `${directoryHash}.py`));
  assert.throws(() => cache.read(directoryHash), { code: 'unsafe_entry' });
  assert.throws(() => cache.gc({ retainedHashes: [], maxAgeMs: 0 }), { code: 'unsafe_entry' });
});

test('cache rejects hardlinked source without modifying external file', (t) => {
  const { root, cache } = setup(t);
  const source = Buffer.from('external bytes'), id = hash(source), external = path.join(root, 'external.txt');
  writeFileSync(external, source); linkSync(external, path.join(root, `${id}.py`));
  assert.throws(() => cache.read(id), { code: 'unsafe_entry' });
  assert.throws(() => cache.gc({ retainedHashes: [], maxAgeMs: 0 }), { code: 'unsafe_entry' });
  assert.equal(statSync(external).nlink, 2);
});

test('cache refuses symlink/junction root or ancestor', (t) => {
  const base = mkdtempSync(path.join(tmpdir(), 'oot-cache-link-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const target = path.join(base, 'target'), link = path.join(base, 'link');
  mkdirSync(target); symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
  for (const root of [link, path.join(link, 'nested')]) {
    assert.throws(() => createSourceCache({ root }), { code: 'unsafe_directory' });
  }
});