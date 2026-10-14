import React, { useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useCounts } from '../../lib/notifications';
import { fmtDate, fmtTime, isoToLocal, label, localToIso, todayIso } from '../../lib/format';
import { Badge, Button, Checkbox, Field, Input, Modal, Select, Textarea, useFetch, useForm, useToast } from '../ui';
import { APPEAL_KINDS, ATTENDANCE_STATUSES, AppealKind, AttendanceRecord, AttendanceSettings, DirectoryEmployee, employeeLabel } from './shared';

export interface AppealPrefill { date?: string; record?: AttendanceRecord | null; employee_id?: number | null; kind?: AppealKind }

function addDays(d: string, n: number) {
  const x = new Date(d + 'T00:00:00');
  x.setDate(x.getDate() + n);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}
/** Client-side mirror of the server deadline rule (date + N days; closed once today is past it). */
export function deadlineFor(date: string, days: number) {
  const deadline = addDays(date, days);
  const today = todayIso();
  const left = Math.round((Date.parse(deadline) - Date.parse(today)) / 86400000);
  return { deadline, passed: today > deadline, daysLeft: Math.max(0, left) };
}

/** Raise an attendance appeal (missed punch, status or time correction). HR may raise on behalf of anyone and override the deadline. */
export default function AppealModal({ date, record, employee_id, kind: initialKind, employees, onClose, onSaved }: AppealPrefill & { employees?: DirectoryEmployee[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const { isHr, user } = useAuth();
  const { refreshCounts } = useCounts();
  const settings = useFetch<AttendanceSettings>(() => api.get('/api/settings/attendance'), []);
  const deadlineDays = settings.data?.appeal_deadline_days ?? 3;
  const defaultKind: AppealKind = initialKind || (record ? (!record.punch_in_at ? 'missed_both' : !record.punch_out_at ? 'missed_punch_out' : 'correction') : 'missed_punch_out');
  const f = useForm({
    employee_id: employee_id ?? record?.employee_id ?? user?.employee_id ?? employees?.[0]?.id ?? '',
    date: date || record?.date || todayIso(),
    kind: defaultKind as string,
    requested_punch_in: isoToLocal(record?.punch_in_at),
    requested_punch_out: isoToLocal(record?.punch_out_at),
    requested_status: '',
    reason: '',
    override_deadline: false,
  });
  const [busy, setBusy] = useState(false);
  const kind = f.values.kind as AppealKind;
  const showIn = kind === 'missed_punch_in' || kind === 'missed_both' || kind === 'correction';
  const showOut = kind === 'missed_punch_out' || kind === 'missed_both' || kind === 'correction';
  const showStatus = kind === 'status' || kind === 'correction';
  const dl = useMemo(() => (f.values.date ? deadlineFor(f.values.date, deadlineDays) : null), [f.values.date, deadlineDays]);
  const blocked = !!dl?.passed && !(isHr && f.values.override_deadline);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const body: any = { date: f.values.date, kind, reason: f.values.reason, requested_punch_in: showIn ? localToIso(f.values.requested_punch_in) : null, requested_punch_out: showOut ? localToIso(f.values.requested_punch_out) : null, requested_status: showStatus ? f.values.requested_status || null : null };
    if (!body.requested_punch_in && !body.requested_punch_out && !body.requested_status) { toast.error('Enter the punch time(s) or the status you are appealing for.'); return; }
    if (isHr && f.values.employee_id) body.employee_id = Number(f.values.employee_id);
    if (isHr && f.values.override_deadline) body.override_deadline = true;
    setBusy(true);
    try {
      const saved = await api.post('/api/attendance/corrections', body);
      toast.success(`Appeal #${saved.id} raised · pending with ${saved.approver_name || 'HR'}`);
      refreshCounts();
      onSaved();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  const kindInfo = APPEAL_KINDS.find((k) => k.key === kind);
  return (
    <Modal open title="Raise attendance appeal" onClose={onClose} testId="appeal-modal"
      footer={<>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={busy} disabled={blocked} onClick={submit as any} data-testid="appeal-submit">Submit appeal</Button>
      </>}>
      <form onSubmit={submit} className="form-grid">
        {isHr && employees?.length ? (
          <Field label="Employee" hint="HR can raise an appeal on behalf of anyone" className="span-2">
            <Select {...f.bind('employee_id')} data-testid="appeal-employee">
              {employees.map((e) => <option key={e.id} value={e.id}>{employeeLabel(e)}</option>)}
            </Select>
          </Field>
        ) : null}
        <Field label="What happened?" required hint={kindInfo?.hint}>
          <Select {...f.bind('kind')} data-testid="appeal-kind">
            {APPEAL_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
          </Select>
        </Field>
        <Field label="Date" required hint={dl ? (dl.passed ? `Appeals for ${fmtDate(f.values.date)} closed on ${fmtDate(dl.deadline)} (${deadlineDays}-day deadline)` : `Can be appealed until ${fmtDate(dl.deadline)} · ${dl.daysLeft === 0 ? 'last day today' : `${dl.daysLeft} day${dl.daysLeft === 1 ? '' : 's'} left`}`) : undefined}>
          <Input type="date" max={todayIso()} {...f.bind('date')} required data-testid="appeal-date" />
        </Field>
        {dl?.passed ? (
          <div className="alert alert-warning span-2" data-testid="appeal-deadline-passed">
            {isHr ? (
              <Checkbox label={`Override the ${deadlineDays}-day deadline and raise it anyway`} checked={f.values.override_deadline} onChange={(e) => f.set('override_deadline', e.target.checked)} data-testid="appeal-override" />
            ) : `The ${deadlineDays}-day appeal window for this date has closed. Ask HR to raise it on your behalf.`}
          </div>
        ) : null}
        {record ? (
          <div className="days-hint span-2">
            Current record for {fmtDate(record.date)}: in <strong>{fmtTime(record.punch_in_at)}</strong> · out <strong>{fmtTime(record.punch_out_at)}</strong> · <Badge tone="neutral">{label(record.status)}</Badge>
          </div>
        ) : null}
        {showIn ? <Field label={kind === 'correction' ? 'Correct punch in' : 'Actual punch in'} required={kind !== 'correction'}><Input type="datetime-local" {...f.bind('requested_punch_in')} required={kind !== 'correction'} data-testid="appeal-punch-in" /></Field> : null}
        {showOut ? <Field label={kind === 'correction' ? 'Correct punch out' : 'Actual punch out'} required={kind !== 'correction'}><Input type="datetime-local" {...f.bind('requested_punch_out')} required={kind !== 'correction'} data-testid="appeal-punch-out" /></Field> : null}
        {showStatus ? (
          <Field label="Requested status" required={kind === 'status'} hint={kind === 'correction' ? 'Optional; leave blank to recompute from the punches' : undefined} className={kind === 'status' ? 'span-2' : ''}>
            <Select {...f.bind('requested_status')} required={kind === 'status'} data-testid="appeal-status">
              <option value="">— Keep as is —</option>
              {ATTENDANCE_STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
            </Select>
          </Field>
        ) : null}
        <Field label="Reason" required className="span-2"><Textarea {...f.bind('reason')} required maxLength={500} placeholder="e.g. Forgot to punch out, left at 18:30 after the client call" data-testid="appeal-reason" /></Field>
        <p className="help span-2">Appeals go to your reporting manager (HR can also act on them). Once approved the attendance record is updated, recomputed and keeps a full audit trail of what changed.</p>
      </form>
    </Modal>
  );
}
