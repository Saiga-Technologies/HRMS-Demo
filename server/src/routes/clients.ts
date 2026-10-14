import { Router } from 'express';
import { all, get, insert, update, run, transaction } from '../db.js';
import { requireHr, requireRole } from '../auth.js';
import { wrap, badRequest, notFound, pick, requireFields, audit, toInt, toNum, nowIso, today, addDays, assertDate, round2 } from '../util.js';

/**
 * Agency CRM: clients and the placements (employees or candidates placed with a client at a bill
 * rate / pay rate). Mounted at /api/clients. Placement routes live under /api/clients/placements/*
 * so everything stays inside this router. HR manages, managers read.
 */
const r = Router();
const readers = requireRole('manager');

const CLIENT_COLS = ['name', 'code', 'industry', 'website', 'address', 'contact_name', 'contact_email', 'contact_phone', 'status', 'billing_currency', 'payment_terms_days', 'notes'];
const CLIENT_STATUSES = ['prospect', 'active', 'inactive'];
const PLACEMENT_COLS = ['employee_id', 'candidate_id', 'role_title', 'start_date', 'end_date', 'bill_rate', 'pay_rate', 'rate_unit', 'placement_fee', 'status', 'location', 'notes'];
const RATE_UNITS = ['hour', 'day', 'month'];
const PLACEMENT_STATUSES = ['proposed', 'active', 'completed', 'terminated'];
/** Multiplier that normalises a rate to a month: hourly × 160, daily × 22, monthly × 1. */
export const MONTH_FACTOR: Record<string, number> = { hour: 160, day: 22, month: 1 };
const monthlySql = (col: string) => `CASE p.rate_unit WHEN 'hour' THEN COALESCE(p.${col},0)*160 WHEN 'day' THEN COALESCE(p.${col},0)*22 ELSE COALESCE(p.${col},0) END`;

const clientQuery = `
  SELECT c.*,
         (SELECT COUNT(*) FROM placements p WHERE p.client_id = c.id AND p.status = 'active') AS active_placements,
         (SELECT COUNT(*) FROM placements p WHERE p.client_id = c.id) AS total_placements,
         (SELECT COALESCE(SUM(${monthlySql('bill_rate')}), 0) FROM placements p WHERE p.client_id = c.id AND p.status = 'active') AS revenue_month,
         (SELECT COALESCE(SUM(${monthlySql('bill_rate')} - ${monthlySql('pay_rate')}), 0) FROM placements p WHERE p.client_id = c.id AND p.status = 'active') AS margin_month
  FROM clients c`;
const placementQuery = `
  SELECT p.*, c.name AS client_name, c.code AS client_code, c.billing_currency,
         e.first_name AS employee_first_name, e.last_name AS employee_last_name, e.employee_code,
         ca.first_name AS candidate_first_name, ca.last_name AS candidate_last_name
  FROM placements p JOIN clients c ON c.id = p.client_id
  LEFT JOIN employees e ON e.id = p.employee_id
  LEFT JOIN candidates ca ON ca.id = p.candidate_id`;

/** Adds the person's name plus margin figures to a placement row. */
export function decoratePlacement(p: any) {
  if (!p) return p;
  const bill = toNum(p.bill_rate) ?? 0;
  const pay = toNum(p.pay_rate) ?? 0;
  const factor = MONTH_FACTOR[p.rate_unit] ?? 1;
  p.person_name = p.employee_id ? `${p.employee_first_name || ''} ${p.employee_last_name || ''}`.trim() : p.candidate_id ? `${p.candidate_first_name || ''} ${p.candidate_last_name || ''}`.trim() : null;
  p.person_type = p.employee_id ? 'employee' : p.candidate_id ? 'candidate' : null;
  p.margin = round2(bill - pay);
  p.margin_pct = bill > 0 ? round2(((bill - pay) / bill) * 100) : 0;
  p.monthly_bill = round2(bill * factor);
  p.monthly_pay = round2(pay * factor);
  p.monthly_margin = round2((bill - pay) * factor);
  p.days_to_end = p.end_date ? Math.round((Date.parse(p.end_date) - Date.parse(today())) / 86400000) : null;
  for (const k of ['employee_first_name', 'employee_last_name', 'candidate_first_name', 'candidate_last_name']) delete p[k];
  return p;
}

