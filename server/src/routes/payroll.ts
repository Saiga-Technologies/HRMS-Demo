import { Router } from 'express';
import { all, get, insert, update, run, getSetting, parseJson, parseJsonAll, transaction } from '../db.js';
import { requireAuth, requireHr, canAccessEmployee, visibleEmployeeIds } from '../auth.js';
import { badRequest, notFound, forbidden, pick, requireFields, audit, toInt, toNum, nowIso, round2, wrap, eachDay, today as todayLocal } from '../util.js';
import { DEFAULT_PAYROLL_SETTINGS } from './settings.js';

const r = Router();

// ---------- Salary components ----------
const C_COLS = ['name', 'code', 'type', 'calc_type', 'default_value', 'taxable', 'statutory', 'prorate', 'sort_order', 'active'];
r.get('/components', requireAuth, (_req, res) => res.json(all('SELECT * FROM salary_components ORDER BY type, sort_order, id')));
r.post('/components', requireHr, wrap(async (req, res) => {
  requireFields(req.body, ['name', 'code', 'type', 'calc_type']);
  const data: any = pick(req.body, C_COLS);
  data.code = String(data.code).toUpperCase().replace(/[^A-Z0-9_]/g, '_');
  const id = insert('salary_components', data);
  audit(req, 'create', 'salary_component', id);
  res.status(201).json(get('SELECT * FROM salary_components WHERE id = ?', [id]));
}));
r.put('/components/:id', requireHr, wrap(async (req, res) => {
  const id = toInt(req.params.id)!;
  if (!get('SELECT 1 FROM salary_components WHERE id = ?', [id])) throw notFound();
  update('salary_components', id, pick(req.body, C_COLS.filter((c) => c !== 'code')));
  audit(req, 'update', 'salary_component', id);
  res.json(get('SELECT * FROM salary_components WHERE id = ?', [id]));
}));
r.delete('/components/:id', requireHr, (req, res) => {
  if (!run('DELETE FROM salary_components WHERE id = ?', [toInt(req.params.id)]).changes) throw notFound();
  res.json({ ok: true });
});

// ---------- Salary structures ----------
function currentStructure(employeeId: number, asOf?: string) {
  const row = get<any>('SELECT * FROM salary_structures WHERE employee_id = ? AND effective_from <= ? ORDER BY effective_from DESC, id DESC LIMIT 1', [employeeId, asOf || '9999-12-31']);
  return parseJson(row, ['components']);
}

