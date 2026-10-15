import PDFDocument from 'pdfkit';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { agency, companyDb, get } from '../db.js';
import { runAsTenant } from '../context.js';
import { HttpError, badRequest, notFound, nowIso, today, addDays, isIsoDate } from '../util.js';

/**
 * Agency billing engine: invoice generation from billing profiles, effective-dated tax (India GST,
 * GCC VAT, zero-rated exports, US), statutory numbering, payments and the invoice PDF.
 *
 * Money rules (house standard): every amount is an integer in minor units; the currency's exponent
 * is data (`exponentOf`), never a constant; there is no float accumulation; when a total is split
 * (CGST/SGST) we compute the total once, then allocate it so the parts always sum to the whole.
 */

/* ------------------------------------------------------------------ */
/* Money helpers                                                       */
/* ------------------------------------------------------------------ */
/** ISO 4217 minor-unit exponents. Unknown currencies default to 2. */
export const CURRENCY_EXPONENT: Record<string, number> = { INR: 2, AED: 2, SAR: 2, QAR: 2, USD: 2, EUR: 2, GBP: 2, KWD: 3, BHD: 3, OMR: 3, JOD: 3, JPY: 0 };
export function exponentOf(currency: string | null | undefined): number {
  const e = CURRENCY_EXPONENT[String(currency || '').toUpperCase()];
  return e === undefined ? 2 : e;
}

/** Integer division of a*b by d, rounded half away from zero (exact for |a*b| < 2^53). */
export function mulDivRound(a: number, b: number, d: number): number {
  const p = a * b;
  if (!Number.isSafeInteger(p)) {
    const big = BigInt(a) * BigInt(b);
    const D = BigInt(d);
    const neg = big < 0n;
    const abs = neg ? -big : big;
    const q = (abs * 2n + D) / (2n * D);
    return Number(neg ? -q : q);
  }
  const neg = p < 0;
  const abs = Math.abs(p);
  const q = Math.floor((abs * 2 + d) / (2 * d));
  return neg ? -q : q;
}

/** Split `total` into `parts` integer shares; the remainder goes to the earliest shares. */
export function allocateEven(total: number, parts: number): number[] {
  const base = Math.trunc(total / parts);
  let rem = total - base * parts;
  return Array.from({ length: parts }, () => {
    if (rem > 0) { rem--; return base + 1; }
    return base;
  });
}

/**
 * Parse a decimal amount ("1234.5", "1,234.50", 1234.5) into minor units of a currency with
 * `exponent` decimals — by string, so 0.1 + 0.2 style float errors never enter. Integers are fine.
 */
export function parseMoney(input: unknown, exponent: number): number {
  const s = String(input ?? '').trim().replace(/,/g, '');
  const m = s.match(/^(-)?(\d+)(?:\.(\d*))?$/);
  if (!m) throw badRequest(`"${String(input ?? '')}" is not a valid amount`);
  const frac = m[3] || '';
  if (frac.length > exponent && /[1-9]/.test(frac.slice(exponent))) throw badRequest(`Amounts in this currency have at most ${exponent} decimal place${exponent === 1 ? '' : 's'}`);
  const minor = Number(m[2]) * 10 ** exponent + Number((frac + '0'.repeat(exponent)).slice(0, exponent) || '0');
  if (!Number.isSafeInteger(minor)) throw badRequest('Amount is too large');
  return m[1] ? -minor : minor;
}

/** "1,23,456.78" (INR) / "123,456.78" — exact string formatting of minor units. */
export function formatMinor(minor: number, exponent: number, currency = ''): string {
  const neg = minor < 0;
  const abs = Math.abs(minor);
  const unit = 10 ** exponent;
  const int = Math.floor(abs / unit);
  const frac = exponent ? String(abs % unit).padStart(exponent, '0') : '';
  const grouped = new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', { maximumFractionDigits: 0 }).format(int);
  return `${neg ? '-' : ''}${grouped}${exponent ? '.' + frac : ''}`;
}
export const formatMoney = (minor: number, exponent: number, currency: string) => `${currency} ${formatMinor(minor, exponent, currency)}`;

/* ------------------------------------------------------------------ */
/* Amount in words                                                     */
/* ------------------------------------------------------------------ */
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
function below1000(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  const parts: string[] = [];
  if (h) parts.push(`${ONES[h]} Hundred`);
  if (r) parts.push(r < 20 ? ONES[r] : `${TENS[Math.floor(r / 10)]}${r % 10 ? '-' + ONES[r % 10] : ''}`);
  return parts.join(' ');
}
function intWords(n: number, indian: boolean): string {
  if (n === 0) return 'Zero';
  const scales: [number, string][] = indian ? [[1e7, 'Crore'], [1e5, 'Lakh'], [1e3, 'Thousand']] : [[1e12, 'Trillion'], [1e9, 'Billion'], [1e6, 'Million'], [1e3, 'Thousand']];
  const out: string[] = [];
  let rest = n;
  for (const [v, name] of scales) {
    const q = Math.floor(rest / v);
    if (q) { out.push(`${indian && q >= 1000 ? intWords(q, true) : below1000(q) || intWords(q, indian)} ${name}`); rest -= q * v; }
  }
  if (rest) out.push(below1000(rest));
  return out.join(' ');
}
const UNIT_NAMES: Record<string, [string, string]> = { INR: ['Rupees', 'Paise'], AED: ['UAE Dirhams', 'Fils'], SAR: ['Saudi Riyals', 'Halalas'], QAR: ['Qatari Riyals', 'Dirhams'], USD: ['US Dollars', 'Cents'], KWD: ['Kuwaiti Dinars', 'Fils'] };
export function amountInWords(minor: number, exponent: number, currency: string): string {
  const [major, minorName] = UNIT_NAMES[currency] || [currency, 'minor units'];
  const unit = 10 ** exponent;
  const int = Math.floor(Math.abs(minor) / unit);
  const frac = Math.abs(minor) % unit;
  const indian = currency === 'INR';
  return `${major} ${intWords(int, indian)}${frac ? ` and ${intWords(frac, indian)} ${minorName}` : ''} only`;
}

