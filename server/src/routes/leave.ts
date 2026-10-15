import { Router } from 'express';
import { all, get, insert, update, run, getSetting, parseJson, parseJsonAll, transaction } from '../db.js';
import { requireAuth, requireHr, requireRole, canAccessEmployee, visibleEmployeeIds } from '../auth.js';
import { approverChain, canApproveFor, approvableEmployeeIds, defaultApprover } from '../approvers.js';
import { badRequest, notFound, forbidden, pick, requireFields, audit, toInt, toNum, nowIso, today, wrap, eachDay, assertDate } from '../util.js';
import { assertPeriodOpen } from '../ops/payrollCalendar.js';
import { DEFAULT_LEAVE_SETTINGS, DEFAULT_ATTENDANCE_SETTINGS } from './settings.js';

const r = Router();

// ---------- Leave types ----------
const T_COLS = ['name', 'code', 'annual_quota', 'paid', 'carry_forward', 'max_carry_forward', 'requires_document', 'min_notice_days', 'allow_half_day', 'color', 'active'];
r.get('/types', requireAuth, (_req, res) => res.json(all('SELECT * FROM leave_types ORDER BY active DESC, name')));
r.post('/types', requireHr, wrap(async (req, res) => {
  requireFields(req.body, ['name', 'code']);
  const data: any = pick(req.body, T_COLS);
  data.code = String(data.code).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const id = insert('leave_types', data);
  // Give every active employee a balance for this year.
  const year = new Date().getFullYear();
  for (const e of all<any>("SELECT id FROM employees WHERE status != 'exited'")) {
    insert('leave_balances', { employee_id: e.id, leave_type_id: id, year, allocated: toNum(data.annual_quota) ?? 0, carried: 0, adjusted: 0, used: 0 });
  }
  audit(req, 'create', 'leave_type', id);
  res.status(201).json(get('SELECT * FROM leave_types WHERE id = ?', [id]));
}));
r.put('/types/:id', requireHr, wrap(async (req, res) => {
  const id = toInt(req.params.id)!;
  if (!get('SELECT 1 FROM leave_types WHERE id = ?', [id])) throw notFound();
  const data: any = pick(req.body, T_COLS.filter((c) => c !== 'code'));
  update('leave_types', id, data);
  if (data.annual_quota !== undefined && req.body.apply_quota_to_all) run('UPDATE leave_balances SET allocated = ? WHERE leave_type_id = ? AND year = ?', [toNum(data.annual_quota), id, new Date().getFullYear()]);
  audit(req, 'update', 'leave_type', id);
  res.json(get('SELECT * FROM leave_types WHERE id = ?', [id]));
}));
r.delete('/types/:id', requireHr, (req, res) => {
  const id = toInt(req.params.id)!;
  if (get('SELECT 1 FROM leave_requests WHERE leave_type_id = ?', [id])) throw badRequest('Leave type has requests; deactivate it instead');
  if (!run('DELETE FROM leave_types WHERE id = ?', [id]).changes) throw notFound();
  res.json({ ok: true });
});

