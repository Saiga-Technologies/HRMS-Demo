import { Router } from 'express';
import { all, get, insert, update, run } from '../db.js';
import { requireAuth, requireHr } from '../auth.js';
import { wrap, badRequest, notFound, pick, requireFields, audit, toInt, nowIso } from '../util.js';

const r = Router();

// ---------- Departments ----------
const DEPT_COLS = ['name', 'code', 'parent_id', 'head_employee_id', 'description', 'color', 'sort_order', 'active'];
const deptQuery = `
  SELECT d.*, p.name AS parent_name,
         (SELECT COUNT(*) FROM employees e WHERE e.department_id = d.id AND e.status != 'exited') AS employee_count,
         (SELECT COUNT(*) FROM positions po WHERE po.department_id = d.id AND po.active = 1) AS position_count,
         h.first_name || ' ' || h.last_name AS head_name
  FROM departments d LEFT JOIN departments p ON p.id = d.parent_id
  LEFT JOIN employees h ON h.id = d.head_employee_id`;

r.get('/departments', requireAuth, (_req, res) => {
  res.json(all(`${deptQuery} ORDER BY d.sort_order, d.name`));
});
r.post('/departments', requireHr, wrap(async (req, res) => {
  requireFields(req.body, ['name']);
  const data = pick(req.body, DEPT_COLS);
  const id = insert('departments', { ...data, created_at: nowIso() });
  audit(req, 'create', 'department', id, data);
  res.status(201).json(get(`${deptQuery} WHERE d.id = ?`, [id]));
}));
r.put('/departments/:id', requireHr, wrap(async (req, res) => {
  const id = toInt(req.params.id)!;
  if (!get('SELECT 1 FROM departments WHERE id = ?', [id])) throw notFound();
  const data: any = pick(req.body, DEPT_COLS);
  if (data.parent_id !== undefined && data.parent_id !== null) {
    if (Number(data.parent_id) === id) throw badRequest('A department cannot be its own parent');
    if (isDescendantDept(Number(data.parent_id), id)) throw badRequest('Cannot move a department under one of its own children');
  }
  update('departments', id, data);
  audit(req, 'update', 'department', id, data);
  res.json(get(`${deptQuery} WHERE d.id = ?`, [id]));
}));
r.delete('/departments/:id', requireHr, (req, res) => {
  const id = toInt(req.params.id)!;
  const used = get<any>('SELECT COUNT(*) AS n FROM employees WHERE department_id = ?', [id])!.n;
  if (used) throw badRequest(`Department still has ${used} employee(s). Reassign them first.`);
  run('UPDATE departments SET parent_id = NULL WHERE parent_id = ?', [id]);
  run('UPDATE positions SET department_id = NULL WHERE department_id = ?', [id]);
  if (!run('DELETE FROM departments WHERE id = ?', [id]).changes) throw notFound();
  audit(req, 'delete', 'department', id);
  res.json({ ok: true });
});
function isDescendantDept(candidate: number, ancestor: number): boolean {
  let cur: number | null = candidate;
  const seen = new Set<number>();
  while (cur != null && !seen.has(cur)) {
    if (cur === ancestor) return true;
    seen.add(cur);
    cur = get<any>('SELECT parent_id FROM departments WHERE id = ?', [cur])?.parent_id ?? null;
  }
  return false;
}

// ---------- Positions ----------
const POS_COLS = ['title', 'code', 'department_id', 'reports_to_position_id', 'level', 'grade', 'headcount', 'description', 'active'];
const posQuery = `
  SELECT p.*, d.name AS department_name, rp.title AS reports_to_title,
         (SELECT COUNT(*) FROM employees e WHERE e.position_id = p.id AND e.status != 'exited') AS filled,
         (SELECT COUNT(*) FROM job_descriptions j WHERE j.position_id = p.id) AS jd_count
  FROM positions p LEFT JOIN departments d ON d.id = p.department_id
  LEFT JOIN positions rp ON rp.id = p.reports_to_position_id`;

r.get('/positions', requireAuth, (req, res) => {
  const where = req.query.department_id ? ' WHERE p.department_id = ?' : '';
  const params = req.query.department_id ? [toInt(req.query.department_id)] : [];
  res.json(all(`${posQuery}${where} ORDER BY p.level, p.title`, params));
});
r.post('/positions', requireHr, wrap(async (req, res) => {
  requireFields(req.body, ['title']);
  const data = pick(req.body, POS_COLS);
  const id = insert('positions', { ...data, created_at: nowIso() });
  audit(req, 'create', 'position', id, data);
  res.status(201).json(get(`${posQuery} WHERE p.id = ?`, [id]));
}));
r.put('/positions/:id', requireHr, wrap(async (req, res) => {
  const id = toInt(req.params.id)!;
  if (!get('SELECT 1 FROM positions WHERE id = ?', [id])) throw notFound();
  const data: any = pick(req.body, POS_COLS);
  if (data.reports_to_position_id !== undefined && Number(data.reports_to_position_id) === id) throw badRequest('A position cannot report to itself');
  update('positions', id, data);
  audit(req, 'update', 'position', id, data);
  res.json(get(`${posQuery} WHERE p.id = ?`, [id]));
}));
r.delete('/positions/:id', requireHr, (req, res) => {
  const id = toInt(req.params.id)!;
  const used = get<any>('SELECT COUNT(*) AS n FROM employees WHERE position_id = ?', [id])!.n;
  if (used) throw badRequest(`Position is held by ${used} employee(s). Reassign them first.`);
  run('UPDATE positions SET reports_to_position_id = NULL WHERE reports_to_position_id = ?', [id]);
  if (!run('DELETE FROM positions WHERE id = ?', [id]).changes) throw notFound();
  audit(req, 'delete', 'position', id);
  res.json({ ok: true });
});

