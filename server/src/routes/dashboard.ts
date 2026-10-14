import { Router } from 'express';
import { all, get, insert, update, run, getSetting, parseJsonAll, transaction } from '../db.js';
import { requireAuth } from '../auth.js';
import { approvableEmployeeIds } from '../approvers.js';
import { badRequest, notFound, pick, requireFields, toInt, nowIso, today, wrap, addDays, eachDay } from '../util.js';
import { documentStatus } from './documents.js';
import { DEFAULT_ATTENDANCE_SETTINGS } from './settings.js';

const r = Router();

export type CardType = 'stat' | 'list' | 'link' | 'note' | 'chart';
export type CardSize = 'sm' | 'md' | 'lg';
export interface CatalogEntry { type: CardType; key: string; title: string; roles: string[]; category: string; icon: string; size: CardSize; chart?: string; description?: string }

const ALL = ['hr', 'manager', 'employee'];
const MGMT = ['hr', 'manager'];

/**
 * Every card a user can add. `category` groups the "Add card" modal, `icon` is the preview icon,
 * `size` is the default footprint and `chart` is the visual the client renders for chart cards.
 */
export const CARD_CATALOG: CatalogEntry[] = [
  // ---- stats
  { type: 'stat', key: 'headcount', title: 'Headcount', roles: MGMT, category: 'People', icon: 'users', size: 'sm', description: 'Active employees in your scope.' },
  { type: 'stat', key: 'present_today', title: 'Present today', roles: MGMT, category: 'Attendance', icon: 'clock', size: 'sm', description: 'Employees who have punched in today.' },
  { type: 'stat', key: 'on_leave_today', title: 'On leave today', roles: MGMT, category: 'Leave', icon: 'leaf', size: 'sm' },
  { type: 'stat', key: 'pending_leaves', title: 'Pending leave approvals', roles: MGMT, category: 'Leave', icon: 'check', size: 'sm' },
  { type: 'stat', key: 'pending_corrections', title: 'Pending attendance appeals', roles: MGMT, category: 'Attendance', icon: 'edit', size: 'sm' },
  { type: 'stat', key: 'comp_off_pending', title: 'Comp-off approvals', roles: MGMT, category: 'Leave', icon: 'award', size: 'sm', description: 'Comp-off credits waiting for approval.' },
  { type: 'stat', key: 'travel_km_this_month', title: 'Travel km this month', roles: MGMT, category: 'Attendance', icon: 'mapPin', size: 'sm', description: 'Distance logged on completed trips this month.' },
  { type: 'stat', key: 'expiring_documents', title: 'Documents expiring soon', roles: ALL, category: 'Documents', icon: 'alert', size: 'sm' },
  { type: 'stat', key: 'open_vacancies', title: 'Open vacancies', roles: ['hr'], category: 'Recruitment', icon: 'briefcase', size: 'sm' },
  { type: 'stat', key: 'assets_assigned', title: 'Assets assigned', roles: ['hr'], category: 'Assets', icon: 'laptop', size: 'sm' },
  { type: 'stat', key: 'payroll_last_net', title: 'Last payroll net', roles: ['hr'], category: 'Payroll', icon: 'banknote', size: 'sm' },
  { type: 'stat', key: 'my_leave_balance', title: 'My leave balance', roles: ALL, category: 'Personal', icon: 'leaf', size: 'sm' },
  { type: 'stat', key: 'my_hours_this_month', title: 'My hours this month', roles: ALL, category: 'Personal', icon: 'clock', size: 'sm' },
  { type: 'stat', key: 'my_payslip_requests', title: 'My payslip requests', roles: ALL, category: 'Personal', icon: 'file', size: 'sm', description: 'Shortcut to request a payslip and track open requests.' },
  // ---- charts
  { type: 'chart', key: 'today_attendance', title: "Today's attendance", roles: MGMT, category: 'Attendance', icon: 'clock', size: 'md', chart: 'donut', description: 'Present, late, on leave, absent and not yet in.' },
  { type: 'chart', key: 'attendance_trend', title: 'Attendance trend', roles: MGMT, category: 'Attendance', icon: 'trendingUp', size: 'lg', chart: 'line', description: 'Present, absent and late per working day for the last 30 working days.' },
  { type: 'chart', key: 'late_comers', title: 'Late comers', roles: MGMT, category: 'Attendance', icon: 'alert', size: 'md', chart: 'hbar', description: 'Top 8 employees by late days this month.' },
  { type: 'chart', key: 'work_hours_distribution', title: 'Work hours distribution', roles: MGMT, category: 'Attendance', icon: 'grid', size: 'md', chart: 'bar', description: 'Average daily work hours per employee, bucketed.' },
  { type: 'chart', key: 'headcount_by_department', title: 'Headcount by department', roles: MGMT, category: 'People', icon: 'sitemap', size: 'md', chart: 'hbar' },
  { type: 'chart', key: 'headcount_trend', title: 'Joins vs exits', roles: MGMT, category: 'People', icon: 'trendingUp', size: 'md', chart: 'line', description: 'Monthly joins and exits for the last 12 months.' },
  { type: 'chart', key: 'gender_diversity', title: 'Gender diversity', roles: MGMT, category: 'People', icon: 'users', size: 'md', chart: 'donut' },
  { type: 'chart', key: 'tenure_distribution', title: 'Tenure distribution', roles: MGMT, category: 'People', icon: 'calendar', size: 'md', chart: 'bar' },
  { type: 'chart', key: 'leave_utilisation', title: 'Leave utilisation', roles: MGMT, category: 'Leave', icon: 'leaf', size: 'md', chart: 'hbar', description: 'Used vs allocated days per leave type this year.' },
  { type: 'chart', key: 'leave_calendar_heat', title: 'Who is away (next 14 days)', roles: MGMT, category: 'Leave', icon: 'calendar', size: 'md', chart: 'heat' },
  { type: 'chart', key: 'payroll_cost_trend', title: 'Payroll cost trend', roles: ['hr'], category: 'Payroll', icon: 'banknote', size: 'md', chart: 'line', description: 'Gross and net per run, last 6 periods.' },
  { type: 'chart', key: 'payroll_by_department', title: 'Payroll by department', roles: ['hr'], category: 'Payroll', icon: 'sitemap', size: 'md', chart: 'donut', description: 'Gross of the latest run split by department.' },
  { type: 'chart', key: 'document_compliance', title: 'Document compliance', roles: MGMT, category: 'Documents', icon: 'folder', size: 'md', chart: 'donut', description: 'Required documents: ok, expiring, expired or missing.' },
  { type: 'chart', key: 'recruitment_funnel', title: 'Recruitment funnel', roles: MGMT, category: 'Recruitment', icon: 'filter', size: 'md', chart: 'hbar', description: 'Candidates per pipeline stage and open vacancies.' },
  { type: 'chart', key: 'time_to_hire', title: 'Time to hire', roles: ['hr'], category: 'Recruitment', icon: 'clock', size: 'md', chart: 'bar', description: 'Average days from application to hire; hires per month.' },
  { type: 'chart', key: 'journey_progress', title: 'Journey progress', roles: ['hr'], category: 'Journey', icon: 'route', size: 'md', chart: 'bar', description: 'Average journey completion and employees per in-progress stage.' },
  { type: 'chart', key: 'asset_utilisation', title: 'Asset utilisation', roles: ['hr'], category: 'Assets', icon: 'laptop', size: 'md', chart: 'donut' },
  { type: 'chart', key: 'my_week', title: 'My week', roles: ALL, category: 'Personal', icon: 'clock', size: 'md', chart: 'bar', description: 'Your work hours for the last 7 days and today\'s status.' },
  { type: 'chart', key: 'my_leave_balance_chart', title: 'My leave balance', roles: ALL, category: 'Personal', icon: 'leaf', size: 'md', chart: 'donut', description: 'Used vs available per leave type.' },
  // ---- lists
  { type: 'list', key: 'approvals_queue', title: 'Approvals queue', roles: MGMT, category: 'Leave', icon: 'check', size: 'md', description: 'Pending leave, appeals, comp-off and payslip requests grouped by type.' },
  { type: 'list', key: 'recent_joiners', title: 'Recent joiners', roles: MGMT, category: 'People', icon: 'userPlus', size: 'md' },
  { type: 'list', key: 'upcoming_birthdays', title: 'Upcoming birthdays', roles: ALL, category: 'People', icon: 'star', size: 'md' },
  { type: 'list', key: 'expiring_documents_list', title: 'Expiring documents', roles: ALL, category: 'Documents', icon: 'folder', size: 'md' },
  { type: 'list', key: 'pending_approvals', title: 'Pending approvals', roles: MGMT, category: 'Leave', icon: 'check', size: 'md' },
  { type: 'list', key: 'upcoming_holidays', title: 'Upcoming holidays', roles: ALL, category: 'Personal', icon: 'sun', size: 'md' },
  { type: 'list', key: 'journey_in_progress', title: 'Journeys in progress', roles: ['hr'], category: 'Journey', icon: 'route', size: 'md' },
  { type: 'list', key: 'my_recent_payslips', title: 'My recent payslips', roles: ALL, category: 'Personal', icon: 'banknote', size: 'md' },
  // ---- misc
  { type: 'link', key: 'quick_links', title: 'Quick links', roles: ALL, category: 'Personal', icon: 'compass', size: 'md' },
  { type: 'note', key: 'note', title: 'Note', roles: ALL, category: 'Personal', icon: 'edit', size: 'md' },
];
export const CARD_TYPES: CardType[] = ['stat', 'list', 'link', 'note', 'chart'];

