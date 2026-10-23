/** Private, hash-addressed bytes only: no execution, DB acceptance or sandbox claim.
 * One coordinator owns a cache directory exclusively. GC requires a COMPLETE retained
 * hash list from the coordinator (jobs/snapshots/appeals/offline exports).
 */
import { createHash, randomUUID } from 'node:crypto';
import { constants, closeSync, existsSync, fstatSync, lstatSync, mkdirSync, openSync,
  readSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const LIMIT = 256 * 1024;
const HASH = /^[a-f0-9]{64}$/;
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fail = (code) => { const error = new Error(`Source cache: ${code}`); error.code = code; throw error; };
const checkHash = (hash) => { if (typeof hash !== 'string' || !HASH.test(hash)) fail('invalid_hash'); };

export function createSourceCache({ root, now = Date.now } = {}) {
  if (typeof root !== 'string' || !path.isAbsolute(root) || typeof now !== 'function') fail('invalid_cache');
  // All ancestors must be controlled by the operator; refuse existing symlink components.
  for (let current = path.resolve(root); ; current = path.dirname(current)) {
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) fail('unsafe_directory');
    if (path.dirname(current) === current) break;
  }
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const lock = path.join(root, '.owner');
  let owner;
  try { owner = openSync(lock, 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') fail('cache_busy'); throw error; }
  let closed = false;
  const active = new Map();
  const timestamp = () => {
    const value = now();
    if (!Number.isSafeInteger(value) || value < 0) fail('invalid_clock');
    return value;
  };
  const assertOpen = () => { if (closed) fail('cache_closed'); };
  const fileFor = (hash) => { checkHash(hash); return path.join(root, `${hash}.py`); };

  function read(hash) {
    assertOpen();
    const file = fileFor(hash);
    let fd;
    try {
      const before = lstatSync(file);
      if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) fail('unsafe_entry');
      fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.nlink !== 1 || stat.ino !== before.ino || stat.dev !== before.dev) fail('unsafe_entry');
      if (stat.size < 1 || stat.size > LIMIT) fail('source_size');
      const bytes = Buffer.alloc(stat.size + 1);
      let size = 0;
      while (size < bytes.length) {
        const count = readSync(fd, bytes, size, bytes.length - size, null);
        if (!count) break;
        size += count;
      }
      const result = bytes.subarray(0, size);
      if (size !== stat.size || digest(result) !== hash) fail('hash_mismatch');
      return result;
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    } finally { if (fd !== undefined) closeSync(fd); }
  }

  function put(bytes, expectedHash) {
    assertOpen(); checkHash(expectedHash);
    if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > LIMIT) fail('source_size');
    if (digest(bytes) !== expectedHash) fail('hash_mismatch');
    const existing = read(expectedHash);
    if (existing) return expectedHash;
    const temporary = path.join(root, `.${randomUUID()}.tmp`);
    try {
      writeFileSync(temporary, bytes, { flag: 'wx', mode: 0o600 });
      renameSync(temporary, fileFor(expectedHash));
    } finally { rmSync(temporary, { force: true }); }
    return expectedHash;
  }

  function acquire(hash) {
    const source = read(hash);
    if (!source) fail('cache_miss');
    active.set(hash, (active.get(hash) || 0) + 1);
    let released = false;
    // Return a copy, not a writable cache filename. Runner creates its own private copy.
    return { source, sourceHash: hash, release() {
      if (released) return;
      released = true;
      const count = active.get(hash) - 1;
      if (count) active.set(hash, count); else active.delete(hash);
    } };
  }

  function gc({ retainedHashes, maxAgeMs } = {}) {
    assertOpen();
    if (!Array.isArray(retainedHashes) || !Number.isSafeInteger(maxAgeMs) || maxAgeMs < 0) fail('invalid_retention');
    retainedHashes.forEach(checkHash);
    const retained = new Set([...retainedHashes, ...active.keys()]);
    // Fail closed before deleting anything if pinned source is missing/corrupt.
    for (const hash of retained) if (!read(hash)) fail('retained_source_missing');
    const cutoff = timestamp() - maxAgeMs;
    const removed = [];
    for (const name of readdirSync(root)) {
      if (!/^[a-f0-9]{64}\.py$/.test(name)) continue;
      const hash = name.slice(0, -3);
      if (retained.has(hash)) continue;
      const file = fileFor(hash), stat = lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) fail('unsafe_entry');
      if (stat.mtimeMs > cutoff) continue;
      rmSync(file); removed.push(hash);
    }
    return removed.sort();
  }

  function close() {
    if (closed) return;
    if (active.size) fail('cache_in_use');
    closeSync(owner); rmSync(lock); closed = true;
  }
  return { put, read, acquire, gc, close };
}