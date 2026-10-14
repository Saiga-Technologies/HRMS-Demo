import React, { useState } from 'react';
import { api, qs } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { fmtDate, fmtDateTime, fmtMinutes, fmtTime, isoToLocal, label, localToIso, monthIso, todayIso } from '../../lib/format';
import { Icon } from '../Icons';
import { Badge, Button, Card, Field, Input, KeyValue, Modal, STATUS_TONE, Select, StatusBadge, Table, Textarea, useConfirm, useFetch, useForm, useToast } from '../ui';
import { ATTENDANCE_STATUSES, AttendanceRecord, AttendanceSettings, BREAK_TYPES, Break, DirectoryEmployee, daysAgoIso, employeeLabel, fmtDistance } from './shared';
import { AuditTrail } from './AuditTrail';

/** Callback used by roster/records to open the appeal modal prefilled for an employee + date. */
export type RaiseAppeal = (p: { employee_id: number; date: string; record?: AttendanceRecord | null }) => void;

/* ------------------------------------------------------------------ */
/* Daily roster                                                        */
/* ------------------------------------------------------------------ */
interface RosterRow { id: number; employee_code: string; first_name: string; last_name: string; department_name?: string | null; shift_id?: number | null; record: AttendanceRecord | null; status: string; leave_type?: string | null }
interface DailyResponse { date: string; holiday: string | null; weekend: boolean; rows: RosterRow[]; counts: Record<string, number>; edit_only_via_appeal?: boolean }
const ROSTER_STATUSES = ['present', 'half_day', 'absent', 'leave', 'holiday', 'weekend', 'wfh', 'upcoming'];

export function DailyRoster({ onRaiseAppeal }: { onRaiseAppeal?: RaiseAppeal }) {
  const { isHr } = useAuth();
  const [date, setDate] = useState(todayIso());
  const [filter, setFilter] = useState('');
  const data = useFetch<DailyResponse>(() => api.get(`/api/attendance/daily${qs({ date })}`), [date]);
  const [edit, setEdit] = useState<RosterRow | null>(null);
  const counts = data.data?.counts || {};
  const editOnly = data.data?.edit_only_via_appeal !== false;
  const rows = (data.data?.rows || []).filter((r) => !filter || r.status === filter);
  const shift = (days: number) => {
    const d = new Date(date + 'T00:00:00');
    d.setDate(d.getDate() + days);
    setDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  };
  return (
    <>
      <div className="toolbar">
        <Button size="sm" onClick={() => shift(-1)} aria-label="Previous day">‹</Button>
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} data-testid="roster-date" />
        <Button size="sm" onClick={() => shift(1)} aria-label="Next day">›</Button>
        <Button size="sm" variant="ghost" onClick={() => setDate(todayIso())}>Today</Button>
        {data.data?.holiday ? <Badge tone="info">Holiday: {data.data.holiday}</Badge> : data.data?.weekend ? <Badge tone="neutral">Weekly off</Badge> : null}
        <div className="count-chips" data-tour="att-roster-counts">
          {ROSTER_STATUSES.filter((s) => counts[s]).map((s) => (
            <button key={s} type="button" className={`badge badge-${STATUS_TONE[s] || 'neutral'} count-chip ${filter === s ? 'active' : ''}`} onClick={() => setFilter(filter === s ? '' : s)}>
              {label(s)} <strong>{counts[s]}</strong>
            </button>
          ))}
        </div>
      </div>
      <Card padded={false} tour="att-roster">
        <Table<RosterRow>
          loading={data.loading}
          rows={rows}
          empty="No employees to show for this day."
          columns={[
            { key: 'name', header: 'Employee', render: (r) => <span><strong>{r.first_name} {r.last_name}</strong> <span className="muted mono">{r.employee_code}</span></span> },
            { key: 'department_name', header: 'Department', render: (r) => r.department_name || '—' },
            { key: 'status', header: 'Status', render: (r) => <span><StatusBadge status={r.status} />{r.leave_type ? <span className="muted"> {r.leave_type}</span> : null}</span> },
            { key: 'in', header: 'In', render: (r) => fmtTime(r.record?.punch_in_at) },
            { key: 'out', header: 'Out', render: (r) => fmtTime(r.record?.punch_out_at) },
            { key: 'work', header: 'Work', align: 'right', render: (r) => (r.record?.punch_in_at ? fmtMinutes(r.record.work_minutes) : '—') },
            { key: 'break', header: 'Break', align: 'right', render: (r) => (r.record?.punch_in_at ? fmtMinutes(r.record.break_minutes) : '—') },
            { key: 'late', header: 'Late', align: 'right', render: (r) => (r.record?.late_minutes ? <span className="late">{fmtMinutes(r.record.late_minutes)}</span> : '—') },
            { key: 'fence', header: 'Geofence', render: (r) => <FenceCells rec={r.record} /> },
            { key: 'audit', header: 'Changes', render: (r) => (r.record?.corrected_at || r.record?.correction ? <AuditTrail record={r.record} compact /> : <span className="muted">—</span>) },
            ...(isHr ? [{ key: 'actions', header: '', align: 'right' as const, render: (r: RosterRow) => (editOnly
              ? <Button size="sm" onClick={() => onRaiseAppeal?.({ employee_id: r.id, date, record: r.record })} data-testid="attendance-appeal" title="Records can only be changed through an approved appeal"><Icon name="edit" size={13} /> Raise appeal</Button>
              : <Button size="sm" onClick={() => setEdit(r)} data-testid="attendance-edit">Edit</Button>) }] : []),
          ]}
        />
      </Card>
      {edit ? (
        <ManualEditModal employeeId={edit.id} employeeName={`${edit.first_name} ${edit.last_name}`} date={date} record={edit.record} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); data.reload(); }} />
      ) : null}
    </>
  );
}

