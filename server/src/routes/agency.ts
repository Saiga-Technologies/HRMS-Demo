import { Router, type Request } from 'express';
import crypto from 'node:crypto';
import { agency, all, get, insert, run, companyDb, transaction } from '../db.js';
import { runAsTenant } from '../context.js';
import { requireAgency, hashPassword } from '../auth.js';
import { wrap, badRequest, notFound, forbidden, nowIso, today, addDays, toInt } from '../util.js';
import { companyBySlug, invalidateCompanyCache, agencyCanAccess } from '../tenancy.js';
import { currentCalendar, calendarFor, shiftPeriod } from '../ops/payrollCalendar.js';
import { complianceSummary, filingStatus } from '../ops/compliance.js';
import { syncFilings, srState } from './services.js';
import * as generator from '../seed/generator.js';
import billingRoutes from './billing.js';
import { exponentOf, parseMoney } from '../ops/billing.js';

/**
 * Agency portal API (mounted at /api/agency): the portfolio of client companies with their health,
 * alerts across companies (payroll countdown, filings, SLA, invoices), a combined calendar, company
 * onboarding, agency team management and the cross-company service desk. Agency staff only.
 */
const r = Router();
r.use(requireAgency());

export const COUNTRIES: Record<string, { name: string; currency: string; timezone: string; weekly_offs: number[]; regions: string[] }> = {
  IN: { name: 'India', currency: 'INR', timezone: 'Asia/Kolkata', weekly_offs: [0, 6], regions: ['Karnataka', 'Kerala', 'Maharashtra', 'Tamil Nadu', 'Telangana', 'Delhi', 'Gujarat', 'West Bengal', 'Haryana', 'Uttar Pradesh'] },
  AE: { name: 'United Arab Emirates', currency: 'AED', timezone: 'Asia/Dubai', weekly_offs: [0, 6], regions: ['Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman', 'Ras Al Khaimah'] },
  SA: { name: 'Saudi Arabia', currency: 'SAR', timezone: 'Asia/Riyadh', weekly_offs: [5, 6], regions: ['Riyadh', 'Makkah', 'Eastern Province', 'Madinah'] },
  QA: { name: 'Qatar', currency: 'QAR', timezone: 'Asia/Qatar', weekly_offs: [5, 6], regions: ['Doha', 'Al Rayyan', 'Al Wakrah'] },
  US: { name: 'United States', currency: 'USD', timezone: 'America/New_York', weekly_offs: [0, 6], regions: ['California', 'New York', 'Texas', 'Florida', 'Illinois', 'Washington', 'Massachusetts'] },
};
const US_TZ: Record<string, string> = { California: 'America/Los_Angeles', Washington: 'America/Los_Angeles', Texas: 'America/Chicago', Illinois: 'America/Chicago' };

/** Companies this agency user can see. */
function visibleCompanies(req: Request) {
  const a = req.agencyUser!;
  const rows = agency.all<any>(`SELECT c.*, u.first_name || ' ' || u.last_name AS account_manager_name FROM companies c LEFT JOIN agency_users u ON u.id = c.account_manager_id ORDER BY c.status = 'offboarded', c.name`);
  return rows.filter((c) => agencyCanAccess(a.id, a.role, c.slug));
}
function inCompany<T>(c: { slug: string; timezone: string }, fn: () => T): T {
  companyDb(c.slug);
  return runAsTenant({ slug: c.slug, timezone: c.timezone }, fn);
}

