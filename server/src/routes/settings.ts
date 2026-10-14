import { Router } from 'express';
import { all, get, insert, update, run, getSetting, setSetting, parseJsonAll } from '../db.js';
import { requireAuth, requireHr, hashPassword } from '../auth.js';
import { wrap, badRequest, notFound, pick, requireFields, audit, toInt } from '../util.js';

const r = Router();

export const DEFAULT_COMPANY = {
  name: 'Acme Corp',
  legal_name: 'Acme Corporation Pvt. Ltd.',
  tagline: 'People first.',
  address: '1 Market Street, Bengaluru, IN',
  email: 'hr@acme.example',
  phone: '+91 80 0000 0000',
  website: 'https://acme.example',
  currency: 'INR',
  currency_symbol: '₹',
  timezone: 'Asia/Kolkata',
  date_format: 'DD MMM YYYY',
  week_start: 1,
  logo_text: 'A',
  brand_color: '#4f46e5',
  accent_color: '#0ea5a4',
  default_theme: 'light',
  employee_code_prefix: 'EMP',
  financial_year_start_month: 4,
};
export const DEFAULT_DOCUMENT_SETTINGS = {
  allowed_formats: ['pdf', 'jpg', 'png'],
  max_size_mb: 10,
  expiry_warning_days: 30,
  expiry_critical_days: 7,
};
export const DEFAULT_PAYROLL_SETTINGS = {
  currency: 'INR',
  pay_day: 28,
  pf_employee_percent: 12,
  pf_employer_percent: 12,
  pf_wage_ceiling: 15000,
  esi_employee_percent: 0.75,
  esi_employer_percent: 3.25,
  esi_wage_ceiling: 21000,
  professional_tax_monthly: 200,
  professional_tax_threshold: 15000,
  tds_slabs: [
    { upto: 300000, percent: 0 },
    { upto: 700000, percent: 5 },
    { upto: 1000000, percent: 10 },
    { upto: 1200000, percent: 15 },
    { upto: 1500000, percent: 20 },
    { upto: null, percent: 30 },
  ],
  standard_deduction_annual: 75000,
  overtime_multiplier: 1.5,
  lop_based_on_attendance: true,
  working_days_mode: 'calendar', // calendar | working
};
export const DEFAULT_ATTENDANCE_SETTINGS = {
  require_geofence: true,
  allow_remote_punch: false,
  max_break_minutes: 60,
  auto_punch_out_hours: 14,
  late_mark_after_minutes: 10,
  half_day_below_minutes: 240,
  overtime_after_minutes: 540,
  standard_work_minutes: 540,
  weekly_offs: [0, 6],
  appeal_deadline_days: 3,           // missed punch appeals must be raised within N days of the date
  edit_only_via_appeal: true,        // HR cannot edit records directly; every change goes through an approved appeal
  travel_tracking_enabled: true,
  travel_sample_interval_seconds: 60,
};
export const DEFAULT_LEAVE_SETTINGS = {
  year_start_month: 1,
  allow_negative_balance: false,
  sandwich_rule: false,
  max_consecutive_days: 30,
  managers_can_approve: true,
  comp_off: {
    enabled: true,
    leave_type_code: 'CO',
    on_weekly_off: true,
    on_holiday: true,
    extra_hours_threshold_minutes: 0,   // 0 = extra hours on normal days do not earn comp off
    full_day_minutes: 480,
    half_day_minutes: 240,
    expiry_days: 90,
    requires_manager_approval: true,
  },
};

const KEYS: Record<string, any> = {
  company: DEFAULT_COMPANY,
  documents: DEFAULT_DOCUMENT_SETTINGS,
  payroll: DEFAULT_PAYROLL_SETTINGS,
  attendance: DEFAULT_ATTENDANCE_SETTINGS,
  leave: DEFAULT_LEAVE_SETTINGS,
  asset_categories: ['Laptop', 'Monitor', 'Phone', 'Keyboard', 'Mouse', 'Headset', 'Access Card', 'Furniture', 'Software Licence', 'Vehicle'],
  employment_types: ['full_time', 'part_time', 'contract', 'intern', 'consultant'],
};

/** Public branding is needed on the login screen before authentication. */
r.get('/public', (_req, res) => {
  const c = getSetting('company', DEFAULT_COMPANY);
  res.json({ name: c.name, tagline: c.tagline, logo_text: c.logo_text, brand_color: c.brand_color, accent_color: c.accent_color, default_theme: c.default_theme });
});

r.get('/', requireAuth, (_req, res) => {
  const out: Record<string, any> = {};
  for (const k of Object.keys(KEYS)) out[k] = getSetting(k, KEYS[k]);
  res.json(out);
});

r.get('/:key', requireAuth, (req, res) => {
  const k = String(req.params.key);
  if (!(k in KEYS)) throw notFound('Unknown settings key');
  res.json(getSetting(k, KEYS[k]));
});

