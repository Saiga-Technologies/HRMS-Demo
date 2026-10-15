import { Router, type Request } from 'express';
import { agency } from '../db.js';
import { agencyCanAccess } from '../tenancy.js';
import { wrap, badRequest, notFound, forbidden, nowIso, today, toInt } from '../util.js';
import {
  generateInvoices, updateDraft, issueInvoice, voidInvoice, recordPayment, invoiceDetail, invoiceRow, invoiceListQuery,
  buildInvoicePdf, invoiceFileName, loadInvoice, loadProfile, exponentOf, parseMoney, isPeriod, shiftMonth, GST_STATE_CODES, PAYMENT_METHODS, clientTaxLabel,
} from '../ops/billing.js';

/**
 * Agency billing (mounted at /api/agency/billing, agency staff only): overview, invoices
 * (generate → draft edits → issue → payments / void), the invoice PDF and billing profiles.
 * Everyone sees the companies they are assigned to; mutations are for owner / admin /
 * account managers of the company.
 */
const r = Router();
const MUTATORS = ['owner', 'admin', 'account_manager'];

function visibleCompanyIds(req: Request): Map<number, any> {
  const a = req.agencyUser!;
  const rows = agency.all<any>('SELECT id, slug, name, country_code, currency, brand_color, logo_text, status FROM companies ORDER BY name');
  return new Map(rows.filter((c) => agencyCanAccess(a.id, a.role, c.slug)).map((c) => [c.id, c]));
}
function canSee(req: Request, companyId: number) {
  const c = agency.get<any>('SELECT slug FROM companies WHERE id = ?', [companyId]);
  return !!c && agencyCanAccess(req.agencyUser!.id, req.agencyUser!.role, c.slug);
}
function assertCanMutate(req: Request, companyId: number) {
  if (!MUTATORS.includes(req.agencyUser!.role)) throw forbidden('Only owners, admins and account managers can change billing');
  if (!canSee(req, companyId)) throw forbidden('You are not assigned to this company');
}
function invoiceFor(req: Request) {
  const inv = loadInvoice(toInt(req.params.id) ?? -1);
  if (!inv || !canSee(req, inv.company_id)) throw notFound('Invoice not found');
  return inv;
}
function auditAgency(req: Request, action: string, entity: string, entityId: any, details?: any) {
  try {
    const slug = details?.company_slug ?? null;
    agency.insert('agency_audit', { agency_user_id: req.agencyUser!.id, company_slug: slug, action, entity, entity_id: entityId == null ? null : String(entityId), details: details ? JSON.stringify(details) : null, created_at: nowIso() });
  } catch { /* never break a request */ }
}
const marketOf = (country: string) => (country === 'IN' ? 'IN' : country === 'US' ? 'US' : 'GCC');