/** Operational snapshot of one company (runs inside its database). */
function snapshot(c: any) {
  return inCompany(c, () => {
    syncFilings();
    const now = today();
    const n = (sql: string, p: any[] = []) => get<any>(sql, p)?.n ?? 0;
    const cal = currentCalendar();
    const lastPaid = get<any>("SELECT period, totals FROM payroll_runs WHERE status = 'paid' ORDER BY period DESC LIMIT 1");
    let lastNet: number | null = null;
    try { lastNet = lastPaid ? JSON.parse(lastPaid.totals || '{}').net ?? null : null; } catch { /* ignore */ }
    const compliance = complianceSummary();
    const sr = all<any>("SELECT status, due_at FROM service_requests WHERE status IN ('open','in_progress','waiting_client')");
    const breached = sr.filter((s) => srState(s).breached).length;
    const data = {
      headcount: n("SELECT COUNT(*) AS n FROM employees WHERE status != 'exited'"),
      joiners_30d: n('SELECT COUNT(*) AS n FROM employees WHERE join_date > ?', [addDays(now, -30)]),
      exits_30d: n("SELECT COUNT(*) AS n FROM employees WHERE exit_date IS NOT NULL AND exit_date > ? AND exit_date <= ?", [addDays(now, -30), now]),
      pending_approvals: n("SELECT (SELECT COUNT(*) FROM leave_requests WHERE status IN ('pending','correction_pending')) + (SELECT COUNT(*) FROM attendance_corrections WHERE status = 'pending') + (SELECT COUNT(*) FROM comp_off_credits WHERE status = 'pending') AS n"),
      documents_expiring: n('SELECT COUNT(*) AS n FROM documents WHERE expiry_date IS NOT NULL AND expiry_date <= ?', [addDays(now, 30)]),
      payroll: { period: cal.period, pay_date: cal.pay_date, stage: cal.stage, status: cal.status, run_status: cal.run?.status ?? null, next: cal.next, milestones: cal.milestones, last_paid_period: lastPaid?.period ?? null, last_net: lastNet },
      compliance,
      requests: { open: sr.length, waiting_client: sr.filter((s) => s.status === 'waiting_client').length, breached },
      currency: c.currency,
    };
    const reasons: string[] = [];
    let health = 'green' as 'green' | 'amber' | 'red';
    const bump = (h: 'amber' | 'red', why: string) => { reasons.push(why); if (h === 'red' || health === 'green') health = h; };
    if (cal.status === 'overdue') bump('red', `${cal.next?.label} overdue`);
    else if (cal.status === 'due_soon' && cal.next) bump('amber', `${cal.next.label} ${cal.next.days_left === 0 ? 'due today' : `in ${cal.next.days_left} day${cal.next.days_left === 1 ? '' : 's'}`}`);
    if (compliance.overdue) bump('red', `${compliance.overdue} filing${compliance.overdue === 1 ? '' : 's'} overdue`);
    else if (compliance.due_3d) bump('amber', `${compliance.due_3d} filing${compliance.due_3d === 1 ? '' : 's'} due within 3 days`);
    if (breached) bump('red', `${breached} request${breached === 1 ? '' : 's'} past SLA`);
    if (data.pending_approvals > 8) bump('amber', `${data.pending_approvals} approvals pending`);
    return { ...data, health, reasons };
  });
}
function billingSummary(companyId: number) {
  const now = today();
  const rows = agency.all<any>("SELECT total_minor, paid_minor, due_date, exponent, currency FROM invoices WHERE company_id = ? AND status = 'issued'", [companyId]);
  return {
    outstanding_minor: rows.reduce((s, i) => s + (i.total_minor - i.paid_minor), 0),
    overdue_minor: rows.filter((i) => i.due_date < now).reduce((s, i) => s + (i.total_minor - i.paid_minor), 0),
    overdue_count: rows.filter((i) => i.due_date < now).length,
  };
}

/* ------------------------------------------------------------------ */
/* Portfolio                                                           */
/* ------------------------------------------------------------------ */
r.get('/companies', (req, res) => {
  if (req.query.light) return res.json(visibleCompanies(req).map((c) => ({ id: c.id, slug: c.slug, name: c.name, country_code: c.country_code, status: c.status, logo_text: c.logo_text, brand_color: c.brand_color, currency: c.currency })));
  const list = visibleCompanies(req).map((c) => {
    const base = { id: c.id, slug: c.slug, name: c.name, legal_name: c.legal_name, country_code: c.country_code, region: c.region, city: c.city, currency: c.currency, timezone: c.timezone, industry: c.industry, status: c.status, logo_text: c.logo_text, brand_color: c.brand_color, account_manager_id: c.account_manager_id, account_manager_name: c.account_manager_name, contact_email: c.contact_email };
    if (c.status === 'offboarded') return { ...base, snapshot: null, billing: billingSummary(c.id) };
    return { ...base, snapshot: snapshot(c), billing: billingSummary(c.id) };
  });
  res.json(list);
});

