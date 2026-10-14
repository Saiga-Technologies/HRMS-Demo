import { describe, it, expect, afterAll } from 'vitest';
import { app, request, hr, manager, employee, auth, cleanup } from './helpers.js';

afterAll(cleanup);

describe('payroll', () => {
  it('computes a salary structure preview with statutory deductions', async () => {
    const t = await hr();
    const comps = (await request(app).get('/api/payroll/components').set(auth(t))).body;
    const spl = comps.find((c: any) => c.code === 'SPL');
    const prev = await request(app).post('/api/payroll/structures/preview').set(auth(t)).send({ basic: 50000, components: [{ component_id: spl.id, value: 10000 }] });
    expect(prev.status).toBe(200);
    const hra = prev.body.earnings.find((e: any) => e.code === 'HRA');
    expect(hra.amount).toBe(20000); // 40% of basic
    expect(prev.body.earnings.find((e: any) => e.code === 'SPL').amount).toBe(10000);
    expect(prev.body.gross).toBe(50000 + 20000 + 1600 + 10000);
    const pf = prev.body.deductions.find((d: any) => d.code === 'PF');
    expect(pf.amount).toBe(1800); // 12% of ceiling 15000
    expect(prev.body.deductions.find((d: any) => d.code === 'PT').amount).toBe(200);
    expect(prev.body.net).toBe(prev.body.gross - prev.body.total_deductions);
  });
  it('runs a full payroll cycle: draft -> processed -> approved -> paid with adjustments and LOP', async () => {
    const t = await hr();
    const period = new Date().toISOString().slice(0, 7);
    const adj = await request(app).post('/api/payroll/adjustments').set(auth(t)).send({ employee_id: 6, period, type: 'bonus', amount: 5000, note: 'Spot bonus' });
    expect(adj.status).toBe(201);
    const run = await request(app).post('/api/payroll/runs').set(auth(t)).send({ period });
    expect(run.status).toBe(201);
    expect((await request(app).post('/api/payroll/runs').set(auth(t)).send({ period })).status).toBe(400);
    const processed = await request(app).post(`/api/payroll/runs/${run.body.id}/process`).set(auth(t));
    expect(processed.status).toBe(200);
    expect(processed.body.status).toBe('processed');
    expect(processed.body.totals.employees).toBeGreaterThanOrEqual(13);
    const detail = await request(app).get(`/api/payroll/runs/${run.body.id}`).set(auth(t));
    const slip = detail.body.payslips.find((p: any) => p.employee_id === 6);
    expect(slip.earnings.some((e: any) => e.code === 'BONUS' && e.amount === 5000)).toBe(true);
    expect(slip.net).toBeGreaterThan(0);
    expect(slip.paid_days).toBeLessThanOrEqual(slip.working_days);
    // employee cannot see payslip until approved
    const e = await employee();
    expect((await request(app).get(`/api/payroll/payslips/${slip.id}`).set(auth(e))).status).toBe(403);
    expect((await request(app).post(`/api/payroll/runs/${run.body.id}/status`).set(auth(t)).send({ status: 'paid' })).status).toBe(400);
    expect((await request(app).post(`/api/payroll/runs/${run.body.id}/status`).set(auth(t)).send({ status: 'approved' })).body.status).toBe('approved');
    const mine = await request(app).get('/api/payroll/payslips').set(auth(e));
    expect(mine.body.length).toBe(1);
    expect(mine.body[0].employee_name).toBe('Karthik Raj');
    expect((await request(app).get(`/api/payroll/payslips/${slip.id}`).set(auth(e))).status).toBe(200);
    // locked after approval
    expect((await request(app).put(`/api/payroll/payslips/${slip.id}`).set(auth(t)).send({ notes: 'x' })).status).toBe(400);
    expect((await request(app).post(`/api/payroll/runs/${run.body.id}/status`).set(auth(t)).send({ status: 'paid' })).body.status).toBe('paid');
    expect((await request(app).delete(`/api/payroll/runs/${run.body.id}`).set(auth(t))).status).toBe(400);
    // adjustments for a closed period are rejected
    expect((await request(app).post('/api/payroll/adjustments').set(auth(t)).send({ employee_id: 6, period, type: 'bonus', amount: 1 })).status).toBe(400);
  });
  it('payslip requests: apply, duplicate guard, fulfil only from an approved run, reject', async () => {
    const t = await hr();
    const e = await employee();
    const ago = (n: number) => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - n); return d.toISOString().slice(0, 7); };
    const period = ago(2);
    const applied = await request(app).post('/api/payroll/payslip-requests').set(auth(e)).send({ period, reason: 'Loan application' });
    expect(applied.status).toBe(201);
    expect(applied.body.status).toBe('pending');
    expect(applied.body.employee_name).toBe('Karthik Raj');
    expect((await request(app).post('/api/payroll/payslip-requests').set(auth(e)).send({ period })).status).toBe(400);
    expect((await request(app).post('/api/payroll/payslip-requests').set(auth(e)).send({ period: '2099-01' })).status).toBe(400);
    expect((await request(app).post('/api/payroll/payslip-requests').set(auth(e)).send({ period: 'nope' })).status).toBe(400);
    // employee sees own; HR sees all with a counter
    const mine = await request(app).get('/api/payroll/payslip-requests').set(auth(e));
    expect(mine.body.length).toBe(1);
    expect((await request(app).get('/api/payroll/payslip-requests').set(auth(t))).body.some((r: any) => r.id === applied.body.id)).toBe(true);
    expect((await request(app).get('/api/notifications/counts').set(auth(t))).body.counts.payslip_requests).toBeGreaterThanOrEqual(1);
    expect((await request(app).post(`/api/payroll/payslip-requests/${applied.body.id}/fulfil`).set(auth(e))).status).toBe(403);
    // no run for that period
    const noRun = await request(app).post(`/api/payroll/payslip-requests/${applied.body.id}/fulfil`).set(auth(t));
    expect(noRun.status).toBe(400);
    expect(noRun.body.error).toMatch(/No payroll run/);
    // draft run -> still refused
    const run = await request(app).post('/api/payroll/runs').set(auth(t)).send({ period });
    expect(run.status).toBe(201);
    expect((await request(app).post(`/api/payroll/payslip-requests/${applied.body.id}/fulfil`).set(auth(t))).status).toBe(400);
    // processed but not approved -> refused with an explanation
    expect((await request(app).post(`/api/payroll/runs/${run.body.id}/process`).set(auth(t))).status).toBe(200);
    const notApproved = await request(app).post(`/api/payroll/payslip-requests/${applied.body.id}/fulfil`).set(auth(t));
    expect(notApproved.status).toBe(400);
    expect(notApproved.body.error).toMatch(/processed/);
    expect((await request(app).post(`/api/payroll/runs/${run.body.id}/status`).set(auth(t)).send({ status: 'approved' })).body.status).toBe('approved');
    const done = await request(app).post(`/api/payroll/payslip-requests/${applied.body.id}/fulfil`).set(auth(t));
    expect(done.status).toBe(200);
    expect(done.body.status).toBe('fulfilled');
    expect(done.body.payslip_id).toBeTruthy();
    expect(done.body.handled_by_name).toBeTruthy();
    expect((await request(app).post(`/api/payroll/payslip-requests/${applied.body.id}/fulfil`).set(auth(t))).status).toBe(400);
    const after = (await request(app).get('/api/payroll/payslip-requests').set(auth(e))).body.find((r: any) => r.id === applied.body.id);
    expect(after.status).toBe('fulfilled');
    expect(after.payslip_id).toBe(done.body.payslip_id);
    expect((await request(app).get(`/api/payroll/payslips/${after.payslip_id}`).set(auth(e))).status).toBe(200);
    // reject path
    const second = await request(app).post('/api/payroll/payslip-requests').set(auth(e)).send({ period: ago(3) });
    expect(second.status).toBe(201);
    const rejected = await request(app).post(`/api/payroll/payslip-requests/${second.body.id}/reject`).set(auth(t)).send({ note: 'No payroll was processed that month' });
    expect(rejected.body.status).toBe('rejected');
    expect(rejected.body.note).toBe('No payroll was processed that month');
    expect((await request(app).post(`/api/payroll/payslip-requests/${second.body.id}/reject`).set(auth(t))).status).toBe(400);
    // after a decision the employee may apply again for the same period
    expect((await request(app).post('/api/payroll/payslip-requests').set(auth(e)).send({ period: ago(3) })).status).toBe(201);
  });
  it('HR adds a new salary structure for an employee', async () => {
    const t = await hr();
    const res = await request(app).post('/api/payroll/structures/6').set(auth(t)).send({ basic: 60000, effective_from: '2026-11-01', components: [] });
    expect(res.status).toBe(201);
    expect(res.body.preview.basic).toBe(60000);
    const hist = await request(app).get('/api/payroll/structures/6').set(auth(t));
    expect(hist.body.history.length).toBe(2);
    expect(hist.body.current.basic).toBe(60000);
    const e = await employee();
    expect((await request(app).get('/api/payroll/structures/6').set(auth(e))).status).toBe(200);
    expect((await request(app).get('/api/payroll/structures/5').set(auth(e))).status).toBe(403);
  });
});