function nextClientCode(): string {
  const codes = all<{ code: string }>("SELECT code FROM clients WHERE code LIKE 'CL-%'");
  const max = codes.reduce((m, c) => Math.max(m, Number(c.code.slice(3)) || 0), 0);
  return `CL-${String(max + 1).padStart(4, '0')}`;
}

/** Demo data, inserted the first time the module is listed on an empty table (seed.ts does not know about clients). */
export function ensureClientDefaults() {
  if (get('SELECT 1 FROM clients LIMIT 1')) return;
  const now = nowIso();
  const t = today();
  transaction(() => {
    const client = (name: string, code: string, industry: string, contact: [string, string, string], status = 'active', terms = 30, notes?: string) =>
      insert('clients', { name, code, industry, website: `https://${name.toLowerCase().replace(/[^a-z]+/g, '')}.example`, address: 'Bengaluru, India', contact_name: contact[0], contact_email: contact[1], contact_phone: contact[2], status, billing_currency: 'INR', payment_terms_days: terms, notes: notes ?? null, created_at: now, updated_at: now });
    const nimbus = client('Nimbus Retail', 'CL-0001', 'Retail', ['Kavya Rao', 'kavya.rao@nimbusretail.example', '+91 98100 11001'], 'active', 30, 'Omnichannel retailer; staff augmentation for their platform team.');
    const orion = client('Orion Fintech', 'CL-0002', 'Financial services', ['Dev Patel', 'dev.patel@orionfintech.example', '+91 98100 11002'], 'active', 45, 'Payments start-up; prefers contract-to-hire placements.');
    const helix = client('Helix Health', 'CL-0003', 'Healthcare', ['Dr. Anjali Bose', 'anjali.bose@helixhealth.example', '+91 98100 11003'], 'active', 30);
    client('Brightpath Edu', 'CL-0004', 'Education', ['Samuel John', 'samuel.john@brightpath.example', '+91 98100 11004'], 'prospect', 30, 'Evaluating a finance back-office placement for Q3.');
    const has = (id: number) => !!get('SELECT 1 FROM employees WHERE id = ?', [id]);
    const place = (client_id: number, employee_id: number, role_title: string, start: string, end: string | null, bill: number, pay: number, unit: string, fee: number | null, status: string, location: string) => {
      if (!has(employee_id)) return;
      insert('placements', { client_id, employee_id, candidate_id: null, role_title, start_date: start, end_date: end, bill_rate: bill, pay_rate: pay, rate_unit: unit, placement_fee: fee, status, location, notes: null, created_at: now, updated_at: now });
    };
    place(nimbus, 6, 'Backend Engineer', addDays(t, -120), addDays(t, 60), 1800, 1200, 'hour', null, 'active', 'Client site, Bengaluru');
    place(nimbus, 7, 'Software Engineer', addDays(t, -20), addDays(t, 160), 9500, 6500, 'day', null, 'active', 'Remote');
    place(orion, 11, 'Accountant (contract)', addDays(t, -200), addDays(t, 20), 95000, 68000, 'month', 25000, 'active', 'Mumbai');
    place(orion, 13, 'Account Executive', addDays(t, -60), addDays(t, 300), 140000, 95000, 'month', 40000, 'active', 'Client site, Bengaluru');
    place(helix, 5, 'Tech Lead', addDays(t, -400), addDays(t, -30), 2400, 1700, 'hour', null, 'completed', 'Hyderabad');
    place(helix, 9, 'HR Coordinator', addDays(t, 15), addDays(t, 195), 70000, 52000, 'month', 15000, 'proposed', 'Remote');
  });
}