r.get('/companies/:slug', (req, res) => {
  const c = visibleCompanies(req).find((x) => x.slug === req.params.slug);
  if (!c) throw notFound('Company not found');
  const profile = agency.get<any>('SELECT p.*, e.name AS entity_name, e.tax_label, e.tax_id AS entity_tax_id FROM billing_profiles p JOIN billing_entities e ON e.id = p.entity_id WHERE p.company_id = ?', [c.id]);
  const data = inCompany(c, () => ({
    calendar: { current: currentCalendar(), next: calendarFor(shiftPeriod(currentCalendar().period, 1)) },
    client_users: all<any>("SELECT u.id, u.email, u.role, u.last_login_at, e.first_name, e.last_name FROM users u LEFT JOIN employees e ON e.id = u.employee_id WHERE u.agency_user_id IS NULL AND u.role = 'hr' AND u.active = 1 ORDER BY u.id"),
  }));
  res.json({ ...c, snapshot: snapshot(c), billing: billingSummary(c.id), billing_profile: profile || null, ...data });
});

/** Totals across the portfolio. */
r.get('/summary', (req, res) => {
  const companies = visibleCompanies(req).filter((c) => c.status !== 'offboarded');
  const snaps = companies.map((c) => ({ c, s: snapshot(c) }));
  const byCurrency: Record<string, number> = {};
  for (const { c, s } of snaps) if (s.payroll.last_net) byCurrency[c.currency] = (byCurrency[c.currency] || 0) + s.payroll.last_net;
  res.json({
    companies: companies.length,
    employees: snaps.reduce((a, x) => a + x.s.headcount, 0),
    by_country: Object.entries(snaps.reduce<Record<string, number>>((m, x) => { m[x.c.country_code] = (m[x.c.country_code] || 0) + 1; return m; }, {})).map(([country_code, n]) => ({ country_code, companies: n })),
    health: { green: snaps.filter((x) => x.s.health === 'green').length, amber: snaps.filter((x) => x.s.health === 'amber').length, red: snaps.filter((x) => x.s.health === 'red').length },
    payroll_due_7d: snaps.filter((x) => x.s.payroll.next && x.s.payroll.next.days_left <= 7).length,
    filings_overdue: snaps.reduce((a, x) => a + x.s.compliance.overdue, 0),
    filings_due_7d: snaps.reduce((a, x) => a + x.s.compliance.due_7d, 0),
    requests_open: snaps.reduce((a, x) => a + x.s.requests.open, 0),
    requests_breached: snaps.reduce((a, x) => a + x.s.requests.breached, 0),
    last_payroll_net: byCurrency,
    today: today(),
  });
});

/* ------------------------------------------------------------------ */
/* Alerts (the agency's notification feed)                             */
/* ------------------------------------------------------------------ */
interface Alert { id: string; company_slug: string; company_name: string; kind: 'payroll' | 'compliance' | 'request' | 'invoice' | 'documents'; severity: 'critical' | 'warning' | 'info'; title: string; detail: string; due: string | null; days_left: number | null; link: string }
const daysPhrase = (d: number) => (d < 0 ? `${-d} day${d === -1 ? '' : 's'} overdue` : d === 0 ? 'due today' : `${d} day${d === 1 ? '' : 's'} to go`);

