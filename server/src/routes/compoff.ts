import { Router } from 'express';
import type { Request } from 'express';
import { all, get, insert, update, run, getSetting, transaction } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { approvableEmployeeIds, canApproveFor, defaultApprover } from '../approvers.js';
import { badRequest, notFound, forbidden, audit, toInt, nowIso, today, wrap, addDays } from '../util.js';
import { DEFAULT_LEAVE_SETTINGS, DEFAULT_ATTENDANCE_SETTINGS } from './settings.js';

/**
 * Comp-off automation. Extra working days (weekly offs, holidays, optionally long days) are detected
 * from attendance records and surfaced to the employee as "detected" credits. The employee confirms
 * (request), the reporting manager approves, and the credit lands in the Comp Off leave balance
 * (leave_balances.adjusted) with an expiry. Mounted at /api/compoff.
 */
const r = Router();

export type CompOffSettings = typeof DEFAULT_LEAVE_SETTINGS.comp_off;
export function compOffSettings(): CompOffSettings {
  const leave = getSetting('leave', DEFAULT_LEAVE_SETTINGS);
  return { ...DEFAULT_LEAVE_SETTINGS.comp_off, ...(leave?.comp_off || {}) };
}
function attendanceSettings() {
  return { ...DEFAULT_ATTENDANCE_SETTINGS, ...getSetting('attendance', DEFAULT_ATTENDANCE_SETTINGS) };
}
/** Days credited for the minutes worked, per the configured thresholds. 0 = not enough to earn anything. */
export function creditDays(minutes: number, co: CompOffSettings): number {
  if (minutes >= (co.full_day_minutes || 480)) return 1;
  if (minutes >= (co.half_day_minutes || 240)) return 0.5;
  return 0;
}

/** How far back detection looks (days). */
export const DETECT_WINDOW_DAYS = 60;

/**
 * Scan recent attendance and create "detected" credits. Idempotent: UNIQUE(employee_id, worked_date)
 * means a date is only ever credited once, and existing rows (any status, including dismissed) are skipped.
 */
export function detectCompOff(): { created: number; scanned: number; enabled: boolean } {
  const co = compOffSettings();
  if (!co.enabled) return { created: 0, scanned: 0, enabled: false };
  const att = attendanceSettings();
  const weeklyOffs: number[] = Array.isArray(att.weekly_offs) ? att.weekly_offs : [0, 6];
  const standard = Number(att.standard_work_minutes) || 540;
  const threshold = Number(co.extra_hours_threshold_minutes) || 0;
  const expiryDays = Number(co.expiry_days) || 90;
  const from = addDays(today(), -DETECT_WINDOW_DAYS), to = today();
  const holidays = new Map(all<any>('SELECT date, name FROM holidays WHERE date BETWEEN ? AND ? AND optional = 0', [from, to]).map((h) => [h.date, h.name]));
  const existing = new Set(all<any>('SELECT employee_id, worked_date FROM comp_off_credits WHERE worked_date BETWEEN ? AND ?', [from, to]).map((c) => `${c.employee_id}|${c.worked_date}`));
  const records = all<any>(
    `SELECT a.employee_id, a.date, a.work_minutes FROM attendance_records a JOIN employees e ON e.id = a.employee_id
     WHERE a.date BETWEEN ? AND ? AND a.status IN ('present','wfh','half_day') AND a.work_minutes > 0 AND e.status != 'exited'`, [from, to]);
  let created = 0;
  const now = nowIso();
  transaction(() => {
    for (const rec of records) {
      if (existing.has(`${rec.employee_id}|${rec.date}`)) continue;
      const dow = new Date(rec.date + 'T00:00:00Z').getUTCDay();
      let reason: 'weekly_off' | 'holiday' | 'extra_hours' | null = null;
      let minutesForCredit = rec.work_minutes;
      if (holidays.has(rec.date) && co.on_holiday) reason = 'holiday';
      else if (weeklyOffs.includes(dow) && co.on_weekly_off) reason = 'weekly_off';
      else if (threshold > 0 && !holidays.has(rec.date) && !weeklyOffs.includes(dow) && rec.work_minutes > standard + threshold) {
        reason = 'extra_hours';
        minutesForCredit = rec.work_minutes - standard; // only the extra time earns the credit
      }
      if (!reason) continue;
      const days = creditDays(minutesForCredit, co);
      if (!days) continue;
      insert('comp_off_credits', {
        employee_id: rec.employee_id, worked_date: rec.date, reason, work_minutes: rec.work_minutes, days, status: 'detected',
        approver_employee_id: defaultApprover(rec.employee_id)?.employee_id ?? null, requested_by: null, reviewed_by: null, reviewed_at: null, review_note: null,
        expires_on: addDays(rec.date, expiryDays), created_at: now,
      });
      existing.add(`${rec.employee_id}|${rec.date}`);
      created += 1;
    }
  });
  return { created, scanned: records.length, enabled: true };
}
/** Credits past their expiry that were never approved are closed as expired. */
function expireStale() {
  run("UPDATE comp_off_credits SET status = 'expired' WHERE status IN ('detected','pending') AND expires_on IS NOT NULL AND expires_on < ?", [today()]);
}

