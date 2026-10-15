/**
 * Country templates: everything a brand-new client company needs before its first employee —
 * settings (company, payroll incl. the payroll calendar, attendance, leave, documents), salary
 * components, leave types, holidays (this year + next), document types, custom fields, journey
 * stage templates, one work location, one default shift and a starter set of departments.
 *
 * Used by the demo generator (seedDemoCompany) and the agency "Add company" wizard, so the two
 * never drift. Statutory figures are demo approximations — verify against the authority before real use.
 */
import { insert, setSetting, transaction, currentCompanySlug } from '../db.js';
import { nowIso, today } from '../util.js';
import { DEFAULT_COMPANY, DEFAULT_DOCUMENT_SETTINGS, DEFAULT_PAYROLL_SETTINGS, DEFAULT_ATTENDANCE_SETTINGS, DEFAULT_LEAVE_SETTINGS } from '../routes/settings.js';
import { holidaysFor } from './holidays.js';

export type CountryCode = 'IN' | 'AE' | 'SA' | 'QA' | 'US';

export interface DeptSeed { name: string; code: string; color: string; icon: string; parent?: string; description?: string }
export interface ShiftSeed { name: string; start_time: string; end_time: string; break_minutes_allowed?: number; grace_minutes?: number }

export interface CountryTemplateOpts {
  country_code: CountryCode;
  region?: string;
  name: string;
  legal_name?: string;
  currency: string;
  timezone: string;
  weekly_offs: number[];
  pay_day: number | 'last_working_day';
  city?: string;
  lat?: number;
  lng?: number;
  brand_color?: string;
  logo_text?: string;
  // Optional extras (the demo generator fills these; the wizard may leave them out).
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
  tagline?: string;
  accent_color?: string;
  employee_code_prefix?: string;
  location_name?: string;
  departments?: DeptSeed[];
  default_shift?: ShiftSeed;
  remote_friendly?: boolean;
}

export interface TemplateResult {
  departments: Record<string, number>;   // by code
  locationId: number;
  shiftId: number;
  components: Record<string, number>;    // by code
  leaveTypes: Record<string, number>;    // by code
  docTypes: Record<string, number>;      // by key (see documentTypesFor)
}

export const COUNTRY_NAME: Record<CountryCode, string> = { IN: 'India', AE: 'United Arab Emirates', SA: 'Saudi Arabia', QA: 'Qatar', US: 'United States' };
export const CURRENCY_SYMBOL: Record<string, string> = { INR: '₹', AED: 'AED', SAR: 'SAR', QAR: 'QAR', USD: '$' };
const CAPITAL: Record<CountryCode, { city: string; lat: number; lng: number }> = {
  IN: { city: 'New Delhi', lat: 28.6139, lng: 77.209 }, AE: { city: 'Dubai', lat: 25.2048, lng: 55.2708 }, SA: { city: 'Riyadh', lat: 24.7136, lng: 46.6753 },
  QA: { city: 'Doha', lat: 25.2854, lng: 51.531 }, US: { city: 'New York', lat: 40.7128, lng: -74.006 },
};
export const isGcc = (cc: string) => cc === 'AE' || cc === 'SA' || cc === 'QA';

export const JOURNEY_TEMPLATES: [string, string, string, string][] = [
  ['Vacancy raised', 'A hiring need is identified and a vacancy is raised by the hiring manager.', '#6366f1', 'flag'],
  ['Requisition approval', 'Department head approves the requisition and headcount.', '#8b5cf6', 'check'],
  ['Budget & accounting sign-off', 'Finance confirms the budget for the role.', '#0ea5e9', 'calculator'],
  ['Job description finalised', 'JD is written, graded and attached to the position.', '#14b8a6', 'file'],
  ['Publishing', 'Vacancy is published on job boards and internal channels.', '#22c55e', 'megaphone'],
  ['Sourcing & screening', 'Applications are collected and screened against the JD.', '#84cc16', 'search'],
  ['Interviews', 'Technical, functional and HR interview rounds.', '#eab308', 'users'],
  ['Offer', 'Offer letter issued and accepted by the candidate.', '#f97316', 'mail'],
  ['Document collection', 'Identity, education and previous employment documents collected.', '#ef4444', 'folder'],
  ['Background verification', 'References and background checks completed.', '#ec4899', 'shield'],
  ['Onboarding', 'Accounts, assets and induction completed on day one.', '#a855f7', 'rocket'],
  ['Probation', 'Probation period with periodic reviews.', '#3b82f6', 'clock'],
  ['Confirmation', 'Employment confirmed after a successful probation.', '#10b981', 'award'],
  ['Current role', 'Employee is active in their current role.', '#64748b', 'star'],
];

