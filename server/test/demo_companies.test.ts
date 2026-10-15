import { describe, it, expect, afterAll } from 'vitest';
import { app, request, auth, cleanup, PASSWORD } from './helpers.js';

// helpers.ts has already pointed the data directory at a temp folder and seeded (incl. demo companies).
const { all, get } = await import('../src/db.js');
const { runAsTenant } = await import('../src/context.js');
const { DEMO_COMPANIES } = await import('../src/seed/registry.js');
const { today } = await import('../src/util.js');

afterAll(cleanup);

const EXPECTED_LEAVE: Record<string, string[]> = {
  IN: ['CL', 'SL', 'EL', 'CO', 'LWP', 'ML'],
  AE: ['AL', 'SL', 'ML', 'PL', 'HJ', 'CO', 'LWP'],
  SA: ['AL', 'SL', 'ML', 'HJ', 'MR', 'BR', 'CO'],
  QA: ['AL', 'SL', 'ML', 'HJ', 'CO'],
  US: ['PTO', 'SL', 'FMLA', 'PL', 'CO', 'LWP'],
};

describe.each(DEMO_COMPANIES.map((c) => [c.slug, c] as const))('demo company %s', (slug, def) => {
  const q = <T>(fn: () => T) => runAsTenant({ slug, timezone: def.timezone }, fn);

  it('has the registry headcount, departments with heads and a reporting line', () => {
    q(() => {
      expect(get<any>('SELECT COUNT(*) AS n FROM employees')!.n).toBe(def.employees);
      expect(get<any>('SELECT COUNT(*) AS n FROM employees WHERE manager_id IS NULL')!.n).toBe(1);
      expect(get<any>('SELECT COUNT(*) AS n FROM departments WHERE head_employee_id IS NULL')!.n).toBe(0);
      const statuses = all<any>('SELECT DISTINCT status FROM employees').map((r) => r.status);
      for (const s of ['active', 'probation', 'notice', 'exited']) expect(statuses).toContain(s);
      expect(get<any>(`SELECT COUNT(*) AS n FROM employees WHERE email NOT LIKE '%@${slug}.example'`)!.n).toBe(0);
    });
  });

  it('lets the four company logins sign in to this company', async () => {
    for (const who of ['hr', 'payroll', 'manager', 'employee']) {
      const res = await request(app).post('/api/auth/login').send({ email: `${who}@${slug}.example`, password: PASSWORD });
      expect(res.status, `${who}@${slug}.example`).toBe(200);
      expect(res.body.company.slug).toBe(slug);
      expect(res.body.user.employee_id).toBeTruthy();
    }
  });

  it('scopes GET /api/employees to the company', async () => {
    const login = await request(app).post('/api/auth/login').send({ email: `hr@${slug}.example`, password: PASSWORD });
    const res = await request(app).get('/api/employees?include_exited=1').set(auth(login.body.token));
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBe(def.employees);
    for (const e of res.body.items) expect(e.email.endsWith(`@${slug}.example`)).toBe(true);
  });

  it('respects the weekly offs in attendance (only a few deliberate weekly-off work rows)', () => {
    q(() => {
      const rows = all<any>('SELECT date FROM attendance_records');
      expect(rows.length).toBeGreaterThan(def.employees * 20);
      const onOffs = rows.filter((r) => def.weekly_offs.includes(new Date(r.date + 'T00:00:00Z').getUTCDay())).length;
      expect(onOffs).toBeGreaterThan(0);
      expect(onOffs).toBeLessThanOrEqual(5);
      const holidays = get<any>('SELECT COUNT(*) AS n FROM attendance_records a JOIN holidays h ON h.date = a.date')!.n;
      expect(holidays).toBe(0);
      expect(get<any>('SELECT MAX(date) AS d FROM attendance_records')!.d < today()).toBe(true);
    });
  });

  it('has three paid payroll runs and the registry run state for this month', () => {
    q(() => {
      const t = today().slice(0, 7);
      const paid = all<any>("SELECT * FROM payroll_runs WHERE status = 'paid' AND period < ?", [t]);
      expect(paid.length).toBe(3);
      for (const r of paid) {
        const n = get<any>('SELECT COUNT(*) AS n, SUM(net < 0) AS neg FROM payslips WHERE run_id = ?', [r.id])!;
        expect(n.n).toBe(JSON.parse(r.totals).employees);
        expect(n.n).toBeGreaterThan(def.employees - 5);
        expect(n.neg).toBe(0);
        expect(r.approved_by).toBeTruthy();
      }
      const current = get<any>('SELECT * FROM payroll_runs WHERE period = ?', [t]);
      if (def.run_state === 'none') expect(current).toBeUndefined();
      else expect(current?.status).toBe(def.run_state);
      const slips = current ? get<any>('SELECT COUNT(*) AS n FROM payslips WHERE run_id = ?', [current.id])!.n : 0;
      expect(slips > 0).toBe(def.run_state === 'processed' || def.run_state === 'approved');
    });
  });

  it('uses the country leave types, currency and statutory components', () => {
    q(() => {
      const codes = all<any>('SELECT code FROM leave_types').map((r) => r.code);
      for (const c of EXPECTED_LEAVE[def.country_code]) expect(codes).toContain(c);
      const currencies = all<any>('SELECT DISTINCT currency FROM salary_structures').map((r) => r.currency);
      expect(currencies).toEqual([def.currency]);
      const comps = all<any>('SELECT code FROM salary_components').map((r) => r.code);
      const expected = def.country_code === 'IN' ? ['HRA', 'PF', 'ESI', 'PT', 'TDS'] : def.country_code === 'AE' ? ['HOUSING', 'GPSSA'] : def.country_code === 'SA' ? ['HOUSING', 'GOSI'] : def.country_code === 'QA' ? ['HOUSING', 'GRSIA'] : ['TDS', 'SS', 'MED'];
      for (const c of expected) expect(comps).toContain(c);
      expect(get<any>('SELECT COUNT(*) AS n FROM leave_balances')!.n).toBeGreaterThan(0);
      expect(get<any>("SELECT COUNT(*) AS n FROM holidays WHERE date >= ?", [`${Number(today().slice(0, 4)) + 1}-01-01`])!.n).toBeGreaterThan(0);
      const settings = JSON.parse(get<any>("SELECT value FROM settings WHERE key = 'attendance'")!.value);
      expect(settings.weekly_offs).toEqual(def.weekly_offs);
    });
  });
});
