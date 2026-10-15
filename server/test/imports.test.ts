import { describe, it, expect, afterAll } from 'vitest';
import { app, request, hr, employee, auth, cleanup, PASSWORD } from './helpers.js';
import JSZip from 'jszip';
import { parseCsv, ibanValid, abaValid } from '../src/routes/imports.js';

afterAll(cleanup);

const agencyLogin = async () => {
  const res = await request(app).post('/api/auth/login').send({ email: 'admin@saigahr.example', password: PASSWORD });
  expect(res.status).toBe(200);
  return res.body.token as string;
};

const COLS = ['employee_code', 'first_name', 'last_name', 'email', 'join_date', 'dob', 'department', 'position', 'manager', 'tax_id', 'bank_ifsc', 'bank_account_number', 'pf_number', 'nationality', 'basic_monthly', 'create_login'];
type Row = Partial<Record<(typeof COLS)[number], string>>;
const cell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
function csv(rows: Row[], cols = COLS) {
  return [cols.join(','), ...rows.map((r) => cols.map((c) => cell((r as any)[c] ?? '')).join(','))].join('\r\n') + '\r\n';
}
const inRow = (first: string, extra: Row = {}): Row => ({
  first_name: first, last_name: 'Test', email: `${first.toLowerCase()}.imp@acme.example`, join_date: '2026-09-01', dob: '1994-05-05',
  department: 'Platform', position: 'Software Engineer', tax_id: 'ABCPK1234F', bank_ifsc: 'HDFC0001234', pf_number: '100123456789', ...extra,
});

const base = (slug?: string) => (slug ? `/api/c/${slug}/imports/employees` : '/api/imports/employees');
async function validate(token: string, body: string, opts: { slug?: string; create_missing?: boolean; filename?: string } = {}) {
  const req = request(app).post(`${base(opts.slug)}/validate`).set(auth(token)).attach('file', Buffer.from(body), opts.filename || 'people.csv');
  if (opts.create_missing) req.field('create_missing', '1');
  return req;
}
const errorsOf = (res: any, n: number) => res.body.rows.find((r: any) => r.row === n).errors.map((e: any) => `${e.field}: ${e.message}`).join(' | ');

