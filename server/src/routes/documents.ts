import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { all, get, insert, update, run, getSetting, parseJson, parseJsonAll, UPLOAD_DIR } from '../db.js';
import { requireAuth, requireHr, canAccessEmployee, visibleEmployeeIds } from '../auth.js';
import { wrap, badRequest, notFound, forbidden, pick, requireFields, audit, toInt, nowIso, assertDate, today } from '../util.js';
import { DEFAULT_DOCUMENT_SETTINGS } from './settings.js';

const r = Router();

const MIME_BY_FORMAT: Record<string, string[]> = {
  pdf: ['application/pdf'],
  jpg: ['image/jpeg'],
  png: ['image/png'],
};
const MAGIC: Record<string, (b: Buffer) => boolean> = {
  pdf: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-',
  jpg: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  png: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
};
export function formatOf(name: string): string | null {
  const ext = path.extname(name).toLowerCase().replace('.', '');
  if (ext === 'jpeg') return 'jpg';
  return ['pdf', 'jpg', 'png'].includes(ext) ? ext : null;
}

/** Compute expiry colouring for a document: ok | warning | critical | expired | none. */
export function documentStatus(doc: any) {
  const settings = getSetting('documents', DEFAULT_DOCUMENT_SETTINGS);
  const warn = doc.expiry_warning_days ?? settings.expiry_warning_days;
  const crit = doc.expiry_critical_days ?? settings.expiry_critical_days;
  if (!doc.expiry_date) return { expiry_state: 'none', days_to_expiry: null, expiry_color: '#6b7280' };
  const days = Math.ceil((Date.parse(doc.expiry_date + 'T00:00:00Z') - Date.parse(today() + 'T00:00:00Z')) / 86400000);
  let state = 'ok';
  let color = '#16a34a';
  if (days < 0) { state = 'expired'; color = '#dc2626'; }
  else if (days <= crit) { state = 'critical'; color = '#ea580c'; }
  else if (days <= warn) { state = 'warning'; color = '#ca8a04'; }
  return { expiry_state: state, days_to_expiry: days, expiry_color: color };
}

// ---------- Document types (HR-customisable: formats, expiry, size) ----------
const TYPE_COLS = ['name', 'description', 'allowed_formats', 'requires_expiry', 'expiry_warning_days', 'expiry_critical_days', 'required_for_all', 'max_size_mb', 'category', 'active'];
function validateFormats(f: any) {
  if (f === undefined) return undefined;
  if (!Array.isArray(f) || !f.length || f.some((x) => !['pdf', 'jpg', 'png'].includes(x))) throw badRequest('allowed_formats must be a non-empty subset of pdf, jpg, png');
  return f;
}
r.get('/types', requireAuth, (_req, res) => {
  res.json(parseJsonAll(all('SELECT * FROM document_types ORDER BY active DESC, name'), ['allowed_formats']));
});
r.post('/types', requireHr, wrap(async (req, res) => {
  requireFields(req.body, ['name']);
  const data: any = pick(req.body, TYPE_COLS);
  data.allowed_formats = validateFormats(data.allowed_formats) ?? getSetting('documents', DEFAULT_DOCUMENT_SETTINGS).allowed_formats;
  const id = insert('document_types', data);
  audit(req, 'create', 'document_type', id, data);
  res.status(201).json(parseJson(get('SELECT * FROM document_types WHERE id = ?', [id]), ['allowed_formats']));
}));
r.put('/types/:id', requireHr, wrap(async (req, res) => {
  const id = toInt(req.params.id)!;
  if (!get('SELECT 1 FROM document_types WHERE id = ?', [id])) throw notFound();
  const data: any = pick(req.body, TYPE_COLS);
  if (data.allowed_formats !== undefined) data.allowed_formats = validateFormats(data.allowed_formats);
  update('document_types', id, data);
  audit(req, 'update', 'document_type', id, data);
  res.json(parseJson(get('SELECT * FROM document_types WHERE id = ?', [id]), ['allowed_formats']));
}));
r.delete('/types/:id', requireHr, (req, res) => {
  const id = toInt(req.params.id)!;
  const used = get<any>('SELECT COUNT(*) AS n FROM documents WHERE document_type_id = ?', [id])!.n;
  if (used) throw badRequest(`${used} document(s) use this type. Deactivate it instead.`);
  if (!run('DELETE FROM document_types WHERE id = ?', [id]).changes) throw notFound();
  audit(req, 'delete', 'document_type', id);
  res.json({ ok: true });
});

