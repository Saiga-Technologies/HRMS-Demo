import { Router, type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { all, get, insert, update, run, parseJson, parseJsonAll, transaction, getSetting, UPLOAD_DIR } from '../db.js';
import { requireHr, requireRole } from '../auth.js';
import { wrap, badRequest, notFound, pick, audit, toInt, toNum, nowIso, today, assertDate } from '../util.js';
import { extractText, parseCv, scoreCv, type CvFormat, type ParsedCv } from '../cvparser.js';
import { createEmployeeRecord, nextEmployeeCode, empQuery, EMP_COLS } from './employees.js';
import { DEFAULT_COMPANY } from './settings.js';

/**
 * Recruitment: CV pool → parsing → ATS-style scoring → pipeline → hire (creates the employee and
 * pre-completes the journey stages up to "Offer"). HR and managers can read and move candidates;
 * only HR can delete or hire.
 */
const r = Router();
const requireRecruiter = requireRole('manager');

export const STAGES = ['new', 'screening', 'interview', 'offer', 'hired', 'rejected', 'withdrawn'] as const;
const CAND_COLS = ['first_name', 'last_name', 'email', 'phone', 'source', 'vacancy_id', 'position_id', 'expected_salary', 'notice_days', 'notes', 'rating', 'stage'];
const JSON_COLS = ['parsed', 'score_breakdown'];

const MIME: Record<CvFormat, string[]> = {
  pdf: ['application/pdf'],
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/octet-stream', 'application/zip'],
  txt: ['text/plain', 'application/octet-stream'],
};
const MAGIC: Record<CvFormat, (b: Buffer) => boolean> = {
  pdf: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-',
  docx: (b) => b[0] === 0x50 && b[1] === 0x4b, // PK zip
  txt: (b) => !b.subarray(0, 512).includes(0), // no NUL bytes
};
export function cvFormatOf(name: string): CvFormat | null {
  const ext = path.extname(name).toLowerCase().replace('.', '');
  return ext === 'pdf' || ext === 'docx' || ext === 'txt' ? ext : null;
}

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => cb(null, `cv_${crypto.randomUUID()}.${cvFormatOf(file.originalname) || 'bin'}`),
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const fmt = cvFormatOf(file.originalname);
    if (!fmt) return cb(Object.assign(new Error('CV must be a PDF, DOCX or TXT file'), { status: 400 }));
    if (!MIME[fmt].includes(file.mimetype)) return cb(Object.assign(new Error('File content type does not match its extension'), { status: 400 }));
    cb(null, true);
  },
});

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */
const candQuery = `
  SELECT c.*, v.title AS vacancy_title, v.status AS vacancy_status, v.job_description_id AS vacancy_jd_id, p.title AS position_title,
         d.name AS department_name, e.employee_code AS hired_employee_code,
         (SELECT COUNT(*) FROM candidate_events ev WHERE ev.candidate_id = c.id AND ev.type = 'interview') AS interviews
  FROM candidates c
  LEFT JOIN vacancies v ON v.id = c.vacancy_id
  LEFT JOIN positions p ON p.id = COALESCE(c.position_id, v.position_id)
  LEFT JOIN departments d ON d.id = COALESCE(v.department_id, p.department_id)
  LEFT JOIN employees e ON e.id = c.hired_employee_id`;

function loadCandidate(id: number) {
  const row = parseJson(get<any>(`${candQuery} WHERE c.id = ?`, [id]), JSON_COLS);
  if (!row) throw notFound('Candidate not found');
  return row;
}
function events(candidateId: number) {
  return parseJsonAll(all<any>('SELECT ev.*, u.email AS by_email FROM candidate_events ev LEFT JOIN users u ON u.id = ev.by_user WHERE ev.candidate_id = ? ORDER BY ev.created_at DESC, ev.id DESC', [candidateId]), ['data']);
}
function addEvent(candidateId: number, type: string, note: string | null, data: any, byUser: number | null) {
  return insert('candidate_events', { candidate_id: candidateId, type, note, data: data ? JSON.stringify(data) : null, by_user: byUser, created_at: nowIso() });
}

