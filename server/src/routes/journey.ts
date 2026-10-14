import { Router } from 'express';
import { all, get, insert, update, run, parseJson, parseJsonAll, transaction } from '../db.js';
import { requireAuth, requireHr, canAccessEmployee } from '../auth.js';
import { badRequest, notFound, forbidden, pick, requireFields, audit, toInt, nowIso, wrap } from '../util.js';

const r = Router();

// ---------- Stage templates (customisable 10-15 step journey) ----------
const T_COLS = ['name', 'description', 'sort_order', 'color', 'icon', 'owner_role', 'sla_days', 'active'];
r.get('/templates', requireAuth, (_req, res) => res.json(all('SELECT * FROM journey_stage_templates ORDER BY sort_order, id')));
r.post('/templates', requireHr, wrap(async (req, res) => {
  requireFields(req.body, ['name']);
  const data: any = pick(req.body, T_COLS);
  if (data.sort_order === undefined) data.sort_order = (get<any>('SELECT COALESCE(MAX(sort_order), -1) AS m FROM journey_stage_templates')!.m) + 1;
  const id = insert('journey_stage_templates', data);
  audit(req, 'create', 'journey_template', id);
  res.status(201).json(get('SELECT * FROM journey_stage_templates WHERE id = ?', [id]));
}));
r.put('/templates/reorder', requireHr, wrap(async (req, res) => {
  const ids: number[] = Array.isArray(req.body.ids) ? req.body.ids.map(Number) : [];
  if (!ids.length) throw badRequest('ids required');
  transaction(() => ids.forEach((id, i) => update('journey_stage_templates', id, { sort_order: i })));
  res.json(all('SELECT * FROM journey_stage_templates ORDER BY sort_order, id'));
}));
r.put('/templates/:id', requireHr, wrap(async (req, res) => {
  const id = toInt(req.params.id)!;
  if (!get('SELECT 1 FROM journey_stage_templates WHERE id = ?', [id])) throw notFound();
  update('journey_stage_templates', id, pick(req.body, T_COLS));
  audit(req, 'update', 'journey_template', id);
  res.json(get('SELECT * FROM journey_stage_templates WHERE id = ?', [id]));
}));
r.delete('/templates/:id', requireHr, (req, res) => {
  if (!run('DELETE FROM journey_stage_templates WHERE id = ?', [toInt(req.params.id)]).changes) throw notFound();
  audit(req, 'delete', 'journey_template', req.params.id);
  res.json({ ok: true });
});

// ---------- Per-employee journey ----------
const S_COLS = ['name', 'description', 'sort_order', 'color', 'icon', 'status', 'started_at', 'completed_at', 'owner', 'notes', 'checklist'];
function stages(employeeId: number) {
  return parseJsonAll(all('SELECT * FROM journey_stages WHERE employee_id = ? ORDER BY sort_order, id', [employeeId]), ['checklist']);
}
function summary(list: any[]) {
  const done = list.filter((s) => s.status === 'completed' || s.status === 'skipped').length;
  const current = list.find((s) => s.status === 'in_progress') || list.find((s) => s.status === 'pending');
  return { total: list.length, completed: done, percent: list.length ? Math.round((done / list.length) * 100) : 0, current_stage: current?.name ?? null };
}

/** Overview of every employee's journey progress (HR). */
r.get('/overview', requireHr, (_req, res) => {
  const emps = all<any>("SELECT e.id, e.employee_code, e.first_name, e.last_name, e.status, e.join_date, d.name AS department_name, p.title AS position_title FROM employees e LEFT JOIN departments d ON d.id = e.department_id LEFT JOIN positions p ON p.id = e.position_id WHERE e.status != 'exited' ORDER BY e.join_date DESC");
  const allStages = all<any>('SELECT employee_id, status, name, sort_order FROM journey_stages ORDER BY sort_order');
  res.json(emps.map((e) => ({ ...e, journey: summary(allStages.filter((s) => s.employee_id === e.id)) })));
});

r.get('/employee/:employeeId', requireAuth, (req, res) => {
  const eid = toInt(req.params.employeeId)!;
  if (!canAccessEmployee(req, eid)) throw forbidden();
  const emp = get<any>('SELECT e.*, v.title AS vacancy_title, v.opened_at AS vacancy_opened_at FROM employees e LEFT JOIN vacancies v ON v.id = e.vacancy_id WHERE e.id = ?', [eid]);
  if (!emp) throw notFound();
  const list = stages(eid);
  res.json({ employee: { id: emp.id, first_name: emp.first_name, last_name: emp.last_name, employee_code: emp.employee_code, join_date: emp.join_date, status: emp.status, vacancy_id: emp.vacancy_id, vacancy_title: emp.vacancy_title, vacancy_opened_at: emp.vacancy_opened_at }, stages: list, summary: summary(list) });
});

