import React, { useEffect, useState } from 'react';
import { api, ApiError, qs } from '../../lib/api';
import { fmtDate } from '../../lib/format';
import { Button, Field, Modal, Select, Textarea, useForm, useToast } from '../ui';
import { Conflict, RosterDay, RosterEmployee, Shift, shiftTimes } from './shared';

/** Assign a shift or a day off to one employee on one date, or clear the override back to the default shift. */
export function AssignModal({ target, shifts, onClose, onSaved }: { target: { employee: RosterEmployee; day: RosterDay } | null; shifts: Shift[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const form = useForm({ shift: '', note: '' });
  const [busy, setBusy] = useState(false);
  const [conflicts, setConflicts] = useState<Conflict[] | null>(null);

  useEffect(() => {
    if (!target) return;
    const d = target.day;
    form.reset({ shift: d.source === 'assignment' ? (d.day_off ? 'off' : String(d.shift_id ?? '')) : '', note: d.note || '' });
    setConflicts(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);
  if (!target) return null;
  const { employee: e, day } = target;
  const defaultShift = shifts.find((s) => s.id === e.default_shift_id);
  const explicit = day.source === 'assignment';

  const save = async (force = false) => {
    if (!form.values.shift) { toast.error('Choose a shift or Day off'); return; }
    setBusy(true);
    try {
      const shift_id = form.values.shift === 'off' ? null : Number(form.values.shift);
      await api.put('/api/roster/assign', { assignments: [{ employee_id: e.id, date: day.date, shift_id, note: form.values.note.trim() || null }], force });
      toast.success(shift_id === null ? 'Day off set' : 'Shift assigned');
      onSaved();
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && Array.isArray(err.details?.conflicts)) setConflicts(err.details.conflicts);
      else toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  const clear = async () => {
    setBusy(true);
    try {
      await api.delete(`/api/roster/assign${qs({ employee_id: e.id, date: day.date })}`);
      toast.success('Reverted to default shift');
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open title={`${e.first_name} ${e.last_name} · ${fmtDate(day.date, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}`} onClose={onClose} testId="roster-assign-modal"
      footer={
        <>
          {explicit ? <Button variant="ghost" onClick={clear} disabled={busy} data-testid="roster-clear" style={{ marginRight: 'auto' }}>Clear override</Button> : null}
          <Button onClick={onClose}>Cancel</Button>
          {conflicts ? (
            <Button variant="danger" loading={busy} onClick={() => save(true)} data-testid="roster-force">Assign anyway</Button>
          ) : (
            <Button variant="primary" loading={busy} onClick={() => save(false)} data-testid="roster-save">Save</Button>
          )}
        </>
      }>
      <div className="grid" style={{ gap: 12 }}>
        <p className="muted" style={{ margin: 0 }}>
          {explicit ? 'This day has a roster override.' : 'No override yet; the employee follows their default shift.'} Default shift: <strong>{defaultShift ? `${defaultShift.name}` : 'none'}</strong>
          {day.holiday ? <> · Holiday: <strong>{day.holiday}</strong></> : null}
          {day.weekly_off ? ' · Weekly off' : null}
        </p>
        <Field label="Shift" required>
          <Select {...form.bind('shift')} data-testid="roster-shift" onChange={(ev) => { form.set('shift', ev.target.value); setConflicts(null); }}>
            <option value="">Choose…</option>
            {shifts.filter((s) => s.active || String(s.id) === form.values.shift).map((s) => <option key={s.id} value={String(s.id)}>{s.name} ({shiftTimes(s)})</option>)}
            <option value="off">Day off</option>
          </Select>
        </Field>
        <Field label="Note" hint="Optional, shown on the roster and in the CSV export">
          <Textarea rows={2} maxLength={200} {...form.bind('note')} data-testid="roster-note" placeholder="e.g. Covering for release night" />
        </Field>
        {conflicts ? (
          <div className="badge-warning" style={{ border: '1px solid var(--warning-border)', borderRadius: 8, padding: '8px 12px' }} data-testid="roster-conflicts">
            <strong>Approved leave on this date.</strong>
            {conflicts.map((c) => <div key={c.date}>{c.employee_name}: {c.leave_type} ({fmtDate(c.start_date)} – {fmtDate(c.end_date)})</div>)}
            <div>Assigning a shift will not cancel the leave.</div>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