/** Skills of every published JD feed the parser's dictionary so domain terms are recognised. */
function extraSkills(): string[] {
  const out: string[] = [];
  for (const row of all<any>("SELECT skills FROM job_descriptions WHERE status = 'published'")) {
    try { out.push(...(JSON.parse(row.skills || '[]') as string[])); } catch { /* ignore */ }
  }
  return out;
}
/** Resolve the JD to score against: explicit id → vacancy's JD → position's latest published JD. */
function resolveJd(opts: { job_description_id?: number | null; vacancy_id?: number | null; position_id?: number | null }) {
  let jd: any = null;
  if (opts.job_description_id) jd = get<any>('SELECT * FROM job_descriptions WHERE id = ?', [opts.job_description_id]);
  if (!jd && opts.vacancy_id) {
    const v = get<any>('SELECT job_description_id, position_id FROM vacancies WHERE id = ?', [opts.vacancy_id]);
    if (v?.job_description_id) jd = get<any>('SELECT * FROM job_descriptions WHERE id = ?', [v.job_description_id]);
    if (!jd && v?.position_id && !opts.position_id) opts.position_id = v.position_id;
  }
  if (!jd && opts.position_id) jd = get<any>("SELECT * FROM job_descriptions WHERE position_id = ? AND status = 'published' ORDER BY updated_at DESC, id DESC LIMIT 1", [opts.position_id]);
  return jd ? parseJson(jd, ['skills', 'requirements', 'responsibilities']) : null;
}
/** Parse + score a candidate row in place; returns the parsed data and score. */
function analyse(cand: any, jdOverride?: { job_description_id?: number | null; vacancy_id?: number | null }) {
  const text = cand.cv_text || '';
  const parsed: ParsedCv = parseCv(text, extraSkills());
  const jd = resolveJd({ job_description_id: jdOverride?.job_description_id ?? null, vacancy_id: jdOverride?.vacancy_id ?? cand.vacancy_id, position_id: cand.position_id });
  let score: number | null = null;
  let breakdown: any = { jd_id: null, jd_title: null, note: text ? 'No job description to score against. Link the vacancy to a published JD and rescore.' : 'No CV text to score.' };
  if (jd && text) {
    const s = scoreCv(parsed, text, jd);
    score = s.score;
    breakdown = s.breakdown;
  }
  return { parsed, score, breakdown, jd };
}

function stageCounts(rows: { stage: string; n: number }[]) {
  const out: Record<string, number> = {};
  for (const s of STAGES) out[s] = 0;
  for (const row of rows) out[row.stage] = (out[row.stage] || 0) + row.n;
  return out;
}

/* ------------------------------------------------------------------ */
/* Overview                                                            */
/* ------------------------------------------------------------------ */
r.get('/summary', requireRecruiter, (_req, res) => {
  const stages = stageCounts(all<any>('SELECT stage, COUNT(*) AS n FROM candidates GROUP BY stage'));
  const perVacancy = all<any>(`SELECT v.id AS vacancy_id, v.title, v.status, v.openings, v.hired_count, c.stage, COUNT(c.id) AS n
                               FROM vacancies v LEFT JOIN candidates c ON c.vacancy_id = v.id GROUP BY v.id, c.stage ORDER BY v.created_at DESC`);
  const byVacancy: any[] = [];
  for (const row of perVacancy) {
    let v = byVacancy.find((x) => x.vacancy_id === row.vacancy_id);
    if (!v) { v = { vacancy_id: row.vacancy_id, title: row.title, status: row.status, openings: row.openings, hired_count: row.hired_count, stages: stageCounts([]), total: 0 }; byVacancy.push(v); }
    if (row.stage) { v.stages[row.stage] = row.n; v.total += row.n; }
  }
  const avg = get<any>('SELECT AVG(score) AS avg, COUNT(*) AS n FROM candidates WHERE score IS NOT NULL');
  res.json({ stages, total: Object.values(stages).reduce((a, b) => a + b, 0), unassigned: get<any>('SELECT COUNT(*) AS n FROM candidates WHERE vacancy_id IS NULL')?.n ?? 0, avg_score: avg?.avg != null ? Math.round(avg.avg) : null, scored: avg?.n ?? 0, by_vacancy: byVacancy });
});

