import { agency, DEFAULT_COMPANY_SLUG } from '../db.js';
import { hashPassword } from '../auth.js';
import { nowIso } from '../util.js';
import { DEMO_COMPANIES } from './registry.js';

export const AGENCY_NAME = 'Saiga HR Services';

/** Agency staff for the demo (password = DEMO_PASSWORD). */
export const AGENCY_STAFF = [
  { key: 'owner', email: 'admin@saigahr.example', first_name: 'Lakshmi', last_name: 'Menon', role: 'owner' },
  { key: 'am.india', email: 'am.india@saigahr.example', first_name: 'Arun', last_name: 'Nambiar', role: 'account_manager' },
  { key: 'am.gcc', email: 'am.gcc@saigahr.example', first_name: 'Fatima', last_name: 'Al Mansoori', role: 'account_manager' },
  { key: 'am.us', email: 'am.us@saigahr.example', first_name: 'Daniel', last_name: 'Brooks', role: 'account_manager' },
  { key: 'payroll', email: 'payroll@saigahr.example', first_name: 'Gopika', last_name: 'Varma', role: 'payroll' },
  { key: 'recruiter', email: 'recruiter@saigahr.example', first_name: 'Rhea', last_name: 'Fernandes', role: 'recruiter' },
] as const;

/** Billing entities: India (GST, Kerala), UAE (VAT; also bills Qatar as a zero-rated export), KSA (VAT), US. */
const ENTITIES = [
  { code: 'IN', name: 'Saiga HR Services', legal_name: 'Saiga HR Services Private Limited', country_code: 'IN', region: 'Kerala', region_code: '32', tax_label: 'GSTIN', tax_id: '32AAKCS4821H1Z6', address: '4th Floor, Infopark Phase 2, Kakkanad, Kochi, Kerala 682042, India', email: 'billing@saigahr.example', invoice_prefix: 'SHS', fy_start_month: 4, bank_details: 'HDFC Bank · A/c 50200081234567 · IFSC HDFC0001920' },
  { code: 'AE', name: 'Saiga HR Services (UAE)', legal_name: 'Saiga HR Services FZ-LLC', country_code: 'AE', region: 'Dubai', region_code: null, tax_label: 'TRN', tax_id: '100589234700003', address: 'Office 1204, Dubai Internet City, Building 9, Dubai, UAE', email: 'billing.ae@saigahr.example', invoice_prefix: 'SHA', fy_start_month: 1, bank_details: 'Emirates NBD · IBAN AE07 0331 2345 6789 0123 456' },
  { code: 'SA', name: 'Saiga HR Services (KSA)', legal_name: 'Saiga HR Services Saudi LLC', country_code: 'SA', region: 'Riyadh', region_code: null, tax_label: 'VAT No.', tax_id: '311234567800003', address: 'King Fahd Road, Al Olaya, Riyadh 12214, Saudi Arabia', email: 'billing.sa@saigahr.example', invoice_prefix: 'SHK', fy_start_month: 1, bank_details: 'Saudi National Bank · IBAN SA03 1000 0000 1234 5678 9012' },
  { code: 'US', name: 'Saiga HR Services (US)', legal_name: 'Saiga HR Services, Inc.', country_code: 'US', region: 'Delaware', region_code: null, tax_label: 'EIN', tax_id: '88-4120573', address: '251 Little Falls Drive, Wilmington, DE 19808, USA', email: 'billing.us@saigahr.example', invoice_prefix: 'SHU', fy_start_month: 1, bank_details: 'JPMorgan Chase · Routing 021000021 · A/c 783920145' },
];
/** Effective-dated rates (basis points). Verify against the current authority publication before real use. */
const TAX_RATES = [
  { scheme: 'IN_GST', rate_bp: 1800, effective_from: '2017-07-01', note: 'GST on HR / payroll services (SAC 998519); CGST+SGST intra-state, IGST inter-state' },
  { scheme: 'AE_VAT', rate_bp: 500, effective_from: '2018-01-01', note: 'UAE VAT standard rate' },
  { scheme: 'AE_EXPORT', rate_bp: 0, effective_from: '2018-01-01', note: 'Zero-rated export of services from the UAE entity (e.g. Qatar clients)' },
  { scheme: 'SA_VAT', rate_bp: 1500, effective_from: '2020-07-01', note: 'KSA VAT standard rate (ZATCA e-invoicing applies to real invoices)' },
  { scheme: 'US_NONE', rate_bp: 0, effective_from: '2000-01-01', note: 'Payroll services are generally not subject to sales tax; check state rules' },
];
/** Pricing per market in minor units of the client's currency. */
const PRICING: Record<string, { pepm: number; run: number; min: number; setup: number }> = {
  INR: { pepm: 45000, run: 250000, min: 1500000, setup: 2500000 },   // ₹450 PEPM, ₹2,500 / run, ₹15,000 floor
  AED: { pepm: 4500, run: 50000, min: 200000, setup: 350000 },
  SAR: { pepm: 4500, run: 50000, min: 200000, setup: 350000 },
  QAR: { pepm: 4500, run: 50000, min: 200000, setup: 350000 },
  USD: { pepm: 1200, run: 15000, min: 50000, setup: 75000 },
};

