/**
 * db-sql.js — Chạy SQL trên project Supabase qua Management API (cần SUPABASE_ACCESS_TOKEN).
 *
 * Dùng cho operator: kiểm schema, đối soát sau drill. Mặc định chỉ cho SELECT/WITH/SHOW;
 * phải thêm `--write` mới chạy câu ghi (INSERT/UPDATE/DELETE/DDL) để tránh tai nạn.
 *
 *   node tools/cli/db-sql.js "select count(*) from public.mvp_github_receipts"
 *   node tools/cli/db-sql.js --write "delete from ... where ..."
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');

function loadEnv() {
  try {
    const raw = readFileSync(path.join(root, '.env'), 'utf8');
    const env = {};
    for (const line of raw.split(/\r?\n/u)) {
      const match = /^([A-Za-z0-9_]+)=(.*)$/u.exec(line.trim());
      if (match) env[match[1]] = match[2].replace(/^["']|["']$/gu, '');
    }
    return { ...env, ...process.env };
  } catch {
    return process.env;
  }
}

const env = loadEnv();
const args = process.argv.slice(2);
const write = args.includes('--write');
const sql = args.filter((value) => value !== '--write').join(' ').trim();

if (!sql) {
  console.error('Cách dùng: node tools/cli/db-sql.js [--write] "<SQL>"');
  process.exit(1);
}
if (!write && !/^\s*(select|with|show|explain)\b/iu.test(sql)) {
  console.error('Chỉ cho SELECT/WITH/SHOW/EXPLAIN nếu không có --write.');
  process.exit(2);
}

const url = env.SUPABASE_URL;
const accessToken = env.SUPABASE_ACCESS_TOKEN;
const projectRef = env.SUPABASE_PROJECT_REF || (url ? (/^https:\/\/([a-z0-9]+)\.supabase\.co$/u.exec(url)?.[1] ?? null) : null);
if (!accessToken || !projectRef) {
  console.error('Thiếu SUPABASE_ACCESS_TOKEN (hoặc SUPABASE_URL để suy ra project ref).');
  process.exit(3);
}

const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
  method: 'POST',
  headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
  body: JSON.stringify({ query: sql }),
});
const text = await response.text();
if (!response.ok) {
  console.error(`HTTP ${response.status}: ${text.slice(0, 800)}`);
  process.exit(4);
}
let rows = [];
try {
  rows = JSON.parse(text);
} catch {
  console.log(text);
  process.exit(0);
}
console.log(JSON.stringify(rows, null, 2));
