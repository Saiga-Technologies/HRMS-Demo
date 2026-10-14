import React, { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, ApiError, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { todayIso } from '../lib/format';
import { usePageTour } from '../lib/tour';
import { Icon } from '../components/Icons';
import { Button, Card, PageHeader, SearchInput, Select, Stat, downloadUrl, useConfirm, useFetch, useToast } from '../components/ui';
import { RosterGrid, RosterLegend, ShiftChip } from '../components/roster/RosterGrid';
import { AssignModal } from '../components/roster/AssignModal';
import { RosterDay, RosterEmployee, RosterResponse, addDaysIso, dayHead, isIso, mondayOf, weekLabel } from '../components/roster/shared';

const TOUR = [
  { element: '[data-tour="roster-header"]', title: 'Shift roster', description: 'Who works which shift, week by week. Explicit assignments override each employee’s default shift; weekly offs and holidays come from attendance settings.' },
  { element: '[data-tour="roster-week-nav"]', title: 'Pick a week', description: 'Step to the previous or next week, or jump back to this week. The week is kept in the address bar so you can share a link.' },
  { element: '[data-tour="roster-my-week"]', title: 'My week', description: 'Your own shifts for the selected week, with scheduled days and hours at a glance.' },
  { element: '[data-tour="roster-grid"]', title: 'The roster grid', description: 'Employees down the side, days across. Solid chips are assigned shifts, faded chips are the default shift, dashed chips are days off. Managers and HR click a cell to assign a shift, a day off or a note.' },
  { element: '[data-tour="roster-legend"]', title: 'Legend', description: 'Each shift has its own colour across the grid.' },
  { element: '[data-tour="roster-copy"]', title: 'Copy previous week', description: 'Repeat last week’s assignments into this week in one click. Approved leave is flagged before anything is overwritten.' },
  { element: '[data-tour="roster-export"]', title: 'Export', description: 'Download the week (with your current filters) as a CSV for printing or sharing.' },
];

export default function Roster() {
  usePageTour('Shift roster', TOUR);
  const { isHr, isManager, user } = useAuth();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const [params, setParams] = useSearchParams();
  const today = todayIso();
  const thisWeek = mondayOf(today);
  const weekParam = params.get('week');
  const from = isIso(weekParam) ? mondayOf(weekParam) : thisWeek;
  const to = addDaysIso(from, 6);
  const [dept, setDept] = useState('');
  const [q, setQ] = useState('');
  const [target, setTarget] = useState<{ employee: RosterEmployee; day: RosterDay } | null>(null);
  const [copying, setCopying] = useState(false);

  const roster = useFetch<RosterResponse>(() => api.get(`/api/roster${qs({ from, to, department_id: dept, q: q.trim() })}`), [from, to, dept, q]);
  const depts = useFetch<{ id: number; name: string }[]>(() => (isHr ? api.get('/api/org/departments') : Promise.resolve([])), [isHr]);
  const data = roster.data;
  const me = useMemo(() => data?.employees.find((e) => e.id === user?.employee_id) || null, [data, user]);

  const goWeek = (w: string) => setParams((p) => { const n = new URLSearchParams(p); if (w === thisWeek) n.delete('week'); else n.set('week', w); return n; }, { replace: true });
  // HR can roster anyone; managers their reporting chain (everyone they see except themselves).
  const canEdit = (e: RosterEmployee) => isHr || (isManager && e.id !== user?.employee_id);

  const copyWeek = async () => {
    const prev = addDaysIso(from, -7);
    const ok = await confirm('Copy previous week', `Copy every roster assignment from ${weekLabel(prev)} into ${weekLabel(from)}? Existing assignments on the same days are overwritten.`, false);
    if (!ok) return;
    setCopying(true);
    const run = (force: boolean) => api.post<{ copied: number }>('/api/roster/copy-week', { from_week_start: prev, to_week_start: from, force });
    try {
      let res: { copied: number };
      try {
        res = await run(false);
      } catch (err) {
        if (!(err instanceof ApiError && err.status === 409)) throw err;
        const names = (err.details?.conflicts || []).map((c: any) => `${c.employee_name} (${c.date})`).join(', ');
        if (!(await confirm('Approved leave in the target week', `${err.message}: ${names}. Copy anyway?`))) return;
        res = await run(true);
      }
      toast.success(res.copied ? `Copied ${res.copied} assignment${res.copied === 1 ? '' : 's'} from the previous week` : 'Nothing to copy: the previous week has no assignments');
      roster.reload();
    } catch (err) {
      toast.error(err);
    } finally {
      setCopying(false);
    }
  };
  const exportCsv = async () => {
    try {
      await downloadUrl(`/api/roster/export.csv${qs({ from, to, department_id: dept })}`, `roster-${from}-to-${to}.csv`);
      toast.success('Roster exported');
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <>
      <PageHeader title="Shift roster" tour="roster-header"
        subtitle={isManager ? 'Plan shifts and days off for your team, week by week.' : 'Your shifts for the week. Your manager or HR updates the roster.'}
        actions={
          <>
            <Button onClick={exportCsv} data-tour="roster-export" data-testid="roster-export"><Icon name="download" size={15} /> Export CSV</Button>
            {isManager ? <Button variant="primary" onClick={copyWeek} loading={copying} data-tour="roster-copy" data-testid="roster-copy-week"><Icon name="grid" size={15} /> Copy previous week</Button> : null}
          </>
        } />

      <div className="toolbar">
        <div className="row" data-tour="roster-week-nav" style={{ gap: 6 }}>
          <Button size="sm" onClick={() => goWeek(addDaysIso(from, -7))} aria-label="Previous week" data-testid="roster-prev"><Icon name="chevronLeft" size={15} /></Button>
          <strong style={{ minWidth: 170, textAlign: 'center' }} data-testid="roster-week-label">{weekLabel(from)}</strong>
          <Button size="sm" onClick={() => goWeek(addDaysIso(from, 7))} aria-label="Next week" data-testid="roster-next"><Icon name="chevronRight" size={15} /></Button>
          <Button size="sm" variant="ghost" onClick={() => goWeek(thisWeek)} disabled={from === thisWeek} data-testid="roster-this-week">This week</Button>
        </div>
        {isManager ? <SearchInput value={q} onChange={setQ} placeholder="Search name or code…" /> : null}
        {isHr ? (
          <Select value={dept} onChange={(e) => setDept(e.target.value)} data-testid="roster-dept" aria-label="Department" style={{ width: 'auto', minWidth: 180 }}>
            <option value="">All departments</option>
            {(depts.data || []).map((d) => <option key={d.id} value={String(d.id)}>{d.name}</option>)}
          </Select>
        ) : null}
      </div>

      {roster.error ? <Card><p className="muted" style={{ margin: 0 }}>{roster.error}</p></Card> : null}

      {me ? (
        <Card title="My week" tour="roster-my-week" actions={<span className="muted">{weekLabel(from)}</span>}>
          <div className="stat-strip">
            <Stat label="Scheduled days" value={<span data-testid="roster-my-days">{me.scheduled_days}</span>} icon="calendar" />
            <Stat label="Scheduled hours" value={`${me.scheduled_hours}h`} icon="clock" />
            <Stat label="Days off" value={me.days.filter((d) => d.day_off || (!d.scheduled && (d.weekly_off || d.holiday))).length} icon="sun" />
          </div>
          <div style={{ overflowX: 'auto' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(110px, 1fr))', gap: 8, minWidth: 770 }} data-testid="roster-my-week">
              {me.days.map((d, i) => {
                const h = dayHead(d.date);
                return (
                  <div key={d.date} data-testid={`my-day-${i}`}>
                    <div className="section-title" style={{ marginBottom: 4, color: d.date === today ? 'var(--brand)' : undefined }}>{h.dow} {h.day}</div>
                    <ShiftChip day={d} shifts={data!.shifts} />
                  </div>
                );
              })}
            </div>
          </div>
        </Card>
      ) : null}

      <Card padded={false} title={isManager ? 'Team roster' : 'Roster'} actions={data ? <RosterLegend shifts={data.shifts} /> : null}>
        <RosterGrid data={data} loading={roster.loading} today={today} canEdit={canEdit} highlightId={user?.employee_id} onCellClick={(employee, day) => setTarget({ employee, day })} />
      </Card>

      <AssignModal target={target} shifts={data?.shifts || []} onClose={() => setTarget(null)} onSaved={roster.reload} />
      {dialog}
    </>
  );
}
