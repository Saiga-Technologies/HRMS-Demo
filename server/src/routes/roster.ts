import { Router, type Request } from 'express';
import { all, get, run, transaction, parseJsonAll } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { approvableEmployeeIds } from '../approvers.js';
import { HttpError, badRequest, notFound, toInt, nowIso, today, addDays, eachDay, isIsoDate, round2 } from '../util.js';
import { attendanceSettings } from './attendance.js';

/**
 * Shift roster. The effective shift for an employee on a date is the explicit shift_assignments
 * row when one exists (shift_id NULL = day off), otherwise the employee's default shift. Weekly
 * offs come from settings.attendance.weekly_offs and holidays from the holidays table.
 * Scope: employees see themselves, managers their reporting chain + self, HR everyone.
 * Mounted at /api/roster.
 */
const r = Router();
const MAX_RANGE_DAYS = 92;

export interface Shift { id: number; name: string; start_time: string; end_time: string; working_days: number[]; active: number; full_day_minutes: number }

/** Minutes between two HH:MM times, wrapping past midnight for night shifts. */
export function shiftMinutes(s: { start_time: string; end_time: string }): number {
  const [sh, sm] = s.start_time.split(':').map(Number);
  const [eh, em] = s.end_time.split(':').map(Number);
  let m = eh * 60 + em - (sh * 60 + sm);
  if (m <= 0) m += 24 * 60;
  return m;
}

/** Monday of the week containing `date`. */
export function weekStart(date: string): string {
  const d = new Date(date + 'T00:00:00Z');
  const dow = d.getUTCDay();
  return addDays(date, dow === 0 ? -6 : 1 - dow);
}

function parseRange(req: Request): { from: string; to: string } {
  const from = req.query.from ? String(req.query.from) : weekStart(today());
  const to = req.query.to ? String(req.query.to) : addDays(from, 6);
  if (!isIsoDate(from) || !isIsoDate(to)) throw badRequest('from and to must be YYYY-MM-DD');
  if (to < from) throw badRequest('to must be on or after from');
  if (eachDay(from, to).length > MAX_RANGE_DAYS) throw badRequest(`Range cannot exceed ${MAX_RANGE_DAYS} days`);
  return { from, to };
}

/** Employee ids the signed-in user may view (undefined = everyone, for HR). */
function viewableIds(req: Request): number[] | undefined {
  const user = req.user!;
  if (user.role === 'hr') return undefined;
  const ids = user.employee_id ? [user.employee_id] : [];
  if (user.role === 'manager') ids.push(...(approvableEmployeeIds(req) || []));
  return ids;
}
/** Employee ids the signed-in user may assign shifts for (undefined = everyone, for HR). Managers: their reporting chain. */
function assignableIds(req: Request): number[] | undefined {
  if (req.user!.role === 'hr') return undefined;
  return approvableEmployeeIds(req) || [];
}
function assertAssignable(req: Request, employeeIds: number[]) {
  const allowed = assignableIds(req);
  if (!allowed) return;
  const denied = employeeIds.filter((id) => !allowed.includes(id));
  if (denied.length) throw new HttpError(403, `You can only assign shifts for your reporting chain (employee ${denied.join(', ')})`);
}

interface RosterDay { date: string; shift_id: number | null; shift_name: string | null; source: 'assignment' | 'default' | 'none'; day_off: boolean; note: string | null; weekly_off: boolean; holiday: string | null; on_leave: boolean; scheduled: boolean; minutes: number }