r.get('/vacancies', requireRecruiter, (req, res) => {
  const where = req.query.status ? ' WHERE v.status = ?' : req.query.all === '1' ? '' : " WHERE v.status IN ('open','on_hold','filled')";
  const rows = all<any>(`SELECT v.*, p.title AS position_title, d.name AS department_name, j.title AS jd_title, j.status AS jd_status,
                                (SELECT COUNT(*) FROM candidates c WHERE c.vacancy_id = v.id) AS candidates,
                                (SELECT ROUND(AVG(c.score)) FROM candidates c WHERE c.vacancy_id = v.id AND c.score IS NOT NULL) AS avg_score,
                                (SELECT MAX(c.score) FROM candidates c WHERE c.vacancy_id = v.id) AS top_score
                         FROM vacancies v LEFT JOIN positions p ON p.id = v.position_id LEFT JOIN departments d ON d.id = v.department_id
                         LEFT JOIN job_descriptions j ON j.id = v.job_description_id${where}
                         ORDER BY CASE v.status WHEN 'open' THEN 0 WHEN 'on_hold' THEN 1 ELSE 2 END, v.created_at DESC`, req.query.status ? [req.query.status] : []);
  const counts = all<any>('SELECT vacancy_id, stage, COUNT(*) AS n FROM candidates WHERE vacancy_id IS NOT NULL GROUP BY vacancy_id, stage');
  for (const v of rows) v.stages = stageCounts(counts.filter((c) => c.vacancy_id === v.id));
  res.json(rows);
});

/* ------------------------------------------------------------------ */
/* Candidates                                                          */
/* ------------------------------------------------------------------ */
r.get('/candidates', requireRecruiter, (req, res) => {
  const where: string[] = [];
  const params: any[] = [];
  if (req.query.vacancy_id) { where.push('c.vacancy_id = ?'); params.push(toInt(req.query.vacancy_id)); }
  if (req.query.stage) {
    const stages = String(req.query.stage).split(',').filter((s) => (STAGES as readonly string[]).includes(s));
    if (stages.length) { where.push(`c.stage IN (${stages.map(() => '?').join(',')})`); params.push(...stages); }
  }
  if (req.query.min_score) { where.push('c.score >= ?'); params.push(toNum(req.query.min_score)); }
  const q = String(req.query.q || '').trim();
  if (q) { where.push('(c.first_name LIKE ? OR c.last_name LIKE ? OR c.email LIKE ? OR c.parsed LIKE ? OR c.source LIKE ? OR v.title LIKE ?)'); params.push(...Array(6).fill(`%${q}%`)); }
  const order = req.query.sort === 'score' ? 'c.score IS NULL, c.score DESC, c.created_at DESC' : 'c.created_at DESC';
  const rows = parseJsonAll(all<any>(`${candQuery}${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY ${order}`, params), JSON_COLS);
  for (const row of rows) delete row.cv_text; // keep the list light; the detail endpoint has the text
  res.json({ items: rows, total: rows.length });
});

