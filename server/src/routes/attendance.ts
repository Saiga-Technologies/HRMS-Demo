import { Router } from 'express';
import type { Request } from 'express';
import { all, get, insert, update, run, getSetting, parseJson, parseJsonAll, transaction } from '../db.js';
import { requireAuth, requireHr, requireRole, canAccessEmployee, visibleEmployeeIds } from '../auth.js';
import { approverChain, approvableEmployeeIds, canApproveFor, defaultApprover } from '../approvers.js';
import { badRequest, notFound, forbidden, pick, requireFields, audit, toInt, toNum, nowIso, today, wrap, distanceMeters, eachDay, assertDate, addDays } from '../util.js';
import { DEFAULT_ATTENDANCE_SETTINGS } from './settings.js';

const r = Router();

/** Attendance settings with defaults filled in for keys added after the settings blob was first saved. */
export function attendanceSettings(): typeof DEFAULT_ATTENDANCE_SETTINGS {
  return { ...DEFAULT_ATTENDANCE_SETTINGS, ...getSetting('attendance', {}) };
}

// ---------- Work locations (geofences) ----------
const L_COLS = ['name', 'address', 'lat', 'lng', 'radius_m', 'active'];
r.get('/locations', requireAuth, (_req, res) => res.json(all('SELECT * FROM work_locations ORDER BY name')));
r.post('/locations', requireHr, wrap(async (req, res) => {
  requireFields(req.body, ['name', 'lat', 'lng']);
  const data: any = pick(req.body, L_COLS);
  validateLatLng(data.lat, data.lng);
  const id = insert('work_locations', { ...data, radius_m: toInt(data.radius_m, 150), created_at: nowIso() });
  audit(req, 'create', 'work_location', id);
  res.status(201).json(get('SELECT * FROM work_locations WHERE id = ?', [id]));
}));
r.put('/locations/:id', requireHr, wrap(async (req, res) => {
  const id = toInt(req.params.id)!;
  if (!get('SELECT 1 FROM work_locations WHERE id = ?', [id])) throw notFound();
  const data: any = pick(req.body, L_COLS);
  if (data.lat !== undefined || data.lng !== undefined) {
    const cur = get<any>('SELECT lat, lng FROM work_locations WHERE id = ?', [id])!;
    validateLatLng(data.lat ?? cur.lat, data.lng ?? cur.lng);
  }
  update('work_locations', id, data);
  audit(req, 'update', 'work_location', id);
  res.json(get('SELECT * FROM work_locations WHERE id = ?', [id]));
}));
r.delete('/locations/:id', requireHr, (req, res) => {
  run('UPDATE employees SET work_location_id = NULL WHERE work_location_id = ?', [toInt(req.params.id)]);
  if (!run('DELETE FROM work_locations WHERE id = ?', [toInt(req.params.id)]).changes) throw notFound();
  res.json({ ok: true });
});
function validateLatLng(lat: any, lng: any) {
  const a = Number(lat), b = Number(lng);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a < -90 || a > 90 || b < -180 || b > 180) throw badRequest('lat/lng are invalid');
}

// ---------- Shifts ----------
const S_COLS = ['name', 'start_time', 'end_time', 'grace_minutes', 'break_minutes_allowed', 'half_day_minutes', 'full_day_minutes', 'working_days', 'active'];
r.get('/shifts', requireAuth, (_req, res) => res.json(parseJsonAll(all('SELECT * FROM shifts ORDER BY name'), ['working_days'])));
r.post('/shifts', requireHr, wrap(async (req, res) => {
  requireFields(req.body, ['name', 'start_time', 'end_time']);
  const data: any = pick(req.body, S_COLS);
  if (data.working_days && !Array.isArray(data.working_days)) throw badRequest('working_days must be an array of weekday numbers');
  const id = insert('shifts', { ...data, working_days: data.working_days ?? [1, 2, 3, 4, 5] });
  res.status(201).json(parseJson(get('SELECT * FROM shifts WHERE id = ?', [id]), ['working_days']));
}));
r.put('/shifts/:id', requireHr, wrap(async (req, res) => {
  const id = toInt(req.params.id)!;
  if (!get('SELECT 1 FROM shifts WHERE id = ?', [id])) throw notFound();
  update('shifts', id, pick(req.body, S_COLS));
  res.json(parseJson(get('SELECT * FROM shifts WHERE id = ?', [id]), ['working_days']));
}));
r.delete('/shifts/:id', requireHr, (req, res) => {
  run('UPDATE employees SET shift_id = NULL WHERE shift_id = ?', [toInt(req.params.id)]);
  if (!run('DELETE FROM shifts WHERE id = ?', [toInt(req.params.id)]).changes) throw notFound();
  res.json({ ok: true });
});

// ---------- Holidays ----------
r.get('/holidays', requireAuth, (req, res) => {
  const year = req.query.year ? String(req.query.year) : null;
  res.json(year ? all('SELECT * FROM holidays WHERE date LIKE ? ORDER BY date', [`${year}-%`]) : all('SELECT * FROM holidays ORDER BY date'));
});
r.post('/holidays', requireHr, wrap(async (req, res) => {
  requireFields(req.body, ['name', 'date']);
  assertDate(req.body.date, 'date');
  const id = insert('holidays', { name: req.body.name, date: req.body.date, optional: req.body.optional ? 1 : 0 });
  res.status(201).json(get('SELECT * FROM holidays WHERE id = ?', [id]));
}));
r.delete('/holidays/:id', requireHr, (req, res) => {
  if (!run('DELETE FROM holidays WHERE id = ?', [toInt(req.params.id)]).changes) throw notFound();
  res.json({ ok: true });
});

