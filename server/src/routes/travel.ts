import { Router } from 'express';
import { all, get, insert, update, run, getSetting, parseJson } from '../db.js';
import { requireAuth, requireHr, requireRole } from '../auth.js';
import { approvableEmployeeIds } from '../approvers.js';
import { badRequest, notFound, forbidden, requireFields, audit, toInt, toNum, nowIso, today, wrap, distanceMeters, round2 } from '../util.js';
import { DEFAULT_ATTENDANCE_SETTINGS } from './settings.js';

/**
 * Travel tracking: an employee starts a trip with a destination, the browser samples GPS fixes
 * (POST /:id/ping) while the trip is active, and stopping it records distance (sum of Haversine
 * legs between sampled points) and duration. Mounted at /api/travel.
 */
const r = Router();

interface PathPoint { lat: number; lng: number; at: string; acc?: number | null }
interface TravelRow {
  id: number; employee_id: number; destination: string; purpose: string | null; started_at: string; ended_at: string | null;
  start_lat: number | null; start_lng: number | null; end_lat: number | null; end_lng: number | null; path: string | PathPoint[];
  distance_km: number; duration_minutes: number; status: 'active' | 'completed' | 'cancelled'; notes: string | null; created_at: string;
}

/** Points closer than this to the previous sample are ignored (GPS jitter while standing still). */
export const MIN_SAMPLE_DISTANCE_M = 15;

const settings = () => ({ ...DEFAULT_ATTENDANCE_SETTINGS, ...getSetting('attendance', DEFAULT_ATTENDANCE_SETTINGS) });
function requireEnabled() {
  if (!settings().travel_tracking_enabled) throw forbidden('Travel tracking is disabled by HR (Attendance settings)');
}
function myEmployeeId(req: any): number {
  const eid = req.user?.employee_id;
  if (!eid) throw badRequest('Your login is not linked to an employee record');
  return eid;
}
/** Optional coordinates: both absent → null; otherwise both must be present and in range. */
function readCoords(body: any, required = false): { lat: number; lng: number } | null {
  const lat = toNum(body?.lat), lng = toNum(body?.lng);
  if (lat === undefined && lng === undefined) {
    if (required) throw badRequest('Location (lat, lng) is required');
    return null;
  }
  if (lat === undefined || lng === undefined) throw badRequest('Both lat and lng are required');
  if (lat < -90 || lat > 90) throw badRequest('lat must be between -90 and 90');
  if (lng < -180 || lng > 180) throw badRequest('lng must be between -180 and 180');
  return { lat, lng };
}
function readAccuracy(body: any): number | null {
  const a = toNum(body?.accuracy);
  return a === undefined || a < 0 ? null : Math.round(a);
}
const SELECT = `SELECT t.*, e.first_name || ' ' || e.last_name AS employee_name, e.employee_code, d.name AS department_name
  FROM travel_logs t JOIN employees e ON e.id = t.employee_id LEFT JOIN departments d ON d.id = e.department_id`;
function load(id: number): (TravelRow & { employee_name: string; employee_code: string; department_name: string | null }) | undefined {
  return parseJson(get<any>(`${SELECT} WHERE t.id = ?`, [id]), ['path']);
}
function withPoints<T extends { path: any }>(row: T): T & { points: number } {
  const path = Array.isArray(row.path) ? row.path : [];
  return { ...row, path, points: path.length };
}
/** Sum of Haversine legs along the path, in km. */
function pathDistanceKm(path: PathPoint[]): number {
  let m = 0;
  for (let i = 1; i < path.length; i++) m += distanceMeters(path[i - 1].lat, path[i - 1].lng, path[i].lat, path[i].lng);
  return m / 1000;
}
const minutesBetween = (a: string, b: string) => Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 60000));

/** Employee ids the signed-in user may list: self + reporting chain below them; HR: undefined (all). */
function scopeIds(req: any): number[] | undefined {
  const ids = approvableEmployeeIds(req);
  if (!ids) return undefined;
  const self = req.user?.employee_id;
  return self ? [self, ...ids] : ids;
}