const DEFAULT_CARDS: Record<string, string[]> = {
  hr: ['headcount', 'present_today', 'pending_leaves', 'expiring_documents', 'today_attendance', 'headcount_by_department', 'attendance_trend', 'leave_utilisation', 'document_compliance', 'recruitment_funnel', 'payroll_cost_trend', 'approvals_queue', 'late_comers', 'expiring_documents_list', 'upcoming_holidays'],
  manager: ['headcount', 'present_today', 'pending_leaves', 'comp_off_pending', 'approvals_queue', 'today_attendance', 'attendance_trend', 'late_comers', 'leave_calendar_heat', 'my_week', 'my_leave_balance_chart'],
  employee: ['my_week', 'my_leave_balance_chart', 'my_hours_this_month', 'expiring_documents', 'my_payslip_requests', 'my_recent_payslips', 'expiring_documents_list', 'upcoming_holidays', 'quick_links'],
};

function ensureDefaults(userId: number, role: string) {
  if (get('SELECT 1 FROM dashboard_cards WHERE user_id = ?', [userId])) return;
  (DEFAULT_CARDS[role] || DEFAULT_CARDS.employee).forEach((key, i) => {
    const c = CARD_CATALOG.find((x) => x.key === key)!;
    insert('dashboard_cards', { user_id: userId, type: c.type, title: c.title, config: { key }, size: c.size, sort_order: i, created_at: nowIso() });
  });
}

