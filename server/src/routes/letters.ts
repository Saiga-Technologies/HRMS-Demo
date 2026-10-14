import { Router } from 'express';
import PDFDocument from 'pdfkit';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { all, get, insert, update, run, getSetting, parseJson, parseJsonAll, UPLOAD_DIR } from '../db.js';
import { requireAuth, requireHr, isHr } from '../auth.js';
import { wrap, badRequest, notFound, forbidden, pick, requireFields, audit, toInt, nowIso, today } from '../util.js';
import { DEFAULT_COMPANY } from './settings.js';
import { computeBreakdown } from './payroll.js';

/**
 * HR letters: templates with {{placeholders}}, employee self-service requests, HR approval and
 * PDF generation (pdfkit). Generated PDFs are stored under UPLOAD_DIR and also inserted as a
 * `documents` row so they show up in the employee's document list.
 */
const r = Router();

/* ------------------------------------------------------------------ */
/* Defaults                                                            */
/* ------------------------------------------------------------------ */
const DEFAULT_TEMPLATES: { code: string; name: string; category: string; subject: string; self_service: number; requires_approval: number; body: string }[] = [
  {
    code: 'OFFER', name: 'Offer letter', category: 'offer', subject: 'Offer of employment - {{employee.position}}', self_service: 0, requires_approval: 0,
    body: `Dear {{employee.full_name}},

We are pleased to offer you the position of {{employee.position}} in the {{employee.department}} department at {{company.name}}. Your expected date of joining is {{var.joining_date}} and you will report to {{employee.manager}}.

Your annual cost to company (CTC) will be {{salary.ctc_annual}}, with a monthly basic salary of {{salary.basic}}. The detailed salary structure and benefits will be shared with your appointment letter.

This offer is valid until {{var.offer_valid_until}}. Please sign and return a copy of this letter to confirm your acceptance.

We look forward to welcoming you to the team.`,
  },
  {
    code: 'APPOINTMENT', name: 'Appointment letter', category: 'appointment', subject: 'Letter of appointment - {{employee.position}}', self_service: 0, requires_approval: 0,
    body: `Dear {{employee.full_name}},

With reference to your acceptance of our offer, we are pleased to appoint you as {{employee.position}} in the {{employee.department}} department with effect from {{employee.join_date}}. Your employee code is {{employee.employee_code}} and you will report to {{employee.manager}}.

You will be on probation for a period of {{var.probation_months}} months from your date of joining. On satisfactory completion of probation your services will be confirmed in writing.

Your annual CTC will be {{salary.ctc_annual}}. All other terms of employment are governed by the policies of {{company.legal_name}} as amended from time to time.

Please sign the duplicate copy of this letter as a token of your acceptance.`,
  },
  {
    code: 'EXPERIENCE', name: 'Experience certificate', category: 'experience', subject: 'Experience certificate', self_service: 1, requires_approval: 1,
    body: `TO WHOMSOEVER IT MAY CONCERN

This is to certify that {{employee.full_name}} (Employee code: {{employee.employee_code}}) has been employed with {{company.legal_name}} from {{employee.join_date}} to {{employee.exit_date}} as {{employee.position}} in the {{employee.department}} department.

During the tenure with us, {{employee.full_name}} has been found to be sincere, hardworking and dedicated. We wish them every success in their future endeavours.

This certificate is issued at the request of the employee for the purpose of {{var.purpose}}.`,
  },
  {
    code: 'RELIEVING', name: 'Relieving letter', category: 'relieving', subject: 'Relieving letter', self_service: 0, requires_approval: 0,
    body: `Dear {{employee.full_name}},

This is with reference to your resignation from the position of {{employee.position}} in the {{employee.department}} department. We confirm that you have been relieved from the services of {{company.legal_name}} with effect from the close of business on {{var.last_working_day}}.

Your full and final settlement will be processed as per company policy. Please ensure that all company assets have been returned and clearances obtained.

We thank you for your contribution to {{company.name}} and wish you the very best in your future endeavours.`,
  },
  {
    code: 'SALARY_CERT', name: 'Salary certificate', category: 'salary', subject: 'Salary certificate', self_service: 1, requires_approval: 1,
    body: `TO WHOMSOEVER IT MAY CONCERN

This is to certify that {{employee.full_name}} (Employee code: {{employee.employee_code}}) is employed with {{company.legal_name}} as {{employee.position}} in the {{employee.department}} department since {{employee.join_date}}.

The current monthly basic salary is {{salary.basic}} and the monthly gross salary is {{salary.gross}}. The annual cost to company is {{salary.ctc_annual}}.

This certificate is issued at the request of the employee for the purpose of {{var.purpose}} and does not constitute any guarantee or liability on the part of the company.`,
  },
  {
    code: 'ADDRESS_PROOF', name: 'Address proof letter', category: 'address', subject: 'Address proof letter', self_service: 1, requires_approval: 1,
    body: `TO WHOMSOEVER IT MAY CONCERN

This is to certify that {{employee.full_name}} (Employee code: {{employee.employee_code}}), working with {{company.legal_name}} as {{employee.position}}, has declared the following residential address in our records:

{{employee.address}}

This letter is issued at the request of the employee for the purpose of {{var.purpose}}. The company does not take any responsibility for the correctness of the address beyond the records provided by the employee.`,
  },
  {
    code: 'NOC', name: 'No objection certificate', category: 'general', subject: 'No objection certificate', self_service: 1, requires_approval: 1,
    body: `TO WHOMSOEVER IT MAY CONCERN

This is to certify that {{employee.full_name}} (Employee code: {{employee.employee_code}}) is a full-time employee of {{company.legal_name}}, working as {{employee.position}} in the {{employee.department}} department since {{employee.join_date}}.

{{company.name}} has no objection to {{employee.full_name}} {{var.purpose}}. This certificate is issued on the employee's request and does not alter the terms of their employment.

For any clarification, please contact us at {{company.email}} or {{company.phone}}.`,
  },
];

