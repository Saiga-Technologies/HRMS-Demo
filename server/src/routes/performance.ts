import { Router } from 'express';
import type { Request } from 'express';
import { all, get, insert, update, run, parseJson, parseJsonAll, transaction } from '../db.js';
import { requireAuth, requireHr, isHr } from '../auth.js';
import { wrap, badRequest, notFound, forbidden, pick, requireFields, audit, toInt, toNum, nowIso, today, assertDate, round2 } from '../util.js';
import { defaultApprover, canApproveFor, approvableEmployeeIds } from '../approvers.js';

/**
 * Performance reviews: HR runs review cycles; every active employee gets a review (self-assessment →
 * manager assessment → completed → acknowledged). Ratings are per competency (1..rating_scale);
 * the final rating is the weighted average of the manager's ratings unless the manager overrides it.
 */
const r = Router();

export const DEFAULT_COMPETENCIES = [
  { key: 'quality', label: 'Quality of work', description: 'Accuracy, thoroughness and attention to detail.', weight: 1 },
  { key: 'productivity', label: 'Productivity', description: 'Volume of work delivered and use of time.', weight: 1 },
  { key: 'communication', label: 'Communication', description: 'Clarity in writing and speaking; keeps people informed.', weight: 1 },
  { key: 'teamwork', label: 'Teamwork', description: 'Collaboration, support for colleagues and conflict handling.', weight: 1 },
  { key: 'initiative', label: 'Initiative', description: 'Proactively identifies and solves problems.', weight: 1 },
  { key: 'reliability', label: 'Reliability', description: 'Meets commitments and deadlines consistently.', weight: 1 },
];
const GOAL_STATUSES = ['on_track', 'at_risk', 'done'];
const REVIEW_JSON = ['self_ratings', 'manager_ratings', 'goals'];

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */
function loadCycle(id: number) {
  return parseJson(get<any>(`SELECT c.*, (SELECT COUNT(*) FROM reviews r WHERE r.cycle_id = c.id) AS review_count,
                                   (SELECT COUNT(*) FROM reviews r WHERE r.cycle_id = c.id AND r.status IN ('completed','acknowledged')) AS completed_count
                            FROM review_cycles c WHERE c.id = ?`, [id]), ['competencies']);
}
function cycleList() {
  return parseJsonAll(all<any>(`SELECT c.*, (SELECT COUNT(*) FROM reviews r WHERE r.cycle_id = c.id) AS review_count,
                                   (SELECT COUNT(*) FROM reviews r WHERE r.cycle_id = c.id AND r.status IN ('completed','acknowledged')) AS completed_count
                            FROM review_cycles c ORDER BY c.period_start DESC, c.id DESC`), ['competencies']);
}
const reviewQuery = `SELECT r.*, e.first_name || ' ' || e.last_name AS employee_name, e.employee_code, d.name AS department_name, p.title AS position_title,
  m.first_name || ' ' || m.last_name AS reviewer_name, c.name AS cycle_name, c.status AS cycle_status, c.period_start, c.period_end, c.due_date, c.rating_scale
  FROM reviews r JOIN employees e ON e.id = r.employee_id LEFT JOIN departments d ON d.id = e.department_id LEFT JOIN positions p ON p.id = e.position_id
  LEFT JOIN employees m ON m.id = r.reviewer_employee_id JOIN review_cycles c ON c.id = r.cycle_id`;