export function FenceCells({ rec }: { rec: AttendanceRecord | null }) {
  if (!rec?.punch_in_at) return <span className="muted">—</span>;
  const one = (w: number | null | undefined, d: number | null | undefined, name: string | null | undefined, k: string) =>
    w === null || w === undefined ? <Badge key={k} tone="neutral">{k}: no loc</Badge> : w ? <Badge key={k} tone="success" className="fence-badge">{k}: in · {fmtDistance(d)}</Badge> : <Badge key={k} tone="warning" className="fence-badge">{k}: out · {fmtDistance(d)}{name ? ` from ${name}` : ''}</Badge>;
  return (
    <span className="row" style={{ gap: 4 }}>
      {one(rec.punch_in_within_fence, rec.punch_in_distance_m, rec.punch_in_location_name, 'In')}
      {rec.punch_out_at ? one(rec.punch_out_within_fence, rec.punch_out_distance_m, rec.punch_out_location_name, 'Out') : null}
    </span>
  );
}

/** HR manual add / edit of an attendance record for an employee + date. */
export function ManualEditModal({ employeeId, employeeName, date, record, onClose, onSaved }: { employeeId: number; employeeName: string; date: string; record: AttendanceRecord | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const f = useForm({ punch_in_at: isoToLocal(record?.punch_in_at), punch_out_at: isoToLocal(record?.punch_out_at), status: record?.source === 'manual' || record?.source === 'correction' ? record.status : '', notes: record?.notes || '' });
  const [busy, setBusy] = useState(false);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body: any = { punch_in_at: localToIso(f.values.punch_in_at), punch_out_at: localToIso(f.values.punch_out_at), notes: f.values.notes || null };
      if (f.values.status) body.status = f.values.status;
      await api.put(`/api/attendance/records/${employeeId}/${date}`, body);
      toast.success('Attendance record saved');
      onSaved();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open title={`${record ? 'Edit' : 'Add'} attendance · ${employeeName} · ${fmtDate(date)}`} onClose={onClose} testId="attendance-edit-modal"
      footer={<>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={busy} onClick={save as any} data-testid="attendance-edit-save">Save</Button>
      </>}>
      <form onSubmit={save} className="form-grid">
        <Field label="Punch in"><Input type="datetime-local" {...f.bind('punch_in_at')} data-testid="attendance-edit-in" /></Field>
        <Field label="Punch out"><Input type="datetime-local" {...f.bind('punch_out_at')} data-testid="attendance-edit-out" /></Field>
        <Field label="Status" hint="Leave blank to compute from the punch times and shift" className="span-2">
          <Select {...f.bind('status')} data-testid="attendance-edit-status">
            <option value="">— Auto (from punches) —</option>
            {ATTENDANCE_STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
          </Select>
        </Field>
        <Field label="Notes" className="span-2"><Textarea {...f.bind('notes')} placeholder="Why this record was edited" /></Field>
        {record ? <p className="help span-2">Source: {record.source}{record.corrected_at ? ` · last corrected ${fmtDateTime(record.corrected_at)}` : ''}</p> : null}
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Records list with filters                                           */
/* ------------------------------------------------------------------ */
interface Department { id: number; name: string }
export function RecordsTab({ employees, onRaiseAppeal }: { employees: DirectoryEmployee[]; onRaiseAppeal?: RaiseAppeal }) {
  const { isHr } = useAuth();
  const [filters, setFilters] = useState({ employee_id: '', from: daysAgoIso(30), to: todayIso(), status: '', department_id: '', corrected_only: '' });
  const set = (k: keyof typeof filters, v: string) => setFilters((s) => ({ ...s, [k]: v }));
  const depts = useFetch<Department[]>(() => api.get('/api/org/departments'), []);
  const settings = useFetch<AttendanceSettings>(() => api.get('/api/settings/attendance'), []);
  const editOnly = settings.data?.edit_only_via_appeal !== false;
  const key = JSON.stringify(filters);
  const list = useFetch<{ items: AttendanceRecord[] }>(() => api.get(`/api/attendance/records${qs({ ...filters, with_breaks: 1 })}`), [key]);
  const [open, setOpen] = useState<AttendanceRecord | null>(null);
  const rows = list.data?.items || [];
  const totals = rows.reduce((s, r) => ({ work: s.work + r.work_minutes, brk: s.brk + r.break_minutes, late: s.late + (r.late_minutes > 0 ? 1 : 0) }), { work: 0, brk: 0, late: 0 });
  return (
    <>
      <div className="toolbar" data-tour="att-records-filters">
        <Select value={filters.employee_id} onChange={(e) => set('employee_id', e.target.value)} aria-label="Employee" data-testid="records-employee">
          <option value="">All employees</option>
          {employees.map((e) => <option key={e.id} value={e.id}>{employeeLabel(e)}</option>)}
        </Select>
        <Input type="date" value={filters.from} onChange={(e) => set('from', e.target.value)} aria-label="From" />
        <Input type="date" value={filters.to} onChange={(e) => set('to', e.target.value)} aria-label="To" />
        <Select value={filters.status} onChange={(e) => set('status', e.target.value)} aria-label="Status">
          <option value="">Any status</option>
          {ATTENDANCE_STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
        </Select>
        <Select value={filters.department_id} onChange={(e) => set('department_id', e.target.value)} aria-label="Department">
          <option value="">All departments</option>
          {(depts.data || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </Select>
        <Select value={filters.corrected_only} onChange={(e) => set('corrected_only', e.target.value)} aria-label="Changes" data-testid="records-corrected">
          <option value="">All records</option>
          <option value="1">Changed via appeal only</option>
        </Select>
        <span className="muted" style={{ marginLeft: 'auto' }}>{rows.length} records · {fmtMinutes(totals.work)} worked · {fmtMinutes(totals.brk)} breaks · {totals.late} late</span>
      </div>
      <Card padded={false} tour="att-records">
        <Table<AttendanceRecord>
          loading={list.loading}
          rows={rows}
          onRowClick={(r) => setOpen(r)}
          empty="No attendance records match these filters."
          columns={[
            { key: 'date', header: 'Date', render: (r) => fmtDate(r.date) },
            { key: 'employee_name', header: 'Employee', render: (r) => <span><strong>{r.employee_name}</strong> <span className="muted mono">{r.employee_code}</span></span> },
            { key: 'department_name', header: 'Department', render: (r) => r.department_name || '—' },
            { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
            { key: 'in', header: 'In', render: (r) => fmtTime(r.punch_in_at) },
            { key: 'out', header: 'Out', render: (r) => fmtTime(r.punch_out_at) },
            { key: 'work_minutes', header: 'Work', align: 'right', render: (r) => fmtMinutes(r.work_minutes) },
            { key: 'break_minutes', header: 'Break', align: 'right', render: (r) => <span>{fmtMinutes(r.break_minutes)}{r.breaks?.length ? <span className="muted"> ({r.breaks.length})</span> : null}</span> },
            { key: 'late_minutes', header: 'Late', align: 'right', render: (r) => (r.late_minutes ? fmtMinutes(r.late_minutes) : '—') },
            { key: 'fence', header: 'Geofence', render: (r) => <FenceCells rec={r} /> },
            { key: 'source', header: 'Source', render: (r) => <span className="muted">{r.source}</span> },
            { key: 'audit', header: 'Changes', render: (r) => (r.corrected_at || r.correction ? <AuditTrail record={r} compact /> : <span className="muted">—</span>) },
          ]}
        />
      </Card>
      {open ? <RecordDetailModal record={open} canEdit={isHr && !editOnly} canAppeal={isHr && editOnly} onRaiseAppeal={onRaiseAppeal} onClose={() => setOpen(null)} onChanged={(r) => { setOpen(r); list.reload(); }} onDeleted={() => { setOpen(null); list.reload(); }} /> : null}
    </>
  );
}

/** Record detail with breaks and audit trail; HR may edit directly only when edit_only_via_appeal is off, otherwise raises an appeal. */
export function RecordDetailModal({ record, canEdit, canAppeal, onRaiseAppeal, onClose, onChanged, onDeleted }: { record: AttendanceRecord; canEdit: boolean; canAppeal?: boolean; onRaiseAppeal?: RaiseAppeal; onClose: () => void; onChanged: (r: AttendanceRecord) => void; onDeleted: () => void }) {
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const [editing, setEditing] = useState<Break | null>(null);
  const [manual, setManual] = useState(false);
  const remove = async () => {
    if (!(await confirm('Delete attendance record?', `This removes the ${fmtDate(record.date)} record and its breaks for ${record.employee_name}.`))) return;
    try {
      await api.delete(`/api/attendance/records/${record.id}`);
      toast.success('Record deleted');
      onDeleted();
    } catch (err) {
      toast.error(err);
    }
  };
  const removeBreak = async (b: Break) => {
    if (!(await confirm('Delete break?'))) return;
    try {
      await api.delete(`/api/attendance/breaks/${b.id}`);
      toast.success('Break deleted');
      onChanged({ ...record, breaks: (record.breaks || []).filter((x) => x.id !== b.id) });
    } catch (err) {
      toast.error(err);
    }
  };
  return (
    <Modal open wide title={`${record.employee_name || 'Attendance'} · ${fmtDate(record.date)}`} onClose={onClose} testId="record-detail-modal"
      footer={<>
        {canEdit ? <Button variant="danger" onClick={remove} style={{ marginRight: 'auto' }} data-testid="record-delete">Delete record</Button> : null}
        {canEdit ? <Button onClick={() => setManual(true)} data-testid="record-edit">Edit punches</Button> : null}
        {canAppeal ? <Button variant="primary" onClick={() => { onClose(); onRaiseAppeal?.({ employee_id: record.employee_id, date: record.date, record }); }} data-testid="record-appeal"><Icon name="edit" size={13} /> Raise appeal</Button> : null}
        <Button onClick={onClose}>Close</Button>
      </>}>
      {dialog}
      {canAppeal ? <p className="help" style={{ marginBottom: 10 }}>Attendance can only be changed through an approved appeal (Attendance → Settings). Raise one on the employee's behalf and approve it from the Appeals tab.</p> : null}
      {record.corrected_at || record.correction ? <div className="mb"><AuditTrail record={record} /></div> : null}
      <KeyValue items={[
        { k: 'Status', v: <StatusBadge status={record.status} /> },
        { k: 'Punch in', v: <span>{fmtDateTime(record.punch_in_at)} {record.punch_in_lat !== null && record.punch_in_lat !== undefined ? <span className="mono muted">({record.punch_in_lat?.toFixed(5)}, {record.punch_in_lng?.toFixed(5)})</span> : null}</span> },
        { k: 'Punch out', v: <span>{fmtDateTime(record.punch_out_at)} {record.punch_out_lat !== null && record.punch_out_lat !== undefined ? <span className="mono muted">({record.punch_out_lat?.toFixed(5)}, {record.punch_out_lng?.toFixed(5)})</span> : null}</span> },
        { k: 'Geofence', v: <FenceCells rec={record} /> },
        { k: 'Work / break / overtime', v: `${fmtMinutes(record.work_minutes)} / ${fmtMinutes(record.break_minutes)} / ${fmtMinutes(record.overtime_minutes)}` },
        { k: 'Late', v: record.late_minutes ? fmtMinutes(record.late_minutes) : 'No' },
        { k: 'Source', v: `${record.source}${record.corrected_at ? ` · changed ${fmtDateTime(record.corrected_at)}${record.corrected_by_name ? ` by ${record.corrected_by_name}` : ''}` : ''}` },
        ...(record.correction ? [{ k: 'Appeal', v: `#${record.correction.id} · ${label(record.correction.kind)} · raised by ${record.correction.requested_by_name || 'employee'} · approved by ${record.correction.reviewer_name || '—'}` }] : []),
        { k: 'Notes', v: record.notes || '—' },
      ]} />
      <h3 className="mt">Breaks</h3>
      <Table<Break>
        dense
        rows={record.breaks || []}
        empty="No breaks recorded."
        columns={[
          { key: 'type', header: 'Type', render: (b) => label(b.type) },
          { key: 'start_at', header: 'Start', render: (b) => fmtDateTime(b.start_at) },
          { key: 'end_at', header: 'End', render: (b) => (b.end_at ? fmtDateTime(b.end_at) : <Badge tone="warning">open</Badge>) },
          { key: 'minutes', header: 'Minutes', align: 'right' },
          { key: 'note', header: 'Note', render: (b) => b.note || '—' },
          ...(canEdit ? [{ key: 'actions', header: '', align: 'right' as const, render: (b: Break) => (<span className="row" style={{ justifyContent: 'flex-end' }}><Button size="sm" onClick={() => setEditing(b)}>Edit</Button><Button size="sm" variant="danger" onClick={() => removeBreak(b)}>Delete</Button></span>) }] : []),
        ]}
      />
      {editing ? <BreakEditModal brk={editing} onClose={() => setEditing(null)} onSaved={(r) => { setEditing(null); onChanged(r); }} /> : null}
      {manual ? <ManualEditModal employeeId={record.employee_id} employeeName={record.employee_name || ''} date={record.date} record={record} onClose={() => setManual(false)} onSaved={() => { setManual(false); onDeleted(); }} /> : null}
    </Modal>
  );
}

function BreakEditModal({ brk, onClose, onSaved }: { brk: Break; onClose: () => void; onSaved: (r: AttendanceRecord) => void }) {
  const toast = useToast();
  const f = useForm({ type: brk.type, start_at: isoToLocal(brk.start_at), end_at: isoToLocal(brk.end_at), note: brk.note || '' });
  const [busy, setBusy] = useState(false);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.put<AttendanceRecord>(`/api/attendance/breaks/${brk.id}`, { type: f.values.type, start_at: localToIso(f.values.start_at), end_at: localToIso(f.values.end_at), note: f.values.note || null });
      toast.success('Break updated');
      onSaved(r);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open title="Edit break" onClose={onClose} testId="break-edit-modal"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save as any} data-testid="break-save">Save</Button></>}>
      <form onSubmit={save} className="form-grid">
        <Field label="Type"><Select {...f.bind('type')}>{BREAK_TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}</Select></Field>
        <Field label="Note"><Input {...f.bind('note')} /></Field>
        <Field label="Start" required><Input type="datetime-local" {...f.bind('start_at')} required /></Field>
        <Field label="End"><Input type="datetime-local" {...f.bind('end_at')} /></Field>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Monthly summary                                                     */
/* ------------------------------------------------------------------ */
interface SummaryRow { id: number; employee_code: string; first_name: string; last_name: string; department_name?: string | null; present: number; half_day: number; leave: number; absent: number; late_count: number; corrected?: number; work_hours: number; break_hours: number; overtime_hours: number }
export function MonthlySummary() {
  const [period, setPeriod] = useState(monthIso());
  const data = useFetch<{ period: string; working_days: number; rows: SummaryRow[] }>(() => api.get(`/api/attendance/summary${qs({ period })}`), [period]);
  return (
    <>
      <div className="toolbar">
        <Input type="month" value={period} onChange={(e) => e.target.value && setPeriod(e.target.value)} data-testid="summary-month" />
        {data.data ? <span className="muted">{data.data.working_days} working days in {fmtDate(period + '-01', { month: 'long', year: 'numeric' })}</span> : null}
      </div>
      <Card padded={false} tour="att-summary-table">
        <Table<SummaryRow>
          loading={data.loading}
          rows={data.data?.rows || []}
          columns={[
            { key: 'name', header: 'Employee', render: (r) => <span><strong>{r.first_name} {r.last_name}</strong> <span className="muted mono">{r.employee_code}</span>{r.department_name ? <span className="muted"> · {r.department_name}</span> : null}</span> },
            { key: 'present', header: 'Present', align: 'right' },
            { key: 'half_day', header: 'Half day', align: 'right' },
            { key: 'leave', header: 'Leave', align: 'right' },
            { key: 'absent', header: 'Absent', align: 'right', render: (r) => (r.absent ? <span className="late">{r.absent}</span> : 0) },
            { key: 'late_count', header: 'Late', align: 'right' },
            { key: 'corrected', header: 'Appeals applied', align: 'right', render: (r) => r.corrected || 0 },
            { key: 'work_hours', header: 'Work hrs', align: 'right' },
            { key: 'break_hours', header: 'Break hrs', align: 'right' },
            { key: 'overtime_hours', header: 'OT hrs', align: 'right' },
          ]}
        />
      </Card>
    </>
  );
}
