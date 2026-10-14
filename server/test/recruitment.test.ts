import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { app, request, hr, manager, employee, auth, cleanup, sampleFile } from './helpers.js';
import { parseCv, scoreCv } from '../src/cvparser.js';

afterAll(cleanup);

const here = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE_CV = fs.readFileSync(path.join(here, '..', '..', 'e2e', 'fixtures', 'cv-sample.txt'), 'utf8');

async function seVacancy(token: string) {
  const vacs = (await request(app).get('/api/recruitment/vacancies').set(auth(token))).body;
  return vacs.find((v: any) => v.title === 'Software Engineer (Platform)');
}

describe('cv parser', () => {
  it('extracts contact, experience, education, skills and summary from the sample CV', () => {
    const p = parseCv(SAMPLE_CV);
    expect(p.emails).toEqual(['riya.banerjee@example.com']);
    expect(p.phones[0]).toMatch(/98201/);
    expect(p.experience_years).toBe(6);
    expect(p.education).toContain('B.Tech');
    expect(p.skills).toEqual(expect.arrayContaining(['TypeScript', 'Node.js', 'SQL', 'AWS', 'Docker']));
    expect(p.name_guess).toEqual({ first_name: 'Riya', last_name: 'Banerjee' });
    expect(p.title).toMatch(/Senior Backend Developer/);
    expect(p.summary).toMatch(/^Backend developer with 6 years/);
  });
  it('sums dated work ranges when no explicit statement exists and ignores education ranges', () => {
    const p = parseCv('John Doe\njohn@x.com\n\nExperience\nDeveloper, Acme (2019 - 2022)\nSenior Developer, Beta (Jan 2022 - Present)\n\nEducation\nB.Sc Computer Science, Some University (2015 - 2018)');
    expect(p.experience_years).toBe(new Date().getFullYear() - 2019);
    expect(p.education).toContain('BSc');
  });
  it('scores deterministically with synonyms and an explainable breakdown', () => {
    const jd = { id: 1, title: 'SE', skills: ['JavaScript', 'PostgreSQL', 'Kubernetes'], requirements: ['3+ years'], experience_min: 2, experience_max: 5 };
    const text = 'Jane Roe\njane@x.com\nI have 4 years of experience with js, node and postgres. k8s in production.';
    const p = parseCv(text);
    const a = scoreCv(p, text, jd);
    const b = scoreCv(p, text, jd);
    expect(a).toEqual(b);
    expect(a.breakdown.skills.matched).toEqual(['JavaScript', 'PostgreSQL', 'Kubernetes']);
    expect(a.breakdown.skills.partial.map((x) => x.skill)).toEqual(expect.arrayContaining(['JavaScript', 'PostgreSQL', 'Kubernetes']));
    expect(a.breakdown.experience.points).toBe(20);
    expect(a.breakdown.requirements.covered).toEqual(['3+ years']);
    expect(a.breakdown.education.points).toBe(0);
    expect(a.score).toBeGreaterThanOrEqual(80);
  });
});

