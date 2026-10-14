import React, { useMemo, useState } from 'react';
import { api, qs } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { fmtDate, fmtMinutes, fmtTime, label, monthIso, todayIso } from '../../lib/format';
import { Icon } from '../Icons';
import { Badge, Button, Card, Checkbox, Field, Input, Pill, Select, Stat, StatusBadge, Table, downloadUrl, useFetch, useToast } from '../ui';
import { ATTENDANCE_STATUSES, DirectoryEmployee, daysAgoIso, employeeLabel, isoDate } from './shared';

interface Department { id: number; name: string }
interface ColumnMeta { key: string; header: string; group?: string }
interface ReportRow { date: string; employee_id: number; employee_code: string; employee_name: string; department_name: string | null; status: string; punch_in_at: string | null; punch_out_at: string | null; work_minutes: number; break_minutes: number; late_minutes: number; overtime_minutes: number; shortfall_minutes: number; punch_in_within_fence: number | null; punch_out_within_fence: number | null; punch_in_distance_m: number | null; punch_out_distance_m: number | null; punch_in_location_name: string | null; punch_out_location_name: string | null; source: string; corrected_by_name: string | null; corrected_at: string | null; correction_id: number | null; appeal_kind: string | null; appeal_reason: string | null; notes: string | null; synthetic: boolean }
interface GroupRow { key: string; group: string; days: number; present: number; half_day: number; absent: number; leave: number; late_days: number; avg_late: number; work: number; avg_work: number; break: number; overtime: number; outside_fence: number; corrected: number }
interface ReportResult { rows: ReportRow[]; groups?: GroupRow[]; summary: Record<string, number>; columns: { key: string; header: string; align?: string }[]; filters_text: string }
interface LateRow { rank: number; employee_id: number; employee_code: string; employee_name: string; department_name: string | null; late_days: number; total_late_minutes: number; avg_late_minutes: number; max_late_minutes: number; worst_date: string; last_late_date: string }

type Mode = 'attendance' | 'late-comers';
interface Filters { from: string; to: string; department_id: number[]; employee_id: number[]; status: string[]; late_only: boolean; late_more_than: string; work_less_than_h: string; work_more_than_h: string; break_more_than: string; outside_fence: boolean; corrected_only: boolean; include_absent: boolean; group_by: string; sort: string; columns: string[]; min_count: string }
const RANGE_PRESETS = ['today', 'this_week', 'this_month', 'last_month', 'custom'] as const;
function rangeFor(p: (typeof RANGE_PRESETS)[number]): { from: string; to: string } | null {
  const now = new Date();
  const t = todayIso();
  if (p === 'today') return { from: t, to: t };
  if (p === 'this_week') { const d = new Date(now); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return { from: isoDate(d), to: t }; }
  if (p === 'this_month') return { from: `${monthIso()}-01`, to: t };
  if (p === 'last_month') { const d = new Date(now.getFullYear(), now.getMonth() - 1, 1); const e = new Date(now.getFullYear(), now.getMonth(), 0); return { from: isoDate(d), to: isoDate(e) }; }
  return null;
}
const initial = (): Filters => ({ from: `${monthIso()}-01`, to: todayIso(), department_id: [], employee_id: [], status: [], late_only: false, late_more_than: '', work_less_than_h: '', work_more_than_h: '', break_more_than: '', outside_fence: false, corrected_only: false, include_absent: false, group_by: 'none', sort: '', columns: [], min_count: '1' });