/** Builds the roster for a set of employees between two dates. Exported for the CSV export and tests. */
export function buildRoster(from: string, to: string, employeeIds: number[] | undefined, filters: { department_id?: number; employee_id?: number; q?: string } = {}) {
  const settings = attendanceSettings();
  const weeklyOffs: number[] = Array.isArray(settings.weekly_offs) ? settings.weekly_offs : [0, 6];
  const shifts = parseJsonAll(all<Shift>('SELECT * FROM shifts ORDER BY start_time, name'), ['working_days']);
  const shiftById = new Map(shifts.map((s) => [s.id, s]));
  const holidays = new Map(all<{ name: string; date: string }>('SELECT name, date FROM holidays WHERE date BETWEEN ? AND ?', [from, to]).map((h) => [h.date, h.name]));
  const where: string[] = ["e.status != 'exited'"];
  const params: any[] = [];
  if (employeeIds) { if (!employeeIds.length) where.push('0'); else where.push(`e.id IN (${employeeIds.map(() => '?').join(',')})`); params.push(...(employeeIds || [])); }
  if (filters.department_id) { where.push('e.department_id = ?'); params.push(filters.department_id); }
  if (filters.employee_id) { where.push('e.id = ?'); params.push(filters.employee_id); }
  if (filters.q) { where.push('(e.first_name LIKE ? OR e.last_name LIKE ? OR e.employee_code LIKE ?)'); params.push(...Array(3).fill(`%${filters.q}%`)); }
  const employees = all<any>(`SELECT e.id, e.employee_code, e.first_name, e.last_name, e.department_id, e.shift_id AS default_shift_id, d.name AS department_name, p.title AS position_title
                               FROM employees e LEFT JOIN departments d ON d.id = e.department_id LEFT JOIN positions p ON p.id = e.position_id
                               WHERE ${where.join(' AND ')} ORDER BY d.name, e.first_name, e.last_name`, params);
  const ids = employees.map((e) => e.id);
  const assignments = new Map<string, any>();
  if (ids.length) for (const a of all<any>(`SELECT * FROM shift_assignments WHERE date BETWEEN ? AND ? AND employee_id IN (${ids.join(',')})`, [from, to])) assignments.set(`${a.employee_id}|${a.date}`, a);
  const leaves = new Set<string>();
  if (ids.length) {
    for (const l of all<any>(`SELECT employee_id, start_date, end_date FROM leave_requests WHERE status = 'approved' AND start_date <= ? AND end_date >= ? AND employee_id IN (${ids.join(',')})`, [to, from])) {
      for (const d of eachDay(l.start_date < from ? from : l.start_date, l.end_date > to ? to : l.end_date)) leaves.add(`${l.employee_id}|${d}`);
    }
  }
  const dates = eachDay(from, to);
  const days = dates.map((date) => ({ date, dow: new Date(date + 'T00:00:00Z').getUTCDay(), weekly_off: weeklyOffs.includes(new Date(date + 'T00:00:00Z').getUTCDay()), holiday: holidays.get(date) ?? null }));
  const rows = employees.map((e) => {
    let minutes = 0;
    const out: RosterDay[] = days.map((d) => {
      const a = assignments.get(`${e.id}|${d.date}`);
      const explicit = !!a;
      const shiftId: number | null = explicit ? a.shift_id ?? null : e.default_shift_id ?? null;
      const shift = shiftId ? shiftById.get(shiftId) : undefined;
      const dayOff = explicit ? a.shift_id == null : false;
      const scheduled = !!shift && (explicit || (!d.weekly_off && !d.holiday));
      const mins = scheduled && shift ? shiftMinutes(shift) : 0;
      minutes += mins;
      return { date: d.date, shift_id: shift ? shift.id : null, shift_name: shift ? shift.name : null, source: explicit ? 'assignment' : shift ? 'default' : 'none', day_off: dayOff, note: a?.note ?? null, weekly_off: d.weekly_off, holiday: d.holiday, on_leave: leaves.has(`${e.id}|${d.date}`), scheduled, minutes: mins };
    });
    return { ...e, days: out, scheduled_minutes: minutes, scheduled_hours: round2(minutes / 60), scheduled_days: out.filter((x) => x.scheduled).length };
  });
  return { from, to, days, shifts, weekly_offs: weeklyOffs, employees: rows };
}

