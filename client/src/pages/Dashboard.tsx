import React, { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { usePageTour } from '../lib/tour';
import { fmtDate, fmtMinutes, fmtMoney, fmtTime, fullName, todayIso } from '../lib/format';
import { Button, Card, EmptyState, ExpiryDot, Field, Input, Modal, PageHeader, Select, Stat, Textarea, useFetch, useToast, Badge } from '../components/ui';
import { BarChart, DonutChart, LineChart, Heatmap, Gauge, CHART_COLORS, type Datum } from '../components/charts';
import { Icon } from '../components/Icons';

type CardType = 'stat' | 'list' | 'link' | 'note' | 'chart';
type CardSize = 'sm' | 'md' | 'lg';
interface CardDef { id: number; type: CardType; title: string; config: any; size: CardSize; sort_order: number }
interface CatalogItem { type: CardType; key: string; title: string; category: string; icon: string; size: CardSize; chart?: string; description?: string }

const TOUR = [
  { element: '[data-tour="dash-header"]', title: 'Your dashboard', description: 'A live, role-aware overview: HR sees the company, managers their reporting chain, employees themselves.' },
  { element: '[data-tour="dash-grid"]', title: 'Charts you can click', description: 'Every chart is a shortcut. Click a bar, slice, day or row to open the matching page with the right filters applied.' },
  { element: '[data-tour="dash-insight"]', title: 'Insights', description: 'Short captions under each chart call out what changed — late arrivals vs last week, documents expiring this week, and more.' },
  { element: '[data-tour="dash-add"]', title: 'Add cards without limits', description: 'Pick from the catalog: stats, charts, lists, quick links or notes, grouped by area. There is no cap on the number of cards.' },
  { element: '[data-tour="dash-card-menu"]', title: 'Arrange and resize', description: 'Drag cards to reorder them. Use the ⋯ menu to resize (small, medium, large), rename or remove a card.' },
  { element: '[data-tour="dash-reset"]', title: 'Reset layout', description: 'Go back to the recommended layout for your role at any time.' },
  { element: '[data-tour="tour-button"]', title: 'Tour any page', description: 'Every page has a "Tour this page" button that walks you through what is on screen.' },
];

const LINKS: Record<string, string> = {
  headcount: '/employees', present_today: '/attendance?tab=daily', on_leave_today: '/leave?tab=calendar', pending_leaves: '/leave?tab=approvals', pending_corrections: '/attendance?tab=corrections',
  comp_off_pending: '/leave?tab=compoff', travel_km_this_month: '/attendance?tab=travel',
  expiring_documents: '/documents?tab=expiring', open_vacancies: '/recruitment?tab=pipeline', assets_assigned: '/assets', payroll_last_net: '/payroll?tab=runs', my_leave_balance: '/leave', my_hours_this_month: '/attendance',
  my_payslip_requests: '/payroll?tab=requests',
};
const STAT_ICONS: Record<string, string> = {
  headcount: 'users', present_today: 'clock', on_leave_today: 'leaf', pending_leaves: 'check', pending_corrections: 'edit', comp_off_pending: 'award', travel_km_this_month: 'mapPin', expiring_documents: 'alert', open_vacancies: 'briefcase', assets_assigned: 'laptop', payroll_last_net: 'banknote', my_leave_balance: 'leaf', my_hours_this_month: 'clock', my_payslip_requests: 'file',
};
const CATEGORY_ORDER = ['Attendance', 'People', 'Leave', 'Payroll', 'Documents', 'Recruitment', 'Journey', 'Assets', 'Personal'];
const C = { ok: 'var(--success)', warn: '#f59e0b', bad: '#ef4444', info: '#06b6d4', muted: '#94a3b8', brand: 'var(--brand)', accent: 'var(--accent)', violet: '#8b5cf6' };

export default function Dashboard() {
  usePageTour('Dashboard', TOUR);
  const { user, company } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const cards = useFetch<CardDef[]>(() => api.get('/api/dashboard/cards'), []);
  const data = useFetch<any>(() => api.get('/api/dashboard/data'), []);
  const catalog = useFetch<CatalogItem[]>(() => api.get('/api/dashboard/catalog'), []);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<CardDef | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);
  const [overId, setOverId] = useState<number | null>(null);

  const currency = company.currency || 'INR';
  const list = cards.data || [];

  const reorder = async (fromId: number, toId: number) => {
    if (fromId === toId) return;
    const ids = list.map((c) => c.id);
    const from = ids.indexOf(fromId);
    const to = ids.indexOf(toId);
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    cards.setData(ids.map((id) => list.find((c) => c.id === id)!));
    try {
      await api.put('/api/dashboard/cards/reorder', { ids });
    } catch (e) {
      toast.error(e);
      cards.reload();
    }
  };
  const remove = async (c: CardDef) => {
    try {
      await api.delete(`/api/dashboard/cards/${c.id}`);
      cards.setData(list.filter((x) => x.id !== c.id));
    } catch (e) {
      toast.error(e);
    }
  };
  const resize = async (c: CardDef, size: CardSize) => {
    try {
      const upd = await api.put<CardDef>(`/api/dashboard/cards/${c.id}`, { size });
      cards.setData(list.map((x) => (x.id === c.id ? upd : x)));
    } catch (e) {
      toast.error(e);
    }
  };
  const reset = async () => {
    try {
      const d = await api.post<CardDef[]>('/api/dashboard/cards/reset');
      cards.setData(d);
      toast.success('Dashboard reset to defaults');
    } catch (e) {
      toast.error(e);
    }
  };

  const greeting = useMemo(() => {
    const h = new Date().getHours();
    return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  }, []);
  const firstChartId = list.find((c) => c.type === 'chart' || c.config?.key === 'approvals_queue')?.id;
  const scopeLabel = data.data?.scope === 'company' ? 'Company-wide view' : data.data?.scope === 'team' ? 'Your team' : 'Your personal view';

  return (
    <>
      <PageHeader
        tour="dash-header"
        title={`${greeting}, ${user?.first_name || user?.email}`}
        subtitle={`${company.name || 'Your company'} · ${fmtDate(todayIso(), { weekday: 'long', day: 'numeric', month: 'long' })} · ${scopeLabel}`}
        actions={
          <>
            <Button onClick={reset} data-tour="dash-reset">Reset layout</Button>
            <Button variant="primary" onClick={() => setAdding(true)} data-tour="dash-add" data-testid="dash-add-card"><Icon name="plus" size={15} /> Add card</Button>
          </>
        }
      />
      {cards.loading || data.loading ? null : list.length === 0 ? (
        <EmptyState title="No cards yet" description="Add any number of cards to build your own dashboard." action={<Button variant="primary" onClick={() => setAdding(true)}>+ Add card</Button>} />
      ) : null}
      <div className="dash-grid" data-tour="dash-grid" data-testid="dash-grid">
        {list.map((c, i) => (
          <div
            key={c.id}
            className={`dash-card ${c.size} ${dragId === c.id ? 'dragging' : ''} ${overId === c.id && dragId !== c.id ? 'over' : ''}`}
            draggable
            onDragStart={() => setDragId(c.id)}
            onDragOver={(e) => { e.preventDefault(); setOverId(c.id); }}
            onDragLeave={() => setOverId(null)}
            onDrop={(e) => { e.preventDefault(); if (dragId != null) reorder(dragId, c.id); setDragId(null); setOverId(null); }}
            onDragEnd={() => { setDragId(null); setOverId(null); }}
            data-testid="dash-card"
            data-card-type={c.type}
            data-card-key={c.config?.key || c.type}
          >
            <CardView card={c} data={data.data} currency={currency} first={i === 0} tourInsight={c.id === firstChartId} onRemove={() => remove(c)} onResize={(s) => resize(c, s)} onEdit={() => setEditing(c)} onOpen={(to) => navigate(to)} />
          </div>
        ))}
      </div>
      {adding ? (
        <AddCardModal catalog={catalog.data || []} onClose={() => setAdding(false)} onAdded={(c) => { cards.setData([...list, c]); setAdding(false); }} />
      ) : null}
      {editing ? (
        <EditCardModal card={editing} onClose={() => setEditing(null)} onSaved={(c) => { cards.setData(list.map((x) => (x.id === c.id ? c : x))); setEditing(null); }} />
      ) : null}
    </>
  );
}

