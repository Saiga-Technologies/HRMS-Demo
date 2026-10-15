import { currentTenant } from './context.js';
import type { Request, Response, NextFunction } from 'express';
import { insert } from './db.js';

export class HttpError extends Error {
  status: number;
  details?: any;
  constructor(status: number, message: string, details?: any) {
    super(message);
    this.status = status;
    this.details = details;
  }
}
export const badRequest = (m: string, d?: any) => new HttpError(400, m, d);
export const notFound = (m = 'Not found') => new HttpError(404, m);
export const forbidden = (m = 'Forbidden') => new HttpError(403, m);

export const nowIso = () => new Date().toISOString();
/** UTC offset (minutes) of an IANA time zone at `at` — handles daylight saving (US companies). */
export function zoneOffsetMinutes(timeZone: string, at = new Date()): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(at);
    const v = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    const asUtc = Date.UTC(v('year'), v('month') - 1, v('day'), v('hour'), v('minute'), v('second'));
    return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000);
  } catch {
    return 330;
  }
}
/**
 * Current company's offset from UTC in minutes. Follows the company's time zone (agency mode: each
 * client company has its own); HRMS_TZ_OFFSET_MINUTES overrides it, and IST (+330) is the fallback.
 */
export function tzOffsetMinutes() {
  const v = Number(process.env.HRMS_TZ_OFFSET_MINUTES);
  if (process.env.HRMS_TZ_OFFSET_MINUTES !== undefined && Number.isFinite(v)) return v;
  const tz = currentTenant()?.timezone;
  return tz ? zoneOffsetMinutes(tz) : 330;
}
/** Today's date in the company's time zone (not UTC: just after midnight IST, UTC is still yesterday). */
export const today = () => new Date(Date.now() + tzOffsetMinutes() * 60000).toISOString().slice(0, 10);

/** Wrap async route handlers so rejections reach the error middleware. */
export const wrap =
  (fn: (req: Request, res: Response, next: NextFunction) => any) =>
  (req: Request, res: Response, next: NextFunction) =>
    Promise.resolve(fn(req, res, next)).catch(next);

/** Pick only allowed keys from a body; undefined keys are dropped. */
export function pick<T extends Record<string, any>>(body: any, keys: string[]): Partial<T> {
  const out: Record<string, any> = {};
  if (!body || typeof body !== 'object') return out as Partial<T>;
  for (const k of keys) if (body[k] !== undefined) out[k] = body[k];
  return out as Partial<T>;
}

export function requireFields(body: any, fields: string[]) {
  const missing = fields.filter((f) => body?.[f] === undefined || body?.[f] === null || body?.[f] === '');
  if (missing.length) throw badRequest(`Missing required field(s): ${missing.join(', ')}`, { missing });
}

export function toInt(v: any, fallback?: number): number | undefined {
  if (v === undefined || v === null || v === '') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}
export function toNum(v: any, fallback?: number): number | undefined {
  if (v === undefined || v === null || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
export function isIsoDate(v: any): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
}
export function assertDate(v: any, name: string) {
  if (v !== undefined && v !== null && v !== '' && !isIsoDate(v)) throw badRequest(`${name} must be YYYY-MM-DD`);
}

export function audit(req: Request, action: string, entity: string, entityId: any, details?: any) {
  try {
    insert('audit_log', {
      user_id: req.user?.id ?? null,
      action,
      entity,
      entity_id: entityId == null ? null : String(entityId),
      details: details ? JSON.stringify(details) : null,
      created_at: nowIso(),
    });
  } catch {
    /* auditing must never break a request */
  }
}

/** Days between two YYYY-MM-DD dates (inclusive of both ends). */
export function daysInclusive(start: string, end: string): number {
  const a = Date.parse(start + 'T00:00:00Z');
  const b = Date.parse(end + 'T00:00:00Z');
  return Math.floor((b - a) / 86400000) + 1;
}
export function addDays(date: string, n: number): string {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** Iterate dates from start to end inclusive. */
export function eachDay(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Haversine distance in metres. */
export function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export const round2 = (n: number) => Math.round(n * 100) / 100;
