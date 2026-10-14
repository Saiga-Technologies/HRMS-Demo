import { useCallback, useEffect, useState } from 'react';

/* ---------- Types mirrored from server/src/schema.ts ---------- */
export interface WorkLocation { id: number; name: string; address?: string | null; lat: number; lng: number; radius_m: number; active: number }
export interface Shift { id: number; name: string; start_time: string; end_time: string; grace_minutes: number; break_minutes_allowed: number; half_day_minutes: number; full_day_minutes: number; working_days: number[]; active: number }
export interface Holiday { id: number; name: string; date: string; optional: number }
export interface Break { id: number; attendance_id: number; type: string; start_at: string; end_at: string | null; minutes: number; note?: string | null }
export interface AttendanceRecord {
  id: number; employee_id: number; date: string;
  punch_in_at: string | null; punch_in_lat: number | null; punch_in_lng: number | null; punch_in_location_id: number | null; punch_in_within_fence: number | null; punch_in_distance_m: number | null;
  punch_out_at: string | null; punch_out_lat: number | null; punch_out_lng: number | null; punch_out_location_id: number | null; punch_out_within_fence: number | null; punch_out_distance_m: number | null;
  status: string; work_minutes: number; break_minutes: number; overtime_minutes: number; late_minutes: number; source: string; notes?: string | null;
  corrected_by?: number | null; corrected_at?: string | null; created_at: string; updated_at: string;
  employee_name?: string; employee_code?: string; department_name?: string | null; punch_in_location_name?: string | null; punch_out_location_name?: string | null;
  breaks?: Break[]; break_limit_exceeded?: boolean;
}
export interface AttendanceSettings { require_geofence: boolean; allow_remote_punch: boolean; max_break_minutes: number; auto_punch_out_hours: number; late_mark_after_minutes: number; half_day_below_minutes: number; overtime_after_minutes: number; weekly_offs: number[] }
export interface Correction { id: number; employee_id: number; date: string; requested_punch_in: string | null; requested_punch_out: string | null; requested_status: string | null; reason: string; status: 'pending' | 'approved' | 'rejected'; requested_by?: number | null; reviewed_by?: number | null; reviewed_at?: string | null; review_note?: string | null; created_at: string; employee_name?: string; employee_code?: string; reviewer_email?: string | null }
export interface DirectoryEmployee { id: number; employee_code: string; first_name: string; last_name: string; email?: string; department_id?: number | null; department_name?: string | null; position_title?: string | null; manager_id?: number | null; status?: string }
export interface TodayResponse { date: string; record: AttendanceRecord | null; settings: AttendanceSettings; shift: Shift | null; locations: WorkLocation[] }

export const ATTENDANCE_STATUSES = ['present', 'half_day', 'absent', 'leave', 'holiday', 'weekend', 'wfh'];
export const BREAK_TYPES = ['break', 'lunch', 'personal'];
export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/* ---------- Geo helpers ---------- */
/** Haversine distance in metres (same formula as the server). */
export function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
export function fmtDistance(m?: number | null): string {
  if (m === undefined || m === null || Number.isNaN(m)) return '—';
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}
export interface NearestFence { location: WorkLocation; distance: number; within: boolean }
/** Pick the office whose fence we are closest to (by distance beyond the radius), as the server does. */
export function nearestLocation(lat: number, lng: number, locations: WorkLocation[]): NearestFence | null {
  let best: NearestFence | null = null;
  for (const l of locations) {
    const d = distanceMeters(lat, lng, l.lat, l.lng);
    if (!best || d - l.radius_m < best.distance - best.location.radius_m) best = { location: l, distance: d, within: d <= l.radius_m };
  }
  return best;
}

export interface GeoFix { lat: number; lng: number; accuracy: number; at: number }
/** Browser geolocation with a friendly error message. `locate()` always resolves (null when unavailable). */
export function useGeo(auto = true) {
  const [fix, setFix] = useState<GeoFix | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const locate = useCallback(
    () =>
      new Promise<GeoFix | null>((resolve) => {
        if (typeof navigator === 'undefined' || !navigator.geolocation) {
          setError('This browser does not support location.');
          resolve(null);
          return;
        }
        setBusy(true);
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const f: GeoFix = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: Math.round(pos.coords.accuracy), at: Date.now() };
            setFix(f);
            setError(null);
            setBusy(false);
            resolve(f);
          },
          (err) => {
            const msg = err.code === 1
              ? 'Location access was denied. Allow location for this site in your browser settings and try again.'
              : err.code === 3
                ? 'Timed out while waiting for a location fix. Move somewhere with a clearer signal and retry.'
                : 'Your location is currently unavailable.';
            setError(msg);
            setBusy(false);
            resolve(null);
          },
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
        );
      }),
    [],
  );
  useEffect(() => {
    if (auto) locate();
  }, [auto, locate]);
  return { fix, error, busy, locate };
}

/** Ticking clock. */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/* ---------- Date helpers ---------- */
export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function daysAgoIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return isoDate(d);
}
export function minutesBetween(a: string, b: number | string): number {
  const end = typeof b === 'number' ? b : Date.parse(b);
  return Math.max(0, Math.floor((end - Date.parse(a)) / 60000));
}
export function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}
export function employeeLabel(e: { first_name?: string; last_name?: string; employee_code?: string }): string {
  return `${[e.first_name, e.last_name].filter(Boolean).join(' ')}${e.employee_code ? ` (${e.employee_code})` : ''}`;
}
