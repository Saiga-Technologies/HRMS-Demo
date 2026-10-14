import React, { useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { fmtMinutes, fmtTime, label } from '../../lib/format';
import { Badge, Button, Card, Select, Spinner, StatusBadge, Table, useFetch, useToast } from '../ui';
import { AttendanceRecord, BREAK_TYPES, Break, TodayResponse, fmtDistance, fmtElapsed, nearestLocation, useGeo, useNow } from './shared';

type PunchState = 'before' | 'working' | 'on_break' | 'done';

/** Live clock, geofence status, punch in/out and break controls for the signed-in employee. */
export default function PunchWidget({ onRecordChange }: { onRecordChange?: () => void }) {
  const toast = useToast();
  const today = useFetch<TodayResponse>(() => api.get('/api/attendance/me/today'), []);
  const geo = useGeo(true);
  const now = useNow(1000);
  const [breakType, setBreakType] = useState('break');
  const [busy, setBusy] = useState<string | null>(null);

  const rec = today.data?.record ?? null;
  const settings = today.data?.settings;
  const shift = today.data?.shift ?? null;
  const locations = today.data?.locations || [];
  const breaks: Break[] = rec?.breaks || [];
  const openBreak = breaks.find((b) => !b.end_at) || null;
  const state: PunchState = !rec?.punch_in_at ? 'before' : rec.punch_out_at ? 'done' : openBreak ? 'on_break' : 'working';

  const nearest = useMemo(() => (geo.fix ? nearestLocation(geo.fix.lat, geo.fix.lng, locations) : null), [geo.fix, locations]);

  // Live numbers.
  const openBreakMs = openBreak ? Math.max(0, now - Date.parse(openBreak.start_at)) : 0;
  const totalBreakMin = breaks.reduce((s, b) => s + (b.end_at ? b.minutes : 0), 0) + Math.floor(openBreakMs / 60000);
  const maxBreak = settings?.max_break_minutes ?? 60;
  const breakPct = Math.min(100, Math.round((totalBreakMin / Math.max(1, maxBreak)) * 100));
  const breakOver = totalBreakMin > maxBreak;
  const workMin = rec?.punch_in_at
    ? rec.punch_out_at
      ? rec.work_minutes
      : Math.max(0, Math.floor((now - Date.parse(rec.punch_in_at)) / 60000) - totalBreakMin)
    : 0;

  const apply = (r: AttendanceRecord) => {
    today.setData((prev) => (prev ? { ...prev, record: r } : prev));
    onRecordChange?.();
  };
  const punch = async (kind: 'in' | 'out') => {
    setBusy(kind);
    try {
      const f = await geo.locate();
      const body = f ? { lat: f.lat, lng: f.lng } : {};
      const r = await api.post<AttendanceRecord>(`/api/attendance/me/punch-${kind}`, body);
      apply(r);
      const fence = kind === 'in' ? r.punch_in_within_fence : r.punch_out_within_fence;
      const name = kind === 'in' ? r.punch_in_location_name : r.punch_out_location_name;
      toast.success(kind === 'in' ? `Punched in at ${fmtTime(r.punch_in_at)}${fence ? ` · inside ${name}` : ''}` : `Punched out at ${fmtTime(r.punch_out_at)} · ${fmtMinutes(r.work_minutes)} worked`);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  };
  const startBreak = async () => {
    setBusy('break-start');
    try {
      apply(await api.post<AttendanceRecord>('/api/attendance/me/break/start', { type: breakType }));
      toast.success(`${label(breakType)} started`);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  };
  const endBreak = async () => {
    setBusy('break-end');
    try {
      const r = await api.post<AttendanceRecord>('/api/attendance/me/break/end');
      apply(r);
      if (r.break_limit_exceeded) toast.error(`Break limit exceeded: ${fmtMinutes(r.break_minutes)} taken, ${fmtMinutes(maxBreak)} allowed today.`);
      else toast.success('Break ended, welcome back');
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  };

  const clock = new Date(now);
  const stateLabel = { before: 'Not punched in yet', working: 'Working', on_break: `On ${openBreak?.type || 'break'}`, done: 'Day complete' }[state];
  const stateTone = { before: 'neutral', working: 'success', on_break: 'warning', done: 'info' }[state] as 'neutral' | 'success' | 'warning' | 'info';

  return (
    <Card tour="att-punch" title="Today" actions={<Badge tone={stateTone}>{stateLabel}</Badge>}>
      {today.loading && !today.data ? (
        <Spinner />
      ) : today.error ? (
        <div className="alert alert-error">{today.error}</div>
      ) : (
        <div className="punch-card">
          <div>
            <div className="clock" data-testid="live-clock">{clock.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>
            <div className="muted">{clock.toLocaleDateString(undefined, { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}{shift ? ` · ${shift.name} ${shift.start_time}–${shift.end_time}` : ''}</div>

            <GeoStatus geo={geo} nearest={nearest} hasLocations={locations.length > 0} settings={settings} />

            <div className="punch-actions" data-tour="att-punch-actions">
              <Button variant="primary" data-testid="punch-in" disabled={state !== 'before'} loading={busy === 'in'} onClick={() => punch('in')}>Punch in</Button>
              <Button variant="danger" data-testid="punch-out" disabled={state !== 'working' && state !== 'on_break'} loading={busy === 'out'} onClick={() => punch('out')}>Punch out</Button>
            </div>
            <div className="punch-actions break-controls" data-tour="att-breaks">
              <Select value={breakType} onChange={(e) => setBreakType(e.target.value)} disabled={state !== 'working'} aria-label="Break type" style={{ width: 'auto' }} data-testid="break-type">
                {BREAK_TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}
              </Select>
              <Button data-testid="break-start" disabled={state !== 'working'} loading={busy === 'break-start'} onClick={startBreak}>Start break</Button>
              <Button data-testid="break-end" disabled={state !== 'on_break'} loading={busy === 'break-end'} onClick={endBreak}>
                End break{openBreak ? ` · ${fmtElapsed(openBreakMs)}` : ''}
              </Button>
            </div>
            {state === 'done' ? <p className="help mt">You have punched out for today. If something looks wrong, request a correction below.</p> : null}
          </div>

          <div className="punch-summary" data-tour="att-summary">
            <div className="punch-stats">
              <div className="punch-stat"><span className="muted">Punch in</span><strong>{fmtTime(rec?.punch_in_at)}</strong><FenceBadge within={rec?.punch_in_within_fence} distance={rec?.punch_in_distance_m} name={rec?.punch_in_location_name} present={!!rec?.punch_in_at} /></div>
              <div className="punch-stat"><span className="muted">Punch out</span><strong>{fmtTime(rec?.punch_out_at)}</strong><FenceBadge within={rec?.punch_out_within_fence} distance={rec?.punch_out_distance_m} name={rec?.punch_out_location_name} present={!!rec?.punch_out_at} /></div>
              <div className="punch-stat"><span className="muted">Work time</span><strong>{rec?.punch_in_at ? fmtMinutes(workMin) : '—'}</strong>{rec?.overtime_minutes ? <Badge tone="info">OT {fmtMinutes(rec.overtime_minutes)}</Badge> : null}</div>
              <div className="punch-stat"><span className="muted">Late</span><strong>{rec?.late_minutes ? fmtMinutes(rec.late_minutes) : 'No'}</strong>{rec?.late_minutes ? <Badge tone="warning">Late mark</Badge> : rec?.punch_in_at ? <Badge tone="success">On time</Badge> : null}</div>
            </div>
            <div className="mt">
              <div className="row between">
                <span>Breaks: <strong>{fmtMinutes(totalBreakMin)}</strong> of {fmtMinutes(maxBreak)} allowed{openBreak ? <span className="muted"> · running {fmtElapsed(openBreakMs)}</span> : null}</span>
                {breakOver ? <Badge tone="danger">Limit exceeded</Badge> : null}
              </div>
              <div className={`progress ${breakOver ? 'over' : ''}`} aria-label="Break usage"><span style={{ width: `${breakPct}%` }} /></div>
            </div>
            {rec?.status ? <div className="mt row"><span className="muted">Status</span><StatusBadge status={rec.status} /><span className="muted">· source {rec.source}</span></div> : null}
            <div className="mt">
              <Table<Break>
                dense
                rows={breaks}
                empty="No breaks today."
                columns={[
                  { key: 'type', header: 'Type', render: (b) => label(b.type) },
                  { key: 'start_at', header: 'Start', render: (b) => fmtTime(b.start_at) },
                  { key: 'end_at', header: 'End', render: (b) => (b.end_at ? fmtTime(b.end_at) : <Badge tone="warning">running</Badge>) },
                  { key: 'minutes', header: 'Minutes', align: 'right', render: (b) => (b.end_at ? b.minutes : Math.floor(openBreakMs / 60000)) },
                ]}
              />
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

function FenceBadge({ within, distance, name, present }: { within?: number | null; distance?: number | null; name?: string | null; present: boolean }) {
  if (!present) return null;
  if (within === null || within === undefined || (within === 0 && distance === null)) return <Badge tone="neutral">No location</Badge>;
  return within ? <Badge tone="success">Within {name || 'fence'} · {fmtDistance(distance)}</Badge> : <Badge tone="warning">Outside fence · {fmtDistance(distance)} from {name || 'office'}</Badge>;
}

function GeoStatus({ geo, nearest, hasLocations, settings }: { geo: ReturnType<typeof useGeo>; nearest: ReturnType<typeof nearestLocation>; hasLocations: boolean; settings?: { require_geofence: boolean; allow_remote_punch: boolean } }) {
  const strict = !!settings && settings.require_geofence && !settings.allow_remote_punch;
  let tone = 'neutral', icon = '◌', text: React.ReactNode = 'Locating…';
  if (geo.busy && !geo.fix) {
    text = 'Getting your location…';
  } else if (geo.error) {
    tone = 'err';
    icon = '⚠';
    text = (
      <span>
        {geo.error}{' '}
        <span className="muted">{strict ? 'Punching requires a location inside an office geofence. HR can allow remote punch under Attendance → Settings.' : 'You can still punch; your location will not be recorded.'}</span>
      </span>
    );
  } else if (geo.fix) {
    const coords = `${geo.fix.lat.toFixed(5)}, ${geo.fix.lng.toFixed(5)} (±${geo.fix.accuracy} m)`;
    if (!hasLocations) {
      tone = 'warn';
      icon = '◎';
      text = <span>{coords} · <span className="muted">No office geofence configured yet.</span></span>;
    } else if (nearest?.within) {
      tone = 'ok';
      icon = '✓';
      text = <span><strong>Inside {nearest.location.name} geofence</strong> ({fmtDistance(nearest.distance)}) · <span className="mono muted">{coords}</span></span>;
    } else if (nearest) {
      tone = 'warn';
      icon = '✕';
      text = <span><strong>Outside geofence:</strong> {fmtDistance(nearest.distance)} from {nearest.location.name} (allowed {nearest.location.radius_m} m) · <span className="mono muted">{coords}</span>{strict ? <span className="muted"> · punching will be refused here</span> : null}</span>;
    }
  }
  return (
    <div className={`geo-status geo-${tone} mt`} data-tour="att-geo" data-testid="geo-status">
      <span aria-hidden>{icon}</span>
      <span style={{ flex: 1 }}>{text}</span>
      <Button size="sm" variant="ghost" onClick={() => geo.locate()} loading={geo.busy} title="Refresh location">↻</Button>
    </div>
  );
}
