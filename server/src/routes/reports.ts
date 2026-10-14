import { Router } from 'express';
import type { Request, Response } from 'express';
import PDFDocument from 'pdfkit';
import { all, get, getSetting } from '../db.js';
import { requireAuth, canAccessEmployee } from '../auth.js';
import { approvableEmployeeIds, canApproveFor } from '../approvers.js';
import { badRequest, forbidden, notFound, toInt, today, wrap, eachDay, assertDate } from '../util.js';
import { DEFAULT_COMPANY } from './settings.js';
import { attendanceSettings, tzOffsetMinutes } from './attendance.js';

/**
 * Attendance reports with full filter customisation and CSV / PDF export. Mounted at /api/reports.
 *
 *  GET /attendance                      filters below, format=json|csv|pdf, group_by, sort, columns
 *  GET /attendance/late-comers          employees ranked by late days (from, to, min_count, format)
 *  GET /attendance/employee/:id         one employee's statement for a period (from, to, format=json|csv|pdf)
 *  GET /attendance/columns              column catalogue for the report builder
 *
 * Role scoping: employees see only themselves, managers their reporting chain, HR everyone.
 */
const r = Router();

// ---------- Formatting helpers ----------
const STATUSES = ['present', 'half_day', 'absent', 'leave', 'holiday', 'weekend', 'wfh'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const fmtDate = (d?: string | null) => (d ? `${d.slice(8, 10)} ${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}` : '');
export const fmtHHMM = (min?: number | null) => (min === null || min === undefined ? '' : `${String(Math.floor(Math.abs(min) / 60)).padStart(2, '0')}:${String(Math.abs(min) % 60).padStart(2, '0')}`);
/** Local wall-clock time of an ISO timestamp (uses the same offset as late-mark computation). */
export function fmtTime(iso?: string | null) {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const d = new Date(t + tzOffsetMinutes() * 60000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}
export function fmtDateTime(iso?: string | null) {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const d = new Date(t + tzOffsetMinutes() * 60000);
  return `${fmtDate(d.toISOString().slice(0, 10))} ${fmtTime(iso)}`;
}
const label = (s?: string | null) => (s ? s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : '');
const weekday = (d: string) => WEEKDAYS[new Date(d + 'T00:00:00Z').getUTCDay()];
const csvCell = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
export function toCsv(headers: string[], rows: (string | number | null | undefined)[][]) {
  return [headers.map(csvCell).join(','), ...rows.map((row) => row.map(csvCell).join(','))].join('\r\n') + '\r\n';
}
/** CSV from ragged rows (used for statements that carry a key/value preamble before the table). */
export function csvLines(rows: (string | number | null | undefined)[][]) {
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
const listParam = (v: any): string[] => (v === undefined || v === null || v === '' ? [] : String(v).split(',').map((s) => s.trim()).filter(Boolean));
const intList = (v: any) => listParam(v).map((x) => toInt(x)).filter((x): x is number => x !== undefined);
const flag = (v: any) => v === '1' || v === 'true' || v === true;
function monthRange() {
  const t = today();
  const [y, m] = t.split('-').map(Number);
  return { from: `${t.slice(0, 7)}-01`, to: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) };
}

// ---------- Scoping ----------
/** Employee ids visible to the user (undefined = everyone for HR). */
function reportScope(req: Request): number[] | undefined {
  if (req.user!.role === 'hr') return undefined;
  const ids = approvableEmployeeIds(req) || [];
  if (req.user!.employee_id && !ids.includes(req.user!.employee_id)) ids.push(req.user!.employee_id);
  return ids;
}

// ---------- Row model & columns ----------
export interface ReportRow {
  date: string; employee_id: number; employee_code: string; employee_name: string; department_id: number | null; department_name: string | null;
  status: string; punch_in_at: string | null; punch_out_at: string | null; work_minutes: number; break_minutes: number; late_minutes: number; overtime_minutes: number;
  punch_in_within_fence: number | null; punch_out_within_fence: number | null; punch_in_distance_m: number | null; punch_out_distance_m: number | null; punch_in_location_name: string | null; punch_out_location_name: string | null;
  source: string; corrected_by_name: string | null; corrected_at: string | null; correction_id: number | null; appeal_kind: string | null; appeal_reason: string | null; notes: string | null;
  shortfall_minutes: number; synthetic: boolean; record_id: number | null;
}
interface ColumnDef { header: string; width: number; align?: 'right' | 'left'; text: (r: ReportRow) => string; value: (r: ReportRow) => any; group?: 'identity' | 'time' | 'geo' | 'audit' }
const fence = (w: number | null, d: number | null, name: string | null) => (w === null || w === undefined ? '' : w ? `Inside${name ? ` ${name}` : ''}` : `Outside ${d !== null && d !== undefined ? `${Math.round(d)} m` : ''}${name ? ` from ${name}` : ''}`.replace(/\s+/g, ' ').trim());
export const COLUMNS: Record<string, ColumnDef> = {
  date: { header: 'Date', width: 7, text: (r) => fmtDate(r.date), value: (r) => r.date, group: 'identity' },
  day: { header: 'Day', width: 4, text: (r) => weekday(r.date), value: (r) => weekday(r.date), group: 'identity' },
  employee_code: { header: 'Code', width: 6, text: (r) => r.employee_code, value: (r) => r.employee_code, group: 'identity' },
  employee_name: { header: 'Employee', width: 11, text: (r) => r.employee_name, value: (r) => r.employee_name, group: 'identity' },
  department: { header: 'Department', width: 9, text: (r) => r.department_name || '', value: (r) => r.department_name, group: 'identity' },
  status: { header: 'Status', width: 6, text: (r) => label(r.status), value: (r) => r.status, group: 'identity' },
  punch_in: { header: 'In', width: 5, text: (r) => fmtTime(r.punch_in_at), value: (r) => r.punch_in_at, group: 'time' },
  punch_out: { header: 'Out', width: 5, text: (r) => fmtTime(r.punch_out_at), value: (r) => r.punch_out_at, group: 'time' },
  work: { header: 'Work', width: 5, align: 'right', text: (r) => fmtHHMM(r.work_minutes), value: (r) => r.work_minutes, group: 'time' },
  break: { header: 'Break', width: 5, align: 'right', text: (r) => fmtHHMM(r.break_minutes), value: (r) => r.break_minutes, group: 'time' },
  late: { header: 'Late', width: 5, align: 'right', text: (r) => (r.late_minutes ? fmtHHMM(r.late_minutes) : ''), value: (r) => r.late_minutes, group: 'time' },
  overtime: { header: 'Overtime', width: 6, align: 'right', text: (r) => (r.overtime_minutes ? fmtHHMM(r.overtime_minutes) : ''), value: (r) => r.overtime_minutes, group: 'time' },
  shortfall: { header: 'Shortfall', width: 6, align: 'right', text: (r) => (r.shortfall_minutes > 0 ? fmtHHMM(r.shortfall_minutes) : ''), value: (r) => r.shortfall_minutes, group: 'time' },
  geofence_in: { header: 'Geofence in', width: 9, text: (r) => fence(r.punch_in_within_fence, r.punch_in_distance_m, r.punch_in_location_name), value: (r) => r.punch_in_within_fence, group: 'geo' },
  geofence_out: { header: 'Geofence out', width: 9, text: (r) => fence(r.punch_out_within_fence, r.punch_out_distance_m, r.punch_out_location_name), value: (r) => r.punch_out_within_fence, group: 'geo' },
  source: { header: 'Source', width: 6, text: (r) => label(r.source), value: (r) => r.source, group: 'audit' },
  corrected_by: { header: 'Changed by', width: 9, text: (r) => r.corrected_by_name || '', value: (r) => r.corrected_by_name, group: 'audit' },
  corrected_at: { header: 'Changed at', width: 9, text: (r) => fmtDateTime(r.corrected_at), value: (r) => r.corrected_at, group: 'audit' },
  appeal: { header: 'Appeal', width: 10, text: (r) => (r.correction_id ? `#${r.correction_id} ${label(r.appeal_kind)}${r.appeal_reason ? ` – ${r.appeal_reason}` : ''}` : ''), value: (r) => r.correction_id, group: 'audit' },
  notes: { header: 'Notes', width: 12, text: (r) => r.notes || '', value: (r) => r.notes, group: 'audit' },
};
export const DEFAULT_COLUMNS = ['date', 'day', 'employee_code', 'employee_name', 'department', 'status', 'punch_in', 'punch_out', 'work', 'break', 'late', 'overtime', 'geofence_in', 'geofence_out', 'source'];
const GROUP_COLUMNS: { key: string; header: string; width: number; align?: 'right' }[] = [
  { key: 'group', header: 'Group', width: 14 }, { key: 'days', header: 'Days', width: 4, align: 'right' }, { key: 'present', header: 'Present', width: 5, align: 'right' }, { key: 'half_day', header: 'Half', width: 4, align: 'right' },
  { key: 'absent', header: 'Absent', width: 5, align: 'right' }, { key: 'leave', header: 'Leave', width: 4, align: 'right' }, { key: 'late_days', header: 'Late days', width: 5, align: 'right' }, { key: 'avg_late', header: 'Avg late', width: 5, align: 'right' },
  { key: 'work', header: 'Work', width: 6, align: 'right' }, { key: 'avg_work', header: 'Avg work', width: 6, align: 'right' }, { key: 'break', header: 'Break', width: 5, align: 'right' }, { key: 'overtime', header: 'Overtime', width: 6, align: 'right' },
  { key: 'outside_fence', header: 'Outside fence', width: 6, align: 'right' }, { key: 'corrected', header: 'Corrected', width: 6, align: 'right' },
];

// ---------- Query & filters ----------
export interface ReportFilters {
  from: string; to: string; department_id: number[]; employee_id: number[]; status: string[]; late_only: boolean; late_more_than?: number; work_less_than?: number; work_more_than?: number; break_more_than?: number;
  outside_fence: boolean; corrected_only: boolean; include_absent: boolean; group_by: 'none' | 'employee' | 'department' | 'date'; sort: string; columns: string[]; format: 'json' | 'csv' | 'pdf';
}
export function parseFilters(q: any): ReportFilters {
  const month = monthRange();
  assertDate(q.from, 'from'); assertDate(q.to, 'to');
  const from = q.from ? String(q.from) : month.from, to = q.to ? String(q.to) : month.to;
  if (to < from) throw badRequest('to must be on or after from');
  if (eachDay(from, to).length > 400) throw badRequest('Reports are limited to 400 days per run');
  const status = listParam(q.status).filter((s) => STATUSES.includes(s));
  const group_by = ['employee', 'department', 'date'].includes(String(q.group_by)) ? (String(q.group_by) as ReportFilters['group_by']) : 'none';
  const columns = listParam(q.columns).filter((c) => COLUMNS[c]);
  const format = q.format === 'csv' || q.format === 'pdf' ? q.format : 'json';
  return { from, to, department_id: intList(q.department_id), employee_id: intList(q.employee_id), status, late_only: flag(q.late_only), late_more_than: toInt(q.late_more_than), work_less_than: toInt(q.work_less_than), work_more_than: toInt(q.work_more_than), break_more_than: toInt(q.break_more_than), outside_fence: flag(q.outside_fence), corrected_only: flag(q.corrected_only), include_absent: flag(q.include_absent), group_by, sort: String(q.sort || ''), columns: columns.length ? columns : DEFAULT_COLUMNS, format };
}
const employeeQuery = `SELECT e.id, e.employee_code, e.first_name || ' ' || e.last_name AS employee_name, e.department_id, d.name AS department_name, e.join_date, e.exit_date, e.status AS emp_status FROM employees e LEFT JOIN departments d ON d.id = e.department_id`;

/** Load the detail rows for a filter set (already role-scoped). */
export function buildRows(scope: number[] | undefined, f: ReportFilters): ReportRow[] {
  const settings = attendanceSettings();
  const standard = toInt(settings.standard_work_minutes, 540)!;
  let ids: number[] | undefined = scope;
  if (f.employee_id.length) ids = ids ? ids.filter((x) => f.employee_id.includes(x)) : f.employee_id;
  if (ids && !ids.length) return [];
  const where: string[] = ['a.date BETWEEN ? AND ?'];
  const params: any[] = [f.from, f.to];
  if (ids) { where.push(`a.employee_id IN (${ids.map(() => '?').join(',')})`); params.push(...ids); }
  if (f.department_id.length) { where.push(`e.department_id IN (${f.department_id.map(() => '?').join(',')})`); params.push(...f.department_id); }
  const recs = all<any>(`SELECT a.*, e.employee_code, e.first_name || ' ' || e.last_name AS employee_name, e.department_id, d.name AS department_name,
      li.name AS punch_in_location_name, lo.name AS punch_out_location_name, COALESCE(ce.first_name || ' ' || ce.last_name, cu.email) AS corrected_by_name, c.kind AS appeal_kind, c.reason AS appeal_reason
    FROM attendance_records a JOIN employees e ON e.id = a.employee_id LEFT JOIN departments d ON d.id = e.department_id
    LEFT JOIN work_locations li ON li.id = a.punch_in_location_id LEFT JOIN work_locations lo ON lo.id = a.punch_out_location_id
    LEFT JOIN users cu ON cu.id = a.corrected_by LEFT JOIN employees ce ON ce.id = cu.employee_id LEFT JOIN attendance_corrections c ON c.id = a.correction_id
    WHERE ${where.join(' AND ')} ORDER BY a.date, e.first_name`, params);
  let rows: ReportRow[] = recs.map((a) => ({
    date: a.date, employee_id: a.employee_id, employee_code: a.employee_code, employee_name: a.employee_name, department_id: a.department_id, department_name: a.department_name,
    status: a.status, punch_in_at: a.punch_in_at, punch_out_at: a.punch_out_at, work_minutes: a.work_minutes, break_minutes: a.break_minutes, late_minutes: a.late_minutes, overtime_minutes: a.overtime_minutes,
    punch_in_within_fence: a.punch_in_within_fence, punch_out_within_fence: a.punch_out_within_fence, punch_in_distance_m: a.punch_in_distance_m, punch_out_distance_m: a.punch_out_distance_m, punch_in_location_name: a.punch_in_location_name, punch_out_location_name: a.punch_out_location_name,
    source: a.source, corrected_by_name: a.corrected_by_name, corrected_at: a.corrected_at, correction_id: a.correction_id, appeal_kind: a.appeal_kind, appeal_reason: a.appeal_reason, notes: a.notes,
    shortfall_minutes: ['present', 'half_day', 'wfh'].includes(a.status) ? Math.max(0, standard - a.work_minutes) : 0, synthetic: false, record_id: a.id,
  }));
  if (f.include_absent) {
    const ew: string[] = ["e.status != 'exited'"];
    const ep: any[] = [];
    if (ids) { ew.push(`e.id IN (${ids.map(() => '?').join(',')})`); ep.push(...ids); }
    if (f.department_id.length) { ew.push(`e.department_id IN (${f.department_id.map(() => '?').join(',')})`); ep.push(...f.department_id); }
    const emps = all<any>(`${employeeQuery} WHERE ${ew.join(' AND ')}`, ep);
    const holidays = new Set(all<any>('SELECT date FROM holidays WHERE date BETWEEN ? AND ? AND optional = 0', [f.from, f.to]).map((h) => h.date));
    const leaves = all<any>("SELECT employee_id, start_date, end_date FROM leave_requests WHERE status = 'approved' AND end_date >= ? AND start_date <= ?", [f.from, f.to]);
    const have = new Set(rows.map((x) => `${x.employee_id}|${x.date}`));
    const offs: number[] = settings.weekly_offs || [0, 6];
    for (const d of eachDay(f.from, f.to)) {
      if (d > today()) break;
      if (offs.includes(new Date(d + 'T00:00:00Z').getUTCDay()) || holidays.has(d)) continue;
      for (const e of emps) {
        if (have.has(`${e.id}|${d}`) || (e.join_date && d < e.join_date)) continue;
        const onLeave = leaves.some((l) => l.employee_id === e.id && d >= l.start_date && d <= l.end_date);
        rows.push({ date: d, employee_id: e.id, employee_code: e.employee_code, employee_name: e.employee_name, department_id: e.department_id, department_name: e.department_name, status: onLeave ? 'leave' : 'absent', punch_in_at: null, punch_out_at: null, work_minutes: 0, break_minutes: 0, late_minutes: 0, overtime_minutes: 0, punch_in_within_fence: null, punch_out_within_fence: null, punch_in_distance_m: null, punch_out_distance_m: null, punch_in_location_name: null, punch_out_location_name: null, source: 'none', corrected_by_name: null, corrected_at: null, correction_id: null, appeal_kind: null, appeal_reason: null, notes: null, shortfall_minutes: 0, synthetic: true, record_id: null });
      }
    }
  }
  if (f.status.length) rows = rows.filter((x) => f.status.includes(x.status));
  if (f.late_only) rows = rows.filter((x) => x.late_minutes > 0);
  if (f.late_more_than !== undefined) rows = rows.filter((x) => x.late_minutes > f.late_more_than!);
  if (f.work_less_than !== undefined) rows = rows.filter((x) => !x.synthetic && x.punch_in_at && x.work_minutes < f.work_less_than!);
  if (f.work_more_than !== undefined) rows = rows.filter((x) => x.work_minutes > f.work_more_than!);
  if (f.break_more_than !== undefined) rows = rows.filter((x) => x.break_minutes > f.break_more_than!);
  if (f.outside_fence) rows = rows.filter((x) => x.punch_in_within_fence === 0 || x.punch_out_within_fence === 0);
  if (f.corrected_only) rows = rows.filter((x) => !!x.correction_id || !!x.corrected_at);
  sortRows(rows, f.sort);
  return rows;
}
function sortRows(rows: ReportRow[], sort: string) {
  const [key, dir] = sort.split(':');
  const col = COLUMNS[key];
  const mul = dir === 'desc' ? -1 : 1;
  rows.sort((a, b) => {
    if (col) {
      const va = col.value(a) ?? '', vb = col.value(b) ?? '';
      if (va < vb) return -mul;
      if (va > vb) return mul;
    }
    return a.date === b.date ? a.employee_name.localeCompare(b.employee_name) : a.date < b.date ? -1 : 1;
  });
}
export function summarise(rows: ReportRow[]) {
  const worked = rows.filter((x) => x.punch_in_at);
  const sum = (k: keyof ReportRow) => rows.reduce((s, x) => s + (Number(x[k]) || 0), 0);
  const count = (s: string) => rows.filter((x) => x.status === s).length;
  return {
    rows: rows.length, employees: new Set(rows.map((x) => x.employee_id)).size, days: new Set(rows.map((x) => x.date)).size,
    present: count('present') + count('wfh'), half_day: count('half_day'), absent: count('absent'), leave: count('leave'), late: rows.filter((x) => x.late_minutes > 0).length,
    total_work_minutes: sum('work_minutes'), avg_work_minutes: worked.length ? Math.round(sum('work_minutes') / worked.length) : 0, total_break_minutes: sum('break_minutes'), total_late_minutes: sum('late_minutes'), avg_late_minutes: rows.filter((x) => x.late_minutes > 0).length ? Math.round(sum('late_minutes') / rows.filter((x) => x.late_minutes > 0).length) : 0,
    total_overtime_minutes: sum('overtime_minutes'), outside_fence: rows.filter((x) => x.punch_in_within_fence === 0 || x.punch_out_within_fence === 0).length, corrected: rows.filter((x) => !!x.correction_id || !!x.corrected_at).length,
  };
}
export function groupRows(rows: ReportRow[], by: ReportFilters['group_by']) {
  const keyOf = (x: ReportRow) => (by === 'employee' ? `${x.employee_id}` : by === 'department' ? `${x.department_id ?? 0}` : x.date);
  const labelOf = (x: ReportRow) => (by === 'employee' ? `${x.employee_name} (${x.employee_code})` : by === 'department' ? x.department_name || 'No department' : `${fmtDate(x.date)} (${weekday(x.date)})`);
  const groups = new Map<string, { key: string; label: string; rows: ReportRow[] }>();
  for (const x of rows) {
    const k = keyOf(x);
    if (!groups.has(k)) groups.set(k, { key: k, label: labelOf(x), rows: [] });
    groups.get(k)!.rows.push(x);
  }
  return Array.from(groups.values()).map((g) => {
    const s = summarise(g.rows);
    return { key: g.key, group: g.label, days: g.rows.length, present: s.present, half_day: s.half_day, absent: s.absent, leave: s.leave, late_days: s.late, avg_late: s.avg_late_minutes, work: s.total_work_minutes, avg_work: s.avg_work_minutes, break: s.total_break_minutes, overtime: s.total_overtime_minutes, outside_fence: s.outside_fence, corrected: s.corrected };
  }).sort((a, b) => a.group.localeCompare(b.group));
}
const groupText = (g: any, key: string) => (['avg_late', 'work', 'avg_work', 'break', 'overtime'].includes(key) ? (g[key] ? fmtHHMM(g[key]) : key === 'work' || key === 'avg_work' ? '00:00' : '') : String(g[key] ?? ''));
export function describeFilters(f: ReportFilters) {
  const parts = [`Period ${fmtDate(f.from)} – ${fmtDate(f.to)}`];
  if (f.department_id.length) parts.push(`Departments: ${f.department_id.map((id) => get<any>('SELECT name FROM departments WHERE id = ?', [id])?.name || id).join(', ')}`);
  if (f.employee_id.length) parts.push(`Employees: ${f.employee_id.map((id) => { const e = get<any>('SELECT first_name, last_name FROM employees WHERE id = ?', [id]); return e ? `${e.first_name} ${e.last_name}` : id; }).join(', ')}`);
  if (f.status.length) parts.push(`Status: ${f.status.map(label).join(', ')}`);
  if (f.late_only) parts.push('Late only');
  if (f.late_more_than !== undefined) parts.push(`Late > ${f.late_more_than} min`);
  if (f.work_less_than !== undefined) parts.push(`Work < ${fmtHHMM(f.work_less_than)}`);
  if (f.work_more_than !== undefined) parts.push(`Work > ${fmtHHMM(f.work_more_than)}`);
  if (f.break_more_than !== undefined) parts.push(`Break > ${f.break_more_than} min`);
  if (f.outside_fence) parts.push('Outside geofence');
  if (f.corrected_only) parts.push('Corrected records only');
  if (f.include_absent) parts.push('Absent days included');
  if (f.group_by !== 'none') parts.push(`Grouped by ${f.group_by}`);
  return parts.join(' · ');
}

// ---------- PDF rendering ----------
interface PdfColumn { header: string; width: number; align?: 'right' | 'left' | 'center' }
interface PdfTableSpec { title: string; subtitle?: string; filters?: string; columns: PdfColumn[]; rows: string[][]; totals?: string[]; meta?: [string, string][]; sections?: { heading: string; lines: string[] }[]; generatedBy: string }
/** Renders a landscape A4 PDF with a repeating-header table, zebra rows, totals and page numbers. Returns the bytes. */
export function renderPdf(spec: PdfTableSpec): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const company = getSetting('company', DEFAULT_COMPANY);
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36, bufferPages: true, info: { Title: spec.title, Author: company.name } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const left = doc.page.margins.left, right = doc.page.width - doc.page.margins.right, width = right - left;
    const bottom = () => doc.page.height - doc.page.margins.bottom - 18;
    const totalW = spec.columns.reduce((s, c) => s + c.width, 0);
    const widths = spec.columns.map((c) => (c.width / totalW) * width);
    const rowH = 15, fs = 7.5;
    const generated = `Generated by ${spec.generatedBy} on ${fmtDateTime(new Date().toISOString())}`;

    const drawHeader = (first: boolean) => {
      doc.font('Helvetica-Bold').fontSize(first ? 15 : 11).fillColor('#111').text(company.name, left, doc.page.margins.top, { width, lineBreak: false });
      doc.font('Helvetica').fontSize(first ? 11 : 9).fillColor('#333').text(spec.title + (spec.subtitle ? ` · ${spec.subtitle}` : ''), left, doc.y + 2, { width, lineBreak: false });
      if (first) {
        if (spec.filters) doc.fontSize(8).fillColor('#555').text(spec.filters, left, doc.y + 3, { width });
        doc.fontSize(7.5).fillColor('#777').text(generated, left, doc.y + 2, { width, lineBreak: false });
        if (spec.meta?.length) {
          doc.moveDown(0.6);
          const colW = width / 2;
          const startY = doc.y;
          spec.meta.forEach(([k, v], i) => {
            const x = left + (i % 2) * colW, y = startY + Math.floor(i / 2) * 12;
            doc.font('Helvetica-Bold').fontSize(8).fillColor('#333').text(`${k}: `, x, y, { continued: true, lineBreak: false });
            doc.font('Helvetica').fillColor('#111').text(v || '—', { lineBreak: false });
          });
          doc.y = startY + Math.ceil(spec.meta.length / 2) * 12;
        }
      }
      doc.moveDown(0.5);
      doc.moveTo(left, doc.y).lineTo(right, doc.y).lineWidth(0.8).strokeColor('#999').stroke();
      doc.y += 4;
    };
    const drawTableHeader = () => {
      const y = doc.y;
      doc.rect(left, y, width, rowH).fill('#e8eaf0');
      doc.font('Helvetica-Bold').fontSize(fs).fillColor('#111');
      let x = left;
      spec.columns.forEach((c, i) => { doc.text(c.header, x + 3, y + 4, { width: widths[i] - 6, height: rowH, align: c.align || 'left', lineBreak: false, ellipsis: true }); x += widths[i]; });
      doc.y = y + rowH;
    };
    const drawRow = (cells: string[], i: number, bold = false) => {
      if (doc.y + rowH > bottom()) { doc.addPage(); drawHeader(false); drawTableHeader(); }
      const y = doc.y;
      if (bold) { doc.moveTo(left, y).lineTo(right, y).lineWidth(0.8).strokeColor('#333').stroke(); doc.rect(left, y, width, rowH).fill('#f1f3f8'); }
      else if (i % 2 === 1) doc.rect(left, y, width, rowH).fill('#f7f8fb');
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(fs).fillColor('#111');
      let x = left;
      spec.columns.forEach((c, j) => { doc.text(cells[j] ?? '', x + 3, y + 4, { width: widths[j] - 6, height: rowH, align: c.align || 'left', lineBreak: false, ellipsis: true }); x += widths[j]; });
      doc.y = y + rowH;
    };

    drawHeader(true);
    drawTableHeader();
    if (!spec.rows.length) drawRow(['No rows match these filters'], 0);
    spec.rows.forEach((row, i) => drawRow(row, i));
    if (spec.totals) drawRow(spec.totals, 0, true);
    doc.moveTo(left, doc.y).lineTo(right, doc.y).lineWidth(0.5).strokeColor('#999').stroke();
    for (const s of spec.sections || []) {
      if (doc.y + 40 > bottom()) { doc.addPage(); drawHeader(false); }
      doc.y += 10;
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#111').text(s.heading, left, doc.y, { width });
      doc.font('Helvetica').fontSize(8).fillColor('#333');
      for (const line of s.lines) { if (doc.y + 12 > bottom()) { doc.addPage(); drawHeader(false); } doc.text(line, left + 8, doc.y + 1, { width: width - 8 }); }
    }
    // Footer with page numbers on every page.
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const saved = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      const y = doc.page.height - 26;
      doc.font('Helvetica').fontSize(7.5).fillColor('#777');
      doc.text(`${company.name} · ${spec.title}`, left, y, { width: width / 2, lineBreak: false });
      doc.text(`Page ${i - range.start + 1} of ${range.count}`, left + width / 2, y, { width: width / 2, align: 'right', lineBreak: false });
      doc.page.margins.bottom = saved;
    }
    doc.end();
  });
}
function userName(req: Request) {
  const e = req.user!.employee_id ? get<any>('SELECT first_name, last_name FROM employees WHERE id = ?', [req.user!.employee_id]) : null;
  return e ? `${e.first_name} ${e.last_name}`.trim() : req.user!.email;
}
async function send(res: Response, format: 'json' | 'csv' | 'pdf', filename: string, json: () => any, csv: () => string, pdf: () => Promise<Buffer>) {
  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
    return res.send(csv());
  }
  if (format === 'pdf') {
    const buf = await pdf();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`);
    res.setHeader('Content-Length', String(buf.length));
    return res.end(buf);
  }
  return res.json(json());
}

// ---------- Routes ----------
r.get('/attendance/columns', requireAuth, (_req, res) => {
  res.json({ columns: Object.entries(COLUMNS).map(([key, c]) => ({ key, header: c.header, group: c.group })), default: DEFAULT_COLUMNS, statuses: STATUSES, group_by: ['none', 'employee', 'department', 'date'] });
});

/** Fully customisable attendance report. */
r.get('/attendance', requireAuth, wrap(async (req, res) => {
  const f = parseFilters(req.query);
  const rows = buildRows(reportScope(req), f);
  const summary = summarise(rows);
  const filters = describeFilters(f);
  const filename = `attendance_${f.from}_to_${f.to}`;
  if (f.group_by !== 'none') {
    const groups = groupRows(rows, f.group_by);
    const totals = summarise(rows);
    const totalCells = ['Total', String(rows.length), String(totals.present), String(totals.half_day), String(totals.absent), String(totals.leave), String(totals.late), totals.avg_late_minutes ? fmtHHMM(totals.avg_late_minutes) : '', fmtHHMM(totals.total_work_minutes), fmtHHMM(totals.avg_work_minutes), fmtHHMM(totals.total_break_minutes), fmtHHMM(totals.total_overtime_minutes), String(totals.outside_fence), String(totals.corrected)];
    return send(res, f.format, filename + `_by_${f.group_by}`,
      () => ({ rows, groups, summary, applied_filters: f, filters_text: filters, columns: f.columns }),
      () => toCsv(GROUP_COLUMNS.map((c) => c.header), [...groups.map((g) => GROUP_COLUMNS.map((c) => groupText(g, c.key))), totalCells]),
      () => renderPdf({ title: 'Attendance report', subtitle: `by ${f.group_by}`, filters, columns: GROUP_COLUMNS, rows: groups.map((g) => GROUP_COLUMNS.map((c) => groupText(g, c.key))), totals: totalCells, generatedBy: userName(req) }));
  }
  const cols = f.columns.map((k) => ({ key: k, ...COLUMNS[k] }));
  const totalCells = cols.map((c, i) => {
    if (i === 0) return 'Total';
    switch (c.key) {
      case 'work': return fmtHHMM(summary.total_work_minutes);
      case 'break': return fmtHHMM(summary.total_break_minutes);
      case 'late': return summary.total_late_minutes ? fmtHHMM(summary.total_late_minutes) : '';
      case 'overtime': return summary.total_overtime_minutes ? fmtHHMM(summary.total_overtime_minutes) : '';
      case 'shortfall': return fmtHHMM(rows.reduce((s, x) => s + x.shortfall_minutes, 0));
      case 'employee_name': return `${summary.employees} employees`;
      case 'date': return `${summary.days} days`;
      case 'status': return `${summary.present} present · ${summary.absent} absent`;
      default: return '';
    }
  });
  return send(res, f.format, filename,
    () => ({ rows, summary, applied_filters: f, filters_text: filters, columns: cols.map((c) => ({ key: c.key, header: c.header, align: c.align })) }),
    () => toCsv(cols.map((c) => c.header), [...rows.map((x) => cols.map((c) => c.text(x))), totalCells]),
    () => renderPdf({ title: 'Attendance report', filters, columns: cols.map((c) => ({ header: c.header, width: c.width, align: c.align })), rows: rows.map((x) => cols.map((c) => c.text(x))), totals: totalCells, generatedBy: userName(req) }));
}));

/** Late comers: employees ranked by number of late days. */
r.get('/attendance/late-comers', requireAuth, wrap(async (req, res) => {
  const f = parseFilters({ ...req.query, late_only: '1', group_by: 'none', columns: '' });
  const minCount = Math.max(1, toInt(req.query.min_count, 1)!);
  const rows = buildRows(reportScope(req), f);
  const byEmp = new Map<number, ReportRow[]>();
  for (const x of rows) { if (!byEmp.has(x.employee_id)) byEmp.set(x.employee_id, []); byEmp.get(x.employee_id)!.push(x); }
  const ranked = Array.from(byEmp.values()).map((list) => {
    const first = list[0];
    const total = list.reduce((s, x) => s + x.late_minutes, 0);
    const worst = list.reduce((w, x) => (x.late_minutes > w.late_minutes ? x : w), list[0]);
    return { employee_id: first.employee_id, employee_code: first.employee_code, employee_name: first.employee_name, department_name: first.department_name, late_days: list.length, total_late_minutes: total, avg_late_minutes: Math.round(total / list.length), max_late_minutes: worst.late_minutes, worst_date: worst.date, last_late_date: list[list.length - 1].date };
  }).filter((x) => x.late_days >= minCount).sort((a, b) => b.late_days - a.late_days || b.total_late_minutes - a.total_late_minutes).map((x, i) => ({ rank: i + 1, ...x }));
  const cols: PdfColumn[] = [{ header: '#', width: 3, align: 'right' }, { header: 'Code', width: 6 }, { header: 'Employee', width: 12 }, { header: 'Department', width: 10 }, { header: 'Late days', width: 5, align: 'right' }, { header: 'Total late', width: 6, align: 'right' }, { header: 'Avg late', width: 6, align: 'right' }, { header: 'Worst', width: 6, align: 'right' }, { header: 'Worst day', width: 7 }, { header: 'Last late', width: 7 }];
  const cells = ranked.map((x) => [String(x.rank), x.employee_code, x.employee_name, x.department_name || '', String(x.late_days), fmtHHMM(x.total_late_minutes), fmtHHMM(x.avg_late_minutes), fmtHHMM(x.max_late_minutes), fmtDate(x.worst_date), fmtDate(x.last_late_date)]);
  const totals = ['', '', `${ranked.length} employees`, '', String(ranked.reduce((s, x) => s + x.late_days, 0)), fmtHHMM(ranked.reduce((s, x) => s + x.total_late_minutes, 0)), '', '', '', ''];
  const filters = `${describeFilters(f)} · Minimum ${minCount} late day(s)`;
  return send(res, f.format, `late_comers_${f.from}_to_${f.to}`,
    () => ({ rows: ranked, summary: { employees: ranked.length, late_days: ranked.reduce((s, x) => s + x.late_days, 0), total_late_minutes: ranked.reduce((s, x) => s + x.total_late_minutes, 0) }, applied_filters: { ...f, min_count: minCount }, filters_text: filters }),
    () => toCsv(cols.map((c) => c.header), [...cells, totals]),
    () => renderPdf({ title: 'Late comers', filters, columns: cols, rows: cells, totals, generatedBy: userName(req) }));
}));

/** One employee's attendance statement for a period (employees may download their own). */
r.get('/attendance/employee/:id', requireAuth, wrap(async (req, res) => {
  const eid = toInt(req.params.id)!;
  if (!canAccessEmployee(req, eid) && !canApproveFor(req, eid)) throw forbidden();
  const e = get<any>(`SELECT e.*, d.name AS department_name, p.title AS position_title, s.name AS shift_name, s.start_time, s.end_time, l.name AS location_name, m.first_name || ' ' || m.last_name AS manager_name
    FROM employees e LEFT JOIN departments d ON d.id = e.department_id LEFT JOIN positions p ON p.id = e.position_id LEFT JOIN shifts s ON s.id = e.shift_id LEFT JOIN work_locations l ON l.id = e.work_location_id LEFT JOIN employees m ON m.id = e.manager_id WHERE e.id = ?`, [eid]);
  if (!e) throw notFound('Employee not found');
  const f = parseFilters({ from: req.query.from, to: req.query.to, format: req.query.format });
  const settings = attendanceSettings();
  const standard = toInt(settings.standard_work_minutes, 540)!;
  const recs = new Map(buildRows(undefined, { ...f, employee_id: [eid], columns: DEFAULT_COLUMNS }).map((x) => [x.date, x]));
  const holidays = new Map(all<any>('SELECT date, name FROM holidays WHERE date BETWEEN ? AND ?', [f.from, f.to]).map((h) => [h.date, h.name]));
  const leaves = all<any>("SELECT l.start_date, l.end_date, t.name FROM leave_requests l JOIN leave_types t ON t.id = l.leave_type_id WHERE l.employee_id = ? AND l.status = 'approved' AND l.end_date >= ? AND l.start_date <= ?", [eid, f.from, f.to]);
  const appeals = all<any>('SELECT id, date, kind, status, reason FROM attendance_corrections WHERE employee_id = ? AND date BETWEEN ? AND ? ORDER BY id', [eid, f.from, f.to]);
  const offs: number[] = settings.weekly_offs || [0, 6];
  const days = eachDay(f.from, f.to).filter((d) => d <= today() && (!e.join_date || d >= e.join_date)).map((d) => {
    const rec = recs.get(d);
    const leave = leaves.find((l) => d >= l.start_date && d <= l.end_date);
    const holiday = holidays.get(d);
    const weekend = offs.includes(new Date(d + 'T00:00:00Z').getUTCDay());
    const status = rec?.status ?? (leave ? 'leave' : holiday ? 'holiday' : weekend ? 'weekend' : 'absent');
    const dayAppeals = appeals.filter((a) => a.date === d);
    const notes = [holiday ? `Holiday: ${holiday}` : '', leave ? `Leave: ${leave.name}` : '', rec?.correction_id ? `Changed via appeal #${rec.correction_id}${rec.corrected_by_name ? ` by ${rec.corrected_by_name}` : ''}` : '', ...dayAppeals.map((a) => `Appeal #${a.id} ${label(a.kind)} (${a.status})`), rec?.notes && !rec.correction_id ? rec.notes : ''].filter(Boolean).join('; ');
    return { date: d, day: weekday(d), status, punch_in_at: rec?.punch_in_at ?? null, punch_out_at: rec?.punch_out_at ?? null, work_minutes: rec?.work_minutes ?? 0, break_minutes: rec?.break_minutes ?? 0, late_minutes: rec?.late_minutes ?? 0, overtime_minutes: rec?.overtime_minutes ?? 0, geofence_in: rec ? fence(rec.punch_in_within_fence, rec.punch_in_distance_m, rec.punch_in_location_name) : '', geofence_out: rec ? fence(rec.punch_out_within_fence, rec.punch_out_distance_m, rec.punch_out_location_name) : '', notes, appeals: dayAppeals };
  });
  const totals = {
    working_days: days.filter((d) => !['holiday', 'weekend'].includes(d.status)).length, present: days.filter((d) => d.status === 'present' || d.status === 'wfh').length, half_day: days.filter((d) => d.status === 'half_day').length, absent: days.filter((d) => d.status === 'absent').length, leave: days.filter((d) => d.status === 'leave').length, holidays: days.filter((d) => d.status === 'holiday').length, weekends: days.filter((d) => d.status === 'weekend').length,
    work_minutes: days.reduce((s, d) => s + d.work_minutes, 0), break_minutes: days.reduce((s, d) => s + d.break_minutes, 0), late_days: days.filter((d) => d.late_minutes > 0).length, late_minutes: days.reduce((s, d) => s + d.late_minutes, 0), overtime_minutes: days.reduce((s, d) => s + d.overtime_minutes, 0), appeals: appeals.length, standard_work_minutes: standard,
  };
  const workedDays = days.filter((d) => d.punch_in_at).length;
  const avgWork = workedDays ? Math.round(totals.work_minutes / workedDays) : 0;
  const name = `${e.first_name} ${e.last_name}`.trim();
  const cols: PdfColumn[] = [{ header: 'Date', width: 7 }, { header: 'Day', width: 4 }, { header: 'Status', width: 6 }, { header: 'In', width: 5 }, { header: 'Out', width: 5 }, { header: 'Work', width: 5, align: 'right' }, { header: 'Break', width: 5, align: 'right' }, { header: 'Late', width: 5, align: 'right' }, { header: 'Overtime', width: 6, align: 'right' }, { header: 'Geofence in', width: 9 }, { header: 'Geofence out', width: 9 }, { header: 'Notes / appeals', width: 18 }];
  const cells = days.map((d) => [fmtDate(d.date), d.day, label(d.status), fmtTime(d.punch_in_at), fmtTime(d.punch_out_at), d.punch_in_at ? fmtHHMM(d.work_minutes) : '', d.punch_in_at ? fmtHHMM(d.break_minutes) : '', d.late_minutes ? fmtHHMM(d.late_minutes) : '', d.overtime_minutes ? fmtHHMM(d.overtime_minutes) : '', d.geofence_in, d.geofence_out, d.notes]);
  const totalCells = ['Totals', '', `${totals.present} P / ${totals.half_day} H / ${totals.absent} A / ${totals.leave} L`, '', '', fmtHHMM(totals.work_minutes), fmtHHMM(totals.break_minutes), totals.late_minutes ? fmtHHMM(totals.late_minutes) : '', totals.overtime_minutes ? fmtHHMM(totals.overtime_minutes) : '', '', '', `${totals.late_days} late day(s) · ${totals.appeals} appeal(s)`];
  const meta: [string, string][] = [['Employee', `${name} (${e.employee_code})`], ['Department', e.department_name || ''], ['Position', e.position_title || ''], ['Reporting manager', e.manager_name || ''], ['Shift', e.shift_name ? `${e.shift_name} (${e.start_time}–${e.end_time})` : ''], ['Work location', e.location_name || ''], ['Period', `${fmtDate(f.from)} – ${fmtDate(f.to)}`], ['Standard day', fmtHHMM(standard)]];
  const monthly = { heading: 'Monthly totals', lines: [`Working days ${totals.working_days} · Present ${totals.present} · Half days ${totals.half_day} · Absent ${totals.absent} · Leave ${totals.leave} · Holidays ${totals.holidays} · Weekly offs ${totals.weekends}`, `Total work ${fmtHHMM(totals.work_minutes)} · Average per worked day ${fmtHHMM(avgWork)} · Breaks ${fmtHHMM(totals.break_minutes)} · Overtime ${fmtHHMM(totals.overtime_minutes)}`, `Late ${totals.late_days} day(s), ${fmtHHMM(totals.late_minutes)} in total · Appeals raised ${totals.appeals}`] };
  const filename = `attendance_${e.employee_code}_${f.from}_to_${f.to}`;
  return send(res, f.format, filename,
    () => ({ employee: { id: e.id, name, employee_code: e.employee_code, department_name: e.department_name, position_title: e.position_title, manager_name: e.manager_name, shift_name: e.shift_name, location_name: e.location_name }, from: f.from, to: f.to, days, totals: { ...totals, avg_work_minutes: avgWork } }),
    () => csvLines([['Attendance statement', name], ...meta, [], cols.map((c) => c.header), ...cells, totalCells, [], ['Monthly totals'], ...monthly.lines.map((l) => ['', l])]),
    () => renderPdf({ title: 'Attendance statement', subtitle: name, columns: cols, rows: cells, totals: totalCells, meta, sections: [monthly], generatedBy: userName(req) }));
}));

export default r;
