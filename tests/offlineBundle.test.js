import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EMPTY_TERRAIN_MAP } from '../src/game/maps.js';
import { TERRAIN_RULES_VERSION } from '../src/game/terrain.js';
import { createOfficialRoundSnapshot } from '../server/contracts/officialSnapshot.js';
import { contentHash } from '../server/contracts/canonical.js';
import { buildOfflineBundle, verifyOfflineBundle, writeOfflineBundle, readOfflineBundle,
  OFFLINE_BUNDLE_VERSION } from '../server/shared/offlineBundle.js';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sourceA = Buffer.from('print("bot a")\n');
const sourceB = Buffer.from('print("bot b")\n');
const sourceC = Buffer.from('print("bot c")\n');

function snapshot(overrides = {}, bots = [
  { participantId: 'team-a', submissionId: 'sub-a', artifactKey: 'a.py', sourceSha256: sha(sourceA), sourceKind: 'offline_file' },
  { participantId: 'team-b', submissionId: 'sub-b', artifactKey: 'b.py', sourceSha256: sha(sourceB), sourceKind: 'offline_file' },
]) {
  return createOfficialRoundSnapshot({
    eventId: 'event-1', roundId: 'group', seed: 42, cutoff: '2026-10-30T00:00:00Z',
    mapPackVersion: 'week-1', primaryMap: EMPTY_TERRAIN_MAP, reserveMap: EMPTY_TERRAIN_MAP,
    runtime: { rulesVersion: TERRAIN_RULES_VERSION, protocolVersion: 'bot.v1',
      runtimeVersion: 'campus-runtime.v1', runtimeHash: 'a'.repeat(64), budgetHash: 'b'.repeat(64) },
    bots, ...overrides,
  });
}
const botsFor = (sources) => [
  { participantId: 'team-a', source: sources[0] }, { participantId: 'team-b', source: sources[1] },
];
const filesToMap = (bundle) => new Map(bundle.files.map((file) => [file.path, file.bytes]));
const reseal = (body) => ({ ...body, contentHash: contentHash(body) });

test('offline bundle builds from a verified snapshot and every pinned source', () => {
  const bundle = buildOfflineBundle({ snapshot: snapshot(), bots: botsFor([sourceA, sourceB]) });
  assert.equal(bundle.manifest.schemaVersion, OFFLINE_BUNDLE_VERSION);
  assert.deepEqual(bundle.files.map((file) => file.path), ['bots/team-a.py', 'bots/team-b.py', 'snapshot.json']);
  const checked = verifyOfflineBundle(bundle.manifest, filesToMap(bundle));
  assert.equal(checked.ok, true);
  assert.deepEqual(checked.participantIds, ['team-a', 'team-b']);
  assert.equal(checked.snapshotHash, bundle.manifest.snapshot.contentHash);
  const again = buildOfflineBundle({ snapshot: snapshot(), bots: botsFor([sourceA, sourceB]) });
  assert.equal(again.manifest.contentHash, bundle.manifest.contentHash);
  assert.equal(verifyOfflineBundle(bundle.manifest, Object.fromEntries(filesToMap(bundle))).ok, true);
});

test('offline bundle refuses incomplete or unpinned inputs', () => {
  const pinned = snapshot();
  assert.throws(() => buildOfflineBundle({ snapshot: { ...pinned, contentHash: 'c'.repeat(64) },
    bots: botsFor([sourceA, sourceB]) }), { code: 'invalid_snapshot' });
  assert.throws(() => buildOfflineBundle({ snapshot: pinned,
    bots: [{ participantId: 'team-a', source: sourceA }] }), { code: 'bot_set_mismatch' });
  assert.throws(() => buildOfflineBundle({ snapshot: pinned,
    bots: [{ participantId: 'team-a', source: sourceA }, { participantId: 'team-c', source: sourceB }] }),
  { code: 'bot_set_mismatch' });
  assert.throws(() => buildOfflineBundle({ snapshot: pinned,
    bots: [{ participantId: 'team-a', source: sourceA }, { participantId: 'team-a', source: sourceB }] }),
  { code: 'duplicate_bot' });
  assert.throws(() => buildOfflineBundle({ snapshot: pinned,
    bots: [{ participantId: '../evil', source: sourceA }, { participantId: 'team-b', source: sourceB }] }),
  { code: 'unsafe_participant_id' });
  assert.throws(() => buildOfflineBundle({ snapshot: pinned,
    bots: [{ participantId: 'team-a', source: sourceB }, { participantId: 'team-b', source: sourceB }] }),
  { code: 'bot_hash_mismatch' });
  for (const bad of [Buffer.alloc(0), Buffer.alloc(262145, 32), 'text']) {
    assert.throws(() => buildOfflineBundle({ snapshot: pinned,
      bots: [{ participantId: 'team-a', source: bad }, { participantId: 'team-b', source: sourceB }] }),
    { code: 'invalid_bot_size' });
  }
});