function CardMenu({ card, onRemove, onResize, onEdit, tour }: { card: CardDef; onRemove: () => void; onResize: (s: CardSize) => void; onEdit: () => void; tour?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="user-menu" onClick={(e) => e.stopPropagation()} data-tour={tour}>
      <button className="btn btn-ghost btn-sm" onClick={() => setOpen((o) => !o)} aria-label="Card options" data-testid="card-menu">⋯</button>
      {open ? (
        <div className="dropdown" onMouseLeave={() => setOpen(false)}>
          <button onClick={() => { onEdit(); setOpen(false); }}>Edit title / content</button>
          <button onClick={() => { onResize('sm'); setOpen(false); }}>{card.size === 'sm' ? '✓ ' : ''}Small</button>
          <button onClick={() => { onResize('md'); setOpen(false); }}>{card.size === 'md' ? '✓ ' : ''}Medium</button>
          <button onClick={() => { onResize('lg'); setOpen(false); }}>{card.size === 'lg' ? '✓ ' : ''}Large</button>
          <button className="danger" onClick={() => { onRemove(); setOpen(false); }} data-testid="card-remove">Remove card</button>
        </div>
      ) : null}
    </div>
  );
}

function CardView({ card, data, currency, first, tourInsight, onRemove, onResize, onEdit, onOpen }: { card: CardDef; data: any; currency: string; first: boolean; tourInsight: boolean; onRemove: () => void; onResize: (s: CardSize) => void; onEdit: () => void; onOpen: (to: string) => void }) {
  const key = card.config?.key as string | undefined;
  const menu = <CardMenu card={card} onRemove={onRemove} onResize={onResize} onEdit={onEdit} tour={first ? 'dash-card-menu' : undefined} />;
  if (card.type === 'stat') {
    const v = data?.[key || ''];
    let value: React.ReactNode = v ?? '—';
    let hint: React.ReactNode = undefined;
    let color: string | undefined;
    if (key === 'payroll_last_net') { value = v ? fmtMoney(v.net, currency) : '—'; hint = v ? `${v.period} · ${v.status}` : 'No payroll run yet'; }
    if (key === 'my_hours_this_month') { value = `${v ?? 0} h`; }
    if (key === 'travel_km_this_month') { value = `${v ?? 0} km`; hint = v ? 'completed trips' : 'no trips logged yet'; }
    if (key === 'my_leave_balance') { hint = (data?.my_leave_balance_detail || []).map((b: any) => `${b.name.split(' ')[0]} ${b.available}`).join(' · '); }
    if (key === 'expiring_documents') { hint = v ? 'needs attention' : 'all documents valid'; color = v ? C.warn : undefined; }
    if (key === 'present_today' && data?.today_attendance) { hint = `${data.today_attendance.late} late · ${data.today_attendance.on_leave} on leave`; }
    if (key === 'pending_leaves' || key === 'pending_corrections' || key === 'comp_off_pending') { hint = v ? 'waiting for you' : 'queue is clear'; color = v ? C.warn : C.ok; }
    if (key === 'my_payslip_requests') { value = v?.pending ?? 0; hint = v?.pending ? 'pending with HR · click to view' : 'Click to request a payslip'; }
    return (
      <div style={{ position: 'relative', height: '100%' }}>
        <Stat label={card.title} value={value} hint={hint} icon={STAT_ICONS[key || '']} color={color} onClick={key && LINKS[key] ? () => onOpen(LINKS[key]) : undefined} />
        <div style={{ position: 'absolute', top: 6, right: 6 }}>{menu}</div>
      </div>
    );
  }
  if (card.type === 'note') {
    return (
      <Card title={card.title} actions={menu}>
        <div style={{ whiteSpace: 'pre-wrap' }}>{card.config?.text || <span className="muted">Click ⋯ → Edit to write a note.</span>}</div>
      </Card>
    );
  }
  if (card.type === 'link') {
    const links: { label: string; to: string }[] = card.config?.links?.length ? card.config.links : [
      { label: 'Punch in / out', to: '/attendance' }, { label: 'Apply for leave', to: '/leave' }, { label: 'My documents', to: '/documents' }, { label: 'My payslips', to: '/payroll' }, { label: 'Request a payslip', to: '/payroll?tab=requests' }, { label: 'Org tree', to: '/org-tree' },
    ];
    return (
      <Card title={card.title} actions={menu}>
        <div className="chip-list">
          {links.map((l, i) => <Link key={i} className="chip" to={l.to}>{l.label}</Link>)}
        </div>
      </Card>
    );
  }
  if (card.type === 'chart') {
    return (
      <Card title={card.title} actions={menu} className="dash-chart-card">
        {data ? <ChartCard k={key || ''} data={data} currency={currency} onOpen={onOpen} first={tourInsight} /> : <div className="chart-empty">Loading…</div>}
      </Card>
    );
  }
  // list cards
  if (key === 'approvals_queue') {
    const rows: any[] = data?.approvals_queue || [];
    const total = rows.reduce((s, r) => s + r.count, 0);
    return (
      <Card title={card.title} actions={menu}>
        <ul className="list approvals-queue">
          {rows.map((r) => (
            <li key={r.kind} className="clickable" onClick={() => onOpen(r.to)} data-testid={`queue-${r.kind}`}>
              <span className="row"><span className={`queue-dot ${r.count ? 'hot' : ''}`} />{r.label}</span>
              <span className="row">{r.count ? <Badge tone="warning">{r.count} pending</Badge> : <span className="meta">clear</span>}<Icon name="chevronRight" size={14} /></span>
            </li>
          ))}
        </ul>
        <Insight text={total ? `${total} item${total === 1 ? '' : 's'} waiting for a decision.` : 'Nothing waiting for you right now.'} tone={total ? 'warn' : 'ok'} first={tourInsight} />
      </Card>
    );
  }
  const rows: any[] = data?.[key || ''] || [];
  return (
    <Card title={card.title} actions={menu}>
      {rows.length === 0 ? <div className="muted">Nothing to show.</div> : (
        <ul className="list">
          {rows.map((r, i) => <li key={r.id ?? i}>{renderListRow(key || '', r, currency)}</li>)}
        </ul>
      )}
    </Card>
  );
}

