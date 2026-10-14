// Full relational schema for the HRMS. Every table is created with IF NOT EXISTS so the
// server can be booted against an empty file; `migrate()` in db.ts runs this on start.
export const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,            -- JSON
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('hr','manager','employee')),
  employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  active INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  user_agent TEXT
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  details TEXT,                    -- JSON
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS departments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  code TEXT UNIQUE,
  parent_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  head_employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  description TEXT,
  color TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  code TEXT UNIQUE,
  department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  reports_to_position_id INTEGER REFERENCES positions(id) ON DELETE SET NULL,
  level INTEGER NOT NULL DEFAULT 1,
  grade TEXT,
  headcount INTEGER NOT NULL DEFAULT 1,
  description TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS job_descriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  position_id INTEGER REFERENCES positions(id) ON DELETE SET NULL,
  department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  summary TEXT,
  responsibilities TEXT NOT NULL DEFAULT '[]',   -- JSON string[]
  requirements TEXT NOT NULL DEFAULT '[]',       -- JSON string[]
  skills TEXT NOT NULL DEFAULT '[]',             -- JSON string[]
  employment_type TEXT NOT NULL DEFAULT 'full_time',
  experience_min INTEGER,
  experience_max INTEGER,
  salary_min REAL,
  salary_max REAL,
  location TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  version INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS custom_field_defs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity TEXT NOT NULL,            -- 'employee' | 'asset' | 'document'
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('text','number','date','select','boolean','textarea')),
  options TEXT NOT NULL DEFAULT '[]',  -- JSON string[] for select
  required INTEGER NOT NULL DEFAULT 0,
  section TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE (entity, key)
);

CREATE TABLE IF NOT EXISTS work_locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  address TEXT,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  radius_m INTEGER NOT NULL DEFAULT 150,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS shifts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  start_time TEXT NOT NULL,        -- 'HH:MM'
  end_time TEXT NOT NULL,          -- 'HH:MM'
  grace_minutes INTEGER NOT NULL DEFAULT 10,
  break_minutes_allowed INTEGER NOT NULL DEFAULT 60,
  half_day_minutes INTEGER NOT NULL DEFAULT 240,
  full_day_minutes INTEGER NOT NULL DEFAULT 480,
  working_days TEXT NOT NULL DEFAULT '[1,2,3,4,5]',  -- JSON number[] 0=Sun
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_code TEXT NOT NULL UNIQUE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  phone TEXT,
  dob TEXT,
  gender TEXT,
  marital_status TEXT,
  nationality TEXT,
  address TEXT,
  city TEXT,
  country TEXT,
  photo_path TEXT,
  department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  position_id INTEGER REFERENCES positions(id) ON DELETE SET NULL,
  manager_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  work_location_id INTEGER REFERENCES work_locations(id) ON DELETE SET NULL,
  shift_id INTEGER REFERENCES shifts(id) ON DELETE SET NULL,
  vacancy_id INTEGER,
  join_date TEXT,
  confirmation_date TEXT,
  exit_date TEXT,
  employment_type TEXT NOT NULL DEFAULT 'full_time',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('onboarding','probation','active','notice','exited')),
  emergency_contact_name TEXT,
  emergency_contact_phone TEXT,
  bank_name TEXT,
  bank_account_name TEXT,
  bank_account_number TEXT,
  bank_ifsc TEXT,
  tax_id TEXT,
  pf_number TEXT,
  custom_fields TEXT NOT NULL DEFAULT '{}',   -- JSON object keyed by custom_field_defs.key
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS document_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  allowed_formats TEXT NOT NULL DEFAULT '["pdf","jpg","png"]',   -- JSON string[] subset of pdf,jpg,png
  requires_expiry INTEGER NOT NULL DEFAULT 0,
  expiry_warning_days INTEGER NOT NULL DEFAULT 30,
  expiry_critical_days INTEGER NOT NULL DEFAULT 7,
  required_for_all INTEGER NOT NULL DEFAULT 0,
  max_size_mb INTEGER NOT NULL DEFAULT 10,
  category TEXT,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
  document_type_id INTEGER REFERENCES document_types(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  mime TEXT NOT NULL,
  format TEXT NOT NULL,            -- pdf|jpg|png
  size_bytes INTEGER NOT NULL,
  issued_date TEXT,
  expiry_date TEXT,
  document_number TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'valid',   -- valid|pending_review|rejected
  uploaded_by INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS salary_components (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('earning','deduction')),
  calc_type TEXT NOT NULL CHECK (calc_type IN ('fixed','percent_of_basic','percent_of_gross')),
  default_value REAL NOT NULL DEFAULT 0,
  taxable INTEGER NOT NULL DEFAULT 1,
  statutory INTEGER NOT NULL DEFAULT 0,
  prorate INTEGER NOT NULL DEFAULT 1,       -- reduce for loss-of-pay days
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS salary_structures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  effective_from TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  basic REAL NOT NULL,
  components TEXT NOT NULL DEFAULT '[]',  -- JSON [{component_id, value}] overrides
  ctc_annual REAL,
  notes TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS payroll_adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  period TEXT NOT NULL,            -- 'YYYY-MM'
  type TEXT NOT NULL CHECK (type IN ('bonus','reimbursement','overtime','deduction','advance','loan_recovery','arrears')),
  amount REAL NOT NULL,
  note TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS payroll_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  period TEXT NOT NULL UNIQUE,     -- 'YYYY-MM'
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','processed','approved','paid')),
  working_days INTEGER NOT NULL,
  totals TEXT NOT NULL DEFAULT '{}',   -- JSON
  notes TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL,
  processed_at TEXT,
  approved_at TEXT,
  paid_at TEXT
);

