import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCHEMA, SCHEMA_V2, COLUMN_MIGRATIONS } from './schema.js';
import { AGENCY_SCHEMA } from './agency_schema.js';
import { currentTenant } from './context.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// On Vercel (and other serverless hosts) only /tmp is writable, so the demo database and uploads
// live there. That storage is ephemeral: it resets on cold starts and is reseeded automatically.
export const DATA_DIR = process.env.HRMS_DATA_DIR || (process.env.VERCEL ? '/tmp/hrms-data' : path.resolve(here, '..', 'data'));
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

export type Row = Record<string, any>;

/* ------------------------------------------------------------------ */
/* Databases: one per client company + one for the agency              */
/* ------------------------------------------------------------------ */
/** The company used when a request has no company context (single-company installs, tests, public pages). */
export const DEFAULT_COMPANY_SLUG = process.env.HRMS_DEFAULT_COMPANY || 'acme';
export const COMPANY_DIR = path.join(DATA_DIR, 'companies');
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,40}$/;

const companyDbs = new Map<string, DatabaseSync>();
let agencyDbHandle: DatabaseSync | null = null;
let companyInitializer: ((slug: string) => void) | null = null;
/** Seeding hook, registered by seed.ts: fills a company database the first time it is opened empty. */
export function registerCompanyInitializer(fn: (slug: string) => void) {
  companyInitializer = fn;
}

function companyFile(slug: string) {
  // The default company keeps the historical single-database location (and HRMS_DB_FILE in tests).
  if (slug === DEFAULT_COMPANY_SLUG) {
    if (process.env.HRMS_DB_FILE) return process.env.HRMS_DB_FILE;
    const legacy = path.join(DATA_DIR, 'hrms.sqlite');
    const target = path.join(COMPANY_DIR, `${slug}.sqlite`);
    if (fs.existsSync(legacy) && !fs.existsSync(target)) {
      fs.mkdirSync(COMPANY_DIR, { recursive: true });
      fs.renameSync(legacy, target);
    }
    return target;
  }
  return path.join(COMPANY_DIR, `${slug}.sqlite`);
}

/** Open (creating and migrating if needed) the database of company `slug`. */
export function companyDb(slug: string): DatabaseSync {
  const open = companyDbs.get(slug);
  if (open) return open;
  if (!SLUG_RE.test(slug)) throw new Error(`Invalid company slug: ${slug}`);
  fs.mkdirSync(COMPANY_DIR, { recursive: true });
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const d = new DatabaseSync(companyFile(slug));
  d.exec('PRAGMA journal_mode = WAL');
  d.exec(SCHEMA);
  d.exec(SCHEMA_V2);
  migrateColumns(d);
  migratePalette(d);
  migrateTrendCardSize(d);
  companyDbs.set(slug, d);
  const empty = !d.prepare('SELECT 1 FROM users LIMIT 1').get();
  if (empty && companyInitializer && slug !== DEFAULT_COMPANY_SLUG) companyInitializer(slug);
  return d;
}

/** The agency database: companies, agency staff, billing, login directory. */
export function agencyDb(): DatabaseSync {
  if (agencyDbHandle) return agencyDbHandle;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const file = process.env.HRMS_AGENCY_DB_FILE || (process.env.HRMS_DB_FILE ? process.env.HRMS_DB_FILE.replace(/\.sqlite$/, '') + '.agency.sqlite' : path.join(DATA_DIR, 'agency.sqlite'));
  const d = new DatabaseSync(file);
  d.exec('PRAGMA journal_mode = WAL');
  d.exec(AGENCY_SCHEMA);
  agencyDbHandle = d;
  return d;
}

/** The current request's company database (falls back to the default company). */
export function getDb(): DatabaseSync {
  return companyDb(currentTenant()?.slug || DEFAULT_COMPANY_SLUG);
}
export const currentCompanySlug = () => currentTenant()?.slug || DEFAULT_COMPANY_SLUG;

/** Add columns introduced after the first release to databases created before them. */
function migrateColumns(d: DatabaseSync) {
  for (const [table, column, ddl] of COLUMN_MIGRATIONS) {
    const cols = d.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!cols.some((c) => c.name === column)) d.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  }
}

/** Move companies still on the original indigo default palette to the Darcio palette. */
function migratePalette(d: DatabaseSync) {
  const row = d.prepare("SELECT value FROM settings WHERE key = 'company'").get() as { value: string } | undefined;
  if (!row) return;
  try {
    const c = JSON.parse(row.value);
    if (String(c.brand_color).toLowerCase() !== '#4f46e5') return;
    c.brand_color = '#4A8F49';
    if (String(c.accent_color).toLowerCase() === '#0ea5a4') c.accent_color = '#D9922E';
    d.prepare("UPDATE settings SET value = ? WHERE key = 'company'").run(JSON.stringify(c));
  } catch { /* leave unparseable settings alone */ }
}

/**
 * The attendance trend card used to default to full width. Shrink existing ones to half width once
 * (a marker row stops it re-running, so a card a user later sets to Large stays Large).
 */
