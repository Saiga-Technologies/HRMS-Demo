import { describe, it, expect, afterAll } from 'vitest';
import { app, request, hr, manager, employee, auth, cleanup, login } from './helpers.js';

afterAll(cleanup);

describe('HR letters', () => {
  let letterId = 0;
  let employeeId = 0;

  it('creates the default templates lazily and lists placeholders', async () => {
    const t = await hr();
    const res = await request(app).get('/api/letters/templates').set(auth(t));
    expect(res.status).toBe(200);
    const codes = res.body.map((x: any) => x.code).sort();
    expect(codes).toEqual(['ADDRESS_PROOF', 'APPOINTMENT', 'EXPERIENCE', 'NOC', 'OFFER', 'RELIEVING', 'SALARY_CERT']);
    const exp = res.body.find((x: any) => x.code === 'EXPERIENCE');
    expect(exp.self_service).toBe(1);
    expect(exp.variables).toEqual(['purpose']);
    const ph = await request(app).get('/api/letters/placeholders').set(auth(t));
    expect(ph.body.map((p: any) => p.key)).toEqual(expect.arrayContaining(['employee.full_name', 'salary.gross', 'company.name', 'letter.ref', 'today']));
    // Employees only see self-service templates.
    const e = await employee();
    const mine = await request(app).get('/api/letters/templates').set(auth(e));
    expect(mine.body.every((x: any) => x.self_service === 1)).toBe(true);
    expect(mine.body.find((x: any) => x.code === 'OFFER')).toBeUndefined();
  });

  it('previews a template with placeholders resolved and reports missing ones', async () => {
    const t = await hr();
    const templates = (await request(app).get('/api/letters/templates').set(auth(t))).body;
    const salary = templates.find((x: any) => x.code === 'SALARY_CERT');
    const emp = (await request(app).get('/api/employees/directory/all').set(auth(t))).body.find((x: any) => x.employee_code === 'EMP0006');
    employeeId = emp.id;
    const res = await request(app).post(`/api/letters/templates/${salary.id}/preview`).set(auth(t)).send({ employee_id: employeeId, variables: {} });
    expect(res.status).toBe(200);
    expect(res.body.body_rendered).toContain('Karthik Raj');
    expect(res.body.body_rendered).toContain('EMP0006');
    expect(res.body.body_rendered).toMatch(/INR 55,000/);
    expect(res.body.missing).toEqual(['var.purpose']);
    expect(res.body.ref).toMatch(/^HR\/LET\/\d{4}\/\d{4}$/);
    const ok = await request(app).post(`/api/letters/templates/${salary.id}/preview`).set(auth(t)).send({ employee_id: employeeId, variables: { purpose: 'a home loan' } });
    expect(ok.body.missing).toEqual([]);
    expect(ok.body.body_rendered).toContain('a home loan');
  });

  it('employee requests an experience letter; HR approves and generates a PDF stored as a document', async () => {
    const e = await employee();
    const templates = (await request(app).get('/api/letters/templates').set(auth(e))).body;
    const exp = templates.find((x: any) => x.code === 'EXPERIENCE');
    const created = await request(app).post('/api/letters').set(auth(e)).send({ template_id: exp.id, reason: 'Visa application', variables: { purpose: 'visa processing' } });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('requested');
    expect(created.body.employee_name).toBe('Karthik Raj');
    expect(created.body.template_name).toBe('Experience certificate');
    expect(created.body.requested_by_name).toBe('Karthik Raj');
    letterId = created.body.id;

    // Employee cannot generate or approve.
    expect((await request(app).post(`/api/letters/${letterId}/generate`).set(auth(e))).status).toBe(403);
    expect((await request(app).post(`/api/letters/${letterId}/approve`).set(auth(e))).status).toBe(403);
    // Employee cannot request an HR-only template.
    const t = await hr();
    const offer = (await request(app).get('/api/letters/templates').set(auth(t))).body.find((x: any) => x.code === 'OFFER');
    expect((await request(app).post('/api/letters').set(auth(e)).send({ template_id: offer.id })).status).toBe(403);

    // HR sees it in the queue and the counts.
    const counts = (await request(app).get('/api/notifications/counts').set(auth(t))).body.counts;
    expect(counts.letter_requests).toBeGreaterThanOrEqual(1);
    const list = (await request(app).get('/api/letters?status=requested').set(auth(t))).body;
    expect(list.find((l: any) => l.id === letterId)).toBeTruthy();

    const gen = await request(app).post(`/api/letters/${letterId}/approve`).set(auth(t)).send({ generate: true });
    expect(gen.status).toBe(200);
    expect(gen.body.status).toBe('generated');
    expect(gen.body.body_rendered).toContain('Karthik Raj');
    expect(gen.body.body_rendered).toContain('visa processing');
    expect(gen.body.body_rendered).toContain('till date');
    expect(gen.body.approved_by_name).toBe('Sara Thomas');
    expect(gen.body.pdf_stored_name).toMatch(/^letter_[0-9a-f-]+\.pdf$/);
    expect(gen.body.document_id).toBeTruthy();
    expect(gen.body.missing).toEqual([]);

    // PDF is served inline to the owner and HR.
    const pdf = await request(app).get(`/api/letters/${letterId}/pdf`).set(auth(e)).buffer(true).parse((res, cb) => { const chunks: Buffer[] = []; res.on('data', (c: Buffer) => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks))); });
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect(Buffer.from(pdf.body).subarray(0, 4).toString()).toBe('%PDF');
    // Another employee cannot read it.
    const other = await login('anita.desai@acme.example');
    expect((await request(app).get(`/api/letters/${letterId}/pdf`).set(auth(other))).status).toBe(403);
    expect((await request(app).get(`/api/letters/${letterId}`).set(auth(other))).status).toBe(403);

    // A documents row exists for the employee and serves the same file.
    const docs = (await request(app).get(`/api/documents?employee_id=${employeeId}`).set(auth(t))).body.items;
    const doc = docs.find((d: any) => d.id === gen.body.document_id);
    expect(doc).toBeTruthy();
    expect(doc.title).toBe('Experience certificate');
    expect(doc.format).toBe('pdf');
    expect(doc.status).toBe('valid');
    expect(doc.document_type_id).toBeNull();
    const file = await request(app).get(`/api/documents/${doc.id}/file`).set(auth(e)).buffer(true).parse((res, cb) => { const chunks: Buffer[] = []; res.on('data', (c: Buffer) => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks))); });
    expect(file.status).toBe(200);
    expect(Buffer.from(file.body).subarray(0, 4).toString()).toBe('%PDF');

    // Employee sees it as generated; counts reflect it.
    const mine = (await request(app).get('/api/letters').set(auth(e))).body;
    expect(mine.find((l: any) => l.id === letterId).status).toBe('generated');
    const ec = (await request(app).get('/api/notifications/counts').set(auth(e))).body.counts;
    expect(ec.my_letters_ready).toBeGreaterThanOrEqual(1);
  });

  it('HR can generate directly for any employee, reject with a note, and see the summary', async () => {
    const t = await hr();
    const templates = (await request(app).get('/api/letters/templates').set(auth(t))).body;
    const noc = templates.find((x: any) => x.code === 'NOC');
    const direct = await request(app).post('/api/letters').set(auth(t)).send({ template_id: noc.id, employee_id: employeeId, variables: { purpose: 'pursuing a part-time course' } });
    expect(direct.status).toBe(201);
    expect(direct.body.status).toBe('approved');
    const gen = await request(app).post(`/api/letters/${direct.body.id}/generate`).set(auth(t)).send({});
    expect(gen.body.status).toBe('generated');
    expect(gen.body.body_rendered).toContain('pursuing a part-time course');

    const e = await employee();
    const addr = templates.find((x: any) => x.code === 'ADDRESS_PROOF');
    const req2 = await request(app).post('/api/letters').set(auth(e)).send({ template_id: addr.id, reason: 'Bank KYC' });
    const rej = await request(app).post(`/api/letters/${req2.body.id}/reject`).set(auth(t)).send({ note: 'Address missing in profile' });
    expect(rej.body.status).toBe('rejected');
    expect(rej.body.note).toBe('Address missing in profile');
    expect((await request(app).post(`/api/letters/${req2.body.id}/generate`).set(auth(t))).status).toBe(400);

    const summary = await request(app).get('/api/letters/summary').set(auth(t));
    expect(summary.status).toBe(200);
    expect(summary.body.by_status.generated).toBeGreaterThanOrEqual(2);
    expect(summary.body.by_status.rejected).toBeGreaterThanOrEqual(1);
    expect(summary.body.by_template.find((x: any) => x.code === 'EXPERIENCE').n).toBeGreaterThanOrEqual(1);
    expect((await request(app).get('/api/letters/summary').set(auth(e))).status).toBe(403);
  });

  it('HR manages templates (create, update, delete) and template variables are derived from the body', async () => {
    const t = await hr();
    const created = await request(app).post('/api/letters/templates').set(auth(t)).send({ name: 'Bonafide letter', code: 'bonafide', subject: 'Bonafide certificate', body: 'This certifies {{employee.full_name}} is employed since {{employee.join_date}} for {{var.purpose}} valid till {{var.valid_until}}.', self_service: true, requires_approval: false, category: 'general' });
    expect(created.status).toBe(201);
    expect(created.body.code).toBe('BONAFIDE');
    expect(created.body.variables).toEqual(['purpose', 'valid_until']);
    expect(created.body.requires_approval).toBe(0);
    // No approval needed: employee request goes straight to approved.
    const e = await employee();
    const req1 = await request(app).post('/api/letters').set(auth(e)).send({ template_id: created.body.id, variables: { purpose: 'passport', valid_until: '31 Dec' } });
    expect(req1.body.status).toBe('approved');
    const upd = await request(app).put(`/api/letters/templates/${created.body.id}`).set(auth(t)).send({ name: 'Bonafide certificate', active: 0 });
    expect(upd.body.name).toBe('Bonafide certificate');
    expect(upd.body.active).toBe(0);
    const del = await request(app).delete(`/api/letters/templates/${created.body.id}`).set(auth(t));
    expect(del.status).toBe(400); // open (approved, not generated) request uses it
    expect((await request(app).delete(`/api/letters/${req1.body.id}`).set(auth(t))).status).toBe(200);
    expect((await request(app).delete(`/api/letters/templates/${created.body.id}`).set(auth(t))).status).toBe(200);
    expect((await request(app).post('/api/letters/templates').set(auth(e)).send({ name: 'x', code: 'X', subject: 'x', body: 'x' })).status).toBe(403);
  });
});

