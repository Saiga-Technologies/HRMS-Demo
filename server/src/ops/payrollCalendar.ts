import { all, get, getSetting } from '../db.js';
import { today, addDays, badRequest } from '../util.js';

/**
 * Payroll calendar for the current company: resolves each month's pay date (respecting the
 * company's weekly offs and holidays) and derives the countdown milestones an agency works to:
 *
 *   T-7 inputs from the client · T-5 attendance cut-off · T-3 payroll generation ·
 *   T-2 client approval of the register · T payment & payslips
 *
 * Offsets come from the company's payroll settings. Milestone completion is derived from the payroll
 * run's status plus manual checkpoints (payroll_checkpoints) for the steps with no system record.
 */
export interface Milestone {
  key: 'inputs' | 'attendance_lock' | 'generation' | 'client_approval' | 'payment';
  label: string;
  description: string;
  due: string;
  owner: 'client' | 'agency';
  done: boolean;
  done_at: string | null;
  status: 'done' | 'overdue' | 'due_today' | 'due_soon' | 'upcoming';
  days_left: number;
}
export interface PayrollCalendar {
  period: string;
  pay_date: string;
  run: { id: number; status: string; processed_at: string | null; approved_at: string | null; paid_at: string | null; net: number | null; payslips: number } | null;
  milestones: Milestone[];
  next: Milestone | null;
  stage: string;
  status: 'on_track' | 'due_soon' | 'overdue' | 'complete';
  locked: boolean;
}

export const CALENDAR_DEFAULTS = { period_lock: false, input_deadline_days_before: 7, attendance_cutoff_days_before: 5, generation_days_before: 3, client_approval_days_before: 2, client_approval_required: true };

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
const monthEnd = (period: string) => { const [y, m] = period.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
export const shiftPeriod = (period: string, n: number) => { const [y, m] = period.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0, 7); };

function workingCalendar() {
  const offs: number[] = getSetting('attendance', { weekly_offs: [0, 6] }).weekly_offs || [0, 6];
  return { offs, isWorking: (d: string) => !offs.includes(new Date(d + 'T00:00:00Z').getUTCDay()) && !get('SELECT 1 FROM holidays WHERE date = ? AND optional = 0', [d]) };
}

/** Pay date for a period: a fixed day (moved back to the previous working day) or the last working day. */
export function payDate(period: string, settings = getSetting<any>('payroll', {})): string {
  const { isWorking } = workingCalendar();
  const end = monthEnd(period);
  let d = settings.pay_day === 'last_working_day' || !settings.pay_day ? end : `${period}-${String(Math.min(Number(settings.pay_day), Number(end.slice(8)))).padStart(2, '0')}`;
  for (let i = 0; i < 10 && !isWorking(d); i++) d = addDays(d, -1);
  return d;
}

/** Previous working day `n` working days before `date`. */
function workingDaysBefore(date: string, n: number) {
  const { isWorking } = workingCalendar();
  let d = date;
  let left = n;
  for (let guard = 0; left > 0 && guard < 40; guard++) {
    d = addDays(d, -1);
    if (isWorking(d)) left--;
  }
  return d;
}

function statusFor(due: string, done: boolean, now: string): Milestone['status'] {
  if (done) return 'done';
  const left = daysBetween(now, due);
  if (left < 0) return 'overdue';
  if (left === 0) return 'due_today';
  if (left <= 3) return 'due_soon';
  return 'upcoming';
}

