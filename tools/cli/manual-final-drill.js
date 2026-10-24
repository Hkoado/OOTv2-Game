/**
 * manual-final-drill.js — Rehearsal migration + drill Chung kết thủ công.
 *
 * Mục đích: kiểm DDL/trigger/function/quyền trên PostgreSQL thật **mà không apply migration**.
 * Toàn bộ (migration DDL + drill + assertions) chạy trong MỘT transaction và kết thúc bằng
 * ROLLBACK, nên project đích không đổi schema/dữ liệu. Muốn áp thật, operator tự chạy
 * `npm run db:apply-migrations -- --apply` theo quy trình migration history.
 *
 *   npm run db:manual          (rehearsal, luôn rollback)
 *
 * Yêu cầu: SUPABASE_URL + SUPABASE_ACCESS_TOKEN (Management API), role `postgres`.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');

export const MIGRATION_FILE = 'supabase/migrations/20261026100000_manual_final.sql';
export const DRILL_FILE = 'supabase/tests/manual_final.sql';
const WRITE_RE = /\b(commit|rollback|begin)\s*;/iu;

/** Bỏ `begin;`/`rollback;` của file drill để gộp chung transaction với migration. */
export function stripTransaction(sql) {
  return String(sql)
    .replace(/^[ \t]*begin\s*;[ \t]*$/imu, '')
    .replace(/^[ \t]*rollback\s*;[ \t]*$/imu, '')
    .trim();
}

/**
 * Ghép một script duy nhất: BEGIN → migration → drill assertions → ROLLBACK.
 * Từ chối nếu có COMMIT/ROLLBACK/BEGIN lồng bên trong (không thể bảo đảm rollback).
 */
export function composeDrillSql({ migrationSql, drillSql }) {
  const body = stripTransaction(drillSql);
  if (!body) throw new Error('invalid_drill_script');
  if (!/^[ \t]*begin\s*;[ \t]*$/imu.test(drillSql) || !/^[ \t]*rollback\s*;[ \t]*$/imu.test(drillSql)) {
    throw new Error('drill_must_be_transactional');
  }
  for (const [name, sql] of [['migration', stripTransaction(migrationSql)], ['drill', body]]) {
    if (WRITE_RE.test(sql)) throw new Error(`${name}_contains_transaction_control`);
  }
  return `begin;\nset local statement_timeout = '120s';\n${migrationSql.trim()}\n${body}\nrollback;\n`;
}

function loadEnv() {
  const env = {};
  try {
    for (const line of readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/u)) {
      const match = /^([A-Za-z0-9_]+)=(.*)$/u.exec(line.trim());
      if (match) env[match[1]] = match[2].replace(/^["']|["']$/gu, '');
    }
  } catch {
    // Không có .env: dùng process.env.
  }
  return { ...env, ...process.env };
}

async function main() {
  const env = loadEnv();
  const url = env.SUPABASE_URL;
  const token = env.SUPABASE_ACCESS_TOKEN;
  const ref = env.SUPABASE_PROJECT_REF || (url ? (/^https:\/\/([a-z0-9]+)\.supabase\.co$/u.exec(url)?.[1] ?? null) : null);
  if (!ref || !token) {
    console.error('Thiếu SUPABASE_ACCESS_TOKEN hoặc SUPABASE_URL/SUPABASE_PROJECT_REF.');
    process.exitCode = 3;
    return;
  }
  const migrationSql = readFileSync(path.join(root, MIGRATION_FILE), 'utf8');
  const drillSql = readFileSync(path.join(root, DRILL_FILE), 'utf8');
  const query = composeDrillSql({ migrationSql, drillSql });
  console.log(`[manual-final] rehearsal: ${MIGRATION_FILE} + ${DRILL_FILE} trong 1 transaction (ROLLBACK)`);
  const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const text = await response.text();
  if (!response.ok) {
    // Không process.exit khi fetch còn handle: để Node thoát tự nhiên (tránh lỗi libuv Windows).
    process.exitCode = 4;
    console.error(`FAIL  HTTP ${response.status}: ${text.slice(0, 1200)}`);
    console.error('Migration KHÔNG được apply; project đích không đổi (transaction đã rollback).');
    return;
  }
  console.log('PASS  RLS grants, select/lock/gate, pair idempotent, finish fence, duplicate finish,');
  console.log('      cancel/rerun, close guard, audit append-only — tất cả trong 1 transaction đã ROLLBACK.');
  console.log('NOT APPLIED: migration chưa vào project; operator tự chạy db:apply-migrations khi được phép.');
}

const isEntryPoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  await main();
}

