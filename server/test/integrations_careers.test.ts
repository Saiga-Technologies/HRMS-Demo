import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, request, hr, manager, employee, auth, cleanup } from './helpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const CV = path.join(here, '..', '..', 'e2e', 'fixtures', 'cv-sample.txt');

// Local receiver for webhook deliveries.
const received: { headers: http.IncomingHttpHeaders; body: string }[] = [];
let server: http.Server;
let hookUrl = '';
beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      received.push({ headers: req.headers, body });
      res.statusCode = req.url === '/fail' ? 500 : 200;
      res.end('ok');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  hookUrl = `http://127.0.0.1:${(server.address() as any).port}/hook`;
});
afterAll(() => {
  server?.close();
  cleanup();
});

const waitFor = async (pred: () => boolean, ms = 3000) => {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 25));
  }
};

describe('public careers page', () => {
  it('lists open vacancies with their published job description and no internal fields', async () => {
    const res = await request(app).get('/api/public/jobs');
    expect(res.status).toBe(200);
    expect(res.body.company.name).toBeTruthy();
    const se = res.body.jobs.find((j: any) => j.title === 'Software Engineer (Platform)');
    expect(se).toBeTruthy();
    expect(Array.isArray(se.skills)).toBe(true);
    expect(se.department_name).toBeTruthy();
    expect(se.budget_annual).toBeUndefined();
    const one = await request(app).get(`/api/public/jobs/${se.id}`);
    expect(one.body.job.title).toBe(se.title);
  });

  it('accepts an application with a CV, puts it in the pipeline and rejects duplicates', async () => {
    const jobs = (await request(app).get('/api/public/jobs')).body.jobs;
    const se = jobs.find((j: any) => j.title === 'Software Engineer (Platform)');
    const res = await request(app).post(`/api/public/jobs/${se.id}/apply`)
      .field('first_name', 'Riya').field('last_name', 'Banerjee').field('email', 'riya.applicant@example.com').field('phone', '+91 98200 00000')
      .attach('cv', CV);
    expect(res.status).toBe(201);
    expect(res.body.reference).toMatch(/^APP-\d{5}$/);
    const list = (await request(app).get('/api/recruitment/candidates?q=riya.applicant').set(auth(await hr()))).body.items;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ source: 'Careers page', stage: 'new', vacancy_id: se.id });
    expect(list[0].score).toBeGreaterThan(0);

    const dup = await request(app).post(`/api/public/jobs/${se.id}/apply`).field('first_name', 'Riya').field('email', 'RIYA.applicant@example.com').attach('cv', CV);
    expect(dup.status).toBe(409);
  });

  it('validates the application', async () => {
    const se = (await request(app).get('/api/public/jobs')).body.jobs[0];
    expect((await request(app).post(`/api/public/jobs/${se.id}/apply`).field('first_name', 'A').field('email', 'a@example.com')).status).toBe(400); // no CV
    expect((await request(app).post(`/api/public/jobs/${se.id}/apply`).field('first_name', 'A').field('email', 'nope').attach('cv', CV)).status).toBe(400);
    expect((await request(app).post('/api/public/jobs/99999/apply').field('first_name', 'A').field('email', 'a@example.com').attach('cv', CV)).status).toBe(404);
    expect((await request(app).get('/api/public/jobs/99999')).status).toBe(404);
  });
});