// ---------- Balances ----------
function ensureBalances(employeeId: number, year: number) {
  for (const lt of all<any>('SELECT * FROM leave_types WHERE active = 1')) {
    if (!get('SELECT 1 FROM leave_balances WHERE employee_id = ? AND leave_type_id = ? AND year = ?', [employeeId, lt.id, year])) {
      insert('leave_balances', { employee_id: employeeId, leave_type_id: lt.id, year, allocated: lt.annual_quota, carried: 0, adjusted: 0, used: 0 });
    }
  }
}
function balances(employeeId: number, year: number) {
  ensureBalances(employeeId, year);
  return all<any>(`SELECT b.*, t.name, t.code, t.color, t.paid, t.allow_half_day, t.requires_document, t.min_notice_days, t.active,
                   (b.allocated + b.carried + b.adjusted - b.used) AS available,
                   (SELECT COALESCE(SUM(days),0) FROM leave_requests l WHERE l.employee_id = b.employee_id AND l.leave_type_id = b.leave_type_id AND l.status = 'pending' AND substr(l.start_date,1,4) = CAST(b.year AS TEXT)) AS pending
                   FROM leave_balances b JOIN leave_types t ON t.id = b.leave_type_id WHERE b.employee_id = ? AND b.year = ? AND t.active = 1 ORDER BY t.name`, [employeeId, year]);
}
r.get('/balances/:employeeId', requireAuth, (req, res) => {
  const eid = toInt(req.params.employeeId)!;
  if (!canAccessEmployee(req, eid)) throw forbidden();
  const year = toInt(req.query.year, new Date().getFullYear())!;
  res.json(balances(eid, year));
});
r.get('/balances', requireHr, (req, res) => {
  const year = toInt(req.query.year, new Date().getFullYear())!;
  const emps = all<any>("SELECT id, employee_code, first_name, last_name FROM employees WHERE status != 'exited' ORDER BY first_name");
  res.json({ year, types: all('SELECT id, name, code, color FROM leave_types WHERE active = 1 ORDER BY name'), rows: emps.map((e) => ({ employee: e, balances: balances(e.id, year) })) });
});
r.put('/balances/:employeeId/:leaveTypeId', requireHr, wrap(async (req, res) => {
  const eid = toInt(req.params.employeeId)!, lt = toInt(req.params.leaveTypeId)!;
  const year = toInt(req.body.year, new Date().getFullYear())!;
  ensureBalances(eid, year);
  const data: any = pick(req.body, ['allocated', 'carried', 'adjusted']);
  const row = get<any>('SELECT id FROM leave_balances WHERE employee_id = ? AND leave_type_id = ? AND year = ?', [eid, lt, year]);
  if (!row) throw notFound();
  update('leave_balances', row.id, data);
  audit(req, 'adjust', 'leave_balance', row.id, data);
  res.json(balances(eid, year));
}));

// ---------- Requests ----------
function countDays(start: string, end: string, halfDay: string | null) {
  const settings = getSetting('leave', DEFAULT_LEAVE_SETTINGS);
  const offs: number[] = getSetting('attendance', DEFAULT_ATTENDANCE_SETTINGS).weekly_offs || [0, 6];
  const holidays = new Set(all<any>('SELECT date FROM holidays WHERE date BETWEEN ? AND ? AND optional = 0', [start, end]).map((h) => h.date));
  const days = eachDay(start, end);
  if (halfDay) return 0.5;
  if (settings.sandwich_rule) return days.length;
  return days.filter((d) => !offs.includes(new Date(d + 'T00:00:00Z').getUTCDay()) && !holidays.has(d)).length;
}
function overlaps(employeeId: number, start: string, end: string, excludeId?: number) {
  const params: any[] = [employeeId, start, end];
  let sql = "SELECT 1 FROM leave_requests WHERE employee_id = ? AND status IN ('pending','approved','correction_pending') AND end_date >= ? AND start_date <= ?";
  if (excludeId) { sql += ' AND id != ?'; params.push(excludeId); }
  return get(sql, params);
}
const reqQuery = `SELECT l.*, t.name AS leave_type_name, t.code AS leave_type_code, t.color, t.paid, e.first_name || ' ' || e.last_name AS employee_name, e.employee_code, e.manager_id, d.name AS department_name, u.email AS reviewer_email,
  ap.first_name || ' ' || ap.last_name AS approver_name, ru.email AS reviewer_email2, re.first_name || ' ' || re.last_name AS reviewer_name
  FROM leave_requests l JOIN leave_types t ON t.id = l.leave_type_id JOIN employees e ON e.id = l.employee_id LEFT JOIN departments d ON d.id = e.department_id LEFT JOIN users u ON u.id = l.reviewed_by
  LEFT JOIN employees ap ON ap.id = l.approver_employee_id LEFT JOIN users ru ON ru.id = l.reviewed_by LEFT JOIN employees re ON re.id = ru.employee_id`;