/** Create a candidate: multipart (field `cv`) or plain JSON (manual entry, optional `cv_text`). */
r.post('/candidates', requireRecruiter, (req, res, next) => {
  if (!req.is('multipart/form-data')) return createCandidate(req, res, next);
  upload.single('cv')(req, res, (err: any) => {
    if (err) return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : err.status || 400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'CV exceeds the 10 MB limit' : err.message });
    createCandidate(req, res, next);
  });
});
async function createCandidate(req: Request, res: Response, next: NextFunction) {
  const file = req.file;
  const cleanup = () => { if (file) fs.rm(file.path, { force: true }, () => {}); };
  try {
    const body: any = req.body || {};
    let cvText: string = typeof body.cv_text === 'string' ? body.cv_text : '';
    let fmt: CvFormat | null = null;
    if (file) {
      fmt = cvFormatOf(file.originalname);
      if (!fmt) throw badRequest('CV must be a PDF, DOCX or TXT file');
      const buf = fs.readFileSync(file.path);
      if (!buf.length) throw badRequest('The uploaded file is empty');
      if (!MAGIC[fmt](buf)) throw badRequest(`File content is not a valid ${fmt.toUpperCase()}`);
      try {
        cvText = await extractText(buf, fmt);
      } catch (e: any) {
        throw badRequest(`Could not read the ${fmt.toUpperCase()}: ${e?.message || 'unreadable file'}`);
      }
    }
    const data: any = pick(body, CAND_COLS);
    delete data.stage; delete data.rating;
    for (const k of ['vacancy_id', 'position_id', 'notice_days']) if (data[k] !== undefined) data[k] = toInt(data[k]) ?? null;
    if (data.expected_salary !== undefined) data.expected_salary = toNum(data.expected_salary) ?? null;
    if (data.vacancy_id && !get('SELECT 1 FROM vacancies WHERE id = ?', [data.vacancy_id])) throw notFound('Vacancy not found');
    if (data.vacancy_id && !data.position_id) data.position_id = get<any>('SELECT position_id FROM vacancies WHERE id = ?', [data.vacancy_id])?.position_id ?? null;
    const parsedEarly = parseCv(cvText, extraSkills());
    // Derive missing details from the CV itself.
    if (!data.first_name && parsedEarly.name_guess) { data.first_name = parsedEarly.name_guess.first_name; data.last_name = data.last_name || parsedEarly.name_guess.last_name; }
    if (!data.first_name && file) data.first_name = path.parse(file.originalname).name.replace(/[_-]+/g, ' ').slice(0, 60);
    if (!data.first_name) throw badRequest('first_name is required (or upload a CV with a name on its first line)');
    if (!data.email && parsedEarly.emails[0]) data.email = parsedEarly.emails[0];
    if (!data.phone && parsedEarly.phones[0]) data.phone = parsedEarly.phones[0];
    data.last_name = data.last_name || '';
    const id = transaction(() => {
      const cid = insert('candidates', {
        ...data, cv_original_name: file ? file.originalname.slice(0, 255) : null, cv_stored_name: file ? file.filename : null, cv_mime: file ? file.mimetype : null,
        cv_text: cvText || null, parsed: '{}', score: null, score_breakdown: '{}', stage: 'new', created_by: req.user!.id, created_at: nowIso(), updated_at: nowIso(),
      });
      const a = analyse({ ...data, cv_text: cvText });
      update('candidates', cid, { parsed: a.parsed, score: a.score, score_breakdown: a.breakdown });
      addEvent(cid, 'note', file ? `CV uploaded (${file.originalname})` : 'Candidate added manually', null, req.user!.id);
      if (a.score !== null) addEvent(cid, 'score', `Scored ${a.score} against ${a.jd.title}`, { score: a.score, jd_id: a.jd.id }, req.user!.id);
      return cid;
    });
    audit(req, 'create', 'candidate', id, { vacancy_id: data.vacancy_id ?? null, has_cv: !!file });
    res.status(201).json({ ...loadCandidate(id), events: events(id) });
  } catch (e) {
    cleanup();
    next(e);
  }
}

r.get('/candidates/:id', requireRecruiter, (req, res) => {
  const cand = loadCandidate(toInt(req.params.id)!);
  const vacancy = cand.vacancy_id ? get<any>('SELECT v.*, p.title AS position_title, d.name AS department_name FROM vacancies v LEFT JOIN positions p ON p.id = v.position_id LEFT JOIN departments d ON d.id = v.department_id WHERE v.id = ?', [cand.vacancy_id]) : null;
  const jd = cand.score_breakdown?.jd_id ? resolveJd({ job_description_id: cand.score_breakdown.jd_id }) : resolveJd({ vacancy_id: cand.vacancy_id, position_id: cand.position_id });
  res.json({ ...cand, events: events(cand.id), vacancy, jd: jd ? { id: jd.id, title: jd.title, skills: jd.skills, requirements: jd.requirements, experience_min: jd.experience_min, experience_max: jd.experience_max, status: jd.status } : null });
});