describe('integrations', () => {
  it('is HR only', async () => {
    expect((await request(app).get('/api/integrations').set(auth(await manager()))).status).toBe(403);
    expect((await request(app).get('/api/integrations').set(auth(await employee()))).status).toBe(403);
    const res = await request(app).get('/api/integrations').set(auth(await hr()));
    expect(res.status).toBe(200);
    expect(res.body.scopes.map((s: any) => s.key)).toContain('candidates:write');
    expect(res.body.careers.open_jobs).toBeGreaterThan(0);
  });

  it('creates an API key shown once, authenticates with it, enforces scopes and revokes it', async () => {
    const t = await hr();
    const created = await request(app).post('/api/integrations/keys').set(auth(t)).send({ name: 'Job board', scopes: ['candidates:write'] });
    expect(created.status).toBe(201);
    const key = created.body.key as string;
    expect(key).toMatch(/^hrms_/);
    expect(created.body.key_hash).toBeUndefined();
    const listed = (await request(app).get('/api/integrations').set(auth(t))).body.keys.find((k: any) => k.id === created.body.id);
    expect(listed.key).toBeUndefined();
    expect(key.startsWith(listed.key_prefix)).toBe(true);
    expect(key).toMatch(/^hrms_acme_/);

    expect((await request(app).post('/api/public/v1/candidates').send({ first_name: 'X' })).status).toBe(401);
    expect((await request(app).get('/api/public/v1/jobs').set('X-API-Key', key)).status).toBe(403);
    const cand = await request(app).post('/api/public/v1/candidates').set('X-API-Key', key).send({ first_name: 'Api', last_name: 'Person', email: 'api.person@example.com' });
    expect(cand.status).toBe(201);
    expect(cand.body.stage).toBe('new');
    const row = (await request(app).get(`/api/recruitment/candidates/${cand.body.id}`).set(auth(t))).body;
    expect(row.source).toBe('API: Job board');

    expect((await request(app).post('/api/integrations/keys').set(auth(t)).send({ name: 'x', scopes: ['admin'] })).status).toBe(400);
    const revoked = await request(app).post(`/api/integrations/keys/${created.body.id}/revoke`).set(auth(t));
    expect(revoked.body.active).toBe(0);
    expect((await request(app).post('/api/public/v1/candidates').set('X-API-Key', key).send({ first_name: 'Y' })).status).toBe(401);
    expect((await request(app).delete(`/api/integrations/keys/${created.body.id}`).set(auth(t))).status).toBe(200);
  });

  it('delivers signed webhooks for recruitment events and logs deliveries', async () => {
    const t = await hr();
    expect((await request(app).post('/api/integrations/webhooks').set(auth(t)).send({ url: 'ftp://x', events: ['candidate.created'] })).status).toBe(400);
    expect((await request(app).post('/api/integrations/webhooks').set(auth(t)).send({ url: hookUrl, events: ['nope'] })).status).toBe(400);
    const hook = await request(app).post('/api/integrations/webhooks').set(auth(t)).send({ url: hookUrl, events: ['candidate.created', 'candidate.stage_changed'], secret: 's3cret' });
    expect(hook.status).toBe(201);
    expect(hook.body.secret).toBeUndefined();
    expect(hook.body.has_secret).toBe(true);

    const test = await request(app).post(`/api/integrations/webhooks/${hook.body.id}/test`).set(auth(t));
    expect(test.body.delivery.ok).toBe(1);
    const ping = received.at(-1)!;
    expect(ping.headers['x-hrms-event']).toBe('ping');
    expect(ping.headers['x-hrms-signature']).toBe('sha256=' + crypto.createHmac('sha256', 's3cret').update(ping.body).digest('hex'));

    const before = received.length;
    const c = await request(app).post('/api/recruitment/candidates').set(auth(t)).send({ first_name: 'Hook', last_name: 'Test', email: 'hook@example.com' });
    await waitFor(() => received.length > before);
    const ev = JSON.parse(received.at(-1)!.body);
    expect(ev.event).toBe('candidate.created');
    expect(ev.data).toMatchObject({ id: c.body.id, email: 'hook@example.com' });

    await request(app).put(`/api/recruitment/candidates/${c.body.id}`).set(auth(t)).send({ stage: 'screening' });
    await waitFor(() => received.some((r) => JSON.parse(r.body).event === 'candidate.stage_changed'));

    const failing = await request(app).put(`/api/integrations/webhooks/${hook.body.id}`).set(auth(t)).send({ url: hookUrl.replace('/hook', '/fail') });
    expect(failing.body.url).toMatch(/\/fail$/);
    const bad = await request(app).post(`/api/integrations/webhooks/${hook.body.id}/test`).set(auth(t));
    expect(bad.body.delivery).toMatchObject({ ok: 0, status_code: 500 });
    const log = (await request(app).get(`/api/integrations/webhooks/${hook.body.id}/deliveries`).set(auth(t))).body;
    expect(log.length).toBeGreaterThanOrEqual(4);
    expect(log[0].ok).toBe(0);
    expect((await request(app).delete(`/api/integrations/webhooks/${hook.body.id}`).set(auth(t))).status).toBe(200);
  });
});
