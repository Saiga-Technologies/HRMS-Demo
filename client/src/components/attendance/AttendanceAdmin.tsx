import React, { useEffect, useState } from 'react';
import { api, qs } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { fmtDate } from '../../lib/format';
import { Badge, Button, Card, Checkbox, Field, Input, Modal, Select, Switch, Table, useConfirm, useFetch, useForm, useToast } from '../ui';
import { AttendanceSettings, Holiday, Shift, WEEKDAYS, WorkLocation, useGeo } from './shared';

/* ------------------------------------------------------------------ */
/* Locations & geofences                                               */
/* ------------------------------------------------------------------ */
export function LocationsTab() {
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const list = useFetch<WorkLocation[]>(() => api.get('/api/attendance/locations'), []);
  const [edit, setEdit] = useState<Partial<WorkLocation> | null>(null);
  const remove = async (l: WorkLocation) => {
    if (!(await confirm(`Delete ${l.name}?`, 'Employees assigned to this location will be unassigned.'))) return;
    try {
      await api.delete(`/api/attendance/locations/${l.id}`);
      toast.success('Location deleted');
      list.reload();
    } catch (err) {
      toast.error(err);
    }
  };
  return (
    <>
      {dialog}
      <div className="toolbar">
        <span className="muted">Employees must punch within the radius of an active office unless remote punch is allowed in Settings.</span>
        <Button variant="primary" style={{ marginLeft: 'auto' }} onClick={() => setEdit({ radius_m: 150, active: 1 })} data-testid="location-add">+ Add location</Button>
      </div>
      <Card padded={false} tour="att-locations">
        <Table<WorkLocation>
          loading={list.loading}
          rows={list.data || []}
          onRowClick={(l) => setEdit(l)}
          empty="No work locations yet. Add your first office to enable geofenced punching."
          columns={[
            { key: 'name', header: 'Name', render: (l) => <strong>{l.name}</strong> },
            { key: 'address', header: 'Address', render: (l) => l.address || '—' },
            { key: 'lat', header: 'Latitude', render: (l) => <span className="mono">{l.lat.toFixed(6)}</span> },
            { key: 'lng', header: 'Longitude', render: (l) => <span className="mono">{l.lng.toFixed(6)}</span> },
            { key: 'radius_m', header: 'Radius', align: 'right', render: (l) => `${l.radius_m} m` },
            { key: 'active', header: 'Status', render: (l) => <Badge tone={l.active ? 'success' : 'neutral'}>{l.active ? 'Active' : 'Inactive'}</Badge> },
            { key: 'actions', header: '', align: 'right', render: (l) => <Button size="sm" variant="danger" onClick={(e) => { e.stopPropagation(); remove(l); }}>Delete</Button> },
          ]}
        />
      </Card>
      {edit ? <LocationModal loc={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); list.reload(); }} /> : null}
    </>
  );
}

function LocationModal({ loc, onClose, onSaved }: { loc: Partial<WorkLocation>; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const geo = useGeo(false);
  const f = useForm({ name: loc.name || '', address: loc.address || '', lat: loc.lat ?? '', lng: loc.lng ?? '', radius_m: loc.radius_m ?? 150, active: loc.active ?? 1 });
  const [busy, setBusy] = useState(false);
  const useMine = async () => {
    const fix = await geo.locate();
    if (fix) {
      f.set('lat', fix.lat.toFixed(6));
      f.set('lng', fix.lng.toFixed(6));
      toast.info(`Filled from your location (±${fix.accuracy} m)`);
    }
  };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body = { name: f.values.name, address: f.values.address || null, lat: Number(f.values.lat), lng: Number(f.values.lng), radius_m: Number(f.values.radius_m), active: Number(f.values.active) };
      if (loc.id) await api.put(`/api/attendance/locations/${loc.id}`, body);
      else await api.post('/api/attendance/locations', body);
      toast.success(loc.id ? 'Location updated' : 'Location created');
      onSaved();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open title={loc.id ? 'Edit location' : 'New work location'} onClose={onClose} testId="location-modal"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save as any} data-testid="location-save">Save</Button></>}>
      <form onSubmit={save} className="form-grid">
        <Field label="Name" required><Input {...f.bind('name')} required autoFocus placeholder="e.g. Bengaluru HQ" data-testid="location-name" /></Field>
        <Field label="Status"><Select {...f.bind('active')}><option value={1}>Active</option><option value={0}>Inactive</option></Select></Field>
        <Field label="Address" className="span-2"><Input {...f.bind('address')} placeholder="Street, city" /></Field>
        <Field label="Latitude" required><Input type="number" step="any" min={-90} max={90} {...f.bind('lat')} required data-testid="location-lat" /></Field>
        <Field label="Longitude" required><Input type="number" step="any" min={-180} max={180} {...f.bind('lng')} required data-testid="location-lng" /></Field>
        <Field label="Geofence radius (m)" hint="Punches further than this from the office count as outside the fence"><Input type="number" min={10} max={100000} {...f.bind('radius_m')} /></Field>
        <div className="field">
          <span className="field-label">Coordinates</span>
          <Button type="button" onClick={useMine} loading={geo.busy} data-testid="location-use-mine">📍 Use my current location</Button>
          {geo.error ? <span className="field-error">{geo.error}</span> : <span className="field-hint">Fills latitude/longitude from this device.</span>}
        </div>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Shifts                                                              */