function validatePlacement(body: any, existing?: any) {
  const data = pick<any>(body, PLACEMENT_COLS);
  const merged = { ...(existing || {}), ...data };
  if (data.employee_id !== undefined) data.employee_id = toInt(data.employee_id) ?? null;
  if (data.candidate_id !== undefined) data.candidate_id = toInt(data.candidate_id) ?? null;
  const emp = data.employee_id !== undefined ? data.employee_id : existing?.employee_id ?? null;
  const cand = data.candidate_id !== undefined ? data.candidate_id : existing?.candidate_id ?? null;
  if (!emp && !cand) throw badRequest('Choose an employee or a candidate for the placement');
  if (emp && cand) throw badRequest('A placement is for either an employee or a candidate, not both');
  if (emp && !get('SELECT 1 FROM employees WHERE id = ?', [emp])) throw badRequest('Employee not found');
  if (cand && !get('SELECT 1 FROM candidates WHERE id = ?', [cand])) throw badRequest('Candidate not found');
  if (emp) data.candidate_id = null;
  if (cand) data.employee_id = null;
  assertDate(data.start_date, 'start_date');
  assertDate(data.end_date, 'end_date');
  if (merged.start_date && merged.end_date && merged.end_date < merged.start_date) throw badRequest('End date must be on or after the start date');
  if (data.rate_unit !== undefined && !RATE_UNITS.includes(data.rate_unit)) throw badRequest(`rate_unit must be one of ${RATE_UNITS.join(', ')}`);
  if (data.status !== undefined && !PLACEMENT_STATUSES.includes(data.status)) throw badRequest(`status must be one of ${PLACEMENT_STATUSES.join(', ')}`);
  for (const k of ['bill_rate', 'pay_rate', 'placement_fee']) {
    if (data[k] === undefined) continue;
    if (data[k] === null || data[k] === '') { data[k] = null; continue; }
    const n = toNum(data[k]);
    if (n === undefined || n < 0) throw badRequest(`${k} must be a non-negative number`);
    data[k] = n;
  }
  if (data.role_title !== undefined && !String(data.role_title).trim()) throw badRequest('role_title is required');
  return data;
}

const loadPlacement = (id: number | undefined) => decoratePlacement(get<any>(`${placementQuery} WHERE p.id = ?`, [id]));

// ---------- Summary / placements (declared before /:id so the literal paths win) ----------
r.get('/summary', readers, (_req, res) => {
  ensureClientDefaults();
  const byStatus: Record<string, number> = { prospect: 0, active: 0, inactive: 0 };
  for (const row of all<any>('SELECT status, COUNT(*) AS n FROM clients GROUP BY status')) byStatus[row.status] = row.n;
  const placements = all<any>(placementQuery).map(decoratePlacement);
  const active = placements.filter((p) => p.status === 'active');
  const placementsByStatus: Record<string, number> = { proposed: 0, active: 0, completed: 0, terminated: 0 };
  for (const p of placements) placementsByStatus[p.status] = (placementsByStatus[p.status] || 0) + 1;
  const perClient = new Map<number, { client_id: number; client_name: string; billing: number; margin: number; placements: number }>();
  for (const p of active) {
    const c = perClient.get(p.client_id) || { client_id: p.client_id, client_name: p.client_name, billing: 0, margin: 0, placements: 0 };
    c.billing = round2(c.billing + p.monthly_bill);
    c.margin = round2(c.margin + p.monthly_margin);
    c.placements += 1;
    perClient.set(p.client_id, c);
  }
  const horizon = addDays(today(), 30);
  const ending = placements.filter((p) => p.status === 'active' && p.end_date && p.end_date >= today() && p.end_date <= horizon).sort((a, b) => a.end_date.localeCompare(b.end_date));
  const monthlyBilling = round2(active.reduce((s, p) => s + p.monthly_bill, 0));
  const monthlyMargin = round2(active.reduce((s, p) => s + p.monthly_margin, 0));
  res.json({
    clients_by_status: byStatus,
    clients_total: Object.values(byStatus).reduce((a, b) => a + b, 0),
    active_placements: active.length,
    monthly_billing: monthlyBilling,
    monthly_margin: monthlyMargin,
    margin_pct: monthlyBilling > 0 ? round2((monthlyMargin / monthlyBilling) * 100) : 0,
    ending_soon: ending,
    billing_by_client: [...perClient.values()].sort((a, b) => b.billing - a.billing),
    placements_by_status: placementsByStatus,
  });
});

