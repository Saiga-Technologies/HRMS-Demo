/**
 * Demo client companies managed by the demo agency: three per market (India, GCC, US).
 * `weekly_offs` uses JS day numbers (0 = Sunday … 6 = Saturday): GCC weekends differ by country.
 * `pay_day` drives the payroll calendar; `run_state` is where this month's payroll stands in the demo.
 */
export type Market = 'IN' | 'GCC' | 'US';
export interface DemoCompany {
  slug: string;
  name: string;
  legal_name: string;
  market: Market;
  country_code: 'IN' | 'AE' | 'SA' | 'QA' | 'US';
  country: string;
  region: string;           // state / emirate / province
  region_code?: string;     // GST state code for India
  city: string;
  lat: number;
  lng: number;
  currency: 'INR' | 'AED' | 'SAR' | 'QAR' | 'USD';
  timezone: string;
  industry: string;
  employees: number;        // headcount to generate (>= 50)
  weekly_offs: number[];
  pay_day: number | 'last_working_day';
  run_state: 'none' | 'draft' | 'processed' | 'approved';
  logo_text: string;
  brand_color: string;
  account_manager: 'am.india' | 'am.gcc' | 'am.us';
  client_tax_id: string;
}

export const DEMO_COMPANIES: DemoCompany[] = [
  // ---------------- India ----------------
  { slug: 'nimbus-retail', name: 'Nimbus Retail', legal_name: 'Nimbus Retail Private Limited', market: 'IN', country_code: 'IN', country: 'India', region: 'Maharashtra', region_code: '27', city: 'Mumbai', lat: 19.076, lng: 72.8777, currency: 'INR', timezone: 'Asia/Kolkata', industry: 'Retail', employees: 64, weekly_offs: [0], pay_day: 'last_working_day', run_state: 'none', logo_text: 'N', brand_color: '#0F766E', account_manager: 'am.india', client_tax_id: '27AAICN4821K1Z3' },
  { slug: 'tejas-infotech', name: 'Tejas Infotech', legal_name: 'Tejas Infotech Private Limited', market: 'IN', country_code: 'IN', country: 'India', region: 'Kerala', region_code: '32', city: 'Kochi', lat: 10.0159, lng: 76.3419, currency: 'INR', timezone: 'Asia/Kolkata', industry: 'IT services', employees: 58, weekly_offs: [0, 6], pay_day: 18, run_state: 'draft', logo_text: 'T', brand_color: '#1D4ED8', account_manager: 'am.india', client_tax_id: '32AAGCT7310M1Z8' },
  { slug: 'ganga-pharma', name: 'Ganga Pharma', legal_name: 'Ganga Pharmaceuticals Limited', market: 'IN', country_code: 'IN', country: 'India', region: 'Telangana', region_code: '36', city: 'Hyderabad', lat: 17.385, lng: 78.4867, currency: 'INR', timezone: 'Asia/Kolkata', industry: 'Pharmaceutical manufacturing', employees: 72, weekly_offs: [0], pay_day: 25, run_state: 'processed', logo_text: 'G', brand_color: '#B45309', account_manager: 'am.india', client_tax_id: '36AACCG5512Q1Z1' },
  // ---------------- GCC ----------------
  { slug: 'falcon-logistics', name: 'Falcon Logistics', legal_name: 'Falcon Logistics LLC', market: 'GCC', country_code: 'AE', country: 'United Arab Emirates', region: 'Dubai', city: 'Dubai', lat: 25.2048, lng: 55.2708, currency: 'AED', timezone: 'Asia/Dubai', industry: 'Logistics & freight', employees: 66, weekly_offs: [0, 6], pay_day: 25, run_state: 'none', logo_text: 'F', brand_color: '#7C2D12', account_manager: 'am.gcc', client_tax_id: '100347825600003' },
  { slug: 'najd-construction', name: 'Najd Construction', legal_name: 'Najd Construction Company', market: 'GCC', country_code: 'SA', country: 'Saudi Arabia', region: 'Riyadh', city: 'Riyadh', lat: 24.7136, lng: 46.6753, currency: 'SAR', timezone: 'Asia/Riyadh', industry: 'Construction', employees: 70, weekly_offs: [5, 6], pay_day: 27, run_state: 'approved', logo_text: 'N', brand_color: '#166534', account_manager: 'am.gcc', client_tax_id: '310456789000003' },
  { slug: 'pearl-hospitality', name: 'Pearl Hospitality', legal_name: 'Pearl Hospitality Group WLL', market: 'GCC', country_code: 'QA', country: 'Qatar', region: 'Doha', city: 'Doha', lat: 25.2854, lng: 51.531, currency: 'QAR', timezone: 'Asia/Qatar', industry: 'Hotels & hospitality', employees: 56, weekly_offs: [5, 6], pay_day: 18, run_state: 'processed', logo_text: 'P', brand_color: '#6D28D9', account_manager: 'am.gcc', client_tax_id: 'QA-CR-145872' },
  // ---------------- United States ----------------
  { slug: 'redwood-health', name: 'Redwood Health', legal_name: 'Redwood Health Partners, Inc.', market: 'US', country_code: 'US', country: 'United States', region: 'California', city: 'San Francisco', lat: 37.7749, lng: -122.4194, currency: 'USD', timezone: 'America/Los_Angeles', industry: 'Healthcare clinics', employees: 62, weekly_offs: [0, 6], pay_day: 'last_working_day', run_state: 'none', logo_text: 'R', brand_color: '#BE123C', account_manager: 'am.us', client_tax_id: '94-3187265' },
  { slug: 'hudson-analytics', name: 'Hudson Analytics', legal_name: 'Hudson Analytics LLC', market: 'US', country_code: 'US', country: 'United States', region: 'New York', city: 'New York', lat: 40.7128, lng: -74.006, currency: 'USD', timezone: 'America/New_York', industry: 'Data & analytics consulting', employees: 54, weekly_offs: [0, 6], pay_day: 20, run_state: 'draft', logo_text: 'H', brand_color: '#0369A1', account_manager: 'am.us', client_tax_id: '13-4471902' },
  { slug: 'lonestar-energy', name: 'Lone Star Energy', legal_name: 'Lone Star Energy Services, Inc.', market: 'US', country_code: 'US', country: 'United States', region: 'Texas', city: 'Houston', lat: 29.7604, lng: -95.3698, currency: 'USD', timezone: 'America/Chicago', industry: 'Oilfield services', employees: 68, weekly_offs: [0], pay_day: 25, run_state: 'approved', logo_text: 'L', brand_color: '#A16207', account_manager: 'am.us', client_tax_id: '76-0598314' },
];
export const demoCompany = (slug: string) => DEMO_COMPANIES.find((c) => c.slug === slug);
