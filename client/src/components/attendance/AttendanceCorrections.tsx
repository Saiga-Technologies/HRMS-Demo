import React, { useState } from 'react';
import { api, qs } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useCounts } from '../../lib/notifications';
import { fmtDate, fmtDateTime, fmtMinutes, fmtTime, label } from '../../lib/format';
import { Icon } from '../Icons';
import { Badge, Button, Card, Field, KeyValue, Modal, Pill, Select, Spinner, StatusBadge, Table, Textarea, useFetch, useToast } from '../ui';
import AppealModal, { AppealPrefill } from './CorrectionModal';
import { recordChanges } from './AuditTrail';
import { APPEAL_KINDS, Appeal, AppealDetail, DirectoryEmployee, appealKindLabel, employeeLabel } from './shared';

const KIND_TONE: Record<string, 'neutral' | 'success' | 'warning' | 'danger' | 'info'> = { missed_punch_in: 'warning', missed_punch_out: 'warning', missed_both: 'danger', status: 'info', correction: 'neutral' };
export const KindBadge = ({ kind }: { kind?: string | null }) => <Badge tone={KIND_TONE[kind || ''] || 'neutral'}>{appealKindLabel(kind)}</Badge>;

/** Appeals: employees see their own, managers everyone in their reporting chain, HR all. Approvers review from here. */
export function AppealsTab({ employees, openRequest, onRequestClosed }: { employees: DirectoryEmployee[]; openRequest: AppealPrefill | null; onRequestClosed: () => void }) {
  const { isManager, isHr, user } = useAuth();
  const { refreshCounts } = useCounts();
  const [status, setStatus] = useState<string>('pending');
  const [kind, setKind] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const list = useFetch<Appeal[]>(() => api.get(`/api/attendance/corrections${qs({ status, kind, employee_id: employeeId })}`), [status, kind, employeeId]);
  const [review, setReview] = useState<Appeal | null>(null);
  const [create, setCreate] = useState(false);
  const showForm = create || !!openRequest;
  const close = () => { setCreate(false); onRequestClosed(); };
  const canReview = (c: Appeal) => isManager && c.status === 'pending' && (isHr || c.employee_id !== user?.employee_id);
  return (
    <>
      <div className="toolbar" data-tour="att-appeal-filters">
        {['pending', 'approved', 'rejected', ''].map((s) => (
          <Pill key={s || 'all'} active={status === s} onClick={() => setStatus(s)}>{s ? label(s) : 'All'}</Pill>
        ))}
        <Select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind" data-testid="appeal-filter-kind">
          <option value="">Any kind</option>
          {APPEAL_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
        </Select>
        {isManager ? (
          <Select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} aria-label="Employee" data-testid="appeal-filter-employee">
            <option value="">All employees</option>
            {employees.map((e) => <option key={e.id} value={e.id}>{employeeLabel(e)}</option>)}
          </Select>
        ) : null}
        <span style={{ marginLeft: 'auto' }}>
          {user?.employee_id || isHr ? <Button variant="primary" onClick={() => setCreate(true)} data-testid="appeal-new" data-tour="att-appeal-new"><Icon name="plus" size={14} /> Raise appeal</Button> : null}
        </span>
      </div>
      <Card padded={false} tour="att-appeals">
        <Table<Appeal>
          loading={list.loading}
          rows={list.data || []}
          empty="No appeals match these filters."
          columns={[
            { key: 'date', header: 'Date', render: (c) => <span className="stack" style={{ gap: 2 }}><strong>{fmtDate(c.date)}</strong><DeadlineNote c={c} /></span> },
            ...(isManager ? [{ key: 'employee_name', header: 'Employee', render: (c: Appeal) => <span><strong>{c.employee_name}</strong> <span className="muted mono">{c.employee_code}</span></span> }] : []),
            { key: 'kind', header: 'Kind', render: (c) => <KindBadge kind={c.kind} /> },
            { key: 'requested', header: 'Requested change', render: (c) => (
              <span className="stack" style={{ gap: 2 }}>
                {c.requested_punch_in ? <span>In → <strong>{fmtTime(c.requested_punch_in)}</strong></span> : null}
                {c.requested_punch_out ? <span>Out → <strong>{fmtTime(c.requested_punch_out)}</strong></span> : null}
                {c.requested_status ? <span>Status → <StatusBadge status={c.requested_status} /></span> : null}
              </span>
            ) },
            { key: 'reason', header: 'Reason', render: (c) => <span title={c.reason}>{c.reason.length > 80 ? c.reason.slice(0, 80) + '…' : c.reason}</span> },
            { key: 'status', header: 'Status', render: (c) => <StatusBadge status={c.status} /> },
            { key: 'review', header: 'Approval', render: (c) => (
              c.status === 'pending'
                ? <span className="pending-with" data-testid="pending-with"><Icon name="clock" size={13} /> Pending with {c.approver_name || 'HR'}</span>
                : <span className="audit-trail"><span><span className="who">{c.reviewer_name || c.reviewer_email || 'Reviewer'}</span> · {fmtDateTime(c.reviewed_at)}</span>{c.review_note ? <span className="muted">“{c.review_note}”</span> : null}</span>
            ) },
            { key: 'created_at', header: 'Raised', render: (c) => <span className="muted">{fmtDateTime(c.created_at)}{c.requested_by_name && c.requested_by_name !== c.employee_name ? <><br />by {c.requested_by_name}</> : null}</span> },
            { key: 'actions', header: '', align: 'right', render: (c) => (canReview(c) ? <Button size="sm" variant="primary" onClick={() => setReview(c)} data-testid="appeal-review">Review</Button> : <Button size="sm" variant="ghost" onClick={() => setReview(c)} data-testid="appeal-view">Details</Button>) },
          ]}
        />
      </Card>
      {showForm ? <AppealModal {...(openRequest || {})} employees={employees} onClose={close} onSaved={() => { close(); setStatus('pending'); list.reload(); }} /> : null}
      {review ? <ReviewModal appeal={review} canReview={canReview(review)} onClose={() => setReview(null)} onDone={() => { setReview(null); list.reload(); refreshCounts(); }} /> : null}
    </>
  );
}