CREATE TABLE IF NOT EXISTS payslips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  working_days INTEGER NOT NULL,
  paid_days REAL NOT NULL,
  lop_days REAL NOT NULL DEFAULT 0,
  basic REAL NOT NULL,
  earnings TEXT NOT NULL DEFAULT '[]',     -- JSON [{code,name,amount}]
  deductions TEXT NOT NULL DEFAULT '[]',   -- JSON [{code,name,amount}]
  gross REAL NOT NULL,
  total_deductions REAL NOT NULL,
  net REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'generated',
  created_at TEXT NOT NULL,
  UNIQUE (run_id, employee_id)
);

CREATE TABLE IF NOT EXISTS holidays (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  date TEXT NOT NULL,
  optional INTEGER NOT NULL DEFAULT 0,
  UNIQUE (name, date)
);

CREATE TABLE IF NOT EXISTS attendance_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date TEXT NOT NULL,              -- 'YYYY-MM-DD'
  punch_in_at TEXT,
  punch_in_lat REAL,
  punch_in_lng REAL,
  punch_in_location_id INTEGER,
  punch_in_within_fence INTEGER,
  punch_in_distance_m REAL,
  punch_out_at TEXT,
  punch_out_lat REAL,
  punch_out_lng REAL,
  punch_out_location_id INTEGER,
  punch_out_within_fence INTEGER,
  punch_out_distance_m REAL,
  status TEXT NOT NULL DEFAULT 'present',   -- present|half_day|absent|leave|holiday|weekend|wfh
  work_minutes INTEGER NOT NULL DEFAULT 0,
  break_minutes INTEGER NOT NULL DEFAULT 0,
  overtime_minutes INTEGER NOT NULL DEFAULT 0,
  late_minutes INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'punch',     -- punch|manual|correction|import
  notes TEXT,
  corrected_by INTEGER,
  corrected_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (employee_id, date)
);

CREATE TABLE IF NOT EXISTS attendance_breaks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attendance_id INTEGER NOT NULL REFERENCES attendance_records(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'break',   -- break|lunch|personal
  start_at TEXT NOT NULL,
  end_at TEXT,
  minutes INTEGER NOT NULL DEFAULT 0,
  note TEXT
);

