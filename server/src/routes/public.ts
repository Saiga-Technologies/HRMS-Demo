import { Router, type Request, type Response, type NextFunction } from 'express';
import { all, get, getSetting, parseJson, parseJsonAll } from '../db.js';
import { HttpError, badRequest, notFound, forbidden, audit, toInt } from '../util.js';
import { DEFAULT_COMPANY } from './settings.js';
import { insertCandidate, receiveCv } from './recruitment.js';
import { apiKeyFrom } from './integrations.js';

/**
 * Unauthenticated endpoints: the public careers page (open vacancies + apply with a CV) and the
 * API-key endpoints for job boards (`/v1/*`, header `X-API-Key`). Applications land in the
 * recruitment pipeline's "New" column, parsed and scored like any uploaded CV.
 */
const r = Router();

const JD_JSON = ['responsibilities', 'requirements', 'skills'];
const jobQuery = `
  SELECT v.id, v.title, v.openings, v.opened_at, v.created_at, d.name AS department_name, p.title AS position_title,
         j.summary, j.responsibilities, j.requirements, j.skills, j.employment_type, j.experience_min, j.experience_max,
         j.salary_min, j.salary_max, j.location
  FROM vacancies v
  LEFT JOIN positions p ON p.id = v.position_id
  LEFT JOIN job_descriptions j ON j.id = v.job_description_id AND j.status = 'published'
  LEFT JOIN departments d ON d.id = COALESCE(v.department_id, j.department_id, p.department_id)
  WHERE v.status = 'open'`;

function openJobs() {
  return parseJsonAll(all<any>(`${jobQuery} ORDER BY COALESCE(v.opened_at, v.created_at) DESC`), JD_JSON);
}
function openJob(id: number) {
  const job = parseJson(get<any>(`${jobQuery} AND v.id = ?`, [id]), JD_JSON);
  if (!job) throw notFound('This job is no longer open');
  return job;
}
function company() {
  const c = getSetting('company', DEFAULT_COMPANY);
  return { name: c.name, tagline: c.tagline, logo_text: c.logo_text, currency: c.currency || 'INR' };
}

/** Small in-memory limiter so the open apply form cannot be used to flood the pipeline. */
const hits = new Map<string, number[]>();
function applyRateLimit(req: Request, _res: Response, next: NextFunction) {
  const key = req.ip || 'unknown';
  const now = Date.now();
  const recent = (hits.get(key) || []).filter((t) => now - t < 15 * 60000);
  if (recent.length >= 10) return next(new HttpError(429, 'Too many applications from this address. Please try again later.'));
  recent.push(now);
  hits.set(key, recent);
  next();
}

/* ------------------------------------------------------------------ */
/* Careers page                                                        */
/* ------------------------------------------------------------------ */
r.get('/jobs', (_req, res) => {
  res.json({ company: company(), jobs: openJobs() });
});

r.get('/jobs/:id', (req, res) => {
  res.json({ company: company(), job: openJob(toInt(req.params.id)!) });
});

/** Multipart: `cv` (PDF/DOCX/TXT, required), first_name, last_name, email (required), phone, notice_days, notes. */
r.post('/jobs/:id/apply', applyRateLimit, (req, res, next) => {
  if (!req.is('multipart/form-data')) return next(badRequest('Send the application as multipart/form-data with a CV file'));
  receiveCv(req, res, async () => {
    try {
      const job = openJob(toInt(req.params.id)!);
      const b = req.body || {};
      if (!req.file) throw badRequest('Please attach your CV (PDF, DOCX or TXT)');
      if (!String(b.first_name || '').trim()) throw badRequest('First name is required');
      const email = String(b.email || '').trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw badRequest('A valid email is required');
      const dup = get<any>('SELECT id FROM candidates WHERE vacancy_id = ? AND lower(email) = lower(?)', [job.id, email]);
      if (dup) throw new HttpError(409, 'You have already applied for this job. We will be in touch.');
      const id = await insertCandidate(
        { first_name: String(b.first_name).trim().slice(0, 60), last_name: String(b.last_name || '').trim().slice(0, 60), email: email.slice(0, 200), phone: b.phone ? String(b.phone).slice(0, 40) : null,
          notice_days: b.notice_days, notes: b.notes ? String(b.notes).slice(0, 2000) : null, vacancy_id: job.id, source: 'Careers page' },
        req.file, null, `Applied via the careers page (${req.file.originalname})`,
      );
      audit(req, 'apply', 'candidate', id, { vacancy_id: job.id });
      res.status(201).json({ ok: true, reference: `APP-${String(id).padStart(5, '0')}`, job_title: job.title });
    } catch (e) {
      next(e);
    }
  });
});

/* ------------------------------------------------------------------ */
/* API-key endpoints (job boards, ATS tools)                           */
/* ------------------------------------------------------------------ */
function requireScope(scope: string) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const key = apiKeyFrom(req);
    if (!key) return next(new HttpError(401, 'A valid API key is required (header X-API-Key)'));
    if (!key.scopes?.includes(scope)) return next(forbidden(`This API key does not have the ${scope} scope`));
    (req as any).apiKey = key;
    next();
  };
}

r.get('/v1/jobs', requireScope('jobs:read'), (_req, res) => {
  res.json({ items: openJobs() });
});

/** JSON (first_name, last_name, email, phone, vacancy_id, cv_text…) or multipart with a `cv` file. */
r.post('/v1/candidates', requireScope('candidates:write'), (req, res, next) => {
  const create = async () => {
    try {
      const key = (req as any).apiKey;
      const b = { ...(req.body || {}) };
      const vacancyId = toInt(b.vacancy_id);
      if (vacancyId && !get("SELECT 1 FROM vacancies WHERE id = ? AND status IN ('open','on_hold')", [vacancyId])) throw notFound('Vacancy not found or not open');
      const id = await insertCandidate({ ...b, source: b.source ? `API: ${String(b.source).slice(0, 60)}` : `API: ${key.name}` }, req.file, null, `Received via API key "${key.name}"`);
      audit(req, 'api_create', 'candidate', id, { api_key_id: key.id });
      const c = get<any>('SELECT id, first_name, last_name, email, vacancy_id, stage, score FROM candidates WHERE id = ?', [id]);
      res.status(201).json(c);
    } catch (e) {
      next(e);
    }
  };
  if (req.is('multipart/form-data')) receiveCv(req, res, create);
  else create();
});

export default r;