function DeadlineNote({ c }: { c: Appeal }) {
  if (c.status !== 'pending') return null;
  return c.deadline_passed
    ? <span className="muted deadline-passed">Raised after the deadline ({fmtDate(c.deadline_date)})</span>
    : <span className="muted">Appeal window until {fmtDate(c.deadline_date)}</span>;
}

/** Review (approve / reject) or inspect an appeal: current record vs requested side by side, deadline status, audit trail. */
function ReviewModal({ appeal: c, canReview, onClose, onDone }: { appeal: Appeal; canReview: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const detail = useFetch<AppealDetail>(() => api.get(`/api/attendance/corrections/${c.id}`), [c.id]);
  const rec = detail.data?.record ?? null;
  const decide = async (decision: 'approve' | 'reject') => {
    setBusy(decision);
    try {
      await api.post(`/api/attendance/corrections/${c.id}/review`, { decision, note: note || null });
      toast.success(decision === 'approve' ? 'Appeal approved and the record updated' : 'Appeal rejected');
      onDone();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  };
  const current = c.status === 'approved' && c.previous_values ? c.previous_values : rec;
  const changes = c.status === 'approved' && rec ? recordChanges(c.previous_values, rec) : [];
  return (
    <Modal open wide title={<span>{canReview ? 'Review appeal' : 'Appeal'} #{c.id} · {c.employee_name} · {fmtDate(c.date)} <KindBadge kind={c.kind} /></span>} onClose={onClose} testId="appeal-review-modal"
      footer={<>
        <Button onClick={onClose}>{canReview ? 'Cancel' : 'Close'}</Button>
        {canReview ? <Button variant="danger" loading={busy === 'reject'} disabled={!!busy} onClick={() => decide('reject')} data-testid="appeal-reject">Reject</Button> : null}
        {canReview ? <Button variant="primary" loading={busy === 'approve'} disabled={!!busy} onClick={() => decide('approve')} data-testid="appeal-approve">Approve</Button> : null}
      </>}>
      <div className="row between" style={{ marginBottom: 12 }}>
        <span><StatusBadge status={c.status} /> {c.status === 'pending' ? <span className="pending-with"><Icon name="clock" size={13} /> Pending with {c.approver_name || 'HR'}</span> : null}</span>
        {c.status === 'pending' ? (c.deadline_passed ? <Badge tone="warning">Raised after the {fmtDate(c.deadline_date)} deadline (HR override)</Badge> : <Badge tone="success">Within deadline · until {fmtDate(c.deadline_date)}</Badge>) : null}
      </div>
      {detail.loading && !detail.data ? <Spinner /> : null}
      <div className="compare-grid" data-testid="appeal-compare">
        <div className="compare-col">
          <h3 className="section-title">{c.status === 'approved' ? 'Before the appeal' : 'Current record'}</h3>
          {current ? (
            <KeyValue items={[
              { k: 'Punch in', v: fmtTime(current.punch_in_at) },
              { k: 'Punch out', v: fmtTime(current.punch_out_at) },
              { k: 'Status', v: <StatusBadge status={current.status || undefined} /> },
              { k: 'Work / late', v: `${fmtMinutes(current.work_minutes ?? 0)} / ${current.late_minutes ? fmtMinutes(current.late_minutes) : 'on time'}` },
            ]} />
          ) : <p className="muted">No attendance record exists for this day yet.</p>}
        </div>
        <div className="compare-arrow" aria-hidden>→</div>
        <div className="compare-col compare-requested">
          <h3 className="section-title">Requested</h3>
          <KeyValue items={[
            { k: 'Punch in', v: c.requested_punch_in ? <strong>{fmtTime(c.requested_punch_in)}</strong> : <span className="muted">unchanged</span> },
            { k: 'Punch out', v: c.requested_punch_out ? <strong>{fmtTime(c.requested_punch_out)}</strong> : <span className="muted">unchanged</span> },
            { k: 'Status', v: c.requested_status ? <StatusBadge status={c.requested_status} /> : <span className="muted">recomputed from punches</span> },
            { k: 'Reason', v: c.reason },
          ]} />
        </div>
      </div>
      {c.status === 'approved' && rec ? (
        <div className="audit-trail mt" data-testid="appeal-audit">
          <span><Icon name="check" size={13} /> Applied by <span className="who">{c.reviewer_name}</span> on {fmtDateTime(c.reviewed_at)} · now: in {fmtTime(rec.punch_in_at)} · out {fmtTime(rec.punch_out_at)} · {label(rec.status)} · {fmtMinutes(rec.work_minutes)}</span>
          {changes.length ? <span className="audit-change">{changes.map((x) => `${x.field} ${x.from} → ${x.to}`).join(' · ')}</span> : null}
        </div>
      ) : null}
      <KeyValue items={[
        { k: 'Raised by', v: `${c.requested_by_name || c.employee_name} · ${fmtDateTime(c.created_at)}` },
        ...(detail.data?.trail?.length ? [{ k: 'History', v: <ul className="history-list">{detail.data.trail.map((t) => <li key={t.id}><strong>{label(t.action)}</strong> · {t.by_name || 'system'} · {fmtDateTime(t.created_at)}{t.details?.note ? ` · “${t.details.note}”` : ''}</li>)}</ul> }] : []),
        ...(detail.data?.approver_chain?.length ? [{ k: 'Can approve', v: detail.data.approver_chain.map((a: any) => a.name).join(' → ') + ' · HR' }] : []),
      ]} />
      {canReview ? (
        <>
          <Field label="Note to employee" className="mt"><Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" data-testid="appeal-note" /></Field>
          <p className="help">Approving applies the requested times/status to the attendance record, recomputes work, break and late minutes, and stores the previous values in the audit trail.</p>
        </>
      ) : null}
    </Modal>
  );
}
