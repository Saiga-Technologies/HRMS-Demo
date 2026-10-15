/**
 * Payroll output files: what an agency uploads or files every month from a processed / approved /
 * paid payroll run.
 *
 *   all markets  register      payroll register workbook (.xlsx, built by hand with jszip)
 *   India        bank_transfer bulk NEFT / RTGS salary upload (.csv)
 *                pf_ecr        EPFO ECR 2.0 text file (#~# separated)
 *                esi           ESIC monthly contribution upload (.xlsx)
 *   UAE          wps_sif       WPS Salary Information File (EDR lines + SCR control record)
 *   KSA          mudad_wps     Mudad salary upload (.csv)
 *   Qatar        qatar_wps     Qatar WPS SIF (.csv: header record + one record per employee)
 *   US           nacha_ach     NACHA ACH PPD credit file (94-character fixed-width records)
 *
 * Money is handled in integer minor units: every payslip amount is converted ONCE (net × 100, rounded)
 * and every total is a sum of those integers, so a file's control totals always equal its lines.
 * Formats follow the published layouts in simplified form — confirm with the bank / authority before
 * using a file for a real payment or filing.
 */
import JSZip from 'jszip';
import { all, get, getSetting, parseJsonAll, currentCompanySlug } from '../db.js';
import { badRequest, notFound, tzOffsetMinutes } from '../util.js';
import { DEFAULT_COMPANY, DEFAULT_PAYROLL_SETTINGS } from '../routes/settings.js';
import { demoCompany } from '../seed/registry.js';
import { payDate } from './payrollCalendar.js';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */
export type Country = 'IN' | 'AE' | 'SA' | 'QA' | 'US';
export type FileKind = 'register' | 'bank_transfer' | 'pf_ecr' | 'esi' | 'wps_sif' | 'mudad_wps' | 'qatar_wps' | 'nacha_ach';
export type FileCategory = 'register' | 'statutory' | 'bank';

interface PayLine { code: string; name: string; amount: number; adjustment_id?: number }
export interface Slip {
  id: number;
  employee_id: number;
  employee_code: string;
  employee_name: string;
  department_name: string | null;
  designation: string | null;
  working_days: number;
  paid_days: number;
  lop_days: number;
  basic: number;
  earnings: PayLine[];
  deductions: PayLine[];
  gross: number;
  total_deductions: number;
  net: number;
  currency: string | null;
  bank_name: string | null;
  bank_account_name: string | null;
  bank_account_number: string | null;
  bank_ifsc: string | null;
  tax_id: string | null;
  pf_number: string | null;
  nationality: string | null;
  exit_date: string | null;
  custom_fields: Record<string, any>;
}
export interface Excluded { employee_id: number; employee_code: string; name: string; reason: string }
export interface Built { filename: string; contentType: string; body: Buffer; records: number; total_minor?: number }
interface Prepared { records: number; excluded: Excluded[]; notes: string[]; build: () => Promise<Built> | Built }

export interface RunCtx {
  run: { id: number; period: string; status: string };
  country: Country;
  currency: string;
  company: any;
  payroll: any;
  files: FileSettings;
  placeholders: string[];
  slug: string;
  code: string;          // company code used in file names
  demo: boolean;         // demo company: identifiers the demo data lacks get labelled placeholders
  slips: Slip[];
  period: string;
  start: string;
  end: string;
  days: number;          // calendar days in the period
  payDate: string;
  now: { date: string; hhmm: string; hhmmss: string };
}

interface FileDef {
  kind: FileKind;
  name: string;
  description: string;
  portal: string;
  format: string;
  category: FileCategory;
  countries: Country[] | 'all';
  prepare: (ctx: RunCtx) => Prepared;
}