test('offline verification rejects byte, entry and summary drift', () => {
  const bundle = buildOfflineBundle({ snapshot: snapshot(), bots: botsFor([sourceA, sourceB]) });
  const base = filesToMap(bundle);
  const tampered = new Map(base); tampered.set('bots/team-a.py', Buffer.from('changed'));
  assert.ok(verifyOfflineBundle(bundle.manifest, tampered).errors.includes('bot_hash_mismatch'));
  const extra = new Map(base); extra.set('bots/team-c.py', sourceC);
  assert.ok(verifyOfflineBundle(bundle.manifest, extra).errors.includes('extra_file'));
  const missing = new Map(base); missing.delete('bots/team-b.py');
  assert.ok(verifyOfflineBundle(bundle.manifest, missing).errors.includes('missing_file'));
  const changed = structuredClone(bundle.manifest); changed.snapshot.eventId = 'event-2';
  assert.ok(verifyOfflineBundle(changed, base).errors.includes('manifest_hash_mismatch'));
  assert.ok(verifyOfflineBundle({ ...bundle.manifest, schemaVersion: 'v0' }, base)
    .errors.includes('unsupported_bundle_version'));
  assert.deepEqual(verifyOfflineBundle(bundle.manifest, null).errors, ['invalid_file_map']);
});

test('offline verification still fails when the manifest is resealed over wrong content', () => {
  const bundle = buildOfflineBundle({ snapshot: snapshot(), bots: botsFor([sourceA, sourceB]) });
  const base = filesToMap(bundle);
  const wrongSummary = reseal({ ...bundle.manifest, snapshot: { ...bundle.manifest.snapshot, seed: 43 } });
  assert.ok(verifyOfflineBundle(wrongSummary, base).errors.includes('snapshot_mismatch'));
  const traversal = structuredClone(bundle.manifest);
  traversal.files = traversal.files.map((file) => file.path === 'bots/team-a.py' ? { ...file, path: '../evil.py' } : file);
  assert.ok(verifyOfflineBundle(reseal(traversal), base).errors.includes('invalid_file_entry'));
  const sizes = structuredClone(bundle.manifest);
  sizes.totalBytes += 1;
  assert.ok(verifyOfflineBundle(reseal(sizes), base).errors.includes('total_bytes_mismatch'));
  const swapped = new Map(base);
  swapped.set('snapshot.json', Buffer.from(JSON.stringify(snapshot({ seed: 99 }))));
  const swappedManifest = structuredClone(bundle.manifest);
  const bytes = swapped.get('snapshot.json');
  swappedManifest.files = swappedManifest.files.map((file) => file.path === 'snapshot.json'
    ? { ...file, sha256: sha(bytes), size: bytes.length } : file);
  swappedManifest.totalBytes = swappedManifest.files.reduce((sum, file) => sum + file.size, 0);
  assert.ok(verifyOfflineBundle(reseal(swappedManifest), swapped).errors.includes('snapshot_mismatch'));
});

test('offline bundle writes atomically and reads back only verified files', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'oot-offline-bundle-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const target = path.join(dir, 'round');
  const manifest = await writeOfflineBundle(target, { snapshot: snapshot(), bots: botsFor([sourceA, sourceB]) });
  assert.equal(manifest.schemaVersion, OFFLINE_BUNDLE_VERSION);
  assert.deepEqual(readFileSync(path.join(target, 'bots', 'team-a.py')), sourceA);
  const loaded = await readOfflineBundle(target);
  assert.equal(loaded.snapshot.contentHash, manifest.snapshot.contentHash);
  assert.equal(loaded.manifest.contentHash, manifest.contentHash);

  writeFileSync(path.join(target, 'bots', 'team-b.py'), Buffer.alloc(sourceB.length, 32));
  await assert.rejects(readOfflineBundle(target), (error) =>
    error.code === 'offline_bundle_invalid' && error.errors.includes('file_hash_mismatch'));
  writeFileSync(path.join(target, 'bots', 'team-b.py'), 'tampered');
  await assert.rejects(readOfflineBundle(target), { code: 'file_missing_or_mismatched' });
  writeFileSync(path.join(target, 'bots', 'team-b.py'), sourceB);
  assert.equal((await readOfflineBundle(target)).snapshot.contentHash, manifest.snapshot.contentHash);
  await assert.rejects(readOfflineBundle(path.join(dir, 'missing')), { code: 'invalid_manifest_file' });
  await assert.rejects(writeOfflineBundle(target, { snapshot: snapshot(), bots: botsFor([sourceA, sourceB]) }),
    { code: 'offline_directory_not_empty' });
  writeFileSync(path.join(target, 'manifest.json'), '{"schemaVersion":"v0"}');
  await assert.rejects(readOfflineBundle(target), { code: 'invalid_manifest' });
});
