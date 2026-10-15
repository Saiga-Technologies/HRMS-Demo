/**
 * Per-company flavour for the nine demo companies: address, phone, organisation (departments,
 * positions, team leads), shifts, a second site and open vacancies. Keyed by registry slug.
 */
import type { DeptSeed, ShiftSeed } from './countries.js';

export interface DeptOrg extends DeptSeed {
  head: string;                                // head position title (level 8; the CEO in the executive department)
  leads?: string[];                            // team-lead positions (level 6), one person each
  fixed?: [title: string, level: number, count: number][];
  staff?: [title: string, level: number, weight: number][];
  ops?: boolean;                               // works the operational / rotating shifts
  wfh?: boolean;                               // may work from home some days
}
export interface VacancySeed {
  title: string; dept: string; openings: number; budget_annual: number;
  summary: string; responsibilities: string[]; requirements: string[]; skills: string[];
  experience_min: number; experience_max: number; salary_min: number; salary_max: number;
}
export interface CompanyProfile {
  address: string;
  phone: string;
  tagline: string;
  accent_color: string;
  prefix: string;
  hq_name: string;
  site2?: { name: string; address: string; lat: number; lng: number; city: string };
  default_shift?: ShiftSeed;
  ops_shifts?: ShiftSeed[];
  org: DeptOrg[];                              // first = executive department (head = CEO)
  vacancies: VacancySeed[];
  assets: [name: string, category: string, model: string, vendor: string, cost: number][];
  employment_mix?: [type: string, weight: number][];
}

const hr = (title = 'Head of HR'): DeptOrg => ({ name: 'Human Resources', code: 'HR', color: '#db2777', icon: 'heartHandshake', parent: 'EXEC', head: title, fixed: [['Payroll Specialist', 5, 1], ['HR Executive', 4, 2]] });
const fin = (title = 'Finance Manager'): DeptOrg => ({ name: 'Finance', code: 'FIN', color: '#059669', icon: 'wallet', parent: 'EXEC', head: title, staff: [['Accountant', 4, 2], ['Accounts Assistant', 3, 1]] });
const exec = (ceo = 'Chief Executive Officer', extra: [string, number, number][] = [['Executive Assistant', 4, 1]]): DeptOrg => ({ name: 'Executive Office', code: 'EXEC', color: '#0f172a', icon: 'crown', head: ceo, fixed: extra });

