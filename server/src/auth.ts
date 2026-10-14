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

/**
 * Session storage mode.
 *  - Default: sessions are rows in the `sessions` table (revocable, listable).
 *  - Stateless: the token itself is a signed payload (HMAC-SHA256) so it is valid on every server
 *    instance. Used on serverless hosts such as Vercel, where each instance has its own /tmp
 *    database and a DB-backed session created on one instance would be unknown to the next.
 */
export function statelessSessions(): boolean {
  return process.env.HRMS_STATELESS_SESSIONS === '1' || (!!process.env.VERCEL && process.env.HRMS_STATELESS_SESSIONS !== '0');
}
let processSecret: string | null = null;
export function sessionSecret(): string {
  if (process.env.HRMS_SESSION_SECRET) return process.env.HRMS_SESSION_SECRET;
  // Serverless fallback: derive a secret that is identical on every instance of the same deployment.
  if (process.env.VERCEL && (process.env.VERCEL_DEPLOYMENT_ID || process.env.VERCEL_PROJECT_ID)) {
    return crypto.createHash('sha256').update(`hrms|${process.env.VERCEL_PROJECT_ID || ''}|${process.env.VERCEL_DEPLOYMENT_ID || ''}|${process.env.VERCEL_GIT_COMMIT_SHA || ''}`).digest('hex');
  }
  if (!processSecret) processSecret = crypto.randomBytes(32).toString('hex');
  return processSecret;
}
const b64u = (s: string | Buffer) => Buffer.from(s).toString('base64url');
function sign(payload: string) {
  return crypto.createHmac('sha256', sessionSecret()).update(payload).digest('base64url');
}
function makeStatelessToken(user: { id: number; role: string; employee_id: number | null }): string {
  const payload = b64u(JSON.stringify({ u: user.id, r: user.role, e: user.employee_id, x: Date.now() + SESSION_TTL_MS }));
  return `${payload}.${sign(payload)}`;
}
function readStatelessToken(token: string): { u: number; r: Role; e: number | null; x: number } | null {
  const i = token.indexOf('.');
  if (i < 0) return null;
  const payload = token.slice(0, i);
  const sig = token.slice(i + 1);
  const expected = sign(payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof data.u !== 'number' || typeof data.x !== 'number' || data.x < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

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
  run('UPDATE users SET last_login_at = ? WHERE id = ?', [nowIso(), userId]);
  if (statelessSessions()) {
    const u = get<any>('SELECT id, role, employee_id FROM users WHERE id = ?', [userId])!;
    return makeStatelessToken(u);
  }
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  insert('sessions', {
    token,
    user_id: userId,
    created_at: new Date(now).toISOString(),
    expires_at: new Date(now + SESSION_TTL_MS).toISOString(),
    user_agent: userAgent?.slice(0, 200) ?? null,
  });
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
  if (token.includes('.')) {
    const data = readStatelessToken(token);
    if (data) {
      // Prefer the live user row when this instance has it (picks up role changes / deactivation);
      // otherwise trust the signed payload so the session survives instance switches.
      const u = get<any>('SELECT id, email, role, employee_id, must_change_password, active FROM users WHERE id = ?', [data.u]);
      if (u && !u.active) return next();
      req.user = u
        ? { id: u.id, email: u.email, role: u.role, employee_id: u.employee_id, must_change_password: u.must_change_password }
        : { id: data.u, email: '', role: data.r, employee_id: data.e, must_change_password: 0 };
      req.sessionToken = token;
    }
    return next();
  }
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