export function alertsFor(c: any): Alert[] {
  const out: Alert[] = [];
  inCompany(c, () => {
    syncFilings();
    const now = today();
    const cal = currentCalendar();
    for (const m of cal.milestones) {
      if (m.done || m.days_left > 7) continue;
      const sev = m.days_left < 0 ? 'critical' : m.days_left <= 3 ? 'warning' : 'info';
      out.push({ id: `${c.slug}:payroll:${cal.period}:${m.key}`, company_slug: c.slug, company_name: c.name, kind: 'payroll', severity: sev, title: `${m.label}: ${daysPhrase(m.days_left)}`, detail: `${cal.period} payroll · pay day ${cal.pay_date} · ${m.owner === 'client' ? 'waiting on the client' : 'agency task'}`, due: m.due, days_left: m.days_left, link: m.key === 'client_approval' || m.key === 'generation' || m.key === 'payment' ? '/payroll?tab=runs' : '/services' });
      break; // only the next open milestone per company
    }
    for (const f of all<any>("SELECT * FROM compliance_filings WHERE status = 'pending' AND due_date <= ? ORDER BY due_date", [addDays(now, 7)])) {
      const left = Math.round((Date.parse(f.due_date) - Date.parse(now)) / 86400000);
      out.push({ id: `${c.slug}:filing:${f.id}`, company_slug: c.slug, company_name: c.name, kind: 'compliance', severity: left < 0 ? 'critical' : left <= 3 ? 'warning' : 'info', title: `${f.name}: ${daysPhrase(left)}`, detail: `${f.authority} · period ${f.period}`, due: f.due_date, days_left: left, link: '/services?tab=compliance' });
    }
    for (const s of all<any>("SELECT * FROM service_requests WHERE status IN ('open','in_progress') ORDER BY due_at")) {
      const st = srState(s);
      if (!st.breached && s.status !== 'open') continue;
      out.push({ id: `${c.slug}:sr:${s.id}`, company_slug: c.slug, company_name: c.name, kind: 'request', severity: st.breached ? 'critical' : s.priority === 'urgent' || s.priority === 'high' ? 'warning' : 'info', title: `${s.number}: ${s.subject}`, detail: st.breached ? `Past SLA (${s.priority})` : `New ${s.category} request from ${s.raised_by_name}`, due: s.due_at?.slice(0, 10) ?? null, days_left: null, link: `/services?tab=requests&id=${s.id}` });
    }
    const expired = get<any>('SELECT COUNT(*) AS n FROM documents WHERE expiry_date IS NOT NULL AND expiry_date < ?', [now])?.n ?? 0;
    if (expired) out.push({ id: `${c.slug}:docs`, company_slug: c.slug, company_name: c.name, kind: 'documents', severity: 'info', title: `${expired} employee document${expired === 1 ? '' : 's'} expired`, detail: 'Visas, IDs or contracts need renewal', due: null, days_left: null, link: '/documents' });
  });
  const now = today();
  for (const i of agency.all<any>("SELECT id, number, due_date, total_minor, paid_minor, exponent, currency FROM invoices WHERE company_id = ? AND status = 'issued' AND due_date < ?", [c.id, now])) {
    const left = Math.round((Date.parse(i.due_date) - Date.parse(now)) / 86400000);
    out.push({ id: `${c.slug}:inv:${i.id}`, company_slug: c.slug, company_name: c.name, kind: 'invoice', severity: left < -15 ? 'critical' : 'warning', title: `Invoice ${i.number}: ${daysPhrase(left)}`, detail: `${(i.total_minor - i.paid_minor) / 10 ** i.exponent} ${i.currency} outstanding`, due: i.due_date, days_left: left, link: '/agency/billing' });
  }
  return out;
}

r.get('/alerts', (req, res) => {
  const rank = { critical: 0, warning: 1, info: 2 };
  const alerts = visibleCompanies(req).filter((c) => c.status === 'active' || c.status === 'onboarding').flatMap(alertsFor)
    .sort((a, b) => rank[a.severity] - rank[b.severity] || (a.days_left ?? 99) - (b.days_left ?? 99));
  res.json({ alerts, counts: { critical: alerts.filter((a) => a.severity === 'critical').length, warning: alerts.filter((a) => a.severity === 'warning').length, info: alerts.filter((a) => a.severity === 'info').length } });
});

/* ------------------------------------------------------------------ */
/* Calendar across companies                                           */
/* ------------------------------------------------------------------ */
r.get('/calendar', (req, res) => {
  const from = String(req.query.from || addDays(today(), -7));
  const to = String(req.query.to || addDays(today(), 35));
  const events: any[] = [];
  for (const c of visibleCompanies(req).filter((x) => x.status !== 'offboarded')) {
    inCompany(c, () => {
      syncFilings();
      const periods = new Set<string>();
      for (let p = from.slice(0, 7); p <= shiftPeriod(to.slice(0, 7), 1); p = shiftPeriod(p, 1)) periods.add(p);
      for (const p of periods) {
        const cal = calendarFor(p);
        for (const m of cal.milestones) if (m.due >= from && m.due <= to) events.push({ date: m.due, company_slug: c.slug, company_name: c.name, brand_color: c.brand_color, kind: 'payroll', key: m.key, title: m.label, detail: `${p} payroll`, owner: m.owner, status: m.status, link: '/services' });
      }
      for (const f of all<any>('SELECT * FROM compliance_filings WHERE due_date BETWEEN ? AND ? ORDER BY due_date', [from, to])) {
        events.push({ date: f.due_date, company_slug: c.slug, company_name: c.name, brand_color: c.brand_color, kind: 'compliance', key: f.code, title: f.name, detail: `${f.authority} · ${f.period}`, owner: 'agency', status: filingStatus(f), link: '/services?tab=compliance' });
      }
    });
    for (const i of agency.all<any>("SELECT id, number, due_date, status FROM invoices WHERE company_id = ? AND status IN ('issued','paid') AND due_date BETWEEN ? AND ?", [c.id, from, to])) {
      events.push({ date: i.due_date, company_slug: c.slug, company_name: c.name, brand_color: c.brand_color, kind: 'invoice', key: 'invoice', title: `Invoice ${i.number} due`, detail: i.status === 'paid' ? 'Paid' : 'Awaiting payment', owner: 'client', status: i.status === 'paid' ? 'done' : i.due_date < today() ? 'overdue' : 'upcoming', link: '/agency/billing' });
    }
  }
  events.sort((a, b) => a.date.localeCompare(b.date) || a.company_name.localeCompare(b.company_name));
  res.json({ from, to, today: today(), events });
});