r.get('/candidates/:id/hire-defaults', requireHr, (req, res) => {
  const cand = loadCandidate(toInt(req.params.id)!);
  const vacancy = cand.vacancy_id ? get<any>('SELECT * FROM vacancies WHERE id = ?', [cand.vacancy_id]) : null;
  const position_id = cand.position_id ?? vacancy?.position_id ?? null;
  const position = position_id ? get<any>('SELECT * FROM positions WHERE id = ?', [position_id]) : null;
  const department_id = vacancy?.department_id ?? position?.department_id ?? null;
  const dept = department_id ? get<any>('SELECT head_employee_id FROM departments WHERE id = ?', [department_id]) : null;
  const jd = resolveJd({ vacancy_id: cand.vacancy_id, position_id });
  res.json({
    candidate_id: cand.id, first_name: cand.first_name, last_name: cand.last_name, email: cand.email || '', phone: cand.phone || '',
    position_id, department_id, manager_id: dept?.head_employee_id ?? null, employment_type: jd?.employment_type || 'full_time',
    employee_code: nextEmployeeCode(), join_date: today(), status: 'onboarding', vacancy_id: cand.vacancy_id ?? null, vacancy_title: cand.vacancy_title ?? null,
    create_login: true, login_role: 'employee', expected_salary: cand.expected_salary ?? null, notice_days: cand.notice_days ?? null,
  });
});

r.put('/candidates/:id', requireRecruiter, wrap(async (req, res) => {
  const id = toInt(req.params.id)!;
  const existing = loadCandidate(id);
  const data: any = pick(req.body, CAND_COLS);
  for (const k of ['vacancy_id', 'position_id', 'notice_days', 'rating']) if (data[k] !== undefined) data[k] = toInt(data[k]) ?? null;
  if (data.expected_salary !== undefined) data.expected_salary = toNum(data.expected_salary) ?? null;
  if (data.rating !== undefined && data.rating !== null && (data.rating < 1 || data.rating > 5)) throw badRequest('rating must be between 1 and 5');
  if (data.stage !== undefined && !(STAGES as readonly string[]).includes(data.stage)) throw badRequest('Invalid stage');
  if (data.stage === 'hired' && existing.stage !== 'hired') throw badRequest('Use the hire action to mark a candidate as hired');
  if (existing.stage === 'hired' && data.stage && data.stage !== 'hired') throw badRequest('A hired candidate cannot be moved back');
  if (data.vacancy_id && !get('SELECT 1 FROM vacancies WHERE id = ?', [data.vacancy_id])) throw notFound('Vacancy not found');
  if (data.first_name !== undefined && !String(data.first_name).trim()) throw badRequest('first_name cannot be empty');
  const stageChanged = data.stage !== undefined && data.stage !== existing.stage;
  const vacancyChanged = data.vacancy_id !== undefined && data.vacancy_id !== existing.vacancy_id;
  transaction(() => {
    update('candidates', id, { ...data, updated_at: nowIso() });
    if (stageChanged) addEvent(id, 'stage_change', req.body.note || null, { from: existing.stage, to: data.stage }, req.user!.id);
    if (vacancyChanged) {
      const a = analyse({ ...existing, ...data, vacancy_id: data.vacancy_id });
      update('candidates', id, { parsed: a.parsed, score: a.score, score_breakdown: a.breakdown });
      if (a.score !== null) addEvent(id, 'score', `Rescored ${a.score} against ${a.jd.title}`, { score: a.score, jd_id: a.jd.id }, req.user!.id);
    }
  });
  audit(req, 'update', 'candidate', id, Object.keys(data));
  res.json({ ...loadCandidate(id), events: events(id) });
}));

