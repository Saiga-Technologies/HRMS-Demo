import { describe, it, expect, afterAll } from 'vitest';
import { app, request, hr, employee, auth, cleanup, PASSWORD } from './helpers.js';

afterAll(cleanup);

const agencyLogin = async (email = 'admin@saigahr.example') => {
  const res = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
  expect(res.status).toBe(200);
  expect(res.body.kind).toBe('agency');
  return res.body.token as string;
};

describe('agency mode', () => {
  it('agency staff sign in once and see the portfolio, but no company data without choosing a company', async () => {
    const t = await agencyLogin();
    const me = await request(app).get('/api/auth/me').set(auth(t));
    expect(me.body).toMatchObject({ kind: 'agency', company: null });
    expect(me.body.agency.role).toBe('owner');

    const list = await request(app).get('/api/agency/companies').set(auth(t));
    expect(list.status).toBe(200);
    const acme = list.body.find((c: any) => c.slug === 'acme');
    expect(acme.snapshot.headcount).toBe(13);
    expect(['green', 'amber', 'red']).toContain(acme.snapshot.health);
    expect(acme.snapshot.payroll.milestones.map((m: any) => m.key)).toEqual(['inputs', 'attendance_lock', 'generation', 'client_approval', 'payment']);

    // Company endpoints need an explicit company.
    expect((await request(app).get('/api/employees').set(auth(t))).status).toBe(400);
    const emps = await request(app).get('/api/c/acme/employees').set(auth(t));
    expect(emps.status).toBe(200);
    expect(emps.body.total).toBe(13);
    const meIn = await request(app).get('/api/c/acme/auth/me').set(auth(t));
    expect(meIn.body).toMatchObject({ kind: 'agency', company: { slug: 'acme' } });
    expect(meIn.body.user.role).toBe('hr');

    expect((await request(app).get('/api/c/nope/employees').set(auth(t))).status).toBe(404);
  });

  it('company logins are pinned to their company', async () => {
    const t = await hr();
    const me = await request(app).get('/api/auth/me').set(auth(t));
    expect(me.body).toMatchObject({ kind: 'company', company: { slug: 'acme' } });
    expect((await request(app).get('/api/agency/companies').set(auth(t))).status).toBe(403);
    expect((await request(app).get('/api/c/nimbus-retail/employees').set(auth(t))).status).toBe(403);
    expect((await request(app).get('/api/c/acme/employees').set(auth(t))).status).toBe(200);
  });

  it('account managers only see their companies; alerts and calendar aggregate them', async () => {
    const t = await agencyLogin('am.us@saigahr.example');
    const list = (await request(app).get('/api/agency/companies').set(auth(t))).body;
    expect(list.every((c: any) => c.country_code === 'US')).toBe(true);
    expect((await request(app).get('/api/c/acme/employees').set(auth(t))).status).toBe(403);

    const owner = await agencyLogin();
    const alerts = await request(app).get('/api/agency/alerts').set(auth(owner));
    expect(alerts.status).toBe(200);
    expect(alerts.body.counts).toBeTruthy();
    const cal = await request(app).get('/api/agency/calendar').set(auth(owner));
    expect(cal.body.events.some((e: any) => e.kind === 'payroll' && e.company_slug === 'acme')).toBe(true);
    expect(cal.body.events.some((e: any) => e.kind === 'compliance')).toBe(true);
  });

  it('the client approves the payroll register, not the agency; service requests flow both ways', async () => {
    const owner = await agencyLogin();
    const period = '2025-01';
    const created = await request(app).post('/api/c/acme/payroll/runs').set(auth(owner)).send({ period });
    expect(created.status).toBe(201);
    expect((await request(app).post(`/api/c/acme/payroll/runs/${created.body.id}/process`).set(auth(owner))).status).toBe(200);
    const denied = await request(app).post(`/api/c/acme/payroll/runs/${created.body.id}/status`).set(auth(owner)).send({ status: 'approved' });
    expect(denied.status).toBe(403);
    const client = await hr();
    const counts = (await request(app).get('/api/notifications/counts').set(auth(client))).body.counts;
    expect(counts.payroll_client_approval).toBeGreaterThan(0);
    const ok = await request(app).post(`/api/payroll/runs/${created.body.id}/status`).set(auth(client)).send({ status: 'approved' });
    expect(ok.status).toBe(200);
    expect(ok.body.approved_by).toBeTruthy();

    const sr = await request(app).post('/api/services/requests').set(auth(client)).send({ subject: 'Add two joiners for November', category: 'onboarding', priority: 'high' });
    expect(sr.status).toBe(201);
    expect(sr.body.number).toMatch(/^SR-\d{4}-\d{4}$/);
    const inbox = (await request(app).get('/api/agency/requests').set(auth(owner))).body;
    expect(inbox.some((x: any) => x.id === sr.body.id && x.company_slug === 'acme')).toBe(true);
    const taken = await request(app).put(`/api/c/acme/services/requests/${sr.body.id}`).set(auth(owner)).send({ assign_to_me: true });
    expect(taken.body).toMatchObject({ status: 'in_progress', assignee_name: 'Lakshmi Menon' });
    // Clients cannot resolve on the agency's behalf.
    expect((await request(app).put(`/api/services/requests/${sr.body.id}`).set(auth(client)).send({ status: 'resolved' })).status).toBe(403);
    const reply = await request(app).post(`/api/c/acme/services/requests/${sr.body.id}/comments`).set(auth(owner)).send({ body: 'Send the offer letters please.' });
    expect(reply.body.thread.at(-1)).toMatchObject({ author_side: 'agency' });

    // Employees have no access to agency services.
    expect((await request(app).get('/api/services/requests').set(auth(await employee()))).status).toBe(403);
  });

  it('compliance filings are generated per country and only the agency marks them filed', async () => {
    const client = await hr();
    const list = (await request(app).get('/api/services/compliance').set(auth(client))).body;
    expect(list.some((f: any) => f.code === 'IN_PF_ECR')).toBe(true);
    const pending = list.find((f: any) => f.status === 'pending');
    expect((await request(app).put(`/api/services/compliance/${pending.id}`).set(auth(client)).send({ status: 'filed', reference: 'X' })).status).toBe(403);
    const owner = await agencyLogin();
    expect((await request(app).put(`/api/c/acme/services/compliance/${pending.id}`).set(auth(owner)).send({ status: 'filed' })).status).toBe(400);
    const filed = await request(app).put(`/api/c/acme/services/compliance/${pending.id}`).set(auth(owner)).send({ status: 'filed', reference: 'ECR-123' });
    expect(filed.body).toMatchObject({ status: 'filed', reference: 'ECR-123', state: 'filed' });
  });
});