// ---------- Documents ----------
const docQuery = `
  SELECT d.*, t.name AS type_name, t.expiry_warning_days, t.expiry_critical_days, t.category,
         e.first_name || ' ' || e.last_name AS employee_name, e.employee_code
  FROM documents d LEFT JOIN document_types t ON t.id = d.document_type_id LEFT JOIN employees e ON e.id = d.employee_id`;

function withStatus(rows: any[]) {
  rows.forEach((d) => Object.assign(d, documentStatus(d)));
  return rows;
}

r.get('/', requireAuth, (req, res) => {
  const where: string[] = [];
  const params: any[] = [];
  const vis = visibleEmployeeIds(req);
  if (vis) {
    if (!vis.length) return res.json({ items: [], total: 0 });
    where.push(`d.employee_id IN (${vis.map(() => '?').join(',')})`);
    params.push(...vis);
  }
  if (req.query.employee_id) { where.push('d.employee_id = ?'); params.push(toInt(req.query.employee_id)); }
  if (req.query.document_type_id) { where.push('d.document_type_id = ?'); params.push(toInt(req.query.document_type_id)); }
  if (req.query.q) { where.push('(d.title LIKE ? OR d.original_name LIKE ? OR e.first_name LIKE ? OR e.last_name LIKE ?)'); params.push(...Array(4).fill(`%${req.query.q}%`)); }
  let rows = withStatus(all(`${docQuery}${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY d.expiry_date IS NULL, d.expiry_date, d.created_at DESC`, params));
  if (req.query.state) rows = rows.filter((d) => d.expiry_state === req.query.state);
  if (req.query.expiring === '1') rows = rows.filter((d) => ['warning', 'critical', 'expired'].includes(d.expiry_state));
  res.json({ items: rows, total: rows.length });
});

/** Compliance matrix: for each employee, which required document types are missing/expired. */
r.get('/compliance', requireHr, (_req, res) => {
  const types = all<any>('SELECT * FROM document_types WHERE active = 1 AND required_for_all = 1');
  const emps = all<any>("SELECT id, employee_code, first_name, last_name FROM employees WHERE status != 'exited' ORDER BY first_name");
  const docs = withStatus(all(`${docQuery} WHERE d.document_type_id IN (${types.map(() => '?').join(',') || 'NULL'})`, types.map((t) => t.id)));
  const out = emps.map((e) => {
    const cells = types.map((t) => {
      const mine = docs.filter((d) => d.employee_id === e.id && d.document_type_id === t.id);
      const best = mine.sort((a, b) => (b.expiry_date || '9999').localeCompare(a.expiry_date || '9999'))[0];
      return { type_id: t.id, state: best ? best.expiry_state : 'missing', document_id: best?.id ?? null, expiry_date: best?.expiry_date ?? null };
    });
    return { employee: e, cells, missing: cells.filter((c) => c.state === 'missing' || c.state === 'expired').length };
  });
  res.json({ types, rows: out });
});

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => cb(null, `doc_${crypto.randomUUID()}.${formatOf(file.originalname) || 'bin'}`),
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
});