r.get('/placements', readers, (req, res) => {
  ensureClientDefaults();
  const where: string[] = [];
  const params: any[] = [];
  if (req.query.client_id) { where.push('p.client_id = ?'); params.push(toInt(req.query.client_id)); }
  if (req.query.employee_id) { where.push('p.employee_id = ?'); params.push(toInt(req.query.employee_id)); }
  if (req.query.candidate_id) { where.push('p.candidate_id = ?'); params.push(toInt(req.query.candidate_id)); }
  if (req.query.status) { where.push('p.status = ?'); params.push(String(req.query.status)); }
  const q = String(req.query.q || '').trim();
  if (q) { where.push('(p.role_title LIKE ? OR c.name LIKE ? OR e.first_name LIKE ? OR e.last_name LIKE ? OR ca.first_name LIKE ? OR ca.last_name LIKE ?)'); params.push(...Array(6).fill(`%${q}%`)); }
  const rows = all<any>(`${placementQuery}${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY CASE p.status WHEN 'active' THEN 0 WHEN 'proposed' THEN 1 ELSE 2 END, p.start_date DESC, p.id DESC`, params);
  res.json(rows.map(decoratePlacement));
});
r.get('/placements/:id', readers, (req, res) => {
  const p = loadPlacement(toInt(req.params.id));
  if (!p) throw notFound('Placement not found');
  res.json(p);
});
r.put('/placements/:id', requireHr, wrap(async (req, res) => {
  const id = toInt(req.params.id);
  const existing = get<any>('SELECT * FROM placements WHERE id = ?', [id]);
  if (!existing) throw notFound('Placement not found');
  const data = validatePlacement(req.body, existing);
  update('placements', id!, { ...data, updated_at: nowIso() });
  audit(req, 'update', 'placement', id, data);
  res.json(loadPlacement(id));
}));
r.post('/placements/:id/status', requireHr, wrap(async (req, res) => {
  const id = toInt(req.params.id);
  const existing = get<any>('SELECT * FROM placements WHERE id = ?', [id]);
  if (!existing) throw notFound('Placement not found');
  const status = String(req.body?.status || '');
  if (!PLACEMENT_STATUSES.includes(status)) throw badRequest(`status must be one of ${PLACEMENT_STATUSES.join(', ')}`);
  const patch: any = { status, updated_at: nowIso() };
  if ((status === 'completed' || status === 'terminated') && !existing.end_date) patch.end_date = today();
  update('placements', id!, patch);
  audit(req, 'status', 'placement', id, { from: existing.status, to: status });
  res.json(loadPlacement(id));
}));
r.delete('/placements/:id', requireHr, (req, res) => {
  const id = toInt(req.params.id);
  if (!run('DELETE FROM placements WHERE id = ?', [id]).changes) throw notFound('Placement not found');
  audit(req, 'delete', 'placement', id);
  res.status(204).end();
});