/* ------------------------------------------------------------------ */
/* Overview                                                            */
/* ------------------------------------------------------------------ */
r.get('/overview', (req, res) => {
  const visible = visibleCompanyIds(req);
  const now = today();
  const month = now.slice(0, 7);
  const rows = agency.all<any>(`${invoiceListQuery} WHERE i.status != 'void'`).filter((i) => visible.has(i.company_id)).map((i) => invoiceRow(i, now));
  type Totals = { currency: string; exponent: number; invoiced_month_minor: number; outstanding_minor: number; overdue_minor: number; overdue_count: number; outstanding_count: number; collected_month_minor: number; aging: { key: string; label: string; amount_minor: number; count: number }[] };
  const by: Record<string, Totals> = {};
  const bucket = (days: number) => (days <= 30 ? 0 : days <= 60 ? 1 : days <= 90 ? 2 : 3);
  const AGING = [['0_30', '0–30 days'], ['31_60', '31–60 days'], ['61_90', '61–90 days'], ['90_plus', '90+ days']];
  const t = (cur: string, exp: number) => (by[cur] ||= { currency: cur, exponent: exp, invoiced_month_minor: 0, outstanding_minor: 0, overdue_minor: 0, overdue_count: 0, outstanding_count: 0, collected_month_minor: 0, aging: AGING.map(([key, label]) => ({ key, label, amount_minor: 0, count: 0 })) });
  for (const i of rows) {
    if (i.status === 'draft') continue;
    const x = t(i.currency, i.exponent);
    if (i.issue_date?.startsWith(month)) x.invoiced_month_minor += i.total_minor;
    if (i.status === 'issued') {
      x.outstanding_minor += i.outstanding_minor;
      x.outstanding_count++;
      if (i.overdue) { x.overdue_minor += i.outstanding_minor; x.overdue_count++; }
      // Aging by invoice age (days since the invoice date).
      const age = Math.max(0, Math.round((Date.parse(now) - Date.parse(i.issue_date)) / 86400000));
      const b = x.aging[bucket(age)];
      b.amount_minor += i.outstanding_minor;
      b.count++;
    }
  }
  const visibleIds = [...visible.keys()];
  if (visibleIds.length) {
    const pays = agency.all<any>(`SELECT p.amount_minor, i.currency, i.exponent, i.company_id FROM payments p JOIN invoices i ON i.id = p.invoice_id WHERE p.received_on LIKE ?`, [`${month}%`]);
    for (const p of pays) if (visible.has(p.company_id)) t(p.currency, p.exponent).collected_month_minor += p.amount_minor;
  }
  // Top overdue clients (per company, in its own currency).
  const overdueBy = new Map<number, any>();
  for (const i of rows.filter((x) => x.overdue)) {
    const o = overdueBy.get(i.company_id) || { company_id: i.company_id, company_slug: i.company_slug, company_name: i.company_name, brand_color: i.brand_color, logo_text: i.logo_text, currency: i.currency, exponent: i.exponent, overdue_minor: 0, count: 0, oldest_due: i.due_date, max_days: 0 };
    o.overdue_minor += i.outstanding_minor;
    o.count++;
    if (i.due_date < o.oldest_due) o.oldest_due = i.due_date;
    o.max_days = Math.max(o.max_days, i.days_overdue);
    overdueBy.set(i.company_id, o);
  }
  // Companies with a billing profile but no invoice for this month yet.
  const profiles = agency.all<any>('SELECT company_id FROM billing_profiles WHERE active = 1').filter((p) => visible.has(p.company_id) && visible.get(p.company_id).status !== 'offboarded');
  const have = new Set(rows.filter((i) => i.period === month).map((i) => i.company_id));
  res.json({
    today: now,
    period: month,
    totals: Object.values(by).sort((a, b) => a.currency.localeCompare(b.currency)),
    top_overdue: [...overdueBy.values()].sort((a, b) => b.max_days - a.max_days || b.overdue_minor - a.overdue_minor).slice(0, 8),
    counts: {
      drafts: rows.filter((i) => i.status === 'draft').length,
      overdue: rows.filter((i) => i.overdue).length,
      issued: rows.filter((i) => i.status === 'issued').length,
      missing_this_month: profiles.filter((p) => !have.has(p.company_id)).length,
    },
    can_edit: MUTATORS.includes(req.agencyUser!.role),
  });
});

/* ------------------------------------------------------------------ */
/* Invoices                                                            */
/* ------------------------------------------------------------------ */
r.get('/invoices', (req, res) => {
  const visible = visibleCompanyIds(req);
  const where: string[] = [];
  const params: any[] = [];
  const status = String(req.query.status || '');
  if (['draft', 'issued', 'paid', 'void'].includes(status)) { where.push('i.status = ?'); params.push(status); }
  if (status === 'overdue' || status === 'outstanding') where.push("i.status = 'issued'");
  if (req.query.company) { where.push('c.slug = ?'); params.push(String(req.query.company)); }
  if (req.query.period) { where.push('i.period = ?'); params.push(String(req.query.period)); }
  const now = today();
  let rows = agency.all<any>(`${invoiceListQuery}${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY i.period DESC, CASE i.status WHEN 'draft' THEN 0 WHEN 'issued' THEN 1 WHEN 'paid' THEN 2 ELSE 3 END, c.name`, params)
    .filter((i) => visible.has(i.company_id))
    .map((i) => invoiceRow(i, now));
  if (status === 'overdue') rows = rows.filter((i) => i.overdue);
  const market = String(req.query.market || '');
  if (market) rows = rows.filter((i) => marketOf(i.country_code) === market);
  res.json(rows);
});