/** The roster needs no demo rows of its own (default shifts come from employees); it only makes sure one shift exists on an empty install. */
export function ensureRosterDefaults() {
  if (get('SELECT 1 FROM shifts LIMIT 1')) return;
  run("INSERT INTO shifts (name, start_time, end_time, grace_minutes, break_minutes_allowed, half_day_minutes, full_day_minutes, working_days, active) VALUES ('General (9:30-18:30)', '09:30', '18:30', 10, 60, 240, 480, '[1,2,3,4,5]', 1)");
}

r.get('/', requireAuth, (req, res) => {
  ensureRosterDefaults();
  const { from, to } = parseRange(req);
  const filters = { department_id: toInt(req.query.department_id), employee_id: toInt(req.query.employee_id), q: String(req.query.q || '').trim() || undefined };
  res.json(buildRoster(from, to, viewableIds(req), filters));
});

r.get('/export.csv', requireAuth, (req, res) => {
  const { from, to } = parseRange(req);
  const roster = buildRoster(from, to, viewableIds(req), { department_id: toInt(req.query.department_id), employee_id: toInt(req.query.employee_id) });
  const esc = (v: any) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const header = ['Employee code', 'Name', 'Department', ...roster.days.map((d) => d.date), 'Scheduled hours'];
  const lines = [header.map(esc).join(',')];
  for (const e of roster.employees) {
    const cells = e.days.map((d: RosterDay) => (d.holiday && !d.scheduled ? `Holiday: ${d.holiday}` : d.day_off ? 'Day off' : !d.scheduled ? (d.weekly_off ? 'Off' : '') : `${d.shift_name}${d.note ? ` (${d.note})` : ''}`));
    lines.push([e.employee_code, `${e.first_name} ${e.last_name}`.trim(), e.department_name || '', ...cells, e.scheduled_hours].map(esc).join(','));
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="roster-${from}-to-${to}.csv"`);
  res.send(lines.join('\n') + '\n');
});

interface AssignmentInput { employee_id: number; date: string; shift_id: number | null; note: string | null }
function normalizeAssignments(raw: any): AssignmentInput[] {
  if (!Array.isArray(raw) || !raw.length) throw badRequest('assignments must be a non-empty array');
  if (raw.length > 2000) throw badRequest('Too many assignments in one request (max 2000)');
  const shiftIds = new Set(all<{ id: number }>('SELECT id FROM shifts').map((s) => s.id));
  const empIds = new Set(all<{ id: number }>("SELECT id FROM employees WHERE status != 'exited'").map((e) => e.id));
  return raw.map((a: any, i: number) => {
    const employee_id = toInt(a?.employee_id);
    if (!employee_id || !empIds.has(employee_id)) throw badRequest(`assignments[${i}]: unknown employee`);
    if (!isIsoDate(a?.date)) throw badRequest(`assignments[${i}]: date must be YYYY-MM-DD`);
    const shift_id = a?.shift_id === null || a?.shift_id === undefined || a?.shift_id === '' ? null : toInt(a.shift_id);
    if (shift_id !== null && (shift_id === undefined || !shiftIds.has(shift_id))) throw badRequest(`assignments[${i}]: unknown shift`);
    return { employee_id, date: a.date, shift_id, note: a?.note ? String(a.note).slice(0, 200) : null };
  });
}
/** Approved leave overlapping any assignment that puts the employee on a shift. */
function leaveConflicts(items: AssignmentInput[]) {
  const out: { employee_id: number; employee_name: string; date: string; leave_id: number; leave_type: string; start_date: string; end_date: string }[] = [];
  for (const a of items) {
    if (a.shift_id === null) continue;
    const l = get<any>(`SELECT l.id, l.start_date, l.end_date, t.name AS leave_type, e.first_name || ' ' || e.last_name AS employee_name
                        FROM leave_requests l JOIN leave_types t ON t.id = l.leave_type_id JOIN employees e ON e.id = l.employee_id
                        WHERE l.employee_id = ? AND l.status = 'approved' AND l.start_date <= ? AND l.end_date >= ? LIMIT 1`, [a.employee_id, a.date, a.date]);
    if (l) out.push({ employee_id: a.employee_id, employee_name: l.employee_name.trim(), date: a.date, leave_id: l.id, leave_type: l.leave_type, start_date: l.start_date, end_date: l.end_date });
  }
  return out;
}
function upsertAll(req: Request, items: AssignmentInput[]) {
  const now = nowIso();
  transaction(() => {
    for (const a of items) {
      run(`INSERT INTO shift_assignments (employee_id, date, shift_id, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(employee_id, date) DO UPDATE SET shift_id = excluded.shift_id, note = excluded.note, created_by = excluded.created_by, created_at = excluded.created_at`, [a.employee_id, a.date, a.shift_id, a.note, req.user!.id, now]);
    }
  });
}

r.put('/assign', requireRole('manager'), (req, res) => {
  const items = normalizeAssignments(req.body?.assignments);
  assertAssignable(req, [...new Set(items.map((a) => a.employee_id))]);
  const conflicts = leaveConflicts(items);
  if (conflicts.length && !req.body?.force) throw new HttpError(409, `${conflicts.length} assignment(s) fall on approved leave`, { conflicts });
  upsertAll(req, items);
  const dates = items.map((a) => a.date).sort();
  const rows = all(`SELECT * FROM shift_assignments WHERE date BETWEEN ? AND ? AND employee_id IN (${[...new Set(items.map((a) => a.employee_id))].join(',')}) ORDER BY employee_id, date`, [dates[0], dates[dates.length - 1]]);
  res.json({ updated: items.length, conflicts_overridden: conflicts.length, assignments: rows });
});
r.delete('/assign', requireRole('manager'), (req, res) => {
  const employee_id = toInt(req.body?.employee_id ?? req.query.employee_id);
  const date = String(req.body?.date ?? req.query.date ?? '');
  if (!employee_id || !isIsoDate(date)) throw badRequest('employee_id and date (YYYY-MM-DD) are required');
  assertAssignable(req, [employee_id]);
  if (!run('DELETE FROM shift_assignments WHERE employee_id = ? AND date = ?', [employee_id, date]).changes) throw notFound('No assignment on that date');
  res.json({ employee_id, date, reverted: true });
});
r.post('/copy-week', requireRole('manager'), (req, res) => {
  const from = String(req.body?.from_week_start || '');
  const to = String(req.body?.to_week_start || '');
  if (!isIsoDate(from) || !isIsoDate(to)) throw badRequest('from_week_start and to_week_start must be YYYY-MM-DD');
  if (from === to) throw badRequest('Source and target weeks are the same');
  const offset = Math.round((Date.parse(to) - Date.parse(from)) / 86400000);
  let ids: number[] | undefined = Array.isArray(req.body?.employee_ids) ? req.body.employee_ids.map((x: any) => toInt(x)).filter((x: any): x is number => !!x) : undefined;
  const allowed = assignableIds(req);
  if (ids) assertAssignable(req, ids);
  else ids = allowed;
  if (ids && !ids.length) return res.json({ copied: 0, conflicts_overridden: 0 });
  const src = all<any>(`SELECT employee_id, date, shift_id, note FROM shift_assignments WHERE date BETWEEN ? AND ?${ids ? ` AND employee_id IN (${ids.join(',')})` : ''}`, [from, addDays(from, 6)]);
  const items: AssignmentInput[] = src.map((a) => ({ employee_id: a.employee_id, date: addDays(a.date, offset), shift_id: a.shift_id ?? null, note: a.note ?? null }));
  const conflicts = leaveConflicts(items);
  if (conflicts.length && !req.body?.force) throw new HttpError(409, `${conflicts.length} copied assignment(s) fall on approved leave`, { conflicts });
  if (items.length) upsertAll(req, items);
  res.json({ copied: items.length, conflicts_overridden: conflicts.length, from_week_start: from, to_week_start: to });
});

export default r;
