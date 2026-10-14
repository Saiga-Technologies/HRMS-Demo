import React, { useState } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { isoToLocal, label, localToIso, todayIso } from '../../lib/format';
import { Button, Field, Input, Modal, Select, Textarea, useForm, useToast } from '../ui';
import { ATTENDANCE_STATUSES, AttendanceRecord, DirectoryEmployee, employeeLabel } from './shared';

/** Employee (or HR on behalf) asks for a punch/status correction on a date. */
export default function CorrectionModal({ date, record, employees, onClose, onSaved }: { date?: string; record?: AttendanceRecord | null; employees?: DirectoryEmployee[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const { isHr, user } = useAuth();
  const f = useForm({
    employee_id: record?.employee_id ?? user?.employee_id ?? '',
    date: date || record?.date || todayIso(),
    requested_punch_in: isoToLocal(record?.punch_in_at),
    requested_punch_out: isoToLocal(record?.punch_out_at),
    requested_status: '',
    reason: '',
  });
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const body: any = {
      date: f.values.date,
      requested_punch_in: localToIso(f.values.requested_punch_in),
      requested_punch_out: localToIso(f.values.requested_punch_out),
      requested_status: f.values.requested_status || null,
      reason: f.values.reason,
    };
    if (!body.requested_punch_in && !body.requested_punch_out && !body.requested_status) {
      toast.error('Enter the corrected punch in, punch out or a status.');
      return;
    }
    if (isHr && f.values.employee_id) body.employee_id = Number(f.values.employee_id);
    setBusy(true);
    try {
      await api.post('/api/attendance/corrections', body);
      toast.success('Correction request submitted');
      onSaved();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open title="Request attendance correction" onClose={onClose} testId="correction-modal"
      footer={<>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={busy} onClick={submit as any} data-testid="correction-submit">Submit request</Button>
      </>}>
      <form onSubmit={submit} className="form-grid">
        {isHr && employees?.length ? (
          <Field label="Employee" className="span-2">
            <Select {...f.bind('employee_id')} data-testid="correction-employee">
              {employees.map((e) => <option key={e.id} value={e.id}>{employeeLabel(e)}</option>)}
            </Select>
          </Field>
        ) : null}
        <Field label="Date" required><Input type="date" max={todayIso()} {...f.bind('date')} required data-testid="correction-date" /></Field>
        <Field label="Requested status" hint="Optional; leave blank to keep the computed status">
          <Select {...f.bind('requested_status')}>
            <option value="">— Keep as is —</option>
            {ATTENDANCE_STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
          </Select>
        </Field>
        <Field label="Correct punch in"><Input type="datetime-local" {...f.bind('requested_punch_in')} data-testid="correction-punch-in" /></Field>
        <Field label="Correct punch out"><Input type="datetime-local" {...f.bind('requested_punch_out')} data-testid="correction-punch-out" /></Field>
        <Field label="Reason" required className="span-2"><Textarea {...f.bind('reason')} required maxLength={500} placeholder="e.g. Forgot to punch out, left at 18:30" data-testid="correction-reason" /></Field>
        <p className="help span-2">Your manager or HR will review this. Once approved the record is updated and recomputed.</p>
      </form>
    </Modal>
  );
}
