/** Offline final bundle: self-contained, hash-checked snapshot + bot sources.
 * Pure build/verify plus bounded file IO. No DB, no execution, no network.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, rm, lstat } from 'node:fs/promises';
import path from 'node:path';
import { canonicalJson, contentHash } from '../contracts/canonical.js';
import { verifyOfficialRoundSnapshot } from '../contracts/officialSnapshot.js';

export const OFFLINE_BUNDLE_VERSION = 'campus-offline-bundle.v1';
export const OFFLINE_BUNDLE_LIMITS = Object.freeze({
  botBytes: 262144, jsonBytes: 262144, files: 57, totalBytes: 16 * 1024 * 1024,
});
const HASH = /^[a-f0-9]{64}$/;
const PARTICIPANT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const FILE_PATH = /^(?:snapshot\.json|bots\/[A-Za-z0-9][A-Za-z0-9._-]{0,79}\.py)$/;
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fail = (code) => Object.assign(new Error(code), { code });
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype
  && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const SUMMARY_KEYS = ['budgetHash', 'contentHash', 'cutoff', 'eventId', 'mapPackVersion',
  'primaryMapHash', 'reserveMapHash', 'roundId', 'rulesVersion', 'runtimeHash', 'runtimeVersion', 'seed'];
const MANIFEST_KEYS = ['schemaVersion', 'snapshot', 'files', 'totalBytes', 'contentHash'];

function summarize(snapshot) {
  return { contentHash: snapshot.contentHash, eventId: snapshot.eventId, roundId: snapshot.roundId,
    seed: snapshot.seed, cutoff: snapshot.cutoff, mapPackVersion: snapshot.mapPackVersion,
    rulesVersion: snapshot.runtime.rulesVersion, runtimeVersion: snapshot.runtime.runtimeVersion,
    runtimeHash: snapshot.runtime.runtimeHash, budgetHash: snapshot.runtime.budgetHash,
    primaryMapHash: snapshot.maps.primary.hash, reserveMapHash: snapshot.maps.reserve.hash };
}

function entry(filePath, bytes) {
  return { path: filePath, sha256: sha256(bytes), size: bytes.length };
}

/** Build from a verified round snapshot plus every pinned bot source; no implicit lookup. */
export function buildOfflineBundle({ snapshot, bots } = {}) {
  if (!verifyOfficialRoundSnapshot(snapshot)) throw fail('invalid_snapshot');
  if (!Array.isArray(bots) || bots.length !== snapshot.bots.length) throw fail('bot_set_mismatch');
  const byId = new Map();
  for (const bot of bots) {
    if (!bot || typeof bot !== 'object' || !PARTICIPANT.test(bot.participantId ?? '')) throw fail('unsafe_participant_id');
    if (byId.has(bot.participantId)) throw fail('duplicate_bot');
    if (!Buffer.isBuffer(bot.source) || bot.source.length < 1 || bot.source.length > OFFLINE_BUNDLE_LIMITS.botBytes) {
      throw fail('invalid_bot_size');
    }
    byId.set(bot.participantId, bot.source);
  }
  const files = [];
  const snapshotBytes = Buffer.from(canonicalJson(snapshot), 'utf8');
  if (snapshotBytes.length > OFFLINE_BUNDLE_LIMITS.jsonBytes) throw fail('snapshot_too_large');
  files.push({ path: 'snapshot.json', bytes: snapshotBytes });
  for (const bot of snapshot.bots) {
    const source = byId.get(bot.participantId);
    if (!source) throw fail('bot_set_mismatch');
    if (sha256(source) !== bot.sourceSha256) throw fail('bot_hash_mismatch');
    files.push({ path: `bots/${bot.participantId}.py`, bytes: source });
  }
  if (files.length > OFFLINE_BUNDLE_LIMITS.files) throw fail('too_many_files');
  const totalBytes = files.reduce((sum, file) => sum + file.bytes.length, 0);
  if (totalBytes > OFFLINE_BUNDLE_LIMITS.totalBytes) throw fail('bundle_too_large');
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const body = { schemaVersion: OFFLINE_BUNDLE_VERSION, snapshot: summarize(snapshot),
    files: files.map((file) => entry(file.path, file.bytes)), totalBytes };
  return { manifest: { ...body, contentHash: contentHash(body) }, files };
}

function normalizeFiles(files) {
  if (files instanceof Map) return files;
  if (files && typeof files === 'object' && Object.getPrototypeOf(files) === Object.prototype) {
    return new Map(Object.entries(files));
  }
  return null;
}