describe('assets', () => {
  it('registers, assigns and returns assets with history', async () => {
    const t = await hr();
    expect((await request(app).get('/api/assets/next-tag').set(auth(t))).body.asset_tag).toBe('AST-0006');
    const a = await request(app).post('/api/assets').set(auth(t)).send({ name: 'Keyboard', category: 'Keyboard', purchase_cost: 3000, warranty_expiry: '2027-01-01', specs: { layout: 'US' } });
    expect(a.status).toBe(201);
    expect(a.body.asset_tag).toBe('AST-0006');
    expect(a.body.status).toBe('available');
    const assign = await request(app).post(`/api/assets/${a.body.id}/assign`).set(auth(t)).send({ employee_id: 6, notes: 'Desk 4' });
    expect(assign.status).toBe(200);
    expect(assign.body.status).toBe('assigned');
    expect(assign.body.assigned_to).toBe(6);
    expect((await request(app).post(`/api/assets/${a.body.id}/assign`).set(auth(t)).send({ employee_id: 5 })).status).toBe(400);
    expect((await request(app).delete(`/api/assets/${a.body.id}`).set(auth(t))).status).toBe(400);
    const e = await employee();
    const mine = await request(app).get('/api/assets/employee/6').set(auth(e));
    expect(mine.body.some((x: any) => x.asset_id === a.body.id)).toBe(true);
    expect((await request(app).get('/api/assets/employee/5').set(auth(e))).status).toBe(404);
    const ret = await request(app).post(`/api/assets/${a.body.id}/return`).set(auth(t)).send({ condition_in: 'fair', status: 'maintenance' });
    expect(ret.body.status).toBe('maintenance');
    const detail = await request(app).get(`/api/assets/${a.body.id}`).set(auth(t));
    expect(detail.body.history.length).toBe(1);
    expect(detail.body.history[0].returned_at).toBeTruthy();
    const summary = await request(app).get('/api/assets/summary').set(auth(t));
    expect(summary.body.by_status.length).toBeGreaterThan(0);
  });
});

