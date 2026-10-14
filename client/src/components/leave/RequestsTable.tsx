import React, { useState } from 'react';
import { api } from '../../lib/api';
import { fmtDate, fmtDateTime, label } from '../../lib/format';
import { Button, KeyValue, Modal, Spinner, StatusBadge, Table, useConfirm, useFetch, useToast } from '../ui';
import { ApprovalTrail, HALF_DAY_LABEL, LeaveHistory, LeaveRequest, TypeChip, fmtDays } from './shared';

export function DateRange({ r }: { r: { start_date: string; end_date: string; half_day?: string | null } }) {
  const single = r.start_date === r.end_date;
  return (
    <span>
      {fmtDate(r.start_date, { day: '2-digit', month: 'short' })}{single ? '' : ` → ${fmtDate(r.end_date, { day: '2-digit', month: 'short' })}`}
      {r.half_day ? <span className="muted"> · {HALF_DAY_LABEL[r.half_day] || r.half_day}</span> : null}
    </span>
  );
}

/** Shared table of leave requests with optional edit/cancel actions. Row click opens the detail modal. */
export function RequestsTable({ rows, loading, showEmployee, canEdit, canCancel, onEdit, onCancel, empty, tour }: {
  rows: LeaveRequest[]; loading?: boolean; showEmployee?: boolean; canEdit?: (r: LeaveRequest) => boolean; canCancel?: (r: LeaveRequest) => boolean;
  onEdit?: (r: LeaveRequest) => void; onCancel?: (r: LeaveRequest) => void; empty?: string; tour?: string;
}) {
  const [open, setOpen] = useState<LeaveRequest | null>(null);
  return (
    <>
      <Table<LeaveRequest>
        tour={tour}
        loading={loading}
        rows={rows}
        onRowClick={(r) => setOpen(r)}
        empty={empty || 'No leave requests.'}
        columns={[
          ...(showEmployee ? [{ key: 'employee_name', header: 'Employee', render: (r: LeaveRequest) => <span><strong>{r.employee_name}</strong> <span className="muted mono">{r.employee_code}</span></span> }] : []),
          { key: 'type', header: 'Type', render: (r) => <TypeChip name={r.leave_type_name} color={r.color} /> },
          { key: 'dates', header: 'Dates', render: (r) => <DateRange r={r} /> },
          { key: 'days', header: 'Days', align: 'right', render: (r) => (r.status === 'correction_pending' && r.correction ? <span>{r.days} <span className="muted">→ {r.correction.days}</span></span> : r.days) },
          { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
          { key: 'reason', header: 'Reason', render: (r) => <span className="muted" title={r.reason || ''}>{r.reason ? (r.reason.length > 60 ? r.reason.slice(0, 60) + '…' : r.reason) : '—'}</span> },
          { key: 'approval', header: 'Approval', render: (r) => <ApprovalTrail status={r.status} approverName={r.approver_name} reviewerName={r.reviewer_name} reviewerEmail={r.reviewer_email} reviewedAt={r.reviewed_at} note={r.review_note} /> },
          { key: 'actions', header: '', align: 'right', render: (r) => (
            <span className="row" style={{ justifyContent: 'flex-end', gap: 6 }} onClick={(e) => e.stopPropagation()}>
              {canEdit?.(r) ? <Button size="sm" onClick={() => onEdit?.(r)} data-testid="leave-edit">{r.status === 'approved' ? 'Correct' : 'Edit'}</Button> : null}
              {canCancel?.(r) ? <Button size="sm" variant="danger" onClick={() => onCancel?.(r)} data-testid="leave-cancel">Cancel</Button> : null}
            </span>
          ) },
        ]}
      />
      {open ? <RequestDetailModal id={open.id} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

/** Confirm + POST cancel helper shared by My leave and All requests. */
export function useCancelRequest(onDone: () => void) {
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const cancel = async (r: LeaveRequest) => {
    const msg = r.status === 'pending' ? 'The request will be withdrawn.' : 'The approved leave will be cancelled and the balance restored.';
    if (!(await confirm(`Cancel ${r.leave_type_name} (${fmtDate(r.start_date)})?`, msg))) return;
    try {
      await api.post(`/api/leave/requests/${r.id}/cancel`, {});
      toast.success('Leave request cancelled');
      onDone();
    } catch (err) {
      toast.error(err);
    }
  };
  return { cancel, dialog };
}

const ACTION_LABEL: Record<string, string> = { applied: 'Applied', approved: 'Approved', rejected: 'Rejected', cancelled: 'Cancelled', corrected: 'Edited', correction_requested: 'Correction requested', correction_approved: 'Correction approved', correction_rejected: 'Correction rejected' };

export function RequestDetailModal({ id, onClose }: { id: number; onClose: () => void }) {
  const data = useFetch<LeaveRequest & { history: LeaveHistory[] }>(() => api.get(`/api/leave/requests/${id}`), [id]);
  const r = data.data;
  return (
    <Modal open title={r ? `${r.leave_type_name} · ${r.employee_name}` : 'Leave request'} onClose={onClose} testId="leave-detail-modal" footer={<Button onClick={onClose}>Close</Button>}>
      {!r ? (data.error ? <div className="alert alert-error">{data.error}</div> : <Spinner />) : (
        <>
          <KeyValue items={[
            { k: 'Status', v: <StatusBadge status={r.status} /> },
            { k: 'Type', v: <TypeChip name={r.leave_type_name} color={r.color} code={r.leave_type_code} /> },
            { k: 'Dates', v: <span><DateRange r={r} /> · {fmtDays(r.days)}</span> },
            ...(r.status === 'correction_pending' && r.correction ? [{ k: 'Proposed change', v: <span className="correction-proposed"><DateRange r={r.correction} /> · {fmtDays(r.correction.days)}{r.correction.reason ? <span className="muted"> — {r.correction.reason}</span> : null}</span> }] : []),
            { k: 'Reason', v: r.reason || '—' },
            { k: 'Applied', v: fmtDateTime(r.created_at) },
            { k: r.status === 'pending' || r.status === 'correction_pending' ? 'Approval' : 'Reviewed', v: <ApprovalTrail status={r.status} approverName={r.approver_name} reviewerName={r.reviewer_name} reviewerEmail={r.reviewer_email} reviewedAt={r.reviewed_at} /> },
            { k: 'Reviewer note', v: r.review_note || '—' },
          ]} />
          <h3 className="mt">History</h3>
          <ul className="list history-list">
            {r.history.map((h) => (
              <li key={h.id}>
                <span>
                  <strong>{ACTION_LABEL[h.action] || label(h.action)}</strong>
                  {h.email ? <span className="muted"> by {h.email}</span> : null}
                  {h.note ? <div className="muted">“{h.note}”</div> : null}
                  {h.snapshot && h.snapshot.start_date ? <div className="muted mono">{h.snapshot.start_date} → {h.snapshot.end_date} ({h.snapshot.days}d{h.snapshot.status ? `, was ${label(h.snapshot.status)}` : ''})</div> : null}
                </span>
                <span className="meta">{fmtDateTime(h.created_at)}</span>
              </li>
            ))}
            {!r.history.length ? <li className="muted">No history.</li> : null}
          </ul>
        </>
      )}
    </Modal>
  );
}
