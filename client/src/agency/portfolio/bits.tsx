import React from 'react';
import { fmtDate, fmtMoney } from '../../lib/format';
import { Icon } from '../../components/Icons';

/* ------------------------------------------------------------------ */
/* Types (shape of GET /api/agency/companies and friends)              */
/* ------------------------------------------------------------------ */
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
export type Health = 'green' | 'amber' | 'red';
export interface Snapshot {
  headcount: number;
  joiners_30d: number;
  exits_30d: number;
  pending_approvals: number;
  documents_expiring: number;
  payroll: { period: string; pay_date: string; stage: string; status: 'on_track' | 'due_soon' | 'overdue' | 'complete'; run_status: string | null; next: Milestone | null; milestones: Milestone[]; last_paid_period: string | null; last_net: number | null };
  compliance: { overdue: number; due_7d: number; next: { code: string; name: string; period: string; due_date: string } | null };
  requests: { open: number; waiting_client: number; breached: number };
  currency: string;
  health: Health;
  reasons: string[];
}
export interface BillingSummary { outstanding_minor: number; overdue_minor: number; overdue_count: number }
export interface PortfolioCompany {
  id: number; slug: string; name: string; legal_name: string | null; country_code: string; region: string | null; city: string | null;
  currency: string; timezone: string; industry: string | null; status: 'onboarding' | 'active' | 'suspended' | 'offboarded';
  logo_text: string | null; brand_color: string | null; account_manager_id: number | null; account_manager_name: string | null; contact_email: string | null;
  snapshot: Snapshot | null; billing: BillingSummary;
}
export interface Summary {
  companies: number; employees: number; by_country: { country_code: string; companies: number }[];
  health: Record<Health, number>; payroll_due_7d: number; filings_overdue: number; filings_due_7d: number;
  requests_open: number; requests_breached: number; last_payroll_net: Record<string, number>; today: string;
}
export interface Staff { id: number; first_name: string; last_name: string; role: string }

/* ------------------------------------------------------------------ */
/* Lookups                                                             */
/* ------------------------------------------------------------------ */
export const COUNTRY_NAME: Record<string, string> = { IN: 'India', AE: 'UAE', SA: 'Saudi Arabia', QA: 'Qatar', US: 'United States' };
export const MARKETS: { key: string; label: string; codes: string[] }[] = [
  { key: 'IN', label: 'India', codes: ['IN'] },
  { key: 'GCC', label: 'GCC', codes: ['AE', 'SA', 'QA'] },
  { key: 'US', label: 'US', codes: ['US'] },
];
export const HEALTH_LABEL: Record<Health, string> = { green: 'Healthy', amber: 'Watch', red: 'At risk' };
export const ROLE_LABEL: Record<string, string> = { owner: 'Owner', admin: 'Admin', account_manager: 'Account manager', payroll: 'Payroll specialist', recruiter: 'Recruiter' };
export const STATUS_LABEL: Record<string, string> = { onboarding: 'Onboarding', active: 'Active', suspended: 'Suspended', offboarded: 'Offboarded' };
export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Money in minor units → display string (agency amounts use exponent 2 for every supported currency). */
export const fmtMinor = (minor: number | null | undefined, currency: string, exponent = 2) => (minor === null || minor === undefined ? '—' : fmtMoney(minor / 10 ** exponent, currency));
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "3 days to go" / "due today" / "2 days overdue". */
export function daysText(d: number) {
  if (d < 0) return `${plural(-d, 'day')} overdue`;
  if (d === 0) return 'due today';
  return `${plural(d, 'day')} to go`;
}
/** Visual urgency of a countdown: overdue, the T-3 window, this week, or comfortable. */
export function urgency(m: Milestone | null): 'overdue' | 'now' | 'soon' | 'calm' | 'done' {
  if (!m) return 'done';
  if (m.days_left < 0) return 'overdue';
  if (m.days_left <= 3) return 'now';
  if (m.days_left <= 7) return 'soon';
  return 'calm';
}

/* ------------------------------------------------------------------ */
/* Small presentational pieces                                         */
/* ------------------------------------------------------------------ */
export function LogoTile({ c, size = 'md' }: { c: { name: string; logo_text: string | null; brand_color: string | null }; size?: 'sm' | 'md' | 'lg' }) {
  return <span className={`pf-logo pf-logo-${size}`} style={{ background: c.brand_color || 'var(--brand)' }} aria-hidden>{(c.logo_text || c.name[0] || '?').slice(0, 2)}</span>;
}

export function HealthPill({ health, reasons }: { health: Health; reasons?: string[] }) {
  return (
    <span className={`pf-health pf-health-${health}`} title={reasons?.length ? reasons.join(' · ') : 'Nothing needs attention'} data-testid="health-pill">
      <span className="pf-health-dot" />{HEALTH_LABEL[health]}
    </span>
  );
}

/** The payroll countdown: stage, the next milestone, "N days to go" and the pay date. */
export function Countdown({ s, compact }: { s: Snapshot; compact?: boolean }) {
  const p = s.payroll;
  const u = urgency(p.next);
  return (
    <div className={`pf-countdown pf-u-${u} ${compact ? 'compact' : ''}`} data-testid="payroll-countdown">
      <div className="pf-countdown-num" aria-hidden>
        {p.next ? (p.next.days_left < 0 ? <><strong>{-p.next.days_left}</strong><small>late</small></> : p.next.days_left === 0 ? <><strong>0</strong><small>today</small></> : <><strong>{p.next.days_left}</strong><small>{p.next.days_left === 1 ? 'day' : 'days'}</small></>) : <Icon name="check" size={18} />}
      </div>
      <div className="pf-countdown-body">
        <div className="pf-countdown-title">
          {p.next ? <>{p.next.label} <span className="pf-countdown-when">{daysText(p.next.days_left)}</span></> : <>Payroll complete</>}
        </div>
        <div className="pf-countdown-sub">
          {p.period} · {p.stage} · pay day {fmtDate(p.pay_date, { day: '2-digit', month: 'short' })}
          {p.next ? <> · {p.next.owner === 'client' ? 'client' : 'agency'}</> : null}
        </div>
      </div>
    </div>
  );
}

const SHORT: Record<Milestone['key'], string> = { inputs: 'Inputs', attendance_lock: 'Cut-off', generation: 'Run', client_approval: 'Approval', payment: 'Pay' };
/** Five dots: inputs → attendance cut-off → generation → client approval → payment. */
export function MilestoneTrack({ milestones }: { milestones: Milestone[] }) {
  const nextKey = milestones.find((m) => !m.done)?.key;
  return (
    <ol className="pf-track" aria-label="Payroll milestones">
      {milestones.map((m) => (
        <li key={m.key} className={`pf-track-step st-${m.status} ${m.key === nextKey ? 'is-next' : ''}`} title={`${m.label} · ${fmtDate(m.due)} · ${m.done ? 'done' : daysText(m.days_left)}`}>
          <span className="pf-track-dot">{m.done ? <Icon name="check" size={10} /> : null}</span>
          <span className="pf-track-label">{SHORT[m.key]}</span>
        </li>
      ))}
    </ol>
  );
}

export function MilestoneStatus({ m }: { m: Milestone }) {
  const tone = m.status === 'done' ? 'success' : m.status === 'overdue' ? 'danger' : m.status === 'due_today' || m.status === 'due_soon' ? 'warning' : 'neutral';
  return <span className={`badge badge-${tone} pf-nocap`}>{m.status === 'done' ? 'Done' : daysText(m.days_left)}</span>;
}