describe('employee journey', () => {
  it('templates are customisable and drive each employee timeline', async () => {
    const t = await hr();
    const templates = (await request(app).get('/api/journey/templates').set(auth(t))).body;
    expect(templates.length).toBe(14);
    const created = await request(app).post('/api/journey/templates').set(auth(t)).send({ name: 'Buddy assigned', color: '#000000' });
    expect(created.status).toBe(201);
    const ids = [created.body.id, ...templates.map((x: any) => x.id)];
    const reordered = await request(app).put('/api/journey/templates/reorder').set(auth(t)).send({ ids });
    expect(reordered.body[0].name).toBe('Buddy assigned');
    // apply to an employee
    const applied = await request(app).post('/api/journey/employee/6/apply-templates').set(auth(t)).send({});
    expect(applied.body.stages.length).toBe(15);
    expect(applied.body.stages[0].name).toBe('Buddy assigned');
    const stage = applied.body.stages[0];
    const started = await request(app).put(`/api/journey/stages/${stage.id}`).set(auth(t)).send({ status: 'in_progress' });
    expect(started.body.started_at).toBeTruthy();
    const done = await request(app).put(`/api/journey/stages/${stage.id}`).set(auth(t)).send({ status: 'completed', checklist: [{ label: 'Intro call', done: true }] });
    expect(done.body.completed_at).toBeTruthy();
    expect(done.body.checklist[0].done).toBe(true);
    const custom = await request(app).post('/api/journey/employee/6/stages').set(auth(t)).send({ name: 'Custom milestone', color: '#ff0000' });
    expect(custom.status).toBe(201);
    const view = await request(app).get('/api/journey/employee/6').set(auth(t));
    expect(view.body.stages.length).toBe(16);
    expect(view.body.summary.total).toBe(16);
    // employee can tick checklist on own stage but not change status
    const e = await employee();
    const own = await request(app).put(`/api/journey/stages/${custom.body.id}`).set(auth(e)).send({ status: 'completed', notes: 'my note' });
    expect(own.body.status).toBe('pending');
    expect(own.body.notes).toBe('my note');
    expect((await request(app).get('/api/journey/employee/5').set(auth(e))).status).toBe(403);
    const overview = await request(app).get('/api/journey/overview').set(auth(t));
    expect(overview.body.find((x: any) => x.id === 6).journey.total).toBe(16);
    // cleanup template
    await request(app).delete(`/api/journey/templates/${created.body.id}`).set(auth(t));
  });
});