/** Compute the monthly breakdown for a structure. paidFraction in [0,1] prorates components flagged prorate. */
export function computeBreakdown(structure: any, paidFraction = 1, adjustments: any[] = [], settings = getSetting('payroll', DEFAULT_PAYROLL_SETTINGS)) {
  const comps = all<any>('SELECT * FROM salary_components WHERE active = 1 ORDER BY type, sort_order');
  const overrides = new Map<number, number>((structure.components || []).map((c: any) => [Number(c.component_id), Number(c.value)]));
  const basicFull = Number(structure.basic);
  const basic = round2(basicFull * paidFraction);
  const earnings: any[] = [{ code: 'BASIC', name: 'Basic', amount: basic, full_amount: basicFull }];
  // First pass: earnings that do not depend on gross.
  const earnComps = comps.filter((c) => c.type === 'earning');
  for (const c of earnComps.filter((c) => c.calc_type !== 'percent_of_gross')) {
    const v = overrides.has(c.id) ? overrides.get(c.id)! : Number(c.default_value);
    let full = c.calc_type === 'fixed' ? v : (basicFull * v) / 100;
    earnings.push({ code: c.code, name: c.name, amount: round2(c.prorate ? full * paidFraction : full), full_amount: round2(full), taxable: !!c.taxable });
  }
  let grossFull = earnings.reduce((s, e) => s + (e.full_amount ?? e.amount), 0);
  for (const c of earnComps.filter((c) => c.calc_type === 'percent_of_gross')) {
    const v = overrides.has(c.id) ? overrides.get(c.id)! : Number(c.default_value);
    const full = (grossFull * v) / 100;
    earnings.push({ code: c.code, name: c.name, amount: round2(c.prorate ? full * paidFraction : full), full_amount: round2(full), taxable: !!c.taxable });
  }
  // Adjustments (bonus, overtime, reimbursement, arrears) add to earnings; deduction-type ones to deductions.
  for (const a of adjustments) {
    const amt = round2(Number(a.amount));
    if (['bonus', 'reimbursement', 'overtime', 'arrears'].includes(a.type)) earnings.push({ code: a.type.toUpperCase(), name: a.note || a.type, amount: amt, adjustment_id: a.id, taxable: a.type !== 'reimbursement' });
  }
  const gross = round2(earnings.reduce((s, e) => s + e.amount, 0));
  const deductions: any[] = [];
  for (const c of comps.filter((c) => c.type === 'deduction')) {
    const v = overrides.has(c.id) ? overrides.get(c.id)! : Number(c.default_value);
    let amount = 0;
    if (c.code === 'PF') {
      const pfBase = Math.min(basic, settings.pf_wage_ceiling || Infinity);
      amount = (pfBase * (settings.pf_employee_percent ?? v)) / 100;
    } else if (c.code === 'ESI') {
      amount = grossFull <= (settings.esi_wage_ceiling || 0) ? (gross * (settings.esi_employee_percent ?? v)) / 100 : 0;
    } else if (c.code === 'PT') {
      amount = gross >= (settings.professional_tax_threshold || 0) ? (settings.professional_tax_monthly ?? v) : 0;
    } else if (c.code === 'TDS') {
      amount = monthlyTds(earnings, settings);
    } else {
      amount = c.calc_type === 'fixed' ? v : c.calc_type === 'percent_of_basic' ? (basic * v) / 100 : (gross * v) / 100;
    }
    deductions.push({ code: c.code, name: c.name, amount: round2(amount), statutory: !!c.statutory });
  }
  for (const a of adjustments) {
    if (['deduction', 'advance', 'loan_recovery'].includes(a.type)) deductions.push({ code: a.type.toUpperCase(), name: a.note || a.type, amount: round2(Number(a.amount)), adjustment_id: a.id });
  }
  const total_deductions = round2(deductions.reduce((s, d) => s + d.amount, 0));
  return { basic, earnings, deductions, gross, total_deductions, net: round2(gross - total_deductions) };
}
function monthlyTds(earnings: any[], settings: any): number {
  const taxableMonthly = earnings.filter((e) => e.taxable !== false).reduce((s, e) => s + (e.full_amount ?? e.amount), 0);
  const annual = Math.max(0, taxableMonthly * 12 - (settings.standard_deduction_annual || 0));
  let tax = 0;
  let prev = 0;
  for (const slab of settings.tds_slabs || []) {
    const upto = slab.upto == null ? Infinity : slab.upto;
    if (annual > prev) tax += (Math.min(annual, upto) - prev) * (slab.percent / 100);
    prev = upto;
    if (annual <= upto) break;
  }
  return tax / 12;
}

r.post('/structures/preview', requireHr, (req, res) => {
  const basic = toNum(req.body.basic) ?? 0;
  const components = Array.isArray(req.body.components) ? req.body.components : [];
  res.json(computeBreakdown({ basic, components }));
});
r.get('/structures/:employeeId', requireAuth, (req, res) => {
  const eid = toInt(req.params.employeeId)!;
  if (!canAccessEmployee(req, eid)) throw forbidden();
  const history = parseJsonAll(all('SELECT * FROM salary_structures WHERE employee_id = ? ORDER BY effective_from DESC, id DESC', [eid]), ['components']);
  const current = history[0] ? computeBreakdown(history[0]) : null;
  res.json({ history, current: history[0] ?? null, preview: current });
});
r.post('/structures/:employeeId', requireHr, wrap(async (req, res) => {
  const eid = toInt(req.params.employeeId)!;
  if (!get('SELECT 1 FROM employees WHERE id = ?', [eid])) throw notFound('Employee not found');
  requireFields(req.body, ['basic', 'effective_from']);
  const basic = toNum(req.body.basic);
  if (basic === undefined || basic < 0) throw badRequest('basic must be a non-negative number');
  const components = Array.isArray(req.body.components) ? req.body.components.filter((c: any) => c && c.component_id != null) : [];
  const id = insert('salary_structures', { employee_id: eid, effective_from: req.body.effective_from, currency: req.body.currency || getSetting('payroll', DEFAULT_PAYROLL_SETTINGS).currency, basic, components, ctc_annual: toNum(req.body.ctc_annual) ?? null, notes: req.body.notes || null, created_by: req.user!.id, created_at: nowIso() });
  audit(req, 'create', 'salary_structure', id, { employee_id: eid });
  const row = parseJson(get('SELECT * FROM salary_structures WHERE id = ?', [id]), ['components']);
  res.status(201).json({ structure: row, preview: computeBreakdown(row) });
}));
r.delete('/structures/item/:id', requireHr, (req, res) => {
  if (!run('DELETE FROM salary_structures WHERE id = ?', [toInt(req.params.id)]).changes) throw notFound();
  res.json({ ok: true });
});