/* ------------------------------------------------------------------ */
export function ShiftsTab() {
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const list = useFetch<Shift[]>(() => api.get('/api/attendance/shifts'), []);
  const [edit, setEdit] = useState<Partial<Shift> | null>(null);
  const remove = async (s: Shift) => {
    if (!(await confirm(`Delete shift ${s.name}?`, 'Employees on this shift will have no shift assigned.'))) return;
    try {
      await api.delete(`/api/attendance/shifts/${s.id}`);
      toast.success('Shift deleted');
      list.reload();
    } catch (err) {
      toast.error(err);
    }
  };
  return (
    <>
      {dialog}
      <div className="toolbar">
        <span className="muted">Shifts drive late marks, half/full day thresholds and working days. Assign a shift on the employee profile.</span>
        <Button variant="primary" style={{ marginLeft: 'auto' }} onClick={() => setEdit({})} data-testid="shift-add">+ Add shift</Button>
      </div>
      <Card padded={false} tour="att-shifts">
        <Table<Shift>
          loading={list.loading}
          rows={list.data || []}
          onRowClick={(s) => setEdit(s)}
          empty="No shifts defined."
          columns={[
            { key: 'name', header: 'Shift', render: (s) => <strong>{s.name}</strong> },
            { key: 'time', header: 'Hours', render: (s) => <span className="mono">{s.start_time} – {s.end_time}</span> },
            { key: 'grace_minutes', header: 'Grace', align: 'right', render: (s) => `${s.grace_minutes} m` },
            { key: 'break_minutes_allowed', header: 'Break', align: 'right', render: (s) => `${s.break_minutes_allowed} m` },
            { key: 'half_day_minutes', header: 'Half day ≥', align: 'right', render: (s) => `${s.half_day_minutes} m` },
            { key: 'full_day_minutes', header: 'Full day ≥', align: 'right', render: (s) => `${s.full_day_minutes} m` },
            { key: 'working_days', header: 'Working days', render: (s) => <span className="row" style={{ gap: 3 }}>{WEEKDAYS.map((d, i) => <span key={d} className={`day-dot ${(s.working_days || []).includes(i) ? 'on' : ''}`} title={d}>{d[0]}</span>)}</span> },
            { key: 'active', header: 'Status', render: (s) => <Badge tone={s.active ? 'success' : 'neutral'}>{s.active ? 'Active' : 'Inactive'}</Badge> },
            { key: 'actions', header: '', align: 'right', render: (s) => <Button size="sm" variant="danger" onClick={(e) => { e.stopPropagation(); remove(s); }}>Delete</Button> },
          ]}
        />
      </Card>
      {edit ? <ShiftModal shift={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); list.reload(); }} /> : null}
    </>
  );
}