/* ------------------------------------------------------------------ */
/* Money & text helpers                                                */
/* ------------------------------------------------------------------ */
/** Amount → integer minor units (paise / fils / halalas / dirhams / cents). Rounded once. */
export const toMinor = (n: any) => Math.round(Number((Number(n || 0) * 100).toFixed(4)));
/** Minor units → "1234.50". */
export function fmtMinor(m: number): string {
  const sign = m < 0 ? '-' : '';
  const a = Math.abs(Math.trunc(m));
  return `${sign}${Math.floor(a / 100)}.${String(a % 100).padStart(2, '0')}`;
}
const sumMinor = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (period: string) => `${MONTHS[Number(period.slice(5, 7)) - 1]} ${period.slice(0, 4)}`;
const digits = (v: any) => String(v ?? '').replace(/\D/g, '');
const clean = (v: any) => String(v ?? '').replace(/[\r\n\t]+/g, ' ').trim();
function csvCell(v: any): string {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const csvLine = (cells: any[]) => cells.map(csvCell).join(',');
/** ASCII-only, upper-case, for fixed-width bank formats. */
const ascii = (v: any) => String(v ?? '').normalize('NFKD').replace(/[^\x20-\x7E]/g, '').toUpperCase();
const padR = (v: any, n: number) => ascii(v).slice(0, n).padEnd(n, ' ');
const padL = (v: any, n: number, ch = '0') => String(v ?? '').slice(-n).padStart(n, ch);

/** Deterministic digits from a seed (demo placeholders: the same on every instance). */
export function hashDigits(seed: string, n: number): string {
  let out = '';
  for (let i = 0; out.length < n; i++) {
    let h = 2166136261;
    for (const ch of `${seed}:${i}`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
    out += String(h % 1000000).padStart(6, '0');
  }
  return out.slice(0, n);
}

export const isIban = (v: string, cc?: string) => {
  const s = String(v || '').replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false;
  if (cc && !s.startsWith(cc)) return false;
  const lengths: Record<string, number> = { AE: 23, SA: 24, QA: 29 };
  if (lengths[s.slice(0, 2)] && s.length !== lengths[s.slice(0, 2)]) return false;
  const numeric = (s.slice(4) + s.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rem = 0;
  for (const ch of numeric) rem = (rem * 10 + Number(ch)) % 97;
  return rem === 1;
};
export const isIfsc = (v: string) => /^[A-Z]{4}0[A-Z0-9]{6}$/.test(String(v || '').toUpperCase());
/** ABA routing number check digit (3-7-1 weights). */
export function isAbaRouting(v: string): boolean {
  const s = String(v || '');
  if (!/^\d{9}$/.test(s)) return false;
  const d = s.split('').map(Number);
  return (3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + (d[2] + d[5] + d[8])) % 10 === 0;
}

/* ------------------------------------------------------------------ */
/* File settings (employer ids, routing codes)                         */
/* ------------------------------------------------------------------ */
export interface FileSettings {
  in_pf_establishment_code: string;
  in_esi_employer_code: string;
  ae_employer_mol_id: string;
  ae_employer_routing_code: string;
  ae_employer_reference: string;
  sa_mudad_establishment_id: string;
  sa_payer_iban: string;
  qa_employer_eid: string;
  qa_payer_bank: string;
  qa_payer_iban: string;
  us_odfi_routing: string;
  us_odfi_name: string;
  us_ach_immediate_origin: string;
  us_ach_company_id: string;
  us_ach_company_name: string;
}
export interface FileSettingField { key: keyof FileSettings; label: string; hint: string; pattern?: RegExp; patternHint?: string }
export const FILE_SETTING_FIELDS: Record<Country, FileSettingField[]> = {
  IN: [
    { key: 'in_pf_establishment_code', label: 'PF establishment code', hint: 'EPFO establishment id (e.g. KRKCH0012345000), shown on the ECR upload.', pattern: /^[A-Z]{5}\d{7,10}$/, patternHint: '5 letters followed by 7–10 digits' },
    { key: 'in_esi_employer_code', label: 'ESI employer code', hint: '17-digit ESIC employer code.', pattern: /^\d{17}$/, patternHint: '17 digits' },
  ],
  AE: [
    { key: 'ae_employer_mol_id', label: 'Employer MOL establishment id', hint: '13-digit MOHRE establishment id (SCR record).', pattern: /^\d{13}$/, patternHint: '13 digits' },
    { key: 'ae_employer_routing_code', label: 'Employer bank routing code', hint: '9-digit routing code of the bank / exchange house that pays the salaries.', pattern: /^\d{9}$/, patternHint: '9 digits' },
    { key: 'ae_employer_reference', label: 'Employer reference', hint: 'Free text on the SCR record (up to 16 characters).', pattern: /^[A-Za-z0-9 _-]{0,16}$/, patternHint: 'up to 16 letters / digits' },
  ],
  SA: [
    { key: 'sa_mudad_establishment_id', label: 'Mudad establishment id', hint: 'MOL / Qiwa establishment number used on Mudad.', pattern: /^[\d-]{5,20}$/, patternHint: 'digits' },
    { key: 'sa_payer_iban', label: 'Payer IBAN', hint: 'Company account the salaries are paid from.' },
  ],
  QA: [
    { key: 'qa_employer_eid', label: 'Employer establishment id (EID)', hint: 'Ministry of Labour establishment id on the SIF header.', pattern: /^\d{4,12}$/, patternHint: '4–12 digits' },
    { key: 'qa_payer_bank', label: 'Payer bank short name', hint: 'Four-letter short name of the paying bank, e.g. QNBA.', pattern: /^[A-Z]{4}$/, patternHint: '4 capital letters' },
    { key: 'qa_payer_iban', label: 'Payer IBAN', hint: 'Company account the salaries are paid from (QA…, 29 characters).' },
  ],
  US: [
    { key: 'us_odfi_routing', label: 'ODFI routing number', hint: 'ABA routing number of the company’s bank (immediate destination).' },
    { key: 'us_odfi_name', label: 'ODFI bank name', hint: 'Immediate destination name (up to 23 characters).' },
    { key: 'us_ach_immediate_origin', label: 'ACH immediate origin', hint: '10 characters, usually 1 + the company EIN.', pattern: /^[0-9 ]\d{9}$/, patternHint: '10 digits (or a space + 9 digits)' },
    { key: 'us_ach_company_id', label: 'ACH company id', hint: '10 characters, usually 1 + the company EIN.', pattern: /^[0-9A-Z]\d{9}$/, patternHint: '10 characters' },
    { key: 'us_ach_company_name', label: 'ACH company name', hint: 'Shown on employees’ bank statements (up to 16 characters).' },
  ],
};
const ALL_FILE_KEYS = Object.values(FILE_SETTING_FIELDS).flat().map((f) => f.key);

export function companyCountry(company = getSetting<any>('company', DEFAULT_COMPANY)): Country {
  const cc = String(company?.country_code || 'IN').toUpperCase();
  return (['IN', 'AE', 'SA', 'QA', 'US'].includes(cc) ? cc : 'IN') as Country;
}

/** Demo placeholders, derived from the company slug (identical on every serverless instance). */
export function fileSettingsDefaults(): FileSettings {
  const slug = currentCompanySlug();
  const company = getSetting<any>('company', DEFAULT_COMPANY);
  const h = (k: string, n: number) => hashDigits(`${slug}:${k}`, n);
  const ein = digits(demoCompany(slug)?.client_tax_id).padStart(9, '0').slice(-9) || h('ein', 9);
  const ibanFor = (cc: string, bban: string) => {
    const numeric = (bban + cc + '00').replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
    let rem = 0;
    for (const ch of numeric) rem = (rem * 10 + Number(ch)) % 97;
    return `${cc}${String(98 - rem).padStart(2, '0')}${bban}`;
  };
  return {
    in_pf_establishment_code: `KRKCH${h('pf', 7)}000`,
    in_esi_employer_code: h('esi', 17),
    ae_employer_mol_id: `1${h('mol', 12)}`,
    ae_employer_routing_code: `80${h('aerouting', 7)}`,
    ae_employer_reference: slug.replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 16),
    sa_mudad_establishment_id: `7-${h('mudad', 7)}`,
    sa_payer_iban: ibanFor('SA', `10${h('saiban', 18)}`),
    qa_employer_eid: h('qaeid', 8),
    qa_payer_bank: 'QNBA',
    qa_payer_iban: ibanFor('QA', `QNBA${h('qaiban', 21)}`),
    us_odfi_routing: '021000021',
    us_odfi_name: 'JPMORGAN CHASE BANK',
    us_ach_immediate_origin: `1${ein}`,
    us_ach_company_id: `1${ein}`,
    us_ach_company_name: ascii(company?.name || slug).slice(0, 16),
  };
}

/** Employer ids: company settings (same key) override the placeholders; the payroll_files setting overrides both. */
export function fileSettings(): { values: FileSettings; placeholders: string[] } {
  const defaults = fileSettingsDefaults();
  const company = getSetting<any>('company', DEFAULT_COMPANY) || {};
  const saved = getSetting<any>('payroll_files', {}) || {};
  const values: any = { ...defaults };
  const placeholders: string[] = [];
  for (const k of ALL_FILE_KEYS) {
    const v = [saved[k], company[k]].find((x) => x != null && String(x).trim() !== '');
    if (v != null) values[k] = String(v).trim();
    else placeholders.push(k);
  }
  return { values, placeholders };
}

/** Validate a PUT body for the payroll_files setting. Empty strings clear a value (back to the placeholder). */
export function validateFileSettings(body: any): Partial<FileSettings> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw badRequest('An object of file settings is expected');
  const out: any = {};
  const fields = Object.values(FILE_SETTING_FIELDS).flat();
  for (const [k, raw] of Object.entries(body)) {
    const f = fields.find((x) => x.key === k);
    if (!f) throw badRequest(`Unknown file setting: ${k}`);
    if (raw != null && typeof raw !== 'string' && typeof raw !== 'number') throw badRequest(`${f.label} must be text`);
    const v = raw == null ? '' : String(raw).trim();
    if (v.length > 40) throw badRequest(`${f.label} is too long`);
    if (v) {
      if (f.pattern && !f.pattern.test(v)) throw badRequest(`${f.label} must be ${f.patternHint}`);
      if (k === 'us_odfi_routing' && !isAbaRouting(v)) throw badRequest('ODFI routing number must be 9 digits with a valid check digit');
      if ((k === 'sa_payer_iban' && !isIban(v, 'SA')) || (k === 'qa_payer_iban' && !isIban(v, 'QA'))) throw badRequest(`${f.label} is not a valid IBAN`);
    }
    out[k] = v;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Run context                                                         */
/* ------------------------------------------------------------------ */
export const EXPORTABLE = ['processed', 'approved', 'paid'];

function companyNow() {
  const iso = new Date(Date.now() + tzOffsetMinutes() * 60000).toISOString();
  return { date: iso.slice(0, 10), hhmm: iso.slice(11, 13) + iso.slice(14, 16), hhmmss: iso.slice(11, 13) + iso.slice(14, 16) + iso.slice(17, 19) };
}

export function loadRun(runId: number): RunCtx {
  const run = get<any>('SELECT id, period, status FROM payroll_runs WHERE id = ?', [runId]);
  if (!run) throw notFound('Payroll run not found');
  if (!EXPORTABLE.includes(run.status)) throw badRequest(`This run is ${run.status}. Output files are available once the run is processed.`);
  const company = getSetting<any>('company', DEFAULT_COMPANY);
  const payroll = { ...DEFAULT_PAYROLL_SETTINGS, ...getSetting<any>('payroll', DEFAULT_PAYROLL_SETTINGS) };
  const slips = parseJsonAll(all<any>(
    `SELECT p.id, p.employee_id, p.working_days, p.paid_days, p.lop_days, p.basic, p.earnings, p.deductions, p.gross, p.total_deductions, p.net, p.currency,
            e.employee_code, e.first_name || ' ' || e.last_name AS employee_name, e.bank_name, e.bank_account_name, e.bank_account_number, e.bank_ifsc,
            e.tax_id, e.pf_number, e.nationality, e.exit_date, e.custom_fields, d.name AS department_name, po.title AS designation
     FROM payslips p JOIN employees e ON e.id = p.employee_id LEFT JOIN departments d ON d.id = e.department_id LEFT JOIN positions po ON po.id = e.position_id
     WHERE p.run_id = ? ORDER BY e.employee_code`, [runId]), ['earnings', 'deductions', 'custom_fields']) as Slip[];
  for (const s of slips) {
    s.earnings = Array.isArray(s.earnings) ? s.earnings : [];
    s.deductions = Array.isArray(s.deductions) ? s.deductions : [];
    s.custom_fields = s.custom_fields && typeof s.custom_fields === 'object' ? s.custom_fields : {};
  }
  const [y, m] = run.period.split('-').map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const slug = currentCompanySlug();
  const fs = fileSettings();
  return {
    run, company, payroll, slips, slug,
    country: companyCountry(company),
    currency: payroll.currency || company.currency || 'INR',
    files: fs.values,
    placeholders: fs.placeholders,
    code: slug.toUpperCase(),
    demo: !!demoCompany(slug) || slug === 'acme',
    period: run.period,
    start: `${run.period}-01`,
    end: `${run.period}-${String(days).padStart(2, '0')}`,
    days,
    payDate: payDate(run.period, payroll),
    now: companyNow(),
  };
}

/* ------------------------------------------------------------------ */
/* Employee helpers                                                    */
/* ------------------------------------------------------------------ */
const ex = (s: Slip, reason: string): Excluded => ({ employee_id: s.employee_id, employee_code: s.employee_code, name: s.employee_name, reason });
const cf = (s: Slip, ...keys: string[]) => {
  for (const k of keys) { const v = s.custom_fields?.[k]; if (v != null && String(v).trim() !== '') return String(v).trim(); }
  return '';
};
const iban = (s: Slip) => String(s.bank_account_number || '').replace(/\s+/g, '').toUpperCase();
const swift = (s: Slip) => String(s.bank_ifsc || '').replace(/\s+/g, '').toUpperCase();
const lineAmount = (lines: PayLine[], code: string) => sumMinor(lines.filter((l) => l.code === code).map((l) => toMinor(l.amount)));
/** Variable pay = one-off adjustment earnings (bonus, overtime, arrears, reimbursement). */
const variableMinor = (s: Slip) => sumMinor(s.earnings.filter((l) => l.adjustment_id != null || ['BONUS', 'OVERTIME', 'ARREARS', 'REIMBURSEMENT'].includes(l.code)).map((l) => toMinor(l.amount)));

/** Payment files leave out people with nothing to pay. */
function payable(slips: Slip[], excluded: Excluded[]) {
  return slips.filter((s) => {
    if (toMinor(s.net) <= 0) { excluded.push(ex(s, 'net pay is zero or negative')); return false; }
    return true;
  });
}

function placeholderNote(ctx: RunCtx, keys: (keyof FileSettings)[]) {
  const missing = keys.filter((k) => ctx.placeholders.includes(k));
  if (!missing.length) return [];
  const labels = Object.values(FILE_SETTING_FIELDS).flat().filter((f) => missing.includes(f.key)).map((f) => f.label);
  return [`Demo placeholder used for: ${labels.join(', ')}. Set the real values in Payroll → Settings → File settings.`];
}

/* ------------------------------------------------------------------ */
/* XLSX (SpreadsheetML) writer                                         */
/* ------------------------------------------------------------------ */
export type XCell = string | number | null | undefined;
export interface XCol { header: string; width?: number; money?: boolean }
export interface XSheet { name: string; cols: XCol[]; rows: XCell[][]; totals?: XCell[] }

const xmlEsc = (s: string) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export function colLetter(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
// Style ids: 0 normal · 1 header (bold, grey fill, bottom border) · 2 money · 3 bold money · 4 bold text
const STYLES = `${XML_HEAD}<styleSheet xmlns="${NS_MAIN}"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts>`
  + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts>'
  + '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE5E7EB"/><bgColor indexed="64"/></patternFill></fill></fills>'
  + '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color auto="1"/></bottom><diagonal/></border></borders>'
  + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
  + '<cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
  + '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>'
  + '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
  + '<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>'
  + '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>'
  + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

function cellXml(ref: string, v: XCell, style: number): string {
  if (v == null || v === '') return style ? `<c r="${ref}" s="${style}"/>` : '';
  const s = style ? ` s="${style}"` : '';
  if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${s}><v>${v}</v></c>`;
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xmlEsc(String(v))}</t></is></c>`;
}
function sheetXml(sh: XSheet): string {
  const rows: string[] = [];
  const nCols = sh.cols.length;
  rows.push(`<row r="1">${sh.cols.map((c, i) => cellXml(`${colLetter(i)}1`, c.header, 1)).join('')}</row>`);
  sh.rows.forEach((r, ri) => {
    const rn = ri + 2;
    rows.push(`<row r="${rn}">${r.map((v, i) => cellXml(`${colLetter(i)}${rn}`, v, sh.cols[i]?.money && typeof v === 'number' ? 2 : 0)).join('')}</row>`);
  });
  if (sh.totals) {
    const rn = sh.rows.length + 2;
    rows.push(`<row r="${rn}">${sh.totals.map((v, i) => cellXml(`${colLetter(i)}${rn}`, v, typeof v === 'number' ? 3 : 4)).join('')}</row>`);
  }
  const lastRow = sh.rows.length + 1 + (sh.totals ? 1 : 0);
  const cols = sh.cols.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width || Math.max(10, Math.min(40, c.header.length + 2))}" customWidth="1"/>`).join('');
  return `${XML_HEAD}<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_REL}"><dimension ref="A1:${colLetter(Math.max(0, nCols - 1))}${lastRow}"/>`
    + '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>'
    + `<sheetFormatPr defaultRowHeight="15"/><cols>${cols}</cols><sheetData>${rows.join('')}</sheetData></worksheet>`;
}
const sheetName = (n: string, i: number) => (n.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31).trim() || `Sheet${i + 1}`);

/** Build a minimal, valid .xlsx workbook (one or more sheets, header row frozen). */
export async function buildXlsx(sheets: XSheet[]): Promise<Buffer> {
  const zip = new JSZip();
  const ct = 'application/vnd.openxmlformats-officedocument.spreadsheetml';
  zip.file('[Content_Types].xml', `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
    + `<Override PartName="/xl/workbook.xml" ContentType="${ct}.sheet.main+xml"/>`
    + sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="${ct}.worksheet+xml"/>`).join('')
    + `<Override PartName="/xl/styles.xml" ContentType="${ct}.styles+xml"/></Types>`);
  zip.file('_rels/.rels', `${XML_HEAD}<Relationships xmlns="${NS_PKG_REL}"><Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  zip.file('xl/workbook.xml', `${XML_HEAD}<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}"><bookViews><workbookView/></bookViews><sheets>`
    + sheets.map((s, i) => `<sheet name="${xmlEsc(sheetName(s.name, i))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + '</sheets></workbook>');
  zip.file('xl/_rels/workbook.xml.rels', `${XML_HEAD}<Relationships xmlns="${NS_PKG_REL}">`
    + sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${NS_REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
    + `<Relationship Id="rId${sheets.length + 1}" Type="${NS_REL}/styles" Target="styles.xml"/></Relationships>`);
  zip.file('xl/styles.xml', STYLES);
  sheets.forEach((s, i) => zip.file(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)));
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', mimeType: `${ct}.sheet` });
}
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/* ------------------------------------------------------------------ */
/* Register                                                            */
/* ------------------------------------------------------------------ */
function prepareRegister(ctx: RunCtx): Prepared {
  return {
    records: ctx.slips.length,
    excluded: [],
    notes: [],
    build: async () => {
      // Union of components across payslips, in first-seen order (earnings, then deductions).
      const union = (key: 'earnings' | 'deductions') => {
        const map = new Map<string, string>();
        for (const s of ctx.slips) for (const l of s[key]) if (!map.has(l.code)) map.set(l.code, l.name);
        return [...map.entries()].map(([code, name]) => ({ code, name }));
      };
      const earn = union('earnings');
      const ded = union('deductions');
      const money = (header: string, width = 14): XCol => ({ header, width, money: true });
      const cols: XCol[] = [
        { header: 'Code', width: 12 }, { header: 'Name', width: 26 }, { header: 'Department', width: 20 }, { header: 'Designation', width: 26 },
        { header: 'Paid days', width: 10 }, { header: 'LOP days', width: 10 },
        ...earn.map((c) => money(`${c.name} (${c.code})`)), money('Gross'),
        ...ded.map((c) => money(`${c.name} (${c.code})`)), money('Total deductions', 16), money('Net pay'),
        { header: 'Bank', width: 22 }, { header: 'Account name', width: 24 }, { header: ctx.country === 'IN' || ctx.country === 'US' ? 'Account number' : 'IBAN', width: 30 },
        { header: ctx.country === 'IN' ? 'IFSC' : ctx.country === 'US' ? 'Routing number' : 'SWIFT', width: 14 },
      ];
      // Every money cell is an integer number of minor units; totals are integer sums, divided once.
      const moneyIdx: number[] = [];
      const rowsMinor: (string | number | null)[][] = ctx.slips.map((s) => {
        const em = earn.map((c) => lineAmount(s.earnings, c.code));
        const dm = ded.map((c) => lineAmount(s.deductions, c.code));
        return [s.employee_code, s.employee_name, s.department_name || '', s.designation || '', Number(s.paid_days), Number(s.lop_days),
          ...em, toMinor(s.gross), ...dm, toMinor(s.total_deductions), toMinor(s.net),
          s.bank_name || '', s.bank_account_name || '', s.bank_account_number || '', s.bank_ifsc || ''];
      });
      cols.forEach((c, i) => { if (c.money) moneyIdx.push(i); });
      const totalsMinor = cols.map((_, i) => (moneyIdx.includes(i) ? sumMinor(rowsMinor.map((r) => Number(r[i]) || 0)) : null));
      const rows = rowsMinor.map((r) => r.map((v, i) => (moneyIdx.includes(i) ? (v == null ? null : Number(v) / 100) : v)));
      const totals: XCell[] = totalsMinor.map((v, i) => (i === 0 ? 'TOTAL' : i === 1 ? `${ctx.slips.length} employees` : v == null ? null : v / 100));

      const compRows: XCell[][] = [];
      for (const [type, list, key] of [['Earning', earn, 'earnings'], ['Deduction', ded, 'deductions']] as const) {
        for (const c of list) {
          const amounts = ctx.slips.map((s) => lineAmount(s[key], c.code));
          compRows.push([type, c.code, c.name, amounts.filter((a) => a !== 0).length, sumMinor(amounts) / 100]);
        }
      }
      const gross = sumMinor(ctx.slips.map((s) => toMinor(s.gross)));
      const dedT = sumMinor(ctx.slips.map((s) => toMinor(s.total_deductions)));
      const net = sumMinor(ctx.slips.map((s) => toMinor(s.net)));
      compRows.push([], ['Total', 'GROSS', 'Gross pay', ctx.slips.length, gross / 100], ['Total', 'DED', 'Total deductions', ctx.slips.length, dedT / 100], ['Total', 'NET', 'Net pay', ctx.slips.length, net / 100]);
      const body = await buildXlsx([
        { name: `Register ${ctx.period}`, cols, rows, totals },
        { name: 'Component totals', cols: [{ header: 'Type', width: 12 }, { header: 'Code', width: 14 }, { header: 'Component', width: 30 }, { header: 'Employees', width: 12 }, { header: 'Amount', width: 18, money: true }], rows: compRows },
      ]);
      return { filename: `${ctx.code}_Payroll_Register_${ctx.period}.xlsx`, contentType: XLSX_TYPE, body, records: ctx.slips.length, total_minor: net };
    },
  };
}

/* ------------------------------------------------------------------ */
/* India                                                               */
/* ------------------------------------------------------------------ */
export const RTGS_THRESHOLD_MINOR = 200000_00; // ₹2,00,000 and above go by RTGS

function prepareIndiaBank(ctx: RunCtx): Prepared {
  const excluded: Excluded[] = [];
  const rows = payable(ctx.slips, excluded).filter((s) => {
    if (!digits(s.bank_account_number) || digits(s.bank_account_number).length < 6) { excluded.push(ex(s, 'no bank account number')); return false; }
    if (!isIfsc(s.bank_ifsc || '')) { excluded.push(ex(s, s.bank_ifsc ? 'invalid IFSC code' : 'no IFSC code')); return false; }
    return true;
  });
  return {
    records: rows.length, excluded, notes: [],
    build: () => {
      const narration = `Salary ${monthLabel(ctx.period)}`;
      const lines = [csvLine(['Payment Type', 'Beneficiary Name', 'Beneficiary Account Number', 'IFSC', 'Amount', 'Narration', 'Employee Code', 'Beneficiary Bank'])];
      const amounts: number[] = [];
      for (const s of rows) {
        const m = toMinor(s.net);
        amounts.push(m);
        lines.push(csvLine([m >= RTGS_THRESHOLD_MINOR ? 'RTGS' : 'NEFT', clean(s.bank_account_name || s.employee_name), digits(s.bank_account_number), String(s.bank_ifsc).toUpperCase(), fmtMinor(m), narration, s.employee_code, clean(s.bank_name)]));
      }
      return { filename: `${ctx.code}_Bank_Transfer_${ctx.period}.csv`, contentType: 'text/csv; charset=utf-8', body: Buffer.from(lines.join('\r\n') + '\r\n'), records: rows.length, total_minor: sumMinor(amounts) };
    },
  };
}

export const EPS_WAGE_CEILING = 15000;
export const EPS_PERCENT = 8.33;

function prepareEcr(ctx: RunCtx): Prepared {
  const excluded: Excluded[] = [];
  const rows = ctx.slips.filter((s) => {
    const uan = digits(cf(s, 'uan') || s.pf_number);
    if (!uan) { excluded.push(ex(s, 'no UAN on file')); return false; }
    if (uan.length !== 12) { excluded.push(ex(s, 'UAN is not 12 digits')); return false; }
    return true;
  });
  return {
    records: rows.length, excluded, notes: placeholderNote(ctx, ['in_pf_establishment_code']),
    build: () => {
      const p = ctx.payroll;
      const ceiling = Number(p.pf_wage_ceiling) > 0 ? Number(p.pf_wage_ceiling) : Infinity;
      const eePct = Number(p.pf_employee_percent ?? 12);
      const erPct = Number(p.pf_employer_percent ?? 12);
      const lines = rows.map((s) => {
        const uan = digits(cf(s, 'uan') || s.pf_number);
        const basic = Number(s.basic) || 0;
        const gross = Math.round(Number(s.gross) || 0);
        const epfWages = Math.round(Math.min(basic, ceiling));
        const epsWages = Math.round(Math.min(basic, EPS_WAGE_CEILING, ceiling));
        const edliWages = epsWages;
        const epfEe = Math.round((epfWages * eePct) / 100);
        const eps = Math.round((epsWages * EPS_PERCENT) / 100);
        const diff = Math.max(0, Math.round((epfWages * erPct) / 100) - eps);
        const ncp = Math.round(Number(s.lop_days) || 0);
        const name = clean(s.employee_name).replace(/#~#/g, ' ').toUpperCase();
        return [uan, name, gross, epfWages, epsWages, edliWages, epfEe, eps, diff, ncp, 0].join('#~#');
      });
      return { filename: `${ctx.code}_PF_ECR_${ctx.period}.txt`, contentType: 'text/plain; charset=utf-8', body: Buffer.from(lines.join('\n') + (lines.length ? '\n' : '')), records: lines.length };
    },
  };
}

function prepareEsi(ctx: RunCtx): Prepared {
  const excluded: Excluded[] = [];
  const notes: string[] = [];
  const ceiling = Number(ctx.payroll.esi_wage_ceiling) || 0;
  const covered = ctx.slips.filter((s) => lineAmount(s.deductions, 'ESI') > 0 || (ceiling > 0 && Number(s.gross) <= ceiling));
  const above = ctx.slips.length - covered.length;
  if (above) notes.push(`${above} employee${above === 1 ? '' : 's'} above the ESI wage ceiling (${ceiling.toLocaleString('en-IN')}) ${above === 1 ? 'is' : 'are'} not covered and not listed.`);
  let derived = 0;
  const rows = covered.filter((s) => {
    if (digits(cf(s, 'esi_number', 'esi_ip_number', 'ip_number'))) return true;
    if (ctx.demo) { derived += 1; return true; }
    excluded.push(ex(s, 'no ESI IP number on file'));
    return false;
  });
  if (derived) notes.push(`${derived} employee${derived === 1 ? ' has' : 's have'} no ESI IP number in the demo data: a placeholder number derived from the employee code is used. Record the real IP number in the employee's custom field "esi_number".`);
  notes.push(...placeholderNote(ctx, ['in_esi_employer_code']));
  return {
    records: rows.length, excluded, notes,
    build: async () => {
      const dmy = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
      const data: XCell[][] = rows.map((s) => {
        const ip = digits(cf(s, 'esi_number', 'esi_ip_number', 'ip_number')) || `${hashDigits(`${ctx.slug}:esi:${s.employee_code}`, 10)}`;
        const days = Math.round(Number(s.paid_days) || 0);
        const left = s.exit_date && s.exit_date >= ctx.start && s.exit_date <= ctx.end;
        const reason = days === 0 ? (left ? 2 : 1) : 0;
        return [ip, clean(s.employee_name), days, Math.round(Number(s.gross) || 0), reason, left ? dmy(s.exit_date!) : ''];
      });
      const body = await buildXlsx([{ name: 'ESIC contribution', cols: [
        { header: 'IP Number', width: 14 }, { header: 'IP Name', width: 28 }, { header: 'No of Days for which wages paid/payable during the month', width: 22 },
        { header: 'Total Monthly Wages', width: 18 }, { header: 'Reason Code for Zero workings days', width: 18 }, { header: 'Last Working Day', width: 16 },
      ], rows: data }]);
      return { filename: `${ctx.code}_ESI_Contribution_${ctx.period}.xlsx`, contentType: XLSX_TYPE, body, records: rows.length };
    },
  };
}

/* ------------------------------------------------------------------ */
/* UAE — WPS SIF                                                       */
/* ------------------------------------------------------------------ */
/** UAE routing code: stored 9 digits, else derived from the IBAN's 3-digit bank code (demo approximation). */
const aeRouting = (s: Slip) => (/^\d{9}$/.test(swift(s)) ? swift(s) : `8${iban(s).slice(4, 7)}20101`);
const molId = (s: Slip) => digits(cf(s, 'mol_person_id', 'labour_card_number', 'mol_id', 'person_id'));

function prepareWps(ctx: RunCtx): Prepared {
  const excluded: Excluded[] = [];
  const notes: string[] = [];
  let derived = 0;
  const rows = payable(ctx.slips, excluded).filter((s) => {
    if (!iban(s)) { excluded.push(ex(s, 'no IBAN on file')); return false; }
    if (!isIban(iban(s), 'AE')) { excluded.push(ex(s, 'IBAN is not a valid UAE IBAN')); return false; }
    if (!molId(s)) {
      if (!ctx.demo) { excluded.push(ex(s, 'no MOL person id (labour card) on file')); return false; }
      derived += 1;
    }
    return true;
  });
  if (derived) notes.push(`${derived} employee${derived === 1 ? ' has' : 's have'} no MOL person id in the demo data: a placeholder 14-digit id is used. Record the real id in the employee's custom field "mol_person_id".`);
  notes.push('Agent routing codes are taken from the employee record when it holds a 9-digit code, otherwise derived from the IBAN bank code.');
  notes.push(...placeholderNote(ctx, ['ae_employer_mol_id', 'ae_employer_routing_code']));
  return {
    records: rows.length, excluded, notes,
    build: () => {
      const f = ctx.files;
      const lines: string[] = [];
      const nets: number[] = [];
      for (const s of rows) {
        const net = toMinor(s.net);
        const variable = Math.min(Math.max(0, variableMinor(s)), net);
        const fixed = net - variable;
        nets.push(net);
        const person = (molId(s) || hashDigits(`${ctx.slug}:mol:${s.employee_code}`, 14)).padStart(14, '0').slice(-14);
        lines.push(['EDR', person, aeRouting(s), iban(s), ctx.start, ctx.end, ctx.days, fmtMinor(fixed), fmtMinor(variable), Math.round(Number(s.lop_days) || 0)].join(','));
      }
      const total = sumMinor(nets);
      const employer = digits(f.ae_employer_mol_id).padStart(13, '0').slice(-13);
      const mmyyyy = `${ctx.period.slice(5, 7)}${ctx.period.slice(0, 4)}`;
      const ref = (f.ae_employer_reference || ctx.code).replace(/,/g, ' ').slice(0, 16);
      lines.push(['SCR', employer, digits(f.ae_employer_routing_code), ctx.now.date, ctx.now.hhmm, mmyyyy, rows.length, fmtMinor(total), 'AED', ref].join(','));
      const stamp = ctx.now.date.slice(2).replace(/-/g, '') + ctx.now.hhmmss;
      return { filename: `${employer}${stamp}.SIF`, contentType: 'text/plain; charset=utf-8', body: Buffer.from(lines.join('\r\n')), records: rows.length, total_minor: total };
    },
  };
}

/* ------------------------------------------------------------------ */
/* KSA — Mudad                                                         */
/* ------------------------------------------------------------------ */
const saBankCode = (s: Slip) => (/^[A-Z]{4}SA/.test(swift(s)) ? swift(s).slice(0, 4) : iban(s).slice(4, 6));

function prepareMudad(ctx: RunCtx): Prepared {
  const excluded: Excluded[] = [];
  const rows = payable(ctx.slips, excluded).filter((s) => {
    if (!iban(s)) { excluded.push(ex(s, 'no IBAN on file')); return false; }
    if (!isIban(iban(s), 'SA')) { excluded.push(ex(s, 'IBAN is not a valid Saudi IBAN')); return false; }
    if (!/^[12]\d{9}$/.test(digits(s.tax_id))) { excluded.push(ex(s, 'no national id / Iqama number on file')); return false; }
    return true;
  });
  return {
    records: rows.length, excluded, notes: placeholderNote(ctx, ['sa_mudad_establishment_id']),
    build: () => {
      const lines = [csvLine(['Employee Name', 'National ID / Iqama', 'Bank Code', 'IBAN', 'Basic Salary', 'Housing Allowance', 'Other Earnings', 'Deductions', 'Net Salary', 'Payment Date'])];
      const nets: number[] = [];
      for (const s of rows) {
        const gross = toMinor(s.gross), net = toMinor(s.net), basic = lineAmount(s.earnings, 'BASIC') || toMinor(s.basic), housing = lineAmount(s.earnings, 'HOUSING');
        nets.push(net);
        // Columns reconcile by construction: basic + housing + other − deductions = net.
        lines.push(csvLine([clean(s.employee_name), digits(s.tax_id), saBankCode(s), iban(s), fmtMinor(basic), fmtMinor(housing), fmtMinor(gross - basic - housing), fmtMinor(gross - net), fmtMinor(net), ctx.payDate]));
      }
      return { filename: `${ctx.code}_Mudad_WPS_${ctx.period}.csv`, contentType: 'text/csv; charset=utf-8', body: Buffer.from(lines.join('\r\n') + '\r\n'), records: rows.length, total_minor: sumMinor(nets) };
    },
  };
}

/* ------------------------------------------------------------------ */
/* Qatar — WPS SIF                                                     */
/* ------------------------------------------------------------------ */
const qaBank = (s: Slip) => (/^[A-Z]{4}QA/.test(swift(s)) ? swift(s).slice(0, 4) : iban(s).slice(4, 8));

function prepareQatar(ctx: RunCtx): Prepared {
  const excluded: Excluded[] = [];
  const rows = payable(ctx.slips, excluded).filter((s) => {
    if (!iban(s)) { excluded.push(ex(s, 'no IBAN on file')); return false; }
    if (!isIban(iban(s), 'QA')) { excluded.push(ex(s, 'IBAN is not a valid Qatar IBAN')); return false; }
    if (!/^\d{11}$/.test(digits(s.tax_id)) && !cf(s, 'visa_id')) { excluded.push(ex(s, 'no QID or visa id on file')); return false; }
    return true;
  });
  return {
    records: rows.length, excluded, notes: placeholderNote(ctx, ['qa_employer_eid', 'qa_payer_bank', 'qa_payer_iban']),
    build: () => {
      const f = ctx.files;
      const recs: string[] = [];
      const nets: number[] = [];
      for (const s of rows) {
        const gross = toMinor(s.gross), net = toMinor(s.net), basic = lineAmount(s.earnings, 'BASIC') || toMinor(s.basic);
        nets.push(net);
        recs.push(csvLine([digits(s.tax_id) || cf(s, 'visa_id'), clean(s.employee_name), qaBank(s), iban(s), 'M', Math.round(Number(s.paid_days) || 0), fmtMinor(net), fmtMinor(basic), 0, fmtMinor(gross - basic), fmtMinor(gross - net), 'Normal Payment', '']));
      }
      const total = sumMinor(nets);
      const ymd = ctx.now.date.replace(/-/g, '');
      const head = [
        csvLine(['Employer EID', 'File Creation Date', 'File Creation Time', 'Payer Bank Short Name', 'Payer IBAN', 'Salary Year and Month', 'Total Salaries', 'Total Records']),
        csvLine([f.qa_employer_eid, ymd, ctx.now.hhmm, f.qa_payer_bank, f.qa_payer_iban, ctx.period.replace('-', ''), fmtMinor(total), rows.length]),
        csvLine(['Employee QID / Visa ID', 'Employee Name', 'Employee Bank Short Name', 'Employee Account (IBAN)', 'Salary Frequency', 'Number of Working Days', 'Net Salary', 'Basic Salary', 'Extra Hours', 'Extra Income', 'Deductions', 'Payment Type', 'Notes / Comments']),
      ];
      return { filename: `SIF_${f.qa_employer_eid}_${f.qa_payer_bank}_${ymd}_${ctx.now.hhmm}.csv`, contentType: 'text/csv; charset=utf-8', body: Buffer.from([...head, ...recs].join('\r\n') + '\r\n'), records: rows.length, total_minor: total };
    },
  };
}

/* ------------------------------------------------------------------ */
/* US — NACHA ACH (PPD credits)                                        */
/* ------------------------------------------------------------------ */
/** ACH settles on banking days: a pay date on a Saturday / Sunday moves back to Friday. */
export function achEffectiveDate(date: string): string {
  const d = new Date(date + 'T00:00:00Z');
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
export function nachaEntryHash(routings8: string[]): string {
  const sum = routings8.reduce((s, r) => s + Number(r), 0);
  return String(sum % 10_000_000_000).padStart(10, '0');
}

function prepareNacha(ctx: RunCtx): Prepared {
  const excluded: Excluded[] = [];
  const rows = payable(ctx.slips, excluded).filter((s) => {
    if (!isAbaRouting(digits(s.bank_ifsc))) { excluded.push(ex(s, s.bank_ifsc ? 'invalid ABA routing number' : 'no routing number on file')); return false; }
    const acct = String(s.bank_account_number || '').replace(/[\s-]/g, '');
    if (!acct) { excluded.push(ex(s, 'no bank account number')); return false; }
    if (acct.length > 17 || !/^[0-9A-Za-z]+$/.test(acct)) { excluded.push(ex(s, 'account number is not valid for ACH')); return false; }
    return true;
  });
  return {
    records: rows.length, excluded, notes: placeholderNote(ctx, ['us_odfi_routing', 'us_ach_immediate_origin', 'us_ach_company_id']),
    build: () => {
      const f = ctx.files;
      const odfi = digits(f.us_odfi_routing).padStart(9, '0');
      const odfi8 = odfi.slice(0, 8);
      const yymmdd = (d: string) => d.slice(2).replace(/-/g, '');
      const origin = String(f.us_ach_immediate_origin || '').padStart(10, ' ').slice(-10);
      const companyId = String(f.us_ach_company_id || '').padStart(10, ' ').slice(-10);
      const companyName = f.us_ach_company_name || ctx.company.name || ctx.code;
      const out: string[] = [];
      // 1 — File header
      out.push('1' + '01' + ' ' + odfi + origin + yymmdd(ctx.now.date) + ctx.now.hhmm + 'A' + '094' + '10' + '1' + padR(f.us_odfi_name, 23) + padR(ctx.company.legal_name || ctx.company.name, 23) + padR(ctx.period.replace('-', ''), 8));
      // 5 — Batch header (service class 220 = credits only)
      const batchNo = '0000001';
      const descDate = `${MONTHS[Number(ctx.period.slice(5, 7)) - 1].toUpperCase()} ${ctx.period.slice(2, 4)}`;
      out.push('5' + '220' + padR(companyName, 16) + padR('', 20) + companyId + 'PPD' + padR('PAYROLL', 10) + padR(descDate, 6) + yymmdd(achEffectiveDate(ctx.payDate)) + '   ' + '1' + odfi8 + batchNo);
      // 6 — Entry detail, one per employee
      const routings: string[] = [];
      const amounts: number[] = [];
      rows.forEach((s, i) => {
        const rdfi = digits(s.bank_ifsc);
        const savings = /sav/i.test(cf(s, 'account_type', 'bank_account_type'));
        const amount = toMinor(s.net);
        routings.push(rdfi.slice(0, 8));
        amounts.push(amount);
        const acct = String(s.bank_account_number).replace(/[\s-]/g, '');
        out.push('6' + (savings ? '32' : '22') + rdfi.slice(0, 8) + rdfi[8] + padR(acct, 17) + padL(amount, 10) + padR(s.employee_code, 15) + padR(s.bank_account_name || s.employee_name, 22) + '  ' + '0' + odfi8 + padL(i + 1, 7));
      });
      const hash = nachaEntryHash(routings);
      const credit = sumMinor(amounts);
      // 8 — Batch control
      out.push('8' + '220' + padL(rows.length, 6) + hash + padL(0, 12) + padL(credit, 12) + companyId + ' '.repeat(19) + ' '.repeat(6) + odfi8 + batchNo);
      // 9 — File control (block count includes the padding)
      const blocks = Math.ceil((out.length + 1) / 10);
      out.push('9' + padL(1, 6) + padL(blocks, 6) + padL(rows.length, 8) + hash + padL(0, 12) + padL(credit, 12) + ' '.repeat(39));
      while (out.length % 10) out.push('9'.repeat(94));
      for (const l of out) if (l.length !== 94) throw new Error(`NACHA record length ${l.length}: ${l.slice(0, 1)}`);
      return { filename: `${ctx.code}_ACH_${ctx.period}.ach`, contentType: 'text/plain; charset=us-ascii', body: Buffer.from(out.join('\n') + '\n'), records: rows.length, total_minor: credit };
    },
  };
}

/* ------------------------------------------------------------------ */
/* Catalogue                                                           */
/* ------------------------------------------------------------------ */
export const FILE_DEFS: FileDef[] = [
  { kind: 'register', name: 'Payroll register', category: 'register', countries: 'all', format: 'Excel (.xlsx)', portal: 'Client sign-off, finance and auditors',
    description: 'One row per payslip with paid / LOP days, every earning and deduction, gross, net and bank details; a totals row and a component-totals sheet.', prepare: prepareRegister },
  { kind: 'bank_transfer', name: 'Bank salary transfer (NEFT / RTGS)', category: 'bank', countries: ['IN'], format: 'CSV',
    portal: 'Corporate net-banking bulk upload', description: 'One credit per employee: beneficiary, account, IFSC, net pay and narration. Amounts of ₹2,00,000 and above go by RTGS, the rest by NEFT.', prepare: prepareIndiaBank },
  { kind: 'pf_ecr', name: 'PF ECR (EPFO)', category: 'statutory', countries: ['IN'], format: 'ECR 2.0 text (#~#)',
    portal: 'EPFO Unified Portal → ECR upload', description: 'Monthly electronic challan-cum-return: UAN, wages (EPF / EPS / EDLI, capped per PF settings), EE share, EPS (8.33% up to ₹15,000), ER difference and NCP days.', prepare: prepareEcr },
  { kind: 'esi', name: 'ESI monthly contribution', category: 'statutory', countries: ['IN'], format: 'Excel (.xlsx)',
    portal: 'ESIC portal → Monthly contribution upload', description: 'IP number, name, days paid and wages for employees within the ESI wage ceiling.', prepare: prepareEsi },
  { kind: 'wps_sif', name: 'WPS salary file (SIF)', category: 'bank', countries: ['AE'], format: 'SIF (CSV text)',
    portal: 'Paying bank / exchange house → MOHRE WPS', description: 'One EDR record per employee (MOL person id, routing code, IBAN, pay period, fixed and variable pay, leave days) and an SCR control record with the totals.', prepare: prepareWps },
  { kind: 'mudad_wps', name: 'Mudad salary upload', category: 'bank', countries: ['SA'], format: 'CSV',
    portal: 'Mudad (MHRSD Wage Protection)', description: 'Name, national id / Iqama, bank, IBAN, basic, housing, other earnings, deductions and net salary with the payment date.', prepare: prepareMudad },
  { kind: 'qatar_wps', name: 'WPS salary file (Qatar SIF)', category: 'bank', countries: ['QA'], format: 'SIF (CSV)',
    portal: 'Paying bank → Ministry of Labour WPS', description: 'Header record (employer EID, payer bank and IBAN, month, totals) then one record per employee with QID, IBAN, working days, net, basic, extra income and deductions.', prepare: prepareQatar },
  { kind: 'nacha_ach', name: 'ACH direct deposit (NACHA)', category: 'bank', countries: ['US'], format: 'NACHA (94-character records)',
    portal: 'Company bank (ODFI) → ACH origination', description: 'PPD credit batch: one entry per employee (routing, account, amount), with batch and file control totals and entry hash.', prepare: prepareNacha },
];

export const defsFor = (country: Country) => FILE_DEFS.filter((d) => d.countries === 'all' || d.countries.includes(country));

function summarise(excluded: Excluded[]): string[] {
  const by = new Map<string, Excluded[]>();
  for (const e of excluded) by.set(e.reason, [...(by.get(e.reason) || []), e]);
  return [...by.entries()].map(([reason, list]) => `${list.length} employee${list.length === 1 ? '' : 's'} left out: ${reason} (${list.slice(0, 5).map((e) => e.name).join(', ')}${list.length > 5 ? ', …' : ''})`);
}

/** The outputs available for a run, with readiness and warnings. */
export function listOutputs(ctx: RunCtx) {
  const approved = ctx.run.status === 'approved' || ctx.run.status === 'paid';
  return defsFor(ctx.country).map((d) => {
    const p = d.prepare(ctx);
    const needsApproval = d.category === 'bank' && !approved;
    return {
      kind: d.kind, name: d.name, description: d.description, portal: d.portal, format: d.format, category: d.category,
      available: !needsApproval, preview_only: needsApproval,
      records: p.records, excluded: p.excluded, warnings: summarise(p.excluded), notes: p.notes,
    };
  });
}

/** Build one output. Bank / WPS / ACH files need an approved run unless `preview` is set. */
export async function buildOutput(ctx: RunCtx, kind: string, preview: boolean): Promise<Built & { excluded: Excluded[]; preview: boolean }> {
  const def = defsFor(ctx.country).find((d) => d.kind === kind);
  if (!def) {
    if (FILE_DEFS.some((d) => d.kind === kind)) throw badRequest(`The ${kind} file is not used for companies in this country`);
    throw notFound('Unknown output file');
  }
  const approved = ctx.run.status === 'approved' || ctx.run.status === 'paid';
  const isPreview = def.category === 'bank' && !approved;
  if (isPreview && !preview) throw badRequest('Salary cannot be paid from an unapproved register. This file is available once the client approves the run (or download a preview).');
  const p = def.prepare(ctx);
  const built = await p.build();
  return { ...built, filename: isPreview ? `PREVIEW_${built.filename}` : built.filename, excluded: p.excluded, preview: isPreview };
}
