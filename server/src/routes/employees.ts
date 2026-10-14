import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { all, get, insert, update, run, getSetting, parseJson, parseJsonAll, transaction } from '../db.js';
import { UPLOAD_DIR } from '../db.js';
import { requireAuth, requireHr, canAccessEmployee, visibleEmployeeIds, hashPassword } from '../auth.js';
import { wrap, badRequest, notFound, forbidden, pick, requireFields, audit, toInt, nowIso, assertDate, today } from '../util.js';
import { DEFAULT_COMPANY } from './settings.js';
import { documentStatus } from './documents.js';

const r = Router();

export const EMP_COLS = [
  'employee_code', 'first_name', 'last_name', 'email', 'phone', 'dob', 'gender', 'marital_status', 'nationality',
  'address', 'city', 'country', 'department_id', 'position_id', 'manager_id', 'work_location_id', 'shift_id', 'vacancy_id',
  'join_date', 'confirmation_date', 'exit_date', 'employment_type', 'status', 'emergency_contact_name', 'emergency_contact_phone',
  'bank_name', 'bank_account_name', 'bank_account_number', 'bank_ifsc', 'tax_id', 'pf_number', 'custom_fields', 'notes',
];
const SENSITIVE = ['bank_account_number', 'bank_ifsc', 'tax_id', 'pf_number', 'bank_name', 'bank_account_name'];

export const empQuery = `
  SELECT e.*, d.name AS department_name, d.color AS department_color, d.icon AS department_icon, p.title AS position_title,
         m.first_name || ' ' || m.last_name AS manager_name, wl.name AS work_location_name, s.name AS shift_name, v.title AS vacancy_title,
         (SELECT COUNT(*) FROM employees x WHERE x.manager_id = e.id AND x.status != 'exited') AS direct_reports
  FROM employees e
  LEFT JOIN vacancies v ON v.id = e.vacancy_id
  LEFT JOIN departments d ON d.id = e.department_id
  LEFT JOIN positions p ON p.id = e.position_id
  LEFT JOIN employees m ON m.id = e.manager_id
  LEFT JOIN work_locations wl ON wl.id = e.work_location_id
  LEFT JOIN shifts s ON s.id = e.shift_id`;

function sanitize(row: any, req: any) {
  if (!row) return row;
  parseJson(row, ['custom_fields']);
  const self = req.user?.employee_id === row.id;
  if (req.user?.role !== 'hr' && !self) for (const k of SENSITIVE) delete row[k];
  return row;
}

