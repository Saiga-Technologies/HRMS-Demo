import { Router, type Request } from 'express';
import { all, get, insert, update, run, transaction, agency, currentCompanySlug } from '../db.js';
import { requireHr } from '../auth.js';
import { wrap, badRequest, notFound, forbidden, toInt, nowIso, today, audit } from '../util.js';
import { calendarFor, currentCalendar, shiftPeriod } from '../ops/payrollCalendar.js';
import { ensureFilings, filingStatus, ruleFor } from '../ops/compliance.js';
import { buildInvoicePdf, invoiceFileName } from '../ops/billing.js';

/**
 * Agency services inside a client company (mounted at /api/services): the payroll calendar,
 * statutory filings, the client ↔ agency service desk and the client's invoices. Visible to the
 * client's HR and to agency staff working in the company; some actions are agency-only.
 */
const r = Router();

export function companyMeta() {
  const slug = currentCompanySlug();
  return agency.get<any>('SELECT id, slug, name, country_code, region, currency, timezone, seed_profile, account_manager_id, onboarded_at FROM companies WHERE slug = ?', [slug]) || { slug, country_code: 'IN', region: 'Karnataka', currency: 'INR', seed_profile: null };
}
export function syncFilings() {
  const c = companyMeta();
  ensureFilings({ country: c.country_code, region: c.region, slug: c.slug, demo: !!c.seed_profile, since: c.seed_profile ? null : c.onboarded_at?.slice(0, 10) });
}
const actorName = (req: Request) => (req.agencyUser ? `${req.agencyUser.first_name} ${req.agencyUser.last_name} (agency)` : req.user?.email || 'HR');
const requireAgencyStaff = (req: Request) => { if (!req.agencyUser) throw forbidden('Only the agency can do this'); };

/* ------------------------------------------------------------------ */
/* Payroll calendar                                                    */
/* ------------------------------------------------------------------ */
r.get('/calendar', requireHr, (_req, res) => {
  const current = currentCalendar();
  const next = calendarFor(shiftPeriod(current.period, 1));
  const history = [1, 2, 3].map((n) => calendarFor(shiftPeriod(current.period, -n)));
  res.json({ current, next, history, today: today() });
});

/** Manual checkpoints: the client confirms inputs are in; the agency locks attendance. */
r.post('/calendar/:period/checkpoints', requireHr, wrap(async (req, res) => {
  const period = String(req.params.period);
  if (!/^\d{4}-\d{2}$/.test(period)) throw badRequest('period must be YYYY-MM');
  const key = String(req.body?.key || '');
  if (!['inputs_received', 'attendance_locked'].includes(key)) throw badRequest('key must be inputs_received or attendance_locked');
  if (key === 'attendance_locked') requireAgencyStaff(req);
  if (req.body?.done === false) {
    if (get("SELECT 1 FROM payroll_runs WHERE period = ? AND status IN ('processed','approved','paid')", [period])) throw badRequest('Payroll for this period is already processed');
    run('DELETE FROM payroll_checkpoints WHERE period = ? AND key = ?', [period, key]);
  } else {
    run('INSERT INTO payroll_checkpoints (period, key, done_at, done_by_name, note) VALUES (?, ?, ?, ?, ?) ON CONFLICT(period, key) DO UPDATE SET done_at = excluded.done_at, done_by_name = excluded.done_by_name, note = excluded.note',
      [period, key, nowIso(), actorName(req), req.body?.note ? String(req.body.note).slice(0, 500) : null]);
  }
  audit(req, req.body?.done === false ? 'reopen' : 'checkpoint', 'payroll_period', period, { key });
  res.json(calendarFor(period));
}));

