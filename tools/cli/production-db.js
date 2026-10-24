/** Read-only preflight by default; export an exact fresh-project SQL bundle with --bundle.
 * Apply requires an explicit project ref and Management API PAT. Never logs server errors/secrets.
 */
import '../../server/config.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { productionMigrations, projectRef, freshDatabaseBundle, ROOT } from '../production/migrationPlan.js';

try {
  const ref = projectRef(process.env.SUPABASE_URL);
  const migrations = productionMigrations();
  const args = process.argv.slice(2);
  console.log(`Production target: ${ref}; source migrations: ${migrations.length}`);
  if (args.includes('--bundle')) {
    const directory = path.join(ROOT, 'data/production');
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, 'fresh-database.sql'), freshDatabaseBundle(migrations), { mode: 0o600 });
    writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify({ projectRef: ref,
      migrations: migrations.map(({ sql, ...entry }) => entry) }, null, 2) + '\n', { mode: 0o600 });
    console.log('Exported data/production/fresh-database.sql and manifest.json (no credentials).');
  }
  if (!args.includes('--apply')) {
    console.log('Read-only. Use --apply --confirm-project=<ref> only on the verified empty target.');
  } else {
    if (!args.includes(`--confirm-project=${ref}`)) throw new Error('explicit_target_confirmation_required');
    const token = process.env.SUPABASE_ACCESS_TOKEN;
    if (!token) throw new Error('ddl_token_missing_use_reviewed_bundle_in_dashboard');
    const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: freshDatabaseBundle(migrations) }), signal: AbortSignal.timeout(150000),
    });
    if (!response.ok) throw new Error(`bootstrap_failed_http_${response.status}_transaction_not_confirmed`);
    console.log('Bootstrap transaction accepted. Run db:verify and production checks before enabling workers.');
  }
} catch (error) {
  const safe = /^[a-z0-9_]+$/.test(error.message) ? error.message : 'production_db_preflight_failed';
  console.error(safe);
  process.exitCode = 1;
}