export function calendarFor(period: string): PayrollCalendar {
  const settings = { ...CALENDAR_DEFAULTS, ...getSetting<any>('payroll', {}) };
  const pay = payDate(period, settings);
  const run = get<any>(`SELECT r.id, r.status, r.processed_at, r.approved_at, r.paid_at, r.totals, (SELECT COUNT(*) FROM payslips p WHERE p.run_id = r.id) AS payslips FROM payroll_runs r WHERE r.period = ?`, [period]);
  const checkpoints = new Map(all<any>('SELECT key, done_at FROM payroll_checkpoints WHERE period = ?', [period]).map((c) => [c.key, c.done_at]));
  const st = run?.status as string | undefined;
  const atLeast = (s: string) => !!st && ['draft', 'processed', 'approved', 'paid'].indexOf(st) >= ['draft', 'processed', 'approved', 'paid'].indexOf(s);
  const now = today();
  const m = (key: Milestone['key'], label: string, description: string, due: string, owner: Milestone['owner'], done: boolean, done_at: string | null): Milestone =>
    ({ key, label, description, due, owner, done, done_at, status: statusFor(due, done, now), days_left: daysBetween(now, due) });
  const milestones: Milestone[] = [
    m('inputs', 'Payroll inputs', 'New joiners, exits, salary changes, reimbursements and deductions sent to the agency.', workingDaysBefore(pay, settings.input_deadline_days_before), 'client',
      checkpoints.has('inputs_received') || atLeast('processed'), checkpoints.get('inputs_received') || run?.processed_at || null),
    m('attendance_lock', 'Attendance cut-off', 'Attendance, leave and appeals for the period are final and locked.', workingDaysBefore(pay, settings.attendance_cutoff_days_before), 'agency',
      checkpoints.has('attendance_locked') || atLeast('processed'), checkpoints.get('attendance_locked') || run?.processed_at || null),
    m('generation', 'Payroll generation', 'Run processed: payslips calculated and the register ready for review.', workingDaysBefore(pay, settings.generation_days_before), 'agency', atLeast('processed'), run?.processed_at || null),
  ];
  if (settings.client_approval_required) {
    milestones.push(m('client_approval', 'Client approval', 'The client reviews and approves the payroll register.', workingDaysBefore(pay, settings.client_approval_days_before), 'client', atLeast('approved'), run?.approved_at || null));
  }
  milestones.push(m('payment', 'Salary payment', 'Salaries paid (bank / WPS file) and payslips released.', pay, 'agency', st === 'paid', run?.paid_at || null));
  const next = milestones.find((x) => !x.done) || null;
  const status: PayrollCalendar['status'] = !next ? 'complete' : milestones.some((x) => x.status === 'overdue') ? 'overdue' : milestones.some((x) => ['due_today', 'due_soon'].includes(x.status)) ? 'due_soon' : 'on_track';
  const stage = !run ? 'Not started' : st === 'draft' ? 'Draft' : st === 'processed' ? (settings.client_approval_required ? 'Awaiting client approval' : 'Processed') : st === 'approved' ? 'Approved, awaiting payment' : 'Paid';
  let totals: any = {};
  try { totals = run?.totals ? JSON.parse(run.totals) : {}; } catch { /* ignore */ }
  return {
    period, pay_date: pay,
    run: run ? { id: run.id, status: run.status, processed_at: run.processed_at, approved_at: run.approved_at, paid_at: run.paid_at, net: totals.net ?? null, payslips: run.payslips } : null,
    milestones, next, stage, status, locked: isPeriodLocked(period),
  };
}

/** The period the team should be working on: the oldest unpaid one among last, this and next month. */
export function currentCalendar(): PayrollCalendar {
  const thisPeriod = today().slice(0, 7);
  const prev = calendarFor(shiftPeriod(thisPeriod, -1));
  if (prev.run?.status !== 'paid' && prev.run) return prev; // last month still open
  const cur = calendarFor(thisPeriod);
  if (cur.status !== 'complete') return cur;
  return calendarFor(shiftPeriod(thisPeriod, 1));
}

/* ------------------------------------------------------------------ */
/* Period lock                                                         */
/* ------------------------------------------------------------------ */
/** A period is locked once attendance is cut off or its payroll run is processed (or later). */
export function isPeriodLocked(period: string): boolean {
  if (get("SELECT 1 FROM payroll_runs WHERE period = ? AND status IN ('processed','approved','paid')", [period])) return true;
  return !!get("SELECT 1 FROM payroll_checkpoints WHERE period = ? AND key = 'attendance_locked'", [period]);
}
/** Last attendance date counted in a period's payroll (later days roll into next month's run). */
export function attendanceCutoff(period: string): string {
  const settings = { ...CALENDAR_DEFAULTS, ...getSetting<any>('payroll', {}) };
  return workingDaysBefore(payDate(period, settings), settings.attendance_cutoff_days_before);
}
/**
 * Refuse attendance / leave changes to days already paid for: dates up to the attendance cut-off
 * of a locked period. Live punches are not checked (today is never inside a closed window before
 * cut-off in practice, and blocking a punch would lose the record); later corrections are.
 */
export function assertPeriodOpen(...dates: (string | null | undefined)[]) {
  // Opt-in per company (payroll setting `period_lock`): on for agency-managed companies.
  if (!getSetting<any>('payroll', {}).period_lock) return;
  for (const d of dates) {
    if (!d) continue;
    const date = String(d).slice(0, 10);
    const period = date.slice(0, 7);
    if (isPeriodLocked(period) && date <= attendanceCutoff(period)) {
      throw badRequest(`Payroll for ${period} is locked up to ${attendanceCutoff(period)} (attendance cut off or payroll processed). Record this as an adjustment in the next payroll instead.`);
    }
  }
}