// ---------- My active trip ----------
r.get('/active', requireAuth, (req, res) => {
  const s = settings();
  const eid = req.user!.employee_id;
  const row = eid ? parseJson(get<any>(`${SELECT} WHERE t.employee_id = ? AND t.status = 'active' ORDER BY t.id DESC LIMIT 1`, [eid]), ['path']) : undefined;
  res.json({ trip: row ? withPoints(row) : null, settings: { travel_tracking_enabled: !!s.travel_tracking_enabled, travel_sample_interval_seconds: Number(s.travel_sample_interval_seconds) || 60 } });
});

r.post('/start', requireAuth, wrap(async (req, res) => {
  requireEnabled();
  const eid = myEmployeeId(req);
  requireFields(req.body, ['destination']);
  const destination = String(req.body.destination).trim();
  if (!destination) throw badRequest('Destination is required');
  if (destination.length > 200) throw badRequest('Destination is too long');
  const active = get<any>("SELECT id, destination FROM travel_logs WHERE employee_id = ? AND status = 'active'", [eid]);
  if (active) throw badRequest(`You already have an active trip to ${active.destination}; stop or cancel it first`);
  const coords = readCoords(req.body);
  const now = nowIso();
  const path: PathPoint[] = coords ? [{ ...coords, at: now, acc: readAccuracy(req.body) }] : [];
  const id = insert('travel_logs', {
    employee_id: eid, destination, purpose: req.body.purpose ? String(req.body.purpose).slice(0, 500) : null, started_at: now, ended_at: null,
    start_lat: coords?.lat ?? null, start_lng: coords?.lng ?? null, end_lat: null, end_lng: null, path, distance_km: 0, duration_minutes: 0, status: 'active', notes: null, created_at: now,
  });
  audit(req, 'start', 'travel', id, { destination });
  res.status(201).json(withPoints(load(id)!));
}));

function ownedActive(req: any, id: number) {
  const t = load(id);
  if (!t) throw notFound('Trip not found');
  if (t.employee_id !== req.user.employee_id) throw forbidden('This trip belongs to someone else');
  if (t.status !== 'active') throw badRequest(`Trip is already ${t.status}`);
  return t;
}
/** Append a point when it is at least MIN_SAMPLE_DISTANCE_M from the previous one. Returns the new path and whether it changed. */
function appendPoint(path: PathPoint[], p: PathPoint, force = false): { path: PathPoint[]; added: boolean } {
  const last = path[path.length - 1];
  if (last && !force && distanceMeters(last.lat, last.lng, p.lat, p.lng) < MIN_SAMPLE_DISTANCE_M) return { path, added: false };
  return { path: [...path, p], added: true };
}

r.post('/:id/ping', requireAuth, wrap(async (req, res) => {
  requireEnabled();
  const t = ownedActive(req, toInt(req.params.id)!);
  const coords = readCoords(req.body, true)!;
  const path = Array.isArray(t.path) ? t.path : [];
  const { path: next, added } = appendPoint(path, { ...coords, at: nowIso(), acc: readAccuracy(req.body) });
  if (added) {
    const data: any = { path: next, distance_km: round2(pathDistanceKm(next)) };
    if (t.start_lat == null) { data.start_lat = coords.lat; data.start_lng = coords.lng; }
    update('travel_logs', t.id, data);
  }
  res.json({ ...withPoints(load(t.id)!), added });
}));

r.post('/:id/stop', requireAuth, wrap(async (req, res) => {
  const t = ownedActive(req, toInt(req.params.id)!);
  const coords = readCoords(req.body);
  const now = nowIso();
  let path = Array.isArray(t.path) ? t.path : [];
  if (coords) path = appendPoint(path, { ...coords, at: now, acc: readAccuracy(req.body) }).path;
  const startLat = t.start_lat ?? path[0]?.lat ?? null, startLng = t.start_lng ?? path[0]?.lng ?? null;
  const endLat = coords?.lat ?? path[path.length - 1]?.lat ?? null, endLng = coords?.lng ?? path[path.length - 1]?.lng ?? null;
  let km = pathDistanceKm(path);
  // Straight-line fallback when sampling did not happen (fewer than 2 points) but we know both ends.
  if (path.length < 2 && startLat != null && startLng != null && endLat != null && endLng != null) km = distanceMeters(startLat, startLng, endLat, endLng) / 1000;
  update('travel_logs', t.id, {
    ended_at: now, end_lat: endLat, end_lng: endLng, start_lat: startLat, start_lng: startLng, path, distance_km: round2(km),
    duration_minutes: minutesBetween(t.started_at, now), status: 'completed', notes: req.body?.notes ? String(req.body.notes).slice(0, 1000) : t.notes,
  });
  audit(req, 'stop', 'travel', t.id, { distance_km: round2(km) });
  res.json(withPoints(load(t.id)!));
}));