// ---------- Helpers ----------
function minutesBetween(a: string, b: string) {
  return Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 60000));
}
function shiftFor(employeeId: number) {
  return parseJson(get<any>('SELECT s.* FROM shifts s JOIN employees e ON e.shift_id = s.id WHERE e.id = ?', [employeeId]), ['working_days']);
}
/**
 * Recompute work/break/overtime/late minutes and status for a record.
 * Status is derived from the punches for punch-sourced records; manual/correction records keep the status
 * that was set explicitly unless `deriveStatus` is true (used when an appeal changes punches but not the status).
 */
export function recompute(recordId: number, deriveStatus = false) {
  const rec = get<any>('SELECT * FROM attendance_records WHERE id = ?', [recordId]);
  if (!rec) return;
  const settings = attendanceSettings();
  const breaks = all<any>('SELECT * FROM attendance_breaks WHERE attendance_id = ?', [recordId]);
  const breakMin = breaks.reduce((s, b) => s + (b.end_at ? minutesBetween(b.start_at, b.end_at) : 0), 0);
  let work = 0, overtime = 0, late = 0;
  const shift = shiftFor(rec.employee_id);
  if (rec.punch_in_at && rec.punch_out_at) {
    work = Math.max(0, minutesBetween(rec.punch_in_at, rec.punch_out_at) - breakMin);
    const full = shift?.full_day_minutes ?? 480;
    const otAfter = settings.overtime_after_minutes ?? full + 60;
    overtime = Math.max(0, work - otAfter);
  }
  if (rec.punch_in_at && shift) {
    const [h, m] = shift.start_time.split(':').map(Number);
    const inDate = new Date(rec.punch_in_at);
    const startMin = h * 60 + m + (shift.grace_minutes ?? settings.late_mark_after_minutes ?? 0);
    const actualMin = inDate.getUTCHours() * 60 + inDate.getUTCMinutes() + tzOffsetMinutes();
    late = Math.max(0, actualMin - startMin);
  }
  let status = rec.status;
  const derive = deriveStatus || (rec.source !== 'correction' && rec.source !== 'manual');
  if (!['leave', 'holiday', 'weekend', 'wfh'].includes(status) && derive) {
    if (rec.punch_in_at && rec.punch_out_at) {
      const half = shift?.half_day_minutes ?? settings.half_day_below_minutes ?? 240;
      status = work < half ? 'half_day' : 'present';
    } else if (rec.punch_in_at) status = 'present';
  }
  update('attendance_records', recordId, { work_minutes: work, break_minutes: breakMin, overtime_minutes: overtime, late_minutes: late, status, updated_at: nowIso() });
}
/** Local offset used for shift comparisons. Configurable through HRMS_TZ_OFFSET_MINUTES (default IST +330). */
export function tzOffsetMinutes() {
  const v = Number(process.env.HRMS_TZ_OFFSET_MINUTES);
  return Number.isFinite(v) ? v : 330;
}

function checkFence(lat: any, lng: any, employeeId: number) {
  const settings = attendanceSettings();
  const latN = toNum(lat), lngN = toNum(lng);
  const locations = all<any>('SELECT * FROM work_locations WHERE active = 1');
  const emp = get<any>('SELECT work_location_id FROM employees WHERE id = ?', [employeeId]);
  const candidates = emp?.work_location_id ? locations.filter((l) => l.id === emp.work_location_id).concat(locations.filter((l) => l.id !== emp.work_location_id)) : locations;
  if (latN === undefined || lngN === undefined) {
    if (settings.require_geofence && !settings.allow_remote_punch) throw badRequest('Location is required to punch. Please allow location access.');
    return { location_id: null, within: 0, distance: null };
  }
  validateLatLng(latN, lngN);
  let best: any = null;
  for (const l of candidates) {
    const d = distanceMeters(latN, lngN, l.lat, l.lng);
    if (!best || d - l.radius_m < best.d - best.radius_m) best = { ...l, d };
  }
  const within = best ? best.d <= best.radius_m : false;
  if (settings.require_geofence && !within && !settings.allow_remote_punch) {
    throw badRequest(best ? `You are ${Math.round(best.d)} m from ${best.name} (allowed ${best.radius_m} m). Move inside the office geofence to punch.` : 'No office geofence is configured yet. Ask HR to add a work location.');
  }
  return { location_id: best?.id ?? null, within: within ? 1 : 0, distance: best ? Math.round(best.d) : null };
}

