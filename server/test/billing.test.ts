import { describe, it, expect, afterAll } from 'vitest';
import { app, request, hr, auth, cleanup, login, PASSWORD } from './helpers.js';

const billing = await import('../src/ops/billing.js');
const { agency } = await import('../src/db.js');

afterAll(cleanup);

const agencyLogin = async (email = 'admin@saigahr.example') => {
  const res = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
  expect(res.status).toBe(200);
  return res.body.token as string;
};
const companyId = (slug: string) => agency.get<any>('SELECT id FROM companies WHERE slug = ?', [slug])!.id as number;
const sum = (parts: { amount_minor: number }[]) => parts.reduce((a, p) => a + p.amount_minor, 0);

/** A throwaway client company billed by its own test entity (keeps its number series isolated). */
function testCompany(slug: string, opts: { region?: string; code?: string; min?: number; pepm?: number; prefix?: string } = {}) {
  const now = new Date().toISOString();
  const entity = agency.insert('billing_entities', { code: slug.toUpperCase(), name: 'Test entity', legal_name: 'Test Entity Pvt Ltd', country_code: 'IN', region: 'Kerala', region_code: '32', tax_label: 'GSTIN', tax_id: `32${slug.toUpperCase()}`, address: 'Kochi', invoice_prefix: opts.prefix || 'TST', fy_start_month: 4, created_at: now });
  const id = agency.insert('companies', { slug, name: `Test ${slug}`, legal_name: `Test ${slug} Pvt Ltd`, country_code: 'IN', region: opts.region || 'Kerala', currency: 'INR', timezone: 'Asia/Kolkata', status: 'active', onboarded_at: '2020-01-01T00:00:00.000Z', created_at: now, updated_at: now });
  agency.insert('billing_profiles', { company_id: id, entity_id: entity, plan_name: 'Test', currency: 'INR', pepm_minor: opts.pepm ?? 45000, payroll_run_minor: 250000, min_monthly_minor: opts.min ?? 1500000, setup_fee_minor: 0, setup_fee_billed: 1, tax_scheme: 'IN_GST', place_of_supply: opts.region || 'Kerala', place_of_supply_code: opts.code || '32', payment_terms_days: 15, active: 1, updated_at: now });
  return id;
}

describe('money helpers', () => {
  it('exponent is data, parsing is exact, KWD keeps three decimals', () => {
    expect(billing.exponentOf('INR')).toBe(2);
    expect(billing.exponentOf('KWD')).toBe(3);
    expect(billing.parseMoney('0.1', 2) + billing.parseMoney('0.2', 2)).toBe(30);
    expect(billing.parseMoney('1,234.567', 3)).toBe(1234567);
    expect(billing.formatMinor(1234567, 3, 'KWD')).toBe('1,234.567');
    expect(() => billing.parseMoney('1.234', 2)).toThrow();
    expect(billing.amountInWords(12345000, 2, 'INR')).toBe('Rupees One Lakh Twenty-Three Thousand Four Hundred Fifty only');
  });

  it('GST: intra-state CGST+SGST and inter-state IGST always sum to the tax total', () => {
    for (const subtotal of [1, 3, 1001, 1003, 2749, 1500000, 999999999]) {
      const intra = billing.computeTax(subtotal, 'IN_GST', 1800, true);
      expect(intra.breakdown.map((p) => p.name)).toEqual(['CGST', 'SGST']);
      expect(sum(intra.breakdown)).toBe(intra.tax_minor);
      expect(intra.breakdown[0].amount_minor - intra.breakdown[1].amount_minor).toBeGreaterThanOrEqual(0);
      expect(intra.breakdown[0].amount_minor - intra.breakdown[1].amount_minor).toBeLessThanOrEqual(1);
      const inter = billing.computeTax(subtotal, 'IN_GST', 1800, false);
      expect(inter.breakdown).toEqual([{ name: 'IGST', rate_bp: 1800, amount_minor: intra.tax_minor }]);
    }
    // 1003 × 18% = 180.54 → 181; the odd paisa goes to CGST.
    expect(billing.computeTax(1003, 'IN_GST', 1800, true).breakdown.map((p) => p.amount_minor)).toEqual([91, 90]);
    expect(billing.computeTax(100000, 'AE_EXPORT', 0, false)).toEqual({ tax_minor: 0, breakdown: [{ name: 'VAT (zero-rated export)', rate_bp: 0, amount_minor: 0 }] });
  });

  it('financial years: India 1 Apr – 31 Mar, others calendar year', () => {
    expect(billing.fyLabel('2027-03-31', 4)).toBe('2026-27');
    expect(billing.fyLabel('2027-04-01', 4)).toBe('2027-28');
    expect(billing.fyLabel('2027-04-01', 1)).toBe('2027');
  });
});