r.get('/requests', requireAuth, (req, res) => {
  const where: string[] = [];
  const params: any[] = [];
  const vis = visibleEmployeeIds(req);
  if (vis) { if (!vis.length) return res.json([]); where.push(`l.employee_id IN (${vis.map(() => '?').join(',')})`); params.push(...vis); }
  if (req.query.employee_id) { where.push('l.employee_id = ?'); params.push(toInt(req.query.employee_id)); }
  if (req.query.status) { where.push('l.status = ?'); params.push(req.query.status); }
  if (req.query.from) { where.push('l.end_date >= ?'); params.push(req.query.from); }
  if (req.query.to) { where.push('l.start_date <= ?'); params.push(req.query.to); }
  res.json(parseJsonAll(all(`${reqQuery}${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY l.created_at DESC`, params), ['correction']));
});
/** Team calendar: approved + pending leaves in a date range. */
r.get('/calendar', requireAuth, (req, res) => {
  const from = String(req.query.from || today().slice(0, 7) + '-01');
  const to = String(req.query.to || today().slice(0, 7) + '-31');
  const rows = all(`${reqQuery} WHERE l.status IN ('approved','pending','correction_pending') AND l.end_date >= ? AND l.start_date <= ? ORDER BY l.start_date`, [from, to]);
  res.json({ from, to, items: rows, holidays: all('SELECT * FROM holidays WHERE date BETWEEN ? AND ?', [from, to]) });
});
r.get('/requests/:id', requireAuth, (req, res) => {
  const row = parseJson(get<any>(`${reqQuery} WHERE l.id = ?`, [toInt(req.params.id)]), ['correction']);
  if (!row) throw notFound();
  if (!canAccessEmployee(req, row.employee_id)) throw forbidden();
  res.json({ ...row, history: parseJsonAll(all('SELECT h.*, u.email FROM leave_history h LEFT JOIN users u ON u.id = h.by_user WHERE h.leave_request_id = ? ORDER BY h.id', [row.id]), ['snapshot']) });
});

function validateRequest(eid: number, body: any, excludeId?: number) {
  requireFields(body, ['leave_type_id', 'start_date', 'end_date']);
  assertDate(body.start_date, 'start_date');
  assertDate(body.end_date, 'end_date');
  if (body.end_date < body.start_date) throw badRequest('End date must be on or after start date');
  const lt = get<any>('SELECT * FROM leave_types WHERE id = ? AND active = 1', [toInt(body.leave_type_id)]);
  if (!lt) throw badRequest('Invalid leave type');
  const halfDay = body.half_day && body.half_day !== 'none' ? String(body.half_day) : null;
  if (halfDay && !lt.allow_half_day) throw badRequest(`${lt.name} cannot be taken as a half day`);
  if (halfDay && body.start_date !== body.end_date) throw badRequest('Half-day leave must be a single day');
  const settings = getSetting('leave', DEFAULT_LEAVE_SETTINGS);
  const days = countDays(body.start_date, body.end_date, halfDay);
  if (days <= 0) throw badRequest('The selected range contains no working days');
  if (days > (settings.max_consecutive_days || 365)) throw badRequest(`Maximum ${settings.max_consecutive_days} days per request`);
  if (overlaps(eid, body.start_date, body.end_date, excludeId)) throw badRequest('This overlaps with an existing leave request');
  return { lt, halfDay, days, settings };
}

r.post('/requests', requireAuth, wrap(async (req, res) => {
  const eid = req.user!.role === 'hr' && req.body.employee_id ? toInt(req.body.employee_id)! : req.user!.employee_id;
  if (!eid) throw badRequest('Your login is not linked to an employee record');
  if (!get('SELECT 1 FROM employees WHERE id = ?', [eid])) throw notFound('Employee not found');
  const { lt, halfDay, days, settings } = validateRequest(eid, req.body);
  if (req.user!.role !== 'hr' && lt.min_notice_days > 0) {
    const noticeOk = Math.floor((Date.parse(req.body.start_date) - Date.parse(today())) / 86400000) >= lt.min_notice_days;
    if (!noticeOk) throw badRequest(`${lt.name} needs at least ${lt.min_notice_days} day(s) notice`);
  }
  const year = Number(req.body.start_date.slice(0, 4));
  const bal = balances(eid, year).find((b) => b.leave_type_id === lt.id);
  if (lt.paid && !settings.allow_negative_balance && bal && bal.available - bal.pending < days) throw badRequest(`Insufficient ${lt.name} balance (${bal.available - bal.pending} available, ${days} requested)`);
  const autoApprove = req.user!.role === 'hr' && req.body.auto_approve;
  const id = transaction(() => {
    const x = insert('leave_requests', { employee_id: eid, leave_type_id: lt.id, start_date: req.body.start_date, end_date: req.body.end_date, half_day: halfDay, days, reason: req.body.reason || null, status: autoApprove ? 'approved' : 'pending', requested_by: req.user!.id, approver_employee_id: defaultApprover(eid)?.employee_id ?? null, reviewed_by: autoApprove ? req.user!.id : null, reviewed_at: autoApprove ? nowIso() : null, created_at: nowIso(), updated_at: nowIso() });
    insert('leave_history', { leave_request_id: x, action: autoApprove ? 'approved' : 'applied', by_user: req.user!.id, note: req.body.reason || null, created_at: nowIso() });
    if (autoApprove) applyBalance(eid, lt.id, year, days);
    return x;
  });
  audit(req, 'apply', 'leave_request', id, { days });
  res.status(201).json(parseJson(get(`${reqQuery} WHERE l.id = ?`, [id]), ['correction']));
}));
function applyBalance(eid: number, ltId: number, year: number, delta: number) {
  ensureBalances(eid, year);
  run('UPDATE leave_balances SET used = used + ? WHERE employee_id = ? AND leave_type_id = ? AND year = ?', [delta, eid, ltId, year]);
}

