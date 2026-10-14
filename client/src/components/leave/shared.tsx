import React from 'react';
import { Badge } from '../ui';

/* ---------- Types mirrored from server/src/schema.ts ---------- */
export interface LeaveType { id: number; name: string; code: string; annual_quota: number; paid: number; carry_forward: number; max_carry_forward: number; requires_document: number; min_notice_days: number; allow_half_day: number; color: string; active: number }
export interface LeaveBalance { id: number; employee_id: number; leave_type_id: number; year: number; allocated: number; carried: number; adjusted: number; used: number; available: number; pending: number; name: string; code: string; color: string; paid: number; allow_half_day: number; requires_document: number; min_notice_days: number; active: number }
export interface LeaveCorrection { start_date: string; end_date: string; half_day: string | null; days: number; reason?: string | null }
export interface LeaveRequest {
  id: number; employee_id: number; leave_type_id: number; start_date: string; end_date: string; half_day: string | null; days: number; reason: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled' | 'correction_pending';
  requested_by?: number | null; reviewed_by?: number | null; reviewed_at?: string | null; review_note?: string | null; correction?: LeaveCorrection | null; created_at: string; updated_at: string;
  leave_type_name: string; leave_type_code: string; color: string; paid: number; employee_name: string; employee_code: string; manager_id?: number | null; department_name?: string | null; reviewer_email?: string | null;
}
export interface LeaveHistory { id: number; leave_request_id: number; action: string; by_user?: number | null; email?: string | null; note?: string | null; snapshot?: Record<string, any> | null; created_at: string }
export interface LeaveSettings { year_start_month: number; allow_negative_balance: boolean; sandwich_rule: boolean; max_consecutive_days: number; managers_can_approve: boolean }
export interface Holiday { id: number; name: string; date: string; optional: number }
export interface DirectoryEmployee { id: number; employee_code: string; first_name: string; last_name: string; department_name?: string | null; manager_id?: number | null }

export const HALF_DAY_LABEL: Record<string, string> = { first_half: 'First half', second_half: 'Second half' };
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Working days in a range, mirroring the server's countDays (weekly offs + non-optional holidays, unless sandwich rule). */
export function countLeaveDays(start: string, end: string, halfDay: string | null, offs: number[], holidays: Holiday[], sandwich: boolean): number {
  if (!start || !end || end < start) return 0;
  if (halfDay) return 0.5;
  const hol = new Set(holidays.filter((h) => !h.optional).map((h) => h.date));
  let n = 0;
  const d = new Date(start + 'T00:00:00Z');
  const last = new Date(end + 'T00:00:00Z');
  for (; d <= last; d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10);
    if (sandwich || (!offs.includes(d.getUTCDay()) && !hol.has(iso))) n++;
  }
  return n;
}
export function employeeLabel(e: { first_name?: string; last_name?: string; employee_code?: string }): string {
  return `${[e.first_name, e.last_name].filter(Boolean).join(' ')}${e.employee_code ? ` (${e.employee_code})` : ''}`;
}
export function fmtDays(n: number): string {
  return `${n % 1 === 0 ? n : n.toFixed(1)} day${n === 1 ? '' : 's'}`;
}

/** Coloured chip for a leave type. */
export function TypeChip({ name, color, code }: { name: string; color?: string | null; code?: string }) {
  return <Badge color={color || '#2563eb'}>{name}{code ? <span className="mono" style={{ opacity: 0.7 }}> {code}</span> : null}</Badge>;
}
/** Rules summary shown on apply and leave-type lists. */
export function TypeRules({ t }: { t: Pick<LeaveType, 'requires_document' | 'min_notice_days' | 'allow_half_day' | 'paid'> }) {
  const bits: string[] = [];
  bits.push(t.paid ? 'Paid' : 'Unpaid');
  if (t.requires_document) bits.push('Document required');
  if (t.min_notice_days > 0) bits.push(`${t.min_notice_days} day${t.min_notice_days === 1 ? '' : 's'} notice`);
  bits.push(t.allow_half_day ? 'Half day allowed' : 'Full days only');
  return <span className="muted">{bits.join(' · ')}</span>;
}