r.post('/', requireAuth, (req, res, next) => {
  upload.single('file')(req, res, (err: any) => {
    if (err) return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: err.message });
    try {
      const file = req.file;
      if (!file) throw badRequest('file is required');
      const cleanup = () => fs.rm(file.path, { force: true }, () => {});
      try {
        const employeeId = toInt(req.body.employee_id);
        if (!employeeId) throw badRequest('employee_id is required');
        if (!canAccessEmployee(req, employeeId)) throw forbidden();
        if (!get('SELECT 1 FROM employees WHERE id = ?', [employeeId])) throw notFound('Employee not found');
        const typeId = toInt(req.body.document_type_id);
        const type = typeId ? parseJson(get<any>('SELECT * FROM document_types WHERE id = ?', [typeId]), ['allowed_formats']) : undefined;
        if (typeId && !type) throw notFound('Document type not found');
        const settings = getSetting('documents', DEFAULT_DOCUMENT_SETTINGS);
        const allowed: string[] = type?.allowed_formats ?? settings.allowed_formats;
        const maxMb: number = type?.max_size_mb ?? settings.max_size_mb;
        const fmt = formatOf(file.originalname);
        if (!fmt || !allowed.includes(fmt)) throw badRequest(`This document must be one of: ${allowed.map((f) => f.toUpperCase()).join(', ')}`);
        if (!MIME_BY_FORMAT[fmt].includes(file.mimetype)) throw badRequest('File content type does not match its extension');
        const head = Buffer.alloc(8);
        const fd = fs.openSync(file.path, 'r');
        fs.readSync(fd, head, 0, 8, 0);
        fs.closeSync(fd);
        if (!MAGIC[fmt](head)) throw badRequest('File content is not a valid ' + fmt.toUpperCase());
        if (file.size > maxMb * 1024 * 1024) throw badRequest(`File exceeds the ${maxMb} MB limit for this document type`);
        const expiry = req.body.expiry_date || null;
        assertDate(expiry, 'expiry_date');
        assertDate(req.body.issued_date || null, 'issued_date');
        if (type?.requires_expiry && !expiry) throw badRequest(`${type.name} requires an expiry date`);
        const id = insert('documents', {
          employee_id: employeeId, document_type_id: typeId ?? null,
          title: String(req.body.title || type?.name || path.parse(file.originalname).name).slice(0, 200),
          original_name: file.originalname.slice(0, 255), stored_name: file.filename, mime: file.mimetype, format: fmt, size_bytes: file.size,
          issued_date: req.body.issued_date || null, expiry_date: expiry, document_number: req.body.document_number || null,
          notes: req.body.notes || null, status: req.user!.role === 'hr' ? 'valid' : 'pending_review', uploaded_by: req.user!.id, created_at: nowIso(),
        });
        audit(req, 'upload', 'document', id, { employee_id: employeeId, format: fmt });
        res.status(201).json(withStatus([get(`${docQuery} WHERE d.id = ?`, [id])])[0]);
      } catch (e) {
        cleanup();
        throw e;
      }
    } catch (e) {
      next(e);
    }
  });
});

r.get('/:id', requireAuth, (req, res) => {
  const row = get<any>(`${docQuery} WHERE d.id = ?`, [toInt(req.params.id)]);
  if (!row) throw notFound();
  if (!canAccessEmployee(req, row.employee_id)) throw forbidden();
  res.json(withStatus([row])[0]);
});
r.get('/:id/file', requireAuth, (req, res) => {
  const row = get<any>('SELECT * FROM documents WHERE id = ?', [toInt(req.params.id)]);
  if (!row) throw notFound();
  if (!canAccessEmployee(req, row.employee_id)) throw forbidden();
  const file = path.join(UPLOAD_DIR, path.basename(row.stored_name));
  if (!fs.existsSync(file)) throw notFound('File missing on disk');
  res.setHeader('Content-Type', row.mime);
  const disposition = req.query.download === '1' ? 'attachment' : 'inline';
  res.setHeader('Content-Disposition', `${disposition}; filename="${encodeURIComponent(row.original_name)}"`);
  res.sendFile(file);
});
r.put('/:id', requireAuth, wrap(async (req, res) => {
  const id = toInt(req.params.id)!;
  const row = get<any>('SELECT * FROM documents WHERE id = ?', [id]);
  if (!row) throw notFound();
  if (!canAccessEmployee(req, row.employee_id)) throw forbidden();
  const cols = req.user!.role === 'hr' ? ['title', 'document_type_id', 'issued_date', 'expiry_date', 'document_number', 'notes', 'status'] : ['title', 'issued_date', 'expiry_date', 'document_number', 'notes'];
  const data: any = pick(req.body, cols);
  assertDate(data.expiry_date, 'expiry_date');
  assertDate(data.issued_date, 'issued_date');
  update('documents', id, data);
  audit(req, 'update', 'document', id, data);
  res.json(withStatus([get(`${docQuery} WHERE d.id = ?`, [id])])[0]);
}));
r.delete('/:id', requireHr, (req, res) => {
  const id = toInt(req.params.id)!;
  const row = get<any>('SELECT * FROM documents WHERE id = ?', [id]);
  if (!row) throw notFound();
  run('DELETE FROM documents WHERE id = ?', [id]);
  fs.rm(path.join(UPLOAD_DIR, path.basename(row.stored_name)), { force: true }, () => {});
  audit(req, 'delete', 'document', id);
  res.json({ ok: true });
});

export default r;