// ---------- Adjustments ----------
r.get('/adjustments', requireAuth, (req, res) => {
  const where: string[] = [];
  const params: any[] = [];
  const vis = visibleEmployeeIds(req);
  if (vis) { if (!vis.length) return res.json([]); where.push(`a.employee_id IN (${vis.map(() => '?').join(',')})`); params.push(...vis); }
  if (req.query.period) { where.push('a.period = ?'); params.push(req.query.period); }
  if (req.query.employee_id) { where.push('a.employee_id = ?'); params.push(toInt(req.query.employee_id)); }
  res.json(all(`SELECT a.*, e.first_name || ' ' || e.last_name AS employee_name, e.employee_code FROM payroll_adjustments a JOIN employees e ON e.id = a.employee_id${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY a.period DESC, a.id DESC`, params));
});
r.post('/adjustments', requireHr, wrap(async (req, res) => {
  requireFields(req.body, ['employee_id', 'period', 'type', 'amount']);
  if (!/^\d{4}-\d{2}$/.test(req.body.period)) throw badRequest('period must be YYYY-MM');
  const run_ = get<any>('SELECT status FROM payroll_runs WHERE period = ?', [req.body.period]);
  if (run_ && run_.status !== 'draft') throw badRequest(`Payroll for ${req.body.period} is already ${run_.status}`);
  const id = insert('payroll_adjustments', { employee_id: toInt(req.body.employee_id), period: req.body.period, type: req.body.type, amount: toNum(req.body.amount), note: req.body.note || null, created_by: req.user!.id, created_at: nowIso() });
  audit(req, 'create', 'payroll_adjustment', id);
  res.status(201).json(get('SELECT * FROM payroll_adjustments WHERE id = ?', [id]));
}));
r.delete('/adjustments/:id', requireHr, (req, res) => {
  if (!run('DELETE FROM payroll_adjustments WHERE id = ?', [toInt(req.params.id)]).changes) throw notFound();
  res.json({ ok: true });
});

// ---------- Payroll runs ----------
function periodDays(period: string, settings: any) {
  const [y, m] = period.split('-').map(Number);
  const start = `${period}-01`;
  const endDate = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const days = eachDay(start, endDate);
  if (settings.working_days_mode === 'working') {
    const offs: number[] = getSetting('attendance', { weekly_offs: [0, 6] }).weekly_offs || [0, 6];
    const holidays = new Set(all<any>('SELECT date FROM holidays WHERE date BETWEEN ? AND ?', [start, endDate]).map((h) => h.date));
    return { start, end: endDate, working: days.filter((d) => !offs.includes(new Date(d + 'T00:00:00Z').getUTCDay()) && !holidays.has(d)).length, calendar: days.length };
  }
  return { start, end: endDate, working: days.length, calendar: days.length };
}