/** Pure verification of a manifest against the exact file bytes; no filesystem access. */
export function verifyOfflineBundle(manifest, files) {
  const errors = [];
  const add = (code) => { if (!errors.includes(code) && errors.length < 20) errors.push(code); };
  const map = normalizeFiles(files);
  if (!map) return { ok: false, errors: ['invalid_file_map'] };
  if (!exactKeys(manifest, MANIFEST_KEYS)) return { ok: false, errors: ['invalid_manifest'] };
  if (manifest.schemaVersion !== OFFLINE_BUNDLE_VERSION) add('unsupported_bundle_version');
  const { contentHash: hashValue, ...body } = manifest;
  if (!HASH.test(hashValue ?? '') || contentHash(body) !== hashValue) add('manifest_hash_mismatch');
  if (!exactKeys(manifest.snapshot, SUMMARY_KEYS)) add('invalid_snapshot_summary');
  if (!Array.isArray(manifest.files) || manifest.files.length < 2
    || manifest.files.length > OFFLINE_BUNDLE_LIMITS.files) add('invalid_file_list');
  if (!Number.isSafeInteger(manifest.totalBytes) || manifest.totalBytes < 1) add('invalid_total_bytes');
  const entries = Array.isArray(manifest.files) ? manifest.files : [];
  const seen = new Set();
  let total = 0;
  for (const file of entries) {
    if (!exactKeys(file, ['path', 'sha256', 'size']) || typeof file.path !== 'string'
      || !FILE_PATH.test(file.path) || seen.has(file.path)) { add('invalid_file_entry'); continue; }
    seen.add(file.path);
    const limit = file.path === 'snapshot.json' ? OFFLINE_BUNDLE_LIMITS.jsonBytes : OFFLINE_BUNDLE_LIMITS.botBytes;
    if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > limit) { add('invalid_file_size'); continue; }
    if (!HASH.test(file.sha256)) add('invalid_file_hash');
    const bytes = map.get(file.path);
    if (!Buffer.isBuffer(bytes)) { add('missing_file'); continue; }
    if (bytes.length !== file.size) add('file_size_mismatch');
    if (sha256(bytes) !== file.sha256) add('file_hash_mismatch');
    total += file.size;
  }
  for (const filePath of map.keys()) if (!seen.has(filePath)) add('extra_file');
  if (total !== manifest.totalBytes) add('total_bytes_mismatch');
  if (total > OFFLINE_BUNDLE_LIMITS.totalBytes) add('bundle_too_large');
  const snapshotBytes = map.get('snapshot.json');
  let snapshot;
  if (Buffer.isBuffer(snapshotBytes)) {
    try { snapshot = JSON.parse(snapshotBytes.toString('utf8')); } catch { add('invalid_snapshot_json'); }
  }
  if (snapshot) {
    if (!verifyOfficialRoundSnapshot(snapshot)) add('invalid_snapshot');
    else {
      const expected = summarize(snapshot);
      for (const key of SUMMARY_KEYS) if (expected[key] !== manifest.snapshot?.[key]) add('snapshot_mismatch');
      const paths = new Set();
      for (const bot of snapshot.bots) {
        if (!PARTICIPANT.test(bot.participantId)) { add('unsafe_participant_id'); continue; }
        const botPath = `bots/${bot.participantId}.py`;
        paths.add(botPath);
        const bytes = map.get(botPath);
        if (!Buffer.isBuffer(bytes)) add('missing_file');
        else if (sha256(bytes) !== bot.sourceSha256) add('bot_hash_mismatch');
      }
      for (const filePath of map.keys()) {
        if (filePath.startsWith('bots/') && !paths.has(filePath)) add('extra_file');
      }
    }
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, snapshotHash: manifest.snapshot.contentHash,
    participantIds: entries.filter((file) => file.path.startsWith('bots/')).map((file) => file.path.slice(5, -3)) };
}

const temporaryName = (dir) => path.join(dir, `.${randomUUID()}.tmp`);
async function writeExclusive(target, bytes) {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = temporaryName(path.dirname(target));
  const handle = await open(temporary, 'wx', 0o600);
  try {
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

/** Writes into an empty directory only: files first, manifest last, temp + rename per file. */
export async function writeOfflineBundle(dir, input) {
  if (typeof dir !== 'string' || !dir.trim()) throw fail('invalid_directory');
  const bundle = buildOfflineBundle(input);
  await mkdir(dir, { recursive: true });
  if ((await readdir(dir)).length) throw fail('offline_directory_not_empty');
  const written = [];
  try {
    for (const file of bundle.files) {
      const target = path.join(dir, ...file.path.split('/'));
      await writeExclusive(target, file.bytes);
      written.push(target);
    }
    await writeExclusive(path.join(dir, 'manifest.json'),
      Buffer.from(`${JSON.stringify(bundle.manifest, null, 2)}\n`, 'utf8'));
    return bundle.manifest;
  } catch (error) {
    for (const target of written) await rm(target, { force: true }).catch(() => {});
    throw error;
  }
}

/** Reads only manifest-listed regular files with bounded sizes, then verifies every hash. */
export async function readOfflineBundle(dir) {
  if (typeof dir !== 'string' || !dir.trim()) throw fail('invalid_directory');
  const manifestPath = path.join(dir, 'manifest.json');
  const info = await lstat(manifestPath).catch(() => null);
  if (!info?.isFile() || info.size > OFFLINE_BUNDLE_LIMITS.jsonBytes) throw fail('invalid_manifest_file');
  let manifest;
  try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')); } catch { throw fail('invalid_manifest_json'); }
  if (!exactKeys(manifest, MANIFEST_KEYS) || !Array.isArray(manifest.files)
    || manifest.files.length > OFFLINE_BUNDLE_LIMITS.files) throw fail('invalid_manifest');
  const files = new Map();
  let total = 0;
  for (const file of manifest.files) {
    if (!file || typeof file.path !== 'string' || !FILE_PATH.test(file.path) || files.has(file.path)) {
      throw fail('invalid_manifest');
    }
    const limit = file.path === 'snapshot.json' ? OFFLINE_BUNDLE_LIMITS.jsonBytes : OFFLINE_BUNDLE_LIMITS.botBytes;
    if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > limit) throw fail('invalid_manifest');
    total += file.size;
    if (total > OFFLINE_BUNDLE_LIMITS.totalBytes) throw fail('bundle_too_large');
    const target = path.join(dir, ...file.path.split('/'));
    const stat = await lstat(target).catch(() => null);
    if (!stat?.isFile() || stat.size !== file.size) throw fail('file_missing_or_mismatched');
    files.set(file.path, await readFile(target));
  }
  const checked = verifyOfflineBundle(manifest, files);
  if (!checked.ok) {
    const error = fail('offline_bundle_invalid');
    error.errors = checked.errors;
    throw error;
  }
  return { manifest, snapshot: JSON.parse(files.get('snapshot.json').toString('utf8')) };
}