// ---------- Org tree ----------
// mode=reporting  -> employees nested by manager_id
// mode=department -> departments nested by parent_id, each containing positions and employees
r.get('/tree', requireAuth, (req, res) => {
  const mode = req.query.mode === 'department' ? 'department' : 'reporting';
  const employees = all<any>(
    `SELECT e.id, e.employee_code, e.first_name, e.last_name, e.email, e.photo_path, e.manager_id, e.department_id, e.position_id, e.status,
            d.name AS department_name, d.color AS department_color, p.title AS position_title
     FROM employees e LEFT JOIN departments d ON d.id = e.department_id LEFT JOIN positions p ON p.id = e.position_id
     WHERE e.status != 'exited' ORDER BY e.first_name`,
  );
  if (mode === 'reporting') {
    const byId = new Map<number, any>();
    employees.forEach((e) => byId.set(e.id, { type: 'employee', ...e, children: [] }));
    const roots: any[] = [];
    for (const n of byId.values()) {
      const parent = n.manager_id ? byId.get(n.manager_id) : undefined;
      if (parent && parent !== n) parent.children.push(n);
      else roots.push(n);
    }
    return res.json({ mode, roots, total: employees.length });
  }
  const depts = all<any>('SELECT * FROM departments WHERE active = 1 ORDER BY sort_order, name');
  const positions = all<any>('SELECT * FROM positions WHERE active = 1 ORDER BY level, title');
  const dById = new Map<number, any>();
  depts.forEach((d) => dById.set(d.id, { type: 'department', ...d, positions: [], employees: [], children: [] }));
  positions.forEach((p) => {
    const d = p.department_id ? dById.get(p.department_id) : undefined;
    if (d) d.positions.push({ type: 'position', ...p, employees: [] });
  });
  const unassigned: any[] = [];
  employees.forEach((e) => {
    const d = e.department_id ? dById.get(e.department_id) : undefined;
    if (!d) return unassigned.push({ type: 'employee', ...e });
    const pos = e.position_id ? d.positions.find((p: any) => p.id === e.position_id) : undefined;
    if (pos) pos.employees.push({ type: 'employee', ...e });
    else d.employees.push({ type: 'employee', ...e });
  });
  const roots: any[] = [];
  for (const d of dById.values()) {
    const parent = d.parent_id ? dById.get(d.parent_id) : undefined;
    if (parent && parent !== d) parent.children.push(d);
    else roots.push(d);
  }
  res.json({ mode, roots, unassigned, total: employees.length });
});

/** Re-parent a node in the tree. Used by drag & drop in the UI. */
r.post('/tree/move', requireHr, wrap(async (req, res) => {
  const { type, id, new_parent_id } = req.body || {};
  const nid = toInt(id);
  const pid = new_parent_id == null ? null : toInt(new_parent_id);
  if (!nid) throw badRequest('id is required');
  if (type === 'employee') {
    if (pid === nid) throw badRequest('An employee cannot report to themselves');
    if (pid != null && isDescendantEmp(pid, nid)) throw badRequest('Cannot move a manager under their own report');
    if (!update('employees', nid, { manager_id: pid, updated_at: nowIso() })) throw notFound();
  } else if (type === 'department') {
    if (pid === nid) throw badRequest('A department cannot be its own parent');
    if (pid != null && isDescendantDept(pid, nid)) throw badRequest('Cannot move a department under one of its own children');
    if (!update('departments', nid, { parent_id: pid })) throw notFound();
  } else if (type === 'position') {
    if (!update('positions', nid, { department_id: pid })) throw notFound();
  } else throw badRequest('type must be employee, department or position');
  audit(req, 'move', type, nid, { new_parent_id: pid });
  res.json({ ok: true });
}));
function isDescendantEmp(candidate: number, ancestor: number): boolean {
  let cur: number | null = candidate;
  const seen = new Set<number>();
  while (cur != null && !seen.has(cur)) {
    if (cur === ancestor) return true;
    seen.add(cur);
    cur = get<any>('SELECT manager_id FROM employees WHERE id = ?', [cur])?.manager_id ?? null;
  }
  return false;
}

export default r;