export const STARTER_DEPARTMENTS: DeptSeed[] = [
  { name: 'Management', code: 'MGMT', color: '#0f172a', icon: 'crown' },
  { name: 'Human Resources', code: 'HR', color: '#db2777', icon: 'heartHandshake', parent: 'MGMT' },
  { name: 'Finance', code: 'FIN', color: '#059669', icon: 'wallet', parent: 'MGMT' },
  { name: 'Operations', code: 'OPS', color: '#2563eb', icon: 'settings', parent: 'MGMT' },
  { name: 'Sales', code: 'SALES', color: '#ea580c', icon: 'trendingUp', parent: 'MGMT' },
];

/* ------------------------------------------------------------------ */
/* Payroll rules per country                                           */
/* ------------------------------------------------------------------ */
/** Professional tax per Indian state (monthly amount, gross threshold). */
const IN_PT: Record<string, { monthly: number; threshold: number }> = {
  Maharashtra: { monthly: 200, threshold: 10000 },   // ₹300 in February — approximated as ₹200 every month
  Kerala: { monthly: 208, threshold: 12000 },        // levied half-yearly (₹1,250 max); spread monthly
  Telangana: { monthly: 200, threshold: 20000 },
  Karnataka: { monthly: 200, threshold: 25000 },
};
/** State income tax as a flat approximation (code SIT, percent of gross). No entry = no state income tax. */
const US_SIT: Record<string, number> = { California: 5, 'New York': 5.5 };
const US_NO_SIT = new Set(['Texas', 'Florida', 'Washington', 'Nevada', 'South Dakota', 'Wyoming', 'Tennessee', 'New Hampshire', 'Alaska']);
export const usStateTaxPercent = (region?: string) => (region && US_SIT[region] !== undefined ? US_SIT[region] : region && US_NO_SIT.has(region) ? 0 : 4);

/** 2026 US federal brackets, single filer (annual). Approximate: withholding is computed on annualised monthly pay. */
const US_FEDERAL_2026 = [
  { upto: 11925, percent: 10 },
  { upto: 48475, percent: 12 },
  { upto: 103350, percent: 22 },
  { upto: 197300, percent: 24 },
  { upto: 250525, percent: 32 },
  { upto: 626350, percent: 35 },
  { upto: null, percent: 37 },
];

const PAYROLL_CALENDAR = {
  input_deadline_days_before: 7,
  attendance_cutoff_days_before: 5,
  generation_days_before: 3,
  client_approval_days_before: 2,
  client_approval_required: true,
};

export function payrollSettingsFor(o: CountryTemplateOpts) {
  const base = { ...DEFAULT_PAYROLL_SETTINGS, currency: o.currency, pay_day: o.pay_day as number | string, ...PAYROLL_CALENDAR };
  if (o.country_code === 'IN') {
    const pt = IN_PT[o.region || ''] || { monthly: 200, threshold: 15000 };
    return { ...base, professional_tax_monthly: pt.monthly, professional_tax_threshold: pt.threshold };
  }
  const none = { pf_employee_percent: 0, pf_employer_percent: 0, pf_wage_ceiling: 0, esi_employee_percent: 0, esi_employer_percent: 0, esi_wage_ceiling: 0, professional_tax_monthly: 0, professional_tax_threshold: 0 };
  if (isGcc(o.country_code)) return { ...base, ...none, tds_slabs: [], standard_deduction_annual: 0 }; // no personal income tax in the GCC
  // US: federal income tax via the slab engine (component code TDS), 2026 standard deduction (single) — approximate.
  return { ...base, ...none, tds_slabs: US_FEDERAL_2026, standard_deduction_annual: 15750 };
}

