import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import config from '../../server/config.js';
import { rpc, rows } from '../../server/shared/client.js';
import { uploadArtifact, hashBuffer } from '../../server/shared/artifacts.js';

const apply = process.argv.includes('--apply');
const db = new Database(config.dbPath, { readonly: true, fileMustExist: true });
const backupDir = path.join(config.dataDir, 'backups');
mkdirSync(backupDir, { recursive: true });
try {
  const tables = ['participants','submissions','tournaments','tournament_entries','matches'];
  const bundle = db.transaction(() => {
    const data = Object.fromEntries(tables.map((t)=>[t,db.prepare(`SELECT * FROM ${t} ORDER BY id`).all()]));
    data.accounts = db.prepare('SELECT * FROM local_accounts ORDER BY id').all();
    return data;
  })();
  for (const t of bundle.tournaments) t.version = 0;
  const fingerprint = createHash('sha256').update(JSON.stringify(bundle)).digest('hex');
  // Historical SQLite fixtures can have arbitrary TEXT IDs. Map only those IDs
  // deterministically and update every foreign key; never modify the source DB.
  const idMap = {};
  const mappedId = (id) => {
    if (id == null || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return id;
    if (!idMap[id]) {
      const hex = createHash('sha256').update(`ootv2:legacy-id:${id}`).digest('hex');
      idMap[id] = `${hex.slice(0,8)}-${hex.slice(8,12)}-5${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;
    }
    return idMap[id];
  };
  for (const records of Object.values(bundle)) for (const row of records) {
    for (const field of ['id','participant_id','tournament_id','submission_id','red_entry_id','blue_entry_id']) {
      if (Object.hasOwn(row,field)) row[field] = mappedId(row[field]);
    }
  }
  const counts = Object.fromEntries(Object.entries(bundle).map(([k,v])=>[k,v.length]));
  if (!apply) {
    console.log(JSON.stringify({mode:'dry-run',counts,sessions:'not imported',next:'Stop all legacy APIs/workers; then node tools/cli/migrate-shared-db.js --apply'},null,2));
  } else {
    const backup = path.join(backupDir,`before-supabase-${fingerprint.slice(0,16)}.sqlite`);
    // SQLite backup API includes committed WAL, unlike copying the DB file alone.
    await db.backup(backup);
    const [receipt] = await rows('imports',`fingerprint=eq.${fingerprint}`);
    for (const s of receipt ? [] : bundle.submissions) {
      if (s.status === 'valid') {
        const data = readFileSync(s.storage_path);
        if (data.length > config.limits.maxSourceBytes || hashBuffer(data) !== s.sha256) throw new Error('Local artifact integrity check failed. Import aborted.');
        s.storage_path = await uploadArtifact(s.id,data);
      } else s.storage_path = `${s.id}.py`;
    }
    const result = receipt?.counts ?? await rpc('mvp_import',{p_fingerprint:fingerprint,p_bundle:bundle});
    writeFileSync(path.join(config.dataDir,'shared-db-import-receipt.json'),JSON.stringify({fingerprint,backup,idMap,counts:result,importedAt:new Date().toISOString()},null,2),{mode:0o600});
    console.log(JSON.stringify({imported:result,backup,sessions:'Sign in again'},null,2));
  }
} finally { db.close(); }