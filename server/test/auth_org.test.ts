import { describe, it, expect, afterAll } from 'vitest';
import { app, request, hr, employee, manager, auth, cleanup, PASSWORD } from './helpers.js';

afterAll(cleanup);

describe('auth', () => {
  it('rejects bad credentials and unauthenticated access', async () => {
    expect((await request(app).post('/api/auth/login').send({ email: 'hr@acme.example', password: 'nope' })).status).toBe(401);
    expect((await request(app).get('/api/employees')).status).toBe(401);
  });
  it('logs in with a cookie session and returns the profile', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'hr@acme.example', password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.headers['set-cookie'][0]).toMatch(/hrms_session=/);
    expect(res.body.user.role).toBe('hr');
    const me = await request(app).get('/api/auth/me').set('Cookie', res.headers['set-cookie'][0]);
    expect(me.body.user.email).toBe('hr@acme.example');
    const out = await request(app).post('/api/auth/logout').set('Cookie', res.headers['set-cookie'][0]);
    expect(out.status).toBe(200);
    expect((await request(app).get('/api/auth/me').set('Cookie', res.headers['set-cookie'][0])).status).toBe(401);
  });
  it('enforces roles', async () => {
    const e = await employee();
    expect((await request(app).get('/api/settings/users/list').set(auth(e))).status).toBe(403);
    expect((await request(app).post('/api/org/departments').set(auth(e)).send({ name: 'X' })).status).toBe(403);
    const m = await manager();
    expect((await request(app).get('/api/attendance/daily').set(auth(m))).status).toBe(200);
  });
  it('changes password', async () => {
    const e = await employee();
    expect((await request(app).post('/api/auth/change-password').set(auth(e)).send({ current_password: 'wrong', new_password: 'NewPassword9' })).status).toBe(400);
    expect((await request(app).post('/api/auth/change-password').set(auth(e)).send({ current_password: PASSWORD, new_password: 'NewPassword9' })).status).toBe(200);
    expect((await request(app).post('/api/auth/login').send({ email: 'employee@acme.example', password: 'NewPassword9' })).status).toBe(200);
    // restore
    const t = await request(app).post('/api/auth/login').send({ email: 'employee@acme.example', password: 'NewPassword9' });
    await request(app).post('/api/auth/change-password').set(auth(t.body.token)).send({ current_password: 'NewPassword9', new_password: PASSWORD });
  });
});

describe('stateless sessions (serverless mode)', () => {
  it('issues a signed token that works without a session row and rejects tampering', async () => {
    process.env.HRMS_STATELESS_SESSIONS = '1';
    process.env.HRMS_SESSION_SECRET = 'test-secret';
    try {
      const res = await request(app).post('/api/auth/login').send({ email: 'hr@acme.example', password: PASSWORD });
      expect(res.status).toBe(200);
      expect(res.body.token).toContain('.');
      const me = await request(app).get('/api/auth/me').set(auth(res.body.token));
      expect(me.status).toBe(200);
      expect(me.body.user.role).toBe('hr');
      const [payload] = res.body.token.split('.');
      expect((await request(app).get('/api/auth/me').set(auth(`${payload}.bad`))).status).toBe(401);
      const forged = Buffer.from(JSON.stringify({ u: 1, r: 'hr', e: null, x: Date.now() + 1e6 })).toString('base64url');
      expect((await request(app).get('/api/auth/me').set(auth(`${forged}.${'a'.repeat(43)}`))).status).toBe(401);
      process.env.HRMS_SESSION_SECRET = 'rotated';
      expect((await request(app).get('/api/auth/me').set(auth(res.body.token))).status).toBe(401);
    } finally {
      delete process.env.HRMS_STATELESS_SESSIONS;
      delete process.env.HRMS_SESSION_SECRET;
    }
  });
});

