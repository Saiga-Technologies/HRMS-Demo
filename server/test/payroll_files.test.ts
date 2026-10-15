import { describe, it, expect, afterAll } from 'vitest';
import JSZip from 'jszip';
import { app, request, auth, cleanup, PASSWORD } from './helpers.js';

const { all, run: sqlRun } = await import('../src/db.js');
const { runAsTenant } = await import('../src/context.js');
const { demoCompany } = await import('../src/seed/registry.js');
const { nachaEntryHash, isAbaRouting, buildXlsx } = await import('../src/ops/payrollFiles.js');

afterAll(cleanup);

const tokens = new Map<string, string>();
async function hrOf(slug: string) {
  if (!tokens.has(slug)) {
    const res = await request(app).post('/api/auth/login').send({ email: `hr@${slug}.example`, password: PASSWORD });
    expect(res.status, `login hr@${slug}`).toBe(200);
    tokens.set(slug, res.body.token);
  }
  return tokens.get(slug)!;
}
const asTenant = <T>(slug: string, fn: () => T) => runAsTenant({ slug, timezone: demoCompany(slug)!.timezone }, fn);

async function runs(slug: string) {
  const res = await request(app).get('/api/payroll/runs').set(auth(await hrOf(slug)));
  expect(res.status).toBe(200);
  return res.body as any[];
}
const latestPaid = async (slug: string) => (await runs(slug)).find((r) => r.status === 'paid')!;
async function runDetail(slug: string, id: number) {
  return (await request(app).get(`/api/payroll/runs/${id}`).set(auth(await hrOf(slug)))).body;
}
/** Binary-safe download. */
async function download(slug: string, path: string) {
  return request(app).get(`/api/payroll-files${path}`).set(auth(await hrOf(slug)))
    .buffer(true).parse((res, cb) => { const chunks: Buffer[] = []; res.on('data', (c: Buffer) => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks))); });
}
const filenameOf = (res: any) => /filename="([^"]+)"/.exec(res.headers['content-disposition'] || '')?.[1] || '';
const minor = (n: number) => Math.round(n * 100);
const parseMoney = (s: string) => { const [a, b = '0'] = s.split('.'); return Number(a) * 100 + Number(b.padEnd(2, '0')); };

