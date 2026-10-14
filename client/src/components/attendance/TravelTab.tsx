import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, qs } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useCounts } from '../../lib/notifications';
import { fmtDate, fmtDateTime, fmtMinutes, fmtTime, monthIso } from '../../lib/format';
import { Badge, Button, Card, EmptyState, Field, Input, Modal, Select, Spinner, StatusBadge, Table, Textarea, useConfirm, useFetch, useToast } from '../ui';
import { BarChart } from '../charts';
import { Icon } from '../Icons';
import { DirectoryEmployee, fmtElapsed, useNow } from './shared';

/* ---------- Types mirrored from server/src/routes/travel.ts ---------- */
interface Trip {
  id: number; employee_id: number; destination: string; purpose: string | null; started_at: string; ended_at: string | null;
  start_lat: number | null; start_lng: number | null; end_lat: number | null; end_lng: number | null; distance_km: number; duration_minutes: number;
  status: 'active' | 'completed' | 'cancelled'; notes: string | null; created_at: string; employee_name?: string; employee_code?: string; department_name?: string | null; points: number;
}
interface ActiveResponse { trip: Trip | null; settings: { travel_tracking_enabled: boolean; travel_sample_interval_seconds: number } }
interface SummaryRow { employee_id: number; employee_name: string; employee_code: string; department_name: string | null; trips: number; km: number; minutes: number }
interface Fix { lat: number; lng: number; accuracy: number; at: number }