/** Loss-of-pay days = absent (no record, no approved leave, working day) + unpaid approved leave days. */
function lopFor(employeeId: number, start: string, end: string, settings: any): { lop: number; present: number; detail: any } {
  const offs: number[] = getSetting('attendance', { weekly_offs: [0, 6] }).weekly_offs || [0, 6];
  const holidays = new Set(all<any>('SELECT date FROM holidays WHERE date BETWEEN ? AND ?', [start, end]).map((h) => h.date));
  const att = new Map(all<any>('SELECT date, status FROM attendance_records WHERE employee_id = ? AND date BETWEEN ? AND ?', [employeeId, start, end]).map((a) => [a.date, a.status]));
  const leaves = all<any>(`SELECT l.start_date, l.end_date, l.half_day, t.paid FROM leave_requests l JOIN leave_types t ON t.id = l.leave_type_id WHERE l.employee_id = ? AND l.status = 'approved' AND l.end_date >= ? AND l.start_date <= ?`, [employeeId, start, end]);
  const emp = get<any>('SELECT join_date, exit_date FROM employees WHERE id = ?', [employeeId]);
  let lop = 0, present = 0, unpaidLeave = 0, absent = 0, halfDays = 0;
  const today = todayLocal();
  // Only deduct for absences when attendance was actually tracked for this employee in the period;
  // a month with no punches at all means attendance data is unavailable, not that the employee was absent.
  const trackAbsence = settings.lop_based_on_attendance && att.size > 0;
  for (const d of eachDay(start, end)) {
    const wd = new Date(d + 'T00:00:00Z').getUTCDay();
    if (emp?.join_date && d < emp.join_date) { lop += 1; continue; }
    if (emp?.exit_date && d > emp.exit_date) { lop += 1; continue; }
    if (offs.includes(wd) || holidays.has(d)) continue;
    const leave = leaves.find((l) => d >= l.start_date && d <= l.end_date);
    if (leave) {
      const frac = leave.half_day ? 0.5 : 1;
      if (!leave.paid) { lop += frac; unpaidLeave += frac; }
      if (leave.half_day) {
        const st = att.get(d);
        if (!st || st === 'absent') { if (trackAbsence && d < today) { lop += 0.5; absent += 0.5; } }
      }
      continue;
    }
    const st = att.get(d);
    if (st === 'present' || st === 'wfh') present += 1;
    else if (st === 'half_day') { present += 0.5; halfDays += 1; if (settings.lop_based_on_attendance) lop += 0.5; }
    else if (st === 'absent' || (trackAbsence && d < today)) { lop += 1; absent += 1; }
  }
  return { lop, present, detail: { unpaidLeave, absent, halfDays } };
}

const runQuery = `SELECT r.*, (SELECT COUNT(*) FROM payslips p WHERE p.run_id = r.id) AS payslip_count FROM payroll_runs r`;
r.get('/runs', requireHr, (_req, res) => res.json(parseJsonAll(all(`${runQuery} ORDER BY r.period DESC`), ['totals'])));
r.post('/runs', requireHr, wrap(async (req, res) => {
  requireFields(req.body, ['period']);
  if (!/^\d{4}-\d{2}$/.test(req.body.period)) throw badRequest('period must be YYYY-MM');
  if (get('SELECT 1 FROM payroll_runs WHERE period = ?', [req.body.period])) throw badRequest('A run for this period already exists');
  const settings = getSetting('payroll', DEFAULT_PAYROLL_SETTINGS);
  const pd = periodDays(req.body.period, settings);
  const id = insert('payroll_runs', { period: req.body.period, status: 'draft', working_days: pd.working, totals: {}, notes: req.body.notes || null, created_by: req.user!.id, created_at: nowIso() });
  audit(req, 'create', 'payroll_run', id);
  res.status(201).json(parseJson(get(`${runQuery} WHERE r.id = ?`, [id]), ['totals']));
}));
r.get('/runs/:id', requireHr, (req, res) => {
  const run_ = parseJson(get<any>(`${runQuery} WHERE r.id = ?`, [toInt(req.params.id)]), ['totals']);
  if (!run_) throw notFound();
  const payslips = parseJsonAll(all(`SELECT p.*, e.first_name || ' ' || e.last_name AS employee_name, e.employee_code, d.name AS department_name FROM payslips p JOIN employees e ON e.id = p.employee_id LEFT JOIN departments d ON d.id = e.department_id WHERE p.run_id = ? ORDER BY e.first_name`, [run_.id]), ['earnings', 'deductions']);
  res.json({ ...run_, payslips });
});

