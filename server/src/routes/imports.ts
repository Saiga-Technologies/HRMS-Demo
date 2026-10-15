import { Router } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import JSZip from 'jszip';
import { all, get, insert, getSetting, transaction, currentCompanySlug } from '../db.js';
import { requireHr } from '../auth.js';
import { badRequest, audit, nowIso, isIsoDate, today } from '../util.js';
import { DEFAULT_COMPANY, DEFAULT_PAYROLL_SETTINGS } from './settings.js';
import { createEmployeeRecord, nextEmployeeCode } from './employees.js';

/**
 * Bulk employee import (template, validate, commit). Mounted at /api/imports (HR only).
 *
 * Flow: download the template for the company's country → fill it in a spreadsheet → POST it to
 * /employees/validate (nothing is written; every row is checked) → POST /employees/commit with the
 * returned token (or the rows themselves, for serverless instances that did not see the upload).
 * Commit re-validates and creates everything in one transaction through createEmployeeRecord, so
 * journey stages, leave balances and logins are created exactly like the Add employee form.
 */
const r = Router();
export default r;

/* ------------------------------------------------------------------ */
/* Columns and country formats                                         */
/* ------------------------------------------------------------------ */
type Cc = 'IN' | 'AE' | 'SA' | 'QA' | 'US';
const GCC: Cc[] = ['AE', 'SA', 'QA'];
const isGcc = (cc: Cc) => GCC.includes(cc);

export const EMPLOYMENT_TYPES = ['full_time', 'part_time', 'contract', 'intern', 'consultant'];
export const IMPORT_STATUSES = ['active', 'probation', 'onboarding', 'notice'];
const GENDERS = ['male', 'female', 'other'];

interface ColumnDef { key: string; label: string; required?: boolean; description: string; example?: string }

const IBAN_LENGTH: Record<string, number> = { AE: 23, SA: 24, QA: 29 };
const TAX_ID_LABEL: Record<Cc, string> = { IN: 'PAN', AE: 'Emirates ID', SA: 'Iqama / Saudi ID', QA: 'QID', US: 'SSN (masked)' };
const BANK_CODE_LABEL: Record<Cc, string> = { IN: 'IFSC', AE: 'SWIFT / BIC', SA: 'SWIFT / BIC', QA: 'SWIFT / BIC', US: 'ABA routing number' };

function countryFormats(cc: Cc): { field: string; label: string; format: string; example: string }[] {
  if (cc === 'IN') return [
    { field: 'tax_id', label: 'PAN', format: '5 letters, 4 digits, 1 letter (e.g. ABCPK1234F)', example: 'ABCPK1234F' },
    { field: 'bank_ifsc', label: 'IFSC', format: '4 letters, a zero, then 6 letters or digits (e.g. HDFC0001234)', example: 'HDFC0001234' },
    { field: 'pf_number', label: 'UAN', format: '12 digits', example: '100123456789' },
    { field: 'bank_account_number', label: 'Bank account', format: '9 to 18 digits', example: '50100123456789' },
  ];
  if (cc === 'US') return [
    { field: 'tax_id', label: 'SSN', format: 'Masked only: ***-**-1234 (last 4 digits). Full SSNs are rejected; we never store them.', example: '***-**-1234' },
    { field: 'bank_ifsc', label: 'ABA routing number', format: '9 digits with a valid ABA checksum', example: '021000021' },
    { field: 'bank_account_number', label: 'Bank account', format: '4 to 17 digits', example: '000123456789' },
  ];
  const idFormat = cc === 'AE' ? { format: '784-YYYY-NNNNNNN-N (15 digits)', example: '784-1990-1234567-1' }
    : cc === 'SA' ? { format: '10 digits starting with 1 (Saudi national) or 2 (Iqama, resident)', example: '2123456789' }
    : { format: '11 digits', example: '28935612345' };
  return [
    { field: 'bank_account_number', label: 'IBAN', format: `${cc} followed by ${IBAN_LENGTH[cc] - 2} characters; the mod-97 check digits must be valid`, example: exampleIban(cc, 1) },
    { field: 'bank_ifsc', label: 'SWIFT / BIC', format: '8 or 11 characters (e.g. EBILAEAD)', example: cc === 'AE' ? 'EBILAEAD' : cc === 'SA' ? 'NCBKSAJE' : 'QNBAQAQA' },
    { field: 'tax_id', label: TAX_ID_LABEL[cc], ...idFormat },
    { field: 'nationality', label: 'Nationality', format: 'Recommended for GCC payroll (WPS, social insurance for nationals)', example: cc === 'AE' ? 'Indian' : 'Egyptian' },
  ];
}

