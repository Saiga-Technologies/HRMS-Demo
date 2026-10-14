import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { get, run, insert, all } from './db.js';
import { HttpError, nowIso } from './util.js';

export type Role = 'hr' | 'manager' | 'employee';
export interface AuthUser {
  id: number;
  email: string;
  role: Role;
  employee_id: number | null;
  must_change_password: number;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      sessionToken?: string;
    }
  }
}

export const SESSION_COOKIE = 'hrms_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12h

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}
export function verifyPassword(password: string, stored: string): boolean {
  const [algo, salt, hash] = stored.split('$');
  if (algo !== 'scrypt' || !salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

export function createSession(userId: number, userAgent?: string): string {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  insert('sessions', {
    token,
    user_id: userId,
    created_at: new Date(now).toISOString(),
    expires_at: new Date(now + SESSION_TTL_MS).toISOString(),
    user_agent: userAgent?.slice(0, 200) ?? null,
  });
  run('UPDATE users SET last_login_at = ? WHERE id = ?', [nowIso(), userId]);
  return token;
}
export function destroySession(token: string) {
  run('DELETE FROM sessions WHERE token = ?', [token]);
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** Attach req.user when a valid session cookie or bearer token is present. */
export function attachUser(req: Request, _res: Response, next: NextFunction) {
  const bearer = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : undefined;
  const token = bearer || parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!token) return next();
  const row = get<any>(
    `SELECT u.id, u.email, u.role, u.employee_id, u.must_change_password, s.expires_at
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ? AND u.active = 1`,
    [token],
  );
  if (row && row.expires_at > nowIso()) {
    req.user = { id: row.id, email: row.email, role: row.role, employee_id: row.employee_id, must_change_password: row.must_change_password };
    req.sessionToken = token;
  } else if (row) {
    destroySession(token);
  }
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new HttpError(401, 'Authentication required'));
  next();
}

/** Allow only the listed roles. HR is always allowed. */
export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new HttpError(401, 'Authentication required'));
    if (req.user.role === 'hr' || roles.includes(req.user.role)) return next();
    next(new HttpError(403, 'Insufficient permissions'));
  };
}
export const requireHr = requireRole('hr');

export function isHr(req: Request) {
  return req.user?.role === 'hr';
}
/** True when the user is HR, or the record belongs to their own employee, or they manage that employee. */
export function canAccessEmployee(req: Request, employeeId: number): boolean {
  if (!req.user) return false;
  if (req.user.role === 'hr') return true;
  if (req.user.employee_id === employeeId) return true;
  if (req.user.role === 'manager' && req.user.employee_id) {
    const row = get('SELECT 1 FROM employees WHERE id = ? AND manager_id = ?', [employeeId, req.user.employee_id]);
    return !!row;
  }
  return false;
}
/** Employee ids a manager can see (self + direct reports). Just self for employees; undefined (no filter) for HR. */
export function visibleEmployeeIds(req: Request): number[] | undefined {
  if (!req.user) return [];
  if (req.user.role === 'hr') return undefined;
  const ids = req.user.employee_id ? [req.user.employee_id] : [];
  if (req.user.role === 'manager' && req.user.employee_id) {
    const reports = all<{ id: number }>('SELECT id FROM employees WHERE manager_id = ?', [req.user.employee_id]);
    ids.push(...reports.map((r) => r.id));
  }
  return ids;
}

export function cookieHeader(token: string, secure: boolean) {
  const parts = [`${SESSION_COOKIE}=${encodeURIComponent(token)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${SESSION_TTL_MS / 1000}`];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}
export function clearCookieHeader() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/** Very small in-memory login rate limiter: 10 attempts / 15 minutes per key. */
const attempts = new Map<string, { n: number; reset: number }>();
export function loginRateLimit(key: string): boolean {
  const now = Date.now();
  const e = attempts.get(key);
  if (!e || e.reset < now) {
    attempts.set(key, { n: 1, reset: now + 15 * 60 * 1000 });
    return true;
  }
  e.n += 1;
  return e.n <= 10;
}
export function resetLoginRateLimit(key: string) {
  attempts.delete(key);
}