/* ------------------------------------------------------------------ */
/* Service desk across companies                                       */
/* ------------------------------------------------------------------ */
r.get('/requests', (req, res) => {
  const rows: any[] = [];
  for (const c of visibleCompanies(req).filter((x) => x.status !== 'offboarded')) {
    inCompany(c, () => {
      const where = req.query.status === 'all' ? '' : " WHERE s.status IN ('open','in_progress','waiting_client')";
      for (const s of all<any>(`SELECT s.*, (SELECT COUNT(*) FROM service_request_comments x WHERE x.request_id = s.id) AS comments FROM service_requests s${where}`)) rows.push({ ...srState(s), company_slug: c.slug, company_name: c.name, brand_color: c.brand_color });
    });
  }
  const pr: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
  rows.sort((a, b) => b.breached - a.breached || pr[a.priority] - pr[b.priority] || a.due_at?.localeCompare(b.due_at || '') || 0);
  res.json(rows);
});

/* ------------------------------------------------------------------ */
/* Company onboarding                                                  */
/* ------------------------------------------------------------------ */
r.get('/meta', (_req, res) => {
  res.json({
    countries: Object.entries(COUNTRIES).map(([code, c]) => ({ code, ...c })),
    staff: agency.all<any>("SELECT id, first_name, last_name, role FROM agency_users WHERE active = 1 ORDER BY first_name"),
    entities: agency.all<any>('SELECT id, code, name, country_code, tax_label, tax_id FROM billing_entities ORDER BY id'),
  });
});

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

