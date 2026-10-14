import { describe, it, expect, afterAll } from 'vitest';
import { app, request, hr, employee, manager, auth, cleanup, login } from './helpers.js';
import { today as companyToday, addDays as addDaysUtil } from '../src/util.js';

afterAll(cleanup);
const HQ = { lat: 12.9716, lng: 77.5946 };
const today = () => companyToday(); // the company's date, which is what the server uses

const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const binary = (res: any, cb: (err: any, body: Buffer) => void) => { const chunks: Buffer[] = []; res.on('data', (c: Buffer) => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks))); };

describe('attendance with geofencing', () => {
  it('rejects punches outside the geofence and without location', async () => {
    const e = await employee();
    const far = await request(app).post('/api/attendance/me/punch-in').set(auth(e)).send({ lat: 13.05, lng: 77.6 });
    expect(far.status).toBe(400);
    expect(far.body.error).toMatch(/m from Bengaluru HQ/);
    const none = await request(app).post('/api/attendance/me/punch-in').set(auth(e)).send({});
    expect(none.status).toBe(400);
    expect(none.body.error).toMatch(/Location is required/);
  });
  it('punches in, times breaks, punches out and computes minutes', async () => {
    const e = await employee();
    const pin = await request(app).post('/api/attendance/me/punch-in').set(auth(e)).send({ lat: HQ.lat + 0.0003, lng: HQ.lng });
    expect(pin.status).toBe(200);
    expect(pin.body.punch_in_within_fence).toBe(1);
    expect(pin.body.punch_in_location_name).toBe('Bengaluru HQ');
    expect(pin.body.punch_in_distance_m).toBeLessThan(200);
    expect((await request(app).post('/api/attendance/me/punch-in').set(auth(e)).send(HQ)).status).toBe(400);
    const b1 = await request(app).post('/api/attendance/me/break/start').set(auth(e)).send({ type: 'lunch' });
    expect(b1.body.breaks.length).toBe(1);
    expect((await request(app).post('/api/attendance/me/break/start').set(auth(e)).send({})).status).toBe(400);
    const b2 = await request(app).post('/api/attendance/me/break/end').set(auth(e)).send({});
    expect(b2.body.breaks[0].end_at).toBeTruthy();
    expect(b2.body.break_limit_exceeded).toBe(false);
    const today_ = await request(app).get('/api/attendance/me/today').set(auth(e));
    expect(today_.body.record.punch_in_at).toBeTruthy();
    expect(today_.body.record.correction).toBeNull();
    expect(today_.body.settings.appeal_deadline_days).toBe(3);
    expect(today_.body.locations.length).toBe(2);
    const pout = await request(app).post('/api/attendance/me/punch-out').set(auth(e)).send(HQ);
    expect(pout.status).toBe(200);
    expect(pout.body.punch_out_at).toBeTruthy();
    expect(pout.body.status).toBe('half_day'); // only seconds of work
    expect((await request(app).post('/api/attendance/me/punch-out').set(auth(e)).send(HQ)).status).toBe(400);
  });
  it('HR can allow remote punching via settings', async () => {
    const t = await hr();
    await request(app).put('/api/settings/attendance').set(auth(t)).send({ allow_remote_punch: true });
    const m = await manager();
    const pin = await request(app).post('/api/attendance/me/punch-in').set(auth(m)).send({ lat: 51.5, lng: -0.12 });
    expect(pin.status).toBe(200);
    expect(pin.body.punch_in_within_fence).toBe(0);
    await request(app).put('/api/settings/attendance').set(auth(t)).send({ allow_remote_punch: false });
  });

  it('edit only via appeal: direct edits are refused, HR raises + approves an appeal on behalf, previous values are kept', async () => {
    const t = await hr();
    const d = today();
    const direct = await request(app).put(`/api/attendance/records/6/${d}`).set(auth(t)).send({ punch_in_at: `${d}T04:00:00.000Z`, punch_out_at: `${d}T13:00:00.000Z` });
    expect(direct.status).toBe(403);
    expect(direct.body.error).toBe('Attendance can only be changed through an approved appeal');
    const before = (await request(app).get(`/api/attendance/records?employee_id=6&date=${d}`).set(auth(t))).body.items[0];
    expect((await request(app).delete(`/api/attendance/records/${before.id}`).set(auth(t))).status).toBe(403);
    // HR raises on behalf of the employee and may approve its own appeal.
    const ap = await request(app).post('/api/attendance/corrections').set(auth(t)).send({ employee_id: 6, date: d, kind: 'correction', requested_punch_in: `${d}T04:00:00.000Z`, requested_punch_out: `${d}T13:00:00.000Z`, reason: 'Fixed by HR' });
    expect(ap.status).toBe(201);
    expect(ap.body.kind).toBe('correction');
    expect(ap.body.approver_name).toBe('Meera Iyer');
    expect(ap.body.requested_by_name).toBe('Sara Thomas');
    expect(ap.body.deadline_date).toBe(addDays(d, 3));
    expect(ap.body.deadline_passed).toBe(false);
    const rev = await request(app).post(`/api/attendance/corrections/${ap.body.id}/review`).set(auth(t)).send({ decision: 'approve', note: 'ok' });
    expect(rev.status).toBe(200);
    expect(rev.body.status).toBe('approved');
    expect(rev.body.reviewer_name).toBe('Sara Thomas');
    expect(rev.body.applied_record_id).toBe(before.id);
    expect(rev.body.previous_values.punch_out_at).toBe(before.punch_out_at);
    const rec = (await request(app).get(`/api/attendance/records?employee_id=6&date=${d}`).set(auth(t))).body.items[0];
    expect(rec.punch_in_at).toBe(`${d}T04:00:00.000Z`);
    expect(rec.work_minutes).toBe(540 - rec.break_minutes);
    expect(rec.status).toBe('present');
    expect(rec.source).toBe('correction');
    expect(rec.correction_id).toBe(ap.body.id);
    expect(rec.corrected_by_name).toBe('Sara Thomas');
    expect(rec.correction.previous_values.punch_in_at).toBe(before.punch_in_at);
    expect(rec.correction.reviewer_name).toBe('Sara Thomas');
    const detail = await request(app).get(`/api/attendance/corrections/${ap.body.id}`).set(auth(t));
    expect(detail.status).toBe(200);
    expect(detail.body.record.id).toBe(before.id);
    expect(detail.body.changes.some((c: any) => c.field === 'punch_in_at')).toBe(true);
    expect(detail.body.trail.map((x: any) => x.action)).toEqual(['request', 'approved']);
    // With the setting off, direct edits work again and are audited with before/after.
    await request(app).put('/api/settings/attendance').set(auth(t)).send({ edit_only_via_appeal: false });
    const fixed = await request(app).put(`/api/attendance/records/6/${d}`).set(auth(t)).send({ punch_out_at: `${d}T13:30:00.000Z`, notes: 'Direct fix' });
    expect(fixed.status).toBe(200);
    expect(fixed.body.source).toBe('manual');
    expect(fixed.body.corrected_by_name).toBe('Sara Thomas');
    expect(fixed.body.corrected_at).toBeTruthy();
    const log = (await request(app).get('/api/settings/audit/log?limit=20').set(auth(t))).body.find((x: any) => x.entity === 'attendance' && x.action === 'correct' && String(x.entity_id) === String(before.id));
    expect(log.details.before.punch_out_at).toBe(`${d}T13:00:00.000Z`);
    expect(log.details.after.punch_out_at).toBe(`${d}T13:30:00.000Z`);
    await request(app).put('/api/settings/attendance').set(auth(t)).send({ edit_only_via_appeal: true });
  });

  it('enforces the appeal deadline (HR can override)', async () => {
    const e = await employee();
    const old = addDays(today(), -5);
    const late = await request(app).post('/api/attendance/corrections').set(auth(e)).send({ date: old, kind: 'missed_punch_out', requested_punch_out: `${old}T13:00:00.000Z`, reason: 'Too late' });
    expect(late.status).toBe(400);
    expect(late.body.error).toBe(`Appeals for ${old} closed on ${addDays(old, 3)} (3-day deadline). Ask HR to raise it on your behalf.`);
    const t = await hr();
    expect((await request(app).post('/api/attendance/corrections').set(auth(t)).send({ employee_id: 6, date: old, kind: 'missed_punch_out', requested_punch_out: `${old}T13:00:00.000Z`, reason: 'HR without override' })).status).toBe(400);
    const ok = await request(app).post('/api/attendance/corrections').set(auth(t)).send({ employee_id: 6, date: old, kind: 'missed_punch_out', requested_punch_out: `${old}T13:00:00.000Z`, reason: 'HR override', override_deadline: true });
    expect(ok.status).toBe(201);
    expect(ok.body.deadline_passed).toBe(true);
    expect((await request(app).post('/api/attendance/corrections').set(auth(e)).send({ date: addDays(today(), 1), kind: 'status', requested_status: 'wfh', reason: 'future' })).status).toBe(400);
    expect((await request(app).post('/api/attendance/corrections').set(auth(e)).send({ date: today(), kind: 'bogus', reason: 'x' })).status).toBe(400);
    expect((await request(app).post('/api/attendance/corrections').set(auth(e)).send({ date: today(), kind: 'missed_punch_in', reason: 'no time' })).status).toBe(400);
  });

  it('lists missed punches with the remaining appeal window', async () => {
    const t = await hr();
    const e = await employee();
    const recs = (await request(app).get(`/api/attendance/records?employee_id=6&from=${addDays(today(), -3)}&to=${addDays(today(), -1)}`).set(auth(t))).body.items;
    const target = recs.find((x: any) => ![0, 6].includes(new Date(x.date + 'T00:00:00Z').getUTCDay()) && x.date !== addDays(today(), -1) && x.date !== addDays(today(), -2)) || recs[0];
    expect(target).toBeTruthy();
    await request(app).put('/api/settings/attendance').set(auth(t)).send({ edit_only_via_appeal: false });
    expect((await request(app).delete(`/api/attendance/records/${target.id}`).set(auth(t))).status).toBe(200);
    await request(app).put('/api/settings/attendance').set(auth(t)).send({ edit_only_via_appeal: true });
    const missed = await request(app).get('/api/attendance/me/missed').set(auth(e));
    expect(missed.status).toBe(200);
    expect(missed.body.deadline_days).toBe(3);
    const item = missed.body.items.find((x: any) => x.date === target.date);
    expect(item).toBeTruthy();
    expect(item.kind).toBe('missed_both');
    expect(item.deadline_date).toBe(addDays(target.date, 3));
    expect(item.deadline_passed).toBe(false);
    expect(item.can_appeal).toBe(!item.appeal_id);
  });

  it('routes appeals through the reporting hierarchy', async () => {
    const e = await employee();
    const d = addDays(today(), -2);
    const req = await request(app).post('/api/attendance/corrections').set(auth(e)).send({ date: d, kind: 'missed_punch_out', requested_punch_out: `${d}T14:00:00.000Z`, reason: 'Forgot to punch out' });
    expect(req.status).toBe(201);
    expect(req.body.approver_name).toBe('Meera Iyer');
    expect((await request(app).post('/api/attendance/corrections').set(auth(e)).send({ date: d, kind: 'missed_punch_out', requested_punch_out: `${d}T14:00:00.000Z`, reason: 'dup' })).status).toBe(400);
    expect((await request(app).post(`/api/attendance/corrections/${req.body.id}/review`).set(auth(e)).send({ decision: 'approve' })).status).toBe(403);
    // employee sees own appeals (including the seeded pending one), managers their chain, HR all
    const mine = await request(app).get('/api/attendance/corrections').set(auth(e));
    expect(mine.body.every((x: any) => x.employee_id === 6)).toBe(true);
    expect(mine.body.some((x: any) => x.id === req.body.id)).toBe(true);
    const m = await manager();
    const t = await hr();
    const unrelated = await request(app).post('/api/attendance/corrections').set(auth(t)).send({ employee_id: 13, date: d, kind: 'status', requested_status: 'wfh', reason: 'Worked from home' });
    expect(unrelated.status).toBe(201);
    expect((await request(app).post(`/api/attendance/corrections/${unrelated.body.id}/review`).set(auth(m)).send({ decision: 'approve' })).status).toBe(403);
    expect((await request(app).get('/api/attendance/corrections').set(auth(m))).body.some((x: any) => x.id === unrelated.body.id)).toBe(false);
    const rev = await request(app).post(`/api/attendance/corrections/${req.body.id}/review`).set(auth(m)).send({ decision: 'approve', note: 'ok' });
    expect(rev.status).toBe(200);
    expect(rev.body.status).toBe('approved');
    expect(rev.body.reviewer_name).toBe('Meera Iyer');
    expect(rev.body.reviewed_at).toBeTruthy();
    const rec = (await request(app).get(`/api/attendance/records?employee_id=6&date=${d}`).set(auth(t))).body.items[0];
    expect(rec.punch_out_at).toBe(`${d}T14:00:00.000Z`);
    expect(rec.source).toBe('correction');
    expect(rec.correction.kind).toBe('missed_punch_out');
    expect(rec.correction.approver_name).toBe('Meera Iyer');
    expect(rec.corrected_by_name).toBe('Meera Iyer');
    // the manager's manager (Rahul Verma) may approve for anyone below him; HR anyway
    const skip = await request(app).post('/api/attendance/corrections').set(auth(t)).send({ employee_id: 7, date: d, kind: 'status', requested_status: 'wfh', reason: 'WFH day' });
    const rahul = await login('rahul.verma@acme.example');
    expect((await request(app).post(`/api/attendance/corrections/${skip.body.id}/review`).set(auth(rahul)).send({ decision: 'reject', note: 'no' })).body.status).toBe('rejected');
    expect((await request(app).post(`/api/attendance/corrections/${unrelated.body.id}/review`).set(auth(t)).send({ decision: 'approve' })).body.status).toBe('approved');
  });

  it('produces daily roster and monthly summary', async () => {
    const t = await hr();
    const daily = await request(app).get('/api/attendance/daily').set(auth(t));
    expect(daily.body.rows.length).toBeGreaterThan(10);
    expect(daily.body.counts.present).toBeGreaterThanOrEqual(1);
    expect(daily.body.edit_only_via_appeal).toBe(true);
    expect(daily.body.rows.find((r: any) => r.id === 6).record.correction.id).toBeTruthy();
    const sum = await request(app).get('/api/attendance/summary').set(auth(t));
    expect(sum.body.rows.find((r: any) => r.employee_code === 'EMP0006').present).toBeGreaterThan(0);
    const loc = await request(app).post('/api/attendance/locations').set(auth(t)).send({ name: 'Remote hub', lat: 10, lng: 10, radius_m: 100 });
    expect(loc.status).toBe(201);
    expect((await request(app).post('/api/attendance/locations').set(auth(t)).send({ name: 'bad', lat: 200, lng: 10 })).status).toBe(400);
  });
});