r.get('/invoices/:id', (req, res) => {
  const inv = invoiceFor(req);
  res.json({ ...invoiceDetail(inv.id), can_edit: MUTATORS.includes(req.agencyUser!.role) });
});

r.post('/invoices/generate', wrap(async (req, res) => {
  const period = String(req.body?.period || '');
  if (!isPeriod(period)) throw badRequest('period must be YYYY-MM');
  if (period > shiftMonth(today().slice(0, 7), 1)) throw badRequest('You can only bill up to next month');
  if (!MUTATORS.includes(req.agencyUser!.role)) throw forbidden('Only owners, admins and account managers can generate invoices');
  const visible = visibleCompanyIds(req);
  let ids = [...visible.keys()];
  if (Array.isArray(req.body?.company_slugs) && req.body.company_slugs.length) {
    const slugs = new Set(req.body.company_slugs.map(String));
    ids = [...visible.values()].filter((c) => slugs.has(c.slug)).map((c) => c.id);
    if (!ids.length) throw notFound('None of those companies are yours');
  }
  const out = generateInvoices(period, { companyIds: ids, actorId: req.agencyUser!.id });
  auditAgency(req, 'generate', 'invoices', period, { created: out.created.length, skipped: out.skipped.length });
  res.status(out.created.length ? 201 : 200).json(out);
}));

r.put('/invoices/:id', wrap(async (req, res) => {
  const inv = invoiceFor(req);
  assertCanMutate(req, inv.company_id);
  const b = req.body || {};
  const add = Array.isArray(b.add_lines) ? b.add_lines : b.add_line ? [b.add_line] : [];
  const remove = (Array.isArray(b.remove_line_ids) ? b.remove_line_ids : b.remove_line_id ? [b.remove_line_id] : []).map((x: any) => toInt(x)!).filter(Boolean);
  const out = updateDraft(inv.id, { notes: b.notes, add_lines: add, remove_line_ids: remove });
  auditAgency(req, 'update', 'invoice', inv.id, { company_slug: out.company_slug, added: add.length, removed: remove.length });
  res.json(out);
}));

r.post('/invoices/:id/issue', wrap(async (req, res) => {
  const inv = invoiceFor(req);
  assertCanMutate(req, inv.company_id);
  const out = issueInvoice(inv.id);
  auditAgency(req, 'issue', 'invoice', inv.id, { company_slug: out.company_slug, number: out.number, total_minor: out.total_minor });
  res.json(out);
}));

r.post('/invoices/:id/void', wrap(async (req, res) => {
  const inv = invoiceFor(req);
  assertCanMutate(req, inv.company_id);
  const out = voidInvoice(inv.id, String(req.body?.reason || ''));
  auditAgency(req, 'void', 'invoice', inv.id, { company_slug: out.company_slug, number: out.number, reason: out.void_reason });
  res.json(out);
}));

r.post('/invoices/:id/payments', wrap(async (req, res) => {
  const inv = invoiceFor(req);
  assertCanMutate(req, inv.company_id);
  const b = req.body || {};
  const key = String(req.headers['idempotency-key'] || b.idempotency_key || '');
  const out = recordPayment(inv.id, { amount_minor: b.amount_minor, amount: b.amount, received_on: b.received_on || b.date, method: b.method, reference: b.reference, idempotency_key: key }, req.agencyUser!.id);
  if (!out.replayed) auditAgency(req, 'payment', 'invoice', inv.id, { amount_minor: out.payment.amount_minor, payment_id: out.payment.id });
  res.status(out.replayed ? 200 : 201).json({ payment: out.payment, replayed: out.replayed, invoice: invoiceDetail(inv.id) });
}));