const GEO_OPTS: PositionOptions = { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 };
const PING_MIN_GAP_MS = 2000;
function geoMessage(err: GeolocationPositionError | { code?: number } | null): string {
  if (!err) return 'Your location is currently unavailable.';
  if (err.code === 1) return 'Location access was denied. Allow location for this site in your browser settings; travel cannot be tracked without it.';
  if (err.code === 3) return 'Timed out while waiting for a location fix. Move somewhere with a clearer signal and retry.';
  return 'Your location is currently unavailable.';
}
/** One-shot high-accuracy fix; rejects with a readable message. */
function currentPosition(timeout = GEO_OPTS.timeout): Promise<Fix> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return reject(new Error('This browser does not support location.'));
    let done = false;
    const finish = (fn: () => void) => { if (!done) { done = true; fn(); } };
    // Some platforms never answer a one-shot request while a watch is active; enforce the timeout ourselves too.
    const guard = setTimeout(() => finish(() => reject(new Error(geoMessage({ code: 3 })))), (timeout || 15000) + 500);
    navigator.geolocation.getCurrentPosition(
      (pos) => { clearTimeout(guard); finish(() => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: Math.round(pos.coords.accuracy), at: Date.now() })); },
      (err) => { clearTimeout(guard); finish(() => reject(new Error(geoMessage(err)))); },
      { ...GEO_OPTS, timeout },
    );
  });
}
const fmtKm = (km?: number | null) => (km === undefined || km === null ? '—' : `${km.toFixed(2)} km`);
function monthRange(month: string) {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}
function csvCell(v: any): string {
  const s = v === undefined || v === null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
/** Builds a CSV in the browser and triggers a download. */
export function exportTripsCsv(rows: Trip[], filename: string, withEmployee = false) {
  const head = [...(withEmployee ? ['Employee', 'Code', 'Department'] : []), 'Date', 'Destination', 'Purpose', 'Start', 'End', 'Duration (min)', 'Distance (km)', 'Points', 'Status', 'Notes'];
  const lines = rows.map((t) => [
    ...(withEmployee ? [t.employee_name, t.employee_code, t.department_name] : []),
    t.started_at.slice(0, 10), t.destination, t.purpose, t.started_at, t.ended_at, t.duration_minutes, t.distance_km, t.points, t.status, t.notes,
  ].map(csvCell).join(','));
  const blob = new Blob([[head.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/**
 * Travel tab: start a trip (destination + purpose), sample the device location while it runs, stop it
 * to record distance and duration; list and export my trips; managers/HR see team trips and a monthly
 * km-per-employee summary.
 */
export default function TravelTab() {
  const { user, isManager } = useAuth();
  const { refreshCounts } = useCounts();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const eid = user?.employee_id ?? null;
  const active = useFetch<ActiveResponse>(() => api.get('/api/travel/active'), []);
  const [month, setMonth] = useState(monthIso());
  const range = useMemo(() => monthRange(month), [month]);
  const trips = useFetch<Trip[]>(() => (eid ? api.get(`/api/travel${qs({ employee_id: eid, from: range.from, to: range.to })}`) : Promise.resolve([])), [eid, range.from, range.to]);
  const [startOpen, setStartOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [lastFix, setLastFix] = useState<Fix | null>(null);

  const trip = active.data?.trip ?? null;
  const enabled = active.data?.settings.travel_tracking_enabled !== false;
  const sampleSeconds = active.data?.settings.travel_sample_interval_seconds || 60;
  const setTrip = (t: Trip | null) => active.setData((prev) => (prev ? { ...prev, trip: t } : prev));
  const afterChange = () => { trips.reload(); refreshCounts(); };

  // ---- Sampling while a trip is active: watchPosition, with an interval fallback. ----
  const tripId = trip?.id ?? null;
  const lastPing = useRef(0);
  const pendingFix = useRef<Fix | null>(null);
  const pingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const send = useCallback(async (f: Fix) => {
    if (!tripId) return;
    lastPing.current = Date.now();
    try {
      const r = await api.post<Trip & { added: boolean }>(`/api/travel/${tripId}/ping`, { lat: f.lat, lng: f.lng, accuracy: f.accuracy });
      setTrip(r);
      setGeoError(null);
    } catch (err: any) {
      if (err?.status === 400 || err?.status === 404) active.reload(); // trip no longer active (stopped elsewhere)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId]);
  /** Browsers can fire several fixes per second: post at most one every 2 s, always the latest one (trailing edge). */
  const ping = useCallback((f: Fix) => {
    setLastFix(f);
    const wait = PING_MIN_GAP_MS - (Date.now() - lastPing.current);
    if (wait <= 0 && !pingTimer.current) { send(f); return; }
    pendingFix.current = f;
    if (!pingTimer.current) {
      pingTimer.current = setTimeout(() => {
        pingTimer.current = null;
        const p = pendingFix.current;
        pendingFix.current = null;
        if (p) send(p);
      }, Math.max(wait, 50));
    }
  }, [send]);
  useEffect(() => {
    if (!tripId || typeof navigator === 'undefined' || !navigator.geolocation) return;
    let watchId: number | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    const onPos = (pos: GeolocationPosition) => ping({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: Math.round(pos.coords.accuracy), at: Date.now() });
    const onErr = (err: GeolocationPositionError) => setGeoError(geoMessage(err));
    if (typeof navigator.geolocation.watchPosition === 'function') watchId = navigator.geolocation.watchPosition(onPos, onErr, GEO_OPTS);
    // Fallback / safety net: a periodic one-shot fix in case watchPosition is throttled or unsupported.
    timer = setInterval(() => navigator.geolocation.getCurrentPosition(onPos, onErr, GEO_OPTS), Math.max(10, sampleSeconds) * 1000);
    return () => {
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      if (timer) clearInterval(timer);
      if (pingTimer.current) { clearTimeout(pingTimer.current); pingTimer.current = null; }
      pendingFix.current = null;
    };
  }, [tripId, sampleSeconds, ping]);

  const start = async (destination: string, purpose: string) => {
    setBusy('start');
    setGeoError(null);
    try {
      let fix: Fix | null = null;
      try {
        fix = await currentPosition();
      } catch (err: any) {
        setGeoError(err?.message || 'Location unavailable');
        return;
      }
      const t = await api.post<Trip>('/api/travel/start', { destination, purpose: purpose || null, lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy });
      setLastFix(fix);
      setTrip(t);
      setStartOpen(false);
      toast.success(`Travel to ${t.destination} started`);
      refreshCounts();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  };
  const stop = async () => {
    if (!trip) return;
    setBusy('stop');
    try {
      // Final position: a quick fresh fix, else the latest fix from the watch (never block the stop on GPS).
      let f: Fix | null = null;
      try {
        f = await currentPosition(5000);
      } catch (err: any) {
        f = lastFix && Date.now() - lastFix.at < 10 * 60 * 1000 ? lastFix : null;
        if (!f) setGeoError(err?.message || 'Location unavailable');
      }
      const body: any = f ? { lat: f.lat, lng: f.lng, accuracy: f.accuracy } : {};
      const t = await api.post<Trip>(`/api/travel/${trip.id}/stop`, body);
      setTrip(null);
      toast.success(`Trip to ${t.destination} completed · ${fmtKm(t.distance_km)} in ${fmtMinutes(t.duration_minutes)}`);
      afterChange();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  };
  const cancel = async () => {
    if (!trip || !(await confirm(`Cancel the trip to ${trip.destination}?`, 'Nothing will be recorded for this trip.'))) return;
    setBusy('cancel');
    try {
      await api.post(`/api/travel/${trip.id}/cancel`, {});
      setTrip(null);
      toast.success('Trip cancelled');
      afterChange();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  };

  const rows = trips.data || [];
  const totals = rows.filter((t) => t.status === 'completed').reduce((s, t) => ({ km: s.km + t.distance_km, min: s.min + t.duration_minutes, n: s.n + 1 }), { km: 0, min: 0, n: 0 });

  if (!eid) {
    return <Card><EmptyState title="No employee record linked to your login" description="Travel tracking needs an employee profile. Ask HR to link your user account under Settings → Users." /></Card>;
  }
  return (
    <>
      {dialog}
      {!enabled && !active.loading ? <div className="alert alert-warning mb">Travel tracking is switched off by HR (Attendance settings). Past trips are still listed below.</div> : null}
      {geoError ? <div className="alert alert-error mb" data-testid="travel-geo-error"><Icon name="mapPin" size={14} /> {geoError}</div> : null}

      {active.loading && !active.data ? <Spinner /> : trip ? (
        <ActiveTripCard trip={trip} lastFix={lastFix} busy={busy} onStop={stop} onCancel={cancel} />
      ) : (
        <Card className="mb travel-start-card" tour="travel-start">
          <div className="row between">
            <div>
              <h2 className="card-title" style={{ margin: 0 }}>Start a trip</h2>
              <span className="muted">Enter your destination; your device location is sampled while you travel and the distance is recorded when you stop.</span>
            </div>
            <Button variant="primary" onClick={() => { setGeoError(null); setStartOpen(true); }} disabled={!enabled} data-testid="travel-start"><Icon name="play" size={15} /> Start travel</Button>
          </div>
        </Card>
      )}

      <Card padded={false} className="mb" tour="travel-trips" title="My trips"
        actions={
          <span className="row">
            <span className="muted">{totals.n} trip{totals.n === 1 ? '' : 's'} · {fmtKm(totals.km)} · {fmtMinutes(totals.min)}</span>
            <Input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label="Month" data-testid="travel-month" style={{ width: 160 }} />
            <Button size="sm" onClick={() => exportTripsCsv(rows, `travel_${month}.csv`)} disabled={!rows.length} data-testid="travel-export"><Icon name="download" size={14} /> Export CSV</Button>
          </span>
        }>
        <TripsTable rows={rows} loading={trips.loading} />
      </Card>

      {isManager ? <TeamTravel month={month} range={range} /> : null}

      {startOpen ? <StartTripModal busy={busy === 'start'} error={geoError} onClose={() => setStartOpen(false)} onStart={start} /> : null}
    </>
  );
}

function ActiveTripCard({ trip, lastFix, busy, onStop, onCancel }: { trip: Trip; lastFix: Fix | null; busy: string | null; onStop: () => void; onCancel: () => void }) {
  const now = useNow(1000);
  const elapsed = Math.max(0, now - Date.parse(trip.started_at));
  return (
    <div className="travel-active mb" data-testid="travel-active" data-tour="travel-active">
      <div className="travel-active-head">
        <span className="travel-pulse" aria-hidden />
        <div>
          <div className="muted" style={{ fontSize: 12 }}>Travelling to</div>
          <h2 className="travel-destination">{trip.destination}</h2>
          {trip.purpose ? <div className="muted">{trip.purpose}</div> : null}
        </div>
        <div className="row" style={{ marginLeft: 'auto', gap: 8 }}>
          <Button onClick={onCancel} disabled={!!busy} loading={busy === 'cancel'} data-testid="travel-cancel">Cancel</Button>
          <Button variant="danger" onClick={onStop} disabled={!!busy} loading={busy === 'stop'} data-testid="travel-stop"><Icon name="stop" size={14} /> Stop travel</Button>
        </div>
      </div>
      <div className="travel-stats">
        <div className="travel-stat"><span className="muted">Elapsed</span><strong className="num">{fmtElapsed(elapsed)}</strong><span className="muted">since {fmtTime(trip.started_at)}</span></div>
        <div className="travel-stat"><span className="muted">Distance so far</span><strong className="num" data-testid="travel-distance">{fmtKm(trip.distance_km)}</strong><span className="muted">sum of sampled legs</span></div>
        <div className="travel-stat"><span className="muted">Samples</span><strong className="num">{trip.points}</strong><span className="muted">points ≥ 15 m apart</span></div>
        <div className="travel-stat"><span className="muted">Last fix</span><strong className="num">{lastFix ? `±${lastFix.accuracy} m` : '—'}</strong><span className="muted">{lastFix ? `${lastFix.lat.toFixed(5)}, ${lastFix.lng.toFixed(5)} · ${fmtTime(new Date(lastFix.at).toISOString())}` : 'waiting for GPS'}</span></div>
      </div>
    </div>
  );
}

function StartTripModal({ busy, error, onClose, onStart }: { busy: boolean; error: string | null; onClose: () => void; onStart: (destination: string, purpose: string) => void }) {
  const [destination, setDestination] = useState('');
  const [purpose, setPurpose] = useState('');
  const submit = (e: React.FormEvent) => { e.preventDefault(); if (destination.trim()) onStart(destination.trim(), purpose.trim()); };
  return (
    <Modal open title="Start travel" onClose={onClose} testId="travel-modal"
      footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" loading={busy} disabled={!destination.trim()} onClick={submit as any} data-testid="travel-confirm"><Icon name="mapPin" size={14} /> Start</Button></>}>
      <form onSubmit={submit} className="stack">
        <Field label="Destination" required hint="Where are you going? e.g. Client office, Mumbai">
          <Input value={destination} onChange={(e) => setDestination(e.target.value)} required autoFocus maxLength={200} placeholder="Destination" data-testid="travel-destination" />
        </Field>
        <Field label="Purpose" hint="Optional">
          <Textarea value={purpose} onChange={(e) => setPurpose(e.target.value)} rows={2} maxLength={500} placeholder="e.g. Quarterly review with the customer" data-testid="travel-purpose" />
        </Field>
        {error ? <div className="alert alert-error">{error}</div> : <p className="help"><Icon name="info" size={13} /> Starting reads your current location (high accuracy) and keeps sampling it while the trip is active. Keep this page open on your phone or laptop.</p>}
      </form>
    </Modal>
  );
}

function TripsTable({ rows, loading, showEmployee }: { rows: Trip[]; loading?: boolean; showEmployee?: boolean }) {
  return (
    <Table<Trip>
      loading={loading}
      rows={rows}
      empty="No trips in this month."
      columns={[
        ...(showEmployee ? [{ key: 'employee_name', header: 'Employee', render: (t: Trip) => <span><strong>{t.employee_name}</strong> <span className="muted mono">{t.employee_code}</span></span> }] : []),
        { key: 'date', header: 'Date', render: (t) => fmtDate(t.started_at.slice(0, 10), { weekday: 'short', day: '2-digit', month: 'short' }) },
        { key: 'destination', header: 'Destination', render: (t) => <strong>{t.destination}</strong> },
        { key: 'purpose', header: 'Purpose', render: (t) => <span className="muted" title={t.purpose || ''}>{t.purpose ? (t.purpose.length > 50 ? t.purpose.slice(0, 50) + '…' : t.purpose) : '—'}</span> },
        { key: 'start', header: 'Start', render: (t) => fmtTime(t.started_at) },
        { key: 'end', header: 'End', render: (t) => (t.ended_at ? fmtTime(t.ended_at) : <span className="muted">—</span>) },
        { key: 'duration_minutes', header: 'Duration', align: 'right', render: (t) => (t.status === 'active' ? <span className="muted">running</span> : fmtMinutes(t.duration_minutes)) },
        { key: 'distance_km', header: 'Distance', align: 'right', render: (t) => <span className="num" data-testid="trip-distance">{fmtKm(t.distance_km)}</span> },
        { key: 'status', header: 'Status', render: (t) => <StatusBadge status={t.status} /> },
      ]}
    />
  );
}

function TeamTravel({ month, range }: { month: string; range: { from: string; to: string } }) {
  const { user } = useAuth();
  const [employeeId, setEmployeeId] = useState('');
  const employees = useFetch<DirectoryEmployee[]>(() => api.get('/api/employees/directory/all'), []);
  const team = useFetch<Trip[]>(() => api.get(`/api/travel${qs({ employee_id: employeeId, from: range.from, to: range.to })}`), [employeeId, range.from, range.to]);
  const summary = useFetch<{ period: string; rows: SummaryRow[]; totals: { km: number; trips: number; minutes: number } }>(() => api.get(`/api/travel/summary${qs({ period: month })}`), [month]);
  const rows = (team.data || []).filter((t) => t.employee_id !== user?.employee_id || employeeId);
  const visibleIds = useMemo(() => new Set((team.data || []).map((t) => t.employee_id)), [team.data]);
  const options = (employees.data || []).filter((e) => visibleIds.has(e.id) || e.id === Number(employeeId));
  return (
    <div className="detail-grid mb" data-tour="travel-team">
      <Card padded={false} title="Team travel"
        actions={
          <span className="row">
            <Select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} aria-label="Employee" data-testid="travel-team-employee">
              <option value="">Everyone in my scope</option>
              {options.map((e) => <option key={e.id} value={e.id}>{e.first_name} {e.last_name} ({e.employee_code})</option>)}
            </Select>
            <Button size="sm" onClick={() => exportTripsCsv(team.data || [], `travel_team_${month}.csv`, true)} disabled={!team.data?.length}><Icon name="download" size={14} /> CSV</Button>
          </span>
        }>
        <TripsTable rows={rows} loading={team.loading} showEmployee />
      </Card>
      <Card title={`Distance per employee · ${fmtDate(range.from, { month: 'long', year: 'numeric' })}`} actions={summary.data ? <Badge tone="info">{summary.data.totals.trips} trips · {fmtKm(summary.data.totals.km)}</Badge> : null}>
        {summary.loading && !summary.data ? <Spinner /> : (
          <BarChart horizontal data={(summary.data?.rows || []).map((r) => ({ key: String(r.employee_id), label: r.employee_name, value: r.km, hint: `${r.employee_name}: ${fmtKm(r.km)} over ${r.trips} trip${r.trips === 1 ? '' : 's'} (${fmtMinutes(r.minutes)})` }))} valueFormat={(v) => fmtKm(v)} onSelect={(d) => setEmployeeId(d.key || '')} />
        )}
        <p className="help" style={{ marginTop: 10 }}>Completed trips only. Click a bar to filter the table. Last refreshed {fmtDateTime(new Date().toISOString())}.</p>
      </Card>
    </div>
  );
}