type CompSpec = [name: string, code: string, type: 'earning' | 'deduction', calc: 'fixed' | 'percent_of_basic' | 'percent_of_gross', value: number, taxable: number, statutory: number, prorate: number];
export function salaryComponentsFor(o: CountryTemplateOpts): CompSpec[] {
  switch (o.country_code) {
    case 'IN': {
      const metro = ['Mumbai', 'Delhi', 'New Delhi', 'Kolkata', 'Chennai'].includes(o.city || '');
      return [
        ['House Rent Allowance', 'HRA', 'earning', 'percent_of_basic', metro ? 50 : 40, 1, 0, 1],
        ['Conveyance Allowance', 'CONV', 'earning', 'fixed', 1600, 1, 0, 1],
        ['Special Allowance', 'SPL', 'earning', 'fixed', 5000, 1, 0, 1],
        ['Provident Fund (Employee)', 'PF', 'deduction', 'percent_of_basic', 12, 0, 1, 1],
        ['ESI (Employee)', 'ESI', 'deduction', 'percent_of_gross', 0.75, 0, 1, 1],
        ['Professional Tax', 'PT', 'deduction', 'fixed', 200, 0, 1, 0],
        ['Income Tax (TDS)', 'TDS', 'deduction', 'fixed', 0, 0, 1, 0],
      ];
    }
    case 'AE':
      return [
        ['Housing Allowance', 'HOUSING', 'earning', 'percent_of_basic', 25, 0, 0, 1],
        ['Transport Allowance', 'TRANSPORT', 'earning', 'fixed', 1000, 0, 0, 1],
        // UAE nationals only: GPSSA pension, 11% employee share (overridden to 11 on nationals' structures).
        ['Pension (GPSSA)', 'GPSSA', 'deduction', 'percent_of_basic', 0, 0, 1, 1],
      ];
    case 'SA':
      return [
        ['Housing Allowance', 'HOUSING', 'earning', 'percent_of_basic', 25, 0, 0, 1],
        ['Transport Allowance', 'TRANSPORT', 'earning', 'percent_of_basic', 10, 0, 0, 1],
        // Saudi nationals only: GOSI 9.75% of basic + housing (approximated on basic; overridden per structure).
        ['Social Insurance (GOSI)', 'GOSI', 'deduction', 'percent_of_basic', 0, 0, 1, 1],
      ];
    case 'QA':
      return [
        ['Housing Allowance', 'HOUSING', 'earning', 'percent_of_basic', 30, 0, 0, 1],
        ['Transport Allowance', 'TRANSPORT', 'earning', 'fixed', 800, 0, 0, 1],
        // Qatari nationals only: GRSIA pension, 7% employee share.
        ['Pension (GRSIA)', 'GRSIA', 'deduction', 'percent_of_basic', 0, 0, 1, 1],
      ];
    case 'US': {
      const sit = usStateTaxPercent(o.region);
      const list: CompSpec[] = [
        ['Federal income tax', 'TDS', 'deduction', 'fixed', 0, 0, 1, 0],   // computed from tds_slabs
        ['Social Security', 'SS', 'deduction', 'percent_of_gross', 6.2, 0, 1, 1],   // wage-base cap ignored (approximate)
        ['Medicare', 'MED', 'deduction', 'percent_of_gross', 1.45, 0, 1, 1],
      ];
      if (sit > 0) list.push([`State income tax (${o.region})`, 'SIT', 'deduction', 'percent_of_gross', sit, 0, 1, 1]);
      list.push(['401(k) contribution', 'K401', 'deduction', 'percent_of_basic', 0, 0, 0, 1]);   // opt-in: 4% override
      return list;
    }
  }
}

