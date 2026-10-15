import { Router } from 'express';
import { get, run, insert, update, parseJson, agency, companyDb, DEFAULT_COMPANY_SLUG } from '../db.js';
import { runAsTenant } from '../context.js';
import { companyBySlug } from '../tenancy.js';
import { agencyBranding } from './settings.js';
import {
  verifyPassword, hashPassword, createSession, destroySession, cookieHeader, clearCookieHeader,
  loginRateLimit, resetLoginRateLimit, requireAuth, createAgencySession, type AgencyUser,
} from '../auth.js';
import { wrap, badRequest, HttpError, nowIso, audit } from '../util.js';

const r = Router();

function profile(userId: number) {
  const u = get<any>(
    `SELECT u.id, u.email, u.role, u.employee_id, u.must_change_password, u.last_login_at,
            e.first_name, e.last_name, e.employee_code, e.photo_path, e.department_id, e.position_id,
            d.name AS department_name, p.title AS position_title
     FROM users u LEFT JOIN employees e ON e.id = u.employee_id
     LEFT JOIN departments d ON d.id = e.department_id
     LEFT JOIN positions p ON p.id = e.position_id
     WHERE u.id = ?`,
    [userId],
  );
  return u;
}

function companyInfo(slug: string) {
  const c = agency.get<any>('SELECT slug, name, country_code, currency, timezone, logo_text, brand_color FROM companies WHERE slug = ?', [slug]);
  return c || { slug, name: null };
}
function agencyProfile(a: AgencyUser) {
  return { id: a.id, email: a.email, first_name: a.first_name, last_name: a.last_name, role: a.role };
}

/**
 * One sign-in for everyone: agency staff are checked first, then company logins. The login
 * directory (agency DB) says which company an email belongs to.
 */
r.post('/login', wrap(async (req, res) => {
  const { email, password } = req.body || {};
  if (typeof email !== 'string' || typeof password !== 'string') throw badRequest('email and password are required');
  const key = `${req.ip}:${email.toLowerCase()}`;
  if (!loginRateLimit(key)) throw new HttpError(429, 'Too many login attempts. Try again in 15 minutes.');
  const em = email.trim();

  const a = agency.get<any>('SELECT * FROM agency_users WHERE email = ? AND active = 1', [em]);
  if (a) {
    if (!verifyPassword(password, a.password_hash)) throw new HttpError(401, 'Invalid email or password');
    resetLoginRateLimit(key);
    const token = createAgencySession(a.id);
    res.setHeader('Set-Cookie', cookieHeader(token, req.secure));
    return res.json({ kind: 'agency', user: { ...agencyProfile(a), role: 'hr', employee_id: null, must_change_password: 0 }, agency: agencyProfile(a), company: null, token });
  }

  const lookup = () => agency.all<any>('SELECT company_slug FROM login_directory WHERE email = ?', [em]).map((r) => r.company_slug as string);
  let slugs = lookup();
  if (!slugs.length) {
    // Demo companies are seeded lazily; open them all once so their logins are registered.
    for (const c of agency.all<any>('SELECT slug FROM companies')) companyDb(c.slug);
    slugs = lookup();
  }
  if (!slugs.includes(DEFAULT_COMPANY_SLUG)) slugs.push(DEFAULT_COMPANY_SLUG);
  for (const slug of slugs) {
    const c = companyBySlug(slug);
    if (!c && slug !== DEFAULT_COMPANY_SLUG) continue;
    if (c && c.status === 'offboarded') continue;
    const out = runAsTenant({ slug, timezone: c?.timezone || 'Asia/Kolkata' }, () => {
      const user = get<any>('SELECT * FROM users WHERE email = ? AND active = 1 AND agency_user_id IS NULL', [em]);
      if (!user || !verifyPassword(password, user.password_hash)) return null;
      return { token: createSession(user.id, req.headers['user-agent']), user: profile(user.id) };
    });
    if (out) {
      resetLoginRateLimit(key);
      res.setHeader('Set-Cookie', cookieHeader(out.token, req.secure));
      return res.json({ kind: 'company', user: out.user, company: companyInfo(slug), token: out.token });
    }
  }
  throw new HttpError(401, 'Invalid email or password');
}));

r.post('/logout', (req, res) => {
  if (req.sessionToken) destroySession(req.sessionToken);
  res.setHeader('Set-Cookie', clearCookieHeader());
  res.json({ ok: true });
});

/** Sign-in page branding: the agency (everyone signs in through the agency's portal). */
r.get('/branding', (_req, res) => res.json(agencyBranding()));

/** Who am I: company login, agency staff at agency level, or agency staff inside a company. */
r.get('/me', (req, res) => {
  const a = req.agencyUser;
  if (a && !req.companySlug) {
    return res.json({ kind: 'agency', user: { ...agencyProfile(a), role: 'hr', employee_id: null, must_change_password: 0 }, agency: agencyProfile(a), company: null });
  }
  if (!req.user) throw new HttpError(401, 'Authentication required');
  const p = profile(req.user.id);
  if (a) {
    return res.json({ kind: 'agency', user: { ...p, first_name: a.first_name, last_name: a.last_name, email: a.email }, agency: agencyProfile(a), company: companyInfo(req.companySlug!) });
  }
  res.json({ kind: 'company', user: p, company: companyInfo(req.companySlug || DEFAULT_COMPANY_SLUG) });
});

r.post('/change-password', requireAuth, wrap(async (req, res) => {
  const { current_password, new_password } = req.body || {};
  if (typeof new_password !== 'string' || new_password.length < 8) throw badRequest('New password must be at least 8 characters');
  if (req.agencyUser) throw badRequest('Agency staff change their password from the agency portal');
  const user = get<any>('SELECT * FROM users WHERE id = ?', [req.user!.id]);
  if (!user || !verifyPassword(String(current_password ?? ''), user.password_hash)) throw badRequest('Current password is incorrect');
  update('users', user.id, { password_hash: hashPassword(new_password), must_change_password: 0 });
  audit(req, 'change_password', 'user', user.id);
  res.json({ ok: true });
}));

export default r;