export const recQuery = `SELECT a.*, e.first_name || ' ' || e.last_name AS employee_name, e.employee_code, d.name AS department_name, li.name AS punch_in_location_name, lo.name AS punch_out_location_name,
  COALESCE(ce.first_name || ' ' || ce.last_name, cu.email) AS corrected_by_name
  FROM attendance_records a JOIN employees e ON e.id = a.employee_id LEFT JOIN departments d ON d.id = e.department_id
  LEFT JOIN work_locations li ON li.id = a.punch_in_location_id LEFT JOIN work_locations lo ON lo.id = a.punch_out_location_id
  LEFT JOIN users cu ON cu.id = a.corrected_by LEFT JOIN employees ce ON ce.id = cu.employee_id`;

/** Attach the applied appeal (audit trail) to records that were changed through one. */
export function withCorrections<T extends Record<string, any>>(rows: T[]): T[] {
  const ids = Array.from(new Set(rows.map((x) => x.correction_id).filter((x) => !!x)));
  const corrs = new Map(ids.length ? parseJsonAll(all<any>(`${corrQuery} WHERE c.id IN (${ids.map(() => '?').join(',')})`, ids), ['previous_values']).map((c) => [c.id, c]) : []);
  for (const row of rows) {
    const c = row.correction_id ? corrs.get(row.correction_id) : null;
    (row as any).correction = c ? { id: c.id, kind: c.kind, reason: c.reason, status: c.status, requested_by_name: c.requested_by_name, approver_name: c.approver_name, reviewer_name: c.reviewer_name, reviewed_at: c.reviewed_at, review_note: c.review_note, previous_values: c.previous_values, requested_punch_in: c.requested_punch_in, requested_punch_out: c.requested_punch_out, requested_status: c.requested_status } : null;
  }
  return rows;
}
function withBreaks(rows: any[]) {
  for (const r_ of rows) r_.breaks = all('SELECT * FROM attendance_breaks WHERE attendance_id = ? ORDER BY start_at', [r_.id]);
  return withCorrections(rows);
}
function loadRecord(id: number) {
  return withBreaks([get(`${recQuery} WHERE a.id = ?`, [id])])[0];
}
function myEmployeeId(req: any): number {
  if (!req.user.employee_id) throw badRequest('Your login is not linked to an employee record');
  return req.user.employee_id;
}
/** Working day = not a weekly off, not a public holiday. */
function isWorkingDay(date: string, settings: any, holidays: Set<string>) {
  return !(settings.weekly_offs || [0, 6]).includes(new Date(date + 'T00:00:00Z').getUTCDay()) && !holidays.has(date);
}

// ---------- Self-service: punch in / out / breaks ----------
r.get('/me/today', requireAuth, (req, res) => {
  const eid = myEmployeeId(req);
  const date = String(req.query.date || today());
  const rec = get<any>(`${recQuery} WHERE a.employee_id = ? AND a.date = ?`, [eid, date]);
  res.json({ date, record: rec ? withBreaks([rec])[0] : null, settings: attendanceSettings(), shift: shiftFor(eid), locations: all('SELECT id, name, lat, lng, radius_m FROM work_locations WHERE active = 1') });
});
r.post('/me/punch-in', requireAuth, wrap(async (req, res) => {
  const eid = myEmployeeId(req);
  const date = today();
  if (get('SELECT 1 FROM attendance_records WHERE employee_id = ? AND date = ? AND punch_in_at IS NOT NULL', [eid, date])) throw badRequest('Already punched in today');
  const fence = checkFence(req.body.lat, req.body.lng, eid);
  const existing = get<any>('SELECT id FROM attendance_records WHERE employee_id = ? AND date = ?', [eid, date]);
  const data = { punch_in_at: nowIso(), punch_in_lat: toNum(req.body.lat) ?? null, punch_in_lng: toNum(req.body.lng) ?? null, punch_in_location_id: fence.location_id, punch_in_within_fence: fence.within, punch_in_distance_m: fence.distance, status: 'present', source: 'punch', updated_at: nowIso() };
  const id = existing ? (update('attendance_records', existing.id, data), existing.id) : insert('attendance_records', { employee_id: eid, date, ...data, created_at: nowIso() });
  recompute(id);
  audit(req, 'punch_in', 'attendance', id, fence);
  res.json(loadRecord(id));
}));
r.post('/me/punch-out', requireAuth, wrap(async (req, res) => {
  const eid = myEmployeeId(req);
  const rec = get<any>('SELECT * FROM attendance_records WHERE employee_id = ? AND date = ?', [eid, today()]);
  if (!rec?.punch_in_at) throw badRequest('You have not punched in today');
  if (rec.punch_out_at) throw badRequest('Already punched out today');
  const fence = checkFence(req.body.lat, req.body.lng, eid);
  // Close any open break automatically.
  const open = get<any>('SELECT * FROM attendance_breaks WHERE attendance_id = ? AND end_at IS NULL', [rec.id]);
  if (open) update('attendance_breaks', open.id, { end_at: nowIso(), minutes: minutesBetween(open.start_at, nowIso()) });
  update('attendance_records', rec.id, { punch_out_at: nowIso(), punch_out_lat: toNum(req.body.lat) ?? null, punch_out_lng: toNum(req.body.lng) ?? null, punch_out_location_id: fence.location_id, punch_out_within_fence: fence.within, punch_out_distance_m: fence.distance, updated_at: nowIso() });
  recompute(rec.id);
  audit(req, 'punch_out', 'attendance', rec.id, fence);
  res.json(loadRecord(rec.id));
}));
r.post('/me/break/start', requireAuth, wrap(async (req, res) => {
  const eid = myEmployeeId(req);
  const rec = get<any>('SELECT * FROM attendance_records WHERE employee_id = ? AND date = ?', [eid, today()]);
  if (!rec?.punch_in_at || rec.punch_out_at) throw badRequest('You must be punched in to start a break');
  if (get('SELECT 1 FROM attendance_breaks WHERE attendance_id = ? AND end_at IS NULL', [rec.id])) throw badRequest('A break is already running');
  const type = ['break', 'lunch', 'personal'].includes(req.body.type) ? req.body.type : 'break';
  insert('attendance_breaks', { attendance_id: rec.id, type, start_at: nowIso(), minutes: 0, note: req.body.note || null });
  recompute(rec.id);
  res.json(loadRecord(rec.id));
}));
r.post('/me/break/end', requireAuth, wrap(async (req, res) => {
  const eid = myEmployeeId(req);
  const rec = get<any>('SELECT * FROM attendance_records WHERE employee_id = ? AND date = ?', [eid, today()]);
  const open = rec ? get<any>('SELECT * FROM attendance_breaks WHERE attendance_id = ? AND end_at IS NULL', [rec.id]) : null;
  if (!open) throw badRequest('No break is running');
  update('attendance_breaks', open.id, { end_at: nowIso(), minutes: minutesBetween(open.start_at, nowIso()) });
  recompute(rec.id);
  const settings = attendanceSettings();
  const out: any = loadRecord(rec.id);
  out.break_limit_exceeded = out.break_minutes > (settings.max_break_minutes ?? 60);
  res.json(out);
}));