export const PROFILES: Record<string, CompanyProfile> = {
  'nimbus-retail': {
    address: 'Kamala Mills Compound, Senapati Bapat Marg, Lower Parel, Mumbai, Maharashtra 400013, India',
    phone: '+91 22 4012 7700', tagline: 'Everyday essentials, closer to home.', accent_color: '#F59E0B', prefix: 'NR', hq_name: 'Lower Parel Head Office',
    site2: { name: 'Bhiwandi Distribution Centre', address: 'Mumbai–Nashik Highway, Bhiwandi, Thane, Maharashtra 421302', lat: 19.2813, lng: 73.0483, city: 'Bhiwandi' },
    ops_shifts: [{ name: 'Store Morning (10:00–19:00)', start_time: '10:00', end_time: '19:00', break_minutes_allowed: 60 }, { name: 'Store Evening (13:00–22:00)', start_time: '13:00', end_time: '22:00', break_minutes_allowed: 60 }],
    org: [
      exec('Managing Director'),
      { name: 'Store Operations', code: 'STORE', color: '#0F766E', icon: 'cart', parent: 'EXEC', head: 'Head of Retail Operations', leads: ['Store Manager – Andheri', 'Store Manager – Thane'], staff: [['Retail Sales Associate', 3, 6], ['Cashier', 3, 3], ['Visual Merchandiser', 4, 1]], ops: true },
      { name: 'Merchandising', code: 'MERCH', color: '#7c3aed', icon: 'box', parent: 'EXEC', head: 'Head of Merchandising', staff: [['Category Buyer', 5, 2], ['Merchandise Planner', 4, 1]] },
      { name: 'Supply Chain', code: 'SCM', color: '#b45309', icon: 'truck', parent: 'EXEC', head: 'Supply Chain Manager', leads: ['Warehouse Supervisor'], staff: [['Warehouse Associate', 3, 3], ['Inventory Controller', 4, 1]], ops: true },
      { name: 'Marketing', code: 'MKT', color: '#ea580c', icon: 'megaphone', parent: 'EXEC', head: 'Marketing Manager', staff: [['Marketing Executive', 4, 1], ['Digital Marketing Specialist', 4, 1]] },
      { name: 'Customer Service', code: 'CS', color: '#0891b2', icon: 'headset', parent: 'STORE', head: 'Customer Service Manager', staff: [['Customer Service Associate', 3, 2]], ops: true },
      { name: 'Information Technology', code: 'IT', color: '#2563eb', icon: 'laptop', parent: 'EXEC', head: 'IT Manager', staff: [['IT Support Engineer', 4, 1], ['POS Systems Analyst', 4, 1]] },
      hr(), fin(),
    ],
    vacancies: [
      { title: 'Store Manager – Powai', dept: 'STORE', openings: 1, budget_annual: 1100000, summary: 'Run a high-footfall neighbourhood store: sales, staff rosters, stock and customer experience.', responsibilities: ['Own store P&L and daily sales targets', 'Roster and coach a team of 12 associates', 'Control shrinkage and stock accuracy'], requirements: ['5+ years in modern retail, 2+ as store or department manager', 'Comfortable with POS and inventory systems'], skills: ['Retail operations', 'Team management', 'Inventory management', 'Customer service', 'Visual merchandising'], experience_min: 5, experience_max: 10, salary_min: 800000, salary_max: 1200000 },
      { title: 'Retail Sales Associate', dept: 'STORE', openings: 4, budget_annual: 300000, summary: 'Help customers on the floor, run the till and keep shelves full and tidy.', responsibilities: ['Assist customers and drive add-on sales', 'Operate POS and handle returns', 'Replenish and face shelves'], requirements: ['12th pass or graduate', 'Good communication in Marathi, Hindi or English'], skills: ['Customer service', 'Sales', 'POS', 'Communication'], experience_min: 0, experience_max: 3, salary_min: 216000, salary_max: 300000 },
    ],
    assets: [['Lenovo ThinkPad E14', 'Laptop', 'ThinkPad E14 Gen 5', 'Lenovo', 62000], ['Zebra TC52 Handheld', 'Phone', 'TC52', 'Zebra', 48000], ['Samsung Galaxy A35', 'Phone', 'Galaxy A35', 'Samsung', 30000], ['Dell 24" Monitor', 'Monitor', 'P2423', 'Dell', 16000], ['Lenovo ThinkPad E14', 'Laptop', 'ThinkPad E14 Gen 5', 'Lenovo', 62000]],
    employment_mix: [['full_time', 85], ['part_time', 10], ['contract', 5]],
  },
  'tejas-infotech': {
    address: '3rd Floor, Thapasya Building, Infopark Phase 1, Kakkanad, Kochi, Kerala 682042, India',
    phone: '+91 484 271 5500', tagline: 'Engineering that ships.', accent_color: '#22C55E', prefix: 'TI', hq_name: 'Infopark Kochi',
    site2: { name: 'Technopark Thiruvananthapuram', address: 'Technopark Phase 3, Kazhakkoottam, Thiruvananthapuram, Kerala 695581', lat: 8.5581, lng: 76.8816, city: 'Thiruvananthapuram' },
    ops_shifts: [{ name: 'Support Late (13:00–22:00)', start_time: '13:00', end_time: '22:00', break_minutes_allowed: 60 }],
    org: [
      exec('Chief Executive Officer', [['Chief Technology Officer', 9, 1]]),
      { name: 'Delivery', code: 'DEL', color: '#1D4ED8', icon: 'code', parent: 'EXEC', head: 'Head of Delivery', leads: ['Engineering Manager', 'Technical Lead'], staff: [['Senior Software Engineer', 5, 4], ['Software Engineer', 4, 7], ['Associate Software Engineer', 3, 3]], wfh: true },
      { name: 'Platform & Cloud', code: 'PLAT', color: '#0891b2', icon: 'server', parent: 'DEL', head: 'Platform Lead', staff: [['DevOps Engineer', 5, 2], ['Cloud Engineer', 4, 1]], wfh: true },
      { name: 'Quality Assurance', code: 'QA', color: '#16a34a', icon: 'check', parent: 'DEL', head: 'QA Manager', staff: [['QA Engineer', 4, 3], ['Automation Test Engineer', 5, 1]], wfh: true },
      { name: 'Sales & Accounts', code: 'SALES', color: '#ea580c', icon: 'trendingUp', parent: 'EXEC', head: 'VP Sales', staff: [['Business Development Manager', 5, 2], ['Pre-sales Consultant', 5, 1]] },
      { name: 'IT Support', code: 'ITS', color: '#64748b', icon: 'laptop', parent: 'EXEC', head: 'IT Support Lead', staff: [['Support Engineer', 3, 2]], ops: true },
      hr('HR Manager'), fin(),
    ],
    vacancies: [
      { title: 'Senior React Developer', dept: 'DEL', openings: 2, budget_annual: 2200000, summary: 'Build customer-facing web apps for our US and GCC clients.', responsibilities: ['Ship React features end to end', 'Review code and mentor juniors', 'Work directly with client product owners'], requirements: ['5+ years of front-end development', 'Strong TypeScript and React', 'Experience with REST and GraphQL APIs'], skills: ['React', 'TypeScript', 'JavaScript', 'GraphQL', 'Jest', 'Git'], experience_min: 5, experience_max: 9, salary_min: 1600000, salary_max: 2400000 },
      { title: 'QA Automation Engineer', dept: 'QA', openings: 1, budget_annual: 1000000, summary: 'Own automated regression suites for web and mobile projects.', responsibilities: ['Write Playwright / Selenium suites', 'Run regression in CI', 'Report and triage defects'], requirements: ['2+ years in test automation', 'Comfortable with JavaScript or Java'], skills: ['Selenium', 'Playwright', 'Java', 'JavaScript', 'CI/CD'], experience_min: 2, experience_max: 5, salary_min: 700000, salary_max: 1100000 },
    ],
    assets: [['Dell Latitude 5440', 'Laptop', 'Latitude 5440', 'Dell', 85000], ['MacBook Pro 14"', 'Laptop', 'MacBook Pro M3', 'Apple', 190000], ['Dell Latitude 5440', 'Laptop', 'Latitude 5440', 'Dell', 85000], ['Jabra Evolve2 65', 'Headset', 'Evolve2 65', 'Jabra', 18000], ['LG 27" 4K Monitor', 'Monitor', '27UP850', 'LG', 32000], ['MacBook Air 13"', 'Laptop', 'MacBook Air M3', 'Apple', 115000]],
    employment_mix: [['full_time', 88], ['contract', 6], ['intern', 6]],
  },
  'ganga-pharma': {
    address: 'Plot 42, Genome Valley, Turkapally, Shamirpet Mandal, Hyderabad, Telangana 500078, India',
    phone: '+91 40 2348 9100', tagline: 'Quality medicines, made in India.', accent_color: '#0EA5E9', prefix: 'GP', hq_name: 'Genome Valley Campus',
    site2: { name: 'Pashamylaram Formulation Plant', address: 'IDA Pashamylaram, Patancheru, Sangareddy, Telangana 502307', lat: 17.5326, lng: 78.1872, city: 'Sangareddy' },
    ops_shifts: [{ name: 'Shift A (06:00–14:00)', start_time: '06:00', end_time: '14:00', break_minutes_allowed: 30 }, { name: 'Shift B (14:00–22:00)', start_time: '14:00', end_time: '22:00', break_minutes_allowed: 30 }],
    org: [
      exec('Managing Director', [['Director – Operations', 9, 1]]),
      { name: 'Production', code: 'PROD', color: '#B45309', icon: 'factory', parent: 'EXEC', head: 'Plant Head', leads: ['Production Manager', 'Shift In-charge'], staff: [['Production Chemist', 4, 6], ['Machine Operator', 3, 6], ['Packing Supervisor', 4, 1]], ops: true },
      { name: 'Quality Control', code: 'QC', color: '#0284c7', icon: 'flask', parent: 'EXEC', head: 'Head of Quality', leads: ['QC Manager'], staff: [['QC Analyst', 4, 4], ['Microbiologist', 4, 2], ['QA Officer', 4, 2]], ops: true },
      { name: 'Research & Development', code: 'RND', color: '#7c3aed', icon: 'sparkles', parent: 'EXEC', head: 'Head of R&D', staff: [['Formulation Scientist', 5, 3], ['Research Associate', 4, 2]] },
      { name: 'Regulatory Affairs', code: 'RA', color: '#475569', icon: 'scale', parent: 'EXEC', head: 'Regulatory Affairs Manager', staff: [['Regulatory Affairs Executive', 4, 2]] },
      { name: 'Supply Chain', code: 'SCM', color: '#a16207', icon: 'truck', parent: 'EXEC', head: 'Supply Chain Manager', staff: [['Stores Officer', 4, 2], ['Procurement Executive', 4, 1]] },
      { name: 'Sales & Marketing', code: 'SALES', color: '#ea580c', icon: 'trendingUp', parent: 'EXEC', head: 'National Sales Manager', staff: [['Area Sales Manager', 5, 2], ['Medical Representative', 3, 3]] },
      hr('Head of HR'), fin('Finance Controller'),
    ],
    vacancies: [
      { title: 'QC Analyst (HPLC)', dept: 'QC', openings: 2, budget_annual: 600000, summary: 'Analyse raw materials and finished products in a USFDA-approved QC lab.', responsibilities: ['Run HPLC / GC analysis', 'Maintain GLP documentation', 'Support OOS investigations'], requirements: ['M.Sc Chemistry or B.Pharm', '2+ years in a GMP QC lab'], skills: ['HPLC', 'GC', 'GLP', 'GMP', 'Documentation'], experience_min: 2, experience_max: 6, salary_min: 420000, salary_max: 650000 },
    ],
    assets: [['HP ProBook 440', 'Laptop', 'ProBook 440 G10', 'HP', 68000], ['HP ProBook 440', 'Laptop', 'ProBook 440 G10', 'HP', 68000], ['Samsung Galaxy Tab A9', 'Phone', 'Galaxy Tab A9', 'Samsung', 22000], ['Mahindra Bolero (field)', 'Vehicle', 'Bolero B6', 'Mahindra', 950000]],
    employment_mix: [['full_time', 85], ['contract', 15]],
  },
  'falcon-logistics': {
    address: 'Warehouse 14, Al Quoz Industrial Area 3, PO Box 61234, Dubai, United Arab Emirates',
    phone: '+971 4 338 2100', tagline: 'Freight, forwarded.', accent_color: '#F97316', prefix: 'FL', hq_name: 'Al Quoz Head Office',
    site2: { name: 'Jebel Ali Warehouse', address: 'Plot S30219, Jebel Ali Free Zone South, Dubai', lat: 24.9857, lng: 55.091, city: 'Dubai' },
    ops_shifts: [{ name: 'Warehouse Early (06:00–15:00)', start_time: '06:00', end_time: '15:00', break_minutes_allowed: 60 }, { name: 'Warehouse Late (14:00–23:00)', start_time: '14:00', end_time: '23:00', break_minutes_allowed: 60 }],
    org: [
      exec('General Manager'),
      { name: 'Operations', code: 'OPS', color: '#7C2D12', icon: 'route', parent: 'EXEC', head: 'Operations Manager', leads: ['Freight Operations Supervisor'], staff: [['Freight Coordinator', 4, 4], ['Operations Executive', 4, 3]] },
      { name: 'Warehouse', code: 'WH', color: '#b45309', icon: 'building', parent: 'OPS', head: 'Warehouse Manager', leads: ['Warehouse Supervisor'], staff: [['Storekeeper', 3, 4], ['Forklift Operator', 3, 4], ['Warehouse Helper', 3, 3]], ops: true },
      { name: 'Fleet & Transport', code: 'FLEET', color: '#0369a1', icon: 'truck', parent: 'OPS', head: 'Fleet Manager', staff: [['Heavy Truck Driver', 3, 5], ['Light Vehicle Driver', 3, 2]], ops: true },
      { name: 'Customs & Compliance', code: 'CUST', color: '#475569', icon: 'scale', parent: 'EXEC', head: 'Customs Manager', staff: [['Customs Clearance Officer', 4, 2], ['Documentation Executive', 4, 1]] },
      { name: 'Sales', code: 'SALES', color: '#ea580c', icon: 'trendingUp', parent: 'EXEC', head: 'Business Development Manager', staff: [['Sales Executive', 4, 2], ['Customer Service Executive', 3, 2]] },
      { name: 'IT', code: 'IT', color: '#2563eb', icon: 'laptop', parent: 'EXEC', head: 'IT Manager', staff: [['Systems Administrator', 4, 1]] },
      hr('HR & Admin Manager'), fin(),
    ],
    vacancies: [
      { title: 'Heavy Truck Driver', dept: 'FLEET', openings: 3, budget_annual: 60000, summary: 'Drive container trucks between Jebel Ali, Khalifa Port and customer sites.', responsibilities: ['Safe delivery of containers and LCL cargo', 'Pre-trip vehicle inspections', 'Proof-of-delivery paperwork'], requirements: ['Valid UAE heavy vehicle licence', '3+ years UAE driving experience'], skills: ['Heavy vehicle driving', 'Route planning', 'Safety'], experience_min: 3, experience_max: 10, salary_min: 36000, salary_max: 60000 },
      { title: 'Customs Clearance Officer', dept: 'CUST', openings: 1, budget_annual: 144000, summary: 'Clear import and export shipments through Dubai Customs and free-zone authorities.', responsibilities: ['Prepare declarations on Mirsal', 'Coordinate with shipping lines and clients', 'Keep HS codes and duties accurate'], requirements: ['3+ years customs clearance in the UAE', 'Knowledge of Mirsal 2 and free-zone procedures'], skills: ['Customs clearance', 'HS codes', 'Mirsal', 'Documentation', 'Communication'], experience_min: 3, experience_max: 8, salary_min: 96000, salary_max: 144000 },
    ],
    assets: [['HP EliteBook 840', 'Laptop', 'EliteBook 840 G10', 'HP', 5200], ['Zebra TC26 Scanner', 'Phone', 'TC26', 'Zebra', 2400], ['Toyota Hilux', 'Vehicle', 'Hilux 2.7 GL', 'Al-Futtaim Toyota', 98000], ['Samsung Galaxy A55', 'Phone', 'Galaxy A55', 'Samsung', 1600], ['HP EliteBook 840', 'Laptop', 'EliteBook 840 G10', 'HP', 5200]],
    employment_mix: [['full_time', 92], ['contract', 8]],
  },
  'najd-construction': {
    address: 'King Abdullah Road, Al Malqa District, Riyadh 13521, Saudi Arabia',
    phone: '+966 11 460 2200', tagline: 'Building the Kingdom.', accent_color: '#CA8A04', prefix: 'NC', hq_name: 'Riyadh Head Office',
    site2: { name: 'Diriyah Project Site', address: 'Diriyah Gate Development, Diriyah, Riyadh 13711', lat: 24.7343, lng: 46.5752, city: 'Diriyah' },
    default_shift: { name: 'Office (08:00–17:00)', start_time: '08:00', end_time: '17:00', break_minutes_allowed: 60 },
    ops_shifts: [{ name: 'Site (06:00–15:00)', start_time: '06:00', end_time: '15:00', break_minutes_allowed: 60 }],
    org: [
      exec('Chief Executive Officer', [['Executive Assistant', 4, 1], ['Government Relations Officer', 5, 1]]),
      { name: 'Projects', code: 'PROJ', color: '#166534', icon: 'building', parent: 'EXEC', head: 'Projects Director', leads: ['Project Manager', 'Construction Manager'], staff: [['Site Engineer', 5, 5], ['Foreman', 4, 4], ['Quantity Surveyor', 5, 2]], ops: true },
      { name: 'Site Operations', code: 'SITE', color: '#a16207', icon: 'wrench', parent: 'PROJ', head: 'Site Operations Manager', staff: [['Mason', 3, 4], ['Electrician', 3, 3], ['Steel Fixer', 3, 3], ['Equipment Operator', 3, 2]], ops: true },
      { name: 'Engineering & Design', code: 'ENG', color: '#0369a1', icon: 'compass', parent: 'EXEC', head: 'Engineering Manager', staff: [['Structural Engineer', 5, 2], ['MEP Engineer', 5, 2], ['AutoCAD Draftsman', 4, 1]] },
      { name: 'Health, Safety & Environment', code: 'HSE', color: '#dc2626', icon: 'shield', parent: 'EXEC', head: 'HSE Manager', staff: [['HSE Officer', 4, 3]], ops: true },
      { name: 'Procurement', code: 'PROC', color: '#7c3aed', icon: 'cart', parent: 'EXEC', head: 'Procurement Manager', staff: [['Procurement Officer', 4, 2], ['Storekeeper', 3, 1]] },
      hr('HR Manager'), fin('Finance Manager'),
    ],
    vacancies: [
      { title: 'Site Engineer (Civil)', dept: 'PROJ', openings: 2, budget_annual: 216000, summary: 'Supervise civil works on a mixed-use development in Riyadh.', responsibilities: ['Supervise subcontractors and daily progress', 'Check works against drawings and specs', 'Prepare daily site reports'], requirements: ['B.Sc Civil Engineering, SCE registration', '4+ years site experience in KSA or GCC'], skills: ['Civil engineering', 'AutoCAD', 'Primavera', 'Quality control', 'Site supervision'], experience_min: 4, experience_max: 10, salary_min: 156000, salary_max: 240000 },
      { title: 'HSE Officer', dept: 'HSE', openings: 1, budget_annual: 132000, summary: 'Keep our sites safe and compliant with Saudi building safety rules.', responsibilities: ['Daily safety inspections and toolbox talks', 'Incident reporting and investigation', 'Permit-to-work control'], requirements: ['NEBOSH IGC', '3+ years construction HSE in the GCC'], skills: ['NEBOSH', 'Risk assessment', 'Incident investigation', 'HSE'], experience_min: 3, experience_max: 8, salary_min: 96000, salary_max: 144000 },
    ],
    assets: [['Lenovo ThinkPad T14', 'Laptop', 'ThinkPad T14 Gen 4', 'Lenovo', 6500], ['Toyota Land Cruiser', 'Vehicle', 'Land Cruiser GXR', 'Abdul Latif Jameel', 310000], ['Leica Total Station', 'Furniture', 'TS07', 'Leica', 42000], ['Samsung Galaxy XCover7', 'Phone', 'XCover7', 'Samsung', 1500], ['Lenovo ThinkPad T14', 'Laptop', 'ThinkPad T14 Gen 4', 'Lenovo', 6500]],
    employment_mix: [['full_time', 85], ['contract', 15]],
  },
  'pearl-hospitality': {
    address: 'Diplomatic Area Street, West Bay, PO Box 24567, Doha, Qatar',
    phone: '+974 4410 5500', tagline: 'Hospitality, the Qatari way.', accent_color: '#D4A017', prefix: 'PH', hq_name: 'West Bay Hotel',
    site2: { name: 'The Pearl Residences', address: 'Porto Arabia, The Pearl-Qatar, Doha', lat: 25.3686, lng: 51.5513, city: 'Doha' },
    ops_shifts: [{ name: 'Morning (07:00–15:00)', start_time: '07:00', end_time: '15:00', break_minutes_allowed: 30 }, { name: 'Evening (15:00–23:00)', start_time: '15:00', end_time: '23:00', break_minutes_allowed: 30 }],
    org: [
      exec('General Manager', [['Executive Assistant Manager', 9, 1]]),
      { name: 'Front Office', code: 'FO', color: '#6D28D9', icon: 'key', parent: 'EXEC', head: 'Front Office Manager', leads: ['Guest Relations Supervisor'], staff: [['Front Desk Agent', 3, 4], ['Concierge', 3, 2], ['Bellboy', 3, 2]], ops: true },
      { name: 'Housekeeping', code: 'HK', color: '#0d9488', icon: 'sparkles', parent: 'EXEC', head: 'Executive Housekeeper', leads: ['Housekeeping Supervisor'], staff: [['Room Attendant', 3, 6], ['Laundry Attendant', 3, 2]], ops: true },
      { name: 'Food & Beverage', code: 'FNB', color: '#b45309', icon: 'leaf', parent: 'EXEC', head: 'F&B Manager', leads: ['Executive Chef'], staff: [['Commis Chef', 3, 3], ['Waiter / Waitress', 3, 4], ['Barista', 3, 1]], ops: true },
      { name: 'Engineering', code: 'ENG', color: '#475569', icon: 'wrench', parent: 'EXEC', head: 'Chief Engineer', staff: [['Maintenance Technician', 3, 2], ['HVAC Technician', 4, 1]], ops: true },
      { name: 'Sales & Marketing', code: 'SM', color: '#ea580c', icon: 'megaphone', parent: 'EXEC', head: 'Director of Sales', staff: [['Sales Manager', 5, 1], ['Reservations Agent', 3, 2]] },
      { name: 'Security', code: 'SEC', color: '#1e293b', icon: 'shield', parent: 'EXEC', head: 'Security Manager', staff: [['Security Officer', 3, 2]], ops: true },
      hr('Director of Human Resources'), fin('Director of Finance'),
    ],
    vacancies: [
      { title: 'Front Desk Agent', dept: 'FO', openings: 2, budget_annual: 60000, summary: 'Welcome guests, manage check-ins and keep the lobby running smoothly.', responsibilities: ['Check guests in and out on Opera PMS', 'Handle requests and complaints', 'Upsell rooms and packages'], requirements: ['1+ year front office experience in a 4/5-star hotel', 'Fluent English; Arabic is a plus'], skills: ['Opera PMS', 'Customer service', 'Communication', 'Upselling'], experience_min: 1, experience_max: 4, salary_min: 42000, salary_max: 60000 },
    ],
    assets: [['Dell Latitude 3440', 'Laptop', 'Latitude 3440', 'Dell', 3800], ['Motorola Two-way Radio', 'Phone', 'DP4400e', 'Motorola', 2200], ['iPad (10th gen)', 'Phone', 'iPad 10', 'Apple', 1900], ['Motorola Two-way Radio', 'Phone', 'DP4400e', 'Motorola', 2200]],
    employment_mix: [['full_time', 90], ['contract', 10]],
  },
  'redwood-health': {
    address: '450 Mission Street, Suite 800, San Francisco, CA 94105, USA',
    phone: '+1 (415) 555-0142', tagline: 'Care that knows your name.', accent_color: '#0EA5E9', prefix: 'RH', hq_name: 'Mission Street Clinic',
    site2: { name: 'Oakland Clinic', address: '1900 Broadway, Oakland, CA 94612', lat: 37.8044, lng: -122.2712, city: 'Oakland' },
    ops_shifts: [{ name: 'Clinic Early (07:30–16:00)', start_time: '07:30', end_time: '16:00', break_minutes_allowed: 30 }, { name: 'Clinic Late (11:30–20:00)', start_time: '11:30', end_time: '20:00', break_minutes_allowed: 30 }],
    org: [
      exec('Chief Executive Officer', [['Chief Medical Officer', 9, 1]]),
      { name: 'Clinical Services', code: 'CLIN', color: '#BE123C', icon: 'flask', parent: 'EXEC', head: 'Medical Director', leads: ['Lead Physician'], staff: [['Physician', 6, 3], ['Nurse Practitioner', 5, 3], ['Physician Assistant', 5, 2]], ops: true },
      { name: 'Nursing', code: 'NURS', color: '#db2777', icon: 'heartHandshake', parent: 'CLIN', head: 'Director of Nursing', leads: ['Charge Nurse'], staff: [['Registered Nurse', 4, 6], ['Medical Assistant', 3, 5]], ops: true },
      { name: 'Patient Services', code: 'PSV', color: '#0891b2', icon: 'headset', parent: 'EXEC', head: 'Patient Services Manager', staff: [['Patient Services Representative', 3, 4], ['Medical Scheduler', 3, 2]], ops: true },
      { name: 'Revenue Cycle', code: 'RCM', color: '#059669', icon: 'banknote', parent: 'EXEC', head: 'Revenue Cycle Manager', staff: [['Medical Biller', 4, 3], ['Coding Specialist', 4, 1]] },
      { name: 'Compliance', code: 'COMP', color: '#475569', icon: 'scale', parent: 'EXEC', head: 'Compliance Officer', staff: [['Privacy Analyst', 4, 1]] },
      { name: 'IT', code: 'IT', color: '#2563eb', icon: 'laptop', parent: 'EXEC', head: 'IT Manager', staff: [['EHR Analyst', 4, 1], ['IT Support Specialist', 3, 1]] },
      { name: 'People Operations', code: 'HR', color: '#9333ea', icon: 'users', parent: 'EXEC', head: 'Director of People Operations', fixed: [['Payroll Specialist', 5, 1], ['HR Generalist', 4, 1]] },
      fin('Controller'),
    ],
    vacancies: [
      { title: 'Registered Nurse (Primary Care)', dept: 'NURS', openings: 2, budget_annual: 145000, summary: 'Deliver primary care nursing across our San Francisco and Oakland clinics.', responsibilities: ['Patient triage and care coordination', 'Administer medications and vaccines', 'Document in Epic EHR'], requirements: ['Active California RN license', 'BLS certification', '2+ years ambulatory care'], skills: ['Patient care', 'Epic', 'Triage', 'BLS', 'Care coordination'], experience_min: 2, experience_max: 8, salary_min: 120000, salary_max: 160000 },
      { title: 'Medical Biller', dept: 'RCM', openings: 1, budget_annual: 65000, summary: 'Submit and follow up on claims for commercial, Medicare and Medi-Cal payers.', responsibilities: ['Submit clean claims', 'Work denials and appeals', 'Post payments'], requirements: ['2+ years medical billing', 'Familiar with CPT and ICD-10'], skills: ['Medical billing', 'CPT', 'ICD-10', 'Denial management', 'Epic'], experience_min: 2, experience_max: 6, salary_min: 55000, salary_max: 68000 },
    ],
    assets: [['MacBook Air 13"', 'Laptop', 'MacBook Air M3', 'Apple', 1299], ['Dell OptiPlex 7010', 'Laptop', 'OptiPlex 7010', 'Dell', 950], ['iPhone 15', 'Phone', 'iPhone 15', 'Apple', 799], ['Welch Allyn Vitals Monitor', 'Furniture', 'Connex Spot', 'Welch Allyn', 3200], ['MacBook Air 13"', 'Laptop', 'MacBook Air M3', 'Apple', 1299]],
    employment_mix: [['full_time', 82], ['part_time', 15], ['contract', 3]],
  },
  'hudson-analytics': {
    address: '250 Hudson Street, 9th Floor, New York, NY 10013, USA',
    phone: '+1 (212) 555-0187', tagline: 'Decisions, backed by data.', accent_color: '#22D3EE', prefix: 'HA', hq_name: 'Hudson Square Office',
    org: [
      exec('Managing Partner', [['Partner', 9, 1]]),
      { name: 'Analytics Consulting', code: 'CONS', color: '#0369A1', icon: 'briefcase', parent: 'EXEC', head: 'Head of Consulting', leads: ['Engagement Manager', 'Engagement Manager – Financial Services'], staff: [['Senior Consultant', 5, 4], ['Consultant', 4, 5], ['Analyst', 3, 4]], wfh: true },
      { name: 'Data Science', code: 'DS', color: '#7c3aed', icon: 'barChart', parent: 'EXEC', head: 'Head of Data Science', leads: ['Lead Data Scientist'], staff: [['Data Scientist', 5, 4], ['ML Engineer', 5, 2]], wfh: true },
      { name: 'Data Engineering', code: 'DE', color: '#0891b2', icon: 'server', parent: 'DS', head: 'Data Engineering Manager', staff: [['Data Engineer', 5, 3], ['Analytics Engineer', 4, 2]], wfh: true },
      { name: 'Business Development', code: 'BD', color: '#ea580c', icon: 'trendingUp', parent: 'EXEC', head: 'Head of Business Development', staff: [['Account Executive', 5, 2], ['Sales Development Rep', 3, 1]] },
      { name: 'Marketing', code: 'MKT', color: '#db2777', icon: 'megaphone', parent: 'EXEC', head: 'Marketing Director', staff: [['Content Marketing Manager', 5, 1]], wfh: true },
      { name: 'People & Talent', code: 'HR', color: '#9333ea', icon: 'users', parent: 'EXEC', head: 'Head of People', fixed: [['Payroll & Benefits Specialist', 5, 1], ['Talent Partner', 4, 1]] },
      fin('Controller'),
    ],
    vacancies: [
      { title: 'Senior Data Engineer', dept: 'DE', openings: 1, budget_annual: 185000, summary: 'Design the data platforms behind our client analytics engagements.', responsibilities: ['Build pipelines in Python, dbt and Spark', 'Model warehouses on Snowflake / BigQuery', 'Set data quality standards'], requirements: ['5+ years of data engineering', 'Strong SQL and Python', 'Cloud data warehouse experience'], skills: ['Python', 'SQL', 'dbt', 'Spark', 'Snowflake', 'Airflow', 'AWS'], experience_min: 5, experience_max: 10, salary_min: 165000, salary_max: 200000 },
      { title: 'Analytics Consultant', dept: 'CONS', openings: 2, budget_annual: 120000, summary: 'Turn messy client data into decisions for financial-services and retail clients.', responsibilities: ['Scope analyses with client stakeholders', 'Build models and dashboards', 'Present findings to executives'], requirements: ['2+ years in analytics or consulting', 'SQL plus Python or R', 'Excellent communication'], skills: ['SQL', 'Python', 'Tableau', 'Statistics', 'Presentation', 'Stakeholder management'], experience_min: 2, experience_max: 5, salary_min: 105000, salary_max: 130000 },
    ],
    assets: [['MacBook Pro 14"', 'Laptop', 'MacBook Pro M3 Pro', 'Apple', 2399], ['MacBook Pro 14"', 'Laptop', 'MacBook Pro M3 Pro', 'Apple', 2399], ['Dell UltraSharp 27"', 'Monitor', 'U2723QE', 'Dell', 579], ['MacBook Air 15"', 'Laptop', 'MacBook Air M3', 'Apple', 1499], ['Jabra Evolve2 75', 'Headset', 'Evolve2 75', 'Jabra', 329]],
    employment_mix: [['full_time', 90], ['contract', 4], ['intern', 6]],
  },
  'lonestar-energy': {
    address: '1200 Smith Street, Suite 1600, Houston, TX 77002, USA',
    phone: '+1 (713) 555-0163', tagline: 'Safe hands in the Permian.', accent_color: '#DC2626', prefix: 'LS', hq_name: 'Houston Downtown Office',
    site2: { name: 'Midland Field Base', address: '4500 W Industrial Ave, Midland, TX 79703', lat: 31.9973, lng: -102.0779, city: 'Midland' },
    ops_shifts: [{ name: 'Field (06:00–16:30)', start_time: '06:00', end_time: '16:30', break_minutes_allowed: 30 }],
    org: [
      exec('President & CEO', [['VP Operations', 9, 1]]),
      { name: 'Field Operations', code: 'FOPS', color: '#A16207', icon: 'wrench', parent: 'EXEC', head: 'Field Operations Manager', leads: ['Field Supervisor – Permian', 'Field Supervisor – Eagle Ford'], staff: [['Field Service Technician', 4, 6], ['Equipment Operator', 3, 5], ['Floorhand', 3, 4]], ops: true },
      { name: 'Maintenance', code: 'MNT', color: '#475569', icon: 'factory', parent: 'FOPS', head: 'Maintenance Manager', staff: [['Diesel Mechanic', 4, 3], ['Welder', 4, 2]], ops: true },
      { name: 'Engineering', code: 'ENG', color: '#0369a1', icon: 'compass', parent: 'EXEC', head: 'Engineering Manager', staff: [['Completions Engineer', 6, 2], ['Field Engineer', 5, 2]] },
      { name: 'Health, Safety & Environment', code: 'HSE', color: '#dc2626', icon: 'shield', parent: 'EXEC', head: 'HSE Manager', staff: [['HSE Coordinator', 4, 2]], ops: true },
      { name: 'Logistics', code: 'LOG', color: '#b45309', icon: 'truck', parent: 'EXEC', head: 'Logistics Manager', staff: [['CDL Driver', 3, 3], ['Dispatcher', 3, 1]], ops: true },
      { name: 'Sales', code: 'SALES', color: '#ea580c', icon: 'trendingUp', parent: 'EXEC', head: 'Director of Sales', staff: [['Account Manager', 5, 2]] },
      { name: 'Human Resources', code: 'HR', color: '#db2777', icon: 'heartHandshake', parent: 'EXEC', head: 'HR Manager', fixed: [['Payroll Specialist', 5, 1], ['HR Coordinator', 4, 1]] },
      fin('Controller'),
    ],
    vacancies: [
      { title: 'Field Service Technician', dept: 'FOPS', openings: 3, budget_annual: 78000, summary: 'Rig up and run pressure-pumping and wireline equipment on Permian Basin well sites.', responsibilities: ['Rig up / rig down equipment', 'Pre-job inspections and maintenance', 'Follow stop-work and JSA procedures'], requirements: ['Valid Class A CDL (or ability to obtain)', 'SafeLand / H2S certification', 'Able to work 14/7 rotations'], skills: ['CDL', 'H2S', 'Hydraulics', 'Equipment maintenance', 'Safety'], experience_min: 1, experience_max: 6, salary_min: 62000, salary_max: 85000 },
    ],
    assets: [['Dell Latitude 7440 Rugged', 'Laptop', 'Latitude 7330 Rugged', 'Dell', 3100], ['Ford F-250 Super Duty', 'Vehicle', 'F-250 XL', 'Ford', 58000], ['Ford F-250 Super Duty', 'Vehicle', 'F-250 XL', 'Ford', 58000], ['Samsung Galaxy XCover6', 'Phone', 'XCover6 Pro', 'Samsung', 599], ['Gas Detector (4-gas)', 'Furniture', 'MSA Altair 4XR', 'MSA', 1150]],
    employment_mix: [['full_time', 92], ['contract', 8]],
  },
};
