import { all, get, run } from '../db.js';
import { today, addDays, nowIso } from '../util.js';

/**
 * Statutory compliance calendar. Each country has rules that produce one filing per period with a
 * due date; `ensureFilings` materialises them (idempotently) for a rolling window so the agency can
 * track status, reference numbers and receipts per company.
 *
 * Due dates follow the usual statutory calendar but are DEMO MASTER DATA: authorities move them
 * (extensions, holiday shifts, state variations) — confirm before relying on them for a client.
 */
export interface Rule {
  code: string;
  name: string;
  authority: string;
  frequency: 'monthly' | 'quarterly' | 'half_yearly' | 'annual';
  /** Periods (and due dates) whose due date falls in [from, to]. */
  periods: (from: string, to: string) => { period: string; due: string }[];
  applies?: (ctx: { country: string; region?: string | null }) => boolean;
  description: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1-based
const ymd = (y: number, m: number, d: number) => {
  while (m > 12) { m -= 12; y += 1; }
  return `${y}-${pad(m)}-${pad(Math.min(d, lastDay(y, m)))}`;
};
/** Months touched by [from, to] padded by `extra` months either side. */
function months(from: string, to: string, extra = 2) {
  const out: { y: number; m: number }[] = [];
  let y = Number(from.slice(0, 4)), m = Number(from.slice(5, 7)) - extra;
  while (m < 1) { m += 12; y -= 1; }
  const endKey = Number(to.slice(0, 4)) * 12 + Number(to.slice(5, 7)) + extra;
  while (y * 12 + m <= endKey) { out.push({ y, m }); m++; if (m > 12) { m = 1; y++; } }
  return out;
}
const inRange = (from: string, to: string) => (p: { due: string }) => p.due >= from && p.due <= to;

/** Monthly filing for month M due on `day` of month M+1 (or the last day of M+1 when day = 31). */
const monthly = (day: number) => (from: string, to: string) =>
  months(from, to).map(({ y, m }) => ({ period: `${y}-${pad(m)}`, due: ymd(y, m + 1, day) })).filter(inRange(from, to));
/** Quarterly (calendar quarters) due `day` of the month after the quarter (31 = last day). */
const quarterly = (day: number, fy = false) => (from: string, to: string) => {
  const out: { period: string; due: string }[] = [];
  for (const { y, m } of months(from, to, 4)) {
    if (![3, 6, 9, 12].includes(m)) continue;
    const q = fy ? ({ 6: 1, 9: 2, 12: 3, 3: 4 } as any)[m] : m / 3;
    const label = fy ? `FY${m === 3 ? y - 1 : y}-${String((m === 3 ? y : y + 1) % 100).padStart(2, '0')}-Q${q}` : `${y}-Q${q}`;
    out.push({ period: label, due: fy && m === 3 ? ymd(y, 5, 31) : ymd(y, m + 1, day) });
  }
  return out.filter(inRange(from, to));
};
/** Fixed annual date (month/day) with a period label. */
const annual = (month: number, day: number, label: (y: number) => string) => (from: string, to: string) => {
  const out: { period: string; due: string }[] = [];
  for (let y = Number(from.slice(0, 4)) - 1; y <= Number(to.slice(0, 4)) + 1; y++) out.push({ period: label(y), due: ymd(y, month, day) });
  return out.filter(inRange(from, to));
};
/** Two fixed dates a year. */
const halfYearly = (a: [number, number], b: [number, number]) => (from: string, to: string) => {
  const out: { period: string; due: string }[] = [];
  for (let y = Number(from.slice(0, 4)) - 1; y <= Number(to.slice(0, 4)) + 1; y++) {
    out.push({ period: `${y}-H1`, due: ymd(y, a[0], a[1]) });
    out.push({ period: `${y}-H2`, due: b[0] < a[0] ? ymd(y + 1, b[0], b[1]) : ymd(y, b[0], b[1]) });
  }
  return out.filter(inRange(from, to));
};

const IN_PT_DAY: Record<string, number> = { Maharashtra: 31, Karnataka: 20, Telangana: 10, 'Tamil Nadu': 31, 'West Bengal': 21 };

export const RULES: Record<string, Rule[]> = {
  IN: [
    { code: 'IN_PF_ECR', name: 'PF ECR & contribution', authority: 'EPFO', frequency: 'monthly', periods: monthly(15), description: 'Electronic challan-cum-return and payment of employee + employer PF.' },
    { code: 'IN_ESI', name: 'ESI contribution', authority: 'ESIC', frequency: 'monthly', periods: monthly(15), description: 'Employee (0.75%) and employer (3.25%) ESI for covered employees.' },
    { code: 'IN_TDS', name: 'TDS deposit on salaries', authority: 'Income Tax Department', frequency: 'monthly', description: 'Tax deducted from salaries, deposited by the 7th (March: 30 April).',
      periods: (from, to) => months(from, to).map(({ y, m }) => ({ period: `${y}-${pad(m)}`, due: m === 3 ? ymd(y, 4, 30) : ymd(y, m + 1, 7) })).filter(inRange(from, to)) },
    { code: 'IN_PT', name: 'Professional tax', authority: 'State tax department', frequency: 'monthly', applies: (c) => !!c.region && c.region !== 'Kerala', description: 'State professional tax deducted from salaries.',
      periods: (from, to) => monthly(31)(from, to) },
    { code: 'IN_PT_KL', name: 'Professional tax (half-yearly)', authority: 'Local body (Kerala)', frequency: 'half_yearly', applies: (c) => c.region === 'Kerala', periods: halfYearly([8, 31], [2, 28]), description: 'Kerala professional tax is collected half-yearly by the local body.' },
    { code: 'IN_24Q', name: 'TDS return (Form 24Q)', authority: 'Income Tax Department', frequency: 'quarterly', periods: quarterly(31, true), description: 'Quarterly statement of tax deducted from salaries.' },
    { code: 'IN_FORM16', name: 'Form 16 to employees', authority: 'Income Tax Department', frequency: 'annual', periods: annual(6, 15, (y) => `FY${y - 1}-${String(y % 100).padStart(2, '0')}`), description: 'Annual TDS certificates issued to every employee.' },
    { code: 'IN_LWF', name: 'Labour Welfare Fund', authority: 'Labour Welfare Board', frequency: 'half_yearly', applies: (c) => c.region === 'Maharashtra', periods: halfYearly([7, 15], [1, 15]), description: 'Employee and employer LWF contribution (Maharashtra: June and December).' },
  ],
  AE: [
    { code: 'AE_WPS', name: 'WPS salary file (SIF)', authority: 'MOHRE', frequency: 'monthly', periods: monthly(15), description: 'Salaries paid through the Wage Protection System; late payment blocks new work permits.' },
    { code: 'AE_GPSSA', name: 'GPSSA pension (UAE nationals)', authority: 'GPSSA', frequency: 'monthly', periods: monthly(10), description: 'Pension contributions for Emirati employees.' },
    { code: 'AE_EMIRATISATION', name: 'Emiratisation progress', authority: 'MOHRE', frequency: 'half_yearly', periods: halfYearly([7, 1], [1, 1]), description: 'Half-yearly Emiratisation target check for companies with 50+ skilled staff.' },
  ],
  SA: [
    { code: 'SA_GOSI', name: 'GOSI contributions', authority: 'GOSI', frequency: 'monthly', periods: monthly(15), description: 'Social insurance for Saudi nationals and occupational hazard cover for all staff.' },
    { code: 'SA_MUDAD', name: 'Mudad WPS salary file', authority: 'Mudad / HRSD', frequency: 'monthly', periods: monthly(10), description: 'Monthly wage protection upload; required for Nitaqat compliance.' },
    { code: 'SA_NITAQAT', name: 'Nitaqat / Qiwa Saudisation review', authority: 'HRSD (Qiwa)', frequency: 'quarterly', periods: quarterly(15), description: 'Quarterly check of the Saudisation band and contract authentication on Qiwa.' },
  ],
  QA: [
    { code: 'QA_WPS', name: 'WPS salary transfer', authority: 'Ministry of Labour', frequency: 'monthly', periods: monthly(7), description: 'Salaries must reach employees through WPS within 7 days of the due date.' },
    { code: 'QA_GRSIA', name: 'Social insurance (Qatari nationals)', authority: 'GRSIA', frequency: 'monthly', periods: monthly(15), description: 'Pension contributions for Qatari employees.' },
  ],
  US: [
    { code: 'US_941_DEP', name: 'Federal tax deposit (monthly depositor)', authority: 'IRS (EFTPS)', frequency: 'monthly', periods: monthly(15), description: 'Federal income tax withheld plus Social Security and Medicare.' },
    { code: 'US_941', name: 'Form 941 quarterly return', authority: 'IRS', frequency: 'quarterly', periods: quarterly(31), description: "Employer's quarterly federal tax return." },
    { code: 'US_SIT', name: 'State withholding deposit', authority: 'State tax agency', frequency: 'monthly', applies: (c) => c.region !== 'Texas', periods: monthly(15), description: 'State income tax withheld (CA EDD / NY DTF).' },
    { code: 'US_SUI', name: 'State unemployment (SUI) wage report', authority: 'State workforce agency', frequency: 'quarterly', periods: quarterly(31), description: 'Quarterly wage report and SUI contribution (CA DE 9, NY NYS-45, TX TWC).' },
    { code: 'US_W2', name: 'W-2 / W-3 filing', authority: 'SSA', frequency: 'annual', periods: annual(1, 31, (y) => String(y - 1)), description: 'Annual wage statements to employees and the SSA.' },
    { code: 'US_940', name: 'Form 940 (FUTA)', authority: 'IRS', frequency: 'annual', periods: annual(1, 31, (y) => String(y - 1)), description: 'Annual federal unemployment tax return.' },
  ],
};

/** Deterministic 0..n-1 from a string (demo variety without randomness). */
const pick = (s: string, n: number) => { let h = 2166136261; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return Math.abs(h) % n; };

/**
 * Create missing filings for the window [today − 120 days, today + 75 days]. For demo companies,
 * filings whose due date has passed are recorded as filed (mostly on time; a few left overdue so the
 * calendar has something to chase).
 */
export function ensureFilings(ctx: { country: string; region?: string | null; slug: string; demo: boolean; since?: string | null }) {
  const rules = (RULES[ctx.country] || []).filter((r) => !r.applies || r.applies(ctx));
  const now = today();
  const from = addDays(now, -120);
  const to = addDays(now, 75);
  const existing = new Set(all<any>('SELECT code || \'|\' || period AS k FROM compliance_filings').map((r) => r.k));
  for (const rule of rules) {
    for (const p of rule.periods(from, to)) {
      if (existing.has(`${rule.code}|${p.period}`)) continue;
      // Filings due before the agency took the company on are not the agency's to chase.
      if (ctx.since && p.due < ctx.since) continue;
      let status = 'pending', filed_at: string | null = null, reference: string | null = null, filed_by_name: string | null = null;
      if (ctx.demo && (p.due < now || (p.due === now && pick(`${ctx.slug}|${rule.code}`, 3) !== 0))) {
        const overdue = p.due < now && pick(`${ctx.slug}|${rule.code}|${p.period}`, 9) === 0 && p.due >= addDays(now, -20);
        if (!overdue) {
          status = 'filed';
          filed_at = `${addDays(p.due, -1 - pick(rule.code + p.period, 4))}T10:30:00.000Z`;
          reference = `${rule.code.split('_')[1] || rule.code}-${p.period.replace(/[^0-9A-Z]/gi, '')}-${1000 + pick(ctx.slug + p.period, 9000)}`;
          filed_by_name = 'Agency payroll team';
        }
      }
      run(`INSERT OR IGNORE INTO compliance_filings (code, name, authority, frequency, period, due_date, status, reference, filed_at, filed_by_name, notes, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [rule.code, rule.name, rule.authority, rule.frequency, p.period, p.due, status, reference, filed_at, filed_by_name, null, nowIso()]);
    }
  }
}

export function filingStatus(f: { status: string; due_date: string }, now = today()) {
  if (f.status !== 'pending') return f.status;
  const left = Math.round((Date.parse(f.due_date) - Date.parse(now)) / 86400000);
  return left < 0 ? 'overdue' : left <= 7 ? 'due_soon' : 'upcoming';
}
export function ruleFor(code: string): Rule | undefined {
  for (const list of Object.values(RULES)) { const r = list.find((x) => x.code === code); if (r) return r; }
  return undefined;
}
export function complianceSummary() {
  const now = today();
  const rows = all<any>("SELECT status, due_date FROM compliance_filings WHERE status = 'pending'");
  return {
    overdue: rows.filter((r) => r.due_date < now).length,
    due_7d: rows.filter((r) => r.due_date >= now && r.due_date <= addDays(now, 7)).length,
    due_3d: rows.filter((r) => r.due_date >= now && r.due_date <= addDays(now, 3)).length,
    next: get<any>("SELECT code, name, period, due_date FROM compliance_filings WHERE status = 'pending' AND due_date >= ? ORDER BY due_date LIMIT 1", [now]) || null,
  };
}