function loadReview(id: number) {
  return parseJson(get<any>(`${reviewQuery} WHERE r.id = ?`, [id]), REVIEW_JSON);
}
function competenciesOf(cycleId: number): any[] {
  const c = parseJson(get<any>('SELECT competencies, rating_scale FROM review_cycles WHERE id = ?', [cycleId]), ['competencies']);
  const list = Array.isArray(c?.competencies) && c!.competencies.length ? c!.competencies : DEFAULT_COMPETENCIES;
  return list;
}
function validateCompetencies(v: any) {
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || !v.length) throw badRequest('competencies must be a non-empty array');
  const out = v.map((c: any, i: number) => {
    const label = String(c?.label || '').trim();
    if (!label) throw badRequest(`Competency ${i + 1} needs a label`);
    const key = String(c?.key || label).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || `c${i + 1}`;
    const weight = toNum(c?.weight, 1)!;
    if (weight <= 0) throw badRequest(`Weight for ${label} must be positive`);
    return { key, label, description: c?.description ? String(c.description) : '', weight };
  });
  if (new Set(out.map((c) => c.key)).size !== out.length) throw badRequest('Competency keys must be unique');
  return out;
}
function cleanRatings(input: any, competencies: any[], scale: number): Record<string, number> {
  const out: Record<string, number> = {};
  if (!input || typeof input !== 'object') return out;
  for (const c of competencies) {
    const v = input[c.key];
    if (v === undefined || v === null || v === '') continue;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 1 || n > scale) throw badRequest(`Rating for ${c.label} must be between 1 and ${scale}`);
    out[c.key] = Math.round(n * 2) / 2;
  }
  return out;
}
function cleanGoals(input: any): any[] | undefined {
  if (input === undefined) return undefined;
  if (!Array.isArray(input)) throw badRequest('goals must be an array');
  return input.slice(0, 20).map((g: any, i: number) => {
    const title = String(g?.title || '').trim();
    if (!title) throw badRequest(`Goal ${i + 1} needs a title`);
    const status = GOAL_STATUSES.includes(g?.status) ? g.status : 'on_track';
    return { title: title.slice(0, 200), weight: Math.max(0, toNum(g?.weight, 1)!), progress: Math.max(0, Math.min(100, Math.round(toNum(g?.progress, 0)!))), status, notes: g?.notes ? String(g.notes).slice(0, 1000) : '' };
  });
}
export function weightedAverage(ratings: Record<string, number>, competencies: any[]): number | null {
  let sum = 0, w = 0;
  for (const c of competencies) {
    const v = ratings[c.key];
    if (v === undefined || v === null) continue;
    const weight = Number(c.weight) || 1;
    sum += Number(v) * weight;
    w += weight;
  }
  return w ? round2(sum / w) : null;
}
function assertAllRated(ratings: Record<string, number>, competencies: any[], who: string) {
  const missing = competencies.filter((c) => ratings[c.key] === undefined).map((c) => c.label);
  if (missing.length) throw badRequest(`${who} rating missing for: ${missing.join(', ')}`);
}
/** Visibility: HR everything; managers their own + reviews they review or of anyone in their reporting chain; employees their own. */
function visibleFilter(req: Request): { sql: string; params: any[] } | null {
  if (isHr(req)) return { sql: '', params: [] };
  const eid = req.user!.employee_id;
  if (!eid) return null;
  const ids = approvableEmployeeIds(req) || [];
  const list = [eid, ...ids];
  return { sql: ` AND (r.employee_id IN (${list.map(() => '?').join(',')}) OR r.reviewer_employee_id = ?)`, params: [...list, eid] };
}
function canReview(req: Request, review: any) {
  if (isHr(req)) return true;
  if (!req.user?.employee_id || req.user.employee_id === review.employee_id) return false;
  return review.reviewer_employee_id === req.user.employee_id || canApproveFor(req, review.employee_id);
}
function createReviewsForCycle(cycleId: number) {
  const existing = new Set(all<any>('SELECT employee_id FROM reviews WHERE cycle_id = ?', [cycleId]).map((x) => x.employee_id));
  const emps = all<any>("SELECT id FROM employees WHERE status != 'exited'");
  const now = nowIso();
  let created = 0;
  for (const e of emps) {
    if (existing.has(e.id)) continue;
    insert('reviews', { cycle_id: cycleId, employee_id: e.id, reviewer_employee_id: defaultApprover(e.id)?.employee_id ?? null, self_ratings: {}, manager_ratings: {}, goals: [], status: 'pending_self', created_at: now, updated_at: now });
    created += 1;
  }
  return created;
}