/** Process (or re-process) a draft run: generates a payslip for every active employee with a salary structure. */
r.post('/runs/:id/process', requireHr, wrap(async (req, res) => {
  const id = toInt(req.params.id)!;
  const run_ = get<any>('SELECT * FROM payroll_runs WHERE id = ?', [id]);
  if (!run_) throw notFound();
  if (run_.status !== 'draft') throw badRequest(`Run is ${run_.status}; only draft runs can be processed`);
  const settings = getSetting('payroll', DEFAULT_PAYROLL_SETTINGS);
  const pd = periodDays(run_.period, settings);
  const employees = all<any>(`SELECT * FROM employees WHERE status != 'exited' OR (exit_date IS NOT NULL AND exit_date >= ?)`, [pd.start]);
  const skipped: any[] = [];
  const totals = { employees: 0, gross: 0, deductions: 0, net: 0 };
  transaction(() => {
    run('DELETE FROM payslips WHERE run_id = ?', [id]);
    for (const e of employees) {
      const s = currentStructure(e.id, pd.end);
      if (!s) { skipped.push({ employee_id: e.id, name: `${e.first_name} ${e.last_name}`, reason: 'No salary structure' }); continue; }
      const { lop, present } = lopFor(e.id, pd.start, pd.end, settings);
      const paidDays = Math.max(0, pd.working - lop);
      const adjustments = all<any>('SELECT * FROM payroll_adjustments WHERE employee_id = ? AND period = ?', [e.id, run_.period]);
      const b = computeBreakdown(s, pd.working ? paidDays / pd.working : 0, adjustments, settings);
      insert('payslips', { run_id: id, employee_id: e.id, working_days: pd.working, paid_days: paidDays, lop_days: lop, basic: b.basic, earnings: b.earnings, deductions: b.deductions, gross: b.gross, total_deductions: b.total_deductions, net: b.net, currency: s.currency, notes: present ? `Present days: ${present}` : null, status: 'generated', created_at: nowIso() });
      totals.employees += 1; totals.gross += b.gross; totals.deductions += b.total_deductions; totals.net += b.net;
    }
    update('payroll_runs', id, { status: 'processed', working_days: pd.working, totals: { ...totals, gross: round2(totals.gross), deductions: round2(totals.deductions), net: round2(totals.net), skipped: skipped.length }, processed_at: nowIso() });
  });
  audit(req, 'process', 'payroll_run', id, totals);
  res.json({ ...parseJson(get(`${runQuery} WHERE r.id = ?`, [id]), ['totals']), skipped });
}));
r.post('/runs/:id/status', requireHr, wrap(async (req, res) => {
  const id = toInt(req.params.id)!;
  const run_ = get<any>('SELECT * FROM payroll_runs WHERE id = ?', [id]);
  if (!run_) throw notFound();
  const next = req.body.status;
  const allowed: Record<string, string[]> = { draft: ['processed'], processed: ['approved', 'draft'], approved: ['paid', 'processed'], paid: [] };
  if (!allowed[run_.status]?.includes(next)) throw badRequest(`Cannot move a ${run_.status} run to ${next}`);
  const data: any = { status: next };
  if (next === 'approved') data.approved_at = nowIso();
  if (next === 'paid') { data.paid_at = nowIso(); run("UPDATE payslips SET status = 'paid' WHERE run_id = ?", [id]); }
  update('payroll_runs', id, data);
  audit(req, 'status', 'payroll_run', id, { status: next });
  res.json(parseJson(get(`${runQuery} WHERE r.id = ?`, [id]), ['totals']));
}));
r.delete('/runs/:id', requireHr, (req, res) => {
  const run_ = get<any>('SELECT * FROM payroll_runs WHERE id = ?', [toInt(req.params.id)]);
  if (!run_) throw notFound();
  if (run_.status === 'paid') throw badRequest('Paid runs cannot be deleted');
  run('DELETE FROM payroll_runs WHERE id = ?', [run_.id]);
  audit(req, 'delete', 'payroll_run', run_.id);
  res.json({ ok: true });
});

// ---------- Payslips ----------
const slipQuery = `SELECT p.*, r.period, r.status AS run_status, e.first_name || ' ' || e.last_name AS employee_name, e.employee_code, e.bank_account_number, e.bank_name, e.pf_number, e.tax_id, d.name AS department_name, po.title AS position_title
  FROM payslips p JOIN payroll_runs r ON r.id = p.run_id JOIN employees e ON e.id = p.employee_id LEFT JOIN departments d ON d.id = e.department_id LEFT JOIN positions po ON po.id = e.position_id`;