export const PLACEHOLDERS: { key: string; description: string }[] = [
  { key: 'employee.full_name', description: 'Employee full name' },
  { key: 'employee.employee_code', description: 'Employee code' },
  { key: 'employee.position', description: 'Position / job title' },
  { key: 'employee.department', description: 'Department name' },
  { key: 'employee.join_date', description: 'Date of joining' },
  { key: 'employee.exit_date', description: 'Exit date ("till date" while employed)' },
  { key: 'employee.address', description: 'Residential address (address, city, country)' },
  { key: 'employee.email', description: 'Work email' },
  { key: 'employee.manager', description: 'Reporting manager name' },
  { key: 'salary.basic', description: 'Monthly basic salary (latest salary structure)' },
  { key: 'salary.gross', description: 'Monthly gross (latest payslip, else computed from the structure)' },
  { key: 'salary.ctc_annual', description: 'Annual cost to company' },
  { key: 'company.name', description: 'Company display name' },
  { key: 'company.legal_name', description: 'Company legal name' },
  { key: 'company.address', description: 'Company address' },
  { key: 'company.email', description: 'Company HR email' },
  { key: 'company.phone', description: 'Company phone' },
  { key: 'today', description: 'Date of generation' },
  { key: 'letter.ref', description: 'Auto reference number, e.g. HR/LET/2026/0012' },
  { key: 'var.<name>', description: 'Extra variable supplied at request/generation time (e.g. var.purpose, var.effective_date)' },
];