/**
 * Missed punches in the appeal window: working days (not weekly off / holiday / approved leave) with no punch-in,
 * or a punch-in without a punch-out. Drives the "You missed a punch on Tue, raise an appeal before Fri" prompt.
 */
r.get('/me/missed', requireAuth, (req, res) => {
  const eid = myEmployeeId(req);
  const settings = attendanceSettings();
  const deadlineDays = Math.max(0, toInt(settings.appeal_deadline_days, 3)!);
  const lookback = deadlineDays + 7;
  const from = addDays(today(), -lookback), to = addDays(today(), -1);
  const emp = get<any>('SELECT join_date FROM employees WHERE id = ?', [eid]);
  const holidays = new Set(all<any>('SELECT date FROM holidays WHERE date BETWEEN ? AND ? AND optional = 0', [from, to]).map((h) => h.date));
  const leaves = all<any>("SELECT start_date, end_date FROM leave_requests WHERE employee_id = ? AND status = 'approved' AND end_date >= ? AND start_date <= ?", [eid, from, to]);
  const recs = new Map(all<any>('SELECT * FROM attendance_records WHERE employee_id = ? AND date BETWEEN ? AND ?', [eid, from, to]).map((x) => [x.date, x]));
  const appeals = all<any>("SELECT id, date, status, kind FROM attendance_corrections WHERE employee_id = ? AND date BETWEEN ? AND ? AND status IN ('pending','approved') ORDER BY id DESC", [eid, from, to]);
  const items: any[] = [];
  for (const d of eachDay(from, to)) {
    if (emp?.join_date && d < emp.join_date) continue;
    if (!isWorkingDay(d, settings, holidays)) continue;
    if (leaves.some((l) => d >= l.start_date && d <= l.end_date)) continue;
    const rec = recs.get(d);
    if (rec && ['leave', 'holiday', 'weekend', 'wfh', 'absent'].includes(rec.status) && rec.source !== 'punch') continue;
    let kind: string | null = null;
    if (!rec || !rec.punch_in_at) kind = rec?.punch_out_at ? 'missed_punch_in' : 'missed_both';
    else if (!rec.punch_out_at) kind = 'missed_punch_out';
    if (!kind) continue;
    const appeal = appeals.find((a) => a.date === d) || null;
    const dl = appealDeadline(d, deadlineDays);
    items.push({ date: d, weekday: new Date(d + 'T00:00:00Z').getUTCDay(), kind, record_id: rec?.id ?? null, punch_in_at: rec?.punch_in_at ?? null, punch_out_at: rec?.punch_out_at ?? null, ...dl, appeal_id: appeal?.id ?? null, appeal_status: appeal?.status ?? null, can_appeal: !dl.deadline_passed && !appeal });
  }
  items.sort((a, b) => (a.date < b.date ? 1 : -1));
  res.json({ today: today(), deadline_days: deadlineDays, items });
});

// ---------- Records (HR / manager / self) ----------
r.get('/records', requireAuth, (req, res) => {
  const where: string[] = [];
  const params: any[] = [];
  const vis = visibleEmployeeIds(req);
  if (vis) { if (!vis.length) return res.json({ items: [] }); where.push(`a.employee_id IN (${vis.map(() => '?').join(',')})`); params.push(...vis); }
  if (req.query.employee_id) { where.push('a.employee_id = ?'); params.push(toInt(req.query.employee_id)); }
  if (req.query.from) { where.push('a.date >= ?'); params.push(req.query.from); }
  if (req.query.to) { where.push('a.date <= ?'); params.push(req.query.to); }
  if (req.query.date) { where.push('a.date = ?'); params.push(req.query.date); }
  if (req.query.status) { where.push('a.status = ?'); params.push(req.query.status); }
  if (req.query.department_id) { where.push('e.department_id = ?'); params.push(toInt(req.query.department_id)); }
  if (req.query.corrected_only === '1') where.push('a.correction_id IS NOT NULL');
  const rows = all(`${recQuery}${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY a.date DESC, e.first_name LIMIT 2000`, params);
  res.json({ items: req.query.with_breaks === '1' ? withBreaks(rows) : withCorrections(rows) });
});