/* ------------------------------------------------------------------ */
/* Tax                                                                 */
/* ------------------------------------------------------------------ */
export interface TaxPart { name: string; rate_bp: number; amount_minor: number }
/** The rate of `scheme` in force on `date` (effective-dated master data, never a constant). */
export function taxRateFor(scheme: string, date: string): { rate_bp: number; effective_from: string | null; note: string | null } {
  const row = agency.get<any>('SELECT rate_bp, effective_from, note FROM tax_rates WHERE scheme = ? AND effective_from <= ? ORDER BY effective_from DESC LIMIT 1', [scheme, date]);
  if (row) return row;
  if (scheme === 'US_NONE' || scheme === 'QA_NONE' || scheme === 'AE_EXPORT') return { rate_bp: 0, effective_from: null, note: null };
  throw new HttpError(422, `No ${scheme} tax rate is in force on ${date}`);
}

/** Is an Indian supply intra-state (CGST+SGST) or inter-state (IGST)? Decided by place of supply. */
export function isIntraState(entity: { region?: string | null; region_code?: string | null }, profile: { place_of_supply?: string | null; place_of_supply_code?: string | null }): boolean {
  if (entity.region_code && profile.place_of_supply_code) return String(entity.region_code) === String(profile.place_of_supply_code);
  return !!entity.region && !!profile.place_of_supply && entity.region.trim().toLowerCase() === profile.place_of_supply.trim().toLowerCase();
}

/** Tax on a subtotal: one rounding on the total, then allocation; parts always sum to the total. */
export function computeTax(subtotal: number, scheme: string, rate_bp: number, intra: boolean): { tax_minor: number; breakdown: TaxPart[] } {
  const tax = Math.max(0, mulDivRound(subtotal, rate_bp, 10000));
  let breakdown: TaxPart[];
  if (scheme === 'IN_GST') {
    if (intra) {
      const [c, s] = allocateEven(tax, 2); // odd minor unit lands on CGST
      const [cr, sr] = allocateEven(rate_bp, 2);
      breakdown = [{ name: 'CGST', rate_bp: cr, amount_minor: c }, { name: 'SGST', rate_bp: sr, amount_minor: s }];
    } else breakdown = [{ name: 'IGST', rate_bp, amount_minor: tax }];
  } else if (scheme === 'AE_VAT' || scheme === 'SA_VAT') breakdown = [{ name: 'VAT', rate_bp, amount_minor: tax }];
  else if (scheme === 'AE_EXPORT') breakdown = [{ name: 'VAT (zero-rated export)', rate_bp, amount_minor: tax }];
  else breakdown = tax ? [{ name: 'Tax', rate_bp, amount_minor: tax }] : [];
  const sum = breakdown.reduce((a, p) => a + p.amount_minor, 0);
  if (sum !== tax) throw new Error(`Tax allocation mismatch: ${sum} != ${tax}`);
  return { tax_minor: tax, breakdown };
}

/** GST state codes (place of supply). */
export const GST_STATE_CODES: Record<string, string> = {
  'Jammu and Kashmir': '01', 'Himachal Pradesh': '02', Punjab: '03', Chandigarh: '04', Uttarakhand: '05', Haryana: '06', Delhi: '07', Rajasthan: '08', 'Uttar Pradesh': '09', Bihar: '10',
  Assam: '18', 'West Bengal': '19', Jharkhand: '20', Odisha: '21', Chhattisgarh: '22', 'Madhya Pradesh': '23', Gujarat: '24', Maharashtra: '27', Karnataka: '29', Goa: '30',
  Kerala: '32', 'Tamil Nadu': '33', Puducherry: '34', Telangana: '36', 'Andhra Pradesh': '37',
};

/* ------------------------------------------------------------------ */
/* Dates, periods, numbering                                           */
/* ------------------------------------------------------------------ */
export const isPeriod = (p: unknown): p is string => typeof p === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(p);
export function shiftMonth(period: string, n: number): string {
  const [y, m] = period.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}
