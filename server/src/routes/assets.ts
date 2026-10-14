import { Router } from 'express';
import { all, get, insert, update, run, parseJson, parseJsonAll, transaction } from '../db.js';
import { requireAuth, requireHr, visibleEmployeeIds } from '../auth.js';
import { badRequest, notFound, pick, requireFields, audit, toInt, nowIso, today, assertDate, wrap } from '../util.js';

const r = Router();
const COLS = ['asset_tag', 'name', 'category', 'serial_number', 'model', 'vendor', 'purchase_date', 'purchase_cost', 'warranty_expiry', 'status', 'condition', 'location', 'specs', 'notes'];
const q = `
  SELECT a.*, aa.id AS assignment_id, aa.employee_id AS assigned_to, aa.assigned_at, aa.expected_return_at,
         e.first_name || ' ' || e.last_name AS assigned_to_name, e.employee_code AS assigned_to_code
  FROM assets a
  LEFT JOIN asset_assignments aa ON aa.asset_id = a.id AND aa.returned_at IS NULL
  LEFT JOIN employees e ON e.id = aa.employee_id`;

function withWarranty(rows: any[]) {
  const t = today();
  rows.forEach((a) => {
    if (!a.warranty_expiry) return (a.warranty_state = 'none');
    const days = Math.ceil((Date.parse(a.warranty_expiry) - Date.parse(t)) / 86400000);
    a.warranty_days = days;
    a.warranty_state = days < 0 ? 'expired' : days <= 30 ? 'warning' : 'ok';
  });
  return rows;
}

export function nextAssetTag(): string {
  const row = get<any>("SELECT asset_tag FROM assets WHERE asset_tag LIKE 'AST-%' ORDER BY CAST(SUBSTR(asset_tag, 5) AS INTEGER) DESC LIMIT 1");
  const n = row ? Number(row.asset_tag.slice(4)) + 1 : 1;
  return `AST-${String(Number.isFinite(n) ? n : 1).padStart(4, '0')}`;
}

r.get('/', requireAuth, (req, res) => {
  const where: string[] = [];
  const params: any[] = [];
  const vis = visibleEmployeeIds(req);
  if (vis) {
    if (!vis.length) return res.json({ items: [], total: 0 });
    where.push(`aa.employee_id IN (${vis.map(() => '?').join(',')})`);
    params.push(...vis);
  }
  if (req.query.status) { where.push('a.status = ?'); params.push(req.query.status); }
  if (req.query.category) { where.push('a.category = ?'); params.push(req.query.category); }
  if (req.query.employee_id) { where.push('aa.employee_id = ?'); params.push(toInt(req.query.employee_id)); }
  if (req.query.q) { where.push('(a.name LIKE ? OR a.asset_tag LIKE ? OR a.serial_number LIKE ? OR a.model LIKE ?)'); params.push(...Array(4).fill(`%${req.query.q}%`)); }
  const rows = parseJsonAll(all(`${q}${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY a.created_at DESC`, params), ['specs']);
  res.json({ items: withWarranty(rows), total: rows.length });
});
r.get('/next-tag', requireHr, (_req, res) => res.json({ asset_tag: nextAssetTag() }));
r.get('/summary', requireHr, (_req, res) => {
  res.json({
    by_status: all('SELECT status, COUNT(*) AS n FROM assets GROUP BY status'),
    by_category: all('SELECT category, COUNT(*) AS n FROM assets GROUP BY category ORDER BY n DESC'),
    total_value: get<any>('SELECT COALESCE(SUM(purchase_cost),0) AS v FROM assets')!.v,
  });
});
r.get('/:id', requireAuth, (req, res) => {
  const row = parseJson(get<any>(`${q} WHERE a.id = ?`, [toInt(req.params.id)]), ['specs']);
  if (!row) throw notFound();
  const history = all(`SELECT aa.*, e.first_name || ' ' || e.last_name AS employee_name, e.employee_code FROM asset_assignments aa JOIN employees e ON e.id = aa.employee_id WHERE aa.asset_id = ? ORDER BY aa.assigned_at DESC`, [row.id]);
  res.json({ ...withWarranty([row])[0], history });
});
r.post('/', requireHr, wrap(async (req, res) => {
  requireFields(req.body, ['name']);
  const data: any = pick(req.body, COLS);
  if (!data.asset_tag) data.asset_tag = nextAssetTag();
  assertDate(data.purchase_date, 'purchase_date');
  assertDate(data.warranty_expiry, 'warranty_expiry');
  if (data.specs && typeof data.specs !== 'object') throw badRequest('specs must be an object');
  const id = insert('assets', { ...data, specs: data.specs ?? {}, created_at: nowIso(), updated_at: nowIso() });
  audit(req, 'create', 'asset', id);
  res.status(201).json(withWarranty([parseJson(get(`${q} WHERE a.id = ?`, [id]), ['specs'])])[0]);
}));
r.put('/:id', requireHr, wrap(async (req, res) => {
  const id = toInt(req.params.id)!;
  const existing = get<any>('SELECT * FROM assets WHERE id = ?', [id]);
  if (!existing) throw notFound();
  const data: any = pick(req.body, COLS);
  assertDate(data.purchase_date, 'purchase_date');
  assertDate(data.warranty_expiry, 'warranty_expiry');
  if (data.status === 'assigned' && existing.status !== 'assigned') throw badRequest('Use the assign action to assign an asset');
  if (existing.status === 'assigned' && data.status && data.status !== 'assigned') throw badRequest('Return the asset before changing its status');
  update('assets', id, { ...data, updated_at: nowIso() });
  audit(req, 'update', 'asset', id);
  res.json(withWarranty([parseJson(get(`${q} WHERE a.id = ?`, [id]), ['specs'])])[0]);
}));
r.delete('/:id', requireHr, (req, res) => {
  const id = toInt(req.params.id)!;
  const a = get<any>('SELECT status FROM assets WHERE id = ?', [id]);
  if (!a) throw notFound();
  if (a.status === 'assigned') throw badRequest('Return the asset before deleting it');
  run('DELETE FROM assets WHERE id = ?', [id]);
  audit(req, 'delete', 'asset', id);
  res.json({ ok: true });
});