r.post('/companies', requireAgency('account_manager'), wrap(async (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim();
  if (!name) throw badRequest('Company name is required');
  const country = COUNTRIES[b.country_code];
  if (!country) throw badRequest('Choose a supported country (IN, AE, SA, QA, US)');
  const slug = slugify(b.slug || name);
  if (slug.length < 2) throw badRequest('Choose a longer company code');
  if (agency.get('SELECT 1 FROM companies WHERE slug = ?', [slug])) throw badRequest(`The company code "${slug}" is taken`);
  const admin = b.admin || {};
  const adminEmail = String(admin.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) throw badRequest("A valid email for the client's HR admin is required");
  const region = b.region || country.regions[0];
  const timezone = b.timezone || (b.country_code === 'US' ? US_TZ[region] || 'America/New_York' : country.timezone);
  const weekly_offs = Array.isArray(b.weekly_offs) && b.weekly_offs.length ? b.weekly_offs.map(Number).filter((d: number) => d >= 0 && d <= 6) : country.weekly_offs;
  const pay_day = b.pay_day === 'last_working_day' ? 'last_working_day' : Math.min(28, Math.max(1, Number(b.pay_day) || 28));
  const now = nowIso();
  const amId = toInt(b.account_manager_id) ?? (req.agencyUser!.role === 'account_manager' ? req.agencyUser!.id : null);

  const companyId = agency.insert('companies', {
    slug, name, legal_name: b.legal_name || name, country_code: b.country_code, region, city: b.city || null, currency: country.currency, timezone, industry: b.industry || null,
    status: 'onboarding', account_manager_id: amId, logo_text: (b.logo_text || name[0] || 'C').toUpperCase().slice(0, 2), brand_color: b.brand_color || '#4A8F49',
    contact_name: [admin.first_name, admin.last_name].filter(Boolean).join(' ') || null, contact_email: adminEmail, contact_phone: admin.phone || null, seed_profile: null, onboarded_at: now, created_at: now, updated_at: now,
  });
  invalidateCompanyCache();
  const entityCode = b.country_code === 'IN' ? 'IN' : b.country_code === 'SA' ? 'SA' : b.country_code === 'US' ? 'US' : 'AE';
  const entity = agency.get<any>('SELECT id FROM billing_entities WHERE code = ?', [entityCode]);
  const scheme = b.country_code === 'IN' ? 'IN_GST' : b.country_code === 'AE' ? 'AE_VAT' : b.country_code === 'QA' ? 'AE_EXPORT' : b.country_code === 'SA' ? 'SA_VAT' : 'US_NONE';
  const bill = b.billing || {};
  const exp = exponentOf(country.currency);
  const minor = (v: any, dflt: number) => (v === undefined || v === '' || v === null ? dflt : parseMoney(v, exp));
  if (entity) agency.insert('billing_profiles', {
    company_id: companyId, entity_id: entity.id, plan_name: bill.plan_name || 'Payroll + HR', currency: country.currency,
    pepm_minor: minor(bill.pepm, 0), payroll_run_minor: minor(bill.payroll_run, 0), min_monthly_minor: minor(bill.min_monthly, 0), setup_fee_minor: minor(bill.setup_fee, 0), setup_fee_billed: 0,
    tax_scheme: scheme, place_of_supply: region, place_of_supply_code: bill.place_of_supply_code || null, client_tax_id: bill.client_tax_id || null, sac_code: entityCode === 'IN' ? '998519' : null,
    payment_terms_days: toInt(bill.payment_terms_days) ?? 15, billing_email: bill.billing_email || adminEmail, billing_contact: bill.billing_contact || null, billing_address: bill.billing_address || null, active: 1, updated_at: now,
  });

  const temporary_password = `Welcome-${crypto.randomBytes(4).toString('hex')}`;
  const created = inCompany({ slug, timezone }, () => {
    const apply = (generator as any).applyCountryTemplate;
    if (typeof apply === 'function') {
      apply({ country_code: b.country_code, region, name, legal_name: b.legal_name || name, currency: country.currency, timezone, weekly_offs, pay_day, city: b.city, brand_color: b.brand_color, logo_text: b.logo_text });
    }
    return transaction(() => {
      run("INSERT INTO settings (key, value, updated_at) VALUES ('payroll', ?, ?) ON CONFLICT(key) DO UPDATE SET value = json_set(value, '$.period_lock', json('true'), '$.client_approval_required', json('true')), updated_at = excluded.updated_at",
        [JSON.stringify({ period_lock: true, client_approval_required: true, pay_day }), now]);
      const hrDept = get<any>("SELECT id FROM departments WHERE name LIKE '%Human%' OR name LIKE '%HR%' ORDER BY id LIMIT 1")?.id ?? null;
      const empId = insert('employees', { employee_code: 'HR001', first_name: admin.first_name || 'HR', last_name: admin.last_name || 'Admin', email: adminEmail, phone: admin.phone || null, department_id: hrDept, join_date: today(), employment_type: 'full_time', status: 'active', country: country.name, custom_fields: {}, created_at: now, updated_at: now });
      insert('users', { email: adminEmail, password_hash: hashPassword(temporary_password), role: 'hr', employee_id: empId, active: 1, must_change_password: 1, created_at: now });
      return { employee_id: empId };
    });
  });
  inCompany({ slug, timezone }, () => syncFilings());
  agency.insert('agency_audit', { agency_user_id: req.agencyUser!.id, company_slug: slug, action: 'create', entity: 'company', entity_id: String(companyId), details: JSON.stringify({ name, country: b.country_code }), created_at: now });
  res.status(201).json({ slug, id: companyId, admin_email: adminEmail, temporary_password, employee_id: created.employee_id, template_applied: typeof (generator as any).applyCountryTemplate === 'function' });
}));

r.put('/companies/:slug', requireAgency('account_manager'), wrap(async (req, res) => {
  const c = visibleCompanies(req).find((x) => x.slug === req.params.slug);
  if (!c) throw notFound('Company not found');
  const b = req.body || {};
  const data: any = { updated_at: nowIso() };
  for (const k of ['name', 'legal_name', 'industry', 'contact_name', 'contact_email', 'contact_phone', 'brand_color', 'logo_text', 'city']) if (b[k] !== undefined) data[k] = b[k] === '' ? null : String(b[k]).slice(0, 200);
  if (b.status !== undefined) {
    if (!['onboarding', 'active', 'suspended', 'offboarded'].includes(b.status)) throw badRequest('Invalid status');
    data.status = b.status;
  }
  if (b.account_manager_id !== undefined) {
    if (!['owner', 'admin'].includes(req.agencyUser!.role)) throw forbidden('Only agency admins reassign account managers');
    data.account_manager_id = toInt(b.account_manager_id) ?? null;
  }
  agency.update('companies', c.id, data);
  invalidateCompanyCache();
  agency.insert('agency_audit', { agency_user_id: req.agencyUser!.id, company_slug: c.slug, action: 'update', entity: 'company', entity_id: String(c.id), details: JSON.stringify(Object.keys(data)), created_at: nowIso() });
  res.json(agency.get('SELECT * FROM companies WHERE id = ?', [c.id]));
}));