r.put('/:key', requireHr, wrap(async (req, res) => {
  const k = String(req.params.key);
  if (!(k in KEYS)) throw notFound('Unknown settings key');
  const body = req.body;
  if (body === undefined || body === null) throw badRequest('Body required');
  const base = KEYS[k];
  const value = Array.isArray(base) ? (Array.isArray(body) ? body : badRequestThrow('Array expected')) : { ...getSetting(k, base), ...body };
  if (k === 'documents') {
    const fm = value.allowed_formats;
    if (!Array.isArray(fm) || !fm.length || fm.some((f: any) => !['pdf', 'jpg', 'png'].includes(f))) throw badRequest('allowed_formats must be a non-empty subset of pdf, jpg, png');
  }
  setSetting(k, value);
  audit(req, 'update', 'settings', k);
  res.json(value);
}));
function badRequestThrow(m: string): never {
  throw badRequest(m);
}

// ---------- Custom field definitions ----------
const CF_COLS = ['entity', 'key', 'label', 'type', 'options', 'required', 'section', 'sort_order', 'active'];
r.get('/custom-fields/:entity', requireAuth, (req, res) => {
  const rows = all('SELECT * FROM custom_field_defs WHERE entity = ? ORDER BY sort_order, id', [req.params.entity]);
  res.json(parseJsonAll(rows, ['options']));
});
r.post('/custom-fields', requireHr, wrap(async (req, res) => {
  requireFields(req.body, ['entity', 'label', 'type']);
  const data: any = pick(req.body, CF_COLS);
  data.key = (data.key || String(data.label)).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  if (!data.key) throw badRequest('Could not derive a key');
  if (!['text', 'number', 'date', 'select', 'boolean', 'textarea'].includes(data.type)) throw badRequest('Invalid type');
  data.options = Array.isArray(data.options) ? data.options : [];
  const id = insert('custom_field_defs', data);
  audit(req, 'create', 'custom_field', id, data);
  res.status(201).json(parseJsonAll([get('SELECT * FROM custom_field_defs WHERE id = ?', [id])!], ['options'])[0]);
}));
r.put('/custom-fields/:id', requireHr, wrap(async (req, res) => {
  const id = toInt(req.params.id)!;
  if (!get('SELECT 1 FROM custom_field_defs WHERE id = ?', [id])) throw notFound();
  const data: any = pick(req.body, CF_COLS.filter((c) => c !== 'entity' && c !== 'key'));
  if (data.options && !Array.isArray(data.options)) throw badRequest('options must be an array');
  update('custom_field_defs', id, data);
  audit(req, 'update', 'custom_field', id, data);
  res.json(parseJsonAll([get('SELECT * FROM custom_field_defs WHERE id = ?', [id])!], ['options'])[0]);
}));
r.delete('/custom-fields/:id', requireHr, (req, res) => {
  const changes = run('DELETE FROM custom_field_defs WHERE id = ?', [toInt(req.params.id)]).changes;
  if (!changes) throw notFound();
  audit(req, 'delete', 'custom_field', req.params.id);
  res.json({ ok: true });
});

// ---------- Users & roles ----------
r.get('/users/list', requireHr, (_req, res) => {
  res.json(all(
    `SELECT u.id, u.email, u.role, u.employee_id, u.active, u.must_change_password, u.created_at, u.last_login_at,
            e.first_name, e.last_name, e.employee_code
     FROM users u LEFT JOIN employees e ON e.id = u.employee_id ORDER BY u.id`,
  ));
});
r.post('/users', requireHr, wrap(async (req, res) => {
  requireFields(req.body, ['email', 'password', 'role']);
  const { email, password, role, employee_id } = req.body;
  if (!['hr', 'manager', 'employee'].includes(role)) throw badRequest('Invalid role');
  if (String(password).length < 8) throw badRequest('Password must be at least 8 characters');
  const id = insert('users', {
    email: String(email).trim(), password_hash: hashPassword(String(password)), role,
    employee_id: employee_id ?? null, active: 1, must_change_password: 1, created_at: new Date().toISOString(),
  });
  audit(req, 'create', 'user', id, { email, role });
  res.status(201).json(get('SELECT id, email, role, employee_id, active, created_at FROM users WHERE id = ?', [id]));
}));
r.put('/users/:id', requireHr, wrap(async (req, res) => {
  const id = toInt(req.params.id)!;
  const u = get<any>('SELECT * FROM users WHERE id = ?', [id]);
  if (!u) throw notFound();
  const data: any = pick(req.body, ['role', 'employee_id', 'active', 'email']);
  if (data.role && !['hr', 'manager', 'employee'].includes(data.role)) throw badRequest('Invalid role');
  if (req.body.password) {
    if (String(req.body.password).length < 8) throw badRequest('Password must be at least 8 characters');
    data.password_hash = hashPassword(String(req.body.password));
    data.must_change_password = 1;
  }
  if (id === req.user!.id && (data.active === 0 || data.active === false || (data.role && data.role !== 'hr'))) {
    throw badRequest('You cannot deactivate or demote your own account');
  }
  update('users', id, data);
  audit(req, 'update', 'user', id, { ...data, password_hash: undefined });
  res.json(get('SELECT id, email, role, employee_id, active, created_at FROM users WHERE id = ?', [id]));
}));

r.get('/audit/log', requireHr, (req, res) => {
  const limit = Math.min(toInt(req.query.limit, 100)!, 500);
  res.json(parseJsonAll(all(
    `SELECT a.*, u.email AS user_email FROM audit_log a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT ?`, [limit]), ['details']));
});

export default r;