function renderListRow(key: string, r: any, currency: string) {
  switch (key) {
    case 'recent_joiners':
      return <><span><Link to={`/employees/${r.id}`}>{fullName(r)}</Link> <span className="meta">{r.position_title || ''}</span></span><span className="meta">{fmtDate(r.join_date)}</span></>;
    case 'upcoming_birthdays':
      return <><Link to={`/employees/${r.id}`}>{fullName(r)}</Link><span className="meta row"><Icon name="star" size={13} /> {fmtDate(r.next, { day: 'numeric', month: 'short' })}</span></>;
    case 'expiring_documents_list':
      return <><span><Link to={`/employees/${r.employee_id}`}>{r.employee_name}</Link> <span className="meta">{r.type_name || r.title}</span></span><ExpiryDot state={r.expiry_state} days={r.days_to_expiry} /></>;
    case 'pending_approvals':
      return <><span><Link to={r.kind === 'leave' ? '/leave?tab=approvals' : '/attendance?tab=corrections'}>{r.employee_name}</Link> <span className="meta">{r.kind === 'leave' ? `${r.detail} · ${r.days}d` : r.detail}</span></span><Badge tone={r.kind === 'leave' ? 'info' : 'warning'}>{r.kind}</Badge></>;
    case 'upcoming_holidays':
      return <><span>{r.name}</span><span className="meta">{fmtDate(r.date, { weekday: 'short', day: 'numeric', month: 'short' })}</span></>;
    case 'journey_in_progress':
      return <><span><Link to={`/journey?employee=${r.id}`}>{fullName(r)}</Link> <span className="meta">{r.stage}</span></span><span className="meta">{r.done}/{r.total}</span></>;
    case 'my_recent_payslips':
      return <><span><Link to="/payroll">{r.period}</Link> <Badge tone={r.status === 'paid' ? 'success' : 'info'}>{r.status}</Badge></span><strong className="num">{fmtMoney(r.net, r.currency || currency)}</strong></>;
    default:
      return <span>{JSON.stringify(r)}</span>;
  }
}