/* ------------------------------------------------------------------ */
/* Agency team                                                         */
/* ------------------------------------------------------------------ */
function teamRows() {
  const users = agency.all<any>('SELECT id, email, first_name, last_name, role, phone, active, last_login_at, created_at FROM agency_users ORDER BY active DESC, role, first_name');
  const assign = agency.all<any>('SELECT agency_user_id, company_id FROM agency_user_companies');
  const managed = agency.all<any>('SELECT id, account_manager_id FROM companies');
  return users.map((u) => ({ ...u, company_ids: [...new Set([...assign.filter((a) => a.agency_user_id === u.id).map((a) => a.company_id), ...managed.filter((m) => m.account_manager_id === u.id).map((m) => m.id)])], all_companies: ['owner', 'admin'].includes(u.role) }));
}
r.get('/team', (_req, res) => res.json(teamRows()));
r.post('/team', requireAgency(), wrap(async (req, res) => {
  if (!['owner', 'admin'].includes(req.agencyUser!.role)) throw forbidden('Only agency admins manage the team');
  const b = req.body || {};
  const email = String(b.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw badRequest('A valid email is required');
  if (!['admin', 'account_manager', 'payroll', 'recruiter'].includes(b.role)) throw badRequest('Choose a role');
  if (agency.get('SELECT 1 FROM agency_users WHERE email = ?', [email])) throw badRequest('That email is already on the team');
  const temporary_password = `Welcome-${crypto.randomBytes(4).toString('hex')}`;
  const id = agency.insert('agency_users', { email, password_hash: hashPassword(temporary_password), first_name: String(b.first_name || '').trim() || email.split('@')[0], last_name: String(b.last_name || '').trim(), role: b.role, phone: b.phone || null, active: 1, created_at: nowIso() });
  for (const cid of Array.isArray(b.company_ids) ? b.company_ids : []) agency.run('INSERT OR IGNORE INTO agency_user_companies (agency_user_id, company_id) VALUES (?, ?)', [id, Number(cid)]);
  res.status(201).json({ ...teamRows().find((u) => u.id === id), temporary_password });
}));
r.put('/team/:id', requireAgency(), wrap(async (req, res) => {
  if (!['owner', 'admin'].includes(req.agencyUser!.role)) throw forbidden('Only agency admins manage the team');
  const id = toInt(req.params.id)!;
  const u = agency.get<any>('SELECT * FROM agency_users WHERE id = ?', [id]);
  if (!u) throw notFound('Team member not found');
  const b = req.body || {};
  if (u.role === 'owner' && (b.role && b.role !== 'owner' || b.active === false)) throw badRequest('The owner account cannot be demoted or deactivated');
  const data: any = {};
  if (b.role !== undefined && u.role !== 'owner') { if (!['admin', 'account_manager', 'payroll', 'recruiter'].includes(b.role)) throw badRequest('Invalid role'); data.role = b.role; }
  if (b.active !== undefined) data.active = b.active ? 1 : 0;
  for (const k of ['first_name', 'last_name', 'phone']) if (b[k] !== undefined) data[k] = String(b[k]).slice(0, 80);
  if (Object.keys(data).length) agency.update('agency_users', id, data);
  if (Array.isArray(b.company_ids)) {
    agency.run('DELETE FROM agency_user_companies WHERE agency_user_id = ?', [id]);
    for (const cid of b.company_ids) agency.run('INSERT OR IGNORE INTO agency_user_companies (agency_user_id, company_id) VALUES (?, ?)', [id, Number(cid)]);
  }
  res.json(teamRows().find((x) => x.id === id));
}));

/* ------------------------------------------------------------------ */
/* Billing (invoices, payments, profiles)                              */
/* ------------------------------------------------------------------ */
r.use('/billing', billingRoutes);

export { companyBySlug };
export default r;
