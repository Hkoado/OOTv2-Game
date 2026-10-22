import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import config from '../config.js';

/** Rebuildable private preparation snapshot; SQLite remains authoritative. No bot source/secrets. */
export function writeEventFolder(event) {
  if (!/^[a-f0-9-]{36}$/.test(event.id)) throw new Error('Invalid event folder ID');
  const root = path.join(config.dataDir, 'events', event.id);
  fs.mkdirSync(path.join(root, 'maps'), { recursive: true });
  fs.mkdirSync(path.join(root, 'teams'), { recursive: true });
  function write(relative, value) {
    const target = path.join(root, relative);
    const temp = `${target}.${randomUUID()}.tmp`;
    try { fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' }); fs.renameSync(temp, target); }
    finally { fs.rmSync(temp, { force: true }); }
  }
  write('maps/selected.json', event.map);
  write('teams/roster.json', event.entries);
  write('event.json', { schemaVersion: 'event-folder.v1', id: event.id, name: event.name,
    status: event.status, seed: event.seed, map: 'maps/selected.json', teams: 'teams/roster.json',
    storage: 'sqlite-authoritative', purpose: 'preparation-snapshot-not-backup' });
  return event;
}