r.get('/invoices/:id/pdf', wrap(async (req, res) => {
  const inv = invoiceFor(req);
  const pdf = await buildInvoicePdf(inv.id);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${req.query.download === '1' ? 'attachment' : 'inline'}; filename="${invoiceFileName(inv)}"`);
  res.send(pdf);
}));

/* ------------------------------------------------------------------ */
/* Billing profiles (pricing)                                          */
/* ------------------------------------------------------------------ */
const profileList = `SELECT p.*, c.slug AS company_slug, c.name AS company_name, c.country_code, c.region, c.brand_color, c.logo_text, c.status AS company_status,
                            e.code AS entity_code, e.name AS entity_name, e.tax_label AS entity_tax_label, e.tax_id AS entity_tax_id
                     FROM billing_profiles p JOIN companies c ON c.id = p.company_id JOIN billing_entities e ON e.id = p.entity_id`;
const profileOut = (p: any) => ({ ...p, exponent: exponentOf(p.currency), client_tax_label: clientTaxLabel(p.country_code) });

r.get('/profiles', (req, res) => {
  const visible = visibleCompanyIds(req);
  res.json({
    profiles: agency.all<any>(`${profileList} ORDER BY c.name`).filter((p) => visible.has(p.company_id)).map(profileOut),
    gst_states: Object.entries(GST_STATE_CODES).map(([name, code]) => ({ name, code })),
    payment_methods: PAYMENT_METHODS,
    can_edit: MUTATORS.includes(req.agencyUser!.role),
  });
});

r.put('/profiles/:companyId', wrap(async (req, res) => {
  const companyId = toInt(req.params.companyId) ?? -1;
  const p = loadProfile(companyId);
  if (!p || !canSee(req, companyId)) throw notFound('Billing profile not found');
  assertCanMutate(req, companyId);
  const b = req.body || {};
  const exp = exponentOf(p.currency);
  const data: Record<string, any> = { updated_at: nowIso() };
  const money = (minorKey: string, majorKey: string) => {
    if (b[minorKey] !== undefined && b[minorKey] !== '') {
      const v = Number(b[minorKey]);
      if (!Number.isSafeInteger(v) || v < 0) throw badRequest(`${majorKey} must be a non-negative amount`);
      data[minorKey] = v;
    } else if (b[majorKey] !== undefined && b[majorKey] !== '') {
      const v = parseMoney(b[majorKey], exp);
      if (v < 0) throw badRequest(`${majorKey} must be a non-negative amount`);
      data[minorKey] = v;
    }
  };
  money('pepm_minor', 'pepm');
  money('payroll_run_minor', 'payroll_run');
  money('min_monthly_minor', 'min_monthly');
  money('setup_fee_minor', 'setup_fee');
  if (b.plan_name !== undefined) data.plan_name = String(b.plan_name).trim().slice(0, 80) || 'Standard';
  if (b.payment_terms_days !== undefined) {
    const d = toInt(b.payment_terms_days);
    if (d === undefined || d < 0 || d > 120) throw badRequest('Payment terms must be between 0 and 120 days');
    data.payment_terms_days = d;
  }
  for (const k of ['billing_email', 'billing_contact', 'billing_address', 'client_tax_id', 'notes']) if (b[k] !== undefined) data[k] = String(b[k] ?? '').trim().slice(0, 500) || null;
  if (data.billing_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.billing_email)) throw badRequest('Billing email is not valid');
  if (data.client_tax_id && p.country_code === 'IN' && !/^\d{2}[A-Z0-9]{13}$/.test(data.client_tax_id.toUpperCase())) throw badRequest('A GSTIN has 15 characters and starts with the 2-digit state code');
  if (data.client_tax_id && p.country_code === 'IN') data.client_tax_id = data.client_tax_id.toUpperCase();
  if (b.place_of_supply !== undefined) {
    data.place_of_supply = String(b.place_of_supply || '').trim() || null;
    data.place_of_supply_code = b.place_of_supply_code ? String(b.place_of_supply_code).trim() : p.country_code === 'IN' && data.place_of_supply ? GST_STATE_CODES[data.place_of_supply] || null : null;
    if (p.country_code === 'IN' && data.place_of_supply && !data.place_of_supply_code) throw badRequest('Choose an Indian state for the place of supply');
  }
  if (b.active !== undefined) data.active = b.active ? 1 : 0;
  agency.update('billing_profiles', companyId, data, 'company_id');
  auditAgency(req, 'update', 'billing_profile', companyId, { company_slug: p.slug, fields: Object.keys(data).filter((k) => k !== 'updated_at') });
  res.json(profileOut(agency.get(`${profileList} WHERE p.company_id = ?`, [companyId])));
}));

export default r;