/** (Re)build an employee's stages from the current templates; keeps progress of stages with the same template id. */
r.post('/employee/:employeeId/apply-templates', requireHr, wrap(async (req, res) => {
  const eid = toInt(req.params.employeeId)!;
  if (!get('SELECT 1 FROM employees WHERE id = ?', [eid])) throw notFound();
  const templates = all<any>('SELECT * FROM journey_stage_templates WHERE active = 1 ORDER BY sort_order');
  const existing = stages(eid);
  transaction(() => {
    templates.forEach((t, i) => {
      const cur = existing.find((s) => s.template_id === t.id);
      if (cur) update('journey_stages', cur.id, { sort_order: i, name: cur.name, updated_at: nowIso() });
      else insert('journey_stages', { employee_id: eid, template_id: t.id, name: t.name, description: t.description, sort_order: i, color: t.color, icon: t.icon, status: 'pending', owner: t.owner_role, checklist: '[]', created_at: nowIso(), updated_at: nowIso() });
    });
    if (req.body.remove_others) {
      const keep = new Set(templates.map((t) => t.id));
      existing.filter((s) => s.template_id && !keep.has(s.template_id)).forEach((s) => run('DELETE FROM journey_stages WHERE id = ?', [s.id]));
    }
  });
  res.json({ stages: stages(eid) });
}));

r.post('/employee/:employeeId/stages', requireHr, wrap(async (req, res) => {
  const eid = toInt(req.params.employeeId)!;
  if (!get('SELECT 1 FROM employees WHERE id = ?', [eid])) throw notFound();
  requireFields(req.body, ['name']);
  const data: any = pick(req.body, S_COLS);
  if (data.sort_order === undefined) data.sort_order = (get<any>('SELECT COALESCE(MAX(sort_order), -1) AS m FROM journey_stages WHERE employee_id = ?', [eid])!.m) + 1;
  const id = insert('journey_stages', { employee_id: eid, ...data, checklist: data.checklist ?? [], created_at: nowIso(), updated_at: nowIso() });
  audit(req, 'create', 'journey_stage', id, { employee_id: eid });
  res.status(201).json(parseJson(get('SELECT * FROM journey_stages WHERE id = ?', [id]), ['checklist']));
}));
r.put('/employee/:employeeId/reorder', requireHr, wrap(async (req, res) => {
  const eid = toInt(req.params.employeeId)!;
  const ids: number[] = Array.isArray(req.body.ids) ? req.body.ids.map(Number) : [];
  transaction(() => ids.forEach((id, i) => run('UPDATE journey_stages SET sort_order = ? WHERE id = ? AND employee_id = ?', [i, id, eid])));
  res.json({ stages: stages(eid) });
}));
r.put('/stages/:id', requireAuth, wrap(async (req, res) => {
  const id = toInt(req.params.id)!;
  const s = get<any>('SELECT * FROM journey_stages WHERE id = ?', [id]);
  if (!s) throw notFound();
  if (!canAccessEmployee(req, s.employee_id)) throw forbidden();
  const cols = req.user!.role === 'hr' ? S_COLS : ['checklist', 'notes'];
  const data: any = pick(req.body, cols);
  if (data.status && !['pending', 'in_progress', 'completed', 'skipped'].includes(data.status)) throw badRequest('Invalid status');
  if (data.status === 'in_progress' && !s.started_at && !data.started_at) data.started_at = nowIso();
  if ((data.status === 'completed' || data.status === 'skipped') && !data.completed_at) data.completed_at = nowIso();
  if (data.status === 'pending') { data.started_at = null; data.completed_at = null; }
  if (data.checklist !== undefined && !Array.isArray(data.checklist)) throw badRequest('checklist must be an array');
  update('journey_stages', id, { ...data, updated_at: nowIso() });
  audit(req, 'update', 'journey_stage', id, data);
  res.json(parseJson(get('SELECT * FROM journey_stages WHERE id = ?', [id]), ['checklist']));
}));
r.delete('/stages/:id', requireHr, (req, res) => {
  if (!run('DELETE FROM journey_stages WHERE id = ?', [toInt(req.params.id)]).changes) throw notFound();
  res.json({ ok: true });
});

export default r;