function toQuery(f: Filters, mode: Mode, defaults: string[]) {
  const hours = (v: string) => (v === '' ? '' : String(Math.round(Number(v) * 60)));
  const base: Record<string, any> = { from: f.from, to: f.to, department_id: f.department_id.join(','), employee_id: f.employee_id.join(',') };
  if (mode === 'late-comers') return { ...base, min_count: f.min_count || '1' };
  return { ...base, status: f.status.join(','), late_only: f.late_only ? 1 : '', late_more_than: f.late_more_than, work_less_than: hours(f.work_less_than_h), work_more_than: hours(f.work_more_than_h), break_more_than: f.break_more_than, outside_fence: f.outside_fence ? 1 : '', corrected_only: f.corrected_only ? 1 : '', include_absent: f.include_absent ? 1 : '', group_by: f.group_by === 'none' ? '' : f.group_by, sort: f.sort, columns: f.columns.length && f.columns.join(',') !== defaults.join(',') ? f.columns.join(',') : '' };
}
const fence = (w: number | null, d: number | null, name: string | null) => (w === null || w === undefined ? '—' : w ? <Badge tone="success">Inside</Badge> : <Badge tone="warning">Outside{d !== null ? ` · ${Math.round(d)} m` : ''}{name ? ` from ${name}` : ''}</Badge>);
function cell(key: string, r: ReportRow): React.ReactNode {
  switch (key) {
    case 'date': return fmtDate(r.date);
    case 'day': return fmtDate(r.date, { weekday: 'short' });
    case 'employee_code': return <span className="mono">{r.employee_code}</span>;
    case 'employee_name': return <strong>{r.employee_name}</strong>;
    case 'department': return r.department_name || '—';
    case 'status': return <StatusBadge status={r.status} />;
    case 'punch_in': return fmtTime(r.punch_in_at);
    case 'punch_out': return fmtTime(r.punch_out_at);
    case 'work': return r.punch_in_at ? fmtMinutes(r.work_minutes) : '—';
    case 'break': return r.punch_in_at ? fmtMinutes(r.break_minutes) : '—';
    case 'late': return r.late_minutes ? <span className="late">{fmtMinutes(r.late_minutes)}</span> : '—';
    case 'overtime': return r.overtime_minutes ? fmtMinutes(r.overtime_minutes) : '—';
    case 'shortfall': return r.shortfall_minutes > 0 ? <span className="late">{fmtMinutes(r.shortfall_minutes)}</span> : '—';
    case 'geofence_in': return fence(r.punch_in_within_fence, r.punch_in_distance_m, r.punch_in_location_name);
    case 'geofence_out': return r.punch_out_at ? fence(r.punch_out_within_fence, r.punch_out_distance_m, r.punch_out_location_name) : '—';
    case 'source': return <span className="muted">{r.source}</span>;
    case 'corrected_by': return r.corrected_by_name || '—';
    case 'corrected_at': return r.corrected_at ? fmtDate(r.corrected_at) : '—';
    case 'appeal': return r.correction_id ? <span>#{r.correction_id} {label(r.appeal_kind)}{r.appeal_reason ? <span className="muted"> – {r.appeal_reason}</span> : null}</span> : '—';
    case 'notes': return r.notes || '—';
    default: return String((r as any)[key] ?? '');
  }
}
const RIGHT = new Set(['work', 'break', 'late', 'overtime', 'shortfall']);

