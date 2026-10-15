import React, { useEffect } from 'react';
import { Badge } from '../../components/ui';
import { Icon } from '../../components/Icons';

/** Shared bits for the agency operations pages (calendar, service desk, company "Agency services"). */

export interface ServiceRequest {
  id: number;
  number: string;
  category: string;
  subject: string;
  description: string | null;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  status: 'open' | 'in_progress' | 'waiting_client' | 'resolved' | 'closed';
  raised_by_name: string | null;
  assignee_name: string | null;
  assignee_agency_user_id: number | null;
  due_at: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
  comments: number;
  breached: 0 | 1;
  company_slug?: string;
  company_name?: string;
  brand_color?: string | null;
}
export interface ThreadMessage { id: number; author_name: string; author_side: 'client' | 'agency'; body: string; created_at: string }

export const SR_STATUSES: ServiceRequest['status'][] = ['open', 'in_progress', 'waiting_client', 'resolved', 'closed'];
export const SR_STATUS_LABEL: Record<string, string> = { open: 'Open', in_progress: 'In progress', waiting_client: 'Waiting for client', resolved: 'Resolved', closed: 'Closed' };
const SR_STATUS_TONE: Record<string, 'neutral' | 'success' | 'warning' | 'danger' | 'info'> = { open: 'info', in_progress: 'info', waiting_client: 'warning', resolved: 'success', closed: 'neutral' };
export const PRIORITIES: ServiceRequest['priority'][] = ['urgent', 'high', 'normal', 'low'];
const PRIORITY_TONE: Record<string, 'neutral' | 'success' | 'warning' | 'danger' | 'info'> = { urgent: 'danger', high: 'warning', normal: 'neutral', low: 'neutral' };
export const SR_CATEGORIES = ['payroll', 'onboarding', 'exit', 'letters', 'compliance', 'attendance', 'benefits', 'other'];
export const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ') : s);

export const isActive = (r: Pick<ServiceRequest, 'status'>) => ['open', 'in_progress', 'waiting_client'].includes(r.status);

export function SrStatusBadge({ status }: { status: string }) {
  return <Badge tone={SR_STATUS_TONE[status] || 'neutral'}>{SR_STATUS_LABEL[status] || cap(status)}</Badge>;
}
export function PriorityBadge({ priority }: { priority: string }) {
  return <span className={`ops-priority p-${priority}`}><span className="ops-priority-dot" />{cap(priority)}</span>;
}

/** SLA state: "Breached 5h ago", "Due in 3h", "Met". */
export function slaInfo(r: Pick<ServiceRequest, 'status' | 'due_at' | 'breached' | 'resolved_at'>, now = Date.now()): { text: string; tone: 'danger' | 'warning' | 'ok' | 'muted' } {
  if (!r.due_at) return { text: '—', tone: 'muted' };
  const due = Date.parse(r.due_at);
  if (!isActive(r)) {
    const at = r.resolved_at ? Date.parse(r.resolved_at) : now;
    return at <= due ? { text: 'Met', tone: 'ok' } : { text: 'Missed', tone: 'muted' };
  }
  const hours = (due - now) / 3600000;
  const span = (h: number) => (Math.abs(h) >= 48 ? `${Math.round(Math.abs(h) / 24)}d` : `${Math.max(1, Math.round(Math.abs(h)))}h`);
  if (r.breached || hours < 0) return { text: `Breached ${span(hours)} ago`, tone: 'danger' };
  return { text: `Due in ${span(hours)}`, tone: hours <= 8 ? 'warning' : 'ok' };
}
export function SlaChip({ r }: { r: Pick<ServiceRequest, 'status' | 'due_at' | 'breached' | 'resolved_at'> }) {
  const s = slaInfo(r);
  return (
    <span className={`ops-sla sla-${s.tone}`} data-testid="sla-chip">
      {s.tone === 'danger' ? <Icon name="alert" size={13} /> : <Icon name="clock" size={13} />} {s.text}
    </span>
  );
}

/** "3 days to go" / "Due today" / "2 days overdue". */
export function daysPhrase(d: number) {
  if (d < 0) return `${-d} day${d === -1 ? '' : 's'} overdue`;
  if (d === 0) return 'Due today';
  return `${d} day${d === 1 ? '' : 's'} to go`;
}
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b.slice(0, 10) + 'T00:00:00Z') - Date.parse(a.slice(0, 10) + 'T00:00:00Z')) / 86400000);

/** Small company chip with its brand colour. */
export function CompanyChip({ name, color, onClick }: { name: string; color?: string | null; onClick?: () => void }) {
  const style = { '--chip-color': color || 'var(--brand)' } as React.CSSProperties;
  const inner = (<><span className="ops-company-dot" />{name}</>);
  return onClick
    ? <button type="button" className="ops-company" style={style} onClick={(e) => { e.stopPropagation(); onClick(); }}>{inner}</button>
    : <span className="ops-company" style={style}>{inner}</span>;
}

/** Right-hand slide-over panel (closes on Escape or backdrop click). */
export function Drawer({ open, onClose, title, subtitle, children, footer, testId = 'drawer' }: { open: boolean; onClose: () => void; title: React.ReactNode; subtitle?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode; testId?: string }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('.modal-backdrop')) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="ops-drawer-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="ops-drawer" role="dialog" aria-modal="true" data-testid={testId}>
        <header className="ops-drawer-head">
          <div className="ops-drawer-titles">
            <h2>{title}</h2>
            {subtitle ? <div className="ops-drawer-sub">{subtitle}</div> : null}
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close" data-testid="drawer-close"><Icon name="x" size={16} /></button>
        </header>
        <div className="ops-drawer-body">{children}</div>
        {footer ? <footer className="ops-drawer-foot">{footer}</footer> : null}
      </aside>
    </div>
  );
}
