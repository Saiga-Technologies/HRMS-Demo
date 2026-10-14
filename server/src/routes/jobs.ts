import { Router } from 'express';
import { all, get, insert, update, run, parseJson, parseJsonAll } from '../db.js';
import { requireAuth, requireHr } from '../auth.js';
import { badRequest, notFound, pick, requireFields, audit, toInt, nowIso, wrap } from '../util.js';

const r = Router();

// ---------- Job descriptions ----------
const JD_COLS = ['title', 'position_id', 'department_id', 'summary', 'responsibilities', 'requirements', 'skills', 'employment_type', 'experience_min', 'experience_max', 'salary_min', 'salary_max', 'location', 'status'];
const JSON_COLS = ['responsibilities', 'requirements', 'skills'];
const jdQuery = `
  SELECT j.*, p.title AS position_title, d.name AS department_name,
         (SELECT COUNT(*) FROM vacancies v WHERE v.job_description_id = j.id AND v.status = 'open') AS open_vacancies
  FROM job_descriptions j LEFT JOIN positions p ON p.id = j.position_id LEFT JOIN departments d ON d.id = j.department_id`;

function normalizeLists(data: any) {
  for (const c of JSON_COLS) {
    if (data[c] === undefined) continue;
    if (typeof data[c] === 'string') data[c] = data[c].split('\n').map((s: string) => s.trim()).filter(Boolean);
    if (!Array.isArray(data[c])) throw badRequest(`${c} must be a list`);
  }
  if (data.status && !['draft', 'published', 'archived'].includes(data.status)) throw badRequest('Invalid status');
}

r.get('/descriptions', requireAuth, (req, res) => {
  const where: string[] = [];
  const params: any[] = [];
  if (req.query.status) { where.push('j.status = ?'); params.push(req.query.status); }
  if (req.query.position_id) { where.push('j.position_id = ?'); params.push(toInt(req.query.position_id)); }
  if (req.query.department_id) { where.push('j.department_id = ?'); params.push(toInt(req.query.department_id)); }
  if (req.query.q) { where.push('(j.title LIKE ? OR j.summary LIKE ?)'); params.push(`%${req.query.q}%`, `%${req.query.q}%`); }
  res.json(parseJsonAll(all(`${jdQuery}${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY j.updated_at DESC`, params), JSON_COLS));
});
r.get('/descriptions/:id', requireAuth, (req, res) => {
  const row = parseJson(get(`${jdQuery} WHERE j.id = ?`, [toInt(req.params.id)]), JSON_COLS);
  if (!row) throw notFound();
  res.json(row);
});
r.post('/descriptions', requireHr, wrap(async (req, res) => {
  requireFields(req.body, ['title']);
  const data: any = pick(req.body, JD_COLS);
  normalizeLists(data);
  for (const c of JSON_COLS) data[c] = data[c] ?? [];
  const id = insert('job_descriptions', { ...data, created_by: req.user!.id, created_at: nowIso(), updated_at: nowIso() });
  audit(req, 'create', 'job_description', id);
  res.status(201).json(parseJson(get(`${jdQuery} WHERE j.id = ?`, [id]), JSON_COLS));
}));
r.put('/descriptions/:id', requireHr, wrap(async (req, res) => {
  const id = toInt(req.params.id)!;
  const existing = get<any>('SELECT * FROM job_descriptions WHERE id = ?', [id]);
  if (!existing) throw notFound();
  const data: any = pick(req.body, JD_COLS);
  normalizeLists(data);
  const contentChanged = JSON_COLS.some((c) => data[c] !== undefined && JSON.stringify(data[c]) !== existing[c]) || (data.summary !== undefined && data.summary !== existing.summary);
  update('job_descriptions', id, { ...data, version: contentChanged ? existing.version + 1 : existing.version, updated_at: nowIso() });
  audit(req, 'update', 'job_description', id);
  res.json(parseJson(get(`${jdQuery} WHERE j.id = ?`, [id]), JSON_COLS));
}));
r.post('/descriptions/:id/duplicate', requireHr, wrap(async (req, res) => {
  const src = get<any>('SELECT * FROM job_descriptions WHERE id = ?', [toInt(req.params.id)]);
  if (!src) throw notFound();
  const { id: _id, created_at: _c, updated_at: _u, version: _v, ...rest } = src;
  const id = insert('job_descriptions', { ...rest, title: `${src.title} (copy)`, status: 'draft', version: 1, created_by: req.user!.id, created_at: nowIso(), updated_at: nowIso() });
  res.status(201).json(parseJson(get(`${jdQuery} WHERE j.id = ?`, [id]), JSON_COLS));
}));
r.delete('/descriptions/:id', requireHr, (req, res) => {
  if (!run('DELETE FROM job_descriptions WHERE id = ?', [toInt(req.params.id)]).changes) throw notFound();
  audit(req, 'delete', 'job_description', req.params.id);
  res.json({ ok: true });
});

// ---------- Vacancies (start of the employee journey) ----------
const VAC_COLS = ['title', 'position_id', 'department_id', 'job_description_id', 'openings', 'budget_annual', 'status', 'opened_at', 'closed_at', 'notes'];
const vacQuery = `
  SELECT v.*, p.title AS position_title, d.name AS department_name, j.title AS jd_title,
         (SELECT COUNT(*) FROM employees e WHERE e.vacancy_id = v.id) AS hires
  FROM vacancies v LEFT JOIN positions p ON p.id = v.position_id LEFT JOIN departments d ON d.id = v.department_id
  LEFT JOIN job_descriptions j ON j.id = v.job_description_id`;
r.get('/vacancies', requireAuth, (req, res) => {
  const where = req.query.status ? ' WHERE v.status = ?' : '';
  res.json(all(`${vacQuery}${where} ORDER BY v.created_at DESC`, req.query.status ? [req.query.status] : []));
});
r.post('/vacancies', requireHr, wrap(async (req, res) => {
  requireFields(req.body, ['title']);
  const data: any = pick(req.body, VAC_COLS);
  if (!data.opened_at) data.opened_at = nowIso().slice(0, 10);
  const id = insert('vacancies', { ...data, raised_by: req.user!.id, created_at: nowIso() });
  audit(req, 'create', 'vacancy', id);
  res.status(201).json(get(`${vacQuery} WHERE v.id = ?`, [id]));
}));
r.put('/vacancies/:id', requireHr, wrap(async (req, res) => {
  const id = toInt(req.params.id)!;
  if (!get('SELECT 1 FROM vacancies WHERE id = ?', [id])) throw notFound();
  const data: any = pick(req.body, VAC_COLS);
  if (['closed', 'filled'].includes(data.status) && !data.closed_at) data.closed_at = nowIso().slice(0, 10);
  update('vacancies', id, data);
  audit(req, 'update', 'vacancy', id);
  res.json(get(`${vacQuery} WHERE v.id = ?`, [id]));
}));
r.delete('/vacancies/:id', requireHr, (req, res) => {
  run('UPDATE employees SET vacancy_id = NULL WHERE vacancy_id = ?', [toInt(req.params.id)]);
  if (!run('DELETE FROM vacancies WHERE id = ?', [toInt(req.params.id)]).changes) throw notFound();
  res.json({ ok: true });
});

export default r;
