import { all, get, insert, run, agency, currentCompanySlug, DEFAULT_COMPANY_SLUG } from '../db.js';
import { today, addDays, nowIso } from '../util.js';
import { syncFilings, slaHours } from '../routes/services.js';
import { calendarFor, shiftPeriod } from './payrollCalendar.js';

/** Deterministic pick (no randomness: every server instance must seed identical data). */
const h = (s: string) => { let x = 2166136261; for (const ch of s) x = Math.imul(x ^ ch.charCodeAt(0), 16777619); return Math.abs(x); };

const REQUESTS: { category: string; subject: string; description: string; priority: string; status: string; ageHours: number; replies: [string, string][] }[] = [
  { category: 'onboarding', subject: 'Two new joiners from the 1st — set up payroll', description: 'Offer letters attached in the shared folder. Please create employee records, salary structures and bank details before the input cut-off.', priority: 'high', status: 'in_progress', ageHours: 14, replies: [['agency', 'Records created. Waiting for one bank proof — will chase the candidate today.']] },
  { category: 'payroll', subject: 'Arrears for the revised salary of the warehouse team', description: 'Revision effective last month; please pay arrears in this run.', priority: 'normal', status: 'waiting_client', ageHours: 60, replies: [['agency', 'Can you confirm the revision letters were issued and share the approved list?']] },
  { category: 'letters', subject: 'Experience letter for an exiting employee', description: 'Last working day is next Friday.', priority: 'low', status: 'resolved', ageHours: 120, replies: [['agency', 'Letter issued from HR letters; PDF is in the employee documents.'], ['client', 'Thanks!']] },
  { category: 'compliance', subject: 'Clarification on contribution for interns', description: 'Are the summer interns covered by social security contributions?', priority: 'normal', status: 'open', ageHours: 6, replies: [] },
  { category: 'attendance', subject: 'Biometric device offline at the second site', description: 'Punches missing for Tuesday; staff will raise appeals.', priority: 'urgent', status: 'open', ageHours: 2, replies: [] },
  { category: 'exit', subject: 'Full and final settlement for a resignation', description: 'Notice served; please compute F&F including leave encashment.', priority: 'high', status: 'in_progress', ageHours: 20, replies: [['agency', 'Draft F&F shared for review.']] },
];

/**
 * Operational demo data for one company (runs inside its tenant): statutory filings history,
 * service requests with threads, and payroll checkpoints matching where the demo payroll stands.
 */
export function seedCompanyOps() {
  const slug = currentCompanySlug();
  syncFilings();
  if (!get('SELECT 1 FROM service_requests LIMIT 1')) {
    const hr = get<any>("SELECT u.id, COALESCE(e.first_name || ' ' || e.last_name, u.email) AS name FROM users u LEFT JOIN employees e ON e.id = u.employee_id WHERE u.role = 'hr' AND u.agency_user_id IS NULL ORDER BY u.id LIMIT 1");
    const am = agency.get<any>("SELECT u.id, u.first_name || ' ' || u.last_name AS name FROM companies c JOIN agency_users u ON u.id = c.account_manager_id WHERE c.slug = ?", [slug]);
    const pickCount = 3 + (h(slug) % 3);
    const year = today().slice(0, 4);
    const now = Date.now();
    // A couple of companies have one request slipping past its SLA, so the desk has something to chase.
    const slipping = h(slug + 'sla') % 4 === 0;
    REQUESTS.filter((_, i) => (h(slug + i) % 6) < 4 || i < 2).slice(0, pickCount).forEach((r, i) => {
      const age = slipping && i === 0 ? r.ageHours + 30 : r.ageHours;
      const created = new Date(now - age * 3600000).toISOString();
      const resolved = ['resolved', 'closed'].includes(r.status);
      const id = insert('service_requests', {
        number: `SR-${year}-${String(i + 1).padStart(4, '0')}`, category: r.category, subject: r.subject, description: r.description, priority: r.priority, status: r.status,
        raised_by_user: hr?.id ?? null, raised_by_name: hr?.name || 'Client HR', assignee_name: r.status === 'open' ? null : am?.name ?? null, assignee_agency_user_id: r.status === 'open' ? null : am?.id ?? null,
        due_at: new Date(Date.parse(created) + slaHours(r.priority) * 3600000).toISOString(), resolved_at: resolved ? new Date(now - 20 * 3600000).toISOString() : null, created_at: created, updated_at: created,
      });
      r.replies.forEach(([side, body], j) => insert('service_request_comments', { request_id: id, author_name: side === 'agency' ? `${am?.name || 'Agency'} (agency)` : hr?.name || 'Client HR', author_side: side, body, created_at: new Date(Date.parse(created) + (j + 1) * 5 * 3600000).toISOString() }));
    });
  }
  // Payroll checkpoints: inputs in for runs already started; attendance locked where the cut-off passed.
  const period = today().slice(0, 7);
  for (const p of [period, shiftPeriod(period, -1), shiftPeriod(period, -2), shiftPeriod(period, -3)]) {
    const cal = calendarFor(p);
    const inputs = cal.milestones.find((m) => m.key === 'inputs');
    if (cal.run || (inputs && inputs.due < today() && h(slug + p) % 3 !== 0)) {
      run('INSERT OR IGNORE INTO payroll_checkpoints (period, key, done_at, done_by_name) VALUES (?, ?, ?, ?)', [p, 'inputs_received', `${addDays(inputs?.due || today(), -1)}T11:00:00.000Z`, 'Client HR']);
    }
    const lock = cal.milestones.find((m) => m.key === 'attendance_lock');
    if (cal.run && lock && lock.due < today()) {
      run('INSERT OR IGNORE INTO payroll_checkpoints (period, key, done_at, done_by_name) VALUES (?, ?, ?, ?)', [p, 'attendance_locked', `${lock.due}T12:30:00.000Z`, 'Agency payroll team']);
    }
  }
  // Agency-managed companies lock attendance once payroll is processed (the original Acme demo keeps
  // its single-company behaviour).
  const row = slug === DEFAULT_COMPANY_SLUG ? null : get<any>("SELECT value FROM settings WHERE key = 'payroll'");
  if (row) {
    const s = JSON.parse(row.value);
    if (s.period_lock === undefined) run("UPDATE settings SET value = ?, updated_at = ? WHERE key = 'payroll'", [JSON.stringify({ ...s, period_lock: true, client_approval_required: s.client_approval_required ?? true }), nowIso()]);
  }
  void all;
}