export function ensureLetterDefaults() {
  if (get<any>('SELECT COUNT(*) AS n FROM letter_templates')!.n > 0) return;
  const now = nowIso();
  for (const t of DEFAULT_TEMPLATES) insert('letter_templates', { ...t, active: 1, created_at: now, updated_at: now });
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */
const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

function fmtLongDate(d?: string | null) {
  if (!d) return '';
  const dt = new Date(d.length === 10 ? d + 'T00:00:00Z' : d);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}
function fmtMoney(n: number | null | undefined, currency: string) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '';
  return `${currency} ${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}
export function letterRef(id: number, createdAt?: string) {
  const year = (createdAt || today()).slice(0, 4);
  return `HR/LET/${year}/${String(id).padStart(4, '0')}`;
}
/** Names of {{var.*}} placeholders used by a template. */
export function variableNames(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(PLACEHOLDER_RE)) if (m[1].startsWith('var.')) out.add(m[1].slice(4));
  return [...out];
}

function buildContext(employeeId: number, variables: Record<string, any>, letterId: number, createdAt?: string): Record<string, string> {
  const e = get<any>(`SELECT e.*, d.name AS department_name, p.title AS position_title, m.first_name || ' ' || m.last_name AS manager_name
                      FROM employees e LEFT JOIN departments d ON d.id = e.department_id LEFT JOIN positions p ON p.id = e.position_id LEFT JOIN employees m ON m.id = e.manager_id
                      WHERE e.id = ?`, [employeeId]);
  if (!e) throw notFound('Employee not found');
  const company = { ...DEFAULT_COMPANY, ...getSetting('company', DEFAULT_COMPANY) };
  const currency = company.currency || 'INR';
  const ctx: Record<string, string> = {
    'employee.full_name': `${e.first_name} ${e.last_name}`.trim(),
    'employee.employee_code': e.employee_code,
    'employee.position': e.position_title || '',
    'employee.department': e.department_name || '',
    'employee.join_date': fmtLongDate(e.join_date),
    'employee.exit_date': e.exit_date ? fmtLongDate(e.exit_date) : 'till date',
    'employee.address': [e.address, e.city, e.country].filter(Boolean).join(', '),
    'employee.email': e.email || '',
    'employee.manager': (e.manager_name || '').trim(),
    'company.name': company.name || '',
    'company.legal_name': company.legal_name || company.name || '',
    'company.address': company.address || '',
    'company.email': company.email || '',
    'company.phone': company.phone || '',
    today: fmtLongDate(today()),
    'letter.ref': letterRef(letterId, createdAt),
  };
  // Salary: latest structure for basic / CTC; gross from the latest payslip, else the computed breakdown, else basic.
  const structure = parseJson(get<any>('SELECT * FROM salary_structures WHERE employee_id = ? ORDER BY effective_from DESC, id DESC LIMIT 1', [employeeId]), ['components']);
  if (structure) {
    const cur = structure.currency || currency;
    ctx['salary.basic'] = fmtMoney(structure.basic, cur);
    ctx['salary.ctc_annual'] = fmtMoney(structure.ctc_annual, cur);
    const slip = get<any>('SELECT gross FROM payslips WHERE employee_id = ? ORDER BY id DESC LIMIT 1', [employeeId]);
    let gross: number | null = slip ? Number(slip.gross) : null;
    if (gross === null) {
      try { gross = computeBreakdown(structure).gross; } catch { gross = Number(structure.basic); }
    }
    ctx['salary.gross'] = fmtMoney(gross, cur);
  }
  for (const [k, v] of Object.entries(variables || {})) if (v !== undefined && v !== null && String(v) !== '') ctx[`var.${k}`] = String(v);
  return ctx;
}

export function renderText(text: string, ctx: Record<string, string>) {
  const missing = new Set<string>();
  const out = text.replace(PLACEHOLDER_RE, (_m, key: string) => {
    const v = ctx[key];
    if (v === undefined || v === '') { missing.add(key); return '________'; }
    return v;
  });
  return { text: out, missing: [...missing] };
}

function renderLetter(template: any, employeeId: number, variables: Record<string, any>, letterId: number, createdAt?: string) {
  const ctx = buildContext(employeeId, variables, letterId, createdAt);
  const body = renderText(template.body, ctx);
  const subject = renderText(template.subject || template.name, ctx);
  return { title: subject.text, body: body.text, missing: [...new Set([...subject.missing, ...body.missing])], ref: ctx['letter.ref'], context: ctx };
}

/* ------------------------------------------------------------------ */
/* PDF                                                                 */
/* ------------------------------------------------------------------ */
function hexColor(c: any, fallback = '#4f46e5') {
  return typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c) ? c : fallback;
}
export function buildLetterPdf(opts: { title: string; body: string; ref: string; date: string; signatory: string; company: Record<string, any> }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const company = opts.company;
    const brand = hexColor(company.brand_color);
    const doc = new PDFDocument({ size: 'A4', margins: { top: 56, bottom: 64, left: 60, right: 60 }, bufferPages: true, info: { Title: opts.title, Author: company.name } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const left = doc.page.margins.left;
    const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    // Letterhead
    doc.font('Helvetica-Bold').fontSize(22).fillColor(brand).text(company.name || 'Company', left, 56, { width });
    const contact = [company.legal_name, company.address, company.email, company.phone].filter(Boolean).join('  |  ');
    doc.font('Helvetica').fontSize(8.5).fillColor('#555555').text(contact, left, doc.y + 2, { width });
    const ruleY = doc.y + 8;
    doc.moveTo(left, ruleY).lineTo(left + width, ruleY).lineWidth(2).strokeColor(brand).stroke();
    doc.y = ruleY + 18;

    // Reference and date
    doc.font('Helvetica').fontSize(10).fillColor('#222222');
    const refY = doc.y;
    doc.text(`Ref: ${opts.ref}`, left, refY, { width: width / 2 });
    doc.text(`Date: ${opts.date}`, left + width / 2, refY, { width: width / 2, align: 'right' });
    doc.moveDown(1.5);

    // Title
    doc.font('Helvetica-Bold').fontSize(14).fillColor('#111111').text(opts.title, left, doc.y, { width, align: 'center', underline: true });
    doc.moveDown(1.2);

    // Body paragraphs with 1.4 line spacing
    const size = 11;
    doc.font('Helvetica').fontSize(size).fillColor('#222222');
    const paragraphs = opts.body.replace(/\r\n/g, '\n').split(/\n\s*\n/);
    for (const p of paragraphs) {
      const text = p.trim();
      if (!text) continue;
      const upper = text === text.toUpperCase() && /[A-Z]/.test(text) && text.length < 60;
      doc.font(upper ? 'Helvetica-Bold' : 'Helvetica').text(text, left, doc.y, { width, align: upper ? 'center' : 'justify', lineGap: size * 0.4 });
      doc.moveDown(0.9);
    }

    // Signature block (keep together)
    if (doc.y > doc.page.height - doc.page.margins.bottom - 120) doc.addPage();
    doc.moveDown(1);
    doc.font('Helvetica').fontSize(11).fillColor('#222222').text(`For ${company.name || ''}`, left, doc.y, { width });
    doc.moveDown(3);
    doc.font('Helvetica-Bold').text('Authorised Signatory', left, doc.y, { width });
    doc.font('Helvetica').fontSize(10).fillColor('#444444').text(opts.signatory, left, doc.y, { width });
    doc.text('Human Resources', left, doc.y, { width });

    // Footer on every page
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const y = doc.page.height - 40;
      doc.moveTo(left, y - 8).lineTo(left + width, y - 8).lineWidth(0.5).strokeColor('#cccccc').stroke();
      doc.font('Helvetica').fontSize(8).fillColor('#777777');
      doc.text('This is a system generated letter', left, y, { width: width / 2, lineBreak: false });
      doc.text(`Page ${i - range.start + 1} of ${range.count}`, left + width / 2, y, { width: width / 2, align: 'right', lineBreak: false });
    }
    doc.end();
  });
}

/* ------------------------------------------------------------------ */
/* Templates                                                           */
/* ------------------------------------------------------------------ */
const TEMPLATE_COLS = ['name', 'code', 'category', 'subject', 'body', 'self_service', 'requires_approval', 'active'];
function withVariables(t: any) {
  if (!t) return t;
  return { ...t, variables: variableNames(`${t.subject || ''}\n${t.body || ''}`) };
}

r.get('/templates', requireAuth, (req, res) => {
  ensureLetterDefaults();
  const rows = isHr(req)
    ? all('SELECT * FROM letter_templates ORDER BY active DESC, name')
    : all('SELECT * FROM letter_templates WHERE active = 1 AND self_service = 1 ORDER BY name');
  res.json(rows.map(withVariables));
});
r.get('/placeholders', requireAuth, (_req, res) => res.json(PLACEHOLDERS));
r.post('/templates', requireHr, wrap(async (req, res) => {
  ensureLetterDefaults();
  requireFields(req.body, ['name', 'code', 'subject', 'body']);
  const data: any = pick(req.body, TEMPLATE_COLS);
  data.code = String(data.code).toUpperCase().replace(/[^A-Z0-9_]/g, '_');
  data.category = data.category || 'general';
  data.self_service = data.self_service ? 1 : 0;
  data.requires_approval = data.requires_approval === undefined ? 1 : data.requires_approval ? 1 : 0;
  data.active = data.active === undefined ? 1 : data.active ? 1 : 0;
  const id = insert('letter_templates', { ...data, created_at: nowIso(), updated_at: nowIso() });
  audit(req, 'create', 'letter_template', id, { code: data.code });
  res.status(201).json(withVariables(get('SELECT * FROM letter_templates WHERE id = ?', [id])));
}));
r.put('/templates/:id', requireHr, wrap(async (req, res) => {
  const id = toInt(req.params.id)!;
  if (!get('SELECT 1 FROM letter_templates WHERE id = ?', [id])) throw notFound();
  const data: any = pick(req.body, TEMPLATE_COLS);
  if (data.code !== undefined) data.code = String(data.code).toUpperCase().replace(/[^A-Z0-9_]/g, '_');
  for (const k of ['self_service', 'requires_approval', 'active']) if (data[k] !== undefined) data[k] = data[k] ? 1 : 0;
  update('letter_templates', id, { ...data, updated_at: nowIso() });
  audit(req, 'update', 'letter_template', id, data);
  res.json(withVariables(get('SELECT * FROM letter_templates WHERE id = ?', [id])));
}));
r.delete('/templates/:id', requireHr, (req, res) => {
  const id = toInt(req.params.id)!;
  const used = get<any>("SELECT COUNT(*) AS n FROM letters WHERE template_id = ? AND status IN ('requested','approved')", [id])!.n;
  if (used) throw badRequest(`${used} open request(s) use this template. Deactivate it instead.`);
  if (!run('DELETE FROM letter_templates WHERE id = ?', [id]).changes) throw notFound();
  audit(req, 'delete', 'letter_template', id);
  res.json({ ok: true });
});
r.post('/templates/:id/preview', requireAuth, wrap(async (req, res) => {
  const t = get<any>('SELECT * FROM letter_templates WHERE id = ?', [toInt(req.params.id)]);
  if (!t) throw notFound('Template not found');
  const employeeId = toInt(req.body?.employee_id) ?? req.user!.employee_id ?? undefined;
  if (!employeeId) throw badRequest('employee_id is required');
  if (!isHr(req) && employeeId !== req.user!.employee_id) throw forbidden();
  if (!isHr(req) && !t.self_service) throw forbidden('This template is not available for self-service');
  const nextId = (get<any>('SELECT MAX(id) AS m FROM letters')?.m ?? 0) + 1;
  const out = renderLetter(t, employeeId, req.body?.variables || {}, nextId);
  res.json({ title: out.title, body_rendered: out.body, missing: out.missing, ref: out.ref, variables: variableNames(`${t.subject}\n${t.body}`) });
}));

/* ------------------------------------------------------------------ */
/* Letters                                                             */
/* ------------------------------------------------------------------ */
const letterQuery = `SELECT l.*, e.first_name || ' ' || e.last_name AS employee_name, e.employee_code, d.name AS department_name,
  t.name AS template_name, t.code AS template_code, t.category AS template_category,
  rqe.first_name || ' ' || rqe.last_name AS requested_by_name, ape.first_name || ' ' || ape.last_name AS approved_by_name
  FROM letters l JOIN employees e ON e.id = l.employee_id LEFT JOIN departments d ON d.id = e.department_id
  LEFT JOIN letter_templates t ON t.id = l.template_id
  LEFT JOIN users rq ON rq.id = l.requested_by LEFT JOIN employees rqe ON rqe.id = rq.employee_id
  LEFT JOIN users ap ON ap.id = l.approved_by LEFT JOIN employees ape ON ape.id = ap.employee_id`;

function loadLetter(id: number) {
  return parseJson(get<any>(`${letterQuery} WHERE l.id = ?`, [id]), ['variables']);
}
function canSee(req: any, letter: any) {
  return isHr(req) || (req.user?.employee_id && req.user.employee_id === letter.employee_id);
}
function userEmployeeName(userId: number | null | undefined): string {
  if (!userId) return 'HR';
  const row = get<any>('SELECT e.first_name, e.last_name, u.email FROM users u LEFT JOIN employees e ON e.id = u.employee_id WHERE u.id = ?', [userId]);
  if (!row) return 'HR';
  return row.first_name ? `${row.first_name} ${row.last_name}`.trim() : row.email;
}

r.get('/', requireAuth, (req, res) => {
  ensureLetterDefaults();
  const where: string[] = [];
  const params: any[] = [];
  if (!isHr(req)) {
    if (!req.user!.employee_id) return res.json([]);
    where.push('l.employee_id = ?');
    params.push(req.user!.employee_id);
  }
  if (req.query.employee_id) { where.push('l.employee_id = ?'); params.push(toInt(req.query.employee_id)); }
  if (req.query.status) { where.push('l.status = ?'); params.push(String(req.query.status)); }
  if (req.query.template_id) { where.push('l.template_id = ?'); params.push(toInt(req.query.template_id)); }
  res.json(parseJsonAll(all(`${letterQuery}${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY l.created_at DESC, l.id DESC`, params), ['variables']));
});

r.get('/summary', requireHr, (_req, res) => {
  ensureLetterDefaults();
  const byStatus: Record<string, number> = { requested: 0, approved: 0, generated: 0, rejected: 0 };
  for (const row of all<any>('SELECT status, COUNT(*) AS n FROM letters GROUP BY status')) byStatus[row.status] = row.n;
  const byTemplate = all<any>(`SELECT t.id, t.name, t.code, COUNT(l.id) AS n, SUM(CASE WHEN l.status = 'generated' THEN 1 ELSE 0 END) AS generated
                               FROM letter_templates t LEFT JOIN letters l ON l.template_id = t.id GROUP BY t.id ORDER BY n DESC, t.name`);
  res.json({ by_status: byStatus, by_template: byTemplate, total: Object.values(byStatus).reduce((a, b) => a + b, 0) });
});

r.post('/', requireAuth, wrap(async (req, res) => {
  ensureLetterDefaults();
  requireFields(req.body, ['template_id']);
  const t = get<any>('SELECT * FROM letter_templates WHERE id = ?', [toInt(req.body.template_id)]);
  if (!t || !t.active) throw notFound('Template not found');
  const hr = isHr(req);
  let employeeId = toInt(req.body.employee_id);
  if (!hr) {
    if (!req.user!.employee_id) throw forbidden('Your login is not linked to an employee');
    if (employeeId && employeeId !== req.user!.employee_id) throw forbidden('You can only request letters for yourself');
    employeeId = req.user!.employee_id;
    if (!t.self_service) throw forbidden('This letter must be issued by HR');
  }
  if (!employeeId) throw badRequest('employee_id is required');
  const emp = get<any>('SELECT id FROM employees WHERE id = ?', [employeeId]);
  if (!emp) throw notFound('Employee not found');
  const variables = req.body.variables && typeof req.body.variables === 'object' ? req.body.variables : {};
  const now = nowIso();
  const direct = hr || !t.requires_approval;
  const id = insert('letters', {
    employee_id: employeeId, template_id: t.id, title: t.name, variables, status: direct ? 'approved' : 'requested',
    reason: req.body.reason ? String(req.body.reason).slice(0, 500) : null, requested_by: req.user!.id,
    approved_by: direct ? req.user!.id : null, approved_at: direct ? now : null, created_at: now,
  });
  // Title with placeholders resolved (falls back to the template name when rendering fails).
  try { update('letters', id, { title: renderLetter(t, employeeId, variables, id, now).title }); } catch { /* keep template name */ }
  audit(req, 'create', 'letter', id, { template: t.code, employee_id: employeeId });
  res.status(201).json(loadLetter(id));
}));

r.get('/:id', requireAuth, (req, res) => {
  const row = loadLetter(toInt(req.params.id)!);
  if (!row) throw notFound();
  if (!canSee(req, row)) throw forbidden();
  res.json(row);
});

async function generate(req: any, letter: any) {
  const t = get<any>('SELECT * FROM letter_templates WHERE id = ?', [letter.template_id]);
  if (!t) throw badRequest('The template for this letter no longer exists');
  const variables = typeof letter.variables === 'string' ? JSON.parse(letter.variables || '{}') : letter.variables || {};
  const rendered = renderLetter(t, letter.employee_id, variables, letter.id, letter.created_at);
  const company = { ...DEFAULT_COMPANY, ...getSetting('company', DEFAULT_COMPANY) };
  const approvedBy = letter.approved_by || req.user.id;
  const pdf = await buildLetterPdf({ title: rendered.title, body: rendered.body, ref: rendered.ref, date: rendered.context.today, signatory: userEmployeeName(approvedBy), company });
  const storedName = `letter_${crypto.randomUUID()}.pdf`;
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  fs.writeFileSync(path.join(UPLOAD_DIR, storedName), pdf);
  // Replace a previously generated file / document row when regenerating.
  if (letter.pdf_stored_name) fs.rm(path.join(UPLOAD_DIR, path.basename(letter.pdf_stored_name)), { force: true }, () => {});
  if (letter.document_id) run('DELETE FROM documents WHERE id = ?', [letter.document_id]);
  const safeTitle = rendered.title.replace(/[^a-zA-Z0-9 _-]/g, '').trim() || 'Letter';
  const docId = insert('documents', {
    employee_id: letter.employee_id, document_type_id: null, title: rendered.title.slice(0, 200), original_name: `${safeTitle}.pdf`.slice(0, 255),
    stored_name: storedName, mime: 'application/pdf', format: 'pdf', size_bytes: pdf.length, issued_date: today(), expiry_date: null,
    document_number: rendered.ref, notes: `Generated from letter template ${t.code}`, status: 'valid', uploaded_by: req.user.id, created_at: nowIso(),
  });
  update('letters', letter.id, {
    title: rendered.title, body_rendered: rendered.body, pdf_stored_name: storedName, document_id: docId, status: 'generated',
    approved_by: approvedBy, approved_at: letter.approved_at || nowIso(), generated_at: nowIso(),
  });
  audit(req, 'generate', 'letter', letter.id, { document_id: docId, ref: rendered.ref, missing: rendered.missing });
  return { ...loadLetter(letter.id), missing: rendered.missing };
}

r.post('/:id/approve', requireHr, wrap(async (req, res) => {
  const letter = loadLetter(toInt(req.params.id)!);
  if (!letter) throw notFound();
  if (letter.status !== 'requested') throw badRequest(`Letter is already ${letter.status}`);
  update('letters', letter.id, { status: 'approved', approved_by: req.user!.id, approved_at: nowIso(), note: req.body?.note ? String(req.body.note).slice(0, 500) : letter.note });
  audit(req, 'approve', 'letter', letter.id);
  if (req.body?.generate) return res.json(await generate(req, loadLetter(letter.id)));
  res.json(loadLetter(letter.id));
}));
r.post('/:id/reject', requireHr, wrap(async (req, res) => {
  const letter = loadLetter(toInt(req.params.id)!);
  if (!letter) throw notFound();
  if (letter.status === 'generated') throw badRequest('A generated letter cannot be rejected; delete it instead');
  update('letters', letter.id, { status: 'rejected', approved_by: req.user!.id, approved_at: nowIso(), note: req.body?.note ? String(req.body.note).slice(0, 500) : null });
  audit(req, 'reject', 'letter', letter.id, { note: req.body?.note });
  res.json(loadLetter(letter.id));
}));
r.post('/:id/generate', requireHr, wrap(async (req, res) => {
  const letter = loadLetter(toInt(req.params.id)!);
  if (!letter) throw notFound();
  if (letter.status === 'rejected') throw badRequest('A rejected letter cannot be generated');
  if (req.body?.variables && typeof req.body.variables === 'object') {
    letter.variables = { ...(letter.variables || {}), ...req.body.variables };
    update('letters', letter.id, { variables: letter.variables });
  }
  res.json(await generate(req, letter));
}));
r.get('/:id/pdf', requireAuth, (req, res) => {
  const letter = loadLetter(toInt(req.params.id)!);
  if (!letter) throw notFound();
  if (!canSee(req, letter)) throw forbidden();
  if (letter.status !== 'generated' || !letter.pdf_stored_name) throw badRequest('Letter has not been generated yet');
  const file = path.join(UPLOAD_DIR, path.basename(letter.pdf_stored_name));
  if (!fs.existsSync(file)) throw notFound('File missing on disk');
  res.setHeader('Content-Type', 'application/pdf');
  const disposition = req.query.download === '1' ? 'attachment' : 'inline';
  res.setHeader('Content-Disposition', `${disposition}; filename="${encodeURIComponent((letter.title || 'letter').replace(/[^a-zA-Z0-9 _-]/g, '') || 'letter')}.pdf"`);
  res.sendFile(file);
});
r.delete('/:id', requireHr, (req, res) => {
  const letter = loadLetter(toInt(req.params.id)!);
  if (!letter) throw notFound();
  run('DELETE FROM letters WHERE id = ?', [letter.id]);
  if (letter.document_id) run('DELETE FROM documents WHERE id = ?', [letter.document_id]);
  if (letter.pdf_stored_name) fs.rm(path.join(UPLOAD_DIR, path.basename(letter.pdf_stored_name)), { force: true }, () => {});
  audit(req, 'delete', 'letter', letter.id);
  res.json({ ok: true });
});

export default r;