/** Agency DB: staff, the company registry (default company + demo companies), billing master data. */
export function seedAgencyIfEmpty(hash: (p: string) => string = hashPassword, password: string) {
  if (agency.get('SELECT 1 FROM companies LIMIT 1')) return false;
  const now = nowIso();
  agency.transaction(() => {
    agency.run("INSERT INTO agency_settings (key, value, updated_at) VALUES ('agency', ?, ?)", [JSON.stringify({ name: AGENCY_NAME, tagline: 'Payroll, HR and compliance for growing teams', logo_text: 'S', brand_color: '#4A8F49', accent_color: '#D9922E', support_email: 'support@saigahr.example', sla_hours: { urgent: 4, high: 24, normal: 48, low: 96 } }), now]);
    const pw = hash(password);
    const staff: Record<string, number> = {};
    for (const s of AGENCY_STAFF) staff[s.key] = agency.insert('agency_users', { email: s.email, password_hash: pw, first_name: s.first_name, last_name: s.last_name, role: s.role, active: 1, created_at: now });
    const entity: Record<string, number> = {};
    for (const e of ENTITIES) entity[e.code] = agency.insert('billing_entities', { ...e, created_at: now });
    for (const t of TAX_RATES) agency.insert('tax_rates', t);

    const company = (c: any) => agency.insert('companies', { ...c, status: 'active', onboarded_at: c.onboarded_at || now, created_at: now, updated_at: now });
    const profile = (company_id: number, entityCode: string, currency: string, tax_scheme: string, extra: Record<string, any> = {}) => {
      const p = PRICING[currency];
      agency.insert('billing_profiles', { company_id, entity_id: entity[entityCode], plan_name: 'Payroll + HR', currency, pepm_minor: p.pepm, payroll_run_minor: p.run, min_monthly_minor: p.min, setup_fee_minor: p.setup, setup_fee_billed: 1, tax_scheme, sac_code: entityCode === 'IN' ? '998519' : null, payment_terms_days: 15, active: 1, updated_at: now, ...extra });
    };
    // The original single-company demo stays as a client (all existing logins keep working).
    const acme = company({ slug: DEFAULT_COMPANY_SLUG, name: 'Acme Corp', legal_name: 'Acme Corporation Pvt. Ltd.', country_code: 'IN', region: 'Karnataka', city: 'Bengaluru', currency: 'INR', timezone: 'Asia/Kolkata', industry: 'Software products', account_manager_id: staff['am.india'], logo_text: 'A', brand_color: '#4A8F49', contact_name: 'Sara Thomas', contact_email: 'hr@acme.example', contact_phone: '+91 80 0000 0000', seed_profile: 'acme', onboarded_at: '2024-04-01T00:00:00.000Z' });
    profile(acme, 'IN', 'INR', 'IN_GST', { place_of_supply: 'Karnataka', place_of_supply_code: '29', client_tax_id: '29AABCA1234C1Z5', billing_email: 'accounts@acme.example', billing_contact: 'Suresh Pillai', billing_address: '1 Market Street, Bengaluru, Karnataka 560001' });
    for (const d of DEMO_COMPANIES) {
      const id = company({ slug: d.slug, name: d.name, legal_name: d.legal_name, country_code: d.country_code, region: d.region, city: d.city, currency: d.currency, timezone: d.timezone, industry: d.industry, account_manager_id: staff[d.account_manager], logo_text: d.logo_text, brand_color: d.brand_color, contact_name: null, contact_email: `hr@${d.slug}.example`, contact_phone: null, seed_profile: d.slug, onboarded_at: '2025-01-06T00:00:00.000Z' });
      const ent = d.country_code === 'IN' ? 'IN' : d.country_code === 'SA' ? 'SA' : d.country_code === 'US' ? 'US' : 'AE';
      const scheme = d.country_code === 'IN' ? 'IN_GST' : d.country_code === 'AE' ? 'AE_VAT' : d.country_code === 'QA' ? 'AE_EXPORT' : d.country_code === 'SA' ? 'SA_VAT' : 'US_NONE';
      profile(id, ent, d.currency, scheme, { place_of_supply: d.region, place_of_supply_code: d.region_code ?? null, client_tax_id: d.client_tax_id, billing_email: `accounts@${d.slug}.example`, billing_contact: 'Accounts payable', billing_address: `${d.legal_name}, ${d.city}, ${d.region}, ${d.country}` });
    }
    // Assignments: account managers via companies.account_manager_id; payroll sees every company; the recruiter covers India + US.
    for (const c of agency.all<any>('SELECT id, country_code FROM companies')) {
      agency.insert('agency_user_companies', { agency_user_id: staff.payroll, company_id: c.id });
      if (c.country_code === 'IN' || c.country_code === 'US') agency.insert('agency_user_companies', { agency_user_id: staff.recruiter, company_id: c.id });
    }
  });
  return true;
}
