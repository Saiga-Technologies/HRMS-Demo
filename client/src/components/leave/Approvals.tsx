import React, { useState } from 'react';
import { api } from '../../lib/api';
import { useCounts } from '../../lib/notifications';
import { fmtDateTime } from '../../lib/format';
import { Badge, Button, Card, EmptyState, Input, Spinner, StatusBadge, useFetch, useToast } from '../ui';
import { DateRange, RequestDetailModal } from './RequestsTable';
import { ApprovalTrail, LeaveRequest, TypeChip, fmtDays } from './shared';

export function Approvals({ onChanged }: { onChanged?: () => void }) {
  const toast = useToast();
  const { refreshCounts } = useCounts();
  const list = useFetch<LeaveRequest[]>(() => api.get('/api/leave/approvals/pending'), []);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const decide = async (r: LeaveRequest, decision: 'approve' | 'reject') => {
    setBusy(`${r.id}-${decision}`);
    try {
      await api.post(`/api/leave/requests/${r.id}/review`, { decision, note: notes[r.id] || null });
      toast.success(decision === 'approve' ? `Approved ${r.employee_name}'s ${r.leave_type_name}` : `Rejected ${r.employee_name}'s request`);
      list.reload();
      refreshCounts();
      onChanged?.();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  };
  const rows = list.data || [];
  if (list.loading && !list.data) return <Spinner />;
  if (!rows.length) return <Card tour="leave-approvals"><EmptyState icon="✓" title="Nothing waiting for you" description="Pending leave requests from your reports will appear here." /></Card>;
  return (
    <div className="grid grid-2" data-tour="leave-approvals">
      {rows.map((r) => (
        <div key={r.id} className="card approval-card" data-testid="approval-card">
          <div className="card-body">
            <div className="row between">
              <span><strong>{r.employee_name}</strong> <span className="muted mono">{r.employee_code}</span>{r.department_name ? <span className="muted"> · {r.department_name}</span> : null}</span>
              <StatusBadge status={r.status} />
            </div>
            <div className="row mt" style={{ marginTop: 8 }}>
              <TypeChip name={r.leave_type_name} color={r.color} code={r.leave_type_code} />
              {!r.paid ? <Badge tone="neutral">Unpaid</Badge> : null}
            </div>
            {r.status === 'correction_pending' && r.correction ? (
              <div className="correction-compare mt">
                <div><span className="muted">Current</span><div><DateRange r={r} /> · {fmtDays(r.days)}</div></div>
                <div className="arrow" aria-hidden>→</div>
                <div><span className="muted">Proposed</span><div className="correction-proposed"><DateRange r={r.correction} /> · {fmtDays(r.correction.days)}</div></div>
              </div>
            ) : (
              <div className="mt" style={{ marginTop: 8 }}><DateRange r={r} /> · <strong>{fmtDays(r.days)}</strong></div>
            )}
            <p className="muted" style={{ margin: '8px 0' }}>{r.correction?.reason || r.reason || <em>No reason given</em>}</p>
            <div className="row between" style={{ fontSize: 12 }}>
              <span className="muted">Applied {fmtDateTime(r.created_at)} · <button type="button" className="btn btn-link" onClick={() => setOpen(r.id)}>history</button></span>
              <ApprovalTrail status={r.status} approverName={r.approver_name} />
            </div>
            <div className="row mt" style={{ marginTop: 10 }}>
              <Input placeholder="Note to employee (optional)" value={notes[r.id] || ''} onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })} style={{ flex: 1 }} data-testid="leave-review-note" />
              <Button variant="danger" size="sm" loading={busy === `${r.id}-reject`} disabled={!!busy} onClick={() => decide(r, 'reject')} data-testid="leave-reject">Reject</Button>
              <Button variant="primary" size="sm" loading={busy === `${r.id}-approve`} disabled={!!busy} onClick={() => decide(r, 'approve')} data-testid="leave-approve">Approve</Button>
            </div>
          </div>
        </div>
      ))}
      {open ? <RequestDetailModal id={open} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}