describe('attendance reports', () => {
  const from = today().slice(0, 7) + '-01', to = today();
  it('runs a filtered JSON report with summary, grouping and role scoping', async () => {
    const t = await hr();
    const all_ = await request(app).get(`/api/reports/attendance?from=${from}&to=${to}`).set(auth(t));
    expect(all_.status).toBe(200);
    expect(all_.body.rows.length).toBeGreaterThan(20);
    expect(all_.body.summary.employees).toBeGreaterThan(5);
    expect(all_.body.applied_filters.from).toBe(from);
    const less = await request(app).get(`/api/reports/attendance?from=${from}&to=${to}&work_less_than=540`).set(auth(t));
    expect(less.body.rows.length).toBeGreaterThan(0);
    expect(less.body.rows.length).toBeLessThan(all_.body.rows.length);
    expect(less.body.rows.every((r: any) => r.work_minutes < 540)).toBe(true);
    const late = await request(app).get(`/api/reports/attendance?from=${from}&to=${to}&late_only=1&columns=date,employee_name,late`).set(auth(t));
    expect(late.body.rows.every((r: any) => r.late_minutes > 0)).toBe(true);
    expect(late.body.columns.map((c: any) => c.key)).toEqual(['date', 'employee_name', 'late']);
    const grouped = await request(app).get(`/api/reports/attendance?from=${from}&to=${to}&group_by=department&include_absent=1`).set(auth(t));
    expect(grouped.body.groups.length).toBeGreaterThan(1);
    expect(grouped.body.rows.some((r: any) => r.synthetic)).toBe(true);
    const corrected = await request(app).get(`/api/reports/attendance?from=${from}&to=${to}&corrected_only=1`).set(auth(t));
    expect(corrected.body.rows.length).toBeGreaterThanOrEqual(1);
    expect(corrected.body.rows.every((r: any) => r.correction_id || r.corrected_at)).toBe(true);
    const e = await employee();
    const own = await request(app).get(`/api/reports/attendance?from=${from}&to=${to}&employee_id=5,6`).set(auth(e));
    expect(own.body.rows.length).toBeGreaterThan(0);
    expect(own.body.rows.every((r: any) => r.employee_id === 6)).toBe(true);
    expect((await request(app).get(`/api/reports/attendance?from=${to}&to=${from}`).set(auth(t))).status).toBe(400);
  });
  it('exports CSV with a header row and PDF bytes', async () => {
    const t = await hr();
    const csv = await request(app).get(`/api/reports/attendance?from=${from}&to=${to}&format=csv`).set(auth(t));
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.headers['content-disposition']).toBe(`attachment; filename="attendance_${from}_to_${to}.csv"`);
    const lines = csv.text.trim().split('\r\n');
    expect(lines[0]).toBe('"Date","Day","Code","Employee","Department","Status","In","Out","Work","Break","Late","Overtime","Geofence in","Geofence out","Source"');
    expect(lines.length).toBeGreaterThan(20);
    expect(lines[lines.length - 1].startsWith('"Total"')).toBe(true);
    const pdf = await request(app).get(`/api/reports/attendance?from=${from}&to=${to}&format=pdf&group_by=employee`).set(auth(t)).buffer(true).parse(binary);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.headers['content-disposition']).toMatch(/attendance_.*_by_employee\.pdf/);
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    expect((pdf.body as Buffer).length).toBeGreaterThan(2000);
  });
  it('ranks late comers', async () => {
    const t = await hr();
    const r_ = await request(app).get(`/api/reports/attendance/late-comers?from=${from}&to=${to}`).set(auth(t));
    expect(r_.status).toBe(200);
    const k = r_.body.rows.find((x: any) => x.employee_code === 'EMP0006');
    expect(k.late_days).toBeGreaterThanOrEqual(1);
    expect(k.avg_late_minutes).toBe(25);
    expect(r_.body.rows[0].rank).toBe(1);
    expect((await request(app).get(`/api/reports/attendance/late-comers?from=${from}&to=${to}&min_count=99`).set(auth(t))).body.rows.length).toBe(0);
    const csv = await request(app).get(`/api/reports/attendance/late-comers?from=${from}&to=${to}&format=csv`).set(auth(t));
    expect(csv.text.split('\r\n')[0]).toMatch(/^"#","Code","Employee"/);
    const pdf = await request(app).get(`/api/reports/attendance/late-comers?from=${from}&to=${to}&format=pdf`).set(auth(t)).buffer(true).parse(binary);
    expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
  });
  it('exports an employee statement; employees may download their own only', async () => {
    const e = await employee();
    const json = await request(app).get(`/api/reports/attendance/employee/6?from=${from}&to=${to}`).set(auth(e));
    expect(json.status).toBe(200);
    expect(json.body.employee.employee_code).toBe('EMP0006');
    expect(json.body.days.length).toBeGreaterThan(5);
    expect(json.body.totals.present).toBeGreaterThan(0);
    expect(json.body.days.some((d: any) => d.notes.includes('appeal'))).toBe(true);
    const csv = await request(app).get(`/api/reports/attendance/employee/6?from=${from}&to=${to}&format=csv`).set(auth(e));
    expect(csv.headers['content-disposition']).toBe(`attachment; filename="attendance_EMP0006_${from}_to_${to}.csv"`);
    expect(csv.text).toContain('"Employee","Karthik Raj (EMP0006)"');
    expect(csv.text).toContain('"Date","Day","Status","In","Out","Work","Break","Late","Overtime","Geofence in","Geofence out","Notes / appeals"');
    const pdf = await request(app).get(`/api/reports/attendance/employee/6?from=${from}&to=${to}&format=pdf`).set(auth(e)).buffer(true).parse(binary);
    expect(pdf.status).toBe(200);
    expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
    expect((await request(app).get(`/api/reports/attendance/employee/7?from=${from}&to=${to}`).set(auth(e))).status).toBe(403);
    const m = await manager();
    expect((await request(app).get(`/api/reports/attendance/employee/6?from=${from}&to=${to}`).set(auth(m))).status).toBe(200);
  });
});