CREATE TABLE IF NOT EXISTS attendance_corrections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  requested_punch_in TEXT,
  requested_punch_out TEXT,
  requested_status TEXT,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  requested_by INTEGER,
  reviewed_by INTEGER,
  reviewed_at TEXT,
  review_note TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS leave_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  code TEXT NOT NULL UNIQUE,
  annual_quota REAL NOT NULL DEFAULT 0,
  paid INTEGER NOT NULL DEFAULT 1,
  carry_forward INTEGER NOT NULL DEFAULT 0,
  max_carry_forward REAL NOT NULL DEFAULT 0,
  requires_document INTEGER NOT NULL DEFAULT 0,
  min_notice_days INTEGER NOT NULL DEFAULT 0,
  allow_half_day INTEGER NOT NULL DEFAULT 1,
  color TEXT NOT NULL DEFAULT '#2563eb',
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS leave_balances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  leave_type_id INTEGER NOT NULL REFERENCES leave_types(id) ON DELETE CASCADE,
  year INTEGER NOT NULL,
  allocated REAL NOT NULL DEFAULT 0,
  carried REAL NOT NULL DEFAULT 0,
  adjusted REAL NOT NULL DEFAULT 0,
  used REAL NOT NULL DEFAULT 0,
  UNIQUE (employee_id, leave_type_id, year)
);

CREATE TABLE IF NOT EXISTS leave_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  leave_type_id INTEGER NOT NULL REFERENCES leave_types(id),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  half_day TEXT,                   -- NULL | 'first_half' | 'second_half'
  days REAL NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled','correction_pending')),
  requested_by INTEGER,
  reviewed_by INTEGER,
  reviewed_at TEXT,
  review_note TEXT,
  correction TEXT,                 -- JSON {start_date,end_date,half_day,days,reason} awaiting approval
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS leave_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  leave_request_id INTEGER NOT NULL REFERENCES leave_requests(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  by_user INTEGER,
  note TEXT,
  snapshot TEXT,                   -- JSON
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_tag TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Laptop',
  serial_number TEXT,
  model TEXT,
  vendor TEXT,
  purchase_date TEXT,
  purchase_cost REAL,
  warranty_expiry TEXT,
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','assigned','maintenance','retired','lost')),
  condition TEXT NOT NULL DEFAULT 'good',
  location TEXT,
  specs TEXT NOT NULL DEFAULT '{}',   -- JSON
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS asset_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  assigned_at TEXT NOT NULL,
  expected_return_at TEXT,
  returned_at TEXT,
  assigned_by INTEGER,
  condition_out TEXT,
  condition_in TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS vacancies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  position_id INTEGER REFERENCES positions(id) ON DELETE SET NULL,
  department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  job_description_id INTEGER REFERENCES job_descriptions(id) ON DELETE SET NULL,
  openings INTEGER NOT NULL DEFAULT 1,
  budget_annual REAL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('draft','open','on_hold','closed','filled')),
  raised_by INTEGER,
  opened_at TEXT,
  closed_at TEXT,
  notes TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS journey_stage_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  color TEXT NOT NULL DEFAULT '#2563eb',
  icon TEXT NOT NULL DEFAULT 'flag',
  owner_role TEXT NOT NULL DEFAULT 'hr',
  sla_days INTEGER,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS journey_stages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  template_id INTEGER REFERENCES journey_stage_templates(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  color TEXT NOT NULL DEFAULT '#2563eb',
  icon TEXT NOT NULL DEFAULT 'flag',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','completed','skipped')),
  started_at TEXT,
  completed_at TEXT,
  owner TEXT,
  notes TEXT,
  checklist TEXT NOT NULL DEFAULT '[]',   -- JSON [{label, done}]
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dashboard_cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,              -- stat|list|link|note
  title TEXT NOT NULL,
  config TEXT NOT NULL DEFAULT '{}',   -- JSON
  size TEXT NOT NULL DEFAULT 'sm',     -- sm|md|lg
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_employees_department ON employees(department_id);
CREATE INDEX IF NOT EXISTS idx_employees_manager ON employees(manager_id);
CREATE INDEX IF NOT EXISTS idx_documents_employee ON documents(employee_id);
CREATE INDEX IF NOT EXISTS idx_documents_expiry ON documents(expiry_date);
CREATE INDEX IF NOT EXISTS idx_attendance_emp_date ON attendance_records(employee_id, date);
CREATE INDEX IF NOT EXISTS idx_leave_requests_emp ON leave_requests(employee_id, status);
CREATE INDEX IF NOT EXISTS idx_payslips_run ON payslips(run_id);
CREATE INDEX IF NOT EXISTS idx_journey_emp ON journey_stages(employee_id, sort_order);
`;

/** Phase 2 tables. Kept separate so `migrate()` can also add new columns to existing tables. */
export const SCHEMA_V2 = `
CREATE TABLE IF NOT EXISTS travel_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  destination TEXT NOT NULL,
  purpose TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  start_lat REAL, start_lng REAL,
  end_lat REAL, end_lng REAL,
  path TEXT NOT NULL DEFAULT '[]',          -- JSON [{lat,lng,at}] sampled points
  distance_km REAL NOT NULL DEFAULT 0,
  duration_minutes INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','cancelled')),
  notes TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS comp_off_credits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  worked_date TEXT NOT NULL,
  reason TEXT NOT NULL,                     -- weekly_off | holiday | extra_hours
  work_minutes INTEGER NOT NULL DEFAULT 0,
  days REAL NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'detected' CHECK (status IN ('detected','pending','approved','rejected','expired')),
  approver_employee_id INTEGER,
  requested_by INTEGER,
  reviewed_by INTEGER,
  reviewed_at TEXT,
  review_note TEXT,
  expires_on TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (employee_id, worked_date)
);

