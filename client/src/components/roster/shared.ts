import { CHART_COLORS } from '../charts';

export interface Shift { id: number; name: string; start_time: string; end_time: string; working_days: number[]; active: number; full_day_minutes: number }
export interface RosterDay { date: string; shift_id: number | null; shift_name: string | null; source: 'assignment' | 'default' | 'none'; day_off: boolean; note: string | null; weekly_off: boolean; holiday: string | null; on_leave: boolean; scheduled: boolean; minutes: number }
export interface RosterEmployee {
  id: number; employee_code: string; first_name: string; last_name: string; department_id: number | null; department_name: string | null; position_title: string | null; default_shift_id: number | null;
  days: RosterDay[]; scheduled_minutes: number; scheduled_hours: number; scheduled_days: number;
}
export interface RosterResponse { from: string; to: string; days: { date: string; dow: number; weekly_off: boolean; holiday: string | null }[]; shifts: Shift[]; weekly_offs: number[]; employees: RosterEmployee[] }
export interface Conflict { employee_id: number; employee_name: string; date: string; leave_type: string; start_date: string; end_date: string }

export const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Adds days to a YYYY-MM-DD date (UTC arithmetic, no timezone drift). */
export function addDaysIso(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** Monday of the week containing `iso` (matches the server's weekStart). */
export function mondayOf(iso: string): string {
  const dow = new Date(iso + 'T00:00:00Z').getUTCDay();
  return addDaysIso(iso, dow === 0 ? -6 : 1 - dow);
}
export function isIso(v: string | null | undefined): v is string { return !!v && /^\d{4}-\d{2}-\d{2}$/.test(v); }

export function weekLabel(from: string): string {
  const to = addDaysIso(from, 6);
  const f = new Date(from + 'T00:00:00Z');
  const t = new Date(to + 'T00:00:00Z');
  const opt: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', timeZone: 'UTC' };
  return `${f.toLocaleDateString(undefined, opt)} – ${t.toLocaleDateString(undefined, { ...opt, year: 'numeric' })}`;
}
export function dayHead(iso: string): { dow: string; day: string } {
  const d = new Date(iso + 'T00:00:00Z');
  return { dow: DOW[d.getUTCDay()], day: d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' }) };
}

/** Stable colour per shift (shifts have no colour of their own): palette by position in id order. */
export function shiftColor(shifts: Shift[], id: number | null | undefined): string {
  if (!id) return 'var(--muted)';
  const ids = shifts.map((s) => s.id).sort((a, b) => a - b);
  const i = ids.indexOf(id);
  return CHART_COLORS[(i < 0 ? 0 : i) % CHART_COLORS.length];
}
export const shiftTimes = (s?: Pick<Shift, 'start_time' | 'end_time'> | null) => (s ? `${s.start_time}–${s.end_time}` : '');