r.get('/payslips', requireAuth, (req, res) => {
  const where: string[] = [];
  const params: any[] = [];
  const vis = visibleEmployeeIds(req);
  if (vis) { if (!vis.length) return res.json([]); where.push(`p.employee_id IN (${vis.map(() => '?').join(',')})`); params.push(...vis); }
  if (req.user!.role !== 'hr') where.push("r.status IN ('approved','paid')");
  if (req.query.employee_id) { where.push('p.employee_id = ?'); params.push(toInt(req.query.employee_id)); }
  if (req.query.period) { where.push('r.period = ?'); params.push(req.query.period); }
  res.json(parseJsonAll(all(`${slipQuery}${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY r.period DESC, e.first_name`, params), ['earnings', 'deductions']));
});
r.get('/payslips/:id', requireAuth, (req, res) => {
  const row = parseJson(get<any>(`${slipQuery} WHERE p.id = ?`, [toInt(req.params.id)]), ['earnings', 'deductions']);
  if (!row) throw notFound();
  if (!canAccessEmployee(req, row.employee_id)) throw forbidden();
  if (req.user!.role !== 'hr' && !['approved', 'paid'].includes(row.run_status)) throw forbidden('Payslip not released yet');
  res.json(row);
});
r.put('/payslips/:id', requireHr, wrap(async (req, res) => {
  const id = toInt(req.params.id)!;
  const row = get<any>('SELECT p.*, r.status AS run_status FROM payslips p JOIN payroll_runs r ON r.id = p.run_id WHERE p.id = ?', [id]);
  if (!row) throw notFound();
  if (['approved', 'paid'].includes(row.run_status)) throw badRequest('Payslips in approved/paid runs are locked');
  const earnings = Array.isArray(req.body.earnings) ? req.body.earnings : JSON.parse(row.earnings);
  const deductions = Array.isArray(req.body.deductions) ? req.body.deductions : JSON.parse(row.deductions);
  const gross = round2(earnings.reduce((s: number, e: any) => s + Number(e.amount || 0), 0));
  const total = round2(deductions.reduce((s: number, e: any) => s + Number(e.amount || 0), 0));
  update('payslips', id, { earnings, deductions, gross, total_deductions: total, net: round2(gross - total), notes: req.body.notes ?? row.notes, paid_days: toNum(req.body.paid_days) ?? row.paid_days, lop_days: toNum(req.body.lop_days) ?? row.lop_days });
  audit(req, 'update', 'payslip', id);
  res.json(parseJson(get(`${slipQuery} WHERE p.id = ?`, [id]), ['earnings', 'deductions']));
}));

// ---------- Payslip requests (employees apply, HR fulfils / rejects) ----------
const reqQuery = `SELECT pr.*, e.first_name || ' ' || e.last_name AS employee_name, e.employee_code,
    COALESCE(he.first_name || ' ' || he.last_name, hu.email) AS handled_by_name,
    rr.status AS run_status, rr.id AS run_id
  FROM payslip_requests pr JOIN employees e ON e.id = pr.employee_id
  LEFT JOIN users hu ON hu.id = pr.handled_by LEFT JOIN employees he ON he.id = hu.employee_id
  LEFT JOIN payroll_runs rr ON rr.period = pr.period`;
const PERIOD_RE = /^\d{4}-\d{2}$/;