/* ------------------------------------------------------------------ */
/* Lazy defaults: one closed cycle with completed reviews, one open    */
/* ------------------------------------------------------------------ */
export function ensurePerformanceDefaults() {
  if (get<any>('SELECT COUNT(*) AS n FROM review_cycles')!.n > 0) return;
  const year = Number(today().slice(0, 4));
  const now = nowIso();
  transaction(() => {
    const h1 = insert('review_cycles', { name: `H1 ${year}`, period_start: `${year}-01-01`, period_end: `${year}-06-30`, due_date: `${year}-07-15`, status: 'closed', competencies: DEFAULT_COMPETENCIES, rating_scale: 5, created_by: null, created_at: now });
    const emps = all<any>("SELECT e.id FROM employees e WHERE e.status != 'exited' ORDER BY e.id");
    const goalsFor = (i: number) => [
      { title: ['Ship the quarterly roadmap items', 'Reduce turnaround time by 15%', 'Mentor a junior colleague', 'Improve documentation coverage'][i % 4], weight: 2, progress: 100, status: 'done', notes: '' },
      { title: ['Complete a certification', 'Automate a recurring report', 'Run a knowledge-sharing session', 'Close all audit findings'][i % 4], weight: 1, progress: 70 + ((i * 7) % 30), status: i % 3 === 0 ? 'at_risk' : 'on_track', notes: '' },
    ];
    emps.forEach((e, i) => {
      // Deterministic, plausible ratings between 3 and 5 (half steps) that vary per employee and competency.
      const self: Record<string, number> = {};
      const mgr: Record<string, number> = {};
      DEFAULT_COMPETENCIES.forEach((c, j) => {
        const base = 3 + (((e.id * 7 + j * 3) % 5) / 2); // 3, 3.5, 4, 4.5, 5
        self[c.key] = Math.min(5, base + ((i + j) % 2 ? 0.5 : 0));
        mgr[c.key] = base;
      });
      const final = weightedAverage(mgr, DEFAULT_COMPETENCIES);
      const completedAt = `${year}-07-${String(5 + (i % 9)).padStart(2, '0')}T10:00:00.000Z`;
      insert('reviews', {
        cycle_id: h1, employee_id: e.id, reviewer_employee_id: defaultApprover(e.id)?.employee_id ?? null,
        self_ratings: self, manager_ratings: mgr,
        self_comments: 'Delivered on all key commitments this half and picked up additional responsibilities when the team was stretched.',
        manager_comments: final! >= 4.5 ? 'Outstanding half. Consistently exceeds expectations and lifts the team around them.' : final! >= 4 ? 'Strong, dependable performance. Keep building on stakeholder communication.' : 'Solid contribution. Focus next half on taking more initiative on cross-team work.',
        goals: goalsFor(i), final_rating: final, status: i % 4 === 3 ? 'completed' : 'acknowledged',
        self_submitted_at: `${year}-06-28T09:00:00.000Z`, completed_at: completedAt, acknowledged_at: i % 4 === 3 ? null : completedAt, created_at: `${year}-06-15T09:00:00.000Z`, updated_at: completedAt,
      });
    });
    const h2 = insert('review_cycles', { name: `H2 ${year}`, period_start: `${year}-07-01`, period_end: `${year}-12-31`, due_date: `${year + 1}-01-15`, status: 'open', competencies: DEFAULT_COMPETENCIES, rating_scale: 5, created_by: null, created_at: now });
    createReviewsForCycle(h2);
  });
}