export function monthEnd(period: string): string {
  return addDays(shiftMonth(period, 1) + '-01', -1);
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function periodLabel(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}
/** Financial-year label of `date` for a series starting in `startMonth` (4 = 1 Apr → "2026-27"; 1 → "2026"). */
export function fyLabel(date: string, startMonth: number): string {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  if (startMonth <= 1) return String(y);
  const start = m >= startMonth ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}
export const counterKey = (entity: { tax_id: string }, fy: string) => `invoice:${entity.tax_id}:${fy}`;
/** Today in the company's own time zone. */
export function companyToday(c: { slug: string; timezone: string }): string {
  return runAsTenant({ slug: c.slug, timezone: c.timezone }, () => today());
}

/* ------------------------------------------------------------------ */
/* Inputs from the company database                                    */
/* ------------------------------------------------------------------ */
/**
 * Employees billable for a service month: on the rolls at any point in it — joined on/before the
 * month end and not exited before the month start. Exited records without an exit date are not
 * billable (we cannot place them in the month).
 */
export function activeEmployeesInMonth(c: { slug: string; timezone: string }, period: string): number {
  const start = `${period}-01`;
  const end = monthEnd(period);
  try {
    companyDb(c.slug);
    return runAsTenant({ slug: c.slug, timezone: c.timezone }, () =>
      get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM employees
          WHERE (join_date IS NULL OR join_date <= ?)
            AND (exit_date IS NULL OR exit_date >= ?)
            AND NOT (status = 'exited' AND exit_date IS NULL)`,
        [end, start],
      )?.n ?? 0,
    );
  } catch {
    return 0;
  }
}
export function payrollRunsInPeriod(c: { slug: string; timezone: string }, period: string): { period: string; status: string }[] {
  try {
    companyDb(c.slug);
    return runAsTenant({ slug: c.slug, timezone: c.timezone }, () => {
      const row = get<any>("SELECT period, status FROM payroll_runs WHERE period = ? AND status IN ('processed','approved','paid')", [period]);
      return row ? [row] : [];
    });
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* Invoices                                                            */
/* ------------------------------------------------------------------ */
const profileQuery = `SELECT p.*, c.slug, c.name AS company_name, c.legal_name AS company_legal_name, c.timezone, c.status AS company_status, c.onboarded_at, c.country_code, c.region AS company_region
                      FROM billing_profiles p JOIN companies c ON c.id = p.company_id`;
export function loadProfile(companyId: number) {
  return agency.get<any>(`${profileQuery} WHERE p.company_id = ?`, [companyId]);
}
export function loadInvoice(id: number) {
  return agency.get<any>('SELECT * FROM invoices WHERE id = ?', [id]);
}

/** Recompute the minimum top-up line, subtotal, tax (as of `asOf`) and total. No transaction. */
function recalc(invoiceId: number, asOf: string) {
  const inv = loadInvoice(invoiceId)!;
  const profile = loadProfile(inv.company_id);
  const entity = agency.get<any>('SELECT * FROM billing_entities WHERE id = ?', [inv.entity_id]);
  agency.run("DELETE FROM invoice_lines WHERE invoice_id = ? AND kind = 'minimum_topup'", [invoiceId]);
  const lines = agency.all<any>('SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY sort_order, id', [invoiceId]);
  const recurring = lines.filter((l) => l.kind === 'pepm' || l.kind === 'payroll_run').reduce((a, l) => a + l.amount_minor, 0);
  const min = profile?.min_monthly_minor ?? 0;
  if (min > 0 && recurring < min) {
    const top = min - recurring;
    agency.insert('invoice_lines', { invoice_id: invoiceId, sort_order: 30, kind: 'minimum_topup', description: `Minimum monthly charge top-up (minimum ${formatMoney(min, inv.exponent, inv.currency)})`, sac_code: lineSac(entity, profile), quantity: 1, unit_minor: top, amount_minor: top });
  }
  const subtotal = agency.get<any>('SELECT COALESCE(SUM(amount_minor), 0) AS s FROM invoice_lines WHERE invoice_id = ?', [invoiceId])!.s as number;
  const rate = taxRateFor(inv.tax_scheme, asOf);
  const intra = inv.tax_scheme === 'IN_GST' && isIntraState(entity, profile || {});
  const { tax_minor, breakdown } = computeTax(subtotal, inv.tax_scheme, rate.rate_bp, intra);
  agency.update('invoices', invoiceId, { subtotal_minor: subtotal, tax_minor, total_minor: subtotal + tax_minor, tax_rate_bp: rate.rate_bp, tax_breakdown: JSON.stringify(breakdown) });
}
const lineSac = (entity: any, profile: any) => (entity?.country_code === 'IN' ? profile?.sac_code || '998519' : null);
function placeOfSupply(profile: any): string | null {
  if (!profile?.place_of_supply) return null;
  return profile.place_of_supply_code ? `${profile.place_of_supply} (${profile.place_of_supply_code})` : profile.place_of_supply;
}

export type GenerateResult = { company_id: number; slug: string; name: string; status: 'created' | 'skipped'; reason?: string; invoice_id?: number };
/** Create the draft invoice of one company for a service month (no transaction of its own). */
function generateOne(profile: any, period: string, actorId: number | null, asOf: string): GenerateResult {
  const base = { company_id: profile.company_id, slug: profile.slug, name: profile.company_name };
  if (!profile.active) return { ...base, status: 'skipped', reason: 'Billing profile is inactive' };
  if (profile.company_status === 'offboarded') return { ...base, status: 'skipped', reason: 'Company is offboarded' };
  const existing = agency.get<any>("SELECT id, status FROM invoices WHERE company_id = ? AND period = ? AND status != 'void'", [profile.company_id, period]);
  if (existing) return { ...base, status: 'skipped', reason: `An invoice for ${periodLabel(period)} already exists`, invoice_id: existing.id };
  const entity = agency.get<any>('SELECT * FROM billing_entities WHERE id = ?', [profile.entity_id]);
  const currency = profile.currency;
  const exponent = exponentOf(currency);
  const id = agency.insert('invoices', {
    entity_id: profile.entity_id, company_id: profile.company_id, period, currency, exponent, tax_scheme: profile.tax_scheme,
    place_of_supply: placeOfSupply(profile), status: 'draft', notes: profile.tax_scheme === 'AE_EXPORT' ? 'Zero-rated export of services' : null,
    created_by: actorId, created_at: nowIso(),
  });
  const sac = lineSac(entity, profile);
  const c = { slug: profile.slug, timezone: profile.timezone };
  const n = activeEmployeesInMonth(c, period);
  if (profile.pepm_minor > 0) {
    agency.insert('invoice_lines', { invoice_id: id, sort_order: 10, kind: 'pepm', description: `Payroll & HR services — ${n} active employee${n === 1 ? '' : 's'} × PEPM (${periodLabel(period)})`, sac_code: sac, quantity: n, unit_minor: profile.pepm_minor, amount_minor: n * profile.pepm_minor });
  }
  if (profile.payroll_run_minor > 0) {
    for (const run of payrollRunsInPeriod(c, period)) {
      agency.insert('invoice_lines', { invoice_id: id, sort_order: 20, kind: 'payroll_run', description: `Payroll processing — ${periodLabel(run.period)} run (${run.status})`, sac_code: sac, quantity: 1, unit_minor: profile.payroll_run_minor, amount_minor: profile.payroll_run_minor });
    }
  }
  if (!profile.setup_fee_billed && profile.setup_fee_minor > 0) {
    agency.insert('invoice_lines', { invoice_id: id, sort_order: 40, kind: 'setup', description: 'One-time onboarding & setup fee', sac_code: sac, quantity: 1, unit_minor: profile.setup_fee_minor, amount_minor: profile.setup_fee_minor });
    agency.run('UPDATE billing_profiles SET setup_fee_billed = 1, updated_at = ? WHERE company_id = ?', [nowIso(), profile.company_id]);
  }
  recalc(id, asOf);
  return { ...base, status: 'created', invoice_id: id };
}

/** Generate drafts for `companyIds` (all with a billing profile when omitted). */
export function generateInvoices(period: string, opts: { companyIds?: number[]; actorId?: number | null; asOf?: string } = {}): { period: string; created: GenerateResult[]; skipped: GenerateResult[] } {
  if (!isPeriod(period)) throw badRequest('period must be YYYY-MM');
  const profiles = agency.all<any>(`${profileQuery} ORDER BY c.name`).filter((p) => !opts.companyIds || opts.companyIds.includes(p.company_id));
  const out: GenerateResult[] = [];
  for (const p of profiles) {
    const asOf = opts.asOf || companyToday(p);
    try {
      out.push(agency.transaction(() => generateOne(p, period, opts.actorId ?? null, asOf)));
    } catch (e: any) {
      if (/UNIQUE/.test(String(e?.message))) out.push({ company_id: p.company_id, slug: p.slug, name: p.company_name, status: 'skipped', reason: 'An invoice for this period already exists' });
      else throw e;
    }
  }
  return { period, created: out.filter((r) => r.status === 'created'), skipped: out.filter((r) => r.status === 'skipped') };
}

/** Draft edits: notes, ad-hoc lines added / removed. */
export function updateDraft(id: number, body: { notes?: string | null; add_lines?: any[]; remove_line_ids?: number[] }) {
  const inv = loadInvoice(id);
  if (!inv) throw notFound('Invoice not found');
  if (inv.status !== 'draft') throw badRequest('Only draft invoices can be edited');
  const profile = loadProfile(inv.company_id);
  agency.transaction(() => {
    if (body.notes !== undefined) agency.update('invoices', id, { notes: body.notes ? String(body.notes).slice(0, 2000) : null });
    for (const lineId of body.remove_line_ids || []) {
      const l = agency.get<any>('SELECT kind FROM invoice_lines WHERE id = ? AND invoice_id = ?', [lineId, id]);
      if (!l) throw notFound('Line not found');
      if (l.kind !== 'adhoc') throw badRequest('Only ad-hoc lines can be removed');
      agency.run('DELETE FROM invoice_lines WHERE id = ?', [lineId]);
    }
    const entity = agency.get<any>('SELECT * FROM billing_entities WHERE id = ?', [inv.entity_id]);
    for (const raw of body.add_lines || []) {
      const description = String(raw?.description || '').trim().slice(0, 300);
      if (!description) throw badRequest('Each ad-hoc line needs a description');
      // Quantity: up to 2 decimals, held as hundredths so the amount stays integer arithmetic.
      const qtyH = parseMoney(raw?.quantity ?? 1, 2);
      if (qtyH <= 0) throw badRequest('Quantity must be positive');
      const unit = raw?.unit_minor !== undefined ? Number(raw.unit_minor) : parseMoney(raw?.unit ?? raw?.amount, inv.exponent);
      if (!Number.isSafeInteger(unit) || unit <= 0) throw badRequest('Unit price must be a positive amount');
      const amount = mulDivRound(qtyH, unit, 100);
      const order = (agency.get<any>('SELECT COALESCE(MAX(sort_order), 50) AS m FROM invoice_lines WHERE invoice_id = ?', [id])!.m as number) + 1;
      agency.insert('invoice_lines', { invoice_id: id, sort_order: Math.max(order, 51), kind: 'adhoc', description, sac_code: lineSac(entity, profile), quantity: qtyH / 100, unit_minor: unit, amount_minor: amount });
    }
    recalc(id, companyToday(profile));
  });
  return invoiceDetail(id);
}

/** Assign the next number of the entity's series for the FY of `issueDate` and issue the invoice. */
export function issueInvoice(id: number, issueDate?: string) {
  const inv = loadInvoice(id);
  if (!inv) throw notFound('Invoice not found');
  if (inv.status !== 'draft') throw badRequest('Only draft invoices can be issued');
  const profile = loadProfile(inv.company_id);
  const date = issueDate || companyToday(profile);
  if (!isIsoDate(date)) throw badRequest('Issue date must be YYYY-MM-DD');
  const entity = agency.get<any>('SELECT * FROM billing_entities WHERE id = ?', [inv.entity_id]);
  agency.transaction(() => {
    recalc(id, date);
    const fresh = loadInvoice(id)!;
    if (fresh.total_minor <= 0) throw badRequest('Nothing to bill on this invoice');
    const fy = fyLabel(date, entity.fy_start_month);
    const key = counterKey(entity, fy);
    // Invoices of one series must be chronological: never issue before the series' latest date.
    const last = agency.get<any>("SELECT MAX(issue_date) AS d FROM invoices WHERE entity_id = ? AND number LIKE ?", [entity.id, `${entity.invoice_prefix}/${fy}/%`])?.d;
    if (last && date < last) throw badRequest(`This series already has an invoice dated ${last}; issue dates must not go backwards`);
    const seq = agency.get<{ value: number }>('INSERT INTO counters (name, value) VALUES (?, 1) ON CONFLICT(name) DO UPDATE SET value = value + 1 RETURNING value', [key])!.value;
    const number = `${entity.invoice_prefix}/${fy}/${String(seq).padStart(4, '0')}`;
    agency.update('invoices', id, { number, issue_date: date, due_date: addDays(date, profile?.payment_terms_days ?? 15), status: 'issued', issued_at: nowIso() });
  });
  return invoiceDetail(id);
}

/** Void an issued, unpaid invoice. The number stays used (never reissued or renumbered). */
export function voidInvoice(id: number, reason: string) {
  const inv = loadInvoice(id);
  if (!inv) throw notFound('Invoice not found');
  if (inv.status !== 'issued') throw badRequest(inv.status === 'draft' ? 'Drafts have no number; edit the draft instead of voiding it' : `A ${inv.status} invoice cannot be voided`);
  if (inv.paid_minor > 0) throw badRequest('This invoice has payments recorded; it cannot be voided');
  const why = String(reason || '').trim();
  if (!why) throw badRequest('Give a reason for voiding the invoice');
  agency.transaction(() => {
    agency.update('invoices', id, { status: 'void', voided_at: nowIso(), void_reason: why.slice(0, 500) });
    // A voided setup fee becomes billable again on the next invoice.
    if (agency.get("SELECT 1 FROM invoice_lines WHERE invoice_id = ? AND kind = 'setup'", [id])) agency.run('UPDATE billing_profiles SET setup_fee_billed = 0, updated_at = ? WHERE company_id = ?', [nowIso(), inv.company_id]);
  });
  return invoiceDetail(id);
}

export const PAYMENT_METHODS = ['bank_transfer', 'neft', 'rtgs', 'upi', 'cheque', 'wire', 'ach', 'card', 'cash', 'other'];
/**
 * Record a payment. Replaying the same idempotency key returns the original payment and changes
 * nothing. Partial payments are fine; overpayment is refused.
 */
export function recordPayment(id: number, p: { amount_minor?: number; amount?: unknown; received_on?: string; method?: string; reference?: string | null; idempotency_key?: string | null }, actorId: number | null = null): { payment: any; replayed: boolean; invoice: any } {
  const key = p.idempotency_key ? String(p.idempotency_key).trim().slice(0, 120) : '';
  if (!key) throw badRequest('An Idempotency-Key is required to record a payment');
  return agency.transaction(() => {
    const prior = agency.get<any>('SELECT * FROM payments WHERE idempotency_key = ?', [key]);
    if (prior) {
      if (prior.invoice_id !== id) throw new HttpError(409, 'This idempotency key was already used for another invoice');
      return { payment: prior, replayed: true, invoice: null };
    }
    const inv = loadInvoice(id);
    if (!inv) throw notFound('Invoice not found');
    if (inv.status !== 'issued') throw badRequest(inv.status === 'paid' ? 'This invoice is already paid' : `Payments can only be recorded against issued invoices (this one is ${inv.status})`);
    const amount = p.amount_minor !== undefined && p.amount_minor !== null ? Number(p.amount_minor) : parseMoney(p.amount, inv.exponent);
    if (!Number.isSafeInteger(amount) || amount <= 0) throw badRequest('Payment amount must be positive');
    const outstanding = inv.total_minor - inv.paid_minor;
    if (amount > outstanding) throw badRequest(`Overpayment: only ${formatMoney(outstanding, inv.exponent, inv.currency)} is outstanding`);
    const received = p.received_on || today();
    if (!isIsoDate(received)) throw badRequest('Payment date must be YYYY-MM-DD');
    if (inv.issue_date && received < inv.issue_date) throw badRequest('Payment date is before the invoice date');
    const method = PAYMENT_METHODS.includes(String(p.method)) ? String(p.method) : 'bank_transfer';
    const pid = agency.insert('payments', { invoice_id: id, amount_minor: amount, received_on: received, method, reference: p.reference ? String(p.reference).slice(0, 120) : null, idempotency_key: key, created_by: actorId, created_at: nowIso() });
    const paid = inv.paid_minor + amount;
    agency.update('invoices', id, paid >= inv.total_minor ? { paid_minor: paid, status: 'paid', paid_at: received } : { paid_minor: paid });
    return { payment: agency.get('SELECT * FROM payments WHERE id = ?', [pid]), replayed: false, invoice: null };
  });
}

/** Row decoration for lists. */
export function invoiceRow(i: any, now = today()) {
  const outstanding = i.status === 'issued' ? i.total_minor - i.paid_minor : 0;
  const overdue = i.status === 'issued' && i.due_date && i.due_date < now ? 1 : 0;
  const days_overdue = overdue ? Math.round((Date.parse(now) - Date.parse(i.due_date)) / 86400000) : 0;
  let breakdown: TaxPart[] = [];
  try { breakdown = typeof i.tax_breakdown === 'string' ? JSON.parse(i.tax_breakdown) : i.tax_breakdown || []; } catch { /* ignore */ }
  return { ...i, tax_breakdown: breakdown, outstanding_minor: outstanding, overdue, days_overdue, display_status: overdue ? 'overdue' : i.status };
}
export const invoiceListQuery = `SELECT i.*, c.slug AS company_slug, c.name AS company_name, c.country_code, c.brand_color, c.logo_text, e.code AS entity_code, e.name AS entity_name
                                 FROM invoices i JOIN companies c ON c.id = i.company_id JOIN billing_entities e ON e.id = i.entity_id`;

export function invoiceDetail(id: number) {
  const inv = agency.get<any>(`${invoiceListQuery} WHERE i.id = ?`, [id]);
  if (!inv) throw notFound('Invoice not found');
  const company = agency.get<any>('SELECT id, slug, name, legal_name, country_code, region, city, currency, timezone, brand_color, logo_text, contact_name, contact_email FROM companies WHERE id = ?', [inv.company_id]);
  const profile = loadProfile(inv.company_id);
  return {
    ...invoiceRow(inv),
    lines: agency.all('SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY sort_order, id', [id]),
    payments: agency.all('SELECT * FROM payments WHERE invoice_id = ? ORDER BY received_on, id', [id]),
    entity: agency.get('SELECT id, code, name, legal_name, country_code, region, region_code, tax_label, tax_id, address, email, invoice_prefix, fy_start_month, bank_details FROM billing_entities WHERE id = ?', [inv.entity_id]),
    company,
    billing: profile ? {
      plan_name: profile.plan_name, billing_email: profile.billing_email, billing_contact: profile.billing_contact, billing_address: profile.billing_address,
      client_tax_id: profile.client_tax_id, client_tax_label: clientTaxLabel(company?.country_code), place_of_supply: profile.place_of_supply, place_of_supply_code: profile.place_of_supply_code, payment_terms_days: profile.payment_terms_days,
    } : null,
    zatca_note: inv.tax_scheme === 'SA_VAT' ? ZATCA_NOTE : null,
  };
}
export const ZATCA_NOTE = 'For real use in Saudi Arabia this invoice must be issued as a ZATCA (Fatoora) compliant e-invoice with a QR code and Arabic text. This PDF is a demo rendition.';
export const clientTaxLabel = (country?: string) => ({ IN: 'GSTIN', AE: 'TRN', SA: 'VAT No.', QA: 'CR No.', US: 'EIN' } as Record<string, string>)[country || ''] || 'Tax ID';

/* ------------------------------------------------------------------ */
/* PDF                                                                 */
/* ------------------------------------------------------------------ */
function fmtDate(d?: string | null) {
  if (!d) return '—';
  return `${d.slice(8, 10)} ${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
}
export function invoiceFileName(inv: { number?: string | null; id: number }) {
  return `${(inv.number || `draft-${inv.id}`).replace(/[^A-Za-z0-9-]+/g, '-')}.pdf`;
}
const pct = (bp: number) => `${(bp / 100).toFixed(bp % 100 ? 2 : 0)}%`;

/** Agency logo for the invoice letterhead (server/assets/logo.png; same path from src/ and dist/). */
const LOGO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets', 'logo.png');

export function buildInvoicePdf(id: number): Promise<Buffer> {
  const d = invoiceDetail(id);
  const e: any = d.entity;
  const brand = '#4A8F49';
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margins: { top: 48, bottom: 56, left: 50, right: 50 }, bufferPages: true, info: { Title: `Invoice ${d.number || 'draft'}`, Author: e.legal_name } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;
    const money = (m: number) => formatMinor(m, d.exponent, d.currency);
    const taxInvoice = ['IN_GST', 'AE_VAT', 'SA_VAT', 'AE_EXPORT'].includes(d.tax_scheme);

    // Letterhead
    const hasLogo = fs.existsSync(LOGO);
    const textLeft = hasLogo ? left + 58 : left;
    const textWidth = width * 0.6 - (textLeft - left);
    if (hasLogo) doc.image(LOGO, left, 44, { fit: [48, 48] });
    doc.font('Helvetica-Bold').fontSize(18).fillColor(brand).text(e.name, textLeft, 48, { width: textWidth });
    doc.font('Helvetica').fontSize(8.5).fillColor('#444444');
    doc.text(e.legal_name, { width: textWidth });
    doc.text(e.address, { width: textWidth });
    doc.text(`${e.tax_label}: ${e.tax_id}${e.email ? '   ·   ' + e.email : ''}`, { width: textWidth });
    const headBottom = Math.max(doc.y, hasLogo ? 96 : 0);
    doc.font('Helvetica-Bold').fontSize(16).fillColor('#111111').text(d.status === 'draft' ? 'DRAFT INVOICE' : taxInvoice ? 'TAX INVOICE' : 'INVOICE', left + width * 0.6, 48, { width: width * 0.4, align: 'right' });
    doc.font('Helvetica').fontSize(9).fillColor('#333333');
    const meta: [string, string][] = [['Invoice no.', d.number || 'Not issued'], ['Invoice date', fmtDate(d.issue_date)], ['Due date', fmtDate(d.due_date)], ['Service period', periodLabel(d.period)]];
    for (const [k, v] of meta) doc.text(`${k}: ${v}`, left + width * 0.6, doc.y + 1, { width: width * 0.4, align: 'right' });
    let y = Math.max(headBottom, doc.y) + 10;
    doc.moveTo(left, y).lineTo(left + width, y).lineWidth(1.5).strokeColor(brand).stroke();
    y += 12;

    // Bill to / supply details
    const b: any = d.billing || {};
    const c: any = d.company || {};
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#777777').text('BILL TO', left, y);
    doc.font('Helvetica-Bold').fontSize(10.5).fillColor('#111111').text(c.legal_name || c.name, left, doc.y + 2, { width: width * 0.55 });
    doc.font('Helvetica').fontSize(9).fillColor('#333333');
    if (b.billing_address) doc.text(b.billing_address, { width: width * 0.55 });
    if (b.billing_contact || b.billing_email) doc.text([b.billing_contact, b.billing_email].filter(Boolean).join(' · '), { width: width * 0.55 });
    if (b.client_tax_id) doc.text(`${b.client_tax_label}: ${b.client_tax_id}`, { width: width * 0.55 });
    const billBottom = doc.y;
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#777777').text('SUPPLY', left + width * 0.6, y, { width: width * 0.4 });
    doc.font('Helvetica').fontSize(9).fillColor('#333333');
    if (d.place_of_supply) doc.text(`Place of supply: ${d.place_of_supply}`, left + width * 0.6, doc.y + 2, { width: width * 0.4 });
    doc.text(`Currency: ${d.currency}`, left + width * 0.6, doc.y + 1, { width: width * 0.4 });
    if (b.payment_terms_days !== undefined) doc.text(`Terms: ${b.payment_terms_days} days`, left + width * 0.6, doc.y + 1, { width: width * 0.4 });
    y = Math.max(billBottom, doc.y) + 16;

    // Lines table
    const showSac = e.country_code === 'IN';
    const cols = showSac
      ? [{ k: '#', w: 22, a: 'left' }, { k: 'Description', w: width - 22 - 52 - 50 - 85 - 90, a: 'left' }, { k: 'SAC', w: 52, a: 'left' }, { k: 'Qty', w: 50, a: 'right' }, { k: 'Rate', w: 85, a: 'right' }, { k: 'Amount', w: 90, a: 'right' }]
      : [{ k: '#', w: 22, a: 'left' }, { k: 'Description', w: width - 22 - 50 - 95 - 100, a: 'left' }, { k: 'Qty', w: 50, a: 'right' }, { k: 'Rate', w: 95, a: 'right' }, { k: 'Amount', w: 100, a: 'right' }];
    const row = (cells: string[], bold = false, fill?: string) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
      const h = Math.max(...cells.map((t, i) => doc.heightOfString(t, { width: cols[i].w - 8 }))) + 8;
      if (y + h > doc.page.height - doc.page.margins.bottom - 20) { doc.addPage(); y = doc.page.margins.top; }
      if (fill) doc.rect(left, y, width, h).fill(fill);
      let x = left;
      cells.forEach((t, i) => { doc.fillColor('#222222').text(t, x + 4, y + 4, { width: cols[i].w - 8, align: cols[i].a as any }); x += cols[i].w; });
      y += h;
      doc.moveTo(left, y).lineTo(left + width, y).lineWidth(0.5).strokeColor('#dddddd').stroke();
    };
    row(cols.map((c2) => c2.k), true, '#eef4ee');
    d.lines.forEach((l: any, i: number) => {
      const qty = Number.isInteger(l.quantity) ? String(l.quantity) : Number(l.quantity).toFixed(2);
      const cells = [String(i + 1), l.description, ...(showSac ? [l.sac_code || ''] : []), qty, money(l.unit_minor), money(l.amount_minor)];
      row(cells);
    });
    y += 8;

    // Totals
    const tl = left + width * 0.5;
    const tw = width * 0.5;
    const total = (label: string, value: string, bold = false) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 10.5 : 9.5).fillColor('#222222');
      doc.text(label, tl, y, { width: tw * 0.6 });
      doc.text(value, tl + tw * 0.6, y, { width: tw * 0.4, align: 'right' });
      y += bold ? 16 : 14;
    };
    total('Subtotal', money(d.subtotal_minor));
    for (const t of d.tax_breakdown as TaxPart[]) total(`${t.name} @ ${pct(t.rate_bp)}`, money(t.amount_minor));
    if (!(d.tax_breakdown as TaxPart[]).length) total('Tax', money(0));
    doc.moveTo(tl, y).lineTo(left + width, y).lineWidth(0.8).strokeColor('#999999').stroke();
    y += 4;
    total(`Total (${d.currency})`, money(d.total_minor), true);
    if (d.paid_minor) { total('Paid', money(d.paid_minor)); total('Balance due', money(d.total_minor - d.paid_minor), true); }
    y += 6;
    doc.font('Helvetica-Oblique').fontSize(9).fillColor('#444444').text(`Amount in words: ${amountInWords(d.total_minor, d.exponent, d.currency)}`, left, y, { width });
    y = doc.y + 12;

    // Notes, bank details
    const notes: string[] = [];
    if (d.tax_scheme === 'AE_EXPORT') notes.push('Zero-rated export of services (UAE VAT).');
    if (d.tax_scheme === 'IN_GST') notes.push(`SAC 998519 — Payroll and HR management services. ${(d.tax_breakdown as TaxPart[]).some((t) => t.name === 'IGST') ? 'Inter-state supply: IGST charged.' : 'Intra-state supply: CGST + SGST charged.'}`);
    if (d.tax_scheme === 'US_NONE') notes.push('Payroll services are not subject to sales tax.');
    if (d.notes && d.notes !== 'Zero-rated export of services') notes.push(d.notes);
    if (d.tax_scheme === 'SA_VAT') notes.push(ZATCA_NOTE);
    if (notes.length) {
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#111111').text('Notes', left, y);
      doc.font('Helvetica').fontSize(8.5).fillColor('#444444');
      for (const n of notes) doc.text(n, left, doc.y + 2, { width });
      y = doc.y + 10;
    }
    if (e.bank_details) {
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#111111').text('Bank details', left, y);
      doc.font('Helvetica').fontSize(8.5).fillColor('#444444').text(`${e.legal_name} · ${e.bank_details}`, left, doc.y + 2, { width });
      doc.text(`Please quote ${d.number || 'the invoice number'} as the payment reference.`, left, doc.y + 2, { width });
    }
    if (d.status === 'void') {
      doc.save().rotate(-30, { origin: [doc.page.width / 2, doc.page.height / 2] });
      doc.font('Helvetica-Bold').fontSize(90).fillColor('#cc0000').opacity(0.15).text('VOID', 0, doc.page.height / 2 - 50, { width: doc.page.width, align: 'center' });
      doc.restore().opacity(1);
    }

    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.page.margins.bottom = 0; // writing inside the bottom margin must not add a page
      const fy = doc.page.height - 36;
      doc.font('Helvetica').fontSize(7.5).fillColor('#888888');
      doc.text('This is a computer-generated invoice and does not require a signature.', left, fy, { width: width * 0.7, lineBreak: false });
      doc.text(`Page ${i - range.start + 1} of ${range.count}`, left + width * 0.7, fy, { width: width * 0.3, align: 'right', lineBreak: false });
    }
    doc.end();
  });
}