r.delete('/candidates/:id', requireHr, (req, res) => {
  const id = toInt(req.params.id)!;
  const cand = loadCandidate(id);
  run('UPDATE employees SET candidate_id = NULL WHERE candidate_id = ?', [id]);
  run('DELETE FROM candidates WHERE id = ?', [id]);
  if (cand.cv_stored_name) fs.rm(path.join(UPLOAD_DIR, path.basename(cand.cv_stored_name)), { force: true }, () => {});
  audit(req, 'delete', 'candidate', id);
  res.json({ ok: true });
});

r.post('/candidates/:id/events', requireRecruiter, wrap(async (req, res) => {
  const id = toInt(req.params.id)!;
  const cand = loadCandidate(id);
  const type = String(req.body.type || 'note');
  if (!['note', 'interview'].includes(type)) throw badRequest('type must be note or interview');
  const note = req.body.note ? String(req.body.note).slice(0, 2000) : null;
  const data = req.body.data && typeof req.body.data === 'object' ? pick(req.body.data, ['date', 'interviewer', 'feedback', 'round', 'outcome']) : null;
  if (type === 'note' && !note) throw badRequest('note is required');
  if (type === 'interview' && !(data as any)?.date) throw badRequest('data.date is required for an interview');
  const evId = transaction(() => {
    const e = addEvent(id, type, note, data, req.user!.id);
    // Scheduling an interview moves a new / screening candidate into the Interview column.
    if (type === 'interview' && ['new', 'screening'].includes(cand.stage)) {
      update('candidates', id, { stage: 'interview', updated_at: nowIso() });
      addEvent(id, 'stage_change', 'Interview scheduled', { from: cand.stage, to: 'interview' }, req.user!.id);
    } else update('candidates', id, { updated_at: nowIso() });
    return e;
  });
  audit(req, 'event', 'candidate', id, { type, event_id: evId });
  res.status(201).json({ ...loadCandidate(id), events: events(id) });
}));