describe('org structure', () => {
  it('creates departments, positions, and builds both tree modes', async () => {
    const t = await hr();
    const d = await request(app).post('/api/org/departments').set(auth(t)).send({ name: 'Research', code: 'RES', color: '#123456' });
    expect(d.status).toBe(201);
    const child = await request(app).post('/api/org/departments').set(auth(t)).send({ name: 'Labs', parent_id: d.body.id });
    expect(child.body.parent_name).toBe('Research');
    // cycle protection
    expect((await request(app).put(`/api/org/departments/${d.body.id}`).set(auth(t)).send({ parent_id: child.body.id })).status).toBe(400);
    const p = await request(app).post('/api/org/positions').set(auth(t)).send({ title: 'Research Scientist', department_id: d.body.id, level: 5, headcount: 3 });
    expect(p.status).toBe(201);
    expect(p.body.department_name).toBe('Research');
    const tree = await request(app).get('/api/org/tree?mode=department').set(auth(t));
    expect(tree.status).toBe(200);
    const research = JSON.stringify(tree.body.roots).includes('"Research"');
    expect(research).toBe(true);
    const rep = await request(app).get('/api/org/tree?mode=reporting').set(auth(t));
    expect(rep.body.roots.length).toBeGreaterThan(0);
    expect(rep.body.roots[0].children.length).toBeGreaterThan(0);
  });
  it('moves nodes with cycle protection', async () => {
    const t = await hr();
    const emps = (await request(app).get('/api/employees').set(auth(t))).body.items;
    const ceo = emps.find((e: any) => e.employee_code === 'EMP0001');
    const cto = emps.find((e: any) => e.employee_code === 'EMP0002');
    expect((await request(app).post('/api/org/tree/move').set(auth(t)).send({ type: 'employee', id: ceo.id, new_parent_id: cto.id })).status).toBe(400);
    const em = emps.find((e: any) => e.employee_code === 'EMP0004');
    expect((await request(app).post('/api/org/tree/move').set(auth(t)).send({ type: 'employee', id: em.id, new_parent_id: ceo.id })).status).toBe(200);
    const after = (await request(app).get(`/api/employees/${em.id}`).set(auth(t))).body;
    expect(after.manager_id).toBe(ceo.id);
    await request(app).post('/api/org/tree/move').set(auth(t)).send({ type: 'employee', id: em.id, new_parent_id: cto.id });
  });
  it('blocks deleting a department with employees', async () => {
    const t = await hr();
    const depts = (await request(app).get('/api/org/departments').set(auth(t))).body;
    const eng = depts.find((d: any) => d.code === 'ENG');
    expect((await request(app).delete(`/api/org/departments/${eng.id}`).set(auth(t))).status).toBe(400);
  });
});

describe('settings', () => {
  it('stores company, document rules, custom fields, users', async () => {
    const t = await hr();
    const c = await request(app).put('/api/settings/company').set(auth(t)).send({ name: 'Globex' });
    expect(c.body.name).toBe('Globex');
    expect((await request(app).get('/api/settings/public')).body.name).toBe('Globex');
    expect((await request(app).put('/api/settings/documents').set(auth(t)).send({ allowed_formats: ['exe'] })).status).toBe(400);
    expect((await request(app).put('/api/settings/documents').set(auth(t)).send({ allowed_formats: ['pdf'] })).body.allowed_formats).toEqual(['pdf']);
    await request(app).put('/api/settings/documents').set(auth(t)).send({ allowed_formats: ['pdf', 'jpg', 'png'] });
    const cf = await request(app).post('/api/settings/custom-fields').set(auth(t)).send({ entity: 'employee', label: 'Shoe size', type: 'number', required: 1 });
    expect(cf.status).toBe(201);
    expect(cf.body.key).toBe('shoe_size');
    // required custom field is enforced on employee creation
    const bad = await request(app).post('/api/employees').set(auth(t)).send({ first_name: 'No', last_name: 'Field', email: 'nofield@acme.example' });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/Shoe size/);
    await request(app).put(`/api/settings/custom-fields/${cf.body.id}`).set(auth(t)).send({ required: 0 });
    const u = await request(app).post('/api/settings/users').set(auth(t)).send({ email: 'new.user@acme.example', password: 'Password123!', role: 'employee' });
    expect(u.status).toBe(201);
    expect((await request(app).post('/api/settings/users').set(auth(t)).send({ email: 'new.user@acme.example', password: 'Password123!', role: 'employee' })).status).toBe(409);
    expect((await request(app).post('/api/auth/login').send({ email: 'new.user@acme.example', password: 'Password123!' })).status).toBe(200);
  });
});