r.post('/:id/cancel', requireAuth, wrap(async (req, res) => {
  const t = load(toInt(req.params.id)!);
  if (!t) throw notFound('Trip not found');
  if (t.employee_id !== req.user!.employee_id && req.user!.role !== 'hr') throw forbidden();
  if (t.status !== 'active') throw badRequest(`Trip is already ${t.status}`);
  const now = nowIso();
  update('travel_logs', t.id, { status: 'cancelled', ended_at: now, duration_minutes: minutesBetween(t.started_at, now), notes: req.body?.notes ? String(req.body.notes).slice(0, 1000) : t.notes });
  audit(req, 'cancel', 'travel', t.id);
  res.json(withPoints(load(t.id)!));
}));

// ---------- Lists ----------
r.get('/', requireAuth, (req, res) => {
  const where: string[] = [];
  const params: any[] = [];
  const ids = scopeIds(req);
  if (ids) {
    if (!ids.length) return res.json([]);
    where.push(`t.employee_id IN (${ids.map(() => '?').join(',')})`);
    params.push(...ids);
  }
  if (req.query.employee_id) { where.push('t.employee_id = ?'); params.push(toInt(req.query.employee_id)); }
  if (req.query.status) { where.push('t.status = ?'); params.push(String(req.query.status)); }
  if (req.query.from) { where.push('substr(t.started_at,1,10) >= ?'); params.push(String(req.query.from)); }
  if (req.query.to) { where.push('substr(t.started_at,1,10) <= ?'); params.push(String(req.query.to)); }
  const rows = all<any>(`${SELECT}${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY t.started_at DESC LIMIT 1000`, params);
  // Lists do not carry the sampled path (it can be large); GET /:id returns it.
  res.json(rows.map((row) => { const p = withPoints(parseJson(row, ['path'])!); const { path: _path, ...rest } = p; return rest; }));
});

/** Per-employee totals for a month (YYYY-MM): km, trips and minutes. Managers see their chain; HR everyone. */
r.get('/summary', requireRole('manager'), (req, res) => {
  const period = String(req.query.period || today().slice(0, 7));
  if (!/^\d{4}-\d{2}$/.test(period)) throw badRequest('period must be YYYY-MM');
  const ids = scopeIds(req);
  if (ids && !ids.length) return res.json({ period, rows: [], totals: { km: 0, trips: 0, minutes: 0 } });
  const scope = ids ? ` AND t.employee_id IN (${ids.map(() => '?').join(',')})` : '';
  const rows = all<any>(
    `SELECT t.employee_id, e.first_name || ' ' || e.last_name AS employee_name, e.employee_code, d.name AS department_name,
            COUNT(*) AS trips, ROUND(SUM(t.distance_km), 2) AS km, SUM(t.duration_minutes) AS minutes
     FROM travel_logs t JOIN employees e ON e.id = t.employee_id LEFT JOIN departments d ON d.id = e.department_id
     WHERE t.status = 'completed' AND substr(t.started_at,1,7) = ?${scope}
     GROUP BY t.employee_id ORDER BY km DESC, employee_name`, [period, ...(ids ?? [])]);
  const totals = rows.reduce((s, x) => ({ km: round2(s.km + (x.km || 0)), trips: s.trips + x.trips, minutes: s.minutes + (x.minutes || 0) }), { km: 0, trips: 0, minutes: 0 });
  res.json({ period, rows, totals });
});

r.get('/:id', requireAuth, (req, res) => {
  const t = load(toInt(req.params.id)!);
  if (!t) throw notFound('Trip not found');
  const ids = scopeIds(req);
  if (ids && !ids.includes(t.employee_id)) throw forbidden();
  res.json(withPoints(t));
});

r.delete('/:id', requireHr, (req, res) => {
  const id = toInt(req.params.id)!;
  if (!run('DELETE FROM travel_logs WHERE id = ?', [id]).changes) throw notFound('Trip not found');
  audit(req, 'delete', 'travel', id);
  res.json({ ok: true });
});

export default r;