function columnsFor(cc: Cc): ColumnDef[] {
  return [
    { key: 'employee_code', label: 'Employee code', description: 'Optional. Left blank, the next code is generated from the company prefix.' },
    { key: 'first_name', label: 'First name', required: true, description: 'Given name.' },
    { key: 'last_name', label: 'Last name', description: 'Family name.' },
    { key: 'email', label: 'Email', required: true, description: 'Work email, unique per employee. It is also the login user ID.' },
    { key: 'phone', label: 'Phone', description: 'Mobile number with country code.' },
    { key: 'gender', label: 'Gender', description: 'male, female or other.' },
    { key: 'dob', label: 'Date of birth', description: 'YYYY-MM-DD.' },
    { key: 'join_date', label: 'Join date', required: true, description: 'YYYY-MM-DD. Also the effective date of the opening salary structure.' },
    { key: 'employment_type', label: 'Employment type', description: `${EMPLOYMENT_TYPES.join(' | ')} (default full_time).` },
    { key: 'status', label: 'Status', description: `${IMPORT_STATUSES.join(' | ')} (default active).` },
    { key: 'department', label: 'Department', description: 'Department name. Missing departments are created when "Create missing departments/positions" is on.' },
    { key: 'position', label: 'Position', description: 'Job title. Created inside the row\'s department when missing (same switch).' },
    { key: 'manager', label: 'Manager', description: 'Reporting manager: an employee code or email of an existing employee, or of another row in this file.' },
    { key: 'work_location', label: 'Work location', description: 'Name of an existing work location (Org structure → Locations).' },
    { key: 'shift', label: 'Shift', description: 'Name of an existing shift.' },
    { key: 'city', label: 'City', description: 'City of residence.' },
    { key: 'country', label: 'Country', description: 'Country of residence.' },
    { key: 'nationality', label: 'Nationality', description: isGcc(cc) ? 'Recommended: drives WPS and social insurance for nationals.' : 'Optional.' },
    { key: 'bank_name', label: 'Bank name', description: 'Salary bank.' },
    { key: 'bank_account_name', label: 'Account holder', description: 'Name on the bank account.' },
    { key: 'bank_account_number', label: isGcc(cc) ? 'IBAN' : 'Bank account number', description: isGcc(cc) ? `IBAN (${cc}…); the checksum is verified.` : 'Account number (digits).' },
    { key: 'bank_ifsc', label: BANK_CODE_LABEL[cc], description: cc === 'IN' ? 'IFSC of the branch.' : cc === 'US' ? 'ABA routing number (9 digits, checksum verified).' : 'SWIFT / BIC of the bank.' },
    { key: 'tax_id', label: TAX_ID_LABEL[cc], description: cc === 'US' ? 'Masked SSN only (***-**-1234). Full SSNs are rejected.' : `${TAX_ID_LABEL[cc]} (format checked).` },
    { key: 'pf_number', label: 'UAN', description: cc === 'IN' ? 'Universal Account Number for PF (12 digits).' : 'India only; leave blank.' },
    { key: 'basic_monthly', label: 'Basic (monthly)', description: 'Monthly basic salary in the company currency. Creates the opening salary structure with the company\'s default components.' },
    { key: 'create_login', label: 'Create login', description: 'yes / no. With "Create logins" on, a login with a temporary password is created (default yes).' },
  ];
}
const COLUMN_KEYS = columnsFor('IN').map((c) => c.key);

/** Header aliases: case/space-insensitive names map to column keys. */
const ALIASES: Record<string, string> = {
  code: 'employee_code', emp_code: 'employee_code', employee_id: 'employee_code', id: 'employee_code',
  first: 'first_name', firstname: 'first_name', given_name: 'first_name', last: 'last_name', lastname: 'last_name', surname: 'last_name',
  email_address: 'email', work_email: 'email', mobile: 'phone', phone_number: 'phone', sex: 'gender', date_of_birth: 'dob', birth_date: 'dob',
  joining_date: 'join_date', date_of_joining: 'join_date', doj: 'join_date', start_date: 'join_date', type: 'employment_type',
  dept: 'department', department_name: 'department', title: 'position', job_title: 'position', designation: 'position',
  reporting_manager: 'manager', manager_code: 'manager', manager_email: 'manager', location: 'work_location',
  iban: 'bank_account_number', account_number: 'bank_account_number', ifsc: 'bank_ifsc', swift: 'bank_ifsc', routing_number: 'bank_ifsc',
  pan: 'tax_id', uan: 'pf_number', basic: 'basic_monthly', basic_salary: 'basic_monthly', login: 'create_login',
};
export function normalizeHeader(h: string): string {
  const k = String(h || '').replace(/^﻿/, '').replace(/\*/g, '').replace(/\(.*?\)/g, '').trim().toLowerCase().replace(/[\s\-./]+/g, '_').replace(/^_+|_+$/g, '');
  if (COLUMN_KEYS.includes(k)) return k;
  if (ALIASES[k]) return ALIASES[k];
  const squashed = k.replace(/_/g, '');
  return COLUMN_KEYS.find((c) => c.replace(/_/g, '') === squashed) || ALIASES[squashed] || k;
}

function companyCountry(): Cc {
  const cc = String(getSetting<any>('company', DEFAULT_COMPANY).country_code || 'IN').toUpperCase();
  return (['IN', 'AE', 'SA', 'QA', 'US'].includes(cc) ? cc : 'IN') as Cc;
}
function companyCurrency(): string {
  return getSetting<any>('payroll', DEFAULT_PAYROLL_SETTINGS).currency || getSetting<any>('company', DEFAULT_COMPANY).currency || 'INR';
}

