import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { todayIso } from '../../lib/format';
import { Button, Field, Input, Modal, Select, Switch, Textarea, useForm, useToast } from '../ui';
import { DirectoryEmployee, Holiday, LeaveRequest, LeaveType, TypeRules, countLeaveDays, employeeLabel, fmtDays } from './shared';

/**
 * Apply (create) or edit a leave request. HR may pass `employees` to apply on behalf of someone
 * (with optional auto-approve). Editing an approved request as an employee creates a correction
 * that needs re-approval.
 */
export default function ApplyLeaveModal({ types, employees, defaultEmployeeId, existing, holidays, weeklyOffs, sandwich, onClose, onSaved }: {
  types: LeaveType[]; employees?: DirectoryEmployee[]; defaultEmployeeId?: number | null; existing?: LeaveRequest | null;
  holidays: Holiday[]; weeklyOffs: number[]; sandwich: boolean; onClose: () => void; onSaved: (r: LeaveRequest) => void;
}) {
  const toast = useToast();
  const { isHr } = useAuth();
  const active = types.filter((t) => t.active || t.id === existing?.leave_type_id);
  const f = useForm({
    employee_id: existing?.employee_id ?? defaultEmployeeId ?? (employees?.[0]?.id ?? ''),
    leave_type_id: existing?.leave_type_id ?? (active[0]?.id ?? ''),
    start_date: existing?.start_date || todayIso(),
    end_date: existing?.end_date || todayIso(),
    half_day: existing?.half_day || 'none',
    reason: existing?.reason || '',
  });
  const [autoApprove, setAutoApprove] = useState(false);
  const [busy, setBusy] = useState(false);
  const type = active.find((t) => t.id === Number(f.values.leave_type_id));
  const single = f.values.start_date === f.values.end_date;
  const halfAllowed = !!type?.allow_half_day && single;
  useEffect(() => {
    if (!halfAllowed && f.values.half_day !== 'none') f.set('half_day', 'none');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [halfAllowed]);
  useEffect(() => {
    if (f.values.end_date < f.values.start_date) f.set('end_date', f.values.start_date);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.values.start_date]);

  const days = useMemo(() => countLeaveDays(f.values.start_date, f.values.end_date, f.values.half_day !== 'none' ? f.values.half_day : null, weeklyOffs, holidays, sandwich), [f.values.start_date, f.values.end_date, f.values.half_day, weeklyOffs, holidays, sandwich]);
  const noticeDays = type?.min_notice_days ? Math.floor((Date.parse(f.values.start_date) - Date.parse(todayIso())) / 86400000) : null;
  const noticeShort = !isHr && type && type.min_notice_days > 0 && noticeDays !== null && noticeDays < type.min_notice_days;
  const approvedEdit = !!existing && existing.status === 'approved' && !isHr;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body: any = { leave_type_id: Number(f.values.leave_type_id), start_date: f.values.start_date, end_date: f.values.end_date, half_day: f.values.half_day === 'none' ? null : f.values.half_day, reason: f.values.reason || null };
      let r: LeaveRequest;
      if (existing) {
        r = await api.put<LeaveRequest>(`/api/leave/requests/${existing.id}`, body);
        toast.success(r.status === 'correction_pending' ? 'Change submitted for re-approval' : 'Leave request updated');
      } else {
        if (isHr && employees?.length) {
          body.employee_id = Number(f.values.employee_id);
          body.auto_approve = autoApprove;
        }
        r = await api.post<LeaveRequest>('/api/leave/requests', body);
        toast.success(r.status === 'approved' ? 'Leave applied and approved' : 'Leave request submitted');
      }
      onSaved(r);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open title={existing ? `Edit leave request #${existing.id}` : employees?.length ? 'Apply leave on behalf of an employee' : 'Apply for leave'} onClose={onClose} testId="leave-apply-modal"
      footer={<>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={busy} disabled={!type || days <= 0} onClick={submit as any} data-testid="leave-submit">{existing ? (approvedEdit ? 'Submit change for approval' : 'Save changes') : autoApprove ? 'Apply & approve' : 'Submit request'}</Button>
      </>}>
      <form onSubmit={submit} className="form-grid">
        {!existing && isHr && employees?.length ? (
          <Field label="Employee" required className="span-2">
            <Select {...f.bind('employee_id')} data-testid="leave-employee">
              {employees.map((e) => <option key={e.id} value={e.id}>{employeeLabel(e)}</option>)}
            </Select>
          </Field>
        ) : null}
        <Field label="Leave type" required className="span-2" hint={type ? undefined : 'No active leave types; ask HR to add one.'}>
          <Select {...f.bind('leave_type_id')} disabled={approvedEdit} data-testid="leave-type">
            {active.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.code})</option>)}
          </Select>
          {type ? <div className="row mt" style={{ marginTop: 6 }}><span className="color-swatch" style={{ background: type.color }} /><TypeRules t={type} /></div> : null}
        </Field>
        <Field label="Start date" required><Input type="date" {...f.bind('start_date')} required data-testid="leave-start" /></Field>
        <Field label="End date" required><Input type="date" min={f.values.start_date} {...f.bind('end_date')} required data-testid="leave-end" /></Field>
        <Field label="Half day" hint={!single ? 'Half days apply to single-day requests only' : type && !type.allow_half_day ? `${type.name} cannot be taken as a half day` : undefined}>
          <Select {...f.bind('half_day')} disabled={!halfAllowed} data-testid="leave-half-day">
            <option value="none">Full day</option>
            <option value="first_half">First half</option>
            <option value="second_half">Second half</option>
          </Select>
        </Field>
        <div className="field">
          <span className="field-label">Days requested</span>
          <div className="days-hint" data-testid="leave-days-hint">
            <strong>{fmtDays(days)}</strong>
            <span className="muted"> {sandwich ? '(sandwich rule: weekends and holidays count)' : '(weekly offs and holidays excluded)'}</span>
          </div>
          {noticeShort ? <span className="field-error">{type?.name} needs at least {type?.min_notice_days} day(s) notice; this starts in {Math.max(0, noticeDays || 0)}.</span> : null}
          {type?.requires_document ? <span className="field-hint">Remember to upload a supporting document under Documents.</span> : null}
        </div>
        <Field label="Reason" className="span-2"><Textarea {...f.bind('reason')} placeholder="Optional, visible to your approver" data-testid="leave-reason" /></Field>
        {!existing && isHr && employees?.length ? (
          <div className="span-2"><Switch label="Auto-approve (skip the approval step)" checked={autoApprove} onChange={setAutoApprove} /></div>
        ) : null}
        {approvedEdit ? <p className="help span-2 alert alert-warning">This request is already approved. Your change will be sent to your approver as a <strong>correction pending</strong> request; the original dates stay in effect until it is approved.</p> : null}
      </form>
    </Modal>
  );
}
