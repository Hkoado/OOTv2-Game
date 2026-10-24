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
 * `migrationApplied=true`: schema đã có (đã apply) nên chỉ chạy assertions trong transaction.
 */
export function composeDrillSql({ migrationSql, drillSql, migrationApplied = false }) {
  const body = stripTransaction(drillSql);
  if (!body) throw new Error('invalid_drill_script');
  if (!/^[ \t]*begin\s*;[ \t]*$/imu.test(drillSql) || !/^[ \t]*rollback\s*;[ \t]*$/imu.test(drillSql)) {
    throw new Error('drill_must_be_transactional');
  }
  if (migrationApplied) {
    if (WRITE_RE.test(body)) throw new Error('drill_contains_transaction_control');
    return `begin;\nset local statement_timeout = '120s';\n${body}\nrollback;\n`;
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

/** Schema đã được apply chưa? (chỉ đọc Management API, không ghi DB). */
async function manualTablesPresent({ ref, token }) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query: "select to_regclass('public.mvp_manual_final_events') is not null as present" }),
  });
  if (!response.ok) throw new Error(`schema_probe_${response.status}`);
  const rows = JSON.parse(await response.text());
  return Array.isArray(rows) && rows[0]?.present === true;
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
  let present;
  try {
    present = await manualTablesPresent({ ref, token });
  } catch (error) {
    // Không đoán schema: đoán sai sẽ chạy DDL trùng hoặc bỏ qua migration.
    process.exitCode = 3;
    console.error(`FAIL  không đọc được trạng thái schema: ${error.message}`);
    return;
  }
  const query = composeDrillSql({ migrationSql, drillSql, migrationApplied: present });
  console.log(`[manual-final] rehearsal: ${DRILL_FILE} trong 1 transaction (ROLLBACK)`);
  console.log(`[manual-final] schema: ${present ? 'đã apply (chỉ drill)' : 'chưa apply (kèm migration, không ghi DB)'}`);
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
  console.log(present
    ? 'APPLIED: schema đã có trên project; drill chỉ kiểm hành vi và đã rollback dữ liệu drill.'
    : 'NOT APPLIED: migration chưa vào project; operator tự chạy db:apply-migrations khi được phép.');
}

const isEntryPoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  await main();
}