r.get('/candidates/:id/cv', requireRecruiter, (req, res) => {
  const cand = loadCandidate(toInt(req.params.id)!);
  if (!cand.cv_stored_name) throw notFound('No CV file for this candidate');
  const file = path.join(UPLOAD_DIR, path.basename(cand.cv_stored_name));
  if (!fs.existsSync(file)) throw notFound('CV file missing on disk');
  res.setHeader('Content-Type', cand.cv_mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', `${req.query.download === '1' ? 'attachment' : 'inline'}; filename="${encodeURIComponent(cand.cv_original_name || 'cv')}"`);
  res.sendFile(file);
});

r.post('/candidates/:id/rescore', requireRecruiter, wrap(async (req, res) => {
  const id = toInt(req.params.id)!;
  const cand = loadCandidate(id);
  const jdId = toInt(req.body?.job_description_id) ?? null;
  const vacId = toInt(req.body?.vacancy_id) ?? null;
  if (jdId && !get('SELECT 1 FROM job_descriptions WHERE id = ?', [jdId])) throw notFound('Job description not found');
  if (vacId && !get('SELECT 1 FROM vacancies WHERE id = ?', [vacId])) throw notFound('Vacancy not found');
  const a = analyse(cand, { job_description_id: jdId, vacancy_id: vacId });
  if (!a.jd) throw badRequest('No job description to score against. Attach a published job description to the vacancy or pick one explicitly.');
  transaction(() => {
    update('candidates', id, { parsed: a.parsed, score: a.score, score_breakdown: a.breakdown, updated_at: nowIso() });
    addEvent(id, 'score', `Rescored ${a.score} against ${a.jd.title}`, { score: a.score, jd_id: a.jd.id }, req.user!.id);
  });
  res.json({ ...loadCandidate(id), events: events(id) });
}));

r.post('/vacancies/:id/rescore-all', requireRecruiter, wrap(async (req, res) => {
  const vid = toInt(req.params.id)!;
  if (!get('SELECT 1 FROM vacancies WHERE id = ?', [vid])) throw notFound('Vacancy not found');
  const cands = all<any>("SELECT * FROM candidates WHERE vacancy_id = ? AND stage NOT IN ('hired')", [vid]);
  let scored = 0;
  transaction(() => {
    for (const c of cands) {
      const a = analyse(c);
      update('candidates', c.id, { parsed: a.parsed, score: a.score, score_breakdown: a.breakdown, updated_at: nowIso() });
      if (a.score !== null) scored++;
    }
  });
  audit(req, 'rescore', 'vacancy', vid, { candidates: cands.length, scored });
  res.json({ ok: true, candidates: cands.length, scored });
}));

/* ------------------------------------------------------------------ */
/* Hire → employee                                                     */
/* ------------------------------------------------------------------ */
/** Stage template names that recruitment completes on hire (everything up to and including the offer). */
export const PRE_HIRE_STAGES = ['vacancy raised', 'requisition approval', 'budget & accounting sign-off', 'job description finalised', 'publishing', 'sourcing & screening', 'interviews', 'offer'];

r.post('/candidates/:id/hire', requireHr, wrap(async (req, res) => {
  const id = toInt(req.params.id)!;
  const cand = loadCandidate(id);
  if (cand.stage === 'hired') throw badRequest('This candidate has already been hired');
  if (['rejected', 'withdrawn'].includes(cand.stage)) throw badRequest(`A ${cand.stage} candidate cannot be hired; move them back into the pipeline first`);
  const body = req.body || {};
  assertDate(body.join_date, 'join_date');
  const vacancy = cand.vacancy_id ? get<any>('SELECT * FROM vacancies WHERE id = ?', [cand.vacancy_id]) : null;
  const position_id = toInt(body.position_id) ?? cand.position_id ?? vacancy?.position_id ?? null;
  const position = position_id ? get<any>('SELECT department_id FROM positions WHERE id = ?', [position_id]) : null;
  const empBody: any = {
    ...pick(body, EMP_COLS),
    first_name: body.first_name || cand.first_name,
    last_name: body.last_name ?? cand.last_name ?? '',
    email: body.email || cand.email,
    phone: body.phone ?? cand.phone ?? null,
    position_id,
    department_id: toInt(body.department_id) ?? vacancy?.department_id ?? position?.department_id ?? null,
    manager_id: toInt(body.manager_id) ?? null,
    employment_type: body.employment_type || 'full_time',
    status: body.status || 'onboarding',
    join_date: body.join_date || today(),
    vacancy_id: cand.vacancy_id ?? null,
    candidate_id: cand.id,
  };
  if (!empBody.email) throw badRequest('An email is required to create the employee (none on the candidate)');
  if (!empBody.employee_code) empBody.employee_code = nextEmployeeCode();
  const createLogin = body.create_login === undefined ? true : !!body.create_login && body.create_login !== 'false';
  const basic = toNum(body.salary_basic ?? body.basic);
  const evs = events(id);
  const when = (pred: (e: any) => boolean) => evs.filter(pred).map((e) => e.created_at).sort()[0] ?? null;

  const result = transaction(() => {
    const created = createEmployeeRecord(empBody, { create_login: createLogin, login_role: body.login_role, login_password: body.login_password });
    // Journey: the recruitment stages are already done — complete them with the dates we know.
    const stages = all<any>('SELECT * FROM journey_stages WHERE employee_id = ? ORDER BY sort_order, id', [created.id]);
    const offerIdx = stages.findIndex((s) => /\boffer\b/i.test(s.name));
    const lastIdx = offerIdx >= 0 ? offerIdx : stages.reduce((acc, s, i) => (PRE_HIRE_STAGES.includes(s.name.toLowerCase()) ? i : acc), -1);
    const dateFor = (name: string): string => {
      const n = name.toLowerCase();
      if (n.includes('vacancy')) return vacancy?.opened_at ? `${vacancy.opened_at}T09:00:00.000Z` : vacancy?.created_at || cand.created_at;
      if (n.includes('sourcing') || n.includes('screening')) return when((e) => e.type === 'stage_change' && e.data?.to === 'screening') || cand.created_at;
      if (n.includes('interview')) return when((e) => e.type === 'interview') || when((e) => e.type === 'stage_change' && e.data?.to === 'interview') || cand.updated_at;
      if (n.includes('offer')) return when((e) => e.type === 'stage_change' && e.data?.to === 'offer') || nowIso();
      return vacancy?.opened_at ? `${vacancy.opened_at}T09:00:00.000Z` : cand.created_at;
    };
    const completed: string[] = [];
    stages.forEach((s, i) => {
      if (i <= lastIdx) {
        const at = dateFor(s.name);
        update('journey_stages', s.id, { status: 'completed', started_at: s.started_at || at, completed_at: at, notes: s.notes || `Completed via recruitment (candidate #${cand.id})`, updated_at: nowIso() });
        completed.push(s.name);
      }
    });
    const next = stages.find((s, i) => i > lastIdx && /document/i.test(s.name)) || stages[lastIdx + 1];
    if (next) update('journey_stages', next.id, { status: 'in_progress', started_at: nowIso(), updated_at: nowIso() });
    // Copy the CV (PDF only — the document centre accepts pdf/jpg/png) into the employee's documents.
    let document_id: number | null = null;
    if (cand.cv_stored_name && cvFormatOf(cand.cv_stored_name) === 'pdf') {
      const src = path.join(UPLOAD_DIR, path.basename(cand.cv_stored_name));
      if (fs.existsSync(src)) {
        const stored = `doc_${crypto.randomUUID()}.pdf`;
        fs.copyFileSync(src, path.join(UPLOAD_DIR, stored));
        document_id = insert('documents', {
          employee_id: created.id, document_type_id: null, title: 'CV (from recruitment)', original_name: cand.cv_original_name || 'cv.pdf', stored_name: stored, mime: 'application/pdf', format: 'pdf',
          size_bytes: fs.statSync(src).size, issued_date: null, expiry_date: null, document_number: null, notes: `Uploaded during recruitment for ${cand.vacancy_title || 'a vacancy'}`, status: 'valid', uploaded_by: req.user!.id, created_at: nowIso(),
        });
      }
    }
    // Optional opening salary structure.
    if (basic !== undefined && basic >= 0) {
      insert('salary_structures', { employee_id: created.id, effective_from: empBody.join_date, currency: getSetting('company', DEFAULT_COMPANY).currency || 'INR', basic, components: '[]', ctc_annual: null, notes: 'Set at hire from recruitment', created_by: req.user!.id, created_at: nowIso() });
    }
    // Candidate + vacancy bookkeeping.
    update('candidates', id, { stage: 'hired', hired_employee_id: created.id, updated_at: nowIso() });
    addEvent(id, 'stage_change', null, { from: cand.stage, to: 'hired' }, req.user!.id);
    addEvent(id, 'hired', `Hired as ${created.employee_code}`, { employee_id: created.id, employee_code: created.employee_code, document_id }, req.user!.id);
    let vacancyOut: any = null;
    if (vacancy) {
      const hired = (vacancy.hired_count || 0) + 1;
      const filled = hired >= (vacancy.openings || 1);
      update('vacancies', vacancy.id, { hired_count: hired, ...(filled && vacancy.status !== 'closed' ? { status: 'filled', closed_at: today() } : {}) });
      vacancyOut = get('SELECT * FROM vacancies WHERE id = ?', [vacancy.id]);
    }
    return { created, completed, next: next?.name ?? null, document_id, vacancy: vacancyOut };
  });
  audit(req, 'hire', 'candidate', id, { employee_id: result.created.id, employee_code: result.created.employee_code });
  const emp: any = parseJson(get<any>(`${empQuery} WHERE e.id = ?`, [result.created.id]), ['custom_fields']);
  res.status(201).json({
    ...emp, temporary_password: result.created.temporary_password, candidate: loadCandidate(id), vacancy: result.vacancy,
    journey: { completed: result.completed, in_progress: result.next }, cv_document_id: result.document_id,
  });
}));

export default r;
