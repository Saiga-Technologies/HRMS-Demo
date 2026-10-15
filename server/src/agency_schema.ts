/**
 * Agency database (one per deployment): the client companies the agency manages, agency staff and
 * their company assignments, the login directory, and billing (entities, tax rates, invoices,
 * payments). Each client company's HR data lives in its own database (see db.ts / schema.ts).
 *
 * Money columns are integer minor units (`*_minor`) with the currency's exponent stored alongside.
 */
export const AGENCY_SCHEMA = `
CREATE TABLE IF NOT EXISTS agency_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS companies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  legal_name TEXT,
  country_code TEXT NOT NULL,              -- IN | AE | SA | QA | US
  region TEXT,                             -- state / emirate / province
  city TEXT,
  currency TEXT NOT NULL,
  timezone TEXT NOT NULL,
  industry TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('onboarding','active','suspended','offboarded')),
  account_manager_id INTEGER REFERENCES agency_users(id) ON DELETE SET NULL,
  logo_text TEXT,
  brand_color TEXT,
  contact_name TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  seed_profile TEXT,                       -- demo data generator key; NULL for real companies
  onboarded_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agency_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL CHECK (role IN ('owner','admin','account_manager','payroll','recruiter')),
  phone TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  last_login_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agency_user_companies (
  agency_user_id INTEGER NOT NULL REFERENCES agency_users(id) ON DELETE CASCADE,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  PRIMARY KEY (agency_user_id, company_id)
);

CREATE TABLE IF NOT EXISTS agency_sessions (
  token TEXT PRIMARY KEY,
  agency_user_id INTEGER NOT NULL REFERENCES agency_users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- Which company a company-side login (client HR, managers, employees) belongs to.
CREATE TABLE IF NOT EXISTS login_directory (
  email TEXT NOT NULL COLLATE NOCASE,
  company_slug TEXT NOT NULL,
  PRIMARY KEY (email, company_slug)
);

CREATE TABLE IF NOT EXISTS agency_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agency_user_id INTEGER,
  company_slug TEXT,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  details TEXT,
  created_at TEXT NOT NULL
);

/* ---------------- Billing ---------------- */
-- The agency's own invoicing entities (one per tax registration).
CREATE TABLE IF NOT EXISTS billing_entities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,               -- IN | AE | US …
  name TEXT NOT NULL,
  legal_name TEXT NOT NULL,
  country_code TEXT NOT NULL,
  region TEXT,                             -- e.g. Kerala (decides CGST+SGST vs IGST)
  region_code TEXT,                        -- e.g. GST state code 32
  tax_label TEXT NOT NULL,                 -- GSTIN | TRN | EIN
  tax_id TEXT NOT NULL,
  address TEXT NOT NULL,
  email TEXT,
  invoice_prefix TEXT NOT NULL,
  fy_start_month INTEGER NOT NULL DEFAULT 1,   -- 4 for India (1 Apr – 31 Mar)
  bank_details TEXT,
  created_at TEXT NOT NULL
);

-- Effective-dated tax rates (basis points). A rate change never restates issued invoices.
CREATE TABLE IF NOT EXISTS tax_rates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scheme TEXT NOT NULL,                    -- IN_GST | AE_VAT | SA_VAT | QA_NONE | US_NONE
  rate_bp INTEGER NOT NULL,
  effective_from TEXT NOT NULL,
  note TEXT,
  UNIQUE (scheme, effective_from)
);

CREATE TABLE IF NOT EXISTS billing_profiles (
  company_id INTEGER PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  entity_id INTEGER NOT NULL REFERENCES billing_entities(id),
  plan_name TEXT NOT NULL DEFAULT 'Standard',
  currency TEXT NOT NULL,
  pepm_minor INTEGER NOT NULL DEFAULT 0,          -- fee per active employee per month
  payroll_run_minor INTEGER NOT NULL DEFAULT 0,   -- fee per processed payroll run
  min_monthly_minor INTEGER NOT NULL DEFAULT 0,   -- minimum monthly charge (subscription floor)
  setup_fee_minor INTEGER NOT NULL DEFAULT 0,
  setup_fee_billed INTEGER NOT NULL DEFAULT 0,
  tax_scheme TEXT NOT NULL,
  place_of_supply TEXT,                    -- India: client's state (decides CGST/SGST vs IGST)
  place_of_supply_code TEXT,
  client_tax_id TEXT,                      -- client's GSTIN / TRN / EIN
  sac_code TEXT,
  payment_terms_days INTEGER NOT NULL DEFAULT 15,
  billing_email TEXT,
  billing_contact TEXT,
  billing_address TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS counters (
  name TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT UNIQUE,                      -- assigned when issued (consecutive per entity per FY)
  entity_id INTEGER NOT NULL REFERENCES billing_entities(id),
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  period TEXT NOT NULL,                    -- YYYY-MM service month
  issue_date TEXT,
  due_date TEXT,
  currency TEXT NOT NULL,
  exponent INTEGER NOT NULL,
  subtotal_minor INTEGER NOT NULL DEFAULT 0,
  tax_minor INTEGER NOT NULL DEFAULT 0,
  total_minor INTEGER NOT NULL DEFAULT 0,
  paid_minor INTEGER NOT NULL DEFAULT 0,
  tax_scheme TEXT NOT NULL,
  tax_rate_bp INTEGER NOT NULL DEFAULT 0,
  tax_breakdown TEXT NOT NULL DEFAULT '[]',   -- JSON [{name, rate_bp, amount_minor}]
  place_of_supply TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','issued','paid','void')),
  notes TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL,
  issued_at TEXT,
  paid_at TEXT,
  voided_at TEXT,
  void_reason TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoice_company_period ON invoices(company_id, period) WHERE status != 'void';

CREATE TABLE IF NOT EXISTS invoice_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL,                      -- pepm | payroll_run | minimum_topup | setup | adhoc
  description TEXT NOT NULL,
  sac_code TEXT,
  quantity REAL NOT NULL DEFAULT 1,
  unit_minor INTEGER NOT NULL,
  amount_minor INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  amount_minor INTEGER NOT NULL,
  received_on TEXT NOT NULL,
  method TEXT NOT NULL,
  reference TEXT,
  idempotency_key TEXT UNIQUE,
  created_by INTEGER,
  created_at TEXT NOT NULL
);
`;
