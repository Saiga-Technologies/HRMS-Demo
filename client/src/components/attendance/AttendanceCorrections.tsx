import React, { useState } from 'react';
import { api, qs } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { fmtDate, fmtDateTime, label } from '../../lib/format';
import { Button, Card, Field, KeyValue, Modal, Pill, StatusBadge, Table, Textarea, useFetch, useToast } from '../ui';
import CorrectionModal from './CorrectionModal';
import { Correction, DirectoryEmployee } from './shared';

/** Correction requests: employees see their own, managers/HR review. */
export function CorrectionsTab({ employees, openRequest, onRequestClosed }: { employees: DirectoryEmployee[]; openRequest: { date?: string } | null; onRequestClosed: () => void }) {
  const { isManager, user } = useAuth();
  const [status, setStatus] = useState<string>('pending');
  const list = useFetch<Correction[]>(() => api.get(`/api/attendance/corrections${qs({ status })}`), [status]);
  const [review, setReview] = useState<Correction | null>(null);
  const [create, setCreate] = useState(false);
  const showForm = create || !!openRequest;
  const close = () => { setCreate(false); onRequestClosed(); };
  const canReview = (c: Correction) => isManager && c.status === 'pending' && c.employee_id !== user?.employee_id;
  return (
    <>
      <div className="toolbar">
        {['pending', 'approved', 'rejected', ''].map((s) => (
          <Pill key={s || 'all'} active={status === s} onClick={() => setStatus(s)}>{s ? label(s) : 'All'}</Pill>
        ))}
        <span style={{ marginLeft: 'auto' }}>
          {user?.employee_id || isManager ? <Button variant="primary" onClick={() => setCreate(true)} data-testid="correction-request" data-tour="att-correction-new">+ Request correction</Button> : null}
        </span>
      </div>
      <Card padded={false} tour="att-corrections">
        <Table<Correction>
          loading={list.loading}
          rows={list.data || []}
          empty="No correction requests."
          columns={[
            { key: 'date', header: 'Date', render: (c) => fmtDate(c.date) },
            { key: 'employee_name', header: 'Employee', render: (c) => <span><strong>{c.employee_name}</strong> <span className="muted mono">{c.employee_code}</span></span> },
            { key: 'requested', header: 'Requested change', render: (c) => (
              <span className="stack" style={{ gap: 2 }}>
                {c.requested_punch_in ? <span>In → {fmtDateTime(c.requested_punch_in)}</span> : null}
                {c.requested_punch_out ? <span>Out → {fmtDateTime(c.requested_punch_out)}</span> : null}
                {c.requested_status ? <span>Status → <StatusBadge status={c.requested_status} /></span> : null}
              </span>
            ) },
            { key: 'reason', header: 'Reason', render: (c) => <span title={c.reason}>{c.reason.length > 80 ? c.reason.slice(0, 80) + '…' : c.reason}</span> },
            { key: 'status', header: 'Status', render: (c) => <StatusBadge status={c.status} /> },
            { key: 'review', header: 'Review', render: (c) => (c.reviewed_at ? <span className="muted">{c.reviewer_email || 'Reviewer'} · {fmtDateTime(c.reviewed_at)}{c.review_note ? <><br />“{c.review_note}”</> : null}</span> : <span className="muted">—</span>) },
            { key: 'created_at', header: 'Raised', render: (c) => fmtDateTime(c.created_at) },
            { key: 'actions', header: '', align: 'right', render: (c) => (canReview(c) ? <Button size="sm" variant="primary" onClick={() => setReview(c)} data-testid="correction-review">Review</Button> : null) },
          ]}
        />
      </Card>
      {showForm ? <CorrectionModal date={openRequest?.date} employees={employees} onClose={close} onSaved={() => { close(); setStatus('pending'); list.reload(); }} /> : null}
      {review ? <ReviewModal correction={review} onClose={() => setReview(null)} onDone={() => { setReview(null); list.reload(); }} /> : null}
    </>
  );
}

function ReviewModal({ correction: c, onClose, onDone }: { correction: Correction; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const decide = async (decision: 'approve' | 'reject') => {
    setBusy(decision);
    try {
      await api.post(`/api/attendance/corrections/${c.id}/review`, { decision, note: note || null });
      toast.success(decision === 'approve' ? 'Correction approved and record updated' : 'Correction rejected');
      onDone();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  };
  return (
    <Modal open title={`Review correction · ${c.employee_name} · ${fmtDate(c.date)}`} onClose={onClose} testId="correction-review-modal"
      footer={<>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="danger" loading={busy === 'reject'} disabled={!!busy} onClick={() => decide('reject')} data-testid="correction-reject">Reject</Button>
        <Button variant="primary" loading={busy === 'approve'} disabled={!!busy} onClick={() => decide('approve')} data-testid="correction-approve">Approve</Button>
      </>}>
      <KeyValue items={[
        { k: 'Requested punch in', v: c.requested_punch_in ? fmtDateTime(c.requested_punch_in) : '—' },
        { k: 'Requested punch out', v: c.requested_punch_out ? fmtDateTime(c.requested_punch_out) : '—' },
        { k: 'Requested status', v: c.requested_status ? <StatusBadge status={c.requested_status} /> : '—' },
        { k: 'Reason', v: c.reason },
        { k: 'Raised', v: fmtDateTime(c.created_at) },
      ]} />
      <Field label="Note to employee" className="mt"><Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" data-testid="correction-note" /></Field>
      <p className="help">Approving applies the requested times/status to the attendance record and recomputes work, break and late minutes.</p>
    </Modal>
  );
}