/** Report builder: every filter the API supports, run to a table with summary cards, export as CSV / PDF with the same query. */
export function ReportsTab({ employees }: { employees: DirectoryEmployee[] }) {
  const toast = useToast();
  const { isManager, user } = useAuth();
  const meta = useFetch<{ columns: ColumnMeta[]; default: string[] }>(() => api.get('/api/reports/attendance/columns'), []);
  const depts = useFetch<Department[]>(() => (isManager ? api.get('/api/org/departments') : Promise.resolve([])), [isManager]);
  const [mode, setMode] = useState<Mode>('attendance');
  const [range, setRange] = useState<(typeof RANGE_PRESETS)[number]>('this_month');
  const [f, setF] = useState<Filters>(initial);
  const [showColumns, setShowColumns] = useState(false);
  const [result, setResult] = useState<ReportResult | null>(null);
  const [late, setLate] = useState<{ rows: LateRow[]; summary: Record<string, number>; filters_text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const defaults = meta.data?.default || [];
  const columns = f.columns.length ? f.columns : defaults;
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setF((s) => ({ ...s, [k]: v }));
  const toggle = <K extends 'department_id' | 'employee_id' | 'status' | 'columns'>(k: K, v: any) => setF((s) => { const list = (k === 'columns' && !s.columns.length ? defaults : (s[k] as any[])) as any[]; return { ...s, [k]: list.includes(v) ? list.filter((x) => x !== v) : [...list, v] }; });
  const pickRange = (p: (typeof RANGE_PRESETS)[number]) => { setRange(p); const r = rangeFor(p); if (r) setF((s) => ({ ...s, ...r })); };
  const query = useMemo(() => qs(toQuery(f, mode, defaults)), [f, mode, defaults]);
  const run = async () => {
    setBusy('run');
    try {
      if (mode === 'late-comers') { setLate(await api.get(`/api/reports/attendance/late-comers${query}`)); setResult(null); }
      else { setResult(await api.get(`/api/reports/attendance${query}`)); setLate(null); }
    } catch (err) { toast.error(err); } finally { setBusy(null); }
  };
  const exportAs = async (format: 'csv' | 'pdf') => {
    setBusy(format);
    try {
      const base = mode === 'late-comers' ? `late_comers_${f.from}_to_${f.to}` : `attendance_${f.from}_to_${f.to}${f.group_by !== 'none' ? `_by_${f.group_by}` : ''}`;
      await downloadUrl(`/api/reports/attendance${mode === 'late-comers' ? '/late-comers' : ''}${query}${query ? '&' : '?'}format=${format}`, `${base}.${format}`);
      toast.success(`${format.toUpperCase()} downloaded`);
    } catch (err) { toast.error(err); } finally { setBusy(null); }
  };
  const preset = (name: string) => {
    const month = rangeFor('this_month')!;
    setRange('this_month');
    if (name === 'late') { setMode('late-comers'); setF((s) => ({ ...initial(), ...month, department_id: s.department_id, employee_id: s.employee_id })); return; }
    setMode('attendance');
    setF((s) => ({ ...initial(), ...month, department_id: s.department_id, employee_id: s.employee_id, work_less_than_h: name === 'under9' ? '9' : '', outside_fence: name === 'fence', corrected_only: name === 'corrected', columns: name === 'corrected' ? ['date', 'employee_name', 'status', 'punch_in', 'punch_out', 'work', 'source', 'corrected_by', 'corrected_at', 'appeal'] : name === 'fence' ? ['date', 'employee_name', 'punch_in', 'punch_out', 'geofence_in', 'geofence_out'] : name === 'under9' ? ['date', 'employee_name', 'department', 'punch_in', 'punch_out', 'work', 'break', 'shortfall'] : [] }));
  };
  const s = result?.summary;
  return (
    <>
      <div className="toolbar" data-tour="att-report-presets">
        <span className="muted">Presets:</span>
        <Pill onClick={() => preset('late')} active={mode === 'late-comers'}>Late comers this month</Pill>
        <Pill onClick={() => preset('under9')} active={mode === 'attendance' && f.work_less_than_h === '9'}>Under 9 hours</Pill>
        <Pill onClick={() => preset('fence')} active={mode === 'attendance' && f.outside_fence}>Outside geofence</Pill>
        <Pill onClick={() => preset('corrected')} active={mode === 'attendance' && f.corrected_only}>Corrected records</Pill>
        <Button size="sm" variant="ghost" style={{ marginLeft: 'auto' }} onClick={() => { setMode('attendance'); setRange('this_month'); setF(initial()); setResult(null); setLate(null); }}>Reset</Button>
      </div>
      <Card title={<span className="row"><Icon name="filter" size={16} /> {mode === 'late-comers' ? 'Late comers' : 'Attendance report'} builder</span>} tour="att-report-builder"
        actions={<span className="row">
          <Select value={mode} onChange={(e) => setMode(e.target.value as Mode)} aria-label="Report" data-testid="report-mode"><option value="attendance">Attendance records</option><option value="late-comers">Late comers ranking</option></Select>
          <Button variant="primary" loading={busy === 'run'} onClick={run} data-testid="report-run"><Icon name="play" size={14} /> Run report</Button>
          <Button loading={busy === 'csv'} onClick={() => exportAs('csv')} data-testid="report-export-csv"><Icon name="download" size={14} /> Export CSV</Button>
          <Button loading={busy === 'pdf'} onClick={() => exportAs('pdf')} data-testid="report-export-pdf"><Icon name="file" size={14} /> Export PDF</Button>
        </span>}>
        <div className="report-builder">
          <div className="report-section">
            <h3 className="section-title">Date range</h3>
            <div className="row">
              {RANGE_PRESETS.map((p) => <Pill key={p} active={range === p} onClick={() => pickRange(p)}>{label(p)}</Pill>)}
              <Input type="date" value={f.from} onChange={(e) => { setRange('custom'); set('from', e.target.value); }} aria-label="From" data-testid="report-from" />
              <span className="muted">to</span>
              <Input type="date" value={f.to} onChange={(e) => { setRange('custom'); set('to', e.target.value); }} aria-label="To" data-testid="report-to" />
            </div>
          </div>
          {isManager ? (
            <div className="report-section">
              <h3 className="section-title">Departments <span className="muted">(any when none selected)</span></h3>
              <div className="chip-list">{(depts.data || []).map((d) => <Pill key={d.id} active={f.department_id.includes(d.id)} onClick={() => toggle('department_id', d.id)}>{d.name}</Pill>)}</div>
            </div>
          ) : null}
          {isManager ? (
            <div className="report-section">
              <h3 className="section-title">Employees <span className="muted">({f.employee_id.length ? `${f.employee_id.length} selected` : 'all in your scope'})</span></h3>
              <div className="row">
                <Select multiple size={5} value={f.employee_id.map(String)} onChange={(e) => set('employee_id', Array.from(e.target.selectedOptions).map((o) => Number(o.value)))} aria-label="Employees" data-testid="report-employees" style={{ minWidth: 280, height: 'auto' }}>
                  {employees.map((e) => <option key={e.id} value={e.id}>{employeeLabel(e)}</option>)}
                </Select>
                {f.employee_id.length ? <Button size="sm" variant="ghost" onClick={() => set('employee_id', [])}>Clear</Button> : null}
              </div>
            </div>
          ) : <p className="help">This report covers your own attendance only{user?.employee_id ? '' : ' (no employee record is linked to your login)'}.</p>}
          {mode === 'attendance' ? (
            <>
              <div className="report-section">
                <h3 className="section-title">Status</h3>
                <div className="chip-list">{ATTENDANCE_STATUSES.map((st) => <Pill key={st} active={f.status.includes(st)} onClick={() => toggle('status', st)}>{label(st)}</Pill>)}</div>
              </div>
              <div className="report-section">
                <h3 className="section-title">Conditions</h3>
                <div className="report-conditions">
                  <Checkbox label="Late only" checked={f.late_only} onChange={(e) => set('late_only', e.target.checked)} data-testid="report-late-only" />
                  <Field label="Late more than (min)"><Input type="number" min={0} value={f.late_more_than} onChange={(e) => set('late_more_than', e.target.value)} placeholder="e.g. 15" /></Field>
                  <Field label="Work less than (hours)"><Input type="number" min={0} step="0.5" value={f.work_less_than_h} onChange={(e) => set('work_less_than_h', e.target.value)} placeholder="e.g. 9" data-testid="report-work-less" /></Field>
                  <Field label="Work more than (hours)"><Input type="number" min={0} step="0.5" value={f.work_more_than_h} onChange={(e) => set('work_more_than_h', e.target.value)} placeholder="e.g. 10" /></Field>
                  <Field label="Break more than (min)"><Input type="number" min={0} value={f.break_more_than} onChange={(e) => set('break_more_than', e.target.value)} placeholder="e.g. 60" /></Field>
                  <Checkbox label="Outside geofence (in or out)" checked={f.outside_fence} onChange={(e) => set('outside_fence', e.target.checked)} data-testid="report-outside-fence" />
                  <Checkbox label="Corrected records only" checked={f.corrected_only} onChange={(e) => set('corrected_only', e.target.checked)} data-testid="report-corrected-only" />
                  <Checkbox label="Include absent days (synthesised)" checked={f.include_absent} onChange={(e) => set('include_absent', e.target.checked)} data-testid="report-include-absent" />
                </div>
              </div>
              <div className="report-section">
                <h3 className="section-title">Layout</h3>
                <div className="row">
                  <Field label="Group by"><Select value={f.group_by} onChange={(e) => set('group_by', e.target.value)} data-testid="report-group-by"><option value="none">No grouping (one row per day)</option><option value="employee">Employee</option><option value="department">Department</option><option value="date">Date</option></Select></Field>
                  <Field label="Sort by"><Select value={f.sort} onChange={(e) => set('sort', e.target.value)}><option value="">Date, then employee</option>{(meta.data?.columns || []).flatMap((c) => [<option key={c.key} value={c.key}>{c.header} ↑</option>, <option key={c.key + 'd'} value={`${c.key}:desc`}>{c.header} ↓</option>])}</Select></Field>
                  <Field label="Columns"><Button type="button" onClick={() => setShowColumns((v) => !v)} data-testid="report-columns">{columns.length} of {meta.data?.columns.length ?? 0} columns {showColumns ? '▴' : '▾'}</Button></Field>
                </div>
                {showColumns ? (
                  <div className="column-picker" data-testid="report-column-picker">
                    {(meta.data?.columns || []).map((c) => <Checkbox key={c.key} label={c.header} checked={columns.includes(c.key)} onChange={() => toggle('columns', c.key)} />)}
                    <Button size="sm" variant="ghost" onClick={() => set('columns', [])}>Default columns</Button>
                  </div>
                ) : null}
              </div>
            </>
          ) : (
            <div className="report-section">
              <h3 className="section-title">Ranking</h3>
              <Field label="Minimum late days"><Input type="number" min={1} value={f.min_count} onChange={(e) => set('min_count', e.target.value)} style={{ width: 120 }} /></Field>
            </div>
          )}
        </div>
      </Card>

      {result && s ? (
        <>
          <div className="grid grid-4 summary-cards" data-tour="att-report-summary" data-testid="report-summary">
            <Stat label="Employees" value={s.employees} icon="users" hint={`${s.days} day${s.days === 1 ? '' : 's'} · ${s.rows} rows`} />
            <Stat label="Present" value={s.present} icon="check" color="var(--success)" hint={`${s.half_day} half days · ${s.leave} on leave`} />
            <Stat label="Absent" value={s.absent} icon="x" color="var(--danger)" hint={f.include_absent ? 'from working days without a record' : 'tick "Include absent days" to count'} />
            <Stat label="Late" value={s.late} icon="clock" color="var(--warning)" hint={s.avg_late_minutes ? `avg ${fmtMinutes(s.avg_late_minutes)} late` : 'no late marks'} />
            <Stat label="Avg work / day" value={fmtMinutes(s.avg_work_minutes)} icon="trendingUp" hint={`${fmtMinutes(s.total_work_minutes)} in total`} />
            <Stat label="Overtime" value={fmtMinutes(s.total_overtime_minutes)} icon="star" hint={`breaks ${fmtMinutes(s.total_break_minutes)}`} />
            <Stat label="Outside geofence" value={s.outside_fence} icon="mapPin" color="var(--warning)" />
            <Stat label="Corrected" value={s.corrected} icon="edit" hint="changed via appeal or direct edit" />
          </div>
          <Card padded={false} title={<span>{result.rows.length} rows</span>} actions={<span className="muted">{result.filters_text}</span>} tour="att-report-table">
            {result.groups ? (
              <Table<GroupRow>
                rows={result.groups}
                keyField="key"
                empty="No rows match these filters."
                columns={[
                  { key: 'group', header: label(f.group_by), render: (g) => <strong>{g.group}</strong> },
                  { key: 'days', header: 'Days', align: 'right' }, { key: 'present', header: 'Present', align: 'right' }, { key: 'half_day', header: 'Half', align: 'right' }, { key: 'absent', header: 'Absent', align: 'right', render: (g) => (g.absent ? <span className="late">{g.absent}</span> : 0) }, { key: 'leave', header: 'Leave', align: 'right' },
                  { key: 'late_days', header: 'Late days', align: 'right' }, { key: 'avg_late', header: 'Avg late', align: 'right', render: (g) => (g.avg_late ? fmtMinutes(g.avg_late) : '—') },
                  { key: 'work', header: 'Work', align: 'right', render: (g) => fmtMinutes(g.work) }, { key: 'avg_work', header: 'Avg work', align: 'right', render: (g) => fmtMinutes(g.avg_work) }, { key: 'break', header: 'Break', align: 'right', render: (g) => fmtMinutes(g.break) }, { key: 'overtime', header: 'Overtime', align: 'right', render: (g) => fmtMinutes(g.overtime) },
                  { key: 'outside_fence', header: 'Outside fence', align: 'right' }, { key: 'corrected', header: 'Corrected', align: 'right' },
                ]}
              />
            ) : (
              <Table<ReportRow & { _k: string }>
                rows={result.rows.map((r) => ({ ...r, _k: `${r.employee_id}|${r.date}` }))}
                keyField="_k"
                empty="No rows match these filters."
                columns={result.columns.map((c) => ({ key: c.key, header: c.header, align: RIGHT.has(c.key) ? ('right' as const) : undefined, render: (r: ReportRow) => cell(c.key, r) }))}
              />
            )}
          </Card>
        </>
      ) : null}
      {late ? (
        <Card padded={false} title={`Late comers · ${late.rows.length} employee${late.rows.length === 1 ? '' : 's'}`} actions={<span className="muted">{late.filters_text}</span>} tour="att-report-table">
          <Table<LateRow>
            rows={late.rows}
            keyField="employee_id"
            empty="Nobody was late in this period."
            columns={[
              { key: 'rank', header: '#', align: 'right' },
              { key: 'employee_name', header: 'Employee', render: (r) => <span><strong>{r.employee_name}</strong> <span className="muted mono">{r.employee_code}</span></span> },
              { key: 'department_name', header: 'Department', render: (r) => r.department_name || '—' },
              { key: 'late_days', header: 'Late days', align: 'right', render: (r) => <strong>{r.late_days}</strong> },
              { key: 'total_late_minutes', header: 'Total late', align: 'right', render: (r) => fmtMinutes(r.total_late_minutes) },
              { key: 'avg_late_minutes', header: 'Avg late', align: 'right', render: (r) => fmtMinutes(r.avg_late_minutes) },
              { key: 'max_late_minutes', header: 'Worst', align: 'right', render: (r) => `${fmtMinutes(r.max_late_minutes)} on ${fmtDate(r.worst_date)}` },
              { key: 'last_late_date', header: 'Last late', render: (r) => fmtDate(r.last_late_date) },
            ]}
          />
        </Card>
      ) : null}
      {!result && !late ? <p className="help" data-testid="report-empty">Choose your filters and press <strong>Run report</strong>. Exports use exactly the same filters. Default range: {fmtDate(daysAgoIso(0).slice(0, 7) + '-01', { month: 'long', year: 'numeric' })}.</p> : null}
    </>
  );
}
