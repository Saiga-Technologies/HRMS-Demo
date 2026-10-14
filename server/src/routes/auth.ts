import { Router } from 'express';
import { get, run, insert, update, parseJson } from '../db.js';
import {
  verifyPassword, hashPassword, createSession, destroySession, cookieHeader, clearCookieHeader,
  loginRateLimit, resetLoginRateLimit, requireAuth,
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

r.post('/login', wrap(async (req, res) => {
  const { email, password } = req.body || {};
  if (typeof email !== 'string' || typeof password !== 'string') throw badRequest('email and password are required');
  const key = `${req.ip}:${email.toLowerCase()}`;
  if (!loginRateLimit(key)) throw new HttpError(429, 'Too many login attempts. Try again in 15 minutes.');
  const user = get<any>('SELECT * FROM users WHERE email = ? AND active = 1', [email.trim()]);
  if (!user || !verifyPassword(password, user.password_hash)) throw new HttpError(401, 'Invalid email or password');
  resetLoginRateLimit(key);
  const token = createSession(user.id, req.headers['user-agent']);
  res.setHeader('Set-Cookie', cookieHeader(token, req.secure));
  res.json({ user: profile(user.id), token });
}));

r.post('/logout', (req, res) => {
  if (req.sessionToken) destroySession(req.sessionToken);
  res.setHeader('Set-Cookie', clearCookieHeader());
  res.json({ ok: true });
});

r.get('/me', requireAuth, (req, res) => {
  res.json({ user: profile(req.user!.id) });
});

r.post('/change-password', requireAuth, wrap(async (req, res) => {
  const { current_password, new_password } = req.body || {};
  if (typeof new_password !== 'string' || new_password.length < 8) throw badRequest('New password must be at least 8 characters');
  const user = get<any>('SELECT * FROM users WHERE id = ?', [req.user!.id]);
  if (!user || !verifyPassword(String(current_password ?? ''), user.password_hash)) throw badRequest('Current password is incorrect');
  update('users', user.id, { password_hash: hashPassword(new_password), must_change_password: 0 });
  audit(req, 'change_password', 'user', user.id);
  res.json({ ok: true });
}));

export default r;