describe('Performance reviews', () => {
  let cycleId = 0;
  let reviewId = 0;
  let activeCount = 0;

  it('seeds a closed cycle with completed reviews and an open cycle with pending reviews', async () => {
    const t = await hr();
    const cycles = (await request(app).get('/api/performance/cycles').set(auth(t))).body;
    expect(cycles.length).toBeGreaterThanOrEqual(2);
    const closed = cycles.find((c: any) => c.status === 'closed');
    const open = cycles.find((c: any) => c.status === 'open');
    expect(closed.name).toMatch(/^H1 \d{4}$/);
    expect(open.name).toMatch(/^H2 \d{4}$/);
    expect(closed.completed_count).toBe(closed.review_count);
    expect(closed.competencies).toHaveLength(6);
    const summary = (await request(app).get(`/api/performance/cycles/${closed.id}/summary`).set(auth(t))).body;
    expect(summary.completion_percent).toBe(100);
    expect(summary.average_rating).toBeGreaterThanOrEqual(3);
    expect(summary.average_rating).toBeLessThanOrEqual(5);
    expect(summary.distribution.reduce((s: number, d: any) => s + d.count, 0)).toBe(closed.review_count);
    expect(summary.competency_averages).toHaveLength(6);
    expect(summary.department_averages.length).toBeGreaterThan(1);
    // Close the seeded open cycle so the rest of the suite works with its own cycle.
    expect((await request(app).post(`/api/performance/cycles/${open.id}/close`).set(auth(t))).body.status).toBe('closed');
  });

  it('HR creates and opens a cycle, which creates a review for every active employee', async () => {
    const t = await hr();
    const bad = await request(app).post('/api/performance/cycles').set(auth(t)).send({ name: 'Bad', period_start: '2027-06-01', period_end: '2027-01-01' });
    expect(bad.status).toBe(400);
    const created = await request(app).post('/api/performance/cycles').set(auth(t)).send({ name: 'Annual 2027', period_start: '2027-01-01', period_end: '2027-12-31', due_date: '2028-01-15' });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('draft');
    expect(created.body.competencies.map((c: any) => c.key)).toEqual(['quality', 'productivity', 'communication', 'teamwork', 'initiative', 'reliability']);
    cycleId = created.body.id;
    const opened = await request(app).post(`/api/performance/cycles/${cycleId}/open`).set(auth(t));
    expect(opened.status).toBe(200);
    expect(opened.body.status).toBe('open');
    const emps = (await request(app).get('/api/employees/directory/all').set(auth(t))).body;
    activeCount = emps.length;
    expect(opened.body.created).toBe(activeCount);
    expect(opened.body.review_count).toBe(activeCount);
    const reviews = (await request(app).get(`/api/performance/reviews?cycle_id=${cycleId}`).set(auth(t))).body;
    expect(reviews).toHaveLength(activeCount);
    expect(reviews.every((r: any) => r.status === 'pending_self')).toBe(true);
    const karthik = reviews.find((r: any) => r.employee_code === 'EMP0006');
    expect(karthik.reviewer_name).toBe('Meera Iyer');
    expect(karthik.cycle_name).toBe('Annual 2027');
    expect(karthik.department_name).toBeTruthy();
    reviewId = karthik.id;
    // Re-opening is idempotent.
    expect((await request(app).post(`/api/performance/cycles/${cycleId}/open`).set(auth(t))).body.created).toBe(0);
    expect((await request(app).post('/api/performance/cycles').set(auth(await employee())).send({ name: 'x', period_start: '2027-01-01', period_end: '2027-12-31' })).status).toBe(403);
  });

  it('employee fills in and submits the self-assessment; unrelated employees are blocked', async () => {
    const e = await employee();
    const my = (await request(app).get('/api/performance/my').set(auth(e))).body;
    expect(my.current.id).toBe(reviewId);
    expect(my.current.status).toBe('pending_self');
    expect(my.history.length).toBeGreaterThanOrEqual(1);
    expect(my.history[0].final_rating).toBeGreaterThanOrEqual(3);
    // Save a draft.
    const draft = await request(app).put(`/api/performance/reviews/${reviewId}/self`).set(auth(e)).send({ self_ratings: { quality: 4 }, goals: [{ title: 'Ship v2', weight: 2, progress: 40, status: 'on_track', notes: '' }] });
    expect(draft.status).toBe(200);
    expect(draft.body.status).toBe('pending_self');
    expect(draft.body.goals[0].title).toBe('Ship v2');
    // Submitting with missing ratings fails.
    const incomplete = await request(app).put(`/api/performance/reviews/${reviewId}/self`).set(auth(e)).send({ submit: true });
    expect(incomplete.status).toBe(400);
    const ratings = { quality: 4, productivity: 4, communication: 3, teamwork: 5, initiative: 4, reliability: 5 };
    const sub = await request(app).put(`/api/performance/reviews/${reviewId}/self`).set(auth(e)).send({ self_ratings: ratings, self_comments: 'Good half.', submit: true });
    expect(sub.status).toBe(200);
    expect(sub.body.status).toBe('pending_manager');
    expect(sub.body.self_submitted_at).toBeTruthy();
    expect(sub.body.self_ratings).toEqual(ratings);
    // Locked after submit.
    expect((await request(app).put(`/api/performance/reviews/${reviewId}/self`).set(auth(e)).send({ self_comments: 'x' })).status).toBe(400);
    // Unrelated employee cannot see or edit the review.
    const other = await login('anita.desai@acme.example');
    expect((await request(app).get(`/api/performance/reviews/${reviewId}`).set(auth(other))).status).toBe(403);
    expect((await request(app).put(`/api/performance/reviews/${reviewId}/self`).set(auth(other)).send({ self_comments: 'x' })).status).toBe(403);
    expect((await request(app).put(`/api/performance/reviews/${reviewId}/manager`).set(auth(other)).send({ manager_ratings: ratings, submit: true })).status).toBe(403);
    // The employee cannot act as their own manager.
    expect((await request(app).put(`/api/performance/reviews/${reviewId}/manager`).set(auth(e)).send({ manager_ratings: ratings, submit: true })).status).toBe(403);
    // Manager's pending badge.
    const m = await manager();
    const counts = (await request(app).get('/api/notifications/counts').set(auth(m))).body.counts;
    expect(counts.reviews_pending_manager).toBeGreaterThanOrEqual(1);
    const list = (await request(app).get(`/api/performance/reviews?cycle_id=${cycleId}&status=pending_manager`).set(auth(m))).body;
    expect(list.find((r: any) => r.id === reviewId).can_review).toBe(true);
  });

  it('manager submits ratings; the final rating is the weighted average; employee acknowledges', async () => {
    const m = await manager();
    const ratings = { quality: 4, productivity: 5, communication: 3, teamwork: 4, initiative: 5, reliability: 4 };
    const res = await request(app).put(`/api/performance/reviews/${reviewId}/manager`).set(auth(m)).send({ manager_ratings: ratings, manager_comments: 'Strong half.', goals: [{ title: 'Ship v2', weight: 2, progress: 80, status: 'on_track' }], submit: true });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('completed');
    expect(res.body.final_rating).toBe(4.17); // (4+5+3+4+5+4)/6
    expect(res.body.completed_at).toBeTruthy();
    expect(res.body.goals[0].progress).toBe(80);
    // Manager cannot edit after acknowledge; employee acknowledges.
    const e = await employee();
    const ack = await request(app).post(`/api/performance/reviews/${reviewId}/acknowledge`).set(auth(e));
    expect(ack.body.status).toBe('acknowledged');
    expect((await request(app).put(`/api/performance/reviews/${reviewId}/manager`).set(auth(m)).send({ manager_comments: 'x' })).status).toBe(400);
    // Explicit final rating override for another report (HR).
    const t = await hr();
    const reviews = (await request(app).get(`/api/performance/reviews?cycle_id=${cycleId}`).set(auth(t))).body;
    const anita = reviews.find((r: any) => r.employee_code === 'EMP0007');
    const hrSub = await request(app).put(`/api/performance/reviews/${anita.id}/manager`).set(auth(t)).send({ manager_ratings: { quality: 3, productivity: 3, communication: 3, teamwork: 3, initiative: 3, reliability: 3 }, final_rating: 3.5, submit: true });
    expect(hrSub.status).toBe(200);
    expect(hrSub.body.final_rating).toBe(3.5);
    const my = (await request(app).get('/api/performance/my').set(auth(e))).body;
    expect(my.history.map((h: any) => h.cycle_name)).toContain('Annual 2027');
  });

  it('summary numbers, CSV export and closing the cycle', async () => {
    const t = await hr();
    const summary = (await request(app).get(`/api/performance/cycles/${cycleId}/summary`).set(auth(t))).body;
    expect(summary.total).toBe(activeCount);
    expect(summary.completed).toBe(2);
    expect(summary.completion_percent).toBe(Math.round((2 / activeCount) * 100));
    expect(summary.by_status.acknowledged).toBe(1);
    expect(summary.by_status.completed).toBe(1);
    expect(summary.distribution.find((d: any) => d.rating === 4).count).toBe(2); // 4.17 and 3.5 both round to 4
    expect(summary.competency_averages.find((c: any) => c.key === 'productivity').average).toBe(4); // (5+3)/2
    expect(summary.department_averages.find((d: any) => d.department === 'Platform').average).toBe(3.84); // (4.17+3.5)/2
    expect(summary.top_performers[0].employee_name).toBe('Karthik Raj');
    expect((await request(app).get(`/api/performance/cycles/${cycleId}/summary`).set(auth(await employee()))).status).toBe(403);

    const csv = await request(app).get(`/api/performance/cycles/${cycleId}/export.csv`).set(auth(t));
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    const lines = csv.text.trim().split('\n');
    expect(lines).toHaveLength(activeCount + 1);
    expect(lines[0]).toContain('Quality of work (self)');
    expect(lines[0]).toContain('Final rating');
    expect(lines.find((l) => l.startsWith('EMP0006'))).toContain('4.17');

    const closed = await request(app).post(`/api/performance/cycles/${cycleId}/close`).set(auth(t));
    expect(closed.body.status).toBe('closed');
    expect((await request(app).post(`/api/performance/cycles/${cycleId}/close`).set(auth(t))).status).toBe(400);
    expect((await request(app).post(`/api/performance/cycles/${cycleId}/open`).set(auth(t))).status).toBe(400);
  });
});
