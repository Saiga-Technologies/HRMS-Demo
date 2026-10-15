import { describe, it, expect, afterAll } from 'vitest';
import { app, request, hr, employee, manager, auth, cleanup } from './helpers.js';
import { today as companyToday, addDays as addDaysUtil } from '../src/util.js';

afterAll(cleanup);
const { run, get } = await import('../src/db.js');

// Bengaluru HQ and a point ~1 km north of it (0.009° latitude ≈ 1.0 km).
const HQ = { lat: 12.9716, lng: 77.5946 };
const KM_NORTH = { lat: 12.9806, lng: 77.5946 };
const EMP = 6; // EMP0006 Karthik Raj (employee@acme.example), reports to EMP0005 Meera Iyer (manager@acme.example)

describe('travel tracking', () => {
  it('starts, pings, stops and computes a plausible distance', async () => {
    const e = await employee();
    expect((await request(app).post('/api/travel/start').set(auth(e)).send({ purpose: 'no destination' })).status).toBe(400);
    expect((await request(app).post('/api/travel/start').set(auth(e)).send({ destination: 'Bad coords', lat: 95, lng: 10 })).status).toBe(400);
    const start = await request(app).post('/api/travel/start').set(auth(e)).send({ destination: 'Client site', purpose: 'Kick-off', lat: HQ.lat, lng: HQ.lng, accuracy: 12 });
    expect(start.status).toBe(201);
    expect(start.body.status).toBe('active');
    expect(start.body.points).toBe(1);
    expect(start.body.start_lat).toBe(HQ.lat);
    // One active trip per employee
    const again = await request(app).post('/api/travel/start').set(auth(e)).send({ destination: 'Elsewhere', lat: HQ.lat, lng: HQ.lng });
    expect(again.status).toBe(400);
    expect(again.body.error).toMatch(/active trip/);
    const active = await request(app).get('/api/travel/active').set(auth(e));
    expect(active.body.trip.id).toBe(start.body.id);
    expect(active.body.settings.travel_sample_interval_seconds).toBeGreaterThan(0);
    // Jitter (< 15 m) is ignored, real movement is sampled
    const jitter = await request(app).post(`/api/travel/${start.body.id}/ping`).set(auth(e)).send({ lat: HQ.lat + 0.00005, lng: HQ.lng });
    expect(jitter.body.added).toBe(false);
    expect(jitter.body.points).toBe(1);
    const half = await request(app).post(`/api/travel/${start.body.id}/ping`).set(auth(e)).send({ lat: 12.9761, lng: HQ.lng });
    expect(half.body.added).toBe(true);
    expect(half.body.points).toBe(2);
    expect(half.body.distance_km).toBeGreaterThan(0.4);
    expect((await request(app).post(`/api/travel/${start.body.id}/ping`).set(auth(e)).send({ lat: 'x' })).status).toBe(400);
    const stop = await request(app).post(`/api/travel/${start.body.id}/stop`).set(auth(e)).send({ ...KM_NORTH, notes: 'Done' });
    expect(stop.status).toBe(200);
    expect(stop.body.status).toBe('completed');
    expect(stop.body.points).toBe(3);
    expect(stop.body.distance_km).toBeGreaterThan(0.9);
    expect(stop.body.distance_km).toBeLessThan(1.1);
    expect(stop.body.ended_at).toBeTruthy();
    expect(stop.body.end_lat).toBe(KM_NORTH.lat);
    expect(stop.body.notes).toBe('Done');
    expect((await request(app).post(`/api/travel/${start.body.id}/stop`).set(auth(e)).send(KM_NORTH)).status).toBe(400);
    expect((await request(app).get('/api/travel/active').set(auth(e))).body.trip).toBeNull();
  });
  it('falls back to a straight line when there are fewer than two samples, and cancels', async () => {
    const e = await employee();
    const start = await request(app).post('/api/travel/start').set(auth(e)).send({ destination: 'Airport', lat: HQ.lat, lng: HQ.lng });
    const stop = await request(app).post(`/api/travel/${start.body.id}/stop`).set(auth(e)).send(KM_NORTH);
    expect(stop.body.points).toBe(2);
    expect(stop.body.distance_km).toBeGreaterThan(0.9);
    expect(stop.body.distance_km).toBeLessThan(1.1);
    const noloc = await request(app).post('/api/travel/start').set(auth(e)).send({ destination: 'No GPS' });
    expect(noloc.status).toBe(201);
    expect(noloc.body.points).toBe(0);
    const stop2 = await request(app).post(`/api/travel/${noloc.body.id}/stop`).set(auth(e)).send({});
    expect(stop2.body.distance_km).toBe(0);
    const c = await request(app).post('/api/travel/start').set(auth(e)).send({ destination: 'Cancelled', lat: HQ.lat, lng: HQ.lng });
    const cancel = await request(app).post(`/api/travel/${c.body.id}/cancel`).set(auth(e)).send({});
    expect(cancel.body.status).toBe('cancelled');
  });
  it('scopes lists: employees own, managers their chain, HR all; summary and delete', async () => {
    const e = await employee();
    const m = await manager();
    const t = await hr();
    const mine = await request(app).get('/api/travel').set(auth(e));
    expect(mine.status).toBe(200);
    expect(mine.body.length).toBeGreaterThanOrEqual(3);
    expect(mine.body.every((x: any) => x.employee_id === EMP)).toBe(true);
    expect(mine.body[0].employee_name).toBe('Karthik Raj');
    expect(mine.body[0].department_name).toBeTruthy();
    expect(mine.body[0].path).toBeUndefined();
    // Manager (EMP0005) sees Karthik's trips; an unrelated manager-level user would not
    const team = await request(app).get(`/api/travel?employee_id=${EMP}&status=completed`).set(auth(m));
    expect(team.body.length).toBeGreaterThanOrEqual(2);
    const detail = await request(app).get(`/api/travel/${team.body[0].id}`).set(auth(m));
    expect(detail.status).toBe(200);
    expect(Array.isArray(detail.body.path)).toBe(true);
    // Employee cannot see another employee's trip
    const other = await request(app).get('/api/travel?employee_id=5').set(auth(e));
    expect(other.body.length).toBe(0);
    const month = companyToday().slice(0, 7);
    expect((await request(app).get(`/api/travel/summary?period=${month}`).set(auth(e))).status).toBe(403);
    const sum = await request(app).get(`/api/travel/summary?period=${month}`).set(auth(t));
    expect(sum.status).toBe(200);
    const row = sum.body.rows.find((x: any) => x.employee_id === EMP);
    expect(row.trips).toBe(3);
    expect(row.km).toBeGreaterThan(1.8);
    expect(sum.body.totals.km).toBeGreaterThanOrEqual(row.km);
    expect((await request(app).get('/api/travel/summary?period=2024-1').set(auth(t))).status).toBe(400);
    expect((await request(app).delete(`/api/travel/${team.body[0].id}`).set(auth(e))).status).toBe(403);
    expect((await request(app).delete(`/api/travel/${team.body[0].id}`).set(auth(t))).status).toBe(200);
    expect((await request(app).delete(`/api/travel/${team.body[0].id}`).set(auth(t))).status).toBe(404);
  });
  it('returns 403 when travel tracking is disabled', async () => {
    const t = await hr();
    const e = await employee();
    await request(app).put('/api/settings/attendance').set(auth(t)).send({ travel_tracking_enabled: false });
    const res = await request(app).post('/api/travel/start').set(auth(e)).send({ destination: 'Nowhere', lat: HQ.lat, lng: HQ.lng });
    expect(res.status).toBe(403);
    expect((await request(app).get('/api/travel/active').set(auth(e))).body.settings.travel_tracking_enabled).toBe(false);
    await request(app).put('/api/settings/attendance').set(auth(t)).send({ travel_tracking_enabled: true });
    expect((await request(app).post('/api/travel/start').set(auth(e)).send({ destination: 'Back on', lat: HQ.lat, lng: HQ.lng })).status).toBe(201);
  });
});