r.get('/catalog', requireAuth, (req, res) => res.json(CARD_CATALOG.filter((c) => c.roles.includes(req.user!.role))));
r.get('/cards', requireAuth, (req, res) => {
  ensureDefaults(req.user!.id, req.user!.role);
  res.json(parseJsonAll(all('SELECT * FROM dashboard_cards WHERE user_id = ? ORDER BY sort_order, id', [req.user!.id]), ['config']));
});
// No cap on the number of cards: HR can add as many as they like.
r.post('/cards', requireAuth, wrap(async (req, res) => {
  requireFields(req.body, ['type', 'title']);
  if (!CARD_TYPES.includes(req.body.type)) throw badRequest('Invalid card type');
  const config = req.body.config && typeof req.body.config === 'object' ? req.body.config : {};
  const entry = config.key ? CARD_CATALOG.find((c) => c.key === config.key && c.roles.includes(req.user!.role)) : undefined;
  if (config.key && !entry) throw badRequest('Unknown card key for your role');
  if (entry && entry.type !== req.body.type && !(entry.type === 'chart' && req.body.type === 'chart')) throw badRequest(`Card "${entry.title}" is a ${entry.type} card`);
  const order = (get<any>('SELECT COALESCE(MAX(sort_order), -1) AS m FROM dashboard_cards WHERE user_id = ?', [req.user!.id])!.m) + 1;
  const size: CardSize = ['sm', 'md', 'lg'].includes(req.body.size) ? req.body.size : entry?.size ?? 'sm';
  const id = insert('dashboard_cards', { user_id: req.user!.id, type: req.body.type, title: String(req.body.title).slice(0, 100), config, size, sort_order: order, created_at: nowIso() });
  res.status(201).json(parseJsonAll([get('SELECT * FROM dashboard_cards WHERE id = ?', [id])!], ['config'])[0]);
}));
r.put('/cards/reorder', requireAuth, wrap(async (req, res) => {
  const ids: number[] = Array.isArray(req.body.ids) ? req.body.ids.map(Number) : [];
  transaction(() => ids.forEach((id, i) => run('UPDATE dashboard_cards SET sort_order = ? WHERE id = ? AND user_id = ?', [i, id, req.user!.id])));
  res.json({ ok: true });
}));
r.put('/cards/:id', requireAuth, wrap(async (req, res) => {
  const id = toInt(req.params.id)!;
  if (!get('SELECT 1 FROM dashboard_cards WHERE id = ? AND user_id = ?', [id, req.user!.id])) throw notFound();
  const data: any = pick(req.body, ['title', 'config', 'size']);
  if (data.size !== undefined && !['sm', 'md', 'lg'].includes(data.size)) throw badRequest('Invalid size');
  update('dashboard_cards', id, data);
  res.json(parseJsonAll([get('SELECT * FROM dashboard_cards WHERE id = ?', [id])!], ['config'])[0]);
}));
r.delete('/cards/:id', requireAuth, (req, res) => {
  if (!run('DELETE FROM dashboard_cards WHERE id = ? AND user_id = ?', [toInt(req.params.id), req.user!.id]).changes) throw notFound();
  res.json({ ok: true });
});
r.post('/cards/reset', requireAuth, (req, res) => {
  run('DELETE FROM dashboard_cards WHERE user_id = ?', [req.user!.id]);
  ensureDefaults(req.user!.id, req.user!.role);
  res.json(parseJsonAll(all('SELECT * FROM dashboard_cards WHERE user_id = ? ORDER BY sort_order, id', [req.user!.id]), ['config']));
});