function ShiftModal({ shift, onClose, onSaved }: { shift: Partial<Shift>; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const f = useForm({ name: shift.name || '', start_time: shift.start_time || '09:00', end_time: shift.end_time || '18:00', grace_minutes: shift.grace_minutes ?? 10, break_minutes_allowed: shift.break_minutes_allowed ?? 60, half_day_minutes: shift.half_day_minutes ?? 240, full_day_minutes: shift.full_day_minutes ?? 480, active: shift.active ?? 1 });
  const [days, setDays] = useState<number[]>(shift.working_days || [1, 2, 3, 4, 5]);
  const [busy, setBusy] = useState(false);
  const toggle = (i: number) => setDays((d) => (d.includes(i) ? d.filter((x) => x !== i) : [...d, i].sort()));
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body = { ...f.values, grace_minutes: Number(f.values.grace_minutes), break_minutes_allowed: Number(f.values.break_minutes_allowed), half_day_minutes: Number(f.values.half_day_minutes), full_day_minutes: Number(f.values.full_day_minutes), active: Number(f.values.active), working_days: days };
      if (shift.id) await api.put(`/api/attendance/shifts/${shift.id}`, body);
      else await api.post('/api/attendance/shifts', body);
      toast.success(shift.id ? 'Shift updated' : 'Shift created');
      onSaved();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open title={shift.id ? 'Edit shift' : 'New shift'} onClose={onClose} testId="shift-modal"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save as any} data-testid="shift-save">Save</Button></>}>
      <form onSubmit={save} className="form-grid">
        <Field label="Name" required><Input {...f.bind('name')} required autoFocus placeholder="e.g. General 9–6" data-testid="shift-name" /></Field>
        <Field label="Status"><Select {...f.bind('active')}><option value={1}>Active</option><option value={0}>Inactive</option></Select></Field>
        <Field label="Start time" required><Input type="time" {...f.bind('start_time')} required /></Field>
        <Field label="End time" required><Input type="time" {...f.bind('end_time')} required /></Field>
        <Field label="Grace minutes" hint="Late mark after start + grace"><Input type="number" min={0} {...f.bind('grace_minutes')} /></Field>
        <Field label="Break allowed (min)"><Input type="number" min={0} {...f.bind('break_minutes_allowed')} /></Field>
        <Field label="Half day minutes" hint="Below this = half day"><Input type="number" min={0} {...f.bind('half_day_minutes')} /></Field>
        <Field label="Full day minutes"><Input type="number" min={0} {...f.bind('full_day_minutes')} /></Field>
        <div className="field span-2">
          <span className="field-label">Working days</span>
          <div className="row">{WEEKDAYS.map((d, i) => <Checkbox key={d} label={d} checked={days.includes(i)} onChange={() => toggle(i)} />)}</div>
        </div>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Holidays                                                            */