const SELECT = `SELECT c.*, e.first_name || ' ' || e.last_name AS employee_name, e.employee_code, d.name AS department_name,
  ap.first_name || ' ' || ap.last_name AS approver_name, re.first_name || ' ' || re.last_name AS reviewer_name, ru.email AS reviewer_email,
  h.name AS holiday_name, CASE WHEN c.expires_on IS NOT NULL AND c.expires_on < ? AND c.status IN ('detected','pending','expired') THEN 1 ELSE 0 END AS expired
  FROM comp_off_credits c JOIN employees e ON e.id = c.employee_id LEFT JOIN departments d ON d.id = e.department_id
  LEFT JOIN employees ap ON ap.id = c.approver_employee_id LEFT JOIN users ru ON ru.id = c.reviewed_by LEFT JOIN employees re ON re.id = ru.employee_id
  LEFT JOIN holidays h ON h.date = c.worked_date AND h.optional = 0`;
function load(id: number) {
  return get<any>(`${SELECT} WHERE c.id = ?`, [today(), id]);
}
/** Employee ids visible to the signed-in user: self + everyone below them; HR: undefined (all). */
function scopeIds(req: Request): number[] | undefined {
  const ids = approvableEmployeeIds(req);
  if (!ids) return undefined;
  const self = req.user?.employee_id;
  return self ? [self, ...ids] : ids;
}
function compOffLeaveType() {
  const co = compOffSettings();
  const lt = get<any>('SELECT id, code FROM leave_types WHERE code = ?', [co.leave_type_code || 'CO']);
  if (!lt) throw badRequest(`Comp Off leave type (${co.leave_type_code || 'CO'}) is not configured`);
  return lt;
}
/** Add `days` to the employee's Comp Off balance for the year of the worked date (creating the balance row when needed). */
function creditBalance(employeeId: number, workedDate: string, days: number) {
  const lt = compOffLeaveType();
  const year = Number(workedDate.slice(0, 4));
  if (!get('SELECT 1 FROM leave_balances WHERE employee_id = ? AND leave_type_id = ? AND year = ?', [employeeId, lt.id, year])) {
    insert('leave_balances', { employee_id: employeeId, leave_type_id: lt.id, year, allocated: 0, carried: 0, adjusted: 0, used: 0 });
  }
  run('UPDATE leave_balances SET adjusted = adjusted + ? WHERE employee_id = ? AND leave_type_id = ? AND year = ?', [days, employeeId, lt.id, year]);
}
function approve(req: Request, c: any, note: string | null) {
  transaction(() => {
    update('comp_off_credits', c.id, { status: 'approved', reviewed_by: req.user!.id, reviewed_at: nowIso(), review_note: note });
    creditBalance(c.employee_id, c.worked_date, c.days);
  });
}

// ---------- Detection ----------
r.post('/detect', requireRole('manager'), wrap(async (req, res) => {
  const out = detectCompOff();
  expireStale();
  audit(req, 'detect', 'comp_off', null, out);
  res.json(out);
}));

