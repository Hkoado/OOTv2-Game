/** Build/verify a self-contained offline round bundle. No DB, network or execution. */
import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { writeOfflineBundle, readOfflineBundle, OFFLINE_BUNDLE_LIMITS } from '../../server/shared/offlineBundle.js';

const USAGE = 'Usage:\n  node tools/cli/offline-bundle.js build <snapshot.json> <bots-dir> <out-dir>\n  node tools/cli/offline-bundle.js verify <bundle-dir>';

async function regularFile(file, maxBytes) {
  const info = await lstat(file);
  if (!info.isFile() || info.size < 1 || info.size > maxBytes) throw new Error(`invalid_file:${path.basename(file)}`);
  return readFile(file);
}

async function collectBots(dir) {
  const bots = [];
  for (const name of (await readdir(dir)).sort()) {
    if (!name.endsWith('.py')) continue;
    bots.push({ participantId: name.slice(0, -3), source: await regularFile(path.join(dir, name), OFFLINE_BUNDLE_LIMITS.botBytes) });
  }
  return bots;
}

try {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'build' && args.length === 3) {
    const snapshot = JSON.parse((await regularFile(args[0], OFFLINE_BUNDLE_LIMITS.jsonBytes)).toString('utf8'));
    const manifest = await writeOfflineBundle(args[2], { snapshot, bots: await collectBots(args[1]) });
    console.log(JSON.stringify({ ok: true, directory: args[2], contentHash: manifest.contentHash,
      snapshotHash: manifest.snapshot.contentHash, files: manifest.files.length, totalBytes: manifest.totalBytes }, null, 2));
  } else if (command === 'verify' && args.length === 1) {
    const loaded = await readOfflineBundle(args[0]);
    console.log(JSON.stringify({ ok: true, directory: args[0], schemaVersion: loaded.manifest.schemaVersion,
      contentHash: loaded.manifest.contentHash, snapshotHash: loaded.manifest.snapshot.contentHash,
      eventId: loaded.snapshot.eventId, roundId: loaded.snapshot.roundId, seed: loaded.snapshot.seed,
      participants: loaded.manifest.files.filter((file) => file.path.startsWith('bots/'))
        .map((file) => path.basename(file.path, '.py')), totalBytes: loaded.manifest.totalBytes }, null, 2));
  } else {
    throw new Error(USAGE);
  }
} catch (error) {
  console.error(error.code ? `${error.code}${error.errors ? `: ${error.errors.join(', ')}` : ''}` : error.message);
  process.exitCode = 1;
}