/** Approve / reject (manager for reports, HR for anyone). */
r.post('/requests/:id/review', requireRole('manager'), wrap(async (req, res) => {
  const l = get<any>('SELECT * FROM leave_requests WHERE id = ?', [toInt(req.params.id)]);
  if (!l) throw notFound();
  if (!canApproveFor(req, l.employee_id)) throw forbidden('Only the reporting manager hierarchy or HR can review this request');
  const decision = req.body.decision === 'approve' ? 'approved' : req.body.decision === 'reject' ? 'rejected' : null;
  if (!decision) throw badRequest('decision must be approve or reject');
  if (decision === 'approved') assertPeriodOpen(l.start_date, l.end_date);
  const year = Number(l.start_date.slice(0, 4));
  transaction(() => {
    if (l.status === 'pending') {
      update('leave_requests', l.id, { status: decision, reviewed_by: req.user!.id, reviewed_at: nowIso(), review_note: req.body.note || null, updated_at: nowIso() });
      if (decision === 'approved') applyBalance(l.employee_id, l.leave_type_id, year, l.days);
    } else if (l.status === 'correction_pending') {
      const c = JSON.parse(l.correction || '{}');
      if (decision === 'approved') {
        applyBalance(l.employee_id, l.leave_type_id, year, -l.days);
        applyBalance(l.employee_id, l.leave_type_id, Number(c.start_date.slice(0, 4)), c.days);
        update('leave_requests', l.id, { status: 'approved', start_date: c.start_date, end_date: c.end_date, half_day: c.half_day, days: c.days, reason: c.reason ?? l.reason, correction: null, reviewed_by: req.user!.id, reviewed_at: nowIso(), review_note: req.body.note || null, updated_at: nowIso() });
      } else {
        update('leave_requests', l.id, { status: 'approved', correction: null, review_note: req.body.note || null, updated_at: nowIso() });
      }
    } else throw badRequest(`Request is already ${l.status}`);
    insert('leave_history', { leave_request_id: l.id, action: `${l.status === 'correction_pending' ? 'correction_' : ''}${decision}`, by_user: req.user!.id, note: req.body.note || null, snapshot: { status: l.status, days: l.days, start_date: l.start_date, end_date: l.end_date }, created_at: nowIso() });
  });
  audit(req, decision, 'leave_request', l.id);
  res.json(parseJson(get(`${reqQuery} WHERE l.id = ?`, [l.id]), ['correction']));
}));