/* ------------------------------------------------------------------ */
/* Cycles                                                              */
/* ------------------------------------------------------------------ */
r.get('/cycles', requireAuth, (_req, res) => {
  ensurePerformanceDefaults();
  res.json(cycleList());
});
r.post('/cycles', requireHr, wrap(async (req, res) => {
  ensurePerformanceDefaults();
  requireFields(req.body, ['name', 'period_start', 'period_end']);
  assertDate(req.body.period_start, 'period_start');
  assertDate(req.body.period_end, 'period_end');
  assertDate(req.body.due_date, 'due_date');
  if (req.body.period_end < req.body.period_start) throw badRequest('period_end must be on or after period_start');
  const data: any = pick(req.body, ['name', 'period_start', 'period_end', 'due_date', 'rating_scale']);
  data.competencies = validateCompetencies(req.body.competencies) ?? DEFAULT_COMPETENCIES;
  data.rating_scale = toInt(data.rating_scale, 5)!;
  if (data.rating_scale < 3 || data.rating_scale > 10) throw badRequest('rating_scale must be between 3 and 10');
  const id = insert('review_cycles', { ...data, due_date: data.due_date || null, status: 'draft', created_by: req.user!.id, created_at: nowIso() });
  audit(req, 'create', 'review_cycle', id, { name: data.name });
  res.status(201).json(loadCycle(id));
}));
r.put('/cycles/:id', requireHr, wrap(async (req, res) => {
  const id = toInt(req.params.id)!;
  const cycle = loadCycle(id);
  if (!cycle) throw notFound();
  const data: any = pick(req.body, ['name', 'period_start', 'period_end', 'due_date', 'rating_scale', 'competencies']);
  assertDate(data.period_start, 'period_start');
  assertDate(data.period_end, 'period_end');
  assertDate(data.due_date, 'due_date');
  if (data.competencies !== undefined) {
    if (cycle.status !== 'draft' && cycle.review_count > 0) throw badRequest('Competencies cannot change once reviews exist');
    data.competencies = validateCompetencies(data.competencies);
  }
  if (data.rating_scale !== undefined) {
    if (cycle.status !== 'draft') throw badRequest('The rating scale cannot change once the cycle is open');
    data.rating_scale = toInt(data.rating_scale, 5);
  }
  update('review_cycles', id, data);
  audit(req, 'update', 'review_cycle', id, data);
  res.json(loadCycle(id));
}));
r.post('/cycles/:id/open', requireHr, wrap(async (req, res) => {
  const id = toInt(req.params.id)!;
  const cycle = loadCycle(id);
  if (!cycle) throw notFound();
  if (cycle.status === 'closed') throw badRequest('A closed cycle cannot be reopened');
  const created = transaction(() => {
    if (cycle.status === 'draft') update('review_cycles', id, { status: 'open' });
    return createReviewsForCycle(id);
  });
  audit(req, 'open', 'review_cycle', id, { created });
  res.json({ ...loadCycle(id), created });
}));
r.post('/cycles/:id/close', requireHr, wrap(async (req, res) => {
  const id = toInt(req.params.id)!;
  const cycle = loadCycle(id);
  if (!cycle) throw notFound();
  if (cycle.status !== 'open') throw badRequest('Only an open cycle can be closed');
  update('review_cycles', id, { status: 'closed' });
  audit(req, 'close', 'review_cycle', id);
  res.json(loadCycle(id));
}));
r.delete('/cycles/:id', requireHr, (req, res) => {
  const id = toInt(req.params.id)!;
  const cycle = loadCycle(id);
  if (!cycle) throw notFound();
  if (cycle.status !== 'draft') throw badRequest('Only a draft cycle can be deleted');
  run('DELETE FROM review_cycles WHERE id = ?', [id]);
  audit(req, 'delete', 'review_cycle', id);
  res.json({ ok: true });
});