/* ------------------------------------------------------------------ */
/* Chart cards                                                         */
/* ------------------------------------------------------------------ */
function Insight({ text, tone = 'info', first }: { text: React.ReactNode; tone?: 'ok' | 'warn' | 'bad' | 'info'; first?: boolean }) {
  if (!text) return null;
  return <p className={`dash-insight tone-${tone}`} data-tour={first ? 'dash-insight' : undefined}><Icon name={tone === 'ok' ? 'check' : tone === 'info' ? 'info' : 'alert'} size={13} /> <span>{text}</span></p>;
}
const shortDay = (d: string) => fmtDate(d, { day: 'numeric', month: 'short' });
const monthLabel = (m: string) => { const [y, mm] = m.split('-').map(Number); return new Date(y, mm - 1, 1).toLocaleDateString(undefined, { month: 'short' }); };
const sum = (a: number[]) => a.reduce((s, x) => s + x, 0);
const delta = (cur: number, prev: number) => (prev ? Math.round(((cur - prev) / prev) * 100) : cur ? 100 : 0);

function ChartCard({ k, data, currency, onOpen, first }: { k: string; data: any; currency: string; onOpen: (to: string) => void; first: boolean }) {
  switch (k) {
    case 'today_attendance': {
      const t = data.today_attendance || {};
      const items: Datum[] = [
        { key: 'present', label: 'Present', value: t.present || 0, color: C.ok }, { key: 'late', label: 'Late', value: t.late || 0, color: C.warn }, { key: 'leave', label: 'On leave', value: t.on_leave || 0, color: C.info },
        { key: 'absent', label: 'Absent', value: t.absent || 0, color: C.bad }, { key: 'not_in', label: 'Not yet in', value: t.not_in || 0, color: C.muted },
      ];
      const inRate = t.total ? Math.round(((t.present + t.late) / t.total) * 100) : 0;
      return (
        <>
          <DonutChart data={items} centerLabel={`${inRate}%`} onSelect={(d) => onOpen(`/attendance?tab=daily&status=${d.key}`)} />
          <Insight first={first} tone={t.off_day ? 'info' : t.not_in > t.total / 2 ? 'warn' : 'ok'} text={t.off_day ? 'Today is a weekly off or holiday.' : `${inRate}% of ${t.total} have punched in${t.late ? `, ${t.late} late` : ''}${t.on_leave ? ` · ${t.on_leave} on leave` : ''}.`} />
        </>
      );
    }
    case 'attendance_trend': {
      const tr = data.attendance_trend || { labels: [], present: [], absent: [], late: [] };
      const n = tr.labels.length;
      const lateThis = sum(tr.late.slice(-5)), latePrev = sum(tr.late.slice(-10, -5));
      const d = delta(lateThis, latePrev);
      return (
        <>
          <LineChart labels={tr.labels.map(shortDay)} height={180} series={[{ name: 'Present', values: tr.present, color: C.ok }, { name: 'Late', values: tr.late, color: C.warn }, { name: 'Absent', values: tr.absent, color: C.bad }]} onSelect={(i) => onOpen(`/attendance?tab=daily&date=${tr.labels[i]}`)} />
          <Insight first={first} tone={d > 0 ? 'warn' : 'ok'} text={n ? (latePrev || lateThis ? `Late arrivals ${d > 0 ? 'up' : d < 0 ? 'down' : 'flat'} ${Math.abs(d)}% vs the previous week (${lateThis} vs ${latePrev}). Click a day for the roster.` : 'No late arrivals in the last two weeks. Click a day for the roster.') : 'No attendance recorded yet.'} />
        </>
      );
    }
    case 'late_comers': {
      const rows: any[] = data.late_comers || [];
      return (
        <>
          <BarChart horizontal data={rows.map((r) => ({ key: String(r.id), label: r.name, value: r.late_days, hint: `${r.name}: ${r.late_days} late day${r.late_days === 1 ? '' : 's'}, avg ${r.avg_late_minutes} min late`, color: r.late_days >= 5 ? C.bad : C.warn }))} valueFormat={(v) => `${v}d`} onSelect={(d) => onOpen(`/attendance?tab=reports&preset=late_only&employee_id=${d.key}`)} />
          <Insight first={first} tone={rows.length ? 'warn' : 'ok'} text={rows.length ? `${rows[0].name} leads with ${rows[0].late_days} late day${rows[0].late_days === 1 ? '' : 's'} (avg ${rows[0].avg_late_minutes} min). Click a bar for the late-comers report.` : 'No late arrivals this month.'} />
        </>
      );
    }
    case 'work_hours_distribution': {
      const w = data.work_hours_distribution || { buckets: [], avg_hours: 0, employees: 0 };
      const colors = [C.bad, C.warn, C.ok, C.brand, C.violet];
      return (
        <>
          <BarChart data={w.buckets.map((b: any, i: number) => ({ ...b, color: colors[i] }))} height={150} onSelect={(d) => onOpen(`/attendance?tab=reports&hours_bucket=${d.key}`)} />
          <Insight first={first} text={w.employees ? `Average ${w.avg_hours} h per day across ${w.employees} employees this month.` : 'No work hours recorded this month.'} />
        </>
      );
    }
    case 'headcount_by_department': {
      const rows: any[] = data.headcount_by_department || [];
      return (
        <>
          <BarChart horizontal data={rows.map((r) => ({ key: String(r.id ?? ''), label: r.label, value: r.value }))} onSelect={(d) => onOpen(d.key ? `/employees?department_id=${d.key}` : '/employees')} />
          <Insight first={first} text={rows.length ? `${rows[0].label} is the largest team (${rows[0].value} of ${data.headcount}). Click a bar to list that department.` : 'No employees in scope.'} />
        </>
      );
    }
    case 'headcount_trend': {
      const h = data.headcount_trend || { labels: [], joins: [], exits: [] };
      const joins = sum(h.joins), exits = sum(h.exits);
      return (
        <>
          <LineChart labels={h.labels.map(monthLabel)} height={150} series={[{ name: 'Joins', values: h.joins, color: C.ok }, { name: 'Exits', values: h.exits, color: C.bad }]} onSelect={() => onOpen('/employees')} />
          <Insight first={first} tone={joins >= exits ? 'ok' : 'warn'} text={`${joins} joined and ${exits} left in the last 12 months (net ${joins - exits >= 0 ? '+' : ''}${joins - exits}).`} />
        </>
      );
    }
    case 'gender_diversity': {
      const rows: Datum[] = (data.gender_diversity || []).map((g: any, i: number) => ({ label: g.label, value: g.value, color: CHART_COLORS[i % CHART_COLORS.length] }));
      const total = sum(rows.map((r) => r.value));
      const top = [...rows].sort((a, b) => b.value - a.value)[0];
      return (
        <>
          <DonutChart data={rows} onSelect={(d) => onOpen(`/employees?gender=${encodeURIComponent(d.label.toLowerCase())}`)} />
          <Insight first={first} text={top ? `${top.label}: ${Math.round((top.value / total) * 100)}% of ${total} employees.` : 'No employees in scope.'} />
        </>
      );
    }
    case 'tenure_distribution': {
      const rows: any[] = data.tenure_distribution || [];
      const newest = rows[0]?.value || 0;
      return (
        <>
          <BarChart data={rows.map((r, i) => ({ ...r, color: CHART_COLORS[i] }))} height={150} onSelect={(d) => onOpen(`/employees?tenure=${d.key}`)} />
          <Insight first={first} text={`${newest} employee${newest === 1 ? '' : 's'} joined within the last year; ${rows[3]?.value || 0} have 5+ years.`} />
        </>
      );
    }
    case 'leave_utilisation': {
      const rows: any[] = data.leave_utilisation || [];
      const used = sum(rows.map((r) => r.used)), alloc = sum(rows.map((r) => r.allocated));
      return (
        <>
          <div className="hbar-chart">
            {rows.map((r) => {
              const p = r.allocated ? Math.min(100, Math.round((r.used / r.allocated) * 100)) : 0;
              return (
                <div key={r.id} className="hbar-row clickable" onClick={() => onOpen('/leave?tab=balances')} title={`${r.name}: ${r.used} used of ${r.allocated} allocated`}>
                  <span className="hbar-label">{r.name}</span>
                  <span className="hbar-track stacked"><span className="hbar-fill" style={{ width: `${p}%`, background: r.color || C.brand }} /></span>
                  <span className="hbar-value num">{r.used}/{r.allocated}</span>
                </div>
              );
            })}
            {rows.length === 0 ? <div className="chart-empty">No leave types</div> : null}
          </div>
          <Insight first={first} text={alloc ? `${Math.round((used / alloc) * 100)}% of allocated leave used so far this year (${used} of ${alloc} days).` : 'No leave allocated this year.'} />
        </>
      );
    }
    case 'leave_calendar_heat': {
      const days: any[] = data.leave_calendar_heat || [];
      const week1 = days.slice(0, 7), week2 = days.slice(7, 14);
      const cols = week1.map((d) => fmtDate(d.date, { weekday: 'short' }).slice(0, 2));
      const peak = [...days].sort((a, b) => b.count - a.count)[0];
      return (
        <>
          <Heatmap rows={[`${shortDay(week1[0]?.date || '')} →`, `${shortDay(week2[0]?.date || '')} →`]} cols={cols} values={[week1.map((d) => d.count), week2.map((d) => d.count)]} onSelect={(r, c) => { const d = days[r * 7 + c]; if (d) onOpen(`/leave?tab=calendar&date=${d.date}`); }} />
          <Insight first={first} tone={peak?.count >= 3 ? 'warn' : 'info'} text={peak?.count ? `Busiest day: ${shortDay(peak.date)} with ${peak.count} away (${peak.names.join(', ')}).` : 'Nobody is scheduled to be away in the next 14 days.'} />
        </>
      );
    }
    case 'payroll_cost_trend': {
      const runs: any[] = data.payroll_cost_trend || [];
      const last = runs[runs.length - 1], prev = runs[runs.length - 2];
      const d = last && prev ? delta(last.net, prev.net) : 0;
      return (
        <>
          <LineChart labels={runs.map((r) => r.period)} height={150} valueFormat={(v) => fmtMoney(v, currency)} series={[{ name: 'Gross', values: runs.map((r) => r.gross), color: C.brand }, { name: 'Net', values: runs.map((r) => r.net), color: C.accent }]} onSelect={(i) => onOpen(runs[i] ? `/payroll?tab=runs&run=${runs[i].id}` : '/payroll?tab=runs')} />
          <Insight first={first} tone={d > 10 ? 'warn' : 'info'} text={last ? (prev ? `Net payroll ${d >= 0 ? 'up' : 'down'} ${Math.abs(d)}% vs ${prev.period} (${fmtMoney(last.net, currency)} for ${last.employees} employees).` : `${last.period}: ${fmtMoney(last.net, currency)} net for ${last.employees} employees.`) : 'No processed payroll runs yet.'} />
        </>
      );
    }
    case 'payroll_by_department': {
      const p = data.payroll_by_department || { items: [] };
      const items: Datum[] = (p.items || []).map((x: any, i: number) => ({ key: String(x.id ?? ''), label: x.label, value: x.value, color: CHART_COLORS[i % CHART_COLORS.length], hint: `${x.label}: ${fmtMoney(x.value, currency)} (${x.employees} employees)` }));
      const total = sum(items.map((i) => i.value));
      return (
        <>
          <DonutChart data={items} valueFormat={(v) => fmtMoney(v, currency)} centerLabel={p.period || '—'} onSelect={() => onOpen(p.run_id ? `/payroll?tab=runs&run=${p.run_id}` : '/payroll?tab=runs')} />
          <Insight first={first} text={items.length ? `${items[0].label} accounts for ${Math.round((items[0].value / total) * 100)}% of ${p.period} gross.` : 'No processed run yet.'} />
        </>
      );
    }
    case 'document_compliance': {
      const c = data.document_compliance || {};
      const items: Datum[] = [
        { key: 'ok', label: 'Valid', value: c.ok || 0, color: C.ok }, { key: 'warning', label: 'Expiring', value: c.warning || 0, color: C.warn }, { key: 'critical', label: 'Critical', value: c.critical || 0, color: '#ea580c' },
        { key: 'expired', label: 'Expired', value: c.expired || 0, color: C.bad }, { key: 'missing', label: 'Missing', value: c.missing || 0, color: C.muted },
      ];
      const total = sum(items.map((i) => i.value));
      const bad = (c.expired || 0) + (c.missing || 0);
      return (
        <>
          <DonutChart data={items} centerLabel={total ? `${Math.round(((c.ok || 0) / total) * 100)}%` : '—'} onSelect={(d) => onOpen(d.key === 'ok' ? '/documents?tab=compliance' : d.key === 'missing' ? '/documents?tab=compliance' : `/documents?tab=expiring&state=${d.key}`)} />
          <Insight first={first} tone={bad ? 'bad' : c.expiring_7d ? 'warn' : 'ok'} text={c.required_types ? `${bad ? `${bad} required document${bad === 1 ? '' : 's'} missing or expired. ` : ''}${c.expiring_7d ? `${c.expiring_7d} document${c.expiring_7d === 1 ? '' : 's'} expire within 7 days.` : bad ? '' : 'All required documents are in place.'}` : 'No document types are marked as required.'} />
        </>
      );
    }
    case 'recruitment_funnel': {
      const f = data.recruitment_funnel || { stages: {} };
      const order = ['new', 'screening', 'interview', 'offer', 'hired'];
      const colors = [C.muted, C.info, C.brand, C.violet, C.ok];
      const rows: Datum[] = order.map((s, i) => ({ key: s, label: s[0].toUpperCase() + s.slice(1), value: f.stages?.[s] || 0, color: colors[i] }));
      return (
        <>
          <BarChart horizontal data={rows} onSelect={(d) => onOpen(`/recruitment?tab=pipeline&stage=${d.key}`)} />
          <Insight first={first} text={`${f.candidates || 0} candidate${f.candidates === 1 ? '' : 's'} in the pipeline · ${f.open_vacancies || 0} open vacanc${f.open_vacancies === 1 ? 'y' : 'ies'} (${f.openings || 0} openings)${f.stages?.rejected ? ` · ${f.stages.rejected} rejected` : ''}.`} />
        </>
      );
    }
    case 'time_to_hire': {
      const t = data.time_to_hire || { hires_by_month: [] };
      return (
        <>
          <div className="row" style={{ alignItems: 'flex-start', gap: 18 }}>
            <Gauge value={t.avg_days ?? 0} max={60} label="avg days to hire" color={t.avg_days != null && t.avg_days > 45 ? C.warn : C.ok} size={110} />
            <div style={{ flex: 1, minWidth: 0 }}><BarChart data={t.hires_by_month.map((m: any) => ({ label: monthLabel(m.label), value: m.value, key: m.label, color: C.ok }))} height={110} onSelect={() => onOpen('/recruitment?tab=pipeline&stage=hired')} /></div>
          </div>
          <Insight first={first} text={t.hires ? `${t.hires} hire${t.hires === 1 ? '' : 's'} so far, averaging ${t.avg_days} days from application to offer accepted.` : 'No hires through the pipeline yet.'} />
        </>
      );
    }
    case 'journey_progress': {
      const j = data.journey_progress || { by_stage: [] };
      return (
        <>
          <div className="row" style={{ alignItems: 'flex-start', gap: 18 }}>
            <Gauge value={j.avg_completion || 0} label="avg completion" size={110} />
            <div style={{ flex: 1, minWidth: 0 }}><BarChart horizontal data={(j.by_stage || []).map((s: any, i: number) => ({ label: s.label, value: s.value, color: CHART_COLORS[i % CHART_COLORS.length] }))} maxBars={6} onSelect={() => onOpen('/journey')} /></div>
          </div>
          <Insight first={first} text={j.by_stage?.length ? `${j.by_stage[0].value} employee${j.by_stage[0].value === 1 ? '' : 's'} currently at "${j.by_stage[0].label}".` : 'No journey stages in progress.'} />
        </>
      );
    }
    case 'asset_utilisation': {
      const a = data.asset_utilisation || {};
      const items: Datum[] = [
        { key: 'assigned', label: 'Assigned', value: a.assigned || 0, color: C.brand }, { key: 'available', label: 'Available', value: a.available || 0, color: C.ok }, { key: 'maintenance', label: 'Maintenance', value: a.maintenance || 0, color: C.warn },
        { key: 'retired', label: 'Retired', value: a.retired || 0, color: C.muted }, ...(a.lost ? [{ key: 'lost', label: 'Lost', value: a.lost, color: C.bad }] : []),
      ];
      return (
        <>
          <DonutChart data={items} centerLabel={a.total ? `${Math.round(((a.assigned || 0) / a.total) * 100)}%` : '—'} onSelect={(d) => onOpen(`/assets?status=${d.key}`)} />
          <Insight first={first} tone={a.warranty_expiring_30d ? 'warn' : 'info'} text={`${a.assigned || 0} of ${a.total || 0} assets in use${a.warranty_expiring_30d ? ` · ${a.warranty_expiring_30d} warrant${a.warranty_expiring_30d === 1 ? 'y expires' : 'ies expire'} within 30 days` : ''}.`} />
        </>
      );
    }
    case 'my_week': {
      const w = data.my_week || { days: [], today: {} };
      const statusColor: Record<string, string> = { present: C.ok, wfh: C.ok, half_day: C.warn, leave: C.info, absent: C.bad, off: C.muted, none: C.muted, holiday: C.muted, weekend: C.muted };
      const td = w.today || {};
      const todayText = td.status === 'punched_in' ? `Punched in at ${fmtTime(td.punch_in_at)}${td.late_minutes ? ` (${td.late_minutes} min late)` : ''}` : td.status === 'punched_out' ? `Done for today: ${fmtMinutes(td.work_minutes)} worked` : td.status === 'leave' ? 'You are on leave today' : td.status === 'off' ? 'Today is a day off' : 'Not punched in yet';
      return (
        <>
          <BarChart data={w.days.map((d: any) => ({ key: d.date, label: fmtDate(d.date, { weekday: 'short' }), value: d.hours, color: statusColor[d.status] || C.brand, hint: `${shortDay(d.date)}: ${d.hours} h · ${d.status}` }))} height={140} valueFormat={(v) => `${v}h`} onSelect={(d) => onOpen(`/attendance?date=${d.key}`)} />
          <Insight first={first} tone={td.status === 'not_in' ? 'warn' : 'ok'} text={`${todayText} · ${w.total_hours} h this week.`} />
        </>
      );
    }
    case 'my_leave_balance_chart': {
      const all: any[] = data.my_leave_balance_detail || [];
      // Unpaid leave and long special entitlements (maternity…) would dwarf the everyday balances, so list them separately.
      const everyday = (b: any) => Number(b.paid) === 1 && Number(b.annual_quota) <= 60;
      const rows = all.filter(everyday);
      const special = all.filter((b) => !everyday(b) && Number(b.paid) === 1 && b.available > 0);
      const items: Datum[] = rows.map((b, i) => ({ key: String(b.leave_type_id), label: b.name, value: Math.max(0, b.available), color: b.color || CHART_COLORS[i % CHART_COLORS.length], hint: `${b.name}: ${b.available} available · ${b.used} used of ${b.allocated + b.carried + b.adjusted}` }));
      const used = sum(rows.map((b) => b.used)), avail = sum(rows.map((b) => Math.max(0, b.available)));
      return (
        <>
          <DonutChart data={items} centerLabel={`${avail}`} onSelect={(d) => onOpen(`/leave?type=${d.key}`)} />
          <Insight first={first} text={rows.length ? `${avail} day${avail === 1 ? '' : 's'} available, ${used} used this year. Click a type to apply.${special.length ? ` Also eligible: ${special.map((b) => `${b.name} (${b.available})`).join(', ')}.` : ''}` : 'No leave balances for this year yet.'} />
        </>
      );
    }
    default:
      return <div className="chart-empty">Unknown chart “{k}”.</div>;
  }
}