/* ------------------------------------------------------------------ */
/* Data                                                                */
/* ------------------------------------------------------------------ */
const monthKey = (d: string) => d.slice(0, 7);
const monthStartOf = (d: string) => d.slice(0, 7) + '-01';
const r1 = (n: number) => Math.round(n * 10) / 10;
/** Last N 'YYYY-MM' keys ending with the current month. */
function lastMonths(n: number): string[] {
  const out: string[] = [];
  const now = new Date(today() + 'T00:00:00Z');
  for (let i = n - 1; i >= 0; i--) out.push(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)).toISOString().slice(0, 7));
  return out;
}

/**
 * All the numbers, lists and chart series the cards can show, computed in one call.
 * Scope: HR sees the company; managers their whole reporting chain plus themselves; employees themselves.
 */
r.get('/data', requireAuth, (req, res) => {
  const t = today();
  const role = req.user!.role;
  const eid = req.user!.employee_id;
  const isHr = role === 'hr';
  const chain = approvableEmployeeIds(req); // undefined = HR
  const ids: number[] | undefined = chain ? Array.from(new Set([...(eid ? [eid] : []), ...chain])).map(Number) : undefined;
  const idList = ids ? ids.join(',') || 'NULL' : '';
  const scope = (col: string) => (ids ? ` AND ${col} IN (${idList})` : '');
  const n = (sql: string, params: any[] = []) => get<any>(sql, params)?.n ?? 0;
  const year = new Date().getFullYear();
  const monthStart = monthStartOf(t);
  const attSettings = getSetting('attendance', DEFAULT_ATTENDANCE_SETTINGS);
  const offs: number[] = attSettings.weekly_offs || [0, 6];
  const isOff = (d: string, holidays: Set<string>) => offs.includes(new Date(d + 'T00:00:00Z').getUTCDay()) || holidays.has(d);

  // ---- people in scope
  const people = all<any>(`SELECT e.id, e.first_name, e.last_name, e.gender, e.join_date, e.exit_date, e.status, e.department_id, d.name AS department_name FROM employees e LEFT JOIN departments d ON d.id = e.department_id WHERE e.status != 'exited'${scope('e.id')} ORDER BY e.first_name`);
  const headcount = people.length;
  const name = (p: any) => `${p.first_name} ${p.last_name}`.trim();

  // ---- documents
  const docs = all<any>(`SELECT d.id, d.title, d.expiry_date, d.employee_id, d.document_type_id, t.name AS type_name, t.expiry_warning_days, t.expiry_critical_days, e.first_name || ' ' || e.last_name AS employee_name FROM documents d LEFT JOIN document_types t ON t.id = d.document_type_id JOIN employees e ON e.id = d.employee_id WHERE e.status != 'exited'${scope('d.employee_id')} ORDER BY d.expiry_date`);
  docs.forEach((d) => Object.assign(d, documentStatus(d)));
  const expiring = docs.filter((d) => d.expiry_date && ['warning', 'critical', 'expired'].includes(d.expiry_state));
  const requiredTypes = all<any>('SELECT id, name FROM document_types WHERE active = 1 AND required_for_all = 1');
  const compliance = { ok: 0, warning: 0, critical: 0, expired: 0, missing: 0, required_types: requiredTypes.length, employees: headcount, expiring_7d: docs.filter((d) => d.expiry_date && d.days_to_expiry !== null && d.days_to_expiry >= 0 && d.days_to_expiry <= 7).length };
  for (const p of people) for (const ty of requiredTypes) {
    const mine = docs.filter((d) => d.employee_id === p.id && d.document_type_id === ty.id).sort((a, b) => (b.expiry_date || '9999').localeCompare(a.expiry_date || '9999'));
    const state = mine[0] ? (mine[0].expiry_state === 'none' ? 'ok' : mine[0].expiry_state) : 'missing';
    (compliance as any)[state] = ((compliance as any)[state] || 0) + 1;
  }

  // ---- attendance: last 30 working days + today + this month
  const holidaySet = new Set(all<any>('SELECT date FROM holidays WHERE date BETWEEN ? AND ?', [addDays(t, -60), addDays(t, 20)]).map((h) => h.date));
  const workingDays: string[] = [];
  for (let d = t; workingDays.length < 30 && d >= addDays(t, -60); d = addDays(d, -1)) if (!isOff(d, holidaySet)) workingDays.unshift(d);
  const trendStart = workingDays[0] || t;
  const att = all<any>(`SELECT a.employee_id, a.date, a.status, a.work_minutes, a.late_minutes, a.punch_in_at, a.punch_out_at FROM attendance_records a JOIN employees e ON e.id = a.employee_id WHERE a.date BETWEEN ? AND ? AND e.status != 'exited'${scope('a.employee_id')}`, [trendStart < monthStart ? trendStart : monthStart, t]);
  const leavesInRange = all<any>(`SELECT l.employee_id, l.start_date, l.end_date, l.half_day, ty.name AS type_name, e.first_name || ' ' || e.last_name AS employee_name FROM leave_requests l JOIN leave_types ty ON ty.id = l.leave_type_id JOIN employees e ON e.id = l.employee_id WHERE l.status = 'approved' AND l.end_date >= ? AND l.start_date <= ?${scope('l.employee_id')}`, [trendStart, addDays(t, 14)]);
  const onLeave = (empId: number, d: string) => leavesInRange.some((l) => l.employee_id === empId && d >= l.start_date && d <= l.end_date);
  const byDate = new Map<string, any[]>();
  for (const a of att) { if (!byDate.has(a.date)) byDate.set(a.date, []); byDate.get(a.date)!.push(a); }
  const worked = (a: any) => ['present', 'half_day', 'wfh'].includes(a.status);
  const attendance_trend = { labels: [] as string[], present: [] as number[], absent: [] as number[], late: [] as number[], leave: [] as number[] };
  for (const d of workingDays) {
    const recs = (byDate.get(d) || []);
    const present = recs.filter(worked).length;
    const late = recs.filter((a) => worked(a) && a.late_minutes > 0).length;
    const leave = people.filter((p) => (!p.join_date || p.join_date <= d) && !recs.some((a) => a.employee_id === p.id) && onLeave(p.id, d)).length;
    const eligible = people.filter((p) => !p.join_date || p.join_date <= d).length;
    attendance_trend.labels.push(d);
    attendance_trend.present.push(present);
    attendance_trend.late.push(late);
    attendance_trend.leave.push(leave);
    attendance_trend.absent.push(Math.max(0, eligible - present - leave));
  }
  const todayRecs = byDate.get(t) || [];
  const today_attendance = { present: 0, late: 0, on_leave: 0, absent: 0, not_in: 0, total: headcount, date: t, off_day: isOff(t, holidaySet) };
  for (const p of people) {
    const rec = todayRecs.find((a) => a.employee_id === p.id);
    if (rec && worked(rec)) { if (rec.late_minutes > 0) today_attendance.late += 1; else today_attendance.present += 1; }
    else if (rec && rec.status === 'absent') today_attendance.absent += 1;
    else if (rec && rec.status === 'leave') today_attendance.on_leave += 1;
    else if (!rec && onLeave(p.id, t)) today_attendance.on_leave += 1;
    else today_attendance.not_in += 1;
  }
  const monthRecs = att.filter((a) => a.date >= monthStart);
  const lateMap = new Map<number, { days: number; minutes: number }>();
  for (const a of monthRecs) if (worked(a) && a.late_minutes > 0) { const cur = lateMap.get(a.employee_id) || { days: 0, minutes: 0 }; cur.days += 1; cur.minutes += a.late_minutes; lateMap.set(a.employee_id, cur); }
  const late_comers = people.filter((p) => lateMap.has(p.id)).map((p) => { const l = lateMap.get(p.id)!; return { id: p.id, name: name(p), department_name: p.department_name, late_days: l.days, avg_late_minutes: Math.round(l.minutes / l.days) }; }).sort((a, b) => b.late_days - a.late_days || b.avg_late_minutes - a.avg_late_minutes).slice(0, 8);
  const hoursByEmp = new Map<number, number[]>();
  for (const a of monthRecs) if (worked(a) && a.work_minutes > 0) { if (!hoursByEmp.has(a.employee_id)) hoursByEmp.set(a.employee_id, []); hoursByEmp.get(a.employee_id)!.push(a.work_minutes / 60); }
  const buckets: { label: string; key: string; min: number; max: number; value: number }[] = [
    { label: '<6h', key: 'lt6', min: 0, max: 6, value: 0 }, { label: '6–8h', key: '6to8', min: 6, max: 8, value: 0 }, { label: '8–9h', key: '8to9', min: 8, max: 9, value: 0 }, { label: '9–10h', key: '9to10', min: 9, max: 10, value: 0 }, { label: '>10h', key: 'gt10', min: 10, max: Infinity, value: 0 },
  ];
  let hoursSum = 0, hoursN = 0;
  for (const [, hrs] of hoursByEmp) { const avg = hrs.reduce((s, x) => s + x, 0) / hrs.length; hoursSum += avg; hoursN += 1; (buckets.find((b) => avg >= b.min && avg < b.max) || buckets[4]).value += 1; }
  const work_hours_distribution = { buckets: buckets.map(({ label, key, value }) => ({ label, key, value })), avg_hours: hoursN ? r1(hoursSum / hoursN) : 0, employees: hoursN };

  // ---- people charts
  const deptMap = new Map<number | null, { id: number | null; label: string; value: number }>();
  for (const p of people) { const k = p.department_id ?? null; if (!deptMap.has(k)) deptMap.set(k, { id: k, label: p.department_name || 'Unassigned', value: 0 }); deptMap.get(k)!.value += 1; }
  const headcount_by_department = Array.from(deptMap.values()).sort((a, b) => b.value - a.value);
  const months12 = lastMonths(12);
  const joinsExits = all<any>(`SELECT join_date, exit_date, status FROM employees e WHERE 1=1${scope('e.id')}`);
  const headcount_trend = { labels: months12, joins: months12.map((m) => joinsExits.filter((e) => e.join_date && monthKey(e.join_date) === m).length), exits: months12.map((m) => joinsExits.filter((e) => e.exit_date && monthKey(e.exit_date) === m).length) };
  const genderMap = new Map<string, number>();
  for (const p of people) { const g = p.gender ? p.gender[0].toUpperCase() + p.gender.slice(1) : 'Not specified'; genderMap.set(g, (genderMap.get(g) || 0) + 1); }
  const gender_diversity = Array.from(genderMap, ([label, value]) => ({ label, value }));
  const tenure = [{ label: '<1y', key: 'lt1', value: 0 }, { label: '1–3y', key: '1to3', value: 0 }, { label: '3–5y', key: '3to5', value: 0 }, { label: '5y+', key: 'gt5', value: 0 }];
  for (const p of people) { const yrs = p.join_date ? (Date.parse(t) - Date.parse(p.join_date)) / (365.25 * 86400000) : 0; (yrs < 1 ? tenure[0] : yrs < 3 ? tenure[1] : yrs < 5 ? tenure[2] : tenure[3]).value += 1; }

  // ---- leave
  const leave_utilisation = all<any>(`SELECT ty.id, ty.name, ty.color, COALESCE(SUM(b.allocated + b.carried + b.adjusted), 0) AS allocated, COALESCE(SUM(b.used), 0) AS used FROM leave_types ty LEFT JOIN leave_balances b ON b.leave_type_id = ty.id AND b.year = ? AND b.employee_id IN (SELECT e.id FROM employees e WHERE e.status != 'exited'${scope('e.id')}) WHERE ty.active = 1 GROUP BY ty.id ORDER BY allocated DESC, ty.name`, [year]);
  const leave_calendar_heat = eachDay(t, addDays(t, 13)).map((d) => { const away = leavesInRange.filter((l) => d >= l.start_date && d <= l.end_date); const names = Array.from(new Set(away.map((l) => l.employee_name))); return { date: d, count: names.length, names: names.slice(0, 4), off: isOff(d, holidaySet) }; });
  const myBal = eid ? all<any>('SELECT b.*, t.name, t.color, (b.allocated + b.carried + b.adjusted - b.used) AS available FROM leave_balances b JOIN leave_types t ON t.id = b.leave_type_id WHERE b.employee_id = ? AND b.year = ? AND t.active = 1', [eid, year]) : [];

  // ---- approvals in scope (manager chain excludes self for approvals)
  const approvalScope = (col: string) => (chain ? ` AND ${col} IN (${chain.join(',') || 'NULL'})` : '');
  const pendingLeaves = n(`SELECT COUNT(*) AS n FROM leave_requests l WHERE l.status IN ('pending','correction_pending')${approvalScope('l.employee_id')}`);
  const pendingAppeals = n(`SELECT COUNT(*) AS n FROM attendance_corrections c WHERE c.status = 'pending'${approvalScope('c.employee_id')}`);
  const pendingCompOff = n(`SELECT COUNT(*) AS n FROM comp_off_credits c WHERE c.status = 'pending'${approvalScope('c.employee_id')}`);
  const pendingPayslipReq = isHr ? n(`SELECT COUNT(*) AS n FROM payslip_requests WHERE status = 'pending'`) : 0;
  const approvals_queue = [
    { kind: 'leave', label: 'Leave requests', count: pendingLeaves, to: '/leave?tab=approvals' },
    { kind: 'appeal', label: 'Attendance appeals', count: pendingAppeals, to: '/attendance?tab=corrections' },
    { kind: 'comp_off', label: 'Comp-off credits', count: pendingCompOff, to: '/leave?tab=compoff' },
    ...(isHr ? [{ kind: 'payslip', label: 'Payslip requests', count: pendingPayslipReq, to: '/payroll?tab=requests' }] : []),
  ];

  // ---- payroll (HR only)
  const lastRun = parseJsonAll(all("SELECT * FROM payroll_runs WHERE status IN ('approved','paid','processed') ORDER BY period DESC LIMIT 1"), ['totals'])[0];
  let payroll_cost_trend: any[] = [];
  let payroll_by_department: any = { period: null, items: [] };
  if (isHr) {
    payroll_cost_trend = parseJsonAll(all("SELECT id, period, status, totals FROM payroll_runs WHERE status IN ('processed','approved','paid') ORDER BY period DESC LIMIT 6"), ['totals']).reverse().map((x: any) => ({ id: x.id, period: x.period, status: x.status, gross: x.totals?.gross ?? 0, net: x.totals?.net ?? 0, employees: x.totals?.employees ?? 0 }));
    if (lastRun) payroll_by_department = { period: lastRun.period, run_id: lastRun.id, status: lastRun.status, items: all<any>('SELECT d.id, COALESCE(d.name, \'Unassigned\') AS label, ROUND(SUM(p.gross), 2) AS value, COUNT(*) AS employees FROM payslips p JOIN employees e ON e.id = p.employee_id LEFT JOIN departments d ON d.id = e.department_id WHERE p.run_id = ? GROUP BY d.id ORDER BY value DESC', [lastRun.id]) };
  }

  // ---- recruitment / journey / assets
  const stageOrder = ['new', 'screening', 'interview', 'offer', 'hired', 'rejected', 'withdrawn'];
  const stageCounts: Record<string, number> = Object.fromEntries(stageOrder.map((s) => [s, 0]));
  for (const row of all<any>('SELECT stage, COUNT(*) AS n FROM candidates GROUP BY stage')) stageCounts[row.stage] = row.n;
  const recruitment_funnel = { stages: stageCounts, candidates: Object.values(stageCounts).reduce((s, x) => s + x, 0), open_vacancies: n("SELECT COUNT(*) AS n FROM vacancies WHERE status = 'open'"), openings: n("SELECT COALESCE(SUM(openings),0) AS n FROM vacancies WHERE status = 'open'") };
  const hired = all<any>("SELECT c.created_at, COALESCE((SELECT MIN(ev.created_at) FROM candidate_events ev WHERE ev.candidate_id = c.id AND ev.type = 'hired'), c.updated_at) AS hired_at FROM candidates c WHERE c.stage = 'hired'");
  const months6 = lastMonths(6);
  const time_to_hire = { avg_days: hired.length ? r1(hired.reduce((s, h) => s + Math.max(0, (Date.parse(h.hired_at) - Date.parse(h.created_at)) / 86400000), 0) / hired.length) : null, hires: hired.length, hires_by_month: months6.map((m) => ({ label: m, value: hired.filter((h) => monthKey(h.hired_at) === m).length })) };
  const journeyTotals = all<any>(`SELECT s.employee_id, SUM(CASE WHEN s.status IN ('completed','skipped') THEN 1 ELSE 0 END) AS done, COUNT(*) AS total FROM journey_stages s JOIN employees e ON e.id = s.employee_id WHERE e.status != 'exited'${scope('s.employee_id')} GROUP BY s.employee_id`);
  const journey_progress = {
    avg_completion: journeyTotals.length ? Math.round(journeyTotals.reduce((s, j) => s + (j.total ? j.done / j.total : 0), 0) / journeyTotals.length * 100) : 0,
    employees: journeyTotals.length,
    by_stage: all<any>(`SELECT s.name AS label, COUNT(DISTINCT s.employee_id) AS value FROM journey_stages s JOIN employees e ON e.id = s.employee_id WHERE s.status = 'in_progress' AND s.name != 'Current role' AND e.status != 'exited'${scope('s.employee_id')} GROUP BY s.name ORDER BY value DESC, MIN(s.sort_order)`),
  };
  const assetCounts: Record<string, number> = { assigned: 0, available: 0, maintenance: 0, retired: 0, lost: 0 };
  for (const row of all<any>('SELECT status, COUNT(*) AS n FROM assets GROUP BY status')) assetCounts[row.status] = row.n;
  const asset_utilisation = { ...assetCounts, total: Object.values(assetCounts).reduce((s, x) => s + x, 0), warranty_expiring_30d: n('SELECT COUNT(*) AS n FROM assets WHERE warranty_expiry IS NOT NULL AND warranty_expiry BETWEEN ? AND ? AND status != \'retired\'', [t, addDays(t, 30)]) };

  // ---- personal
  const weekDays = eachDay(addDays(t, -6), t);
  const myRecs = eid ? all<any>('SELECT date, status, work_minutes, late_minutes, punch_in_at, punch_out_at FROM attendance_records WHERE employee_id = ? AND date BETWEEN ? AND ?', [eid, weekDays[0], t]) : [];
  const myToday = myRecs.find((x) => x.date === t);
  const my_week = {
    days: weekDays.map((d) => { const rec = myRecs.find((x) => x.date === d); return { date: d, hours: rec ? r1(rec.work_minutes / 60) : 0, status: rec ? rec.status : (eid && onLeave(eid, d) ? 'leave' : isOff(d, holidaySet) ? 'off' : d < t ? 'absent' : 'none'), late_minutes: rec?.late_minutes ?? 0 }; }),
    today: { status: myToday ? (myToday.punch_out_at ? 'punched_out' : 'punched_in') : eid && onLeave(eid, t) ? 'leave' : isOff(t, holidaySet) ? 'off' : 'not_in', punch_in_at: myToday?.punch_in_at ?? null, punch_out_at: myToday?.punch_out_at ?? null, work_minutes: myToday?.work_minutes ?? 0, late_minutes: myToday?.late_minutes ?? 0 },
    total_hours: r1(myRecs.reduce((s, x) => s + x.work_minutes, 0) / 60),
  };

  const data: Record<string, any> = {
    scope: isHr ? 'company' : ids && ids.length > 1 ? 'team' : 'self',
    headcount,
    present_today: today_attendance.present + today_attendance.late,
    on_leave_today: today_attendance.on_leave,
    pending_leaves: pendingLeaves,
    pending_corrections: pendingAppeals,
    comp_off_pending: pendingCompOff,
    travel_km_this_month: r1(get<any>(`SELECT COALESCE(SUM(distance_km),0) AS km FROM travel_logs tl WHERE tl.status = 'completed' AND tl.started_at >= ?${scope('tl.employee_id')}`, [monthStart])?.km ?? 0),
    expiring_documents: expiring.length,
    open_vacancies: recruitment_funnel.openings,
    assets_assigned: assetCounts.assigned,
    payroll_last_net: lastRun ? { period: lastRun.period, net: lastRun.totals?.net ?? 0, status: lastRun.status } : null,
    my_leave_balance: myBal.reduce((s, b) => s + b.available, 0),
    my_leave_balance_detail: myBal,
    my_hours_this_month: eid ? r1(get<any>('SELECT COALESCE(SUM(work_minutes),0) AS m FROM attendance_records WHERE employee_id = ? AND date >= ?', [eid, monthStart])!.m / 60) : 0,
    my_payslip_requests: eid ? { pending: n('SELECT COUNT(*) AS n FROM payslip_requests WHERE employee_id = ? AND status = \'pending\'', [eid]), fulfilled: n('SELECT COUNT(*) AS n FROM payslip_requests WHERE employee_id = ? AND status = \'fulfilled\'', [eid]) } : { pending: 0, fulfilled: 0 },
    // charts
    today_attendance,
    attendance_trend,
    late_comers,
    work_hours_distribution,
    headcount_by_department,
    headcount_trend,
    gender_diversity,
    tenure_distribution: tenure,
    leave_utilisation,
    leave_calendar_heat,
    payroll_cost_trend,
    payroll_by_department,
    document_compliance: compliance,
    recruitment_funnel,
    time_to_hire,
    journey_progress,
    asset_utilisation,
    my_week,
    // lists
    approvals_queue,
    recent_joiners: all(`SELECT e.id, e.first_name, e.last_name, e.join_date, d.name AS department_name, p.title AS position_title FROM employees e LEFT JOIN departments d ON d.id = e.department_id LEFT JOIN positions p ON p.id = e.position_id WHERE e.status != 'exited'${scope('e.id')} ORDER BY e.join_date DESC LIMIT 8`),
    upcoming_birthdays: all<any>("SELECT id, first_name, last_name, dob FROM employees WHERE dob IS NOT NULL AND status != 'exited'").map((e) => ({ ...e, next: nextBirthday(e.dob) })).sort((a, b) => a.next.localeCompare(b.next)).slice(0, 8),
    expiring_documents_list: expiring.slice(0, 10),
    pending_approvals: [
      ...all<any>(`SELECT l.id, 'leave' AS kind, l.start_date AS date, t.name AS detail, e.first_name || ' ' || e.last_name AS employee_name, l.days FROM leave_requests l JOIN leave_types t ON t.id = l.leave_type_id JOIN employees e ON e.id = l.employee_id WHERE l.status IN ('pending','correction_pending')${approvalScope('l.employee_id')} ORDER BY l.start_date LIMIT 10`),
      ...all<any>(`SELECT c.id, 'attendance' AS kind, c.date, c.reason AS detail, e.first_name || ' ' || e.last_name AS employee_name, NULL AS days FROM attendance_corrections c JOIN employees e ON e.id = c.employee_id WHERE c.status = 'pending'${approvalScope('c.employee_id')} ORDER BY c.date LIMIT 10`),
    ],
    upcoming_holidays: all('SELECT * FROM holidays WHERE date >= ? ORDER BY date LIMIT 6', [t]),
    journey_in_progress: all(`SELECT e.id, e.first_name, e.last_name, s.name AS stage, (SELECT COUNT(*) FROM journey_stages x WHERE x.employee_id = e.id AND x.status IN ('completed','skipped')) AS done, (SELECT COUNT(*) FROM journey_stages x WHERE x.employee_id = e.id) AS total FROM employees e JOIN journey_stages s ON s.employee_id = e.id AND s.status = 'in_progress' WHERE e.status != 'exited'${scope('e.id')} ORDER BY e.join_date DESC LIMIT 8`),
    my_recent_payslips: eid ? all("SELECT p.id, r.period, p.net, p.gross, p.currency, r.status FROM payslips p JOIN payroll_runs r ON r.id = p.run_id WHERE p.employee_id = ? AND r.status IN ('approved','paid') ORDER BY r.period DESC LIMIT 6", [eid]) : [],
    company: getSetting('company', {}),
    computed_at: nowIso(),
  };
  res.json(data);
});
function nextBirthday(dob: string) {
  const t = new Date();
  const [, m, d] = dob.split('-').map(Number);
  let next = new Date(Date.UTC(t.getUTCFullYear(), m - 1, d));
  if (next.toISOString().slice(0, 10) < t.toISOString().slice(0, 10)) next = new Date(Date.UTC(t.getUTCFullYear() + 1, m - 1, d));
  return next.toISOString().slice(0, 10);
}

export default r;