describe('leave management', () => {
  const fut = (n: number) => addDaysUtil(companyToday(), n);
  const nextWeekday = (from: number) => { let n = from; while ([0, 6].includes(new Date(fut(n) + 'T00:00:00Z').getUTCDay())) n++; return n; };
  it('applies, checks balance, approves and deducts', async () => {
    const e = await employee();
    const before = (await request(app).get('/api/leave/balances/6').set(auth(e))).body;
    const cl = before.find((b: any) => b.code === 'CL');
    const types = (await request(app).get('/api/leave/types').set(auth(e))).body;
    const clType = types.find((t: any) => t.code === 'CL');
    const n = nextWeekday(20);
    const req = await request(app).post('/api/leave/requests').set(auth(e)).send({ leave_type_id: clType.id, start_date: fut(n), end_date: fut(n), reason: 'Errand' });
    expect(req.status).toBe(201);
    expect(req.body.days).toBe(1);
    expect(req.body.status).toBe('pending');
    // overlap
    expect((await request(app).post('/api/leave/requests').set(auth(e)).send({ leave_type_id: clType.id, start_date: fut(n), end_date: fut(n) })).status).toBe(400);
    // too much
    expect((await request(app).post('/api/leave/requests').set(auth(e)).send({ leave_type_id: clType.id, start_date: fut(40), end_date: fut(80) })).status).toBe(400);
    expect((await request(app).post(`/api/leave/requests/${req.body.id}/review`).set(auth(e)).send({ decision: 'approve' })).status).toBe(403);
    const m = await manager();
    const pending = await request(app).get('/api/leave/approvals/pending').set(auth(m));
    expect(pending.body.some((x: any) => x.id === req.body.id)).toBe(true);
    const appr = await request(app).post(`/api/leave/requests/${req.body.id}/review`).set(auth(m)).send({ decision: 'approve', note: 'Enjoy' });
    expect(appr.body.status).toBe('approved');
    const after = (await request(app).get('/api/leave/balances/6').set(auth(e))).body.find((b: any) => b.code === 'CL');
    expect(after.used).toBe(cl.used + 1);
    expect(after.available).toBe(cl.available - 1);
    // correction on approved leave -> correction_pending -> approve
    const corr = await request(app).put(`/api/leave/requests/${req.body.id}`).set(auth(e)).send({ start_date: fut(n), end_date: fut(n + 1 + (new Date(fut(n + 1) + 'T00:00:00Z').getUTCDay() === 6 ? 2 : 0)) });
    expect(corr.status).toBe(200);
    expect(corr.body.status).toBe('correction_pending');
    expect(corr.body.correction.days).toBeGreaterThanOrEqual(2);
    const c2 = await request(app).post(`/api/leave/requests/${req.body.id}/review`).set(auth(m)).send({ decision: 'approve' });
    expect(c2.body.status).toBe('approved');
    expect(c2.body.days).toBe(corr.body.correction.days);
    const bal2 = (await request(app).get('/api/leave/balances/6').set(auth(e))).body.find((b: any) => b.code === 'CL');
    expect(bal2.used).toBe(cl.used + c2.body.days);
    // cancel restores balance
    const cancel = await request(app).post(`/api/leave/requests/${req.body.id}/cancel`).set(auth(e)).send({});
    expect(cancel.body.status).toBe('cancelled');
    const bal3 = (await request(app).get('/api/leave/balances/6').set(auth(e))).body.find((b: any) => b.code === 'CL');
    expect(bal3.used).toBe(cl.used);
    const detail = await request(app).get(`/api/leave/requests/${req.body.id}`).set(auth(e));
    expect(detail.body.history.map((h: any) => h.action)).toEqual(['applied', 'approved', 'correction_requested', 'correction_approved', 'cancelled']);
  });
  it('enforces balance limits, notice and half days; HR can auto-approve and adjust', async () => {
    const e = await employee();
    const types = (await request(app).get('/api/leave/types').set(auth(e))).body;
    const ml = types.find((t: any) => t.code === 'ML'); // 30 days notice
    const short = await request(app).post('/api/leave/requests').set(auth(e)).send({ leave_type_id: ml.id, start_date: fut(1), end_date: fut(1) });
    expect(short.status).toBe(400);
    expect(short.body.error).toMatch(/notice/);
    const cl = types.find((t: any) => t.code === 'CL');
    const n = nextWeekday(30);
    const half = await request(app).post('/api/leave/requests').set(auth(e)).send({ leave_type_id: cl.id, start_date: fut(n), end_date: fut(n), half_day: 'first_half' });
    expect(half.body.days).toBe(0.5);
    const t = await hr();
    const n2 = nextWeekday(45);
    const onBehalf = await request(app).post('/api/leave/requests').set(auth(t)).send({ employee_id: 11, leave_type_id: cl.id, start_date: fut(n2), end_date: fut(n2), auto_approve: true });
    expect(onBehalf.body.status).toBe('approved');
    const adj = await request(app).put(`/api/leave/balances/11/${cl.id}`).set(auth(t)).send({ adjusted: 2 });
    expect(adj.body.find((b: any) => b.code === 'CL').adjusted).toBe(2);
    const newType = await request(app).post('/api/leave/types').set(auth(t)).send({ name: 'Study Leave', code: 'STL', annual_quota: 5 });
    expect(newType.status).toBe(201);
    expect((await request(app).get('/api/leave/balances/6').set(auth(e))).body.some((b: any) => b.code === 'STL' && b.available === 5)).toBe(true);
    const cal = await request(app).get('/api/leave/calendar?from=' + fut(0) + '&to=' + fut(60)).set(auth(t));
    expect(cal.body.items.length).toBeGreaterThan(0);
  });
});