describe('dashboard', () => {
  it('has default cards per role, unlimited additions and data', async () => {
    const t = await hr();
    const cards = await request(app).get('/api/dashboard/cards').set(auth(t));
    expect(cards.body.length).toBeGreaterThan(5);
    for (let i = 0; i < 25; i++) {
      const r = await request(app).post('/api/dashboard/cards').set(auth(t)).send({ type: 'note', title: `Note ${i}`, config: { text: 'hi' } });
      expect(r.status).toBe(201);
    }
    const after = await request(app).get('/api/dashboard/cards').set(auth(t));
    expect(after.body.length).toBe(cards.body.length + 25);
    const data = await request(app).get('/api/dashboard/data').set(auth(t));
    expect(data.body.headcount).toBeGreaterThan(10);
    expect(Array.isArray(data.body.expiring_documents_list)).toBe(true);
    const e = await employee();
    expect((await request(app).post('/api/dashboard/cards').set(auth(e)).send({ type: 'stat', title: 'x', config: { key: 'open_vacancies' } })).status).toBe(400);
    const reset = await request(app).post('/api/dashboard/cards/reset').set(auth(t));
    expect(reset.body.length).toBe(cards.body.length);
  });
  it('catalog is grouped and chart cards can be added', async () => {
    const t = await hr();
    const catalog = (await request(app).get('/api/dashboard/catalog').set(auth(t))).body;
    const charts = catalog.filter((c: any) => c.type === 'chart');
    expect(charts.length).toBeGreaterThanOrEqual(15);
    expect(charts.every((c: any) => c.category && c.icon && c.size && c.chart)).toBe(true);
    for (const key of ['attendance_trend', 'today_attendance', 'headcount_by_department', 'late_comers', 'payroll_cost_trend', 'recruitment_funnel', 'document_compliance', 'my_week']) expect(charts.some((c: any) => c.key === key)).toBe(true);
    const added = await request(app).post('/api/dashboard/cards').set(auth(t)).send({ type: 'chart', title: 'Late comers', config: { key: 'late_comers' } });
    expect(added.status).toBe(201);
    expect(added.body.size).toBe('md');
    expect((await request(app).post('/api/dashboard/cards').set(auth(t)).send({ type: 'stat', title: 'x', config: { key: 'late_comers' } })).status).toBe(400);
    expect((await request(app).post('/api/dashboard/cards').set(auth(t)).send({ type: 'bogus', title: 'x' })).status).toBe(400);
    await request(app).delete(`/api/dashboard/cards/${added.body.id}`).set(auth(t));
    const defaults = (await request(app).post('/api/dashboard/cards/reset').set(auth(t))).body;
    expect(defaults.filter((c: any) => c.type === 'chart').length).toBeGreaterThanOrEqual(5);
    const e = await employee();
    const empCatalog = (await request(app).get('/api/dashboard/catalog').set(auth(e))).body;
    expect(empCatalog.some((c: any) => c.key === 'late_comers')).toBe(false);
    expect(empCatalog.some((c: any) => c.key === 'my_week')).toBe(true);
    const empDefaults = (await request(app).post('/api/dashboard/cards/reset').set(auth(e))).body;
    expect(empDefaults.some((c: any) => c.config.key === 'my_leave_balance_chart')).toBe(true);
  });
  it('data has the chart series with sane shapes for HR, managers and employees', async () => {
    const t = await hr();
    const d = (await request(app).get('/api/dashboard/data').set(auth(t))).body;
    expect(d.scope).toBe('company');
    const tr = d.attendance_trend;
    expect(tr.labels.length).toBeLessThanOrEqual(30);
    expect(tr.labels.length).toBeGreaterThan(0);
    expect(tr.present.length).toBe(tr.labels.length);
    expect(tr.absent.length).toBe(tr.labels.length);
    expect(tr.late.length).toBe(tr.labels.length);
    expect(tr.labels.every((x: string) => /^\d{4}-\d{2}-\d{2}$/.test(x))).toBe(true);
    const ta = d.today_attendance;
    expect(ta.present + ta.late + ta.on_leave + ta.absent + ta.not_in).toBe(d.headcount);
    expect(ta.total).toBe(d.headcount);
    expect(Array.isArray(d.headcount_by_department)).toBe(true);
    expect(d.headcount_by_department.reduce((s: number, x: any) => s + x.value, 0)).toBe(d.headcount);
    expect(d.headcount_trend.labels.length).toBe(12);
    expect(d.headcount_trend.joins.length).toBe(12);
    expect(Array.isArray(d.leave_utilisation)).toBe(true);
    expect(d.leave_utilisation.every((x: any) => x.allocated >= 0 && x.used >= 0)).toBe(true);
    expect(d.leave_calendar_heat.length).toBe(14);
    expect(Array.isArray(d.late_comers)).toBe(true);
    expect(d.late_comers.length).toBeLessThanOrEqual(8);
    expect(d.late_comers.length).toBeGreaterThan(0); // seeded: Karthik is late every third day
    expect(d.late_comers[0].avg_late_minutes).toBeGreaterThan(0);
    expect(d.work_hours_distribution.buckets.length).toBe(5);
    expect(d.work_hours_distribution.buckets.reduce((s: number, b: any) => s + b.value, 0)).toBe(d.work_hours_distribution.employees);
    // a processed/approved run exists from the payroll tests above
    expect(d.payroll_cost_trend.length).toBeGreaterThanOrEqual(1);
    expect(d.payroll_cost_trend[0]).toMatchObject({ period: expect.any(String), status: expect.any(String) });
    expect(d.payroll_cost_trend[0].gross).toBeGreaterThan(0);
    expect(d.payroll_by_department.items.length).toBeGreaterThan(0);
    expect(typeof d.recruitment_funnel).toBe('object');
    expect(d.recruitment_funnel.stages).toHaveProperty('new');
    expect(d.recruitment_funnel.open_vacancies).toBeGreaterThanOrEqual(1);
    expect(d.time_to_hire.hires_by_month.length).toBe(6);
    expect(d.document_compliance).toMatchObject({ ok: expect.any(Number), warning: expect.any(Number), critical: expect.any(Number), expired: expect.any(Number), missing: expect.any(Number) });
    expect(d.journey_progress.avg_completion).toBeGreaterThanOrEqual(0);
    expect(d.journey_progress.avg_completion).toBeLessThanOrEqual(100);
    expect(d.asset_utilisation.total).toBeGreaterThan(0);
    expect(d.gender_diversity.reduce((s: number, x: any) => s + x.value, 0)).toBe(d.headcount);
    expect(d.tenure_distribution.reduce((s: number, x: any) => s + x.value, 0)).toBe(d.headcount);
    expect(typeof d.comp_off_pending).toBe('number');
    expect(typeof d.travel_km_this_month).toBe('number');
    expect(d.approvals_queue.map((x: any) => x.kind)).toEqual(['leave', 'appeal', 'comp_off', 'payslip']);
    expect(d.my_week.days.length).toBe(7);
    // manager: scoped to the reporting chain + self
    const m = await manager();
    const md = (await request(app).get('/api/dashboard/data').set(auth(m))).body;
    expect(md.scope).toBe('team');
    expect(md.headcount).toBeGreaterThan(0);
    expect(md.headcount).toBeLessThan(d.headcount);
    expect(md.today_attendance.present + md.today_attendance.late + md.today_attendance.on_leave + md.today_attendance.absent + md.today_attendance.not_in).toBe(md.headcount);
    expect(md.payroll_cost_trend).toEqual([]);
    expect(md.approvals_queue.some((x: any) => x.kind === 'payslip')).toBe(false);
    // employee: self only
    const e = await employee();
    const ed = (await request(app).get('/api/dashboard/data').set(auth(e))).body;
    expect(ed.scope).toBe('self');
    expect(ed.headcount).toBe(1);
    expect(ed.my_week.days.length).toBe(7);
    expect(ed.my_week.today).toHaveProperty('status');
    expect(Array.isArray(ed.my_leave_balance_detail)).toBe(true);
    expect(ed.my_payslip_requests).toHaveProperty('pending');
  });
});