describe('recruitment API', () => {
  let candidateId = 0;
  let weakId = 0;

  it('seeds a CV pool with scores and funnel counts', async () => {
    const t = await hr();
    const summary = await request(app).get('/api/recruitment/summary').set(auth(t));
    expect(summary.status).toBe(200);
    expect(summary.body.total).toBeGreaterThanOrEqual(6);
    expect(summary.body.stages.new).toBeGreaterThanOrEqual(2);
    expect(summary.body.by_vacancy.length).toBeGreaterThanOrEqual(2);
    const vac = await seVacancy(t);
    expect(vac.candidates).toBeGreaterThanOrEqual(5);
    expect(vac.stages.offer).toBe(1);
    expect(vac.hired_count).toBe(0);
    const list = await request(app).get('/api/recruitment/candidates?vacancy_id=' + vac.id + '&sort=score').set(auth(t));
    expect(list.body.items[0].score).toBeGreaterThanOrEqual(list.body.items[1].score);
    expect(list.body.items[0].vacancy_title).toBe('Software Engineer (Platform)');
    expect(list.body.items[0].cv_text).toBeUndefined();
    const weak = list.body.items.find((c: any) => c.first_name === 'Dev');
    expect(weak.score).toBeLessThan(40);
  });

  it('uploads a TXT CV, parses it and scores it against the vacancy JD (≥ 60)', async () => {
    const t = await hr();
    const vac = await seVacancy(t);
    const res = await request(app).post('/api/recruitment/candidates').set(auth(t))
      .field('vacancy_id', String(vac.id)).field('source', 'Job board')
      .attach('cv', Buffer.from(SAMPLE_CV), { filename: 'cv-sample.txt', contentType: 'text/plain' });
    expect(res.status).toBe(201);
    candidateId = res.body.id;
    // name/contact derived from the CV
    expect(res.body.first_name).toBe('Riya');
    expect(res.body.last_name).toBe('Banerjee');
    expect(res.body.email).toBe('riya.banerjee@example.com');
    expect(res.body.position_id).toBe(vac.position_id);
    expect(res.body.stage).toBe('new');
    expect(res.body.parsed.experience_years).toBe(6);
    expect(res.body.parsed.education).toContain('B.Tech');
    expect(res.body.parsed.skills).toEqual(expect.arrayContaining(['TypeScript', 'Node.js', 'SQL', 'AWS']));
    expect(res.body.score).toBeGreaterThanOrEqual(60);
    const b = res.body.score_breakdown;
    expect(b.jd_title).toBe('Software Engineer');
    expect(b.skills.matched).toEqual(expect.arrayContaining(['TypeScript', 'Node.js', 'SQL', 'AWS']));
    expect(b.skills.missing).toEqual([]);
    expect(b.skills.points + b.requirements.points + b.experience.points + b.education.points + b.extras.points).toBeCloseTo(res.body.score, 0);
    expect(res.body.events.some((e: any) => e.type === 'score')).toBe(true);
    const file = await request(app).get(`/api/recruitment/candidates/${candidateId}/cv`).set(auth(t));
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toMatch(/text\/plain/);
  });

  it('a weak CV scores lower and manual JSON entry works without a file', async () => {
    const t = await hr();
    const vac = await seVacancy(t);
    const res = await request(app).post('/api/recruitment/candidates').set(auth(t)).send({
      first_name: 'Tanya', last_name: 'Joshi', email: 'tanya@example.com', vacancy_id: vac.id, source: 'Walk-in',
      cv_text: 'Tanya Joshi\nRetail Sales Associate\n1 year of experience in retail sales. Skills: communication, Excel.',
    });
    expect(res.status).toBe(201);
    weakId = res.body.id;
    expect(res.body.score).toBeLessThan(40);
    expect(res.body.score_breakdown.skills.missing).toEqual(expect.arrayContaining(['TypeScript', 'Node.js']));
    const strong = (await request(app).get(`/api/recruitment/candidates/${candidateId}`).set(auth(t))).body;
    expect(strong.score).toBeGreaterThan(res.body.score);
    // without any name and without a CV → 400
    expect((await request(app).post('/api/recruitment/candidates').set(auth(t)).send({ vacancy_id: vac.id })).status).toBe(400);
  });

  it('parses a PDF built with sampleFile and a DOCX built with jszip; rejects bad files', async () => {
    const t = await hr();
    const vac = await seVacancy(t);
    const pdf = await request(app).post('/api/recruitment/candidates').set(auth(t)).field('vacancy_id', String(vac.id))
      .attach('cv', sampleFile('pdf', 'Meera Pdf\nmeera.pdf@example.com\n4 years of experience with TypeScript, Node.js, SQL and AWS.\nB.Tech Computer Science'), { filename: 'meera.pdf', contentType: 'application/pdf' });
    expect(pdf.status).toBe(201);
    expect(pdf.body.first_name).toBe('Meera');
    expect(pdf.body.parsed.experience_years).toBe(4);
    expect(pdf.body.parsed.skills).toEqual(expect.arrayContaining(['TypeScript', 'Node.js', 'SQL', 'AWS']));
    expect(pdf.body.score).toBeGreaterThanOrEqual(60);
    const zip = new JSZip();
    zip.file('word/document.xml', '<w:document><w:body><w:p><w:r><w:t>Arun Docx</w:t></w:r></w:p><w:p><w:r><w:t>arun.docx@example.com</w:t></w:r></w:p><w:p><w:r><w:t>3 years of experience with Node.js and PostgreSQL on AWS. MSc Computer Science.</w:t></w:r></w:p></w:body></w:document>');
    const docx = await request(app).post('/api/recruitment/candidates').set(auth(t)).field('vacancy_id', String(vac.id))
      .attach('cv', await zip.generateAsync({ type: 'nodebuffer' }), { filename: 'arun.docx', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    expect(docx.status).toBe(201);
    expect(docx.body.first_name).toBe('Arun');
    expect(docx.body.parsed.experience_years).toBe(3);
    expect(docx.body.parsed.education).toContain('MSc');
    expect(docx.body.score_breakdown.skills.partial.some((p: any) => p.skill === 'SQL')).toBe(true);
    // disguised content / wrong extension
    expect((await request(app).post('/api/recruitment/candidates').set(auth(t)).attach('cv', Buffer.from('not a pdf'), { filename: 'x.pdf', contentType: 'application/pdf' })).status).toBe(400);
    expect((await request(app).post('/api/recruitment/candidates').set(auth(t)).attach('cv', sampleFile('png'), { filename: 'x.png', contentType: 'image/png' })).status).toBe(400);
  });

  it('stage changes create events, interviews auto-advance, rating is validated and rescore works', async () => {
    const t = await manager();
    const up = await request(app).put(`/api/recruitment/candidates/${candidateId}`).set(auth(t)).send({ stage: 'screening', rating: 4 });
    expect(up.status).toBe(200);
    expect(up.body.stage).toBe('screening');
    expect(up.body.rating).toBe(4);
    const ev = up.body.events.find((e: any) => e.type === 'stage_change');
    expect(ev.data).toEqual({ from: 'new', to: 'screening' });
    expect((await request(app).put(`/api/recruitment/candidates/${candidateId}`).set(auth(t)).send({ rating: 9 })).status).toBe(400);
    expect((await request(app).put(`/api/recruitment/candidates/${candidateId}`).set(auth(t)).send({ stage: 'hired' })).status).toBe(400);
    const iv = await request(app).post(`/api/recruitment/candidates/${candidateId}/events`).set(auth(t)).send({ type: 'interview', note: 'Round 1', data: { date: '2026-11-01', interviewer: 'Meera Iyer' } });
    expect(iv.status).toBe(201);
    expect(iv.body.stage).toBe('interview');
    expect(iv.body.events[0].type).toBe('stage_change');
    expect(iv.body.events.some((e: any) => e.type === 'interview' && e.data.interviewer === 'Meera Iyer')).toBe(true);
    const note = await request(app).post(`/api/recruitment/candidates/${candidateId}/events`).set(auth(t)).send({ type: 'note', note: 'Great fit' });
    expect(note.status).toBe(201);
    // rescore against the Senior SE JD (needs 5+ years: Riya has 6 → fits)
    const jds = (await request(app).get('/api/jobs/descriptions?status=published').set(auth(t))).body;
    const senior = jds.find((j: any) => j.title === 'Senior Software Engineer');
    const rs = await request(app).post(`/api/recruitment/candidates/${candidateId}/rescore`).set(auth(t)).send({ job_description_id: senior.id });
    expect(rs.status).toBe(200);
    expect(rs.body.score_breakdown.jd_title).toBe('Senior Software Engineer');
    expect(rs.body.score_breakdown.experience.points).toBe(20);
    expect(rs.body.events[0].type).toBe('score');
    const hrT = await hr();
    const vac = await seVacancy(hrT);
    const all = await request(app).post(`/api/recruitment/vacancies/${vac.id}/rescore-all`).set(auth(hrT));
    expect(all.status).toBe(200);
    expect(all.body.scored).toBeGreaterThanOrEqual(5);
    const back = (await request(app).get(`/api/recruitment/candidates/${candidateId}`).set(auth(hrT))).body;
    expect(back.score_breakdown.jd_title).toBe('Software Engineer');
    expect(back.jd.id).toBe(vac.job_description_id);
  });

  it('hire creates the employee with login, pre-completed journey, CV document, vacancy count and hired candidate', async () => {
    const t = await hr();
    const vac = await seVacancy(t);
    // Use the PDF candidate so the CV is copied into documents.
    const list = (await request(app).get(`/api/recruitment/candidates?vacancy_id=${vac.id}&q=Meera`).set(auth(t))).body.items;
    const meera = list.find((c: any) => c.first_name === 'Meera');
    await request(app).put(`/api/recruitment/candidates/${meera.id}`).set(auth(t)).send({ stage: 'interview' });
    await request(app).put(`/api/recruitment/candidates/${meera.id}`).set(auth(t)).send({ stage: 'offer' });
    const defaults = await request(app).get(`/api/recruitment/candidates/${meera.id}/hire-defaults`).set(auth(t));
    expect(defaults.status).toBe(200);
    expect(defaults.body.position_id).toBe(vac.position_id);
    expect(defaults.body.department_id).toBe(vac.department_id);
    expect(defaults.body.employee_code).toMatch(/^EMP\d{4}$/);
    expect(defaults.body.create_login).toBe(true);
    // employee role cannot hire
    expect((await request(app).post(`/api/recruitment/candidates/${meera.id}/hire`).set(auth(await manager())).send({})).status).toBe(403);
    const hired = await request(app).post(`/api/recruitment/candidates/${meera.id}/hire`).set(auth(t)).send({ ...defaults.body, employee_code: '', join_date: '2026-11-02', manager_id: 5, salary_basic: 60000 });
    expect(hired.status).toBe(201);
    expect(hired.body.employee_code).toMatch(/^EMP\d{4}$/);
    expect(hired.body.email).toBe('meera.pdf@example.com');
    expect(hired.body.candidate_id).toBe(meera.id);
    expect(hired.body.vacancy_id).toBe(vac.id);
    expect(hired.body.status).toBe('onboarding');
    expect(hired.body.temporary_password).toMatch(/^Welcome-[0-9a-f]{4}!$/);
    expect(hired.body.candidate.stage).toBe('hired');
    expect(hired.body.candidate.hired_employee_id).toBe(hired.body.id);
    expect(hired.body.vacancy.hired_count).toBe(1);
    expect(hired.body.vacancy.status).toBe('open'); // 2 openings
    expect(hired.body.journey.completed).toEqual(['Vacancy raised', 'Requisition approval', 'Budget & accounting sign-off', 'Job description finalised', 'Publishing', 'Sourcing & screening', 'Interviews', 'Offer']);
    expect(hired.body.journey.in_progress).toBe('Document collection');
    // login works with the temporary password
    const login = await request(app).post('/api/auth/login').send({ email: 'meera.pdf@example.com', password: hired.body.temporary_password });
    expect(login.status).toBe(200);
    expect(login.body.user.must_change_password).toBe(1);
    // journey stages
    const j = await request(app).get(`/api/journey/employee/${hired.body.id}`).set(auth(t));
    const byName = Object.fromEntries(j.body.stages.map((s: any) => [s.name, s]));
    expect(byName['Offer'].status).toBe('completed');
    expect(byName['Interviews'].completed_at).toBeTruthy();
    expect(byName['Document collection'].status).toBe('in_progress');
    expect(byName['Onboarding'].status).toBe('pending');
    expect(j.body.summary.completed).toBe(8);
    // CV copied into documents + salary structure
    const emp = await request(app).get(`/api/employees/${hired.body.id}`).set(auth(t));
    expect(emp.body.documents.some((d: any) => d.title === 'CV (from recruitment)' && d.format === 'pdf')).toBe(true);
    expect(emp.body.vacancy_title).toBe('Software Engineer (Platform)');
    const sal = await request(app).get(`/api/payroll/structures/${hired.body.id}`).set(auth(t));
    expect(sal.body.current?.basic).toBe(60000);
    // cannot hire twice; cannot move a hired candidate back
    expect((await request(app).post(`/api/recruitment/candidates/${meera.id}/hire`).set(auth(t)).send({})).status).toBe(400);
    expect((await request(app).put(`/api/recruitment/candidates/${meera.id}`).set(auth(t)).send({ stage: 'offer' })).status).toBe(400);
    // vacancy with 1 opening auto-closes as filled
    const vacs = (await request(app).get('/api/recruitment/vacancies').set(auth(t))).body;
    const ae = vacs.find((v: any) => v.title === 'Account Executive');
    const farhan = (await request(app).get(`/api/recruitment/candidates?vacancy_id=${ae.id}`).set(auth(t))).body.items[0];
    const h2 = await request(app).post(`/api/recruitment/candidates/${farhan.id}/hire`).set(auth(t)).send({ create_login: false });
    expect(h2.status).toBe(201);
    expect(h2.body.temporary_password).toBeUndefined();
    expect(h2.body.vacancy.status).toBe('filled');
    expect(h2.body.vacancy.hired_count).toBe(1);
    const counts = await request(app).get('/api/notifications/counts').set(auth(t));
    expect(counts.body.counts.candidates_new).toBeGreaterThanOrEqual(1);
  });

  it('enforces roles: employees get 403, managers cannot delete, HR can', async () => {
    const e = await employee();
    expect((await request(app).get('/api/recruitment/candidates').set(auth(e))).status).toBe(403);
    expect((await request(app).get('/api/recruitment/summary').set(auth(e))).status).toBe(403);
    expect((await request(app).post('/api/recruitment/candidates').set(auth(e)).send({ first_name: 'X' })).status).toBe(403);
    expect((await request(app).get(`/api/recruitment/candidates/${candidateId}/cv`).set(auth(e))).status).toBe(403);
    expect((await request(app).get('/api/recruitment/candidates')).status).toBe(401);
    const m = await manager();
    expect((await request(app).get('/api/recruitment/candidates').set(auth(m))).status).toBe(200);
    expect((await request(app).delete(`/api/recruitment/candidates/${weakId}`).set(auth(m))).status).toBe(403);
    const t = await hr();
    expect((await request(app).delete(`/api/recruitment/candidates/${weakId}`).set(auth(t))).status).toBe(200);
    expect((await request(app).get(`/api/recruitment/candidates/${weakId}`).set(auth(t))).status).toBe(404);
  });

  it('POST /api/employees generates a readable temporary password when none is given', async () => {
    const t = await hr();
    const res = await request(app).post('/api/employees').set(auth(t)).send({ first_name: 'Auto', last_name: 'Pass', email: 'auto.pass@acme.example', create_login: true });
    expect(res.status).toBe(201);
    expect(res.body.temporary_password).toMatch(/^Welcome-[0-9a-f]{4}!$/);
    expect(res.body.employee_code).toMatch(/^EMP\d{4}$/);
  });
});