/** Day roster for HR: every active employee with their record (or absent/weekend/holiday/leave). */
r.get('/daily', requireRole('manager'), (req, res) => {
  const date = String(req.query.date || today());
  const settings = attendanceSettings();
  const vis = visibleEmployeeIds(req);
  const emps = all<any>(`SELECT e.id, e.employee_code, e.first_name, e.last_name, d.name AS department_name, e.shift_id FROM employees e LEFT JOIN departments d ON d.id = e.department_id WHERE e.status != 'exited'${vis ? ` AND e.id IN (${vis.map(() => '?').join(',') || 'NULL'})` : ''} ORDER BY e.first_name`, vis ?? []);
  const recs = new Map(withCorrections(all<any>(`${recQuery} WHERE a.date = ?`, [date])).map((x) => [x.employee_id, x]));
  const leaves = all<any>("SELECT l.employee_id, t.name FROM leave_requests l JOIN leave_types t ON t.id = l.leave_type_id WHERE l.status = 'approved' AND ? BETWEEN l.start_date AND l.end_date", [date]);
  const holiday = get<any>('SELECT name FROM holidays WHERE date = ?', [date]);
  const weekend = (settings.weekly_offs || [0, 6]).includes(new Date(date + 'T00:00:00Z').getUTCDay());
  const rows = emps.map((e) => {
    const rec = recs.get(e.id);
    const leave = leaves.find((l) => l.employee_id === e.id);
    let status = rec?.status ?? (leave ? 'leave' : holiday ? 'holiday' : weekend ? 'weekend' : date <= today() ? 'absent' : 'upcoming');
    return { ...e, record: rec ?? null, status, leave_type: leave?.name ?? null };
  });
  const counts: Record<string, number> = {};
  rows.forEach((x) => (counts[x.status] = (counts[x.status] || 0) + 1));
  res.json({ date, holiday: holiday?.name ?? null, weekend, rows, counts, edit_only_via_appeal: settings.edit_only_via_appeal !== false });
});

/** Monthly summary per employee. */
r.get('/summary', requireAuth, (req, res) => {
  const period = String(req.query.period || today().slice(0, 7));
  const [y, m] = period.split('-').map(Number);
  const start = `${period}-01`, end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const vis = visibleEmployeeIds(req);
  const emps = all<any>(`SELECT e.id, e.employee_code, e.first_name, e.last_name, d.name AS department_name FROM employees e LEFT JOIN departments d ON d.id = e.department_id WHERE e.status != 'exited'${vis ? ` AND e.id IN (${vis.map(() => '?').join(',') || 'NULL'})` : ''} ORDER BY e.first_name`, vis ?? []);
  const recs = all<any>('SELECT * FROM attendance_records WHERE date BETWEEN ? AND ?', [start, end]);
  const settings = attendanceSettings();
  const holidays = new Set(all<any>('SELECT date FROM holidays WHERE date BETWEEN ? AND ?', [start, end]).map((h) => h.date));
  const days = eachDay(start, end);
  const workingDays = days.filter((d) => isWorkingDay(d, settings, holidays));
  const leaves = all<any>("SELECT employee_id, start_date, end_date, half_day FROM leave_requests WHERE status = 'approved' AND end_date >= ? AND start_date <= ?", [start, end]);
  const rows = emps.map((e) => {
    const mine = recs.filter((x) => x.employee_id === e.id);
    const present = mine.filter((x) => x.status === 'present' || x.status === 'wfh').length;
    const half = mine.filter((x) => x.status === 'half_day').length;
    const leaveDays = workingDays.filter((d) => leaves.some((l) => l.employee_id === e.id && d >= l.start_date && d <= l.end_date)).length;
    const elapsed = workingDays.filter((d) => d <= today() && !mine.some((x) => x.date === d) && !leaves.some((l) => l.employee_id === e.id && d >= l.start_date && d <= l.end_date)).length;
    return { ...e, present, half_day: half, leave: leaveDays, absent: elapsed, late_count: mine.filter((x) => x.late_minutes > 0).length, corrected: mine.filter((x) => !!x.correction_id).length, work_hours: Math.round(mine.reduce((s, x) => s + x.work_minutes, 0) / 60), break_hours: Math.round((mine.reduce((s, x) => s + x.break_minutes, 0) / 60) * 10) / 10, overtime_hours: Math.round((mine.reduce((s, x) => s + x.overtime_minutes, 0) / 60) * 10) / 10 };
  });
  res.json({ period, working_days: workingDays.length, rows });
});