/* ------------------------------------------------------------------ */
export function HolidaysTab() {
  const { isHr } = useAuth();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const list = useFetch<Holiday[]>(() => api.get(`/api/attendance/holidays${qs({ year })}`), [year]);
  const f = useForm({ name: '', date: `${year}-01-01`, optional: false });
  const [busy, setBusy] = useState(false);
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post('/api/attendance/holidays', { name: f.values.name, date: f.values.date, optional: f.values.optional ? 1 : 0 });
      toast.success('Holiday added');
      f.reset({ name: '', date: f.values.date, optional: false });
      if (!f.values.date.startsWith(year)) setYear(f.values.date.slice(0, 4));
      else list.reload();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  const remove = async (h: Holiday) => {
    if (!(await confirm(`Remove ${h.name}?`))) return;
    try {
      await api.delete(`/api/attendance/holidays/${h.id}`);
      toast.success('Holiday removed');
      list.reload();
    } catch (err) {
      toast.error(err);
    }
  };
  const years = Array.from({ length: 5 }, (_, i) => String(new Date().getFullYear() - 2 + i));
  return (
    <>
      {dialog}
      <div className="toolbar">
        <Select value={year} onChange={(e) => setYear(e.target.value)} aria-label="Year" data-testid="holiday-year">{years.map((y) => <option key={y} value={y}>{y}</option>)}</Select>
        <span className="muted">{list.data?.length ?? 0} holidays · optional holidays still count as working days for leave.</span>
      </div>
      {isHr ? (
        <Card title="Add holiday" tour="att-holiday-add">
          <form onSubmit={add} className="row" style={{ alignItems: 'flex-end' }}>
            <Field label="Name" required><Input {...f.bind('name')} required placeholder="e.g. Diwali" data-testid="holiday-name" /></Field>
            <Field label="Date" required><Input type="date" {...f.bind('date')} required data-testid="holiday-date" /></Field>
            <Checkbox label="Optional / restricted" checked={f.values.optional} onChange={(e) => f.set('optional', e.target.checked)} />
            <Button type="submit" variant="primary" loading={busy} data-testid="holiday-add">Add</Button>
          </form>
        </Card>
      ) : null}
      <Card padded={false} tour="att-holidays">
        <Table<Holiday>
          loading={list.loading}
          rows={list.data || []}
          empty={`No holidays for ${year}.`}
          columns={[
            { key: 'date', header: 'Date', render: (h) => fmtDate(h.date, { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }) },
            { key: 'name', header: 'Holiday', render: (h) => <strong>{h.name}</strong> },
            { key: 'optional', header: 'Type', render: (h) => <Badge tone={h.optional ? 'neutral' : 'info'}>{h.optional ? 'Optional' : 'Public'}</Badge> },
            ...(isHr ? [{ key: 'actions', header: '', align: 'right' as const, render: (h: Holiday) => <Button size="sm" variant="danger" onClick={() => remove(h)}>Delete</Button> }] : []),
          ]}
        />
      </Card>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */
export function AttendanceSettingsTab() {
  const toast = useToast();
  const current = useFetch<AttendanceSettings>(() => api.get('/api/settings/attendance'), []);
  const [v, setV] = useState<AttendanceSettings | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (current.data) setV({ ...current.data, weekly_offs: current.data.weekly_offs || [] });
  }, [current.data]);
  if (!v) return <Card><span className="muted">Loading settings…</span></Card>;
  const num = (k: keyof AttendanceSettings) => ({ value: String(v[k] ?? ''), onChange: (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: Number(e.target.value) }) });
  const toggleOff = (i: number) => setV({ ...v, weekly_offs: v.weekly_offs.includes(i) ? v.weekly_offs.filter((x) => x !== i) : [...v.weekly_offs, i].sort() });
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const saved = await api.put<AttendanceSettings>('/api/settings/attendance', v);
      setV(saved);
      toast.success('Attendance settings saved');
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Attendance settings" tour="att-settings" actions={<Button variant="primary" loading={busy} onClick={save as any} data-testid="attendance-settings-save">Save</Button>}>
      <form onSubmit={save} className="form-grid">
        <div className="form-section">Geofencing</div>
        <Switch label="Require geofence (punches must be inside an office radius)" checked={!!v.require_geofence} onChange={(c) => setV({ ...v, require_geofence: c })} />
        <Switch label="Allow remote punch (record location but never block)" checked={!!v.allow_remote_punch} onChange={(c) => setV({ ...v, allow_remote_punch: c })} />
        <div className="form-section">Timing rules</div>
        <Field label="Max break minutes per day" hint="A warning is shown when exceeded"><Input type="number" min={0} {...num('max_break_minutes')} /></Field>
        <Field label="Auto punch-out after (hours)"><Input type="number" min={1} max={24} {...num('auto_punch_out_hours')} /></Field>
        <Field label="Late mark after (minutes)" hint="Used when the employee has no shift grace"><Input type="number" min={0} {...num('late_mark_after_minutes')} /></Field>
        <Field label="Half day below (minutes)"><Input type="number" min={0} {...num('half_day_below_minutes')} /></Field>
        <Field label="Overtime after (minutes)"><Input type="number" min={0} {...num('overtime_after_minutes')} /></Field>
        <Field label="Standard work day (minutes)" hint="Used for the shortfall column in reports (540 = 9 hours)"><Input type="number" min={0} {...num('standard_work_minutes')} data-testid="settings-standard-work" /></Field>
        <div className="form-section">Appeals</div>
        <Field label="Appeal deadline (days)" hint="Missed-punch appeals must be raised within this many days of the date; HR can override"><Input type="number" min={0} max={90} {...num('appeal_deadline_days')} data-testid="settings-appeal-deadline" /></Field>
        <div className="field">
          <span className="field-label">Edit only via appeal</span>
          <Switch label="Every change to a record goes through an approved appeal (no direct edits, full audit trail)" checked={v.edit_only_via_appeal !== false} onChange={(c) => setV({ ...v, edit_only_via_appeal: c })} />
          <span className="field-hint">When off, HR can edit punches directly; edits are still stamped and audited with before/after values.</span>
        </div>
        <div className="form-section">Weekly offs</div>
        <div className="row span-2">{WEEKDAYS.map((d, i) => <Checkbox key={d} label={d} checked={v.weekly_offs.includes(i)} onChange={() => toggleOff(i)} />)}</div>
      </form>
    </Card>
  );
}