/* ------------------------------------------------------------------ */
/* Checksums and formats                                               */
/* ------------------------------------------------------------------ */
function mod97(s: string): number {
  let rem = 0;
  for (const ch of s) rem = (rem * 10 + Number(ch)) % 97;
  return rem;
}
const ibanNumeric = (s: string) => s.toUpperCase().replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
export function ibanValid(iban: string): boolean {
  const s = iban.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{8,30}$/.test(s)) return false;
  return mod97(ibanNumeric(s.slice(4) + s.slice(0, 4))) === 1;
}
function makeIban(cc: string, bban: string) {
  const rem = mod97(ibanNumeric(bban + cc + '00'));
  return `${cc}${String(98 - rem).padStart(2, '0')}${bban}`;
}
function exampleIban(cc: Cc, n: number): string {
  const digits = (len: number) => `1${String(n * 7919).padStart(len - 1, '0')}`;
  if (cc === 'AE') return makeIban('AE', `026${digits(16)}`);
  if (cc === 'SA') return makeIban('SA', `10${digits(18)}`);
  return makeIban('QA', `QNBA${digits(21)}`);
}
export function abaValid(s: string): boolean {
  if (!/^\d{9}$/.test(s)) return false;
  const d = s.split('').map(Number);
  return (3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + (d[2] + d[5] + d[8])) % 10 === 0;
}
function realDate(s: string): boolean {
  if (!isIsoDate(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/* ------------------------------------------------------------------ */
/* Template                                                            */
/* ------------------------------------------------------------------ */
function csvCell(v: any): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function exampleRows(cc: Cc): Record<string, string>[] {
  const slug = currentCompanySlug();
  const dept = get<any>('SELECT id, name FROM departments WHERE active = 1 ORDER BY sort_order, id LIMIT 1');
  const pos = dept ? get<any>('SELECT title FROM positions WHERE active = 1 AND department_id = ? ORDER BY level DESC, id LIMIT 1', [dept.id]) : undefined;
  const pos2 = dept ? get<any>('SELECT title FROM positions WHERE active = 1 AND department_id = ? ORDER BY level ASC, id LIMIT 1', [dept.id]) : undefined;
  const loc = get<any>('SELECT name FROM work_locations WHERE active = 1 ORDER BY id LIMIT 1');
  const shift = get<any>('SELECT name FROM shifts WHERE active = 1 ORDER BY id LIMIT 1');
  const t = today();
  const join = `${t.slice(0, 8)}01`;
  const common = { department: dept?.name || 'Operations', work_location: loc?.name || '', shift: shift?.name || '', employment_type: 'full_time', create_login: 'yes' };
  const country = { IN: 'India', AE: 'United Arab Emirates', SA: 'Saudi Arabia', QA: 'Qatar', US: 'United States' }[cc];
  const people: Record<Cc, [string, string, string, string, string, string, string][]> = {
    // first, last, gender, dob, city, nationality, phone
    IN: [['Asha', 'Krishnan', 'female', '1990-04-12', 'Bengaluru', 'Indian', '+91 98450 11223'], ['Rohit', 'Bansal', 'male', '1996-09-03', 'Bengaluru', 'Indian', '+91 98861 44556']],
    AE: [['Omar', 'Haddad', 'male', '1986-02-17', 'Dubai', 'Jordanian', '+971 50 123 4567'], ['Priya', 'Menon', 'female', '1993-07-21', 'Dubai', 'Indian', '+971 55 765 4321']],
    SA: [['Fahad', 'Al-Qahtani', 'male', '1985-05-09', 'Riyadh', 'Saudi', '+966 50 123 4567'], ['Ahmed', 'Mostafa', 'male', '1992-11-30', 'Riyadh', 'Egyptian', '+966 55 765 4321']],
    QA: [['Khalid', 'Al-Thani', 'male', '1984-03-14', 'Doha', 'Qatari', '+974 5512 3456'], ['Maria', 'Santos', 'female', '1994-08-02', 'Doha', 'Filipino', '+974 6654 3210']],
    US: [['Emily', 'Carter', 'female', '1989-06-18', 'Austin', 'American', '+1 512 555 0142'], ['Daniel', 'Nguyen', 'male', '1995-01-27', 'Austin', 'American', '+1 512 555 0178']],
  };
  const ids = (i: number): Record<string, string> => {
    if (cc === 'IN') return { bank_name: 'HDFC Bank', bank_account_number: i ? '50100987654321' : '50100123456789', bank_ifsc: i ? 'HDFC0004321' : 'HDFC0001234', tax_id: i ? 'BCDPB5678K' : 'ABCPK1234F', pf_number: i ? '100987654321' : '100123456789', basic_monthly: i ? '32000' : '55000' };
    if (cc === 'US') return { bank_name: 'JPMorgan Chase', bank_account_number: i ? '000987654321' : '000123456789', bank_ifsc: '021000021', tax_id: i ? '***-**-5678' : '***-**-1234', pf_number: '', basic_monthly: i ? '5200' : '7800' };
    const bank = { AE: ['Emirates NBD', 'EBILAEAD'], SA: ['Saudi National Bank', 'NCBKSAJE'], QA: ['Qatar National Bank', 'QNBAQAQA'] }[cc as 'AE'];
    const tax = cc === 'AE' ? (i ? '784-1993-7654321-4' : '784-1986-1234567-1') : cc === 'SA' ? (i ? '2345678901' : '1098765432') : (i ? '29460812345' : '28463412345');
    return { bank_name: bank[0], bank_account_number: exampleIban(cc, i + 1), bank_ifsc: bank[1], tax_id: tax, pf_number: '', basic_monthly: cc === 'AE' ? (i ? '9000' : '15000') : cc === 'SA' ? (i ? '8000' : '14000') : (i ? '7000' : '13000') };
  };
  return people[cc].map(([first, last, gender, dob, city, nationality, phone], i) => {
    const email = `${first}.${last}`.toLowerCase().replace(/[^a-z.]/g, '') + `.new@${slug}.example`;
    return {
      employee_code: '', first_name: first, last_name: last, email, phone, gender, dob, join_date: join,
      status: i ? 'probation' : 'active', ...common, position: (i ? pos2?.title : pos?.title) || (i ? 'Associate' : 'Team Lead'),
      manager: '',
      city, country, nationality, bank_account_name: `${first} ${last}`, ...ids(i),
    } as Record<string, string>;
  }).map((row, i, arr) => (i ? { ...row, manager: arr[0].email } : row)); // row 2 reports to row 1 (managers may be rows of the same file)
}

r.get('/employees/template.csv', requireHr, (_req, res) => {
  const cc = companyCountry();
  const cols = columnsFor(cc).map((c) => c.key);
  const lines = [cols.join(','), ...exampleRows(cc).map((row) => cols.map((k) => csvCell(row[k] ?? '')).join(','))];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="employee-import-${cc.toLowerCase()}.csv"`);
  res.send(lines.join('\r\n') + '\r\n');
});

r.get('/employees/template-info', requireHr, (_req, res) => {
  const cc = companyCountry();
  res.json({
    country_code: cc,
    currency: companyCurrency(),
    columns: columnsFor(cc),
    formats: countryFormats(cc),
    enums: { employment_type: EMPLOYMENT_TYPES, status: IMPORT_STATUSES, gender: GENDERS, create_login: ['yes', 'no'] },
    departments: all<any>('SELECT name FROM departments WHERE active = 1 ORDER BY name').map((d) => d.name),
    work_locations: all<any>('SELECT name FROM work_locations WHERE active = 1 ORDER BY name').map((d) => d.name),
    shifts: all<any>('SELECT name FROM shifts WHERE active = 1 ORDER BY name').map((d) => d.name),
    max_rows: MAX_ROWS,
  });
});

/* ------------------------------------------------------------------ */
/* Parsing (CSV and XLSX)                                              */
/* ------------------------------------------------------------------ */
const MAX_ROWS = 2000;

/** RFC 4180-ish CSV: quoted fields, escaped quotes, commas/newlines inside quotes, CRLF, BOM. */
export function parseCsv(text: string): string[][] {
  const s = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field.trim() === '') { field = ''; quoted = true; }
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\r') { /* handled with \n */ if (s[i + 1] !== '\n') { row.push(field); rows.push(row); row = []; field = ''; } }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

const xmlText = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&');
const colIndex = (ref: string) => ref.replace(/\d+/g, '').split('').reduce((n, c) => n * 26 + (c.charCodeAt(0) - 64), 0) - 1;

/** First worksheet of an .xlsx as a grid of strings (shared and inline strings, numbers). */
export async function parseXlsx(buf: Buffer): Promise<string[][]> {
  const zip = await JSZip.loadAsync(buf);
  const shared: string[] = [];
  const ss = await zip.file('xl/sharedStrings.xml')?.async('string');
  if (ss) for (const m of ss.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(xmlText([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')));
  let sheetPath = 'xl/worksheets/sheet1.xml';
  const wb = await zip.file('xl/workbook.xml')?.async('string');
  const rels = await zip.file('xl/_rels/workbook.xml.rels')?.async('string');
  const firstRid = wb?.match(/<sheet\b[^>]*r:id="([^"]+)"/)?.[1];
  if (firstRid && rels) {
    const target = rels.match(new RegExp(`<Relationship\\b[^>]*Id="${firstRid}"[^>]*Target="([^"]+)"`))?.[1]
      || rels.match(new RegExp(`<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="${firstRid}"`))?.[1];
    if (target) sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
  }
  const sheet = await zip.file(sheetPath)?.async('string');
  if (!sheet) throw badRequest('The workbook has no worksheet');
  const grid: string[][] = [];
  for (const rm of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    let next = 0;
    for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1];
      const ref = attrs.match(/\br="([A-Z]+\d+)"/)?.[1];
      const idx = ref ? colIndex(ref) : next;
      next = idx + 1;
      const type = attrs.match(/\bt="([^"]+)"/)?.[1];
      const inner = cm[2] || '';
      let v = '';
      if (type === 'inlineStr') v = [...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => xmlText(t[1])).join('');
      else {
        const raw = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        if (raw !== undefined) v = type === 's' ? shared[Number(raw)] ?? '' : xmlText(raw);
      }
      while (cells.length < idx) cells.push('');
      cells[idx] = v;
    }
    grid.push(cells);
  }
  return grid.filter((r) => r.some((c) => String(c).trim() !== ''));
}

