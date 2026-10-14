import { Router } from 'express';
import { all, get, insert, update, run, getSetting, parseJsonAll, transaction } from '../db.js';
import { requireAuth, visibleEmployeeIds } from '../auth.js';
import { badRequest, notFound, pick, requireFields, toInt, nowIso, today, wrap } from '../util.js';
import { documentStatus } from './documents.js';

const r = Router();

export const CARD_CATALOG = [
  { type: 'stat', key: 'headcount', title: 'Headcount', roles: ['hr', 'manager'] },
  { type: 'stat', key: 'present_today', title: 'Present today', roles: ['hr', 'manager'] },
  { type: 'stat', key: 'on_leave_today', title: 'On leave today', roles: ['hr', 'manager'] },
  { type: 'stat', key: 'pending_leaves', title: 'Pending leave approvals', roles: ['hr', 'manager'] },
  { type: 'stat', key: 'pending_corrections', title: 'Pending attendance corrections', roles: ['hr', 'manager'] },
  { type: 'stat', key: 'expiring_documents', title: 'Documents expiring soon', roles: ['hr', 'manager', 'employee'] },
  { type: 'stat', key: 'open_vacancies', title: 'Open vacancies', roles: ['hr'] },
  { type: 'stat', key: 'assets_assigned', title: 'Assets assigned', roles: ['hr'] },
  { type: 'stat', key: 'payroll_last_net', title: 'Last payroll net', roles: ['hr'] },
  { type: 'stat', key: 'my_leave_balance', title: 'My leave balance', roles: ['hr', 'manager', 'employee'] },
  { type: 'stat', key: 'my_hours_this_month', title: 'My hours this month', roles: ['hr', 'manager', 'employee'] },
  { type: 'list', key: 'recent_joiners', title: 'Recent joiners', roles: ['hr', 'manager'] },
  { type: 'list', key: 'upcoming_birthdays', title: 'Upcoming birthdays', roles: ['hr', 'manager', 'employee'] },
  { type: 'list', key: 'expiring_documents_list', title: 'Expiring documents', roles: ['hr', 'manager', 'employee'] },
  { type: 'list', key: 'pending_approvals', title: 'Pending approvals', roles: ['hr', 'manager'] },
  { type: 'list', key: 'upcoming_holidays', title: 'Upcoming holidays', roles: ['hr', 'manager', 'employee'] },
  { type: 'list', key: 'journey_in_progress', title: 'Journeys in progress', roles: ['hr'] },
  { type: 'list', key: 'my_recent_payslips', title: 'My recent payslips', roles: ['hr', 'manager', 'employee'] },
  { type: 'link', key: 'quick_links', title: 'Quick links', roles: ['hr', 'manager', 'employee'] },
  { type: 'note', key: 'note', title: 'Note', roles: ['hr', 'manager', 'employee'] },
];
const DEFAULT_CARDS: Record<string, string[]> = {
  hr: ['headcount', 'present_today', 'pending_leaves', 'expiring_documents', 'open_vacancies', 'assets_assigned', 'pending_approvals', 'expiring_documents_list', 'recent_joiners', 'upcoming_holidays', 'journey_in_progress'],
  manager: ['headcount', 'present_today', 'pending_leaves', 'pending_approvals', 'my_leave_balance', 'upcoming_holidays'],
  employee: ['my_leave_balance', 'my_hours_this_month', 'expiring_documents', 'my_recent_payslips', 'upcoming_holidays', 'upcoming_birthdays', 'quick_links'],
};