// ---------- Direct edits (only when edit_only_via_appeal is off) ----------
const EDIT_LOCKED = 'Attendance can only be changed through an approved appeal';
function assertDirectEditAllowed() {
  if (attendanceSettings().edit_only_via_appeal !== false) throw forbidden(EDIT_LOCKED);
}
const SNAPSHOT_COLS = ['punch_in_at', 'punch_out_at', 'status', 'work_minutes', 'break_minutes', 'late_minutes', 'overtime_minutes', 'notes', 'source'];
function snapshot(rec: any | undefined) {
  if (!rec) return null;
  const out: Record<string, any> = {};
  for (const k of SNAPSHOT_COLS) out[k] = rec[k] ?? null;
  return out;
}

/** HR manual add / edit of a record. Refused (403) while edit_only_via_appeal is on. */
r.put('/records/:employeeId/:date', requireHr, wrap(async (req, res) => {
  assertDirectEditAllowed();
  const eid = toInt(req.params.employeeId)!;
  const date = req.params.date;
  assertDate(date, 'date');
  if (!get('SELECT 1 FROM employees WHERE id = ?', [eid])) throw notFound('Employee not found');
  const data: any = pick(req.body, ['punch_in_at', 'punch_out_at', 'status', 'notes']);
  for (const k of ['punch_in_at', 'punch_out_at']) if (data[k] && Number.isNaN(Date.parse(data[k]))) throw badRequest(`${k} must be an ISO datetime`);
  if (data.punch_in_at && data.punch_out_at && data.punch_out_at < data.punch_in_at) throw badRequest('Punch out must be after punch in');
  if (data.status && !['present', 'half_day', 'absent', 'leave', 'holiday', 'weekend', 'wfh'].includes(data.status)) throw badRequest('Invalid status');
  const existing = get<any>('SELECT * FROM attendance_records WHERE employee_id = ? AND date = ?', [eid, date]);
  const before = snapshot(existing);
  const stamp = { source: 'manual', corrected_by: req.user!.id, corrected_at: nowIso(), updated_at: nowIso() };
  const id = existing ? (update('attendance_records', existing.id, { ...data, ...stamp }), existing.id) : insert('attendance_records', { employee_id: eid, date, status: data.status || 'present', ...data, ...stamp, created_at: nowIso() });
  recompute(id, !data.status);
  const after = snapshot(get<any>('SELECT * FROM attendance_records WHERE id = ?', [id]));
  audit(req, 'correct', 'attendance', id, { employee_id: eid, date, before, after });
  res.json(loadRecord(id));
}));
r.delete('/records/:id', requireHr, (req, res) => {
  assertDirectEditAllowed();
  const rec = get<any>('SELECT * FROM attendance_records WHERE id = ?', [toInt(req.params.id)]);
  if (!rec) throw notFound();
  run('DELETE FROM attendance_records WHERE id = ?', [rec.id]);
  audit(req, 'delete', 'attendance', rec.id, { employee_id: rec.employee_id, date: rec.date, before: snapshot(rec), after: null });
  res.json({ ok: true });
});
/** HR edits a break's times. */
r.put('/breaks/:id', requireHr, wrap(async (req, res) => {
  assertDirectEditAllowed();
  const b = get<any>('SELECT * FROM attendance_breaks WHERE id = ?', [toInt(req.params.id)]);
  if (!b) throw notFound();
  const data: any = pick(req.body, ['start_at', 'end_at', 'type', 'note']);
  const start = data.start_at ?? b.start_at, end = data.end_at ?? b.end_at;
  if (end && end < start) throw badRequest('Break end must be after start');
  const before = snapshot(get<any>('SELECT * FROM attendance_records WHERE id = ?', [b.attendance_id]));
  update('attendance_breaks', b.id, { ...data, minutes: end ? minutesBetween(start, end) : 0 });
  update('attendance_records', b.attendance_id, { corrected_by: req.user!.id, corrected_at: nowIso() });
  recompute(b.attendance_id);
  audit(req, 'correct_break', 'attendance', b.attendance_id, { break: { before: b, after: { ...b, ...data } }, before, after: snapshot(get<any>('SELECT * FROM attendance_records WHERE id = ?', [b.attendance_id])) });
  res.json(loadRecord(b.attendance_id));
}));
r.delete('/breaks/:id', requireHr, (req, res) => {
  assertDirectEditAllowed();
  const b = get<any>('SELECT * FROM attendance_breaks WHERE id = ?', [toInt(req.params.id)]);
  if (!b) throw notFound();
  const before = snapshot(get<any>('SELECT * FROM attendance_records WHERE id = ?', [b.attendance_id]));
  run('DELETE FROM attendance_breaks WHERE id = ?', [b.id]);
  update('attendance_records', b.attendance_id, { corrected_by: req.user!.id, corrected_at: nowIso() });
  recompute(b.attendance_id);
  audit(req, 'delete_break', 'attendance', b.attendance_id, { break: b, before, after: snapshot(get<any>('SELECT * FROM attendance_records WHERE id = ?', [b.attendance_id])) });
  res.json({ ok: true });
});