type LeaveSpec = [name: string, code: string, quota: number, paid: number, carry: number, maxCarry: number, doc: number, notice: number, color: string];
export function leaveTypesFor(o: CountryTemplateOpts): LeaveSpec[] {
  const co: LeaveSpec = ['Comp Off', 'CO', 0, 1, 0, 0, 0, 1, '#16a34a'];
  switch (o.country_code) {
    case 'IN': return [
      ['Casual Leave', 'CL', 12, 1, 0, 0, 0, 1, '#2563eb'],
      ['Sick Leave', 'SL', 12, 1, 0, 0, 1, 0, '#dc2626'],
      ['Earned Leave', 'EL', 15, 1, 1, 30, 0, 7, '#0891b2'],
      co,
      ['Unpaid Leave', 'LWP', 365, 0, 0, 0, 0, 0, '#6b7280'],
      ['Maternity Leave', 'ML', 182, 1, 0, 0, 1, 30, '#db2777'],
    ];
    case 'AE': return [
      ['Annual Leave', 'AL', 30, 1, 1, 15, 0, 14, '#2563eb'],
      ['Sick Leave', 'SL', 15, 1, 0, 0, 1, 0, '#dc2626'],
      ['Maternity Leave', 'ML', 60, 1, 0, 0, 1, 30, '#db2777'],
      ['Parental Leave', 'PL', 5, 1, 0, 0, 1, 0, '#a855f7'],
      ['Hajj Leave', 'HJ', 30, 0, 0, 0, 1, 30, '#0d9488'],
      co,
      ['Unpaid Leave', 'LWP', 365, 0, 0, 0, 0, 0, '#6b7280'],
    ];
    case 'SA': return [
      ['Annual Leave', 'AL', 21, 1, 1, 10, 0, 14, '#2563eb'],
      ['Sick Leave', 'SL', 30, 1, 0, 0, 1, 0, '#dc2626'],
      ['Maternity Leave', 'ML', 70, 1, 0, 0, 1, 30, '#db2777'],
      ['Hajj Leave', 'HJ', 10, 1, 0, 0, 1, 30, '#0d9488'],
      ['Marriage Leave', 'MR', 5, 1, 0, 0, 1, 7, '#f59e0b'],
      ['Bereavement Leave', 'BR', 5, 1, 0, 0, 0, 0, '#475569'],
      co,
      ['Unpaid Leave', 'LWP', 365, 0, 0, 0, 0, 0, '#6b7280'],
    ];
    case 'QA': return [
      ['Annual Leave', 'AL', 21, 1, 1, 10, 0, 14, '#2563eb'],
      ['Sick Leave', 'SL', 14, 1, 0, 0, 1, 0, '#dc2626'],
      ['Maternity Leave', 'ML', 50, 1, 0, 0, 1, 30, '#db2777'],
      ['Hajj Leave', 'HJ', 20, 0, 0, 0, 1, 30, '#0d9488'],
      co,
      ['Unpaid Leave', 'LWP', 365, 0, 0, 0, 0, 0, '#6b7280'],
    ];
    case 'US': return [
      ['Paid Time Off', 'PTO', 15, 1, 1, 5, 0, 7, '#2563eb'],
      ['Sick Leave', 'SL', 5, 1, 0, 0, 0, 0, '#dc2626'],         // California minimum is 5 days / 40 hours
      ['FMLA Leave', 'FMLA', 60, 0, 0, 0, 1, 30, '#7c3aed'],    // 12 weeks unpaid, job-protected
      ['Parental Leave', 'PL', 10, 1, 0, 0, 1, 30, '#db2777'],
      co,
      ['Unpaid Leave', 'LWP', 365, 0, 0, 0, 0, 0, '#6b7280'],
    ];
  }
}