function migrateTrendCardSize(d: DatabaseSync) {
  const marker = 'migration:attendance_trend_md';
  if (d.prepare('SELECT 1 FROM settings WHERE key = ?').get(marker)) return;
  d.exec('BEGIN');
  try {
    d.prepare(`UPDATE dashboard_cards SET size = 'md' WHERE size = 'lg' AND json_extract(config, '$.key') = 'attendance_trend'`).run();
    const now = new Date().toISOString();
    d.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)').run(marker, JSON.stringify({ applied_at: now }), now);
    d.exec('COMMIT');
  } catch {
    d.exec('ROLLBACK');
  }
}

export function closeDb() {
  for (const d of companyDbs.values()) d.close();
  companyDbs.clear();
  agencyDbHandle?.close();
  agencyDbHandle = null;
}

/** Query helpers bound to one database; `agency` is the agency database's set. */
export function on(d: () => DatabaseSync) {
  const runQ = (sql: string, params: any[] = []) => {
    const r = d().prepare(sql).run(...params);
    return { lastId: Number(r.lastInsertRowid), changes: Number(r.changes) };
  };
  return {
    run: runQ,
    all: <T = Row>(sql: string, params: any[] = []) => d().prepare(sql).all(...params) as T[],
    get: <T = Row>(sql: string, params: any[] = []) => d().prepare(sql).get(...params) as T | undefined,
    insert: (table: string, data: Row) => {
      const keys = Object.keys(data);
      return runQ(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`, keys.map((k) => normalize(data[k]))).lastId;
    },
    update: (table: string, id: number | string, data: Row, idColumn = 'id') => {
      const keys = Object.keys(data);
      if (!keys.length) return 0;
      return runQ(`UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE ${idColumn} = ?`, [...keys.map((k) => normalize(data[k])), id]).changes;
    },
    transaction: <T>(fn: () => T): T => {
      const db = d();
      db.exec('BEGIN');
      try { const out = fn(); db.exec('COMMIT'); return out; } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
  };
}
export const agency = on(agencyDb);

/** Run a statement and return {lastInsertRowid, changes}. */
export function run(sql: string, params: any[] = []) {
  const r = getDb().prepare(sql).run(...params);
  return { lastId: Number(r.lastInsertRowid), changes: Number(r.changes) };
}
export function all<T = Row>(sql: string, params: any[] = []): T[] {
  return getDb().prepare(sql).all(...params) as T[];
}
export function get<T = Row>(sql: string, params: any[] = []): T | undefined {
  return getDb().prepare(sql).get(...params) as T | undefined;
}
export function transaction<T>(fn: () => T): T {
  const d = getDb();
  d.exec('BEGIN');
  try {
    const out = fn();
    d.exec('COMMIT');
    return out;
  } catch (e) {
    d.exec('ROLLBACK');
    throw e;
  }
}

/** Generic helper: insert a row from an object of column -> value. */
export function insert(table: string, data: Row): number {
  const keys = Object.keys(data);
  const sql = `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`;
  const id = run(sql, keys.map((k) => normalize(data[k]))).lastId;
  // Company logins are listed in the agency's login directory so sign-in can find the company.
  if (table === 'users' && data.email && !data.agency_user_id) registerLogin(String(data.email), currentCompanySlug());
  return id;
}
/** email → company slug, used by POST /api/auth/login. */
export function registerLogin(email: string, slug: string) {
  agency.run('INSERT INTO login_directory (email, company_slug) VALUES (lower(?), ?) ON CONFLICT(email, company_slug) DO NOTHING', [email, slug]);
}
/** Generic helper: update columns of a row by id. Returns number of changed rows. */
export function update(table: string, id: number | string, data: Row, idColumn = 'id'): number {
  const keys = Object.keys(data);
  if (!keys.length) return 0;
  const sql = `UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE ${idColumn} = ?`;
  return run(sql, [...keys.map((k) => normalize(data[k])), id]).changes;
}

function normalize(v: any) {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof Date) return v.toISOString();
  if (v !== null && typeof v === 'object') return JSON.stringify(v);
  return v;
}

/** Settings are JSON blobs keyed by name. */
export function getSetting<T = any>(key: string, fallback: T): T {
  const row = get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]);
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}
export function setSetting(key: string, value: any) {
  run(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, JSON.stringify(value), new Date().toISOString()],
  );
}

/** Parse JSON columns on a row in place (safe no-op when the column is already parsed). */
export function parseJson<T extends Row>(row: T | undefined, cols: string[]): T | undefined {
  if (!row) return row;
  for (const c of cols) {
    const v = (row as Row)[c];
    if (typeof v === 'string') {
      try {
        (row as Row)[c] = JSON.parse(v);
      } catch {
        /* leave as-is */
      }
    }
  }
  return row;
}
export function parseJsonAll<T extends Row>(rows: T[], cols: string[]): T[] {
  rows.forEach((r) => parseJson(r, cols));
  return rows;
}