/** Cancel: pending by employee any time; approved by employee before start, by HR any time (balance restored). */
r.post('/requests/:id/cancel', requireAuth, wrap(async (req, res) => {
  const l = get<any>('SELECT * FROM leave_requests WHERE id = ?', [toInt(req.params.id)]);
  if (!l) throw notFound();
  const self = req.user!.employee_id === l.employee_id;
  if (!self && req.user!.role !== 'hr') throw forbidden();
  if (!['pending', 'approved', 'correction_pending'].includes(l.status)) throw badRequest(`Cannot cancel a ${l.status} request`);
  if (self && req.user!.role !== 'hr' && l.status !== 'pending' && l.start_date <= today()) throw badRequest('Leave that has already started can only be cancelled by HR');
  if (l.status !== 'pending') assertPeriodOpen(l.start_date, l.end_date);
  transaction(() => {
    if (l.status !== 'pending') applyBalance(l.employee_id, l.leave_type_id, Number(l.start_date.slice(0, 4)), -l.days);
    update('leave_requests', l.id, { status: 'cancelled', correction: null, updated_at: nowIso(), review_note: req.body.note || l.review_note });
    insert('leave_history', { leave_request_id: l.id, action: 'cancelled', by_user: req.user!.id, note: req.body.note || null, created_at: nowIso() });
  });
  audit(req, 'cancel', 'leave_request', l.id);
  res.json(parseJson(get(`${reqQuery} WHERE l.id = ?`, [l.id]), ['correction']));
}));

/** Correction: employee edits a pending request directly, or proposes changes to an approved one (needs re-approval). HR edits directly. */
r.put('/requests/:id', requireAuth, wrap(async (req, res) => {
  const l = get<any>('SELECT * FROM leave_requests WHERE id = ?', [toInt(req.params.id)]);
  if (!l) throw notFound();
  const self = req.user!.employee_id === l.employee_id;
  if (!self && req.user!.role !== 'hr') throw forbidden();
  const body = { ...l, ...pick(req.body, ['leave_type_id', 'start_date', 'end_date', 'half_day', 'reason']) };
  const { lt, halfDay, days } = validateRequest(l.employee_id, body, l.id);
  if (l.status === 'pending' || (req.user!.role === 'hr' && l.status === 'approved')) {
    if (l.status === 'approved') assertPeriodOpen(l.start_date, l.end_date, body.start_date, body.end_date);
    transaction(() => {
      if (l.status === 'approved') {
        applyBalance(l.employee_id, l.leave_type_id, Number(l.start_date.slice(0, 4)), -l.days);
        applyBalance(l.employee_id, lt.id, Number(body.start_date.slice(0, 4)), days);
      }
      update('leave_requests', l.id, { leave_type_id: lt.id, start_date: body.start_date, end_date: body.end_date, half_day: halfDay, days, reason: body.reason, updated_at: nowIso() });
      insert('leave_history', { leave_request_id: l.id, action: 'corrected', by_user: req.user!.id, note: req.body.note || null, snapshot: { start_date: l.start_date, end_date: l.end_date, days: l.days }, created_at: nowIso() });
    });
  } else if (l.status === 'approved') {
    if (lt.id !== l.leave_type_id) throw badRequest('Leave type cannot be changed on an approved request; cancel and re-apply');
    transaction(() => {
      update('leave_requests', l.id, { status: 'correction_pending', correction: { start_date: body.start_date, end_date: body.end_date, half_day: halfDay, days, reason: body.reason }, updated_at: nowIso() });
      insert('leave_history', { leave_request_id: l.id, action: 'correction_requested', by_user: req.user!.id, note: req.body.note || null, snapshot: { start_date: body.start_date, end_date: body.end_date, days }, created_at: nowIso() });
    });
  } else throw badRequest(`Cannot edit a ${l.status} request`);
  audit(req, 'correct', 'leave_request', l.id);
  res.json(parseJson(get(`${reqQuery} WHERE l.id = ?`, [l.id]), ['correction']));
}));

/** Pending approvals visible to the current reviewer: everyone below them in the reporting hierarchy (HR: everyone). */
r.get('/approvals/pending', requireRole('manager'), (req, res) => {
  const ids = approvableEmployeeIds(req);
  if (ids && !ids.length) return res.json([]);
  const where = ids ? ` AND l.employee_id IN (${ids.map(() => '?').join(',')})` : '';
  res.json(parseJsonAll(all(`${reqQuery} WHERE l.status IN ('pending','correction_pending')${where} ORDER BY l.start_date`, ids ?? []), ['correction']));
});
/** The approval chain for an employee (who a request goes to, and who may escalate). */
r.get('/approvers/:employeeId', requireAuth, (req, res) => {
  const eid = toInt(req.params.employeeId)!;
  if (!canAccessEmployee(req, eid)) throw forbidden();
  res.json({ chain: approverChain(eid), default: defaultApprover(eid) });
});

export default r;