type DocSpec = [key: string, name: string, formats: string[], requiresExpiry: number, warn: number, crit: number, requiredForAll: number, category: string];
export function documentTypesFor(o: CountryTemplateOpts): DocSpec[] {
  const pdfImg = ['pdf', 'jpg', 'png'];
  switch (o.country_code) {
    case 'IN': return [
      ['pan', 'PAN Card', pdfImg, 0, 30, 7, 1, 'Identity'],
      ['aadhaar', 'Aadhaar Card', pdfImg, 0, 30, 7, 1, 'Identity'],
      ['passport', 'Passport', pdfImg, 1, 180, 30, 0, 'Identity'],
      ['contract', 'Employment Contract', ['pdf'], 0, 60, 14, 1, 'Employment'],
      ['degree', 'Degree Certificate', pdfImg, 0, 30, 7, 0, 'Education'],
      ['dl', 'Driving Licence', ['jpg', 'png', 'pdf'], 1, 60, 14, 0, 'Identity'],
    ];
    case 'AE': return [
      ['passport', 'Passport', pdfImg, 1, 180, 30, 1, 'Identity'],
      ['visa', 'Residence Visa', pdfImg, 1, 60, 14, 0, 'Immigration'],
      ['national_id', 'Emirates ID', pdfImg, 1, 60, 14, 1, 'Identity'],
      ['work_permit', 'Labour Card (MOHRE work permit)', pdfImg, 1, 60, 14, 0, 'Immigration'],
      ['insurance', 'Medical Insurance Card', pdfImg, 1, 45, 7, 1, 'Benefits'],
      ['contract', 'Employment Contract', ['pdf'], 1, 60, 14, 1, 'Employment'],
    ];
    case 'SA': return [
      ['passport', 'Passport', pdfImg, 1, 180, 30, 0, 'Identity'],
      ['visa', 'Iqama (Residence Permit)', pdfImg, 1, 60, 14, 0, 'Immigration'],
      ['national_id', 'Saudi National ID', pdfImg, 1, 60, 14, 0, 'Identity'],
      ['work_permit', 'Work Permit (Qiwa)', pdfImg, 1, 60, 14, 0, 'Immigration'],
      ['insurance', 'Medical Insurance (CCHI)', pdfImg, 1, 45, 7, 1, 'Benefits'],
      ['contract', 'Employment Contract', ['pdf'], 1, 60, 14, 1, 'Employment'],
    ];
    case 'QA': return [
      ['passport', 'Passport', pdfImg, 1, 180, 30, 1, 'Identity'],
      ['visa', 'Residence Permit', pdfImg, 1, 60, 14, 0, 'Immigration'],
      ['national_id', 'Qatar ID (QID)', pdfImg, 1, 60, 14, 1, 'Identity'],
      ['work_permit', 'Work Permit', pdfImg, 1, 60, 14, 0, 'Immigration'],
      ['insurance', 'Health Card / Medical Insurance', pdfImg, 1, 45, 7, 1, 'Benefits'],
      ['contract', 'Employment Contract', ['pdf'], 1, 60, 14, 1, 'Employment'],
    ];
    case 'US': return [
      ['i9', 'Form I-9 (Employment Eligibility)', ['pdf'], 0, 30, 7, 1, 'Compliance'],
      ['w4', 'Form W-4', ['pdf'], 0, 30, 7, 1, 'Tax'],
      ['dl', "Driver's License", pdfImg, 1, 60, 14, 0, 'Identity'],
      ['state_id', 'State ID', pdfImg, 1, 60, 14, 0, 'Identity'],
      ['work_auth', 'Work Authorization (EAD / visa)', pdfImg, 1, 90, 30, 0, 'Immigration'],
      ['license', 'Professional License', pdfImg, 1, 60, 14, 0, 'Compliance'],
    ];
  }
}