/* ------------------------------------------------------------------ */
/* Add / edit                                                          */
/* ------------------------------------------------------------------ */
function AddCardModal({ catalog, onClose, onAdded }: { catalog: CatalogItem[]; onClose: () => void; onAdded: (c: CardDef) => void }) {
  const toast = useToast();
  const [kind, setKind] = useState<'catalog' | 'note' | 'link'>('catalog');
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [key, setKey] = useState(catalog[0]?.key || '');
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [size, setSize] = useState<CardSize | ''>('');
  const [busy, setBusy] = useState(false);
  const chosen = catalog.find((c) => c.key === key);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return catalog.filter((c) => (!category || c.category === category) && (!needle || c.title.toLowerCase().includes(needle) || c.category.toLowerCase().includes(needle) || (c.description || '').toLowerCase().includes(needle) || c.type.includes(needle)));
  }, [catalog, q, category]);
  const groups = useMemo(() => {
    const cats = Array.from(new Set(filtered.map((c) => c.category))).sort((a, b) => CATEGORY_ORDER.indexOf(a) - CATEGORY_ORDER.indexOf(b));
    return cats.map((cat) => ({ cat, items: filtered.filter((c) => c.category === cat) }));
  }, [filtered]);
  const allCategories = useMemo(() => Array.from(new Set(catalog.map((c) => c.category))).sort((a, b) => CATEGORY_ORDER.indexOf(a) - CATEGORY_ORDER.indexOf(b)), [catalog]);
  // Keep the selection valid when the filter changes.
  const effectiveKey = filtered.some((c) => c.key === key) ? key : filtered[0]?.key || '';
  const effective = catalog.find((c) => c.key === effectiveKey);
  const submit = async () => {
    setBusy(true);
    try {
      let body: any;
      if (kind === 'catalog') {
        if (!effective) throw new Error('Pick a card');
        body = { type: effective.type, title: title || effective.title, config: { key: effective.key }, size: size || effective.size };
      } else if (kind === 'note') body = { type: 'note', title: title || 'Note', config: { text }, size: size || 'md' };
      else body = { type: 'link', title: title || 'Quick links', config: {}, size: size || 'md' };
      const c = await api.post<CardDef>('/api/dashboard/cards', body);
      toast.success('Card added');
      onAdded(c);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open title="Add a card" onClose={onClose} testId="add-card-modal" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={submit} data-testid="add-card-submit">Add card</Button></>}>
      <div className="stack">
        <div className="row">
          {(['catalog', 'note', 'link'] as const).map((k) => <button key={k} className={`pill ${kind === k ? 'active' : ''}`} onClick={() => setKind(k)}>{k === 'catalog' ? 'From the catalog' : k === 'note' ? 'Note' : 'Quick links'}</button>)}
        </div>
        {kind === 'catalog' ? (
          <>
            <div className="row" style={{ alignItems: 'stretch' }}>
              <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search cards… e.g. late, payroll, leave" aria-label="Search cards" data-testid="add-card-search" style={{ flex: 1 }} />
            </div>
            <div className="chip-list catalog-cats">
              <button type="button" className={`pill ${category === '' ? 'active' : ''}`} onClick={() => setCategory('')}>All</button>
              {allCategories.map((cat) => <button type="button" key={cat} className={`pill ${category === cat ? 'active' : ''}`} onClick={() => setCategory(cat)}>{cat}</button>)}
            </div>
            <Field label="Card" hint={`${filtered.length} card${filtered.length === 1 ? '' : 's'} match`}>
              <Select value={effectiveKey} onChange={(e) => setKey(e.target.value)} data-testid="add-card-key">
                {groups.map((g) => (
                  <optgroup key={g.cat} label={g.cat}>
                    {g.items.map((c) => <option key={c.key} value={c.key}>{c.title} ({c.type})</option>)}
                  </optgroup>
                ))}
              </Select>
            </Field>
            {effective ? (
              <div className="catalog-preview" data-testid="add-card-preview">
                <span className="catalog-icon"><Icon name={effective.icon || 'grid'} size={20} /></span>
                <div>
                  <div className="row" style={{ gap: 6 }}><strong>{effective.title}</strong><Badge tone="neutral">{effective.category}</Badge><Badge tone="info">{effective.chart ? `${effective.chart} chart` : effective.type}</Badge></div>
                  <div className="help">{effective.description || `Shows ${effective.title.toLowerCase()} as a ${effective.type} card.`}{effective.type === 'chart' ? ' Click any part of the chart to drill down.' : ''}</div>
                </div>
              </div>
            ) : <div className="help">No cards match your search.</div>}
          </>
        ) : null}
        <Field label="Title" hint="Optional — defaults to the card name"><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={effective?.title} /></Field>
        {kind === 'note' ? <Field label="Note"><Textarea value={text} onChange={(e) => setText(e.target.value)} /></Field> : null}
        <Field label="Size"><Select value={size} onChange={(e) => setSize(e.target.value as any)}><option value="">Default{effective && kind === 'catalog' ? ` (${{ sm: 'small', md: 'medium', lg: 'large' }[effective.size]})` : ''}</option><option value="sm">Small</option><option value="md">Medium</option><option value="lg">Large</option></Select></Field>
        <p className="help">You can add as many cards as you like — there is no limit.</p>
      </div>
    </Modal>
  );
}

