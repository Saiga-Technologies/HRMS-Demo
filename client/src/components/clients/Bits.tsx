import React from 'react';
import { Badge, Button } from '../ui';
import { fmtMoney } from '../../lib/format';
import {
  CLIENT_STATUS_LABEL, CLIENT_STATUS_TONE, NEXT_STATUS, PLACEMENT_STATUS_LABEL, PLACEMENT_STATUS_TONE, TRANSITION_LABEL, UNIT_SHORT,
  type ClientStatus, type Placement, type PlacementStatus,
} from './types';

export function ClientStatusBadge({ status }: { status: ClientStatus }) {
  return <Badge tone={CLIENT_STATUS_TONE[status] || 'neutral'}>{CLIENT_STATUS_LABEL[status] || status}</Badge>;
}
export function PlacementStatusBadge({ status }: { status: PlacementStatus }) {
  return <span data-testid="placement-status"><Badge tone={PLACEMENT_STATUS_TONE[status] || 'neutral'}>{PLACEMENT_STATUS_LABEL[status] || status}</Badge></span>;
}

/** "1,800 /hr" style rate. */
export function Rate({ value, unit, currency }: { value?: number | null; unit: Placement['rate_unit']; currency: string }) {
  if (value === null || value === undefined) return <span className="muted">—</span>;
  return <span>{fmtMoney(value, currency)} <span className="muted">{UNIT_SHORT[unit]}</span></span>;
}

/** Monthly margin with percentage; coloured by sign. */
export function Margin({ p }: { p: Placement }) {
  if (p.bill_rate == null || p.pay_rate == null) return <span className="muted">—</span>;
  const color = p.monthly_margin < 0 ? 'var(--danger-ink)' : p.margin_pct < 15 ? 'var(--warning-ink)' : 'var(--success-ink)';
  return (
    <span>
      <strong style={{ color }}>{fmtMoney(p.monthly_margin, p.billing_currency)}</strong>
      <span className="muted"> /mo · {p.margin_pct}%</span>
    </span>
  );
}

export function PersonCell({ p }: { p: Placement }) {
  return (
    <span>
      <strong>{p.person_name || '—'}</strong>
      <div className="muted">{p.person_type === 'candidate' ? 'Candidate' : p.employee_code || 'Employee'}</div>
    </span>
  );
}

/** HR-only status transition buttons (proposed -> active -> completed / terminated). */
export function TransitionButtons({ p, onChange }: { p: Placement; onChange: (p: Placement, to: PlacementStatus) => void }) {
  const next = NEXT_STATUS[p.status] || [];
  if (!next.length) return null;
  return (
    <>
      {next.map((s) => (
        <Button key={s} size="sm" variant={s === 'terminated' ? 'ghost' : 'primary'} data-testid={`placement-${s}`}
          onClick={(e) => { e.stopPropagation(); onChange(p, s); }}>
          {TRANSITION_LABEL[s]}
        </Button>
      ))}
    </>
  );
}
