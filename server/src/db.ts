import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCHEMA, SCHEMA_V2, COLUMN_MIGRATIONS } from './schema.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// On Vercel (and other serverless hosts) only /tmp is writable, so the demo database and uploads
// live there. That storage is ephemeral: it resets on cold starts and is reseeded automatically.
export const DATA_DIR = process.env.HRMS_DATA_DIR || (process.env.VERCEL ? '/tmp/hrms-data' : path.resolve(here, '..', 'data'));
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

export type Row = Record<string, any>;

let db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (db) return db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const file = process.env.HRMS_DB_FILE || path.join(DATA_DIR, 'hrms.sqlite');
  db = new DatabaseSync(file);
  db.exec(SCHEMA);
  db.exec(SCHEMA_V2);
  migrateColumns(db);
  return db;
}

/** Add columns introduced after the first release to databases created before them. */
function migrateColumns(d: DatabaseSync) {
  for (const [table, column, ddl] of COLUMN_MIGRATIONS) {
    const cols = d.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!cols.some((c) => c.name === column)) d.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  }
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

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
  return run(sql, keys.map((k) => normalize(data[k]))).lastId;
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
