import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

/** Exact source SQL, not a second hand-maintained copy of the schema. */
export function productionMigrations(root = ROOT) {
  return readdirSync(path.join(root, 'supabase/migrations')).filter((name) => /^\d{14}_[a-z0-9_]+\.sql$/.test(name))
    .sort().map((name) => {
      const sql = readFileSync(path.join(root, 'supabase/migrations', name), 'utf8').replace(/\r\n/g, '\n');
      return { version: name.slice(0, 14), name: name.slice(15, -4), file: name,
        sha256: createHash('sha256').update(sql).digest('hex'), sql };
    });
}

export function projectRef(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !/^[a-z]{20}\.supabase\.co$/.test(parsed.hostname)
    || parsed.username || parsed.password || parsed.port || parsed.pathname !== '/') throw new Error('invalid_supabase_target');
  return parsed.hostname.split('.')[0];
}

/** A standalone bundle is useful in the Dashboard SQL editor when no DDL token is available.
 * It is deliberately fresh-project-only; never infer success from one existing table.
 */
export function freshDatabaseBundle(migrations) {
  if (!migrations.length || new Set(migrations.map((m) => m.version)).size !== migrations.length) {
    throw new Error('invalid_migration_plan');
  }
  return `-- FRESH PROJECT ONLY. No credentials or application fixtures.\nBEGIN;\n`
    + `SET LOCAL lock_timeout = '10s';\nSET LOCAL statement_timeout = '120s';\n`
    + `DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public') THEN\n`
    + `RAISE EXCEPTION 'production_bootstrap_requires_empty_public_schema'; END IF; END $$;\n`
    + migrations.map((m) => `\n-- ${m.version} ${m.name} sha256:${m.sha256}\n${m.sql}\n`).join('')
    + `\nCREATE TABLE public.ootv2_schema_migrations (version text PRIMARY KEY, name text NOT NULL, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now());\n`
    + `ALTER TABLE public.ootv2_schema_migrations ENABLE ROW LEVEL SECURITY;\n`
    + `REVOKE ALL ON public.ootv2_schema_migrations FROM PUBLIC,anon,authenticated;\n`
    + `GRANT SELECT ON public.ootv2_schema_migrations TO service_role;\n`
    + migrations.map((m) => `INSERT INTO public.ootv2_schema_migrations(version,name,sha256) VALUES('${m.version}','${m.name}','${m.sha256}');`).join('\n')
    + `\nNOTIFY pgrst,'reload schema';\nCOMMIT;\n`;
}