describe('bulk employee import', () => {
  it('helpers: CSV parser, IBAN mod-97, ABA checksum', () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n"multi\nline",z\r\n\r\n')).toEqual([['a', 'b'], ['x, y', 'say "hi"'], ['multi\nline', 'z']]);
    expect(ibanValid('GB82WEST12345698765432')).toBe(true);
    expect(ibanValid('GB82WEST12345698765433')).toBe(false);
    expect(abaValid('021000021')).toBe(true);
    expect(abaValid('021000022')).toBe(false);
  });

  it('templates differ per country and their example rows validate cleanly', async () => {
    const h = await hr();
    const ag = await agencyLogin();
    const tIn = await request(app).get(`${base()}/template.csv`).set(auth(h));
    expect(tIn.status).toBe(200);
    expect(tIn.headers['content-type']).toMatch(/text\/csv/);
    const gIn = parseCsv(tIn.text);
    expect(gIn).toHaveLength(3); // header + 2 examples
    expect(gIn[0]).toContain('pf_number');
    expect(gIn[0]).toContain('basic_monthly');
    const col = (g: string[][], k: string) => g[0].indexOf(k);
    expect(gIn[1][col(gIn, 'tax_id')]).toMatch(/^[A-Z]{5}\d{4}[A-Z]$/);
    expect(gIn[1][col(gIn, 'bank_ifsc')]).toMatch(/^[A-Z]{4}0[A-Z0-9]{6}$/);
    expect(gIn[2][col(gIn, 'manager')]).toBe(gIn[1][col(gIn, 'email')]);

    const tAe = await request(app).get(`${base('falcon-logistics')}/template.csv`).set(auth(ag));
    const gAe = parseCsv(tAe.text);
    const ibanAe = gAe[1][col(gAe, 'bank_account_number')];
    expect(ibanAe.startsWith('AE')).toBe(true);
    expect(ibanValid(ibanAe)).toBe(true);
    expect(gAe[1][col(gAe, 'tax_id')]).toMatch(/^784-\d{4}-\d{7}-\d$/);

    const tUs = await request(app).get(`${base('redwood-health')}/template.csv`).set(auth(ag));
    const gUs = parseCsv(tUs.text);
    expect(gUs[1][col(gUs, 'tax_id')]).toBe('***-**-1234');
    expect(abaValid(gUs[1][col(gUs, 'bank_ifsc')])).toBe(true);
    expect(tIn.text).not.toEqual(tAe.text);

    const info = await request(app).get(`${base('falcon-logistics')}/template-info`).set(auth(ag));
    expect(info.body.country_code).toBe('AE');
    expect(info.body.columns.find((c: any) => c.key === 'email').required).toBe(true);
    expect(info.body.formats.map((f: any) => f.label)).toContain('IBAN');
    expect((await request(app).get(`${base()}/template-info`).set(auth(h))).body.formats.map((f: any) => f.label)).toContain('PAN');

    // Uploading the untouched templates validates with no errors.
    for (const [slug, text, tok] of [[undefined, tIn.text, h], ['falcon-logistics', tAe.text, ag], ['redwood-health', tUs.text, ag]] as const) {
      const v = await validate(tok, text, { slug, create_missing: true });
      expect(v.status).toBe(200);
      expect(v.body.summary.with_errors, JSON.stringify(v.body.rows.map((r: any) => r.errors))).toBe(0);
    }
  });

  it('only HR can use the import', async () => {
    const e = await employee();
    expect((await request(app).get(`${base()}/template.csv`).set(auth(e))).status).toBe(403);
    expect((await validate(e, csv([inRow('Nope')]))).status).toBe(403);
  });

  it('reads XLSX uploads (shared strings, inline strings, date serials)', async () => {
    const h = await hr();
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
    zip.file('xl/workbook.xml', '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="People" sheetId="1" r:id="rId1"/></sheets></workbook>');
    zip.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>');
    zip.file('xl/sharedStrings.xml', '<sst><si><t>First Name</t></si><si><t>Email</t></si><si><t>Join Date</t></si><si><t>Xl</t></si></sst>');
    zip.file('xl/worksheets/sheet1.xml', '<worksheet><sheetData>'
      + '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>'
      + '<row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2" t="inlineStr"><is><t>xl.sheet@acme.example</t></is></c><c r="C2"><v>46266</v></c></row>'
      + '</sheetData></worksheet>');
    const buf = await zip.generateAsync({ type: 'nodebuffer' });
    const v = await request(app).post(`${base()}/validate`).set(auth(h)).attach('file', buf, 'people.xlsx');
    expect(v.status).toBe(200);
    expect(v.body.rows[0].data).toMatchObject({ first_name: 'Xl', email: 'xl.sheet@acme.example', join_date: '2026-09-01' });
    expect(v.body.rows[0].errors).toEqual([]);
  });

  it('validation catches every error class without writing anything (India)', async () => {
    const h = await hr();
    const before = (await request(app).get('/api/employees').set(auth(h))).body.total;
    const text = csv([
      inRow('Good', { manager: 'EMP0004', basic_monthly: '45,000' }),          // row 2
      inRow('Badpan', { tax_id: 'ABC1234' }),                                   // 3
      inRow('Dup', { email: 'dup.imp@acme.example' }),                          // 4
      inRow('Dup2', { email: 'DUP.imp@acme.example' }),                         // 5
      inRow('Existing', { email: 'priya.nair@acme.example' }),                  // 6
      inRow('Nomgr', { manager: 'nobody@acme.example' }),                       // 7
      inRow('CycA', { employee_code: 'IMP-A', manager: 'IMP-B' }),              // 8
      inRow('CycB', { employee_code: 'IMP-B', manager: 'IMP-A' }),              // 9
      inRow('Baddate', { join_date: '2026-02-30' }),                            // 10
      inRow('Badifsc', { bank_ifsc: 'HDFC1234567', pf_number: '12345' }),       // 11
      inRow('Code', { employee_code: 'EMP0001' }),                              // 12
      inRow('Nodept', { department: 'Space Program', position: 'Astronaut' }),  // 13
      inRow('Self', { manager: 'self.imp@acme.example', email: 'self.imp@acme.example' }), // 14
      inRow('Neg', { basic_monthly: '-5' }),                                    // 15
      { first_name: '', email: 'not-an-email', join_date: '' },                 // 16
    ]);
    const v = await validate(h, text);
    expect(v.status).toBe(200);
    expect(v.body.token).toMatch(/^[0-9a-f]{32}$/);
    expect(errorsOf(v, 2)).toBe('');
    expect(v.body.rows[0].data.basic_monthly).toBe('45000');
    expect(errorsOf(v, 3)).toMatch(/tax_id: PAN "ABC1234" is invalid/);
    expect(errorsOf(v, 4)).toMatch(/Duplicate email in this file \(rows 4, 5\)/);
    expect(errorsOf(v, 5)).toMatch(/Duplicate email/);
    expect(errorsOf(v, 6)).toMatch(/employee with this email already exists/);
    expect(errorsOf(v, 7)).toMatch(/manager: Manager "nobody@acme.example" was not found/);
    expect(errorsOf(v, 8)).toMatch(/cycle/);
    expect(errorsOf(v, 9)).toMatch(/cycle/);
    expect(errorsOf(v, 10)).toMatch(/join_date: "2026-02-30" is not a valid date/);
    expect(errorsOf(v, 11)).toMatch(/IFSC/);
    expect(errorsOf(v, 11)).toMatch(/UAN must be 12 digits/);
    expect(errorsOf(v, 12)).toMatch(/EMP0001 is already in use/);
    expect(errorsOf(v, 13)).toMatch(/Department "Space Program" does not exist/);
    expect(errorsOf(v, 14)).toMatch(/own manager/);
    expect(errorsOf(v, 15)).toMatch(/positive number/);
    expect(errorsOf(v, 16)).toMatch(/First name is required/);
    expect(errorsOf(v, 16)).toMatch(/not a valid email/);
    expect(errorsOf(v, 16)).toMatch(/Join date is required/);
    expect(v.body.summary).toMatchObject({ total: 15, valid: 1, with_errors: 14 });

    // With create_missing the missing department/position become warnings.
    const v2 = await validate(h, text, { create_missing: true });
    const r13 = v2.body.rows.find((r: any) => r.row === 13);
    expect(r13.errors).toEqual([]);
    expect(r13.warnings.map((w: any) => w.message).join()).toMatch(/will be created/);
    expect(v2.body.summary.will_create.departments).toEqual(['Space Program']);
    expect(v2.body.summary.will_create.positions).toEqual([{ title: 'Astronaut', department: 'Space Program' }]);

    expect((await request(app).get('/api/employees').set(auth(h))).body.total).toBe(before);
  });

  it('headers are case/space-insensitive, unknown columns are warned, BOM and quotes are handled', async () => {
    const h = await hr();
    const text = '﻿First Name,Last Name,E-mail,Join Date,Favourite Colour,City\r\n"Quote","O""Brien, Jr",quote.imp@acme.example,2026-09-01,blue,"Kochi, Kerala"\r\n';
    const v = await validate(h, text);
    expect(v.status).toBe(200);
    expect(v.body.unknown_columns).toEqual(['Favourite Colour']);
    expect(v.body.file_warnings[0]).toMatch(/Unknown columns ignored: Favourite Colour/);
    expect(v.body.rows[0].errors).toEqual([]);
    expect(v.body.rows[0].data).toMatchObject({ first_name: 'Quote', last_name: 'O"Brien, Jr', email: 'quote.imp@acme.example', city: 'Kochi, Kerala' });
  });

  it('GCC: IBAN checksum and country, Emirates ID; US: full SSN rejected, ABA checksum', async () => {
    const ag = await agencyLogin();
    const tpl = parseCsv((await request(app).get(`${base('falcon-logistics')}/template.csv`).set(auth(ag))).text);
    const good = tpl[1][tpl[0].indexOf('bank_account_number')];
    const broken = good.slice(0, -1) + ((Number(good.slice(-1)) + 1) % 10);
    const ae = csv([
      { first_name: 'Ok', email: 'ok.imp@falcon-logistics.example', join_date: '2026-09-01', bank_account_number: good, tax_id: '784-1990-1234567-1', nationality: 'Indian' },
      { first_name: 'Sum', email: 'sum.imp@falcon-logistics.example', join_date: '2026-09-01', bank_account_number: broken, nationality: 'Indian' },
      { first_name: 'Sa', email: 'sa.imp@falcon-logistics.example', join_date: '2026-09-01', bank_account_number: 'SA0380000000608010167519', nationality: 'Indian' },
      { first_name: 'Eid', email: 'eid.imp@falcon-logistics.example', join_date: '2026-09-01', tax_id: '784199012345671' },
    ]);
    const v = await validate(ag, ae, { slug: 'falcon-logistics' });
    expect(errorsOf(v, 2)).toBe('');
    expect(errorsOf(v, 3)).toMatch(/checksum is invalid/);
    expect(errorsOf(v, 4)).toMatch(/IBAN must start with AE/);
    expect(errorsOf(v, 5)).toMatch(/Emirates ID must look like 784-YYYY-NNNNNNN-N/);
    expect(v.body.rows[3].warnings.map((w: any) => w.field)).toContain('nationality');

    const us = csv([
      { first_name: 'Ssn', email: 'ssn.imp@redwood-health.example', join_date: '2026-09-01', tax_id: '123-45-6789' },
      { first_name: 'Masked', email: 'masked.imp@redwood-health.example', join_date: '2026-09-01', tax_id: '***-**-6789', bank_ifsc: '021000021' },
      { first_name: 'Aba', email: 'aba.imp@redwood-health.example', join_date: '2026-09-01', bank_ifsc: '123456789' },
    ]);
    const u = await validate(ag, us, { slug: 'redwood-health' });
    expect(errorsOf(u, 2)).toMatch(/Full SSNs are not accepted/);
    expect(errorsOf(u, 3)).toBe('');
    expect(errorsOf(u, 4)).toMatch(/Routing number "123456789" is invalid/);
  });

  it('commit: all-or-nothing by default, skip_invalid imports the rest with managers, logins, leave, journey and salary', async () => {
    const h = await hr();
    const before = (await request(app).get('/api/employees').set(auth(h))).body.total;
    const text = csv([
      inRow('Report', { manager: 'lead.imp@acme.example', basic_monthly: '40000', create_login: 'yes' }), // manager is a later row
      inRow('Lead', { department: 'Data Science', position: 'Data Lead', manager: 'EMP0002', basic_monthly: '90000' }),
      inRow('Nologin', { create_login: 'no' }),
      inRow('Broken', { tax_id: 'BADPAN' }),
    ]);
    const v = await validate(h, text, { create_missing: true });
    expect(v.body.summary).toMatchObject({ total: 4, valid: 3, with_errors: 1 });

    const strict = await request(app).post(`${base()}/commit`).set(auth(h)).send({ token: v.body.token, skip_invalid: false, create_missing: true, send_logins: true });
    expect(strict.status).toBe(400);
    expect(strict.body.error).toMatch(/1 row\(s\) have errors/);
    expect((await request(app).get('/api/employees').set(auth(h))).body.total).toBe(before);

    const ok = await request(app).post(`${base()}/commit`).set(auth(h)).send({ token: v.body.token, skip_invalid: true, create_missing: true, send_logins: true });
    expect(ok.status).toBe(201);
    expect(ok.body.created.map((c: any) => c.row)).toEqual([2, 3, 4]);
    expect(ok.body.skipped).toEqual([expect.objectContaining({ row: 5, email: 'broken.imp@acme.example' })]);
    expect(ok.body.departments_created).toEqual(['Data Science']);
    for (const c of ok.body.created) expect(c.employee_code).toMatch(/^EMP\d{4}$/);
    expect(new Set(ok.body.created.map((c: any) => c.employee_code)).size).toBe(3);
    const [rep, lead, nologin] = ok.body.created;
    expect(rep.temporary_password).toMatch(/^Welcome-/);
    expect(lead.temporary_password).toBeTruthy();
    expect(nologin.temporary_password).toBeUndefined();
    expect((await request(app).get('/api/employees').set(auth(h))).body.total).toBe(before + 3);

    const repEmp = (await request(app).get(`/api/employees/${rep.id}`).set(auth(h))).body;
    expect(repEmp.manager_id).toBe(lead.id);
    expect(repEmp.tax_id).toBe('ABCPK1234F');
    expect(repEmp.pf_number).toBe('100123456789');
    expect(repEmp.custom_fields.uan).toBe('100123456789');
    expect(repEmp.user).toMatchObject({ email: 'report.imp@acme.example', role: 'employee' });
    const leadEmp = (await request(app).get(`/api/employees/${lead.id}`).set(auth(h))).body;
    expect(leadEmp.department_name).toBe('Data Science');
    expect(leadEmp.position_title).toBe('Data Lead');
    expect(leadEmp.manager_code ?? leadEmp.manager_name).toBeTruthy();
    expect(leadEmp.user.role).toBe('manager');

    const bal = await request(app).get(`/api/leave/balances/${rep.id}`).set(auth(h));
    expect(bal.status).toBe(200);
    expect((Array.isArray(bal.body) ? bal.body : bal.body.items || bal.body.balances).length).toBeGreaterThan(0);
    const journey = await request(app).get(`/api/journey/employee/${rep.id}`).set(auth(h));
    expect(journey.status).toBe(200);
    expect(JSON.stringify(journey.body)).toMatch(/pending/);
    const sal = await request(app).get(`/api/payroll/structures/${rep.id}`).set(auth(h));
    expect(sal.status).toBe(200);
    const s = sal.body.current || sal.body.history?.[0] || sal.body;
    expect(s).toMatchObject({ basic: 40000, currency: 'INR', effective_from: '2026-09-01' });

    // The temporary password signs in and must be changed.
    const login = await request(app).post('/api/auth/login').send({ email: 'report.imp@acme.example', password: rep.temporary_password });
    expect(login.status).toBe(200);
    expect(JSON.stringify(login.body)).toMatch(/must_change_password"?:\s*(true|1)/);

    // Re-validating the same rows now finds the duplicates against the database.
    const again = await request(app).post(`${base()}/validate`).set(auth(h)).send({ rows: v.body.rows.map((r: any) => r.data) });
    expect(errorsOf(again, 2)).toMatch(/already exists/);

    const audit = await request(app).get('/api/settings/audit/log').set(auth(h));
    expect(audit.status).toBe(200);
    expect(JSON.stringify(audit.body)).toMatch(/import/);
  });

  it('commit accepts the rows themselves when the token is unknown (another serverless instance)', async () => {
    const h = await hr();
    const res = await request(app).post(`${base()}/commit`).set(auth(h)).send({ token: 'feedfacefeedfacefeedfacefeedface', rows: [inRow('Stateless', { employee_code: 'IMP-900' })], skip_invalid: false, send_logins: false });
    expect(res.status).toBe(201);
    expect(res.body.created[0]).toMatchObject({ employee_code: 'IMP-900', email: 'stateless.imp@acme.example' });
    expect(res.body.created[0].temporary_password).toBeUndefined();
    const expired = await request(app).post(`${base()}/commit`).set(auth(h)).send({ token: 'feedfacefeedfacefeedfacefeedface' });
    expect(expired.status).toBe(400);
    expect(expired.body.error).toMatch(/expired/);
  });

  it('works for agency staff per company and stays isolated (AED salary, token bound to company)', async () => {
    const ag = await agencyLogin();
    const tpl = parseCsv((await request(app).get(`${base('falcon-logistics')}/template.csv`).set(auth(ag))).text);
    const iban = tpl[1][tpl[0].indexOf('bank_account_number')];
    const text = csv([{ first_name: 'Gulf', last_name: 'Hire', email: 'gulf.hire@falcon-logistics.example', join_date: '2026-09-01', bank_account_number: iban, bank_ifsc: 'EBILAEAD', tax_id: '784-1991-7654321-2', nationality: 'Indian', basic_monthly: '12000' }]);
    const v = await validate(ag, text, { slug: 'falcon-logistics' });
    expect(v.body.summary.valid).toBe(1);

    // The token is bound to the company that validated it.
    const cross = await request(app).post(`${base('acme')}/commit`).set(auth(ag)).send({ token: v.body.token, skip_invalid: false });
    expect(cross.status).toBe(400);
    expect(cross.body.error).toMatch(/expired/);

    const ok = await request(app).post(`${base('falcon-logistics')}/commit`).set(auth(ag)).send({ token: v.body.token, skip_invalid: false, send_logins: true });
    expect(ok.status).toBe(201);
    const c = ok.body.created[0];
    expect(c.temporary_password).toBeTruthy();
    const sal = await request(app).get(`/api/c/falcon-logistics/payroll/structures/${c.id}`).set(auth(ag));
    const s = sal.body.current || sal.body.history?.[0] || sal.body;
    expect(s).toMatchObject({ basic: 12000, currency: 'AED' });

    const inFalcon = await request(app).get('/api/c/falcon-logistics/employees?q=gulf.hire').set(auth(ag));
    expect(inFalcon.body.total).toBe(1);
    const inAcme = await request(app).get('/api/c/acme/employees?q=gulf.hire').set(auth(ag));
    expect(inAcme.body.total).toBe(0);

    // The new login finds its company through the login directory.
    const login = await request(app).post('/api/auth/login').send({ email: 'gulf.hire@falcon-logistics.example', password: c.temporary_password });
    expect(login.status).toBe(200);
    expect(JSON.stringify(login.body)).toMatch(/falcon-logistics/);
  });
});