function EditCardModal({ card, onClose, onSaved }: { card: CardDef; onClose: () => void; onSaved: (c: CardDef) => void }) {
  const toast = useToast();
  const [title, setTitle] = useState(card.title);
  const [text, setText] = useState(card.config?.text || '');
  const [links, setLinks] = useState<{ label: string; to: string }[]>(card.config?.links || []);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      const config = { ...card.config };
      if (card.type === 'note') config.text = text;
      if (card.type === 'link') config.links = links.filter((l) => l.label && l.to);
      const c = await api.put<CardDef>(`/api/dashboard/cards/${card.id}`, { title, config });
      onSaved(c);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open title="Edit card" onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={submit}>Save</Button></>}>
      <div className="stack">
        <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        {card.type === 'note' ? <Field label="Note"><Textarea value={text} onChange={(e) => setText(e.target.value)} /></Field> : null}
        {card.type === 'link' ? (
          <div className="stack">
            <span className="field-label">Links</span>
            {links.map((l, i) => (
              <div className="row" key={i}>
                <Input placeholder="Label" value={l.label} onChange={(e) => setLinks(links.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                <Input placeholder="/path" value={l.to} onChange={(e) => setLinks(links.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)))} />
                <Button variant="ghost" size="sm" onClick={() => setLinks(links.filter((_, j) => j !== i))}>✕</Button>
              </div>
            ))}
            <div><Button size="sm" onClick={() => setLinks([...links, { label: '', to: '/' }])}>+ Add link</Button></div>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