describe('comp-off automation', () => {
  const coBalance = async (token: string, eid = EMP) => (await request(app).get(`/api/leave/balances/${eid}`).set(auth(token))).body.find((b: any) => b.code === 'CO');
  it('detects the seeded Saturday work for EMP0006 and EMP0005 (idempotent)', async () => {
    const t = await hr();
    const first = await request(app).post('/api/compoff/detect').set(auth(t));
    expect(first.status).toBe(200);
    expect(first.body.enabled).toBe(true);
    expect(first.body.created).toBeGreaterThanOrEqual(2);
    const second = await request(app).post('/api/compoff/detect').set(auth(t));
    expect(second.body.created).toBe(0);
    const all = await request(app).get('/api/compoff').set(auth(t));
    const k = all.body.filter((c: any) => c.employee_code === 'EMP0006' && c.reason === 'weekly_off');
    const m = all.body.filter((c: any) => c.employee_code === 'EMP0005' && c.reason === 'weekly_off');
    expect(k.length).toBe(1);
    expect(m.length).toBe(1);
    expect(k[0].status).toBe('detected');
    expect(k[0].work_minutes).toBe(555);
    expect(k[0].days).toBe(1);
    expect(k[0].approver_name).toBe('Meera Iyer');
    expect(k[0].expired).toBe(0);
    expect(new Date(k[0].worked_date + 'T00:00:00Z').getUTCDay()).toBe(6);
    const expectedExpiry = new Date(Date.parse(k[0].worked_date + 'T00:00:00Z') + 90 * 86400000).toISOString().slice(0, 10);
    expect(k[0].expires_on).toBe(expectedExpiry);
    // Employee list only has own rows and also triggers detection on its own
    const e = await employee();
    const mine = await request(app).get('/api/compoff').set(auth(e));
    expect(mine.body.every((c: any) => c.employee_id === EMP)).toBe(true);
    expect(mine.body.length).toBe(1);
    const summary = await request(app).get('/api/compoff/summary').set(auth(e));
    expect(summary.body.counts.detected).toBe(1);
    expect(summary.body.criteria.full_day_minutes).toBe(480);
  });
  it('employee requests, unrelated users cannot approve, manager approves and the CO balance increases by 1', async () => {
    const e = await employee();
    const m = await manager();
    const t = await hr();
    const before = await coBalance(e);
    const credit = (await request(app).get('/api/compoff').set(auth(e))).body[0];
    // Only the employee (or HR) may request; a manager cannot request on the employee's behalf
    expect((await request(app).post(`/api/compoff/${credit.id}/request`).set(auth(m)).send({})).status).toBe(403);
    // Cannot review before it is requested
    expect((await request(app).post(`/api/compoff/${credit.id}/review`).set(auth(m)).send({ decision: 'approve' })).status).toBe(400);
    const req = await request(app).post(`/api/compoff/${credit.id}/request`).set(auth(e)).send({});
    expect(req.status).toBe(200);
    expect(req.body.status).toBe('pending');
    expect(req.body.approver_name).toBe('Meera Iyer');
    expect((await request(app).post(`/api/compoff/${credit.id}/request`).set(auth(e)).send({})).status).toBe(400);
    // Employees cannot review; a manager outside the chain cannot either
    expect((await request(app).post(`/api/compoff/${credit.id}/review`).set(auth(e)).send({ decision: 'approve' })).status).toBe(403);
    await request(app).post('/api/settings/users').set(auth(t)).send({ email: 'otherboss@acme.example', password: 'Password123!', role: 'manager', employee_id: 10 });
    const stranger = (await request(app).post('/api/auth/login').send({ email: 'otherboss@acme.example', password: 'Password123!' })).body.token;
    expect((await request(app).post(`/api/compoff/${credit.id}/review`).set(auth(stranger)).send({ decision: 'approve' })).status).toBe(403);
    expect((await request(app).get('/api/compoff/pending').set(auth(stranger))).body.length).toBe(0);
    // Pending queue for the manager, counts, then approval
    const pending = await request(app).get('/api/compoff/pending').set(auth(m));
    expect(pending.body.some((c: any) => c.id === credit.id)).toBe(true);
    expect((await request(app).get('/api/notifications/counts').set(auth(m))).body.counts.comp_off_approvals).toBeGreaterThanOrEqual(1);
    expect((await request(app).post(`/api/compoff/${credit.id}/review`).set(auth(m)).send({ decision: 'maybe' })).status).toBe(400);
    const appr = await request(app).post(`/api/compoff/${credit.id}/review`).set(auth(m)).send({ decision: 'approve', note: 'Thanks for the weekend' });
    expect(appr.status).toBe(200);
    expect(appr.body.status).toBe('approved');
    expect(appr.body.reviewer_name).toBe('Meera Iyer');
    expect(appr.body.reviewed_at).toBeTruthy();
    expect(appr.body.review_note).toBe('Thanks for the weekend');
    const after = await coBalance(e);
    expect(after.adjusted).toBe(before.adjusted + 1);
    expect(after.available).toBe(before.available + 1);
    // Re-detect does not resurrect an approved date
    expect((await request(app).post('/api/compoff/detect').set(auth(t))).body.created).toBe(0);
    expect((await request(app).post(`/api/compoff/${credit.id}/review`).set(auth(m)).send({ decision: 'approve' })).status).toBe(400);
  });
  it('manager can dismiss their own detected credit; HR can request on behalf and reject', async () => {
    const m = await manager();
    const t = await hr();
    const own = (await request(app).get('/api/compoff?employee_id=5&status=detected').set(auth(m))).body;
    expect(own.length).toBe(1);
    const dismissed = await request(app).post(`/api/compoff/${own[0].id}/dismiss`).set(auth(m)).send({});
    expect(dismissed.body.status).toBe('rejected');
    expect(dismissed.body.review_note).toBe('dismissed by employee');
    expect((await request(app).post('/api/compoff/detect').set(auth(t))).body.created).toBe(0);
    // Extra-hours criteria: lower the bar so every long weekday earns a half/full day, HR requests + rejects one
    await request(app).put('/api/settings/attendance').set(auth(t)).send({ standard_work_minutes: 300 });
    await request(app).put('/api/settings/leave').set(auth(t)).send({ comp_off: { enabled: true, leave_type_code: 'CO', on_weekly_off: true, on_holiday: true, extra_hours_threshold_minutes: 60, full_day_minutes: 480, half_day_minutes: 120, expiry_days: 90, requires_manager_approval: true } });
    const det = await request(app).post('/api/compoff/detect').set(auth(t));
    expect(det.body.created).toBeGreaterThan(0);
    const extra = (await request(app).get('/api/compoff?employee_id=11&status=detected').set(auth(t))).body;
    expect(extra.length).toBeGreaterThan(0);
    expect(extra[0].reason).toBe('extra_hours');
    expect(extra[0].days).toBe(0.5);
    const req = await request(app).post(`/api/compoff/${extra[0].id}/request`).set(auth(t)).send({});
    expect(req.body.status).toBe('pending');
    const rej = await request(app).post(`/api/compoff/${extra[0].id}/review`).set(auth(t)).send({ decision: 'reject', note: 'Not pre-approved' });
    expect(rej.body.status).toBe('rejected');
    expect(rej.body.reviewer_name).toBeTruthy();
    // No-approval mode credits straight away
    await request(app).put('/api/settings/leave').set(auth(t)).send({ comp_off: { enabled: true, leave_type_code: 'CO', on_weekly_off: true, on_holiday: true, extra_hours_threshold_minutes: 60, full_day_minutes: 480, half_day_minutes: 120, expiry_days: 90, requires_manager_approval: false } });
    const before = await coBalance(t, 11);
    const auto = await request(app).post(`/api/compoff/${extra[1].id}/request`).set(auth(t)).send({});
    expect(auto.body.status).toBe('approved');
    expect((await coBalance(t, 11)).adjusted).toBe(before.adjusted + 0.5);
    await request(app).put('/api/settings/attendance').set(auth(t)).send({ standard_work_minutes: 540 });
    await request(app).put('/api/settings/leave').set(auth(t)).send({ comp_off: { enabled: true, leave_type_code: 'CO', on_weekly_off: true, on_holiday: true, extra_hours_threshold_minutes: 0, full_day_minutes: 480, half_day_minutes: 240, expiry_days: 90, requires_manager_approval: true } });
  });
  it('expires detected and pending credits past their expiry date', async () => {
    const t = await hr();
    const rows = (await request(app).get('/api/compoff?employee_id=11&status=detected').set(auth(t))).body;
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const yesterday = addDaysUtil(companyToday(), -1);
    run('UPDATE comp_off_credits SET expires_on = ? WHERE id = ?', [yesterday, rows[0].id]);
    await request(app).post(`/api/compoff/${rows[1].id}/request`).set(auth(t)).send({});
    run('UPDATE comp_off_credits SET expires_on = ? WHERE id = ?', [yesterday, rows[1].id]);
    const listed = (await request(app).get('/api/compoff?employee_id=11').set(auth(t))).body;
    const a = listed.find((c: any) => c.id === rows[0].id), b = listed.find((c: any) => c.id === rows[1].id);
    expect(a.status).toBe('expired');
    expect(a.expired).toBe(1);
    expect(b.status).toBe('expired');
    expect((await request(app).post(`/api/compoff/${rows[0].id}/request`).set(auth(t)).send({})).status).toBe(400);
    expect((await request(app).post(`/api/compoff/${rows[1].id}/review`).set(auth(t)).send({ decision: 'approve' })).status).toBe(400);
    expect(get<any>('SELECT status FROM comp_off_credits WHERE id = ?', [rows[1].id])!.status).toBe('expired');
    expect((await request(app).get('/api/compoff/summary').set(auth(t))).body.counts.expired).toBeGreaterThanOrEqual(2);
  });
});