function cycleSummary(cycle: any) {
  const competencies = competenciesOf(cycle.id);
  const reviews = parseJsonAll(all<any>(`${reviewQuery} WHERE r.cycle_id = ?`, [cycle.id]), REVIEW_JSON);
  const scale = cycle.rating_scale || 5;
  const done = reviews.filter((x) => x.status === 'completed' || x.status === 'acknowledged');
  const by_status: Record<string, number> = { pending_self: 0, pending_manager: 0, completed: 0, acknowledged: 0 };
  for (const x of reviews) by_status[x.status] = (by_status[x.status] || 0) + 1;
  const distribution = Array.from({ length: scale }, (_, i) => ({ rating: i + 1, count: 0 }));
  for (const x of done) {
    if (x.final_rating === null || x.final_rating === undefined) continue;
    const b = Math.min(scale, Math.max(1, Math.round(Number(x.final_rating))));
    distribution[b - 1].count += 1;
  }
  const competency_averages = competencies.map((c) => {
    const self = done.map((x) => x.self_ratings?.[c.key]).filter((v) => v !== undefined && v !== null).map(Number);
    const mgr = done.map((x) => x.manager_ratings?.[c.key]).filter((v) => v !== undefined && v !== null).map(Number);
    const avg = (a: number[]) => (a.length ? round2(a.reduce((s, v) => s + v, 0) / a.length) : null);
    return { key: c.key, label: c.label, weight: c.weight, self_average: avg(self), manager_average: avg(mgr), average: avg(mgr) };
  });
  const deptMap = new Map<string, { department: string; total: number; completed: number; sum: number; rated: number }>();
  for (const x of reviews) {
    const name = x.department_name || 'Unassigned';
    const d = deptMap.get(name) || { department: name, total: 0, completed: 0, sum: 0, rated: 0 };
    d.total += 1;
    if (x.status === 'completed' || x.status === 'acknowledged') {
      d.completed += 1;
      if (x.final_rating !== null && x.final_rating !== undefined) { d.sum += Number(x.final_rating); d.rated += 1; }
    }
    deptMap.set(name, d);
  }
  const department_averages = [...deptMap.values()].map((d) => ({ department: d.department, total: d.total, completed: d.completed, average: d.rated ? round2(d.sum / d.rated) : null })).sort((a, b) => (b.average ?? 0) - (a.average ?? 0));
  const rated = done.filter((x) => x.final_rating !== null && x.final_rating !== undefined);
  const top = [...rated].sort((a, b) => Number(b.final_rating) - Number(a.final_rating)).slice(0, 5).map((x) => ({ review_id: x.id, employee_id: x.employee_id, employee_name: x.employee_name, department_name: x.department_name, final_rating: x.final_rating }));
  return {
    cycle_id: cycle.id, name: cycle.name, status: cycle.status, rating_scale: scale, total: reviews.length, completed: done.length,
    completion_percent: reviews.length ? Math.round((done.length / reviews.length) * 100) : 0,
    by_status, average_rating: rated.length ? round2(rated.reduce((s, x) => s + Number(x.final_rating), 0) / rated.length) : null,
    distribution, competency_averages, department_averages, top_performers: top,
  };
}
r.get('/cycles/:id/summary', requireHr, (req, res) => {
  const cycle = loadCycle(toInt(req.params.id)!);
  if (!cycle) throw notFound();
  res.json(cycleSummary(cycle));
});
r.get('/cycles/:id/export.csv', requireHr, (req, res) => {
  const cycle = loadCycle(toInt(req.params.id)!);
  if (!cycle) throw notFound();
  const competencies = competenciesOf(cycle.id);
  const reviews = parseJsonAll(all<any>(`${reviewQuery} WHERE r.cycle_id = ? ORDER BY e.first_name, e.last_name`, [cycle.id]), REVIEW_JSON);
  const esc = (v: any) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const header = ['Employee code', 'Employee', 'Department', 'Position', 'Reviewer', 'Status', ...competencies.flatMap((c) => [`${c.label} (self)`, `${c.label} (manager)`]), 'Final rating', 'Self submitted', 'Completed', 'Acknowledged'];
  const lines = [header.map(esc).join(',')];
  for (const x of reviews) {
    lines.push([
      x.employee_code, x.employee_name, x.department_name || '', x.position_title || '', x.reviewer_name || '', x.status,
      ...competencies.flatMap((c) => [x.self_ratings?.[c.key] ?? '', x.manager_ratings?.[c.key] ?? '']),
      x.final_rating ?? '', x.self_submitted_at || '', x.completed_at || '', x.acknowledged_at || '',
    ].map(esc).join(','));
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="reviews-${cycle.name.replace(/[^a-zA-Z0-9_-]+/g, '-')}.csv"`);
  res.send(lines.join('\n'));
});
r.get('/cycles/:id', requireAuth, (req, res) => {
  const cycle = loadCycle(toInt(req.params.id)!);
  if (!cycle) throw notFound();
  res.json(cycle);
});

/* ------------------------------------------------------------------ */
/* Reviews                                                             */
/* ------------------------------------------------------------------ */
r.get('/reviews', requireAuth, (req, res) => {
  ensurePerformanceDefaults();
  const vis = visibleFilter(req);
  if (!vis) return res.json([]);
  const where: string[] = ['1=1' + vis.sql];
  const params: any[] = [...vis.params];
  if (req.query.cycle_id) { where.push('r.cycle_id = ?'); params.push(toInt(req.query.cycle_id)); }
  if (req.query.status) { where.push('r.status = ?'); params.push(String(req.query.status)); }
  if (req.query.employee_id) { where.push('r.employee_id = ?'); params.push(toInt(req.query.employee_id)); }
  if (req.query.reviewer_employee_id) { where.push('r.reviewer_employee_id = ?'); params.push(toInt(req.query.reviewer_employee_id)); }
  if (req.query.mine === '1' && req.user!.employee_id) { where.push('r.employee_id = ?'); params.push(req.user!.employee_id); }
  if (req.query.to_review === '1') {
    if (isHr(req)) where.push("r.status IN ('pending_manager','pending_self')");
    else { where.push('r.employee_id != ?'); params.push(req.user!.employee_id ?? 0); }
  }
  const rows = parseJsonAll(all<any>(`${reviewQuery} WHERE ${where.join(' AND ')} ORDER BY c.period_start DESC, e.first_name, e.last_name`, params), REVIEW_JSON);
  res.json(rows.map((x) => ({ ...x, can_review: canReview(req, x) })));
});

/** The signed-in employee's review in the current open cycle plus history for the sparkline. */
r.get('/my', requireAuth, (req, res) => {
  ensurePerformanceDefaults();
  const eid = req.user!.employee_id;
  if (!eid) return res.json({ current: null, history: [], competencies: DEFAULT_COMPETENCIES });
  const current = parseJson(get<any>(`${reviewQuery} WHERE r.employee_id = ? AND c.status = 'open' ORDER BY c.period_start DESC, r.id DESC LIMIT 1`, [eid]), REVIEW_JSON) || null;
  const history = parseJsonAll(all<any>(`${reviewQuery} WHERE r.employee_id = ? AND r.status IN ('completed','acknowledged') ORDER BY c.period_start, r.id`, [eid]), REVIEW_JSON)
    .map((x) => ({ id: x.id, cycle_id: x.cycle_id, cycle_name: x.cycle_name, period_start: x.period_start, period_end: x.period_end, final_rating: x.final_rating, status: x.status, completed_at: x.completed_at, reviewer_name: x.reviewer_name, manager_comments: x.manager_comments }));
  const competencies = current ? competenciesOf(current.cycle_id) : DEFAULT_COMPETENCIES;
  const pending_as_reviewer = get<any>(`SELECT COUNT(*) AS n FROM reviews r JOIN review_cycles c ON c.id = r.cycle_id WHERE c.status = 'open' AND r.status = 'pending_manager' AND r.reviewer_employee_id = ?`, [eid])?.n ?? 0;
  res.json({ current, history, competencies, pending_as_reviewer });
});

r.get('/reviews/:id', requireAuth, (req, res) => {
  const review = loadReview(toInt(req.params.id)!);
  if (!review) throw notFound();
  const own = req.user!.employee_id === review.employee_id;
  if (!own && !canReview(req, review)) throw forbidden();
  res.json({ ...review, competencies: competenciesOf(review.cycle_id), can_review: canReview(req, review), is_own: own });
});

r.put('/reviews/:id/self', requireAuth, wrap(async (req, res) => {
  const review = loadReview(toInt(req.params.id)!);
  if (!review) throw notFound();
  if (req.user!.employee_id !== review.employee_id) throw forbidden('Only the employee can fill in their self-assessment');
  if (review.cycle_status !== 'open') throw badRequest('This review cycle is not open');
  if (review.status !== 'pending_self') throw badRequest('The self-assessment has already been submitted');
  const competencies = competenciesOf(review.cycle_id);
  const data: any = { updated_at: nowIso() };
  if (req.body.self_ratings !== undefined) data.self_ratings = cleanRatings(req.body.self_ratings, competencies, review.rating_scale || 5);
  if (req.body.self_comments !== undefined) data.self_comments = req.body.self_comments ? String(req.body.self_comments).slice(0, 4000) : null;
  const goals = cleanGoals(req.body.goals);
  if (goals) data.goals = goals;
  if (req.body.submit) {
    assertAllRated(data.self_ratings ?? review.self_ratings ?? {}, competencies, 'Self');
    data.status = 'pending_manager';
    data.self_submitted_at = nowIso();
  }
  update('reviews', review.id, data);
  audit(req, req.body.submit ? 'submit_self' : 'save_self', 'review', review.id);
  res.json(loadReview(review.id));
}));

r.put('/reviews/:id/manager', requireAuth, wrap(async (req, res) => {
  const review = loadReview(toInt(req.params.id)!);
  if (!review) throw notFound();
  if (!canReview(req, review)) throw forbidden('You are not the reviewer for this employee');
  if (review.cycle_status !== 'open') throw badRequest('This review cycle is not open');
  if (review.status === 'acknowledged') throw badRequest('This review has been acknowledged and is locked');
  if (review.status === 'pending_self' && !isHr(req)) throw badRequest('The employee has not submitted their self-assessment yet');
  const competencies = competenciesOf(review.cycle_id);
  const scale = review.rating_scale || 5;
  const data: any = { updated_at: nowIso() };
  if (req.body.manager_ratings !== undefined) data.manager_ratings = cleanRatings(req.body.manager_ratings, competencies, scale);
  if (req.body.manager_comments !== undefined) data.manager_comments = req.body.manager_comments ? String(req.body.manager_comments).slice(0, 4000) : null;
  const goals = cleanGoals(req.body.goals);
  if (goals) data.goals = goals;
  const ratings = data.manager_ratings ?? review.manager_ratings ?? {};
  if (req.body.final_rating !== undefined && req.body.final_rating !== null && req.body.final_rating !== '') {
    const fr = toNum(req.body.final_rating);
    if (fr === undefined || fr < 1 || fr > scale) throw badRequest(`final_rating must be between 1 and ${scale}`);
    data.final_rating = round2(fr);
  } else if (req.body.submit || data.manager_ratings !== undefined) {
    data.final_rating = weightedAverage(ratings, competencies);
  }
  if (req.body.submit) {
    assertAllRated(ratings, competencies, 'Manager');
    data.status = 'completed';
    data.completed_at = nowIso();
    if (!review.self_submitted_at) data.self_submitted_at = nowIso();
  }
  update('reviews', review.id, data);
  audit(req, req.body.submit ? 'submit_manager' : 'save_manager', 'review', review.id, { final_rating: data.final_rating });
  res.json(loadReview(review.id));
}));

r.post('/reviews/:id/acknowledge', requireAuth, wrap(async (req, res) => {
  const review = loadReview(toInt(req.params.id)!);
  if (!review) throw notFound();
  if (req.user!.employee_id !== review.employee_id) throw forbidden('Only the employee can acknowledge their review');
  if (review.status !== 'completed') throw badRequest('The review is not completed yet');
  update('reviews', review.id, { status: 'acknowledged', acknowledged_at: nowIso(), updated_at: nowIso() });
  audit(req, 'acknowledge', 'review', review.id);
  res.json(loadReview(review.id));
}));

/** HR may reassign the reviewer. */
r.put('/reviews/:id', requireHr, wrap(async (req, res) => {
  const review = loadReview(toInt(req.params.id)!);
  if (!review) throw notFound();
  const data: any = {};
  if (req.body.reviewer_employee_id !== undefined) {
    const rid = toInt(req.body.reviewer_employee_id) ?? null;
    if (rid && !get('SELECT 1 FROM employees WHERE id = ?', [rid])) throw notFound('Reviewer not found');
    if (rid === review.employee_id) throw badRequest('An employee cannot review themselves');
    data.reviewer_employee_id = rid;
  }
  update('reviews', review.id, { ...data, updated_at: nowIso() });
  audit(req, 'update', 'review', review.id, data);
  res.json(loadReview(review.id));
}));

export default r;
