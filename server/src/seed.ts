import fs from 'node:fs';
import path from 'node:path';
import { getDb, get, all, insert, run, setSetting, transaction, UPLOAD_DIR } from './db.js';
import { hashPassword } from './auth.js';
import { nowIso, today, addDays } from './util.js';
import { DEFAULT_COMPANY, DEFAULT_DOCUMENT_SETTINGS, DEFAULT_PAYROLL_SETTINGS, DEFAULT_ATTENDANCE_SETTINGS, DEFAULT_LEAVE_SETTINGS } from './routes/settings.js';

export const DEMO_PASSWORD = 'Password123!';

const JOURNEY_TEMPLATES = [
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

export function seedIfEmpty() {
  getDb();
  if (get('SELECT 1 FROM users LIMIT 1')) return false;
  seed();
  return true;
}

export function seed() {
  const now = nowIso();
  transaction(() => {
    setSetting('company', DEFAULT_COMPANY);
    setSetting('documents', DEFAULT_DOCUMENT_SETTINGS);
    setSetting('payroll', DEFAULT_PAYROLL_SETTINGS);
    setSetting('attendance', DEFAULT_ATTENDANCE_SETTINGS);
    setSetting('leave', DEFAULT_LEAVE_SETTINGS);

    // Departments (tree)
    const dep = (name: string, code: string, color: string, parent: number | null = null) => insert('departments', { name, code, parent_id: parent, color, sort_order: 0, active: 1, created_at: now });
    const exec = dep('Executive', 'EXEC', '#0f172a');
    const eng = dep('Engineering', 'ENG', '#2563eb', exec);
    const platform = dep('Platform', 'PLAT', '#1d4ed8', eng);
    const product = dep('Product', 'PROD', '#7c3aed', exec);
    const hr = dep('Human Resources', 'HR', '#db2777', exec);
    const fin = dep('Finance', 'FIN', '#059669', exec);
    const sales = dep('Sales', 'SALES', '#ea580c', exec);

    const pos = (title: string, code: string, department_id: number, level: number, reports_to: number | null = null, headcount = 1) => insert('positions', { title, code, department_id, reports_to_position_id: reports_to, level, headcount, active: 1, created_at: now });
    const pCeo = pos('Chief Executive Officer', 'CEO', exec, 10);
    const pCto = pos('Chief Technology Officer', 'CTO', eng, 9, pCeo);
    const pEm = pos('Engineering Manager', 'EM', eng, 7, pCto, 2);
    const pSse = pos('Senior Software Engineer', 'SSE', platform, 5, pEm, 4);
    const pSe = pos('Software Engineer', 'SE', platform, 4, pSse, 6);
    const pPm = pos('Product Manager', 'PM', product, 6, pCeo, 2);
    const pHrh = pos('Head of HR', 'HRH', hr, 8, pCeo);
    const pHrx = pos('HR Executive', 'HRX', hr, 4, pHrh, 2);
    const pFin = pos('Finance Controller', 'FC', fin, 7, pCeo);
    const pAcc = pos('Accountant', 'ACC', fin, 4, pFin, 2);
    const pSh = pos('Sales Head', 'SH', sales, 7, pCeo);
    const pAe = pos('Account Executive', 'AE', sales, 4, pSh, 5);

    // Work locations & shifts
    const hq = insert('work_locations', { name: 'Bengaluru HQ', address: 'MG Road, Bengaluru', lat: 12.9716, lng: 77.5946, radius_m: 200, active: 1, created_at: now });
    const pune = insert('work_locations', { name: 'Pune Office', address: 'Hinjewadi, Pune', lat: 18.5913, lng: 73.7389, radius_m: 150, active: 1, created_at: now });
    const genShift = insert('shifts', { name: 'General (9:30-18:30)', start_time: '09:30', end_time: '18:30', grace_minutes: 10, break_minutes_allowed: 60, half_day_minutes: 240, full_day_minutes: 480, working_days: [1, 2, 3, 4, 5], active: 1 });
    insert('shifts', { name: 'Early (7:00-16:00)', start_time: '07:00', end_time: '16:00', grace_minutes: 10, break_minutes_allowed: 60, half_day_minutes: 240, full_day_minutes: 480, working_days: [1, 2, 3, 4, 5], active: 1 });

    // Document types (formats are HR-customisable)
    const dt = (name: string, formats: string[], requires_expiry: number, warn: number, crit: number, required_for_all: number, category: string) =>
      insert('document_types', { name, allowed_formats: formats, requires_expiry, expiry_warning_days: warn, expiry_critical_days: crit, required_for_all, max_size_mb: 10, category, active: 1 });
    const dtPassport = dt('Passport', ['pdf', 'jpg', 'png'], 1, 180, 30, 0, 'Identity');
    const dtId = dt('National ID', ['pdf', 'jpg', 'png'], 0, 30, 7, 1, 'Identity');
    const dtVisa = dt('Work Visa / Permit', ['pdf'], 1, 90, 14, 0, 'Compliance');
    const dtContract = dt('Employment Contract', ['pdf'], 1, 60, 14, 1, 'Employment');
    dt('Degree Certificate', ['pdf', 'jpg', 'png'], 0, 30, 7, 0, 'Education');
    dt('Medical Insurance Card', ['pdf', 'jpg', 'png'], 1, 45, 7, 0, 'Benefits');
    dt('Driving Licence', ['jpg', 'png'], 1, 60, 14, 0, 'Identity');

    // Custom employee fields
    insert('custom_field_defs', { entity: 'employee', key: 'blood_group', label: 'Blood group', type: 'select', options: ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'], required: 0, section: 'Personal', sort_order: 0, active: 1 });
    insert('custom_field_defs', { entity: 'employee', key: 'tshirt_size', label: 'T-shirt size', type: 'select', options: ['XS', 'S', 'M', 'L', 'XL', 'XXL'], required: 0, section: 'Personal', sort_order: 1, active: 1 });
    insert('custom_field_defs', { entity: 'employee', key: 'laptop_preference', label: 'Laptop preference', type: 'text', options: [], required: 0, section: 'Work', sort_order: 2, active: 1 });

    // Salary components
    const sc = (name: string, code: string, type: string, calc: string, value: number, taxable: number, statutory: number, prorate: number, order: number) => insert('salary_components', { name, code, type, calc_type: calc, default_value: value, taxable, statutory, prorate, sort_order: order, active: 1 });
    const cHra = sc('House Rent Allowance', 'HRA', 'earning', 'percent_of_basic', 40, 1, 0, 1, 1);
    sc('Conveyance Allowance', 'CONV', 'earning', 'fixed', 1600, 1, 0, 1, 2);
    const cSpecial = sc('Special Allowance', 'SPL', 'earning', 'fixed', 5000, 1, 0, 1, 3);
    sc('Provident Fund (Employee)', 'PF', 'deduction', 'percent_of_basic', 12, 0, 1, 1, 1);
    sc('ESI (Employee)', 'ESI', 'deduction', 'percent_of_gross', 0.75, 0, 1, 1, 2);
    sc('Professional Tax', 'PT', 'deduction', 'fixed', 200, 0, 1, 0, 3);
    sc('Income Tax (TDS)', 'TDS', 'deduction', 'fixed', 0, 0, 1, 0, 4);

    // Leave types
    const lt = (name: string, code: string, quota: number, paid: number, cf: number, maxCf: number, doc: number, notice: number, color: string) => insert('leave_types', { name, code, annual_quota: quota, paid, carry_forward: cf, max_carry_forward: maxCf, requires_document: doc, min_notice_days: notice, allow_half_day: 1, color, active: 1 });
    const ltCasual = lt('Casual Leave', 'CL', 12, 1, 0, 0, 0, 1, '#2563eb');
    const ltSick = lt('Sick Leave', 'SL', 10, 1, 0, 0, 1, 0, '#dc2626');
    const ltEarned = lt('Earned Leave', 'EL', 18, 1, 1, 30, 0, 7, '#16a34a');
    lt('Unpaid Leave', 'LWP', 365, 0, 0, 0, 0, 0, '#6b7280');
    lt('Maternity Leave', 'ML', 182, 1, 0, 0, 1, 30, '#db2777');

    // Holidays for this year
    const y = new Date().getFullYear();
    for (const [name, d] of [['New Year', `${y}-01-01`], ['Republic Day', `${y}-01-26`], ['Holi', `${y}-03-14`], ['Independence Day', `${y}-08-15`], ['Gandhi Jayanti', `${y}-10-02`], ['Diwali', `${y}-10-20`], ['Christmas', `${y}-12-25`]]) insert('holidays', { name, date: d, optional: 0 });

    // Journey templates
    JOURNEY_TEMPLATES.forEach(([name, description, color, icon], i) => insert('journey_stage_templates', { name, description, sort_order: i, color, icon, owner_role: 'hr', sla_days: 7, active: 1 }));

    // Vacancies
    const vac = insert('vacancies', { title: 'Software Engineer (Platform)', position_id: pSe, department_id: platform, openings: 2, budget_annual: 1800000, status: 'open', opened_at: addDays(today(), -40), created_at: now });
    insert('vacancies', { title: 'Account Executive', position_id: pAe, department_id: sales, openings: 1, budget_annual: 900000, status: 'open', opened_at: addDays(today(), -12), created_at: now });

    // Employees
    const emp = (code: string, first: string, last: string, email: string, dept: number, position: number, manager: number | null, join: string, extra: Record<string, any> = {}) =>
      insert('employees', { employee_code: code, first_name: first, last_name: last, email, phone: '+91 98765 ' + code.slice(-4), gender: extra.gender || 'female', department_id: dept, position_id: position, manager_id: manager, work_location_id: extra.loc || hq, shift_id: genShift, join_date: join, employment_type: 'full_time', status: extra.status || 'active', city: 'Bengaluru', country: 'India', bank_name: 'HDFC Bank', bank_account_name: `${first} ${last}`, bank_account_number: '5010' + code.slice(-4) + '0099', bank_ifsc: 'HDFC0001234', tax_id: 'ABCDE' + code.slice(-4) + 'F', pf_number: 'KA/BLR/' + code.slice(-4), custom_fields: { blood_group: 'O+', tshirt_size: 'M' }, dob: extra.dob || '1990-06-15', created_at: now, updated_at: now, ...(extra.cols || {}) });
    const ceo = emp('EMP0001', 'Priya', 'Nair', 'priya.nair@acme.example', exec, pCeo, null, '2015-01-05', { dob: '1978-03-22' });
    const cto = emp('EMP0002', 'Arjun', 'Mehta', 'arjun.mehta@acme.example', eng, pCto, ceo, '2016-04-11', { gender: 'male', dob: '1982-11-02' });
    const hrHead = emp('EMP0003', 'Sara', 'Thomas', 'sara.thomas@acme.example', hr, pHrh, ceo, '2017-02-20', { dob: '1985-09-30' });
    const em = emp('EMP0004', 'Rahul', 'Verma', 'rahul.verma@acme.example', eng, pEm, cto, '2018-07-16', { gender: 'male', dob: '1987-01-19' });
    const sse = emp('EMP0005', 'Meera', 'Iyer', 'meera.iyer@acme.example', platform, pSse, em, '2019-09-02', { dob: '1991-12-08' });
    const se1 = emp('EMP0006', 'Karthik', 'Raj', 'karthik.raj@acme.example', platform, pSe, sse, '2022-03-14', { gender: 'male', dob: '1996-05-25', loc: pune });
    const se2 = emp('EMP0007', 'Anita', 'Desai', 'anita.desai@acme.example', platform, pSe, sse, addDays(today(), -20), { dob: '1998-02-14', status: 'probation', cols: { vacancy_id: vac } });
    const pm = emp('EMP0008', 'Vikram', 'Singh', 'vikram.singh@acme.example', product, pPm, ceo, '2020-01-06', { gender: 'male', dob: '1989-08-11' });
    const hrx = emp('EMP0009', 'Neha', 'Kapoor', 'neha.kapoor@acme.example', hr, pHrx, hrHead, '2021-05-03', { dob: '1994-04-04' });
    const fc = emp('EMP0010', 'Suresh', 'Pillai', 'suresh.pillai@acme.example', fin, pFin, ceo, '2016-11-01', { gender: 'male', dob: '1980-07-07' });
    const acc = emp('EMP0011', 'Divya', 'Menon', 'divya.menon@acme.example', fin, pAcc, fc, '2021-08-23', { dob: '1995-10-10' });
    const sh = emp('EMP0012', 'Rohan', 'Das', 'rohan.das@acme.example', sales, pSh, ceo, '2018-02-05', { gender: 'male', dob: '1986-06-06' });
    const ae = emp('EMP0013', 'Pooja', 'Shah', 'pooja.shah@acme.example', sales, pAe, sh, '2023-01-09', { dob: '1997-03-03' });
    run('UPDATE departments SET head_employee_id = ? WHERE id = ?', [ceo, exec]);
    run('UPDATE departments SET head_employee_id = ? WHERE id = ?', [cto, eng]);
    run('UPDATE departments SET head_employee_id = ? WHERE id = ?', [hrHead, hr]);
    run('UPDATE departments SET head_employee_id = ? WHERE id = ?', [fc, fin]);
    run('UPDATE departments SET head_employee_id = ? WHERE id = ?', [sh, sales]);
    run('UPDATE departments SET head_employee_id = ? WHERE id = ?', [pm, product]);

    // Users: HR admin, a manager, an employee, plus logins for everyone else.
    const user = (email: string, role: string, employee_id: number) => insert('users', { email, password_hash: hashPassword(DEMO_PASSWORD), role, employee_id, active: 1, must_change_password: 0, created_at: now });
    user('hr@acme.example', 'hr', hrHead);
    user('manager@acme.example', 'manager', sse);
    user('employee@acme.example', 'employee', se1);
    user('ceo@acme.example', 'manager', ceo);
    user('rahul.verma@acme.example', 'manager', em);
    user('anita.desai@acme.example', 'employee', se2);
    user('neha.kapoor@acme.example', 'hr', hrx);

    // Job descriptions
    const jd = (title: string, position_id: number, department_id: number, summary: string, resp: string[], reqs: string[], skills: string[], min: number, max: number, status: string) =>
      insert('job_descriptions', { title, position_id, department_id, summary, responsibilities: resp, requirements: reqs, skills, employment_type: 'full_time', experience_min: min, experience_max: max, salary_min: 800000, salary_max: 2400000, location: 'Bengaluru', status, version: 1, created_at: now, updated_at: now });
    const jdSe = jd('Software Engineer', pSe, platform, 'Build and operate the core platform services used by every product team.', ['Design, build and ship backend services', 'Own quality through tests and code review', 'Participate in on-call rotation'], ['2+ years building production software', 'Strong fundamentals in data structures', 'Experience with SQL databases'], ['TypeScript', 'Node.js', 'SQL', 'AWS'], 2, 5, 'published');
    jd('Senior Software Engineer', pSse, platform, 'Lead design of platform components and mentor engineers.', ['Lead technical design for a product area', 'Mentor engineers', 'Drive reliability and performance'], ['5+ years of experience', 'Track record of leading projects'], ['TypeScript', 'Distributed systems', 'Observability'], 5, 9, 'published');
    jd('Account Executive', pAe, sales, 'Own the full sales cycle for mid-market accounts.', ['Prospect and qualify leads', 'Run demos and negotiate contracts', 'Maintain CRM hygiene'], ['2+ years B2B SaaS sales'], ['Negotiation', 'CRM', 'Presentation'], 2, 6, 'draft');
    run('UPDATE vacancies SET job_description_id = ? WHERE id = ?', [jdSe, vac]);

    // Salary structures
    const struct = (employee_id: number, basic: number, special: number) => insert('salary_structures', { employee_id, effective_from: '2024-04-01', currency: 'INR', basic, components: [{ component_id: cSpecial, value: special }, { component_id: cHra, value: 40 }], ctc_annual: Math.round((basic * 1.4 + 1600 + special) * 12 * 1.12), created_by: 1, created_at: now });
    const salaries: [number, number, number][] = [[ceo, 250000, 60000], [cto, 180000, 40000], [hrHead, 90000, 15000], [em, 120000, 20000], [sse, 85000, 12000], [se1, 55000, 8000], [se2, 45000, 6000], [pm, 95000, 15000], [hrx, 40000, 5000], [fc, 110000, 18000], [acc, 42000, 5000], [sh, 100000, 20000], [ae, 48000, 7000]];
    salaries.forEach(([e, b, s]) => struct(e, b, s));

    // Leave balances for everyone + a few requests
    const year = new Date().getFullYear();
    const emps = all<any>('SELECT id FROM employees');
    const types = all<any>('SELECT * FROM leave_types');
    for (const e of emps) for (const t of types) insert('leave_balances', { employee_id: e.id, leave_type_id: t.id, year, allocated: t.annual_quota, carried: t.code === 'EL' ? 4 : 0, adjusted: 0, used: 0 });
    const leave = (employee_id: number, type: number, start: string, end: string, days: number, status: string, reason: string) => {
      const id = insert('leave_requests', { employee_id, leave_type_id: type, start_date: start, end_date: end, days, reason, status, requested_by: null, reviewed_by: status === 'approved' ? 1 : null, reviewed_at: status === 'approved' ? now : null, created_at: now, updated_at: now });
      insert('leave_history', { leave_request_id: id, action: 'applied', by_user: null, note: reason, created_at: now });
      if (status === 'approved') run('UPDATE leave_balances SET used = used + ? WHERE employee_id = ? AND leave_type_id = ? AND year = ?', [days, employee_id, type, year]);
    };
    leave(se1, ltCasual, addDays(today(), 5), addDays(today(), 6), 2, 'pending', 'Family function');
    leave(ae, ltSick, addDays(today(), -3), addDays(today(), -2), 2, 'approved', 'Fever');
    leave(acc, ltEarned, addDays(today(), 12), addDays(today(), 16), 5, 'pending', 'Vacation');
    leave(sse, ltEarned, addDays(today(), -30), addDays(today(), -27), 4, 'approved', 'Trip');

    // Attendance from the start of the month (at least the last 14 days) up to yesterday for everyone
    const firstOfMonth = today().slice(0, 8) + '01';
    const spanDays = Math.max(14, Math.round((Date.parse(today()) - Date.parse(firstOfMonth)) / 86400000));
    for (let i = spanDays; i >= 1; i--) {
      const d = addDays(today(), -i);
      if (get('SELECT 1 FROM holidays WHERE date = ?', [d])) continue;
      const wd = new Date(d + 'T00:00:00Z').getUTCDay();
      if (wd === 0 || wd === 6) continue;
      for (const e of emps) {
        if (e.id === ae && d >= addDays(today(), -3)) continue; // on sick leave
        const lateBy = e.id === se1 && i % 3 === 0 ? 25 : 0;
        const inAt = `${d}T04:00:00.000Z`; // 09:30 IST
        const inTs = new Date(Date.parse(inAt) + lateBy * 60000).toISOString();
        const outTs = new Date(Date.parse(inAt) + (9 * 60 + (i % 4) * 15) * 60000).toISOString();
        const id = insert('attendance_records', { employee_id: e.id, date: d, punch_in_at: inTs, punch_in_lat: 12.9716, punch_in_lng: 77.5946, punch_in_location_id: hq, punch_in_within_fence: 1, punch_in_distance_m: 12, punch_out_at: outTs, punch_out_lat: 12.9717, punch_out_lng: 77.5947, punch_out_location_id: hq, punch_out_within_fence: 1, punch_out_distance_m: 15, status: 'present', work_minutes: 0, break_minutes: 0, overtime_minutes: 0, late_minutes: lateBy, source: 'punch', created_at: now, updated_at: now });
        const bStart = new Date(Date.parse(inTs) + 3.5 * 3600000).toISOString();
        const bEnd = new Date(Date.parse(bStart) + 45 * 60000).toISOString();
        insert('attendance_breaks', { attendance_id: id, type: 'lunch', start_at: bStart, end_at: bEnd, minutes: 45 });
        const total = Math.round((Date.parse(outTs) - Date.parse(inTs)) / 60000) - 45;
        run('UPDATE attendance_records SET work_minutes = ?, break_minutes = 45, overtime_minutes = ? WHERE id = ?', [total, Math.max(0, total - 540), id]);
      }
    }
    insert('attendance_corrections', { employee_id: se1, date: addDays(today(), -1), requested_punch_out: `${addDays(today(), -1)}T13:30:00.000Z`, reason: 'Forgot to punch out after the client call', status: 'pending', requested_by: 3, created_at: now });

    // Assets
    const asset = (tag: string, name: string, category: string, serial: string, model: string, cost: number, warranty: string, status: string) => insert('assets', { asset_tag: tag, name, category, serial_number: serial, model, vendor: 'Dell', purchase_date: '2024-02-10', purchase_cost: cost, warranty_expiry: warranty, status, condition: 'good', location: 'Bengaluru HQ', specs: { ram: '16 GB', storage: '512 GB SSD' }, created_at: now, updated_at: now });
    const a1 = asset('AST-0001', 'Dell Latitude 5440', 'Laptop', 'DL5440-001', 'Latitude 5440', 85000, addDays(today(), 400), 'assigned');
    const a2 = asset('AST-0002', 'Dell Latitude 5440', 'Laptop', 'DL5440-002', 'Latitude 5440', 85000, addDays(today(), 20), 'assigned');
    asset('AST-0003', 'MacBook Pro 14"', 'Laptop', 'MBP14-003', 'MacBook Pro M3', 190000, addDays(today(), 300), 'available');
    asset('AST-0004', 'Dell 27" Monitor', 'Monitor', 'DM27-004', 'U2723QE', 45000, addDays(today(), -10), 'available');
    asset('AST-0005', 'iPhone 15', 'Phone', 'IP15-005', 'iPhone 15', 80000, addDays(today(), 200), 'maintenance');
    insert('asset_assignments', { asset_id: a1, employee_id: se1, assigned_at: '2024-02-15T09:00:00.000Z', assigned_by: 1, condition_out: 'new', notes: 'Primary laptop' });
    insert('asset_assignments', { asset_id: a2, employee_id: sse, assigned_at: '2024-02-15T09:00:00.000Z', assigned_by: 1, condition_out: 'new' });

    // Journeys: every employee gets the template stages; long-tenured ones are complete, newest is mid-way.
    const templates = all<any>('SELECT * FROM journey_stage_templates ORDER BY sort_order');
    for (const e of emps) {
      const isNew = e.id === se2;
      templates.forEach((t, i) => {
        const status = isNew ? (i < 9 ? 'completed' : i === 9 ? 'in_progress' : 'pending') : i === templates.length - 1 ? 'in_progress' : 'completed';
        insert('journey_stages', { employee_id: e.id, template_id: t.id, name: t.name, description: t.description, sort_order: i, color: t.color, icon: t.icon, status, started_at: status !== 'pending' ? addDays(today(), -60 + i * 4) + 'T09:00:00.000Z' : null, completed_at: status === 'completed' ? addDays(today(), -58 + i * 4) + 'T17:00:00.000Z' : null, owner: t.owner_role, checklist: i === 8 ? [{ label: 'ID proof', done: true }, { label: 'Address proof', done: true }, { label: 'Education certificates', done: !isNew }] : [], created_at: now, updated_at: now });
      });
    }

    // Documents metadata (files are generated on first run by seedFiles())
    (globalThis as any).__seedDocs = [
      { employee_id: se1, document_type_id: dtPassport, title: 'Passport', expiry: addDays(today(), 25), format: 'pdf' },
      { employee_id: se1, document_type_id: dtId, title: 'National ID', expiry: null, format: 'png' },
      { employee_id: sse, document_type_id: dtVisa, title: 'Work Visa', expiry: addDays(today(), 5), format: 'pdf' },
      { employee_id: ae, document_type_id: dtContract, title: 'Employment Contract', expiry: addDays(today(), -3), format: 'pdf' },
      { employee_id: em, document_type_id: dtPassport, title: 'Passport', expiry: addDays(today(), 400), format: 'jpg' },
      { employee_id: hrHead, document_type_id: dtContract, title: 'Employment Contract', expiry: addDays(today(), 300), format: 'pdf' },
    ];
  });
  seedFiles();
  return true;
}

/** Write tiny valid PDF/PNG/JPG files for the seeded documents so previews work. */
function seedFiles() {
  const docs = (globalThis as any).__seedDocs as any[] | undefined;
  if (!docs) return;
  for (const d of docs) {
    const stored = `doc_seed_${d.employee_id}_${d.document_type_id}.${d.format}`;
    const file = path.join(UPLOAD_DIR, stored);
    const buf = sampleFile(d.format, d.title);
    fs.writeFileSync(file, buf);
    insert('documents', { employee_id: d.employee_id, document_type_id: d.document_type_id, title: d.title, original_name: `${d.title.replace(/\s+/g, '_')}.${d.format}`, stored_name: stored, mime: d.format === 'pdf' ? 'application/pdf' : d.format === 'png' ? 'image/png' : 'image/jpeg', format: d.format, size_bytes: buf.length, issued_date: '2023-01-01', expiry_date: d.expiry, document_number: 'DOC' + d.employee_id + d.document_type_id, status: 'valid', uploaded_by: 1, created_at: nowIso() });
  }
  delete (globalThis as any).__seedDocs;
}
export function sampleFile(format: string, label = 'Sample'): Buffer {
  if (format === 'pdf') {
    const text = `BT /F1 24 Tf 72 720 Td (${label.replace(/[()\\]/g, '')}) Tj ET`;
    const objs = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
      `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ];
    let out = '%PDF-1.4\n';
    const offsets: number[] = [];
    objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const xref = out.length;
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
    out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(out, 'latin1');
  }
  if (format === 'png') {
    // 1x1 blue PNG
    return Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  }
  // minimal JPEG (1x1)
  return Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64');
}

// Allow `npm run seed` to force a reseed of a fresh database file.
if (process.argv[1] && process.argv[1].endsWith('seed.ts')) {
  const created = seedIfEmpty();
  console.log(created ? 'Database seeded.' : 'Database already has data; nothing to do. Delete server/data/hrms.sqlite to reseed.');
}