// ---------- Appeals (missed punches / corrections) ----------
export const APPEAL_KINDS = ['missed_punch_in', 'missed_punch_out', 'missed_both', 'status', 'correction'] as const;
export const corrQuery = `SELECT c.*, e.first_name || ' ' || e.last_name AS employee_name, e.employee_code, e.department_id, d.name AS department_name,
  ap.first_name || ' ' || ap.last_name AS approver_name,
  COALESCE(re.first_name || ' ' || re.last_name, ru.email) AS reviewer_name, ru.email AS reviewer_email,
  COALESCE(qe.first_name || ' ' || qe.last_name, qu.email) AS requested_by_name
  FROM attendance_corrections c JOIN employees e ON e.id = c.employee_id LEFT JOIN departments d ON d.id = e.department_id
  LEFT JOIN employees ap ON ap.id = c.approver_employee_id
  LEFT JOIN users ru ON ru.id = c.reviewed_by LEFT JOIN employees re ON re.id = ru.employee_id
  LEFT JOIN users qu ON qu.id = c.requested_by LEFT JOIN employees qe ON qe.id = qu.employee_id`;

/** Deadline for an appeal about `date`: it may be raised up to `days` days after the date. */
export function appealDeadline(date: string, days: number) {
  const deadline_date = addDays(date, days);
  const days_left = Math.round((Date.parse(deadline_date + 'T00:00:00Z') - Date.parse(today() + 'T00:00:00Z')) / 86400000);
  return { deadline_date, deadline_passed: today() > deadline_date, days_left: Math.max(0, days_left) };
}
function decorateAppeal(row: any) {
  if (!row) return row;
  parseJson(row, ['previous_values']);
  if (typeof row.previous_values === 'string') row.previous_values = null;
  const days = Math.max(0, toInt(attendanceSettings().appeal_deadline_days, 3)!);
  return { ...row, ...appealDeadline(row.date, days) };
}
function loadAppeal(id: number) {
  return decorateAppeal(get<any>(`${corrQuery} WHERE c.id = ?`, [id]));
}
/** Employee ids whose appeals the signed-in user can see: self + everyone below them. HR: all (undefined). */
function appealScope(req: Request): number[] | undefined {
  const ids = approvableEmployeeIds(req);
  if (!ids) return undefined;
  const mine = req.user?.employee_id;
  return mine && !ids.includes(mine) ? [...ids, mine] : ids;
}

r.get('/corrections', requireAuth, (req, res) => {
  const where: string[] = [];
  const params: any[] = [];
  const scope = appealScope(req);
  if (scope) { if (!scope.length) return res.json([]); where.push(`c.employee_id IN (${scope.map(() => '?').join(',')})`); params.push(...scope); }
  if (req.query.status) { where.push('c.status = ?'); params.push(req.query.status); }
  if (req.query.kind) { where.push('c.kind = ?'); params.push(req.query.kind); }
  if (req.query.employee_id) { where.push('c.employee_id = ?'); params.push(toInt(req.query.employee_id)); }
  if (req.query.from) { where.push('c.date >= ?'); params.push(req.query.from); }
  if (req.query.to) { where.push('c.date <= ?'); params.push(req.query.to); }
  res.json(all<any>(`${corrQuery}${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY c.created_at DESC`, params).map(decorateAppeal));
});

/** One appeal with the linked record and its audit trail (who raised, who approved, what changed). */
r.get('/corrections/:id', requireAuth, (req, res) => {
  const c = loadAppeal(toInt(req.params.id)!);
  if (!c) throw notFound();
  if (!canAccessEmployee(req, c.employee_id) && !canApproveFor(req, c.employee_id)) throw forbidden();
  const rec = c.applied_record_id ? get<any>(`${recQuery} WHERE a.id = ?`, [c.applied_record_id]) : get<any>(`${recQuery} WHERE a.employee_id = ? AND a.date = ?`, [c.employee_id, c.date]);
  const record = rec ? withBreaks([rec])[0] : null;
  const changes: { field: string; from: any; to: any }[] = [];
  if (c.status === 'approved' && record) {
    const prev = c.previous_values || {};
    for (const k of ['punch_in_at', 'punch_out_at', 'status', 'work_minutes', 'break_minutes', 'late_minutes', 'overtime_minutes']) {
      if ((prev[k] ?? null) !== (record[k] ?? null)) changes.push({ field: k, from: prev[k] ?? null, to: record[k] ?? null });
    }
  }
  const trail = parseJsonAll(all<any>(`SELECT a.id, a.action, a.created_at, a.details, u.email, COALESCE(e.first_name || ' ' || e.last_name, u.email) AS by_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id LEFT JOIN employees e ON e.id = u.employee_id WHERE a.entity = 'attendance_correction' AND a.entity_id = ? ORDER BY a.id`, [String(c.id)]), ['details']);
  res.json({ ...c, record, changes, trail, approver_chain: approverChain(c.employee_id) });
});

