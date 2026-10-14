export function fmtDate(v?: string | null, opts: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short', year: 'numeric' }): string {
  if (!v) return '—';
  const d = v.length === 10 ? new Date(v + 'T00:00:00') : new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleDateString(undefined, opts);
}
export function fmtDateTime(v?: string | null): string {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
export function fmtTime(v?: string | null): string {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}
export function fmtMoney(n?: number | null, currency = 'INR'): string {
  if (n === undefined || n === null || Number.isNaN(n)) return '—';
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(n);
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
}
export function fmtMinutes(min?: number | null): string {
  if (!min && min !== 0) return '—';
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}
export function fullName(e?: { first_name?: string; last_name?: string } | null): string {
  if (!e) return '—';
  return [e.first_name, e.last_name].filter(Boolean).join(' ');
}
export function initials(e?: { first_name?: string; last_name?: string } | null): string {
  if (!e) return '?';
  return ((e.first_name?.[0] || '') + (e.last_name?.[0] || '')).toUpperCase() || '?';
}
export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function monthIso(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
/** Convert a datetime-local input value to ISO (UTC) and back. */
export function localToIso(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
export function isoToLocal(v?: string | null): string {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export const STATUS_LABELS: Record<string, string> = {
  active: 'Active', probation: 'Probation', onboarding: 'Onboarding', notice: 'Notice period', exited: 'Exited',
  pending: 'Pending', approved: 'Approved', rejected: 'Rejected', cancelled: 'Cancelled', correction_pending: 'Correction pending',
  present: 'Present', half_day: 'Half day', absent: 'Absent', leave: 'On leave', holiday: 'Holiday', weekend: 'Weekend', wfh: 'WFH', upcoming: 'Upcoming',
  draft: 'Draft', processed: 'Processed', paid: 'Paid', published: 'Published', archived: 'Archived',
  available: 'Available', assigned: 'Assigned', maintenance: 'Maintenance', retired: 'Retired', lost: 'Lost',
  in_progress: 'In progress', completed: 'Completed', skipped: 'Skipped', open: 'Open', on_hold: 'On hold', closed: 'Closed', filled: 'Filled',
  full_time: 'Full time', part_time: 'Part time', contract: 'Contract', intern: 'Intern', consultant: 'Consultant',
  generated: 'Generated', valid: 'Valid', pending_review: 'Pending review',
};
export const label = (s?: string | null) => (s ? STATUS_LABELS[s] || s.replace(/_/g, ' ') : '—');