describe('agency billing', () => {
  it('seeds three months of history: older months paid, last month has overdue invoices, this month open', async () => {
    const t = await agencyLogin();
    const ov = await request(app).get('/api/agency/billing/overview').set(auth(t));
    expect(ov.status).toBe(200);
    expect(ov.body.counts.overdue).toBeGreaterThan(0);
    expect(ov.body.counts.missing_this_month).toBeGreaterThan(0);
    expect(ov.body.totals.find((x: any) => x.currency === 'INR')).toBeTruthy();
    const list = (await request(app).get('/api/agency/billing/invoices').set(auth(t))).body;
    const acme = list.filter((i: any) => i.company_slug === 'acme');
    expect(acme.length).toBe(3);
    expect(acme.every((i: any) => /^SHS\/\d{4}-\d{2}\/\d{4}$/.test(i.number))).toBe(true);
    // Acme is in Karnataka, the agency's Indian entity in Kerala → IGST.
    expect(acme[0].tax_breakdown.map((p: any) => p.name)).toEqual(['IGST']);
    const tejas = list.find((i: any) => i.company_slug === 'tejas-infotech');
    expect(tejas.tax_breakdown.map((p: any) => p.name)).toEqual(['CGST', 'SGST']);
    expect(sum(tejas.tax_breakdown)).toBe(tejas.tax_minor);
    const pearl = list.find((i: any) => i.company_slug === 'pearl-hospitality');
    expect(pearl.tax_minor).toBe(0);
    expect(pearl.notes).toMatch(/Zero-rated export/);
    // Seeding again changes nothing.
    billing.seedBillingDemo();
    expect((await request(app).get('/api/agency/billing/invoices').set(auth(t))).body.length).toBe(list.length);
  });

  it('generates a draft per company, issues it with the next number, and takes idempotent payments', async () => {
    const t = await agencyLogin();
    const period = new Date().toISOString().slice(0, 7);
    const gen = await request(app).post('/api/agency/billing/invoices/generate').set(auth(t)).send({ period, company_slugs: ['acme'] });
    expect(gen.status).toBe(201);
    expect(gen.body.created).toHaveLength(1);
    const again = await request(app).post('/api/agency/billing/invoices/generate').set(auth(t)).send({ period, company_slugs: ['acme'] });
    expect(again.body.created).toHaveLength(0);
    expect(again.body.skipped).toHaveLength(1);

    const id = gen.body.created[0].invoice_id;
    const draft = (await request(app).get(`/api/agency/billing/invoices/${id}`).set(auth(t))).body;
    expect(draft.number).toBeNull();
    const pepm = draft.lines.find((l: any) => l.kind === 'pepm');
    expect(pepm.quantity).toBe(13);
    expect(pepm.amount_minor).toBe(13 * 45000);
    expect(pepm.sac_code).toBe('998519');
    expect(draft.tax_breakdown).toEqual([{ name: 'IGST', rate_bp: 1800, amount_minor: draft.tax_minor }]);
    expect(draft.total_minor).toBe(draft.subtotal_minor + draft.tax_minor);

    // Ad-hoc line on the draft.
    const edited = await request(app).put(`/api/agency/billing/invoices/${id}`).set(auth(t)).send({ notes: 'Thanks', add_lines: [{ description: 'Full & final settlement (2 exits)', quantity: 2, unit: '1500.00' }] });
    expect(edited.status).toBe(200);
    expect(edited.body.lines.find((l: any) => l.kind === 'adhoc').amount_minor).toBe(300000);

    // Numbers continue the seeded series.
    const prevMax = Math.max(...agency.all<any>("SELECT number FROM invoices WHERE number LIKE 'SHS/%'").map((r) => Number(r.number.split('/')[2])));
    const issued = await request(app).post(`/api/agency/billing/invoices/${id}/issue`).set(auth(t));
    expect(issued.status).toBe(200);
    expect(Number(issued.body.number.split('/')[2])).toBe(prevMax + 1);
    expect(issued.body.due_date > issued.body.issue_date).toBe(true);
    expect((await request(app).put(`/api/agency/billing/invoices/${id}`).set(auth(t)).send({ notes: 'x' })).status).toBe(400);

    const total = issued.body.total_minor;
    const part = Math.floor(total / 3);
    const pay = (key: string, amount_minor: number) => request(app).post(`/api/agency/billing/invoices/${id}/payments`).set(auth(t)).set('Idempotency-Key', key).send({ amount_minor, received_on: issued.body.issue_date, method: 'neft', reference: 'UTR1' });
    const p1 = await pay('pay-1', part);
    expect(p1.status).toBe(201);
    const replay = await pay('pay-1', part);
    expect(replay.status).toBe(200);
    expect(replay.body.replayed).toBe(true);
    expect(replay.body.payment.id).toBe(p1.body.payment.id);
    expect(replay.body.invoice.paid_minor).toBe(part);
    expect((await pay('pay-2', total)).status).toBe(400); // overpayment
    const p2 = await pay('pay-3', total - part);
    expect(p2.body.invoice.status).toBe('paid');
    expect(p2.body.invoice.payments).toHaveLength(2);

    const pdf = await request(app).get(`/api/agency/billing/invoices/${id}/pdf`).set(auth(t));
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toMatch(/application\/pdf/);
  });

  it('numbering is consecutive per entity and FY, resets on 1 April, and a void keeps its number; minimum top-up applies', () => {
    const id = testCompany('billing-num');
    for (const p of ['2027-01', '2027-02', '2027-03', '2027-04']) billing.generateInvoices(p, { companyIds: [id], asOf: `${p}-01` });
    const inv = (p: string) => agency.get<any>("SELECT * FROM invoices WHERE company_id = ? AND period = ? AND status != 'void'", [id, p])!;
    // No employees → the whole minimum is a top-up line.
    const lines = agency.all<any>('SELECT * FROM invoice_lines WHERE invoice_id = ?', [inv('2027-01').id]);
    expect(lines.find((l) => l.kind === 'pepm').amount_minor).toBe(0);
    expect(lines.find((l) => l.kind === 'minimum_topup').amount_minor).toBe(1500000);
    expect(inv('2027-01').subtotal_minor).toBe(1500000);
    expect(JSON.parse(inv('2027-01').tax_breakdown).map((p: any) => p.name)).toEqual(['CGST', 'SGST']);

    expect(billing.issueInvoice(inv('2027-01').id, '2027-03-30').number).toBe('TST/2026-27/0001');
    expect(billing.issueInvoice(inv('2027-02').id, '2027-03-31').number).toBe('TST/2026-27/0002');
    // Voiding keeps the number used; the next invoice does not reuse it.
    const v = billing.voidInvoice(inv('2027-02').id, 'Wrong headcount');
    expect(v.status).toBe('void');
    expect(v.number).toBe('TST/2026-27/0002');
    billing.generateInvoices('2027-02', { companyIds: [id], asOf: '2027-03-31' });
    expect(billing.issueInvoice(inv('2027-02').id, '2027-03-31').number).toBe('TST/2026-27/0003');
    // New financial year → series restarts.
    expect(billing.issueInvoice(inv('2027-03').id, '2027-04-01').number).toBe('TST/2027-28/0001');
    expect(billing.issueInvoice(inv('2027-04').id, '2027-04-02').number).toBe('TST/2027-28/0002');
    // Paid / void invoices cannot be voided; issued ones with payments neither.
    expect(() => billing.voidInvoice(v.id, 'again')).toThrow();
    // Backdating within a series is refused.
    billing.generateInvoices('2027-05', { companyIds: [id], asOf: '2027-04-01' });
    expect(() => billing.issueInvoice(inv('2027-05').id, '2027-04-01')).toThrow(/backwards/);
  });

  it('tax rates are effective-dated: a future rate does not touch invoices dated before it', () => {
    const id = testCompany('billing-rate', { region: 'Karnataka', code: '29', prefix: 'TSR' });
    agency.insert('tax_rates', { scheme: 'IN_GST', rate_bp: 2000, effective_from: '2099-01-01', note: 'test' });
    expect(billing.taxRateFor('IN_GST', '2098-12-31').rate_bp).toBe(1800);
    expect(billing.taxRateFor('IN_GST', '2099-01-01').rate_bp).toBe(2000);
    billing.generateInvoices('2098-12', { companyIds: [id], asOf: '2098-12-01' });
    billing.generateInvoices('2099-01', { companyIds: [id], asOf: '2099-01-01' });
    const before = agency.get<any>("SELECT id FROM invoices WHERE company_id = ? AND period = '2098-12'", [id])!.id;
    const after = agency.get<any>("SELECT id FROM invoices WHERE company_id = ? AND period = '2099-01'", [id])!.id;
    const a = billing.issueInvoice(before, '2098-12-31');
    expect(a.tax_rate_bp).toBe(1800);
    expect(a.tax_breakdown).toEqual([{ name: 'IGST', rate_bp: 1800, amount_minor: 270000 }]);
    const b = billing.issueInvoice(after, '2099-01-02');
    expect(b.tax_rate_bp).toBe(2000);
    expect(b.tax_minor).toBe(300000);
    // The earlier invoice was not restated.
    expect(billing.invoiceDetail(before).tax_minor).toBe(270000);
    agency.run("DELETE FROM tax_rates WHERE effective_from = '2099-01-01'");
  });

  it('client HR downloads only their own, non-draft invoices; agency roles are enforced', async () => {
    const client = await hr();
    const mine = await request(app).get('/api/services/invoices').set(auth(client));
    expect(mine.status).toBe(200);
    expect(mine.body.length).toBeGreaterThan(0);
    const pdf = await request(app).get(`/api/services/invoices/${mine.body[0].id}/pdf`).set(auth(client));
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toMatch(/application\/pdf/);
    expect(pdf.body.length).toBeGreaterThan(1000);

    const other = agency.get<any>("SELECT id FROM invoices WHERE company_id = ? AND status != 'draft' LIMIT 1", [companyId('nimbus-retail')])!.id;
    expect((await request(app).get(`/api/services/invoices/${other}/pdf`).set(auth(client))).status).toBe(404);
    const owner = await agencyLogin();
    const period = new Date().toISOString().slice(0, 7);
    await request(app).post('/api/agency/billing/invoices/generate').set(auth(owner)).send({ period, company_slugs: ['nimbus-retail'] });
    const draft = agency.get<any>("SELECT id FROM invoices WHERE company_id = ? AND status = 'draft'", [companyId('nimbus-retail')])!.id;
    const nimbusHr = await login('hr@nimbus-retail.example').catch(() => null);
    if (nimbusHr) expect((await request(app).get(`/api/services/invoices/${draft}/pdf`).set(auth(nimbusHr))).status).toBe(404);
    expect((await request(app).get('/api/agency/billing/overview').set(auth(client))).status).toBe(403);

    // Payroll staff can look but not touch; the US account manager cannot see Indian invoices.
    const payroll = await agencyLogin('payroll@saigahr.example');
    expect((await request(app).get(`/api/agency/billing/invoices/${draft}`).set(auth(payroll))).status).toBe(200);
    expect((await request(app).post(`/api/agency/billing/invoices/${draft}/issue`).set(auth(payroll))).status).toBe(403);
    const amUs = await agencyLogin('am.us@saigahr.example');
    expect((await request(app).get(`/api/agency/billing/invoices/${draft}`).set(auth(amUs))).status).toBe(404);
    const usList = (await request(app).get('/api/agency/billing/invoices').set(auth(amUs))).body;
    expect(usList.length).toBeGreaterThan(0);
    expect(usList.every((i: any) => i.currency === 'USD')).toBe(true);
  });

  it('pricing profiles are edited in major units and stored as minor units', async () => {
    const t = await agencyLogin('am.india@saigahr.example');
    const list = (await request(app).get('/api/agency/billing/profiles').set(auth(t))).body;
    const acme = list.profiles.find((p: any) => p.company_slug === 'acme');
    const res = await request(app).put(`/api/agency/billing/profiles/${acme.company_id}`).set(auth(t)).send({ pepm: '475.50', payment_terms_days: 30, place_of_supply: 'Kerala', client_tax_id: '32aabca1234c1z5' });
    expect(res.status).toBe(200);
    expect(res.body.pepm_minor).toBe(47550);
    expect(res.body.place_of_supply_code).toBe('32');
    expect(res.body.client_tax_id).toBe('32AABCA1234C1Z5');
    expect((await request(app).put(`/api/agency/billing/profiles/${acme.company_id}`).set(auth(t)).send({ pepm: '1.234' })).status).toBe(400);
    const gcc = await agencyLogin('am.gcc@saigahr.example');
    expect((await request(app).put(`/api/agency/billing/profiles/${acme.company_id}`).set(auth(gcc)).send({ pepm: '1' })).status).toBe(404);
  });
});