r.get('/payslip-requests', requireAuth, (req, res) => {
  const where: string[] = [];
  const params: any[] = [];
  if (req.user!.role !== 'hr') {
    if (!req.user!.employee_id) return res.json([]);
    where.push('pr.employee_id = ?');
    params.push(req.user!.employee_id);
  } else if (req.query.employee_id) { where.push('pr.employee_id = ?'); params.push(toInt(req.query.employee_id)); }
  if (req.query.status) { where.push('pr.status = ?'); params.push(String(req.query.status)); }
  res.json(all(`${reqQuery}${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY CASE pr.status WHEN 'pending' THEN 0 ELSE 1 END, pr.created_at DESC, pr.id DESC`, params));
});
r.post('/payslip-requests', requireAuth, wrap(async (req, res) => {
  const eid = req.user!.employee_id;
  if (!eid) throw badRequest('Your login is not linked to an employee record');
  requireFields(req.body, ['period']);
  const period = String(req.body.period);
  if (!PERIOD_RE.test(period)) throw badRequest('period must be YYYY-MM');
  const [y, m] = period.split('-').map(Number);
  if (m < 1 || m > 12) throw badRequest('period must be YYYY-MM');
  if (period > nowIso().slice(0, 7)) throw badRequest('You can only request payslips for the current or past months');
  if (y < 2000) throw badRequest('Period is too far in the past');
  if (get('SELECT 1 FROM payslip_requests WHERE employee_id = ? AND period = ? AND status = ?', [eid, period, 'pending'])) throw badRequest(`You already have a pending request for ${period}`);
  const id = insert('payslip_requests', { employee_id: eid, period, reason: req.body.reason ? String(req.body.reason).slice(0, 500) : null, status: 'pending', created_at: nowIso() });
  audit(req, 'create', 'payslip_request', id, { period });
  res.status(201).json(get(`${reqQuery} WHERE pr.id = ?`, [id]));
}));
r.post('/payslip-requests/:id/fulfil', requireHr, wrap(async (req, res) => {
  const id = toInt(req.params.id)!;
  const pr = get<any>('SELECT * FROM payslip_requests WHERE id = ?', [id]);
  if (!pr) throw notFound();
  if (pr.status !== 'pending') throw badRequest(`Request is already ${pr.status}`);
  const wanted = toInt(req.body?.payslip_id);
  let slip = wanted
    ? get<any>('SELECT p.id, p.employee_id, r.period, r.status FROM payslips p JOIN payroll_runs r ON r.id = p.run_id WHERE p.id = ?', [wanted])
    : get<any>('SELECT p.id, p.employee_id, r.period, r.status FROM payslips p JOIN payroll_runs r ON r.id = p.run_id WHERE p.employee_id = ? AND r.period = ?', [pr.employee_id, pr.period]);
  if (wanted && slip && (slip.employee_id !== pr.employee_id || slip.period !== pr.period)) throw badRequest('That payslip does not belong to this employee and period');
  if (!slip) {
    const run_ = get<any>('SELECT status FROM payroll_runs WHERE period = ?', [pr.period]);
    if (!run_) throw badRequest(`No payroll run for ${pr.period}. Create and approve the run first.`);
    if (run_.status === 'draft') throw badRequest(`The ${pr.period} run is still a draft. Process and approve it before fulfilling this request.`);
    throw badRequest(`The ${pr.period} run has no payslip for this employee (they may have been skipped for lack of a salary structure).`);
  }
  if (!['approved', 'paid'].includes(slip.status)) throw badRequest(`The ${pr.period} run is ${slip.status}; payslips are released only once the run is approved.`);
  update('payslip_requests', id, { status: 'fulfilled', payslip_id: slip.id, handled_by: req.user!.id, handled_at: nowIso(), note: req.body?.note ? String(req.body.note).slice(0, 500) : null });
  audit(req, 'fulfil', 'payslip_request', id, { payslip_id: slip.id });
  res.json(get(`${reqQuery} WHERE pr.id = ?`, [id]));
}));
r.post('/payslip-requests/:id/reject', requireHr, wrap(async (req, res) => {
  const id = toInt(req.params.id)!;
  const pr = get<any>('SELECT * FROM payslip_requests WHERE id = ?', [id]);
  if (!pr) throw notFound();
  if (pr.status !== 'pending') throw badRequest(`Request is already ${pr.status}`);
  update('payslip_requests', id, { status: 'rejected', handled_by: req.user!.id, handled_at: nowIso(), note: req.body?.note ? String(req.body.note).slice(0, 500) : null });
  audit(req, 'reject', 'payslip_request', id);
  res.json(get(`${reqQuery} WHERE pr.id = ?`, [id]));
}));

/** Summary for the HR payroll dashboard. */
r.get('/summary', requireHr, (_req, res) => {
  const withStructure = get<any>("SELECT COUNT(DISTINCT employee_id) AS n FROM salary_structures s JOIN employees e ON e.id = s.employee_id WHERE e.status != 'exited'")!.n;
  const activeEmployees = get<any>("SELECT COUNT(*) AS n FROM employees WHERE status != 'exited'")!.n;
  const runs = parseJsonAll(all(`${runQuery} ORDER BY r.period DESC LIMIT 6`), ['totals']);
  res.json({ activeEmployees, withStructure, withoutStructure: activeEmployees - withStructure, recentRuns: runs });
});

export default r;