/** Minimal XML well-formedness check: one root, properly nested / closed tags, quoted attributes, no stray '<' or '&'. */
function assertWellFormed(xml: string, name: string) {
  let s = xml.replace(/^<\?xml[^?]*\?>\s*/, '');
  const stack: string[] = [];
  let roots = 0;
  const tagRe = /<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*"[^"<]*")*)\s*(\/?)>/y;
  let i = 0;
  while (i < s.length) {
    const lt = s.indexOf('<', i);
    const text = s.slice(i, lt === -1 ? s.length : lt);
    expect(/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(text), `${name}: bare & in text`).toBe(false);
    if (lt === -1) { expect(text.trim(), `${name}: text after root`).toBe(''); break; }
    tagRe.lastIndex = lt;
    const m = tagRe.exec(s);
    expect(m, `${name}: malformed tag at ${lt}: ${s.slice(lt, lt + 60)}`).toBeTruthy();
    const [whole, close, tag, , selfClose] = m!;
    if (close) {
      expect(stack.pop(), `${name}: mismatched </${tag}>`).toBe(tag);
    } else {
      if (!stack.length) roots += 1;
      if (!selfClose) stack.push(tag);
    }
    i = lt + whole.length;
  }
  expect(stack, `${name}: unclosed tags`).toEqual([]);
  expect(roots, `${name}: exactly one root`).toBe(1);
}
async function unzipXlsx(buf: Buffer) {
  const zip = await JSZip.loadAsync(buf);
  const files: Record<string, string> = {};
  for (const name of Object.keys(zip.files)) if (!zip.files[name].dir) files[name] = await zip.files[name].async('string');
  for (const required of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml']) expect(files[required], required).toBeTruthy();
  for (const [name, xml] of Object.entries(files)) assertWellFormed(xml, name);
  return files;
}
/** Rows of a worksheet as arrays of cell texts / numbers. */
function sheetRows(xml: string): (string | number)[][] {
  const rows: (string | number)[][] = [];
  for (const rm of xml.matchAll(/<row r="(\d+)">(.*?)<\/row>/g)) {
    const cells: (string | number)[] = [];
    for (const cm of rm[2].matchAll(/<c r="([A-Z]+)\d+"[^>]*?(?:\/>|>(.*?)<\/c>)/g)) {
      const col = cm[1].split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
      const inner = cm[2] || '';
      const t = /<t[^>]*>(.*?)<\/t>/.exec(inner);
      const v = /<v>(.*?)<\/v>/.exec(inner);
      cells[col] = t ? t[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"') : v ? Number(v[1]) : '';
    }
    rows.push(cells);
  }
  return rows;
}

describe('payroll output files — India (tejas-infotech, Kerala)', () => {
  const slug = 'tejas-infotech';

  it('lists the Indian outputs for a paid run, and refuses a draft run', async () => {
    const paid = await latestPaid(slug);
    const res = await request(app).get(`/api/payroll-files/runs/${paid.id}`).set(auth(await hrOf(slug)));
    expect(res.status).toBe(200);
    expect(res.body.country).toBe('IN');
    expect(res.body.files.map((f: any) => f.kind)).toEqual(['register', 'bank_transfer', 'pf_ecr', 'esi']);
    for (const f of res.body.files) { expect(f.available).toBe(true); expect(f.portal).toBeTruthy(); expect(f.format).toBeTruthy(); }

    const draft = (await runs(slug)).find((r) => r.status === 'draft');
    expect(draft).toBeTruthy();
    const list = await request(app).get(`/api/payroll-files/runs/${draft.id}`).set(auth(await hrOf(slug)));
    expect(list.status).toBe(400);
    const dl = await download(slug, `/runs/${draft.id}/register`);
    expect(dl.status).toBe(400);
  });

  it('register: a valid workbook with one row per payslip, a totals row and component totals', async () => {
    const paid = await latestPaid(slug);
    const detail = await runDetail(slug, paid.id);
    const res = await download(slug, `/runs/${paid.id}/register`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect(filenameOf(res)).toBe(`TEJAS-INFOTECH_Payroll_Register_${paid.period}.xlsx`);
    const files = await unzipXlsx(res.body);
    expect(files['xl/worksheets/sheet1.xml']).toContain('state="frozen"');
    expect(files['xl/styles.xml']).toContain('#,##0.00');
    const rows = sheetRows(files['xl/worksheets/sheet1.xml']);
    const header = rows[0] as string[];
    expect(rows.length).toBe(detail.payslips.length + 2); // header + payslips + totals
    expect(header.slice(0, 6)).toEqual(['Code', 'Name', 'Department', 'Designation', 'Paid days', 'LOP days']);
    for (const c of ['Basic (BASIC)', 'House Rent Allowance (HRA)', 'Gross', 'Provident Fund (Employee) (PF)', 'Total deductions', 'Net pay', 'IFSC']) expect(header).toContain(c);
    const netCol = header.indexOf('Net pay');
    const totals = rows[rows.length - 1];
    expect(totals[0]).toBe('TOTAL');
    const sumNet = detail.payslips.reduce((s: number, p: any) => s + minor(p.net), 0);
    expect(minor(totals[netCol] as number)).toBe(sumNet);
    const sumLines = rows.slice(1, -1).reduce((s, r) => s + minor(r[netCol] as number), 0);
    expect(sumLines).toBe(sumNet);
    // Second sheet: component totals.
    const comp = sheetRows(files['xl/worksheets/sheet2.xml']);
    expect(comp[0]).toEqual(['Type', 'Code', 'Component', 'Employees', 'Amount']);
    expect(comp.find((r) => r[1] === 'NET')?.[4]).toBeCloseTo(sumNet / 100, 2);
    expect(files['xl/workbook.xml']).toContain('Component totals');
  });

  it('PF ECR: #~# lines with UAN, capped EPF / EPS wages and contributions', async () => {
    const paid = await latestPaid(slug);
    const detail = await runDetail(slug, paid.id);
    const res = await download(slug, `/runs/${paid.id}/pf_ecr`);
    expect(res.status).toBe(200);
    expect(filenameOf(res)).toBe(`TEJAS-INFOTECH_PF_ECR_${paid.period}.txt`);
    const lines = res.body.toString('utf8').trim().split('\n');
    expect(lines.length).toBe(detail.payslips.length);
    for (const l of lines) {
      const f = l.split('#~#');
      expect(f.length).toBe(11);
      const [uan, name, gross, epfW, epsW, edliW, epf, eps, diff, ncp, refund] = f;
      expect(uan).toMatch(/^\d{12}$/);
      expect(name.length).toBeGreaterThan(2);
      for (const n of [gross, epfW, epsW, edliW, epf, eps, diff, ncp, refund]) expect(n).toMatch(/^\d+$/);
      expect(Number(epfW)).toBeLessThanOrEqual(15000);        // PF wage ceiling (settings)
      expect(Number(epsW)).toBeLessThanOrEqual(15000);        // EPS ceiling
      expect(Number(edliW)).toBe(Number(epsW));
      expect(Number(eps)).toBe(Math.round(Number(epsW) * 0.0833));
      expect(Number(epf)).toBe(Math.round(Number(epfW) * 0.12));
      expect(Number(diff)).toBe(Number(epf) - Number(eps));
      expect(refund).toBe('0');
    }
    // Someone on a full month above the ceiling remits the capped figures: 1800 EE, 1250 EPS, 550 difference.
    expect(lines.some((l: string) => /#~#15000#~#15000#~#15000#~#1800#~#1250#~#550#~#0#~#0$/.test(l))).toBe(true);
  });

  it('bank transfer CSV: NEFT / RTGS by amount, total equals the payslips', async () => {
    const paid = await latestPaid(slug);
    const detail = await runDetail(slug, paid.id);
    const res = await download(slug, `/runs/${paid.id}/bank_transfer`);
    expect(res.status).toBe(200);
    const [head, ...rows] = res.body.toString('utf8').trim().split('\r\n');
    expect(head).toBe('Payment Type,Beneficiary Name,Beneficiary Account Number,IFSC,Amount,Narration,Employee Code,Beneficiary Bank');
    expect(rows.length).toBe(detail.payslips.length);
    let total = 0;
    for (const r of rows) {
      const c = r.split(',');
      expect(c[0]).toMatch(/^(NEFT|RTGS)$/);
      expect(c[3]).toMatch(/^[A-Z]{4}0[A-Z0-9]{6}$/);
      expect(c[4]).toMatch(/^\d+\.\d{2}$/);
      expect(c[0]).toBe(parseMoney(c[4]) >= 20000000 ? 'RTGS' : 'NEFT');
      expect(c[5]).toMatch(/^Salary [A-Z][a-z]{2} \d{4}$/);
      total += parseMoney(c[4]);
    }
    expect(total).toBe(detail.payslips.reduce((s: number, p: any) => s + minor(p.net), 0));
  });

  it('ESI: only employees within the ESI wage ceiling, with IP number, days and wages', async () => {
    const paid = await latestPaid(slug);
    const t = await hrOf(slug);
    const detail = await runDetail(slug, paid.id);
    // Demo salaries are all above ₹21,000, so the file is empty with a note; raise the ceiling to cover some people.
    const before = (await request(app).get(`/api/payroll-files/runs/${paid.id}`).set(auth(t))).body.files.find((f: any) => f.kind === 'esi');
    expect(before.records).toBe(0);
    expect(before.notes[0]).toMatch(/above the ESI wage ceiling/);
    const ceiling = 100000;
    expect((await request(app).put('/api/settings/payroll').set(auth(t)).send({ esi_wage_ceiling: ceiling })).status).toBe(200);
    try {
      const expected = detail.payslips.filter((p: any) => p.gross <= ceiling);
      expect(expected.length).toBeGreaterThan(0);
      const res = await download(slug, `/runs/${paid.id}/esi`);
      expect(res.status).toBe(200);
      expect(filenameOf(res)).toBe(`TEJAS-INFOTECH_ESI_Contribution_${paid.period}.xlsx`);
      const files = await unzipXlsx(res.body);
      const rows = sheetRows(files['xl/worksheets/sheet1.xml']);
      expect(rows[0].slice(0, 2)).toEqual(['IP Number', 'IP Name']);
      expect(rows.length - 1).toBe(expected.length);
      for (const r of rows.slice(1)) {
        expect(String(r[0])).toMatch(/^\d{10}$/);
        expect(Number(r[2])).toBeGreaterThan(0);
        expect(Number(r[3])).toBeLessThanOrEqual(ceiling);
        expect(r[4]).toBe(0);
      }
    } finally {
      await request(app).put('/api/settings/payroll').set(auth(t)).send({ esi_wage_ceiling: 21000 });
    }
  });

  it('employees missing a bank account or UAN are reported by name and left out', async () => {
    const paid = await latestPaid(slug);
    const detail = await runDetail(slug, paid.id);
    const [a, b] = detail.payslips;
    asTenant(slug, () => {
      sqlRun("UPDATE employees SET bank_account_number = NULL WHERE id = ?", [a.employee_id]);
      sqlRun("UPDATE employees SET pf_number = NULL, custom_fields = json_remove(custom_fields, '$.uan') WHERE id = ?", [b.employee_id]);
    });
    const list = await request(app).get(`/api/payroll-files/runs/${paid.id}`).set(auth(await hrOf(slug)));
    const bank = list.body.files.find((f: any) => f.kind === 'bank_transfer');
    const ecr = list.body.files.find((f: any) => f.kind === 'pf_ecr');
    expect(bank.excluded.map((e: any) => e.employee_id)).toEqual([a.employee_id]);
    expect(bank.warnings[0]).toContain(a.employee_name);
    expect(bank.records).toBe(detail.payslips.length - 1);
    expect(ecr.excluded).toEqual([expect.objectContaining({ employee_id: b.employee_id, reason: 'no UAN on file' })]);
    expect(ecr.warnings[0]).toMatch(/1 employee left out: no UAN on file/);

    const csv = (await download(slug, `/runs/${paid.id}/bank_transfer`)).body.toString('utf8');
    expect(csv).not.toContain(a.employee_code);
    const txt = (await download(slug, `/runs/${paid.id}/pf_ecr`)).body.toString('utf8');
    expect(txt.trim().split('\n').length).toBe(detail.payslips.length - 1);
  });

  it('writes an audit entry for each download', () => {
    const rows = asTenant(slug, () => all<any>("SELECT * FROM audit_log WHERE action = 'download' AND entity = 'payroll_file'"));
    expect(rows.length).toBeGreaterThanOrEqual(4);
    expect(JSON.parse(rows[0].details).kind).toBeTruthy();
  });
});

describe('payroll output files — UAE WPS SIF (falcon-logistics)', () => {
  const slug = 'falcon-logistics';
  it('EDR count and total match the SCR control record', async () => {
    const paid = await latestPaid(slug);
    const detail = await runDetail(slug, paid.id);
    const list = await request(app).get(`/api/payroll-files/runs/${paid.id}`).set(auth(await hrOf(slug)));
    expect(list.body.files.map((f: any) => f.kind)).toEqual(['register', 'wps_sif']);
    const res = await download(slug, `/runs/${paid.id}/wps_sif`);
    expect(res.status).toBe(200);
    expect(filenameOf(res)).toMatch(/^\d{13}\d{12}\.SIF$/);
    const lines = res.body.toString('utf8').split('\r\n');
    const edr = lines.filter((l: string) => l.startsWith('EDR,'));
    const scr = lines[lines.length - 1].split(',');
    expect(scr[0]).toBe('SCR');
    expect(edr.length).toBe(detail.payslips.length);
    expect(Number(scr[6])).toBe(edr.length);
    expect(scr[1]).toMatch(/^\d{13}$/);
    expect(scr[3]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(scr[4]).toMatch(/^\d{4}$/);
    expect(scr[5]).toBe(`${paid.period.slice(5)}${paid.period.slice(0, 4)}`);
    expect(scr[8]).toBe('AED');
    let total = 0;
    for (const l of edr) {
      const f = l.split(',');
      expect(f.length).toBe(10);
      expect(f[1]).toMatch(/^\d{14}$/);
      expect(f[2]).toMatch(/^\d{9}$/);
      expect(f[3]).toMatch(/^AE\d{21}$/);
      expect(f[4]).toBe(`${paid.period}-01`);
      total += parseMoney(f[7]) + parseMoney(f[8]);
    }
    expect(fmt(total)).toBe(scr[7]);
    expect(total).toBe(detail.payslips.reduce((s: number, p: any) => s + minor(p.net), 0));
  });

  it('file settings: validated, and used in the SCR record', async () => {
    const t = await hrOf(slug);
    const view = await request(app).get('/api/payroll-files/settings').set(auth(t));
    expect(view.body.country).toBe('AE');
    expect(view.body.fields.find((f: any) => f.key === 'ae_employer_mol_id').placeholder).toBe(true);
    expect((await request(app).put('/api/payroll-files/settings').set(auth(t)).send({ ae_employer_mol_id: '12' })).status).toBe(400);
    expect((await request(app).put('/api/payroll-files/settings').set(auth(t)).send({ nope: 'x' })).status).toBe(400);
    const ok = await request(app).put('/api/payroll-files/settings').set(auth(t)).send({ ae_employer_mol_id: '1234567890123' });
    expect(ok.status).toBe(200);
    expect(ok.body.fields.find((f: any) => f.key === 'ae_employer_mol_id')).toMatchObject({ value: '1234567890123', placeholder: false });
    const paid = await latestPaid(slug);
    const res = await download(slug, `/runs/${paid.id}/wps_sif`);
    expect(filenameOf(res).startsWith('1234567890123')).toBe(true);
    expect(res.body.toString('utf8').split('\r\n').pop()).toMatch(/^SCR,1234567890123,/);
  });
});
const fmt = (m: number) => `${Math.floor(m / 100)}.${String(m % 100).padStart(2, '0')}`;

describe('payroll output files — KSA Mudad (najd-construction, approved run)', () => {
  const slug = 'najd-construction';
  it('Mudad CSV reconciles basic + housing + other − deductions = net', async () => {
    const current = (await runs(slug)).find((r) => r.status === 'approved');
    expect(current).toBeTruthy();
    const detail = await runDetail(slug, current.id);
    const res = await download(slug, `/runs/${current.id}/mudad_wps`);
    expect(res.status).toBe(200);
    expect(filenameOf(res)).toBe(`NAJD-CONSTRUCTION_Mudad_WPS_${current.period}.csv`);
    const [head, ...rows] = res.body.toString('utf8').trim().split('\r\n');
    expect(head.split(',')).toEqual(['Employee Name', 'National ID / Iqama', 'Bank Code', 'IBAN', 'Basic Salary', 'Housing Allowance', 'Other Earnings', 'Deductions', 'Net Salary', 'Payment Date']);
    expect(rows.length).toBe(detail.payslips.length);
    let total = 0;
    for (const r of rows) {
      const c = r.split(',');
      expect(c[1]).toMatch(/^[12]\d{9}$/);
      expect(c[2]).toMatch(/^[A-Z]{4}$/);
      expect(c[3]).toMatch(/^SA\d{22}$/);
      expect(parseMoney(c[4]) + parseMoney(c[5]) + parseMoney(c[6]) - parseMoney(c[7])).toBe(parseMoney(c[8]));
      expect(c[9]).toMatch(new RegExp(`^${current.period}-\\d{2}$`));
      total += parseMoney(c[8]);
    }
    expect(total).toBe(detail.payslips.reduce((s: number, p: any) => s + minor(p.net), 0));
  });
});

describe('payroll output files — Qatar WPS (pearl-hospitality, processed run)', () => {
  const slug = 'pearl-hospitality';
  it('refuses the bank file for an unapproved run unless previewing; register is allowed', async () => {
    const current = (await runs(slug)).find((r) => r.status === 'processed');
    expect(current).toBeTruthy();
    const list = await request(app).get(`/api/payroll-files/runs/${current.id}`).set(auth(await hrOf(slug)));
    const wps = list.body.files.find((f: any) => f.kind === 'qatar_wps');
    expect(wps).toMatchObject({ available: false, preview_only: true, category: 'bank' });
    expect(list.body.files.find((f: any) => f.kind === 'register').available).toBe(true);

    const refused = await download(slug, `/runs/${current.id}/qatar_wps`);
    expect(refused.status).toBe(400);
    expect(JSON.parse(refused.body.toString()).error).toMatch(/unapproved register/);
    expect((await download(slug, `/runs/${current.id}/register`)).status).toBe(200);

    const preview = await download(slug, `/runs/${current.id}/qatar_wps?preview=1`);
    expect(preview.status).toBe(200);
    expect(filenameOf(preview)).toMatch(/^PREVIEW_SIF_\d+_[A-Z]{4}_\d{8}_\d{4}\.csv$/);
    const detail = await runDetail(slug, current.id);
    const lines = preview.body.toString('utf8').trim().split('\r\n');
    const header = lines[1].split(',');
    const recs = lines.slice(3).map((l: string) => l.split(','));
    expect(Number(header[7])).toBe(recs.length);
    expect(recs.length).toBe(detail.payslips.length);
    expect(header[5]).toBe(current.period.replace('-', ''));
    const total = recs.reduce((s: number, r: string[]) => s + parseMoney(r[6]), 0);
    expect(fmt(total)).toBe(header[6]);
    for (const r of recs) {
      expect(r[0]).toMatch(/^\d{11}$/);
      expect(r[3]).toMatch(/^QA\d{2}[A-Z]{4}\d{21}$/);
      expect(r[4]).toBe('M');
      expect(parseMoney(r[7]) + parseMoney(r[9]) - parseMoney(r[10])).toBe(parseMoney(r[6]));
    }
  });
});

describe('payroll output files — US NACHA ACH (lonestar-energy, approved run)', () => {
  const slug = 'lonestar-energy';
  it('94-character records, blocked to 10, with matching entry hash and totals', async () => {
    const current = (await runs(slug)).find((r) => r.status === 'approved');
    expect(current).toBeTruthy();
    const detail = await runDetail(slug, current.id);
    const res = await download(slug, `/runs/${current.id}/nacha_ach`);
    expect(res.status).toBe(200);
    expect(filenameOf(res)).toBe(`LONESTAR-ENERGY_ACH_${current.period}.ach`);
    const lines: string[] = res.body.toString('ascii').split('\n').filter((l: string) => l.length);
    for (const l of lines) expect(l.length).toBe(94);
    expect(lines.length % 10).toBe(0);
    expect(lines[0][0]).toBe('1');
    expect(lines[1].slice(0, 4)).toBe('5220');
    expect(lines[1].slice(50, 53)).toBe('PPD');
    expect(lines[1].slice(53, 63).trim()).toBe('PAYROLL');
    const entries = lines.filter((l) => l[0] === '6');
    expect(entries.length).toBe(detail.payslips.length);
    const batch = lines.find((l) => l[0] === '8')!;
    const file = lines.find((l) => l[0] === '9' && !/^9+$/.test(l))!;
    let credit = 0;
    const routings: string[] = [];
    for (const e of entries) {
      expect(['22', '32']).toContain(e.slice(1, 3));
      expect(isAbaRouting(e.slice(3, 12))).toBe(true);
      routings.push(e.slice(3, 11));
      credit += Number(e.slice(29, 39));
    }
    expect(credit).toBe(detail.payslips.reduce((s: number, p: any) => s + minor(p.net), 0));
    const hash = String(routings.reduce((s, r) => s + Number(r), 0) % 1e10).padStart(10, '0');
    expect(nachaEntryHash(routings)).toBe(hash);
    expect(batch.slice(4, 10)).toBe(String(entries.length).padStart(6, '0'));
    expect(batch.slice(10, 20)).toBe(hash);
    expect(Number(batch.slice(20, 32))).toBe(0);
    expect(Number(batch.slice(32, 44))).toBe(credit);
    expect(Number(file.slice(1, 7))).toBe(1);
    expect(Number(file.slice(7, 13))).toBe(lines.length / 10);
    expect(Number(file.slice(13, 21))).toBe(entries.length);
    expect(file.slice(21, 31)).toBe(hash);
    expect(Number(file.slice(43, 55))).toBe(credit);
    // Padding records are all 9s.
    for (const l of lines.slice(lines.indexOf(file) + 1)) expect(l).toBe('9'.repeat(94));
  });

  it('entry hash keeps only the rightmost 10 digits', () => {
    expect(nachaEntryHash(['99999999', '99999999'])).toBe('0199999998');
    expect(nachaEntryHash(Array(200).fill('99999999'))).toBe('9999999800'); // 19,999,999,800 → rightmost 10 digits
  });

  it('a hand-built workbook escapes text and stays well-formed', async () => {
    const buf = await buildXlsx([{ name: 'A/B [test]', cols: [{ header: 'Name & <co>' }, { header: 'Amt', money: true }], rows: [['O"Brien & Sons <x>', 12.5], [null, null]], totals: ['TOTAL', 12.5] }]);
    const files = await unzipXlsx(buf);
    expect(files['xl/workbook.xml']).toContain('name="A B  test"');
    expect(files['xl/worksheets/sheet1.xml']).toContain('O&quot;Brien &amp; Sons &lt;x&gt;');
  });

  it('only HR can download (employees are refused)', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: `employee@${slug}.example`, password: PASSWORD });
    const current = (await runs(slug)).find((r) => r.status === 'approved');
    expect((await request(app).get(`/api/payroll-files/runs/${current.id}`).set(auth(res.body.token))).status).toBe(403);
    expect((await request(app).get(`/api/payroll-files/runs/${current.id}/register`).set(auth(res.body.token))).status).toBe(403);
  });
});