r.post('/:id/assign', requireHr, wrap(async (req, res) => {
  const id = toInt(req.params.id)!;
  requireFields(req.body, ['employee_id']);
  const a = get<any>('SELECT * FROM assets WHERE id = ?', [id]);
  if (!a) throw notFound();
  if (a.status !== 'available') throw badRequest(`Asset is ${a.status}; only available assets can be assigned`);
  const emp = get('SELECT 1 FROM employees WHERE id = ?', [toInt(req.body.employee_id)]);
  if (!emp) throw notFound('Employee not found');
  assertDate(req.body.expected_return_at, 'expected_return_at');
  const aid = transaction(() => {
    const x = insert('asset_assignments', {
      asset_id: id, employee_id: toInt(req.body.employee_id), assigned_at: req.body.assigned_at || nowIso(), expected_return_at: req.body.expected_return_at || null,
      assigned_by: req.user!.id, condition_out: req.body.condition_out || a.condition, notes: req.body.notes || null,
    });
    update('assets', id, { status: 'assigned', updated_at: nowIso() });
    return x;
  });
  audit(req, 'assign', 'asset', id, { employee_id: req.body.employee_id, assignment_id: aid });
  res.json(withWarranty([parseJson(get(`${q} WHERE a.id = ?`, [id]), ['specs'])])[0]);
}));
r.post('/:id/return', requireHr, wrap(async (req, res) => {
  const id = toInt(req.params.id)!;
  const open = get<any>('SELECT * FROM asset_assignments WHERE asset_id = ? AND returned_at IS NULL', [id]);
  if (!open) throw badRequest('Asset is not currently assigned');
  const condition = req.body.condition_in || 'good';
  const newStatus = req.body.status && ['available', 'maintenance', 'retired', 'lost'].includes(req.body.status) ? req.body.status : 'available';
  transaction(() => {
    update('asset_assignments', open.id, { returned_at: nowIso(), condition_in: condition, notes: req.body.notes ?? open.notes });
    update('assets', id, { status: newStatus, condition, updated_at: nowIso() });
  });
  audit(req, 'return', 'asset', id, { assignment_id: open.id, status: newStatus });
  res.json(withWarranty([parseJson(get(`${q} WHERE a.id = ?`, [id]), ['specs'])])[0]);
}));

/** Assignments for one employee (self-service + HR). */
r.get('/employee/:employeeId', requireAuth, (req, res) => {
  const eid = toInt(req.params.employeeId)!;
  const vis = visibleEmployeeIds(req);
  if (vis && !vis.includes(eid)) throw notFound();
  res.json(parseJsonAll(all(`SELECT aa.*, a.asset_tag, a.name, a.category, a.model, a.serial_number, a.specs FROM asset_assignments aa JOIN assets a ON a.id = aa.asset_id WHERE aa.employee_id = ? ORDER BY aa.returned_at IS NOT NULL, aa.assigned_at DESC`, [eid]), ['specs']));
});

export default r;