/* ------------------------------------------------------------------ */
/* Demo data                                                           */
/* ------------------------------------------------------------------ */
const SEED_MARKER = 'billing_demo_seeded';
/**
 * Three months of invoicing history for every company with a billing profile: the two older
 * months issued and paid; last month issued with a mix of paid, partly paid and overdue invoices;
 * the current month left for "Generate". Deterministic and idempotent (runs once per agency DB).
 */
export function seedBillingDemo() {
  if (agency.get('SELECT 1 FROM agency_settings WHERE key = ?', [SEED_MARKER])) return;
  const profiles = agency.all<any>(`${profileQuery} WHERE p.active = 1 AND c.status != 'offboarded' ORDER BY c.id`);
  const plans: { id: number; date: string; idx: number; age: number }[] = [];
  profiles.forEach((p, idx) => {
    const now = companyToday(p);
    const current = now.slice(0, 7);
    for (const age of [3, 2, 1]) {
      const period = shiftMonth(current, -age);
      if (p.onboarded_at && p.onboarded_at.slice(0, 7) > period) continue;
      const firstNext = shiftMonth(period, 1) + '-01';
      const overdue = age === 1 && idx % 5 === 2;
      const terms = p.payment_terms_days ?? 15;
      // Bill on the 1st of the next month; the "drama" invoices are dated so they are past due today.
      let date = firstNext < now ? firstNext : now;
      if (overdue) date = [firstNext, addDays(now, -(terms + 4))].sort()[0];
      if (date < `${period}-01`) date = `${period}-01`;
      const res = agency.transaction(() => generateOne(p, period, null, date));
      if (res.status === 'created' && res.invoice_id) plans.push({ id: res.invoice_id, date, idx, age });
    }
  });
  plans.sort((a, b) => (a.date === b.date ? a.id - b.id : a.date < b.date ? -1 : 1));
  for (const pl of plans) {
    try { issueInvoice(pl.id, pl.date); } catch { continue; }
    const inv = loadInvoice(pl.id)!;
    const methods = inv.currency === 'INR' ? ['neft', 'rtgs', 'upi'] : inv.currency === 'USD' ? ['ach', 'wire'] : ['bank_transfer', 'wire'];
    const method = methods[pl.idx % methods.length];
    const limit = companyToday(loadProfile(inv.company_id));
    const on = [addDays(pl.date, 5 + (pl.idx % 7)), limit].sort()[0];
    const ref = `${method.toUpperCase()}-${inv.period.replace('-', '')}-${String(inv.company_id).padStart(3, '0')}`;
    if (pl.age >= 2 || pl.idx % 5 === 0 || pl.idx % 5 === 1 || pl.idx % 5 === 3) {
      recordPayment(pl.id, { amount_minor: inv.total_minor, received_on: on, method, reference: ref, idempotency_key: `seed:${pl.id}` });
    } else if (pl.idx % 5 === 4) {
      recordPayment(pl.id, { amount_minor: Math.floor(inv.total_minor / 2), received_on: on, method, reference: ref, idempotency_key: `seed:${pl.id}` });
    }
  }
  agency.run('INSERT INTO agency_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING', [SEED_MARKER, JSON.stringify({ invoices: plans.length }), nowIso()]);
}