/** Excel stores dates as serial day numbers (1900 system). */
function excelSerialToIso(v: string): string {
  if (!/^\d{4,6}(\.\d+)?$/.test(v)) return v;
  const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(v)) * 86400000);
  return d.toISOString().slice(0, 10);
}

export type RawRow = Record<string, string>;
interface Parsed { rows: RawRow[]; unknown_columns: string[]; columns: string[] }

function gridToRows(grid: string[][], fromXlsx: boolean): Parsed {
  if (!grid.length) throw badRequest('The file is empty');
  const header = grid[0].map(normalizeHeader);
  const unknown = grid[0].filter((_h, i) => header[i] && !COLUMN_KEYS.includes(header[i])).map((h) => String(h).trim());
  const rows = grid.slice(1).map((cells) => {
    const o: RawRow = {};
    header.forEach((k, i) => {
      if (!COLUMN_KEYS.includes(k)) return;
      let v = String(cells[i] ?? '').trim();
      if (fromXlsx && (k === 'dob' || k === 'join_date')) v = excelSerialToIso(v);
      if (o[k] === undefined || o[k] === '') o[k] = v;
    });
    return o;
  });
  if (rows.length > MAX_ROWS) throw badRequest(`The file has ${rows.length} rows; import at most ${MAX_ROWS} at a time`);
  return { rows, unknown_columns: unknown, columns: header.filter((k) => COLUMN_KEYS.includes(k)) };
}

/** Only known columns, as trimmed strings (rows sent back by the client are untrusted). */
function cleanRows(input: any): RawRow[] {
  if (!Array.isArray(input)) throw badRequest('rows must be an array');
  if (input.length > MAX_ROWS) throw badRequest(`Import at most ${MAX_ROWS} rows at a time`);
  return input.map((x: any) => {
    const o: RawRow = {};
    const src = x && typeof x === 'object' ? (x.data && typeof x.data === 'object' ? x.data : x) : {};
    for (const k of COLUMN_KEYS) if (src[k] !== undefined && src[k] !== null) o[k] = String(src[k]).trim();
    return o;
  });
}

