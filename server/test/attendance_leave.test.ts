import { describe, it, expect, afterAll } from 'vitest';
import { app, request, hr, employee, manager, auth, cleanup } from './helpers.js';

afterAll(cleanup);
const HQ = { lat: 12.9716, lng: 77.5946 };
const today = () => new Date().toISOString().slice(0, 10);

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
  it('HR corrects times and reviews employee correction requests', async () => {
    const t = await hr();
    const d = today();
    const fixed = await request(app).put(`/api/attendance/records/6/${d}`).set(auth(t)).send({ punch_in_at: `${d}T04:00:00.000Z`, punch_out_at: `${d}T13:00:00.000Z`, notes: 'Fixed by HR' });
    expect(fixed.status).toBe(200);
    expect(fixed.body.work_minutes).toBe(540 - fixed.body.break_minutes);
    expect(fixed.body.status).toBe('present');
    expect(fixed.body.source).toBe('manual');
    const e = await employee();
    const yesterday = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10); // seed already has a pending correction for -1 day
    const req = await request(app).post('/api/attendance/corrections').set(auth(e)).send({ date: yesterday, requested_punch_out: `${yesterday}T14:00:00.000Z`, reason: 'Forgot to punch out' });
    expect(req.status).toBe(201);
    expect((await request(app).post(`/api/attendance/corrections/${req.body.id}/review`).set(auth(e)).send({ decision: 'approve' })).status).toBe(403);
    const m = await manager();
    const rev = await request(app).post(`/api/attendance/corrections/${req.body.id}/review`).set(auth(m)).send({ decision: 'approve', note: 'ok' });
    expect(rev.status).toBe(200);
    expect(rev.body.status).toBe('approved');
    const rec = (await request(app).get(`/api/attendance/records?employee_id=6&date=${yesterday}`).set(auth(t))).body.items[0];
    expect(rec.punch_out_at).toBe(`${yesterday}T14:00:00.000Z`);
    expect(rec.source).toBe('correction');
  });
  it('produces daily roster and monthly summary', async () => {
    const t = await hr();
    const daily = await request(app).get('/api/attendance/daily').set(auth(t));
    expect(daily.body.rows.length).toBeGreaterThan(10);
    expect(daily.body.counts.present).toBeGreaterThanOrEqual(1);
    const sum = await request(app).get('/api/attendance/summary').set(auth(t));
    expect(sum.body.rows.find((r: any) => r.employee_code === 'EMP0006').present).toBeGreaterThan(0);
    const loc = await request(app).post('/api/attendance/locations').set(auth(t)).send({ name: 'Remote hub', lat: 10, lng: 10, radius_m: 100 });
    expect(loc.status).toBe(201);
    expect((await request(app).post('/api/attendance/locations').set(auth(t)).send({ name: 'bad', lat: 200, lng: 10 })).status).toBe(400);
  });
});

describe('leave management', () => {
  const fut = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
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