export function nextEmployeeCode(): string {
  const prefix = getSetting('company', DEFAULT_COMPANY).employee_code_prefix || 'EMP';
  const row = get<any>(`SELECT employee_code FROM employees WHERE employee_code LIKE ? ORDER BY CAST(SUBSTR(employee_code, ?) AS INTEGER) DESC LIMIT 1`, [`${prefix}%`, prefix.length + 1]);
  const n = row ? Number(row.employee_code.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(Number.isFinite(n) ? n : 1).padStart(4, '0')}`;
}

function validateCustomFields(cf: any) {
  if (cf === undefined) return undefined;
  if (cf === null) return {};
  if (typeof cf === 'string') {
    try { cf = JSON.parse(cf); } catch { throw badRequest('custom_fields must be an object'); }
  }
  if (typeof cf !== 'object' || Array.isArray(cf)) throw badRequest('custom_fields must be an object');
  const defs = all<any>("SELECT * FROM custom_field_defs WHERE entity = 'employee' AND active = 1");
  for (const d of defs) {
    const v = cf[d.key];
    if (d.required && (v === undefined || v === null || v === '')) throw badRequest(`Custom field "${d.label}" is required`);
    if (v === undefined || v === null || v === '') continue;
    if (d.type === 'number' && !Number.isFinite(Number(v))) throw badRequest(`"${d.label}" must be a number`);
    if (d.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(String(v))) throw badRequest(`"${d.label}" must be YYYY-MM-DD`);
    if (d.type === 'select') {
      const opts = JSON.parse(d.options || '[]');
      if (opts.length && !opts.includes(v)) throw badRequest(`"${d.label}" must be one of ${opts.join(', ')}`);
    }
  }
  return cf;
}

r.get('/', requireAuth, (req, res) => {
  const where: string[] = [];
  const params: any[] = [];
  const vis = visibleEmployeeIds(req);
  if (vis) {
    if (!vis.length) return res.json({ items: [], total: 0 });
    where.push(`e.id IN (${vis.map(() => '?').join(',')})`);
    params.push(...vis);
  }
  const q = String(req.query.q || '').trim();
  if (q) {
    where.push('(e.first_name LIKE ? OR e.last_name LIKE ? OR e.email LIKE ? OR e.employee_code LIKE ? OR p.title LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  for (const f of ['department_id', 'position_id', 'manager_id', 'status', 'employment_type', 'work_location_id']) {
    if (req.query[f]) { where.push(`e.${f} = ?`); params.push(req.query[f]); }
  }
  if (!req.query.status && req.query.include_exited !== '1') where.push("e.status != 'exited'");
  const sql = `${empQuery}${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY e.first_name, e.last_name`;
  const rows = all(sql, params).map((x) => sanitize(x, req));
  res.json({ items: rows, total: rows.length });
});

r.get('/next-code', requireHr, (_req, res) => res.json({ employee_code: nextEmployeeCode() }));

r.get('/:id', requireAuth, (req, res) => {
  const id = toInt(req.params.id)!;
  if (!canAccessEmployee(req, id)) throw forbidden();
  const row = get(`${empQuery} WHERE e.id = ?`, [id]);
  if (!row) throw notFound('Employee not found');
  const docs = parseJsonAll(all<any>(
    `SELECT d.*, t.name AS type_name, t.expiry_warning_days, t.expiry_critical_days FROM documents d LEFT JOIN document_types t ON t.id = d.document_type_id WHERE d.employee_id = ? ORDER BY d.created_at DESC`, [id]), []);
  docs.forEach((d: any) => Object.assign(d, documentStatus(d)));
  const user = get('SELECT id, email, role, active FROM users WHERE employee_id = ?', [id]);
  res.json({ ...sanitize(row, req), documents: docs, user: user ?? null });
});

/** Readable one-off password for auto-created logins, e.g. "Welcome-7f3a!". */
export function generateTempPassword(): string {
  return `Welcome-${crypto.randomBytes(2).toString('hex')}!`;
}

export interface CreateEmployeeOptions { create_login?: boolean; login_role?: string; login_password?: string }
export interface CreateEmployeeResult { id: number; employee_code: string; temporary_password?: string }

/**
 * Insert an employee plus (optionally) their login, the journey stages from the active templates and
 * this year's leave balances. Runs inside the caller's transaction (no BEGIN/COMMIT here) so other
 * flows — e.g. hiring a candidate — can add their own writes atomically. Use `createEmployee` for the
 * self-contained version.
 */
export function createEmployeeRecord(body: any, opts: CreateEmployeeOptions = {}): CreateEmployeeResult {
  requireFields(body, ['first_name', 'email']);
  const data: any = pick(body, [...EMP_COLS, 'candidate_id']);
  for (const d of ['dob', 'join_date', 'confirmation_date', 'exit_date']) assertDate(data[d], d);
  data.custom_fields = validateCustomFields(data.custom_fields ?? {}) ?? {};
  if (!data.employee_code) data.employee_code = nextEmployeeCode();
  data.email = String(data.email).trim();
  if (!data.join_date) data.join_date = today();
  if (data.last_name === undefined || data.last_name === null) data.last_name = '';
  const eid = insert('employees', { ...data, created_at: nowIso(), updated_at: nowIso() });
  let temporary_password: string | undefined;
  // Optional login creation ("user ID"): the employee's email is the user ID; the password is generated when not supplied.
  if (opts.create_login) {
    temporary_password = String(opts.login_password || generateTempPassword());
    insert('users', { email: data.email, password_hash: hashPassword(temporary_password), role: opts.login_role === 'manager' ? 'manager' : 'employee', employee_id: eid, active: 1, must_change_password: 1, created_at: nowIso() });
  }
  // Seed journey stages from the active templates so the timeline exists from day one.
  const templates = all<any>('SELECT * FROM journey_stage_templates WHERE active = 1 ORDER BY sort_order');
  templates.forEach((t, i) => insert('journey_stages', {
    employee_id: eid, template_id: t.id, name: t.name, description: t.description, sort_order: i, color: t.color, icon: t.icon,
    status: 'pending', owner: t.owner_role, checklist: '[]', created_at: nowIso(), updated_at: nowIso(),
  }));
  // Leave balances for the current year.
  const year = new Date().getFullYear();
  for (const lt of all<any>('SELECT * FROM leave_types WHERE active = 1')) {
    insert('leave_balances', { employee_id: eid, leave_type_id: lt.id, year, allocated: lt.annual_quota, carried: 0, adjusted: 0, used: 0 });
  }
  return { id: eid, employee_code: data.employee_code, temporary_password };
}

/** Transactional create used by POST /api/employees (and reusable by other routers). */
export function createEmployee(req: any, body: any, opts: CreateEmployeeOptions = {}): CreateEmployeeResult {
  const result = transaction(() => createEmployeeRecord(body, opts));
  audit(req, 'create', 'employee', result.id, { employee_code: result.employee_code });
  return result;
}

r.post('/', requireHr, wrap(async (req, res) => {
  const created = createEmployee(req, req.body, { create_login: !!req.body.create_login, login_role: req.body.login_role, login_password: req.body.login_password });
  const out: any = sanitize(get(`${empQuery} WHERE e.id = ?`, [created.id]), req);
  if (created.temporary_password) out.temporary_password = created.temporary_password;
  res.status(201).json(out);
}));

r.put('/:id', requireAuth, wrap(async (req, res) => {
  const id = toInt(req.params.id)!;
  const existing = get<any>('SELECT * FROM employees WHERE id = ?', [id]);
  if (!existing) throw notFound('Employee not found');
  const self = req.user!.employee_id === id;
  if (req.user!.role !== 'hr' && !self) throw forbidden();
  // Employees may only edit their own contact details.
  const allowed = req.user!.role === 'hr' ? EMP_COLS : ['phone', 'address', 'city', 'country', 'emergency_contact_name', 'emergency_contact_phone', 'marital_status', 'nationality'];
  const data: any = pick(req.body, allowed);
  for (const d of ['dob', 'join_date', 'confirmation_date', 'exit_date']) assertDate(data[d], d);
  if (data.custom_fields !== undefined) data.custom_fields = validateCustomFields(data.custom_fields);
  if (data.manager_id !== undefined && Number(data.manager_id) === id) throw badRequest('An employee cannot be their own manager');
  if (data.status === 'exited' && !data.exit_date && !existing.exit_date) data.exit_date = today();
  update('employees', id, { ...data, updated_at: nowIso() });
  if (data.email) run('UPDATE users SET email = ? WHERE employee_id = ?', [data.email, id]);
  audit(req, 'update', 'employee', id, Object.keys(data));
  res.json(sanitize(get(`${empQuery} WHERE e.id = ?`, [id]), req));
}));

r.delete('/:id', requireHr, (req, res) => {
  const id = toInt(req.params.id)!;
  run('UPDATE employees SET manager_id = NULL WHERE manager_id = ?', [id]);
  run('UPDATE departments SET head_employee_id = NULL WHERE head_employee_id = ?', [id]);
  const docs = all<any>('SELECT stored_name FROM documents WHERE employee_id = ?', [id]);
  if (!run('DELETE FROM employees WHERE id = ?', [id]).changes) throw notFound();
  for (const d of docs) fs.rm(path.join(UPLOAD_DIR, d.stored_name), { force: true }, () => {});
  audit(req, 'delete', 'employee', id);
  res.json({ ok: true });
});

// ---------- Photo upload ----------
const photoUpload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => cb(null, `photo_${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = ['image/jpeg', 'image/png'].includes(file.mimetype) && /\.(jpe?g|png)$/i.test(file.originalname);
    if (!ok) return cb(Object.assign(new Error('Photo must be a JPG or PNG'), { status: 400 }));
    cb(null, true);
  },
});
r.post('/:id/photo', requireAuth, (req, res, next) => {
  const id = toInt(req.params.id)!;
  if (req.user!.role !== 'hr' && req.user!.employee_id !== id) return next(forbidden());
  photoUpload.single('photo')(req, res, (err: any) => {
    if (err) return res.status(err.status || 400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'photo file is required' });
    const prev = get<any>('SELECT photo_path FROM employees WHERE id = ?', [id]);
    if (!prev) return res.status(404).json({ error: 'Employee not found' });
    if (prev.photo_path) fs.rm(path.join(UPLOAD_DIR, prev.photo_path), { force: true }, () => {});
    update('employees', id, { photo_path: req.file.filename, updated_at: nowIso() });
    audit(req, 'photo', 'employee', id);
    res.json({ photo_path: req.file.filename });
  });
});
r.get('/:id/photo', requireAuth, (req, res) => {
  const row = get<any>('SELECT photo_path FROM employees WHERE id = ?', [toInt(req.params.id)]);
  if (!row?.photo_path) throw notFound('No photo');
  const file = path.join(UPLOAD_DIR, path.basename(row.photo_path));
  if (!fs.existsSync(file)) throw notFound('No photo');
  res.sendFile(file);
});

/** Compact directory for dropdowns (id, name, code) visible to everyone authenticated. */
r.get('/directory/all', requireAuth, (_req, res) => {
  res.json(all(`SELECT e.id, e.employee_code, e.first_name, e.last_name, e.email, e.department_id, e.position_id, e.manager_id, e.status, d.name AS department_name, p.title AS position_title
                FROM employees e LEFT JOIN departments d ON d.id = e.department_id LEFT JOIN positions p ON p.id = e.position_id
                WHERE e.status != 'exited' ORDER BY e.first_name, e.last_name`));
});

export default r;