/* ------------------------------------------------------------------ */
/* Upload store (short-lived, per company)                             */
/* ------------------------------------------------------------------ */
const TTL_MS = 30 * 60 * 1000;
const uploads = new Map<string, { rows: RawRow[]; expires: number; unknown_columns: string[] }>();
function sweep() {
  const now = Date.now();
  for (const [k, v] of uploads) if (v.expires < now) uploads.delete(k);
}
const storeKey = (token: string) => `${currentCompanySlug()}:${token}`;
function storeRows(rows: RawRow[], unknown_columns: string[]): string {
  sweep();
  const token = crypto.randomBytes(16).toString('hex');
  uploads.set(storeKey(token), { rows, unknown_columns, expires: Date.now() + TTL_MS });
  return token;
}
function loadRows(token: string) {
  sweep();
  return uploads.get(storeKey(String(token)));
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */
interface Issue { field: string; message: string }
export interface ValidatedRow { row: number; data: RawRow; errors: Issue[]; warnings: Issue[] }
interface Plan {
  rows: ValidatedRow[];
  summary: { total: number; valid: number; with_errors: number; warnings: number; will_create: { departments: string[]; positions: { title: string; department: string | null }[] } };
  /** Row index (0-based) → index of the file row that is its manager. */
  fileManager: Map<number, number>;
  existingManager: Map<number, number>;
  deptByName: Map<string, number>;
  positions: { id: number; title: string; department_id: number | null }[];
  locByName: Map<string, number>;
  shiftByName: Map<string, number>;
}
const lc = (s: string | undefined) => String(s || '').trim().toLowerCase();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const yes = (v: string | undefined) => ['yes', 'y', 'true', '1'].includes(lc(v));
const no = (v: string | undefined) => ['no', 'n', 'false', '0'].includes(lc(v));

export function validateRows(input: RawRow[], opts: { create_missing: boolean }): Plan {
  const cc = companyCountry();
  const deptByName = new Map(all<any>('SELECT id, name FROM departments').map((d) => [lc(d.name), d.id as number]));
  const positions = all<any>('SELECT id, title, department_id FROM positions');
  const locByName = new Map(all<any>('SELECT id, name FROM work_locations').map((d) => [lc(d.name), d.id as number]));
  const shiftByName = new Map(all<any>('SELECT id, name FROM shifts').map((d) => [lc(d.name), d.id as number]));
  const empByCode = new Map(all<any>('SELECT id, employee_code, status FROM employees').map((e) => [lc(e.employee_code), e]));
  const empByEmail = new Map(all<any>('SELECT id, email, status FROM employees').map((e) => [lc(e.email), e]));
  const userEmails = new Set(all<any>('SELECT email FROM users').map((u) => lc(u.email)));
  const typesSetting = getSetting<string[]>('employment_types', EMPLOYMENT_TYPES);
  const empTypes = new Set([...EMPLOYMENT_TYPES, ...(Array.isArray(typesSetting) ? typesSetting : [])].map(lc));

  // In-file indexes for uniqueness and manager references.
  const emailRows = new Map<string, number[]>();
  const codeRows = new Map<string, number[]>();
  input.forEach((d, i) => {
    if (d.email) emailRows.set(lc(d.email), [...(emailRows.get(lc(d.email)) || []), i]);
    if (d.employee_code) codeRows.set(lc(d.employee_code), [...(codeRows.get(lc(d.employee_code)) || []), i]);
  });

  const willDepts = new Map<string, string>();
  const willPositions = new Map<string, { title: string; department: string | null }>();
  const fileManager = new Map<number, number>();
  const existingManager = new Map<number, number>();

  const rows: ValidatedRow[] = input.map((raw, i) => {
    const d: RawRow = { ...raw };
    const errors: Issue[] = [];
    const warnings: Issue[] = [];
    const err = (field: string, message: string) => errors.push({ field, message });
    const warn = (field: string, message: string) => warnings.push({ field, message });

    // Normalise identifiers.
    for (const k of ['tax_id', 'bank_ifsc']) if (d[k]) d[k] = d[k].toUpperCase().replace(/\s+/g, '');
    if (d.bank_account_number && isGcc(cc)) d.bank_account_number = d.bank_account_number.replace(/\s+/g, '').toUpperCase();
    if (d.email) d.email = d.email.trim();
    for (const k of ['gender', 'employment_type', 'status']) if (d[k]) d[k] = d[k].toLowerCase().replace(/[\s-]+/g, '_');
    if (d.gender === 'm') d.gender = 'male';
    if (d.gender === 'f') d.gender = 'female';

    // Required fields.
    if (!d.first_name) err('first_name', 'First name is required');
    if (!d.email) err('email', 'Email is required');
    if (!d.join_date) err('join_date', 'Join date is required');

    // Email: format, unique in file, unique against employees and logins.
    if (d.email) {
      if (!EMAIL_RE.test(d.email)) err('email', `"${d.email}" is not a valid email address`);
      else {
        const dup = emailRows.get(lc(d.email))!;
        if (dup.length > 1) err('email', `Duplicate email in this file (rows ${dup.map((x) => x + 2).join(', ')})`);
        if (empByEmail.has(lc(d.email))) err('email', 'An employee with this email already exists');
        else if (userEmails.has(lc(d.email))) err('email', 'A login with this email already exists');
      }
    }
    // Employee code.
    if (d.employee_code) {
      if (!/^[A-Za-z0-9._\-/]{1,30}$/.test(d.employee_code)) err('employee_code', 'Use letters, digits, dot, dash, slash or underscore (max 30)');
      const dup = codeRows.get(lc(d.employee_code))!;
      if (dup.length > 1) err('employee_code', `Duplicate employee code in this file (rows ${dup.map((x) => x + 2).join(', ')})`);
      if (empByCode.has(lc(d.employee_code))) err('employee_code', `Employee code ${d.employee_code} is already in use`);
    }
    // Dates.
    for (const k of ['dob', 'join_date'] as const) {
      if (d[k] && !realDate(d[k])) err(k, `"${d[k]}" is not a valid date (use YYYY-MM-DD)`);
    }
    if (d.dob && d.join_date && realDate(d.dob) && realDate(d.join_date)) {
      if (d.dob >= d.join_date) err('dob', 'Date of birth must be before the join date');
      else if (Number(d.join_date.slice(0, 4)) - Number(d.dob.slice(0, 4)) < 15) warn('dob', 'Employee would be younger than 15 on the join date');
    }
    if (d.join_date && realDate(d.join_date) && d.join_date > today() && (d.status || 'active') === 'active') warn('join_date', 'Join date is in the future; consider status "onboarding"');
    // Enums.
    if (d.employment_type && !empTypes.has(d.employment_type)) err('employment_type', `"${d.employment_type}" is not one of ${[...empTypes].join(', ')}`);
    if (d.status && !IMPORT_STATUSES.includes(d.status)) err('status', `"${d.status}" is not one of ${IMPORT_STATUSES.join(', ')}`);
    if (d.gender && !GENDERS.includes(d.gender)) err('gender', `"${d.gender}" is not one of ${GENDERS.join(', ')}`);
    if (d.create_login && !yes(d.create_login) && !no(d.create_login)) err('create_login', 'Use yes or no');

    // Org references.
    let deptId: number | null = null;
    if (d.department) {
      deptId = deptByName.get(lc(d.department)) ?? null;
      if (deptId === null) {
        if (opts.create_missing) { willDepts.set(lc(d.department), d.department); warn('department', `Department "${d.department}" will be created`); }
        else err('department', `Department "${d.department}" does not exist (turn on "Create missing departments/positions" to create it)`);
      }
    }
    if (d.position) {
      const pool = positions.filter((p) => lc(p.title) === lc(d.position));
      const match = d.department ? pool.find((p) => deptId !== null && p.department_id === deptId) || (deptId === null ? undefined : pool.find((p) => p.department_id === null)) : pool[0];
      if (!match) {
        const key = `${lc(d.department)}|${lc(d.position)}`;
        if (opts.create_missing) {
          willPositions.set(key, { title: d.position, department: d.department || null });
          warn('position', `Position "${d.position}" will be created${d.department ? ` in ${d.department}` : ''}`);
        } else {
          const elsewhere = pool.map((p) => all<any>('SELECT name FROM departments WHERE id = ?', [p.department_id])[0]?.name).filter(Boolean);
          err('position', `Position "${d.position}" does not exist${d.department ? ` in ${d.department}` : ''}${elsewhere.length ? ` (it exists in ${elsewhere.join(', ')})` : ''}; turn on "Create missing departments/positions" to create it`);
        }
      }
    }
    if (d.work_location && !locByName.has(lc(d.work_location))) err('work_location', `Work location "${d.work_location}" does not exist`);
    if (d.shift && !shiftByName.has(lc(d.shift))) err('shift', `Shift "${d.shift}" does not exist`);

    // Manager: existing employee or a row of this file (by code or email); never themselves.
    if (d.manager) {
      const m = lc(d.manager);
      const self = m === lc(d.email) || (d.employee_code && m === lc(d.employee_code));
      if (self) err('manager', 'An employee cannot be their own manager');
      else {
        const inFile = (codeRows.get(m) || emailRows.get(m) || []).filter((x) => x !== i);
        const existing = empByCode.get(m) || empByEmail.get(m);
        if (inFile.length === 1) fileManager.set(i, inFile[0]);
        else if (inFile.length > 1) err('manager', `"${d.manager}" matches more than one row in this file`);
        else if (existing) {
          existingManager.set(i, existing.id);
          if (existing.status === 'exited') warn('manager', `Manager "${d.manager}" has exited`);
        } else err('manager', `Manager "${d.manager}" was not found among employees or rows in this file`);
      }
    }

    // Country formats.
    if (cc === 'IN') {
      if (d.tax_id && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(d.tax_id)) err('tax_id', `PAN "${d.tax_id}" is invalid (format ABCDE1234F)`);
      if (d.bank_ifsc && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(d.bank_ifsc)) err('bank_ifsc', `IFSC "${d.bank_ifsc}" is invalid (format ABCD0123456)`);
      if (d.pf_number && !/^\d{12}$/.test(d.pf_number.replace(/\s+/g, ''))) err('pf_number', 'UAN must be 12 digits');
      if (d.bank_account_number && !/^\d{9,18}$/.test(d.bank_account_number.replace(/\s+/g, ''))) warn('bank_account_number', 'Indian bank account numbers are usually 9 to 18 digits');
    } else if (cc === 'US') {
      if (d.tax_id) {
        const digits = d.tax_id.replace(/\D/g, '');
        if (/^\d{3}-?\d{2}-?\d{4}$/.test(d.tax_id) || digits.length === 9) err('tax_id', 'Full SSNs are not accepted: we never store them. Enter it masked as ***-**-1234 (last 4 digits only)');
        else if (!/^\*{3}-\*{2}-\d{4}$/.test(d.tax_id)) err('tax_id', 'SSN must be masked as ***-**-1234');
      }
      if (d.bank_ifsc && !abaValid(d.bank_ifsc)) err('bank_ifsc', `Routing number "${d.bank_ifsc}" is invalid (9 digits with a valid ABA checksum)`);
      if (d.bank_account_number && !/^\d{4,17}$/.test(d.bank_account_number)) warn('bank_account_number', 'US account numbers are usually 4 to 17 digits');
      if (d.pf_number) warn('pf_number', 'UAN applies to India only; it will be ignored');
    } else {
      const iban = d.bank_account_number;
      if (iban) {
        if (iban.slice(0, 2) !== cc) err('bank_account_number', `IBAN must start with ${cc} for this company (got ${iban.slice(0, 2) || 'nothing'})`);
        else if (iban.length !== IBAN_LENGTH[cc]) err('bank_account_number', `${cc} IBANs are ${IBAN_LENGTH[cc]} characters (got ${iban.length})`);
        else if (!ibanValid(iban)) err('bank_account_number', 'IBAN checksum is invalid (mod-97); check for a typo');
      }
      if (d.bank_ifsc && !/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(d.bank_ifsc)) err('bank_ifsc', `SWIFT / BIC "${d.bank_ifsc}" is invalid (8 or 11 characters)`);
      if (d.tax_id) {
        if (cc === 'AE' && !/^784-\d{4}-\d{7}-\d$/.test(d.tax_id)) err('tax_id', 'Emirates ID must look like 784-YYYY-NNNNNNN-N');
        if (cc === 'SA' && !/^[12]\d{9}$/.test(d.tax_id)) err('tax_id', 'Iqama / Saudi ID must be 10 digits starting with 1 or 2');
        if (cc === 'QA' && !/^\d{11}$/.test(d.tax_id)) err('tax_id', 'QID must be 11 digits');
      }
      if (!d.nationality) warn('nationality', 'Nationality is recommended for GCC payroll (WPS, social insurance)');
      if (d.pf_number) warn('pf_number', 'UAN applies to India only; it will be ignored');
    }
    // Salary.
    if (d.basic_monthly) {
      const n = Number(d.basic_monthly.replace(/[,\s]/g, ''));
      if (!Number.isFinite(n) || n <= 0) err('basic_monthly', 'Basic must be a positive number');
      else d.basic_monthly = String(n);
    }
    return { row: i + 2, data: d, errors, warnings };
  });

  // Manager cycles among rows of the file (A → B → A).
  rows.forEach((_r, i) => {
    const seen = new Set<number>([i]);
    let cur = fileManager.get(i);
    while (cur !== undefined) {
      if (seen.has(cur)) {
        if (cur === i) rows[i].errors.push({ field: 'manager', message: 'Manager chain loops back to this employee (cycle)' });
        break;
      }
      seen.add(cur);
      cur = fileManager.get(cur);
    }
  });
  // A row whose manager row has errors cannot be imported either (repeat until stable).
  for (let changed = true; changed;) {
    changed = false;
    rows.forEach((r, i) => {
      const m = fileManager.get(i);
      if (m === undefined || !rows[m].errors.length || r.errors.some((e) => e.field === 'manager')) return;
      r.errors.push({ field: 'manager', message: `Manager is row ${rows[m].row}, which has errors` });
      changed = true;
    });
  }

  const valid = rows.filter((r) => !r.errors.length);
  // Only list departments/positions that a valid row needs.
  const needDepts = new Set(valid.map((r) => lc(r.data.department)).filter(Boolean));
  const needPos = new Set(valid.map((r) => `${lc(r.data.department)}|${lc(r.data.position)}`));
  return {
    rows,
    summary: {
      total: rows.length,
      valid: valid.length,
      with_errors: rows.length - valid.length,
      warnings: rows.filter((r) => r.warnings.length).length,
      will_create: {
        departments: [...willDepts].filter(([k]) => needDepts.has(k)).map(([, v]) => v),
        positions: [...willPositions].filter(([k]) => needPos.has(k)).map(([, v]) => v),
      },
    },
    fileManager, existingManager, deptByName, positions, locByName, shiftByName,
  };
}

const publicPlan = (p: Plan) => ({ rows: p.rows, summary: p.summary });

/* ------------------------------------------------------------------ */
/* Routes: validate and commit                                         */
/* ------------------------------------------------------------------ */
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const flag = (v: any) => v === true || ['1', 'true', 'yes', 'on'].includes(String(v ?? '').toLowerCase());

r.post('/employees/validate', requireHr, (req, res, next) => {
  const ct = String(req.headers['content-type'] || '');
  if (!ct.startsWith('multipart/')) return next();
  upload.single('file')(req, res, (e: any) => {
    if (e) return res.status(400).json({ error: e.code === 'LIMIT_FILE_SIZE' ? 'File is larger than 5 MB' : e.message });
    next();
  });
}, async (req, res) => {
  let parsed: Parsed;
  if (req.file) {
    const name = req.file.originalname.toLowerCase();
    const buf = req.file.buffer;
    const isZip = buf.length > 3 && buf[0] === 0x50 && buf[1] === 0x4b;
    if (name.endsWith('.xlsx') || isZip) {
      let grid: string[][];
      try { grid = await parseXlsx(buf); } catch (e: any) { throw badRequest(e?.status ? e.message : 'Could not read the Excel file; save it as .xlsx or CSV'); }
      parsed = gridToRows(grid, true);
    } else if (name.endsWith('.xls')) {
      throw badRequest('Old .xls files are not supported; save as .xlsx or CSV');
    } else {
      parsed = gridToRows(parseCsv(buf.toString('utf8')), false);
    }
  } else if (req.body?.token || req.body?.rows) {
    // Re-validate a previous upload (e.g. after toggling "Create missing departments/positions").
    const stored = req.body.token ? loadRows(req.body.token) : undefined;
    if (stored) parsed = { rows: stored.rows, unknown_columns: stored.unknown_columns, columns: [] };
    else if (req.body.rows) parsed = { rows: cleanRows(req.body.rows), unknown_columns: [], columns: [] };
    else throw badRequest('This upload has expired; upload the file again');
  } else throw badRequest('Upload a CSV or XLSX file in the "file" field');

  if (!parsed.rows.length) throw badRequest('The file has a header row but no employees');
  const plan = validateRows(parsed.rows, { create_missing: flag(req.body?.create_missing) });
  const token = storeRows(parsed.rows, parsed.unknown_columns);
  const file_warnings = parsed.unknown_columns.length ? [`Unknown columns ignored: ${parsed.unknown_columns.join(', ')}`] : [];
  for (const k of ['first_name', 'email', 'join_date']) if (parsed.columns.length && !parsed.columns.includes(k)) file_warnings.push(`Required column "${k}" is missing`);
  res.json({ ...publicPlan(plan), token, unknown_columns: parsed.unknown_columns, file_warnings, country_code: companyCountry() });
});

r.post('/employees/commit', requireHr, (req, res) => {
  const body = req.body || {};
  const create_missing = flag(body.create_missing);
  const skip_invalid = flag(body.skip_invalid);
  const send_logins = body.send_logins === undefined ? true : flag(body.send_logins);
  let input: RawRow[];
  const stored = body.token ? loadRows(body.token) : undefined;
  if (stored) input = stored.rows;
  else if (body.rows) input = cleanRows(body.rows); // another serverless instance validated the upload
  else throw badRequest(body.token ? 'This upload has expired; upload the file again' : 'token or rows is required');
  if (!input.length) throw badRequest('Nothing to import');

  const plan = validateRows(input, { create_missing });
  if (plan.summary.with_errors && !skip_invalid) {
    return res.status(400).json({ error: `${plan.summary.with_errors} row(s) have errors; fix them or choose "Skip rows with errors"`, ...publicPlan(plan) });
  }
  const todo = plan.rows.map((r, i) => ({ r, i })).filter(({ r }) => !r.errors.length);
  if (!todo.length) throw badRequest('No valid rows to import');

  // Managers first: order rows so that a file manager is created before their reports.
  const order: number[] = [];
  const placed = new Set<number>();
  const valid = new Set(todo.map((t) => t.i));
  const visit = (i: number) => {
    if (placed.has(i)) return;
    placed.add(i);
    const m = plan.fileManager.get(i);
    if (m !== undefined && valid.has(m)) visit(m);
    order.push(i);
  };
  todo.forEach(({ i }) => visit(i));

  const currency = companyCurrency();
  const cc = companyCountry();
  const reserved = new Set(todo.map(({ r }) => lc(r.data.employee_code)).filter(Boolean));
  const managerRows = new Set(plan.fileManager.values());
  const created: any[] = [];
  const createdDepts: string[] = [];
  const createdPositions: string[] = [];

  transaction(() => {
    const now = nowIso();
    const deptIds = new Map(plan.deptByName);
    const positions = [...plan.positions];
    const deptFor = (name: string | undefined): number | null => {
      if (!name) return null;
      let id = deptIds.get(lc(name));
      if (id === undefined) {
        id = insert('departments', { name: name.trim(), parent_id: null, color: '#64748b', sort_order: 0, active: 1, created_at: now });
        deptIds.set(lc(name), id);
        createdDepts.push(name.trim());
      }
      return id;
    };
    const positionFor = (title: string | undefined, deptName: string | undefined, deptId: number | null): number | null => {
      if (!title) return null;
      const pool = positions.filter((p) => lc(p.title) === lc(title));
      let match = deptName ? pool.find((p) => p.department_id === deptId) || pool.find((p) => p.department_id === null) : pool[0];
      if (!match) {
        const id = insert('positions', { title: title.trim(), department_id: deptId, level: 1, headcount: 1, active: 1, created_at: now });
        match = { id, title: title.trim(), department_id: deptId };
        positions.push(match);
        createdPositions.push(deptName ? `${title.trim()} (${deptName.trim()})` : title.trim());
      }
      return match.id;
    };
    const nextCode = () => {
      let code = nextEmployeeCode();
      const m = code.match(/^(.*?)(\d+)$/);
      while (reserved.has(lc(code)) && m) {
        const n = Number(code.slice(m[1].length)) + 1;
        code = `${m[1]}${String(n).padStart(m[2].length, '0')}`;
      }
      return code;
    };

    const idOf = new Map<number, number>();
    for (const i of order) {
      const d = plan.rows[i].data;
      const deptId = deptFor(d.department);
      const managerRow = plan.fileManager.get(i);
      const body: any = {
        employee_code: d.employee_code || nextCode(),
        first_name: d.first_name, last_name: d.last_name || '', email: d.email, phone: d.phone || null,
        gender: d.gender || null, dob: d.dob || null, join_date: d.join_date,
        employment_type: d.employment_type || 'full_time', status: d.status || 'active',
        department_id: deptId, position_id: positionFor(d.position, d.department, deptId),
        manager_id: managerRow !== undefined ? idOf.get(managerRow) ?? null : plan.existingManager.get(i) ?? null,
        work_location_id: d.work_location ? plan.locByName.get(lc(d.work_location)) ?? null : null,
        shift_id: d.shift ? plan.shiftByName.get(lc(d.shift)) ?? null : null,
        city: d.city || null, country: d.country || null, nationality: d.nationality || null,
        bank_name: d.bank_name || null, bank_account_name: d.bank_account_name || null, bank_account_number: d.bank_account_number || null,
        bank_ifsc: d.bank_ifsc || null, tax_id: d.tax_id || null,
        pf_number: cc === 'IN' && d.pf_number ? d.pf_number.replace(/\s+/g, '') : null,
        custom_fields: cc === 'IN' && d.pf_number ? { uan: d.pf_number.replace(/\s+/g, '') } : {},
      };
      const login = send_logins && !no(d.create_login);
      // People who manage other rows of the file get a manager login.
      const out = createEmployeeRecord(body, { create_login: login, login_role: managerRows.has(i) ? 'manager' : 'employee' });
      idOf.set(i, out.id);
      if (d.basic_monthly) {
        const basic = Number(d.basic_monthly);
        insert('salary_structures', {
          employee_id: out.id, effective_from: d.join_date, currency, basic, components: [], ctc_annual: null,
          notes: 'Opening structure from bulk import (company default components)', created_by: req.user!.id, created_at: now,
        });
      }
      created.push({ row: plan.rows[i].row, id: out.id, employee_code: out.employee_code, name: `${d.first_name} ${d.last_name || ''}`.trim(), email: d.email, ...(out.temporary_password ? { temporary_password: out.temporary_password } : {}) });
    }
  });

  created.sort((a, b) => a.row - b.row);
  const skipped = plan.rows.filter((r) => r.errors.length).map((r) => ({ row: r.row, name: `${r.data.first_name || ''} ${r.data.last_name || ''}`.trim(), email: r.data.email || '', errors: r.errors }));
  if (body.token) uploads.delete(storeKey(String(body.token)));
  audit(req, 'import', 'employee', null, { created: created.length, skipped: skipped.length, logins: created.filter((c) => c.temporary_password).length, departments_created: createdDepts.length, positions_created: createdPositions.length });
  res.status(201).json({ created, skipped, departments_created: createdDepts, positions_created: createdPositions });
});