type FieldSpec = [key: string, label: string, type: string, options: string[], section: string];
export function customFieldsFor(o: CountryTemplateOpts): FieldSpec[] {
  const blood: FieldSpec = ['blood_group', 'Blood group', 'select', ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'], 'Personal'];
  if (o.country_code === 'IN') return [blood, ['uan', 'UAN', 'text', [], 'Statutory'], ['aadhaar_last4', 'Aadhaar (last 4 digits)', 'text', [], 'Statutory'], ['tshirt_size', 'T-shirt size', 'select', ['XS', 'S', 'M', 'L', 'XL', 'XXL'], 'Personal']];
  if (isGcc(o.country_code)) return [blood, ['passport_number', 'Passport number', 'text', [], 'Immigration'], ['visa_expiry', o.country_code === 'SA' ? 'Iqama expiry' : 'Residence visa expiry', 'date', [], 'Immigration'], ['sponsor', 'Visa sponsor', 'text', [], 'Immigration'], ['hajj_eligible', 'Hajj eligible', 'boolean', [], 'Leave']];
  return [blood, ['w4_filing_status', 'W-4 filing status', 'select', ['Single', 'Married filing jointly', 'Head of household'], 'Tax'], ['work_authorization', 'Work authorization', 'select', ['US citizen', 'Permanent resident', 'H-1B', 'L-1', 'OPT / EAD'], 'Compliance'], ['state', 'State of residence', 'text', [], 'Tax']];
}

export function defaultShiftFor(cc: CountryCode): ShiftSeed {
  if (cc === 'IN') return { name: 'General (09:30–18:30)', start_time: '09:30', end_time: '18:30', break_minutes_allowed: 60 };
  if (cc === 'US') return { name: 'Day (09:00–17:30)', start_time: '09:00', end_time: '17:30', break_minutes_allowed: 30 };
  return { name: 'General (08:00–17:00)', start_time: '08:00', end_time: '17:00', break_minutes_allowed: 60 };
}
export const workingDays = (weeklyOffs: number[]) => [0, 1, 2, 3, 4, 5, 6].filter((d) => !weeklyOffs.includes(d));
const shiftMinutes = (s: ShiftSeed) => {
  const m = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  return (m(s.end_time) - m(s.start_time) + 1440) % 1440;
};
export function insertShift(s: ShiftSeed, weeklyOffs: number[]) {
  const span = shiftMinutes(s), brk = s.break_minutes_allowed ?? 60;
  return insert('shifts', { name: s.name, start_time: s.start_time, end_time: s.end_time, grace_minutes: s.grace_minutes ?? 10, break_minutes_allowed: brk, half_day_minutes: 240, full_day_minutes: Math.min(480, span - brk), working_days: workingDays(weeklyOffs), active: 1 });
}

const initials = (name: string) => name.split(/\s+/).filter((w) => /^[A-Za-z]/.test(w)).map((w) => w[0].toUpperCase()).join('').slice(0, 3) || 'EMP';

/** Settings + master data rows, without opening a transaction (callers wrap it). */
export function applyTemplateRows(o: CountryTemplateOpts): TemplateResult {
  const now = nowIso();
  const slug = currentCompanySlug();
  const cc = o.country_code;
  const cap = CAPITAL[cc];
  const city = o.city || cap.city;
  const country = COUNTRY_NAME[cc];

  setSetting('company', {
    ...DEFAULT_COMPANY,
    name: o.name,
    legal_name: o.legal_name || o.name,
    tagline: o.tagline || DEFAULT_COMPANY.tagline,
    address: o.address || [city, o.region, country].filter(Boolean).join(', '),
    email: o.email || `hr@${slug}.example`,
    phone: o.phone || DEFAULT_COMPANY.phone,
    website: o.website || `https://${slug}.example`,
    currency: o.currency,
    currency_symbol: CURRENCY_SYMBOL[o.currency] || o.currency,
    timezone: o.timezone,
    date_format: cc === 'US' ? 'MMM DD, YYYY' : 'DD MMM YYYY',
    week_start: cc === 'IN' || cc === 'AE' ? 1 : 0,
    logo_text: o.logo_text || o.name.slice(0, 1).toUpperCase(),
    brand_color: o.brand_color || DEFAULT_COMPANY.brand_color,
    accent_color: o.accent_color || DEFAULT_COMPANY.accent_color,
    employee_code_prefix: o.employee_code_prefix || initials(o.name),
    financial_year_start_month: cc === 'IN' ? 4 : 1,
    country_code: cc,
    country,
    region: o.region || null,
  });
  setSetting('payroll', payrollSettingsFor(o));
  setSetting('attendance', {
    ...DEFAULT_ATTENDANCE_SETTINGS,
    weekly_offs: [...o.weekly_offs],
    allow_remote_punch: !!o.remote_friendly,
    standard_work_minutes: cc === 'IN' ? 540 : 480,
    overtime_after_minutes: cc === 'IN' ? 540 : 480,
  });
  setSetting('leave', { ...DEFAULT_LEAVE_SETTINGS, comp_off: { ...DEFAULT_LEAVE_SETTINGS.comp_off, leave_type_code: 'CO' } });
  setSetting('documents', { ...DEFAULT_DOCUMENT_SETTINGS, expiry_warning_days: isGcc(cc) ? 60 : 30, expiry_critical_days: isGcc(cc) ? 14 : 7 });

  // Departments (tree; parents must come before children).
  const departments: Record<string, number> = {};
  (o.departments || STARTER_DEPARTMENTS).forEach((d, i) => {
    departments[d.code] = insert('departments', { name: d.name, code: d.code, parent_id: d.parent ? departments[d.parent] ?? null : null, color: d.color, icon: d.icon, description: d.description || null, sort_order: i, active: 1, created_at: now });
  });

  const locationId = insert('work_locations', { name: o.location_name || `${city} office`, address: o.address || [city, o.region, country].filter(Boolean).join(', '), lat: o.lat ?? cap.lat, lng: o.lng ?? cap.lng, radius_m: 200, active: 1, created_at: now });
  const shiftId = insertShift(o.default_shift || defaultShiftFor(cc), o.weekly_offs);

  const components: Record<string, number> = {};
  salaryComponentsFor(o).forEach(([name, code, type, calc, value, taxable, statutory, prorate], i) => {
    components[code] = insert('salary_components', { name, code, type, calc_type: calc, default_value: value, taxable, statutory, prorate, sort_order: i + 1, active: 1 });
  });

  const leaveTypes: Record<string, number> = {};
  for (const [name, code, quota, paid, cf, maxCf, doc, notice, color] of leaveTypesFor(o)) {
    leaveTypes[code] = insert('leave_types', { name, code, annual_quota: quota, paid, carry_forward: cf, max_carry_forward: maxCf, requires_document: doc, min_notice_days: notice, allow_half_day: 1, color, active: 1 });
  }

  const year = Number(today().slice(0, 4));
  for (const y of [year, year + 1]) for (const h of holidaysFor(cc, o.region, y)) insert('holidays', { name: h.name, date: h.date, optional: 0 });

  const docTypes: Record<string, number> = {};
  for (const [key, name, formats, exp, warn, crit, reqAll, category] of documentTypesFor(o)) {
    docTypes[key] = insert('document_types', { name, allowed_formats: formats, requires_expiry: exp, expiry_warning_days: warn, expiry_critical_days: crit, required_for_all: reqAll, max_size_mb: 10, category, active: 1 });
  }
  customFieldsFor(o).forEach(([key, label, type, options, section], i) => insert('custom_field_defs', { entity: 'employee', key, label, type, options, required: 0, section, sort_order: i, active: 1 }));

  JOURNEY_TEMPLATES.forEach(([name, description, color, icon], i) => insert('journey_stage_templates', { name, description, sort_order: i, color, icon, owner_role: 'hr', sla_days: 7, active: 1 }));

  return { departments, locationId, shiftId, components, leaveTypes, docTypes };
}

/**
 * Set up a brand-new, EMPTY company (no people) in the current tenant context: settings, salary
 * components, leave types, holidays (this + next year), document types, custom fields, journey
 * templates, one work location, one default shift and a starter set of departments.
 */
export function applyCountryTemplate(opts: CountryTemplateOpts): TemplateResult {
  return transaction(() => applyTemplateRows(opts));
}