/* ------------------------------------------------------------------ */
/* Compliance filings                                                  */
/* ------------------------------------------------------------------ */
function filingRow(f: any) {
  return { ...f, state: filingStatus(f), description: ruleFor(f.code)?.description || null };
}
r.get('/compliance', requireHr, (req, res) => {
  syncFilings();
  const rows = all<any>('SELECT * FROM compliance_filings ORDER BY due_date, name').map(filingRow);
  const state = req.query.state ? String(req.query.state) : '';
  res.json(state ? rows.filter((f) => f.state === state) : rows);
});
r.put('/compliance/:id', requireHr, wrap(async (req, res) => {
  requireAgencyStaff(req);
  const id = toInt(req.params.id)!;
  const f = get<any>('SELECT * FROM compliance_filings WHERE id = ?', [id]);
  if (!f) throw notFound('Filing not found');
  const status = String(req.body?.status || f.status);
  if (!['pending', 'filed', 'not_applicable'].includes(status)) throw badRequest('status must be pending, filed or not_applicable');
  if (status === 'filed' && !String(req.body?.reference || f.reference || '').trim()) throw badRequest('Add the acknowledgement / challan reference when marking a filing as filed');
  update('compliance_filings', id, {
    status,
    reference: req.body?.reference !== undefined ? String(req.body.reference).slice(0, 120) || null : f.reference,
    amount: req.body?.amount !== undefined && req.body.amount !== '' ? Number(req.body.amount) : f.amount,
    notes: req.body?.notes !== undefined ? String(req.body.notes).slice(0, 1000) || null : f.notes,
    filed_at: status === 'filed' ? f.filed_at || nowIso() : null,
    filed_by_name: status === 'filed' ? f.filed_by_name || actorName(req) : null,
  });
  audit(req, 'update', 'compliance_filing', id, { status });
  res.json(filingRow(get('SELECT * FROM compliance_filings WHERE id = ?', [id])));
}));

/* ------------------------------------------------------------------ */
/* Service requests                                                    */
/* ------------------------------------------------------------------ */
export const SR_CATEGORIES = ['payroll', 'onboarding', 'exit', 'letters', 'compliance', 'attendance', 'benefits', 'other'];
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const STATUSES = ['open', 'in_progress', 'waiting_client', 'resolved', 'closed'];
export function slaHours(priority: string): number {
  const s = agency.get<any>("SELECT value FROM agency_settings WHERE key = 'agency'");
  let sla: any = {};
  try { sla = JSON.parse(s?.value || '{}').sla_hours || {}; } catch { /* ignore */ }
  return Number(sla[priority]) || ({ urgent: 4, high: 24, normal: 48, low: 96 } as any)[priority] || 48;
}
const srQuery = `SELECT s.*, (SELECT COUNT(*) FROM service_request_comments c WHERE c.request_id = s.id) AS comments FROM service_requests s`;
/** SLA is the agency's clock: it is breached when an open / in-progress request passes due_at (paused while waiting for the client). */
export function srState(s: any, now = nowIso()) {
  return { ...s, breached: ['open', 'in_progress'].includes(s.status) && s.due_at && s.due_at < now ? 1 : 0 };
}
r.get('/requests', requireHr, (req, res) => {
  const where: string[] = [];
  const params: any[] = [];
  if (req.query.status === 'active') where.push("s.status IN ('open','in_progress','waiting_client')");
  else if (req.query.status) { where.push('s.status = ?'); params.push(String(req.query.status)); }
  const rows = all<any>(`${srQuery}${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY CASE s.status WHEN 'resolved' THEN 2 WHEN 'closed' THEN 3 ELSE 0 END, CASE s.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, s.created_at DESC`, params);
  res.json(rows.map((s) => srState(s)));
});
r.post('/requests', requireHr, wrap(async (req, res) => {
  const b = req.body || {};
  const subject = String(b.subject || '').trim().slice(0, 160);
  if (!subject) throw badRequest('subject is required');
  const category = SR_CATEGORIES.includes(b.category) ? b.category : 'other';
  const priority = PRIORITIES.includes(b.priority) ? b.priority : 'normal';
  const year = today().slice(0, 4);
  const id = transaction(() => {
    const n = (get<any>("SELECT COUNT(*) AS n FROM service_requests WHERE number LIKE ?", [`SR-${year}-%`])?.n ?? 0) + 1;
    const created = nowIso();
    return insert('service_requests', {
      number: `SR-${year}-${String(n).padStart(4, '0')}`, category, subject, description: b.description ? String(b.description).slice(0, 4000) : null, priority, status: 'open',
      raised_by_user: req.user!.id, raised_by_name: actorName(req), assignee_name: null, assignee_agency_user_id: null,
      due_at: new Date(Date.parse(created) + slaHours(priority) * 3600000).toISOString(), created_at: created, updated_at: created,
    });
  });
  audit(req, 'create', 'service_request', id, { category, priority });
  res.status(201).json(srState(get(`${srQuery} WHERE s.id = ?`, [id])));
}));
r.get('/requests/:id', requireHr, (req, res) => {
  const s = get<any>(`${srQuery} WHERE s.id = ?`, [toInt(req.params.id)]);
  if (!s) throw notFound('Request not found');
  res.json({ ...srState(s), thread: all('SELECT * FROM service_request_comments WHERE request_id = ? ORDER BY created_at, id', [s.id]) });
});
r.post('/requests/:id/comments', requireHr, wrap(async (req, res) => {
  const s = get<any>('SELECT * FROM service_requests WHERE id = ?', [toInt(req.params.id)]);
  if (!s) throw notFound('Request not found');
  const body = String(req.body?.body || '').trim();
  if (!body) throw badRequest('Write a message');
  const side = req.agencyUser ? 'agency' : 'client';
  insert('service_request_comments', { request_id: s.id, author_name: actorName(req), author_side: side, body: body.slice(0, 4000), created_at: nowIso() });
  // A client reply on a request waiting for them hands it back to the agency.
  const status = side === 'client' && s.status === 'waiting_client' ? 'in_progress' : side === 'agency' && s.status === 'open' ? 'in_progress' : s.status;
  update('service_requests', s.id, { status, updated_at: nowIso() });
  res.status(201).json({ ...srState(get(`${srQuery} WHERE s.id = ?`, [s.id])), thread: all('SELECT * FROM service_request_comments WHERE request_id = ? ORDER BY created_at, id', [s.id]) });
}));
r.put('/requests/:id', requireHr, wrap(async (req, res) => {
  const s = get<any>('SELECT * FROM service_requests WHERE id = ?', [toInt(req.params.id)]);
  if (!s) throw notFound('Request not found');
  const b = req.body || {};
  const data: any = { updated_at: nowIso() };
  if (b.status !== undefined) {
    if (!STATUSES.includes(b.status)) throw badRequest('Invalid status');
    // Clients can close or reopen; everything else is the agency's call.
    if (!req.agencyUser && !['closed', 'open'].includes(b.status)) throw forbidden('Only the agency can change this status');
    data.status = b.status;
    data.resolved_at = ['resolved', 'closed'].includes(b.status) ? s.resolved_at || nowIso() : null;
  }
  if (b.priority !== undefined) {
    if (!PRIORITIES.includes(b.priority)) throw badRequest('Invalid priority');
    data.priority = b.priority;
    data.due_at = new Date(Date.parse(s.created_at) + slaHours(b.priority) * 3600000).toISOString();
  }
  if (b.assign_to_me) {
    requireAgencyStaff(req);
    data.assignee_agency_user_id = req.agencyUser!.id;
    data.assignee_name = `${req.agencyUser!.first_name} ${req.agencyUser!.last_name}`;
    if (s.status === 'open') data.status = 'in_progress';
  }
  update('service_requests', s.id, data);
  audit(req, 'update', 'service_request', s.id, Object.keys(data));
  res.json(srState(get(`${srQuery} WHERE s.id = ?`, [s.id])));
}));