CREATE TABLE IF NOT EXISTS payslip_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  period TEXT NOT NULL,                     -- 'YYYY-MM'
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','fulfilled','rejected')),
  payslip_id INTEGER,
  handled_by INTEGER,
  handled_at TEXT,
  note TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL DEFAULT '',
  email TEXT,
  phone TEXT,
  source TEXT,
  vacancy_id INTEGER REFERENCES vacancies(id) ON DELETE SET NULL,
  position_id INTEGER REFERENCES positions(id) ON DELETE SET NULL,
  cv_original_name TEXT,
  cv_stored_name TEXT,
  cv_mime TEXT,
  cv_text TEXT,
  parsed TEXT NOT NULL DEFAULT '{}',        -- JSON {skills,experience_years,education,emails,phones,summary}
  score REAL,
  score_breakdown TEXT NOT NULL DEFAULT '{}',   -- JSON
  stage TEXT NOT NULL DEFAULT 'new' CHECK (stage IN ('new','screening','interview','offer','hired','rejected','withdrawn')),
  rating INTEGER,
  expected_salary REAL,
  notice_days INTEGER,
  notes TEXT,
  hired_employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  created_by INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS candidate_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  type TEXT NOT NULL,                       -- stage_change | note | interview | score | hired
  note TEXT,
  data TEXT,                                -- JSON
  by_user INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS letter_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL DEFAULT 'general',   -- offer | appointment | experience | relieving | salary | address | general
  subject TEXT NOT NULL,
  body TEXT NOT NULL,                          -- text with {{placeholders}}; blank line = paragraph
  self_service INTEGER NOT NULL DEFAULT 1,     -- employees may request it
  requires_approval INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS letters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  template_id INTEGER REFERENCES letter_templates(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  body_rendered TEXT,
  variables TEXT NOT NULL DEFAULT '{}',        -- JSON extra placeholders supplied at generation
  pdf_stored_name TEXT,
  document_id INTEGER,
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','approved','generated','rejected')),
  reason TEXT,
  requested_by INTEGER,
  approved_by INTEGER,
  approved_at TEXT,
  generated_at TEXT,
  note TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS review_cycles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','closed')),
  competencies TEXT NOT NULL DEFAULT '[]',     -- JSON [{key,label,description,weight}]
  rating_scale INTEGER NOT NULL DEFAULT 5,
  created_by INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cycle_id INTEGER NOT NULL REFERENCES review_cycles(id) ON DELETE CASCADE,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  reviewer_employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  self_ratings TEXT NOT NULL DEFAULT '{}',     -- JSON {competencyKey: number}
  manager_ratings TEXT NOT NULL DEFAULT '{}',
  self_comments TEXT,
  manager_comments TEXT,
  goals TEXT NOT NULL DEFAULT '[]',            -- JSON [{title, weight, progress, status, notes}]
  final_rating REAL,
  status TEXT NOT NULL DEFAULT 'pending_self' CHECK (status IN ('pending_self','pending_manager','completed','acknowledged')),
  self_submitted_at TEXT,
  completed_at TEXT,
  acknowledged_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (cycle_id, employee_id)
);

CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  code TEXT UNIQUE,
  industry TEXT,
  website TEXT,
  address TEXT,
  contact_name TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('prospect','active','inactive')),
  billing_currency TEXT NOT NULL DEFAULT 'INR',
  payment_terms_days INTEGER NOT NULL DEFAULT 30,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS placements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  candidate_id INTEGER REFERENCES candidates(id) ON DELETE SET NULL,
  role_title TEXT NOT NULL,
  start_date TEXT,
  end_date TEXT,
  bill_rate REAL,
  pay_rate REAL,
  rate_unit TEXT NOT NULL DEFAULT 'month' CHECK (rate_unit IN ('hour','day','month')),
  placement_fee REAL,
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','active','completed','terminated')),
  location TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  audience TEXT NOT NULL DEFAULT 'all',        -- all | managers | hr | department:<id>
  pinned INTEGER NOT NULL DEFAULT 0,
  publish_at TEXT,
  expires_at TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS announcement_reads (
  announcement_id INTEGER NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at TEXT NOT NULL,
  PRIMARY KEY (announcement_id, user_id)
);

CREATE TABLE IF NOT EXISTS shift_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  shift_id INTEGER REFERENCES shifts(id) ON DELETE SET NULL,   -- NULL = day off
  note TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL,
  UNIQUE (employee_id, date)
);

CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  scopes TEXT NOT NULL DEFAULT '["candidates:write"]',   -- JSON string[]
  active INTEGER NOT NULL DEFAULT 1,
  last_used_at TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS webhooks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL,
  events TEXT NOT NULL DEFAULT '["candidate.created","candidate.stage_changed","employee.hired"]',   -- JSON string[]
  secret TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  webhook_id INTEGER NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  event TEXT NOT NULL,
  payload TEXT NOT NULL,
  status_code INTEGER,
  ok INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  attempted_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_candidates_vacancy ON candidates(vacancy_id, stage);
CREATE INDEX IF NOT EXISTS idx_reviews_cycle ON reviews(cycle_id, employee_id);
CREATE INDEX IF NOT EXISTS idx_placements_client ON placements(client_id, status);
CREATE INDEX IF NOT EXISTS idx_shift_assign ON shift_assignments(date, employee_id);
CREATE INDEX IF NOT EXISTS idx_travel_emp ON travel_logs(employee_id, started_at);
CREATE INDEX IF NOT EXISTS idx_compoff_emp ON comp_off_credits(employee_id, status);
`;

/** Columns added to existing tables after the first release: [table, column, DDL]. */
export const COLUMN_MIGRATIONS: [string, string, string][] = [
  ['attendance_corrections', 'kind', "TEXT NOT NULL DEFAULT 'correction'"],      // missed_punch_in | missed_punch_out | missed_both | status | correction
  ['attendance_corrections', 'approver_employee_id', 'INTEGER'],
  ['attendance_corrections', 'applied_record_id', 'INTEGER'],
  ['attendance_corrections', 'previous_values', 'TEXT'],                          // JSON snapshot of the record before the correction was applied
  ['attendance_records', 'correction_id', 'INTEGER'],
  ['leave_requests', 'approver_employee_id', 'INTEGER'],
  ['employees', 'candidate_id', 'INTEGER'],
  ['vacancies', 'hired_count', 'INTEGER NOT NULL DEFAULT 0'],
  ['departments', 'icon', 'TEXT'],                                                // icon name shown in the department badge
];