function ensureDefaults(userId: number, role: string) {
  if (get('SELECT 1 FROM dashboard_cards WHERE user_id = ?', [userId])) return;
  (DEFAULT_CARDS[role] || DEFAULT_CARDS.employee).forEach((key, i) => {
    const c = CARD_CATALOG.find((x) => x.key === key)!;
    insert('dashboard_cards', { user_id: userId, type: c.type, title: c.title, config: { key }, size: c.type === 'stat' ? 'sm' : 'md', sort_order: i, created_at: nowIso() });
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
  if (!['stat', 'list', 'link', 'note'].includes(req.body.type)) throw badRequest('Invalid card type');
  const config = req.body.config && typeof req.body.config === 'object' ? req.body.config : {};
  if (config.key && !CARD_CATALOG.find((c) => c.key === config.key && c.roles.includes(req.user!.role))) throw badRequest('Unknown card key for your role');
  const order = (get<any>('SELECT COALESCE(MAX(sort_order), -1) AS m FROM dashboard_cards WHERE user_id = ?', [req.user!.id])!.m) + 1;
  const id = insert('dashboard_cards', { user_id: req.user!.id, type: req.body.type, title: String(req.body.title).slice(0, 100), config, size: ['sm', 'md', 'lg'].includes(req.body.size) ? req.body.size : 'sm', sort_order: order, created_at: nowIso() });
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

/** All the numbers/lists the cards can show, computed in one call. */
r.get('/data', requireAuth, (req, res) => {
  const t = today();
  const vis = visibleEmployeeIds(req);
  const scope = vis ? ` AND e.id IN (${vis.map(() => '?').join(',') || 'NULL'})` : '';
  const eid = req.user!.employee_id;
  const year = new Date().getFullYear();
  const docs = all<any>(`SELECT d.id, d.title, d.expiry_date, d.employee_id, t.name AS type_name, t.expiry_warning_days, t.expiry_critical_days, e.first_name || ' ' || e.last_name AS employee_name FROM documents d LEFT JOIN document_types t ON t.id = d.document_type_id JOIN employees e ON e.id = d.employee_id WHERE d.expiry_date IS NOT NULL${scope} ORDER BY d.expiry_date`, vis ?? []);
  docs.forEach((d) => Object.assign(d, documentStatus(d)));
  const expiring = docs.filter((d) => ['warning', 'critical', 'expired'].includes(d.expiry_state));
  const myBal = eid ? all<any>('SELECT b.*, t.name, t.color, (b.allocated + b.carried + b.adjusted - b.used) AS available FROM leave_balances b JOIN leave_types t ON t.id = b.leave_type_id WHERE b.employee_id = ? AND b.year = ? AND t.active = 1', [eid, year]) : [];
  const monthStart = t.slice(0, 7) + '-01';
  const lastRun = parseJsonAll(all("SELECT * FROM payroll_runs WHERE status IN ('approved','paid','processed') ORDER BY period DESC LIMIT 1"), ['totals'])[0];
  const data: Record<string, any> = {
    headcount: get<any>(`SELECT COUNT(*) AS n FROM employees e WHERE e.status != 'exited'${scope}`, vis ?? [])!.n,
    present_today: get<any>(`SELECT COUNT(*) AS n FROM attendance_records a JOIN employees e ON e.id = a.employee_id WHERE a.date = ? AND a.status IN ('present','half_day','wfh')${scope}`, [t, ...(vis ?? [])])!.n,
    on_leave_today: get<any>(`SELECT COUNT(DISTINCT l.employee_id) AS n FROM leave_requests l JOIN employees e ON e.id = l.employee_id WHERE l.status = 'approved' AND ? BETWEEN l.start_date AND l.end_date${scope}`, [t, ...(vis ?? [])])!.n,
    pending_leaves: get<any>(`SELECT COUNT(*) AS n FROM leave_requests l JOIN employees e ON e.id = l.employee_id WHERE l.status IN ('pending','correction_pending')${scope}`, vis ?? [])!.n,
    pending_corrections: get<any>(`SELECT COUNT(*) AS n FROM attendance_corrections c JOIN employees e ON e.id = c.employee_id WHERE c.status = 'pending'${scope}`, vis ?? [])!.n,
    expiring_documents: expiring.length,
    open_vacancies: get<any>("SELECT COALESCE(SUM(openings),0) AS n FROM vacancies WHERE status = 'open'")!.n,
    assets_assigned: get<any>("SELECT COUNT(*) AS n FROM assets WHERE status = 'assigned'")!.n,
    payroll_last_net: lastRun ? { period: lastRun.period, net: lastRun.totals?.net ?? 0, status: lastRun.status } : null,
    my_leave_balance: myBal.reduce((s, b) => s + b.available, 0),
    my_leave_balance_detail: myBal,
    my_hours_this_month: eid ? Math.round((get<any>('SELECT COALESCE(SUM(work_minutes),0) AS m FROM attendance_records WHERE employee_id = ? AND date >= ?', [eid, monthStart])!.m / 60) * 10) / 10 : 0,
    recent_joiners: all(`SELECT e.id, e.first_name, e.last_name, e.join_date, d.name AS department_name, p.title AS position_title FROM employees e LEFT JOIN departments d ON d.id = e.department_id LEFT JOIN positions p ON p.id = e.position_id WHERE e.status != 'exited'${scope} ORDER BY e.join_date DESC LIMIT 8`, vis ?? []),
    upcoming_birthdays: all<any>("SELECT id, first_name, last_name, dob FROM employees WHERE dob IS NOT NULL AND status != 'exited'").map((e) => ({ ...e, next: nextBirthday(e.dob) })).sort((a, b) => a.next.localeCompare(b.next)).slice(0, 8),
    expiring_documents_list: expiring.slice(0, 10),
    pending_approvals: [
      ...all<any>(`SELECT l.id, 'leave' AS kind, l.start_date AS date, t.name AS detail, e.first_name || ' ' || e.last_name AS employee_name, l.days FROM leave_requests l JOIN leave_types t ON t.id = l.leave_type_id JOIN employees e ON e.id = l.employee_id WHERE l.status IN ('pending','correction_pending')${scope} ORDER BY l.start_date LIMIT 10`, vis ?? []),
      ...all<any>(`SELECT c.id, 'attendance' AS kind, c.date, c.reason AS detail, e.first_name || ' ' || e.last_name AS employee_name, NULL AS days FROM attendance_corrections c JOIN employees e ON e.id = c.employee_id WHERE c.status = 'pending'${scope} ORDER BY c.date LIMIT 10`, vis ?? []),
    ],
    upcoming_holidays: all('SELECT * FROM holidays WHERE date >= ? ORDER BY date LIMIT 6', [t]),
    journey_in_progress: all(`SELECT e.id, e.first_name, e.last_name, s.name AS stage, (SELECT COUNT(*) FROM journey_stages x WHERE x.employee_id = e.id AND x.status IN ('completed','skipped')) AS done, (SELECT COUNT(*) FROM journey_stages x WHERE x.employee_id = e.id) AS total FROM employees e JOIN journey_stages s ON s.employee_id = e.id AND s.status = 'in_progress' WHERE e.status != 'exited' ORDER BY e.join_date DESC LIMIT 8`),
    my_recent_payslips: eid ? parseJsonAll(all("SELECT p.id, r.period, p.net, p.gross, p.currency, r.status FROM payslips p JOIN payroll_runs r ON r.id = p.run_id WHERE p.employee_id = ? AND r.status IN ('approved','paid') ORDER BY r.period DESC LIMIT 6", [eid]), []) : [],
    company: getSetting('company', {}),
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
