import { describe, it, expect, afterAll } from 'vitest';
import { app, request, hr, employee, manager, auth, cleanup, sampleFile } from './helpers.js';

afterAll(cleanup);

describe('employees', () => {
  it('HR creates an employee with login, journey stages and leave balances', async () => {
    const t = await hr();
    const next = await request(app).get('/api/employees/next-code').set(auth(t));
    expect(next.body.employee_code).toBe('EMP0014');
    const res = await request(app).post('/api/employees').set(auth(t)).send({
      first_name: 'Test', last_name: 'Person', email: 'test.person@acme.example', join_date: '2026-10-01', department_id: 2, position_id: 5,
      custom_fields: { blood_group: 'B+' }, create_login: true, login_password: 'Welcome123!',
    });
    expect(res.status).toBe(201);
    expect(res.body.employee_code).toBe('EMP0014');
    expect(res.body.custom_fields.blood_group).toBe('B+');
    expect(res.body.temporary_password).toBe('Welcome123!');
    const j = await request(app).get(`/api/journey/employee/${res.body.id}`).set(auth(t));
    expect(j.body.stages.length).toBe(14);
    const b = await request(app).get(`/api/leave/balances/${res.body.id}`).set(auth(t));
    expect(b.body.length).toBeGreaterThan(0);
    const login = await request(app).post('/api/auth/login').send({ email: 'test.person@acme.example', password: 'Welcome123!' });
    expect(login.status).toBe(200);
    expect(login.body.user.employee_id).toBe(res.body.id);
  });
  it('validates custom select options and duplicate emails', async () => {
    const t = await hr();
    const bad = await request(app).post('/api/employees').set(auth(t)).send({ first_name: 'Bad', email: 'bad@acme.example', custom_fields: { blood_group: 'Z' } });
    expect(bad.status).toBe(400);
    const dup = await request(app).post('/api/employees').set(auth(t)).send({ first_name: 'Dup', email: 'sara.thomas@acme.example' });
    expect(dup.status).toBe(409);
  });
  it('employees only see themselves and cannot see bank details of others', async () => {
    const e = await employee();
    const list = await request(app).get('/api/employees').set(auth(e));
    expect(list.body.items.length).toBe(1);
    expect(list.body.items[0].bank_account_number).toBeDefined(); // own record keeps it
    expect((await request(app).get('/api/employees/1').set(auth(e))).status).toBe(403);
    const m = await manager();
    const mine = await request(app).get('/api/employees').set(auth(m));
    expect(mine.body.items.length).toBe(3); // self + 2 reports
    const report = mine.body.items.find((x: any) => x.employee_code === 'EMP0006');
    expect(report.bank_account_number).toBeUndefined();
    // employee can edit own phone but not salary-related fields
    const upd = await request(app).put(`/api/employees/${list.body.items[0].id}`).set(auth(e)).send({ phone: '+91 1', status: 'exited' });
    expect(upd.status).toBe(200);
    expect(upd.body.phone).toBe('+91 1');
    expect(upd.body.status).toBe('active');
  });
  it('uploads and serves a photo', async () => {
    const t = await hr();
    const res = await request(app).post('/api/employees/6/photo').set(auth(t)).attach('photo', sampleFile('png'), 'me.png');
    expect(res.status).toBe(200);
    expect((await request(app).get('/api/employees/6/photo').set(auth(t))).status).toBe(200);
    expect((await request(app).post('/api/employees/6/photo').set(auth(t)).attach('photo', sampleFile('pdf'), 'me.pdf')).status).toBe(400);
  });
});

describe('documents', () => {
  it('enforces per-type formats, magic bytes, expiry and computes colour state', async () => {
    const t = await hr();
    const types = (await request(app).get('/api/documents/types').set(auth(t))).body;
    const visa = types.find((x: any) => x.name === 'Work Visa / Permit'); // pdf only, requires expiry
    const passport = types.find((x: any) => x.name === 'Passport');
    // wrong format for the type
    const wrong = await request(app).post('/api/documents').set(auth(t)).field('employee_id', '6').field('document_type_id', String(visa.id)).field('expiry_date', '2030-01-01').attach('file', sampleFile('png'), 'visa.png');
    expect(wrong.status).toBe(400);
    expect(wrong.body.error).toMatch(/PDF/);
    // missing expiry
    const noExp = await request(app).post('/api/documents').set(auth(t)).field('employee_id', '6').field('document_type_id', String(visa.id)).attach('file', sampleFile('pdf'), 'visa.pdf');
    expect(noExp.status).toBe(400);
    // disguised content
    const fake = await request(app).post('/api/documents').set(auth(t)).field('employee_id', '6').field('document_type_id', String(passport.id)).field('expiry_date', '2030-01-01').attach('file', Buffer.from('not a pdf at all'), { filename: 'x.pdf', contentType: 'application/pdf' });
    expect(fake.status).toBe(400);
    // good upload expiring in 10 days -> warning for passport (warn 180, critical 30 => critical)
    const d = new Date(); d.setUTCDate(d.getUTCDate() + 10);
    const ok = await request(app).post('/api/documents').set(auth(t)).field('employee_id', '6').field('document_type_id', String(passport.id)).field('title', 'My passport').field('expiry_date', d.toISOString().slice(0, 10)).attach('file', sampleFile('pdf'), 'passport.pdf');
    expect(ok.status).toBe(201);
    expect(ok.body.expiry_state).toBe('critical');
    expect(ok.body.expiry_color).toBe('#ea580c');
    expect(ok.body.days_to_expiry).toBe(10);
    const file = await request(app).get(`/api/documents/${ok.body.id}/file`).set(auth(t));
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toMatch(/pdf/);
    const expiring = await request(app).get('/api/documents?expiring=1').set(auth(t));
    expect(expiring.body.items.some((x: any) => x.id === ok.body.id)).toBe(true);
    expect(expiring.body.items.some((x: any) => x.expiry_state === 'expired')).toBe(true);
    // employee cannot read another employee's file
    const e = await employee();
    const other = expiring.body.items.find((x: any) => x.employee_id !== 6);
    expect((await request(app).get(`/api/documents/${other.id}/file`).set(auth(e))).status).toBe(403);
    // compliance matrix
    const comp = await request(app).get('/api/documents/compliance').set(auth(t));
    expect(comp.body.types.length).toBeGreaterThan(0);
    expect(comp.body.rows.length).toBeGreaterThan(5);
    // delete
    expect((await request(app).delete(`/api/documents/${ok.body.id}`).set(auth(t))).status).toBe(200);
  });
  it('HR customises document type formats', async () => {
    const t = await hr();
    const created = await request(app).post('/api/documents/types').set(auth(t)).send({ name: 'Offer letter', allowed_formats: ['pdf', 'jpg'], requires_expiry: 0 });
    expect(created.status).toBe(201);
    expect(created.body.allowed_formats).toEqual(['pdf', 'jpg']);
    expect((await request(app).put(`/api/documents/types/${created.body.id}`).set(auth(t)).send({ allowed_formats: [] })).status).toBe(400);
    const up = await request(app).post('/api/documents').set(auth(t)).field('employee_id', '6').field('document_type_id', String(created.body.id)).attach('file', sampleFile('jpg'), 'offer.jpg');
    expect(up.status).toBe(201);
    expect(up.body.format).toBe('jpg');
    expect(up.body.expiry_state).toBe('none');
  });
});