// ---------- Lists ----------
/** Credits in scope (own / reporting chain / all). Detection runs first so the list is always current. */
r.get('/', requireAuth, (req, res) => {
  try { detectCompOff(); } catch { /* a detection problem must not hide existing credits */ }
  expireStale();
  const where: string[] = [];
  const params: any[] = [today()];
  const ids = scopeIds(req);
  if (ids) {
    if (!ids.length) return res.json([]);
    where.push(`c.employee_id IN (${ids.map(() => '?').join(',')})`);
    params.push(...ids);
  }
  if (req.query.employee_id) { where.push('c.employee_id = ?'); params.push(toInt(req.query.employee_id)); }
  if (req.query.status) { where.push('c.status = ?'); params.push(String(req.query.status)); }
  res.json(all(`${SELECT}${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY c.worked_date DESC, c.id DESC`, params));
});
/** Approvals waiting on me: pending credits from everyone below me in the hierarchy (HR: everyone). */
r.get('/pending', requireRole('manager'), (req, res) => {
  expireStale();
  const ids = approvableEmployeeIds(req);
  if (ids && !ids.length) return res.json([]);
  const where = ids ? ` AND c.employee_id IN (${ids.map(() => '?').join(',')})` : '';
  res.json(all(`${SELECT} WHERE c.status = 'pending'${where} ORDER BY c.worked_date`, [today(), ...(ids ?? [])]));
});
/** Counts by status in scope, plus the criteria currently in force. */
r.get('/summary', requireAuth, (req, res) => {
  expireStale();
  const ids = scopeIds(req);
  const where = ids ? (ids.length ? ` WHERE employee_id IN (${ids.map(() => '?').join(',')})` : ' WHERE 0') : '';
  const rows = all<any>(`SELECT status, COUNT(*) AS n, COALESCE(SUM(days),0) AS days FROM comp_off_credits${where} GROUP BY status`, ids ?? []);
  const counts: Record<string, number> = { detected: 0, pending: 0, approved: 0, rejected: 0, expired: 0, total: 0 };
  let approvedDays = 0;
  for (const x of rows) { counts[x.status] = x.n; counts.total += x.n; if (x.status === 'approved') approvedDays = x.days; }
  res.json({ counts, approved_days: approvedDays, criteria: compOffSettings(), weekly_offs: attendanceSettings().weekly_offs, window_days: DETECT_WINDOW_DAYS });
});
r.get('/:id', requireAuth, (req, res) => {
  const c = load(toInt(req.params.id)!);
  if (!c) throw notFound('Credit not found');
  const ids = scopeIds(req);
  if (ids && !ids.includes(c.employee_id)) throw forbidden();
  res.json(c);
});

// ---------- Workflow ----------
/** Employee (or HR) confirms a detected credit; it goes to the approver, or straight to the balance when approval is not required. */
r.post('/:id/request', requireAuth, wrap(async (req, res) => {
  const c = load(toInt(req.params.id)!);
  if (!c) throw notFound('Credit not found');
  if (c.employee_id !== req.user!.employee_id && req.user!.role !== 'hr') throw forbidden('Only the employee or HR can request this credit');
  if (c.status !== 'detected') throw badRequest(`Credit is already ${c.status}`);
  if (c.expired) throw badRequest(`This credit expired on ${c.expires_on}`);
  const co = compOffSettings();
  if (!co.enabled) throw forbidden('Comp off is disabled in Leave settings');
  const approver = defaultApprover(c.employee_id)?.employee_id ?? null;
  update('comp_off_credits', c.id, { status: 'pending', requested_by: req.user!.id, approver_employee_id: approver });
  if (!co.requires_manager_approval) approve(req, c, 'auto-approved (no manager approval required)');
  audit(req, 'request', 'comp_off', c.id, { days: c.days });
  res.json(load(c.id));
}));

/** Approve / reject: anyone in the employee's reporting chain, or HR. */
r.post('/:id/review', requireRole('manager'), wrap(async (req, res) => {
  const c = load(toInt(req.params.id)!);
  if (!c) throw notFound('Credit not found');
  if (!canApproveFor(req, c.employee_id)) throw forbidden('Only the reporting manager hierarchy or HR can review this credit');
  const decision = req.body?.decision === 'approve' ? 'approved' : req.body?.decision === 'reject' ? 'rejected' : null;
  if (!decision) throw badRequest('decision must be approve or reject');
  if (c.status !== 'pending') throw badRequest(`Credit is ${c.status}, only pending credits can be reviewed`);
  if (c.expired) throw badRequest(`This credit expired on ${c.expires_on}`);
  const note = req.body?.note ? String(req.body.note).slice(0, 500) : null;
  if (decision === 'approved') approve(req, c, note);
  else update('comp_off_credits', c.id, { status: 'rejected', reviewed_by: req.user!.id, reviewed_at: nowIso(), review_note: note });
  audit(req, decision, 'comp_off', c.id, { days: c.days });
  res.json(load(c.id));
}));

/** Employee hides a detected credit they do not want to claim. */
r.post('/:id/dismiss', requireAuth, wrap(async (req, res) => {
  const c = load(toInt(req.params.id)!);
  if (!c) throw notFound('Credit not found');
  if (c.employee_id !== req.user!.employee_id && req.user!.role !== 'hr') throw forbidden();
  if (c.status !== 'detected') throw badRequest(`Credit is already ${c.status}`);
  update('comp_off_credits', c.id, { status: 'rejected', reviewed_by: req.user!.id, reviewed_at: nowIso(), review_note: req.user!.role === 'hr' && c.employee_id !== req.user!.employee_id ? 'dismissed by HR' : 'dismissed by employee' });
  audit(req, 'dismiss', 'comp_off', c.id);
  res.json(load(c.id));
}));

export default r;