// ---------- Clients ----------
r.get('/', readers, (req, res) => {
  ensureClientDefaults();
  const where: string[] = [];
  const params: any[] = [];
  const q = String(req.query.q || '').trim();
  if (q) { where.push('(c.name LIKE ? OR c.code LIKE ? OR c.industry LIKE ? OR c.contact_name LIKE ? OR c.contact_email LIKE ?)'); params.push(...Array(5).fill(`%${q}%`)); }
  if (req.query.status) { where.push('c.status = ?'); params.push(String(req.query.status)); }
  res.json(all(`${clientQuery}${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY CASE c.status WHEN 'active' THEN 0 WHEN 'prospect' THEN 1 ELSE 2 END, c.name`, params));
});
r.get('/:id', readers, (req, res) => {
  const id = toInt(req.params.id);
  const client = get<any>(`${clientQuery} WHERE c.id = ?`, [id]);
  if (!client) throw notFound('Client not found');
  const placements = all<any>(`${placementQuery} WHERE p.client_id = ? ORDER BY CASE p.status WHEN 'active' THEN 0 WHEN 'proposed' THEN 1 ELSE 2 END, p.start_date DESC`, [id]).map(decoratePlacement);
  const active = placements.filter((p) => p.status === 'active');
  const bill = round2(active.reduce((s, p) => s + p.monthly_bill, 0));
  const margin = round2(active.reduce((s, p) => s + p.monthly_margin, 0));
  client.placements = placements;
  client.margin_summary = { active_placements: active.length, monthly_billing: bill, monthly_pay: round2(bill - margin), monthly_margin: margin, margin_pct: bill > 0 ? round2((margin / bill) * 100) : 0, placement_fees: round2(placements.reduce((s, p) => s + (toNum(p.placement_fee) ?? 0), 0)) };
  res.json(client);
});
r.get('/:id/placements', readers, (req, res) => {
  const id = toInt(req.params.id);
  if (!get('SELECT 1 FROM clients WHERE id = ?', [id])) throw notFound('Client not found');
  res.json(all<any>(`${placementQuery} WHERE p.client_id = ? ORDER BY p.start_date DESC, p.id DESC`, [id]).map(decoratePlacement));
});
function validateClient(body: any) {
  const data = pick<any>(body, CLIENT_COLS);
  if (data.name !== undefined && !String(data.name).trim()) throw badRequest('name is required');
  if (data.status !== undefined && !CLIENT_STATUSES.includes(data.status)) throw badRequest(`status must be one of ${CLIENT_STATUSES.join(', ')}`);
  if (data.payment_terms_days !== undefined) {
    const n = toInt(data.payment_terms_days);
    if (n === undefined || n < 0) throw badRequest('payment_terms_days must be a non-negative number');
    data.payment_terms_days = n;
  }
  if (data.contact_email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(data.contact_email))) throw badRequest('contact_email is not a valid email');
  if (data.code !== undefined && data.code !== null && !String(data.code).trim()) delete data.code;
  return data;
}
r.post('/', requireHr, wrap(async (req, res) => {
  requireFields(req.body, ['name']);
  ensureClientDefaults();
  const data = validateClient(req.body);
  if (!data.code) data.code = nextClientCode();
  if (get('SELECT 1 FROM clients WHERE code = ?', [data.code])) throw badRequest(`Client code ${data.code} is already used`);
  const now = nowIso();
  const id = insert('clients', { status: 'active', billing_currency: 'INR', payment_terms_days: 30, ...data, created_at: now, updated_at: now });
  audit(req, 'create', 'client', id, { name: data.name });
  res.status(201).json(get(`${clientQuery} WHERE c.id = ?`, [id]));
}));
r.put('/:id', requireHr, wrap(async (req, res) => {
  const id = toInt(req.params.id);
  if (!get('SELECT 1 FROM clients WHERE id = ?', [id])) throw notFound('Client not found');
  const data = validateClient(req.body);
  if (data.code && get('SELECT 1 FROM clients WHERE code = ? AND id != ?', [data.code, id])) throw badRequest(`Client code ${data.code} is already used`);
  update('clients', id!, { ...data, updated_at: nowIso() });
  audit(req, 'update', 'client', id, data);
  res.json(get(`${clientQuery} WHERE c.id = ?`, [id]));
}));
r.delete('/:id', requireHr, (req, res) => {
  const id = toInt(req.params.id);
  if (!run('DELETE FROM clients WHERE id = ?', [id]).changes) throw notFound('Client not found');
  audit(req, 'delete', 'client', id);
  res.status(204).end();
});
r.post('/:id/placements', requireHr, wrap(async (req, res) => {
  const clientId = toInt(req.params.id);
  if (!get('SELECT 1 FROM clients WHERE id = ?', [clientId])) throw notFound('Client not found');
  requireFields(req.body, ['role_title']);
  const data = validatePlacement(req.body);
  const now = nowIso();
  const id = insert('placements', { rate_unit: 'month', status: 'proposed', ...data, client_id: clientId, created_at: now, updated_at: now });
  audit(req, 'create', 'placement', id, { client_id: clientId, role_title: data.role_title });
  res.status(201).json(loadPlacement(id));
}));

export default r;