r.post('/corrections', requireAuth, wrap(async (req, res) => {
  requireFields(req.body, ['date', 'reason']);
  assertDate(req.body.date, 'date');
  const isHr = req.user!.role === 'hr';
  const eid = isHr && req.body.employee_id ? toInt(req.body.employee_id)! : myEmployeeId(req);
  if (!get('SELECT 1 FROM employees WHERE id = ?', [eid])) throw notFound('Employee not found');
  const kind = String(req.body.kind || 'correction');
  if (!(APPEAL_KINDS as readonly string[]).includes(kind)) throw badRequest(`kind must be one of ${APPEAL_KINDS.join(', ')}`);
  const date = String(req.body.date);
  if (date > today()) throw badRequest('Appeals can only be raised for today or a past date');
  const pin = req.body.requested_punch_in || null, pout = req.body.requested_punch_out || null, pstatus = req.body.requested_status || null;
  for (const [k, v] of [['requested_punch_in', pin], ['requested_punch_out', pout]] as const) if (v && Number.isNaN(Date.parse(v))) throw badRequest(`${k} must be an ISO datetime`);
  if (pstatus && !['present', 'half_day', 'absent', 'leave', 'holiday', 'weekend', 'wfh'].includes(pstatus)) throw badRequest('Invalid requested status');
  if (kind === 'missed_punch_in' && !pin) throw badRequest('Enter the punch-in time you missed');
  if (kind === 'missed_punch_out' && !pout) throw badRequest('Enter the punch-out time you missed');
  if (kind === 'missed_both' && (!pin || !pout)) throw badRequest('Enter both the punch-in and punch-out times');
  if (kind === 'status' && !pstatus) throw badRequest('Choose the status you are appealing for');
  if (!pin && !pout && !pstatus) throw badRequest('Provide the corrected punch in, punch out or status');
  if (pin && pout && pout < pin) throw badRequest('Punch out must be after punch in');
  // Deadline: an appeal for a date may be raised until `appeal_deadline_days` days after it. HR can override.
  const settings = attendanceSettings();
  const deadlineDays = Math.max(0, toInt(settings.appeal_deadline_days, 3)!);
  const dl = appealDeadline(date, deadlineDays);
  const override = isHr && (req.body.override_deadline === true || req.body.override_deadline === 1 || req.body.override_deadline === '1' || req.body.override_deadline === 'true');
  if (dl.deadline_passed && !override) throw badRequest(`Appeals for ${date} closed on ${dl.deadline_date} (${deadlineDays}-day deadline)${isHr ? '. Tick "override deadline" to raise it anyway.' : '. Ask HR to raise it on your behalf.'}`);
  if (get('SELECT 1 FROM attendance_corrections WHERE employee_id = ? AND date = ? AND status = ?', [eid, date, 'pending'])) throw badRequest('An appeal for this date is already pending');
  const approver = defaultApprover(eid);
  const id = insert('attendance_corrections', { employee_id: eid, date, kind, requested_punch_in: pin, requested_punch_out: pout, requested_status: pstatus, reason: String(req.body.reason).slice(0, 500), status: 'pending', requested_by: req.user!.id, approver_employee_id: approver?.employee_id ?? null, created_at: nowIso() });
  audit(req, 'request', 'attendance_correction', id, { employee_id: eid, date, kind, requested_punch_in: pin, requested_punch_out: pout, requested_status: pstatus, override_deadline: !!override, on_behalf: eid !== req.user!.employee_id });
  res.status(201).json(loadAppeal(id));
}));

r.post('/corrections/:id/review', requireRole('manager'), wrap(async (req, res) => {
  const c = get<any>('SELECT * FROM attendance_corrections WHERE id = ?', [toInt(req.params.id)]);
  if (!c) throw notFound();
  if (c.status !== 'pending') throw badRequest('Already reviewed');
  if (!canApproveFor(req, c.employee_id)) throw forbidden('Only the reporting manager hierarchy or HR can review this appeal');
  const decision = req.body.decision === 'approve' ? 'approved' : req.body.decision === 'reject' ? 'rejected' : null;
  if (!decision) throw badRequest('decision must be approve or reject');
  let previous: any = null, applied: any = null, recordId: number | null = null;
  transaction(() => {
    if (decision === 'approved') {
      const existing = get<any>('SELECT * FROM attendance_records WHERE employee_id = ? AND date = ?', [c.employee_id, c.date]);
      previous = snapshot(existing);
      const data: any = { source: 'correction', correction_id: c.id, corrected_by: req.user!.id, corrected_at: nowIso(), updated_at: nowIso(), notes: `Appeal #${c.id}: ${c.reason}` };
      if (c.requested_punch_in) data.punch_in_at = c.requested_punch_in;
      if (c.requested_punch_out) data.punch_out_at = c.requested_punch_out;
      if (c.requested_status) data.status = c.requested_status;
      const rid: number = existing ? (update('attendance_records', existing.id, data), existing.id) : insert('attendance_records', { employee_id: c.employee_id, date: c.date, status: c.requested_status || 'present', ...data, created_at: nowIso() });
      recordId = rid;
      recompute(rid, !c.requested_status);
      applied = snapshot(get<any>('SELECT * FROM attendance_records WHERE id = ?', [rid]));
    }
    update('attendance_corrections', c.id, { status: decision, reviewed_by: req.user!.id, reviewed_at: nowIso(), review_note: req.body.note || null, applied_record_id: recordId, previous_values: previous ? JSON.stringify(previous) : null });
  });
  audit(req, decision, 'attendance_correction', c.id, { employee_id: c.employee_id, date: c.date, kind: c.kind, record_id: recordId, before: previous, after: applied, note: req.body.note || null });
  res.json(loadAppeal(c.id));
}));

export default r;