/* ------------------------------------------------------------------ */
/* The client's invoices (issued by the agency)                        */
/* ------------------------------------------------------------------ */
r.get('/invoices', requireHr, (_req, res) => {
  const c = companyMeta();
  const rows = agency.all<any>(`SELECT i.id, i.number, i.period, i.issue_date, i.due_date, i.currency, i.exponent, i.subtotal_minor, i.tax_minor, i.total_minor, i.paid_minor, i.status, e.name AS entity_name
                                FROM invoices i JOIN billing_entities e ON e.id = i.entity_id WHERE i.company_id = ? AND i.status != 'draft' ORDER BY i.period DESC`, [c.id ?? -1]);
  const now = today();
  res.json(rows.map((i) => ({ ...i, overdue: i.status === 'issued' && i.due_date < now ? 1 : 0 })));
});

/** The client's own invoice as a PDF (issued, paid or void — never drafts, never another company's). */
r.get('/invoices/:id/pdf', requireHr, wrap(async (req, res) => {
  const c = companyMeta();
  const inv = agency.get<any>("SELECT id, number FROM invoices WHERE id = ? AND company_id = ? AND status != 'draft'", [toInt(req.params.id) ?? -1, c.id ?? -1]);
  if (!inv) throw notFound('Invoice not found');
  const pdf = await buildInvoicePdf(inv.id);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${req.query.download === '1' ? 'attachment' : 'inline'}; filename="${invoiceFileName(inv)}"`);
  res.send(pdf);
}));

export default r;
