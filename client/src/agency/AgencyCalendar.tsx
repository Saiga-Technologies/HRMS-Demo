import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, qs } from '../lib/api';
import { usePageTour } from '../lib/tour';
import { fmtDate, todayIso } from '../lib/format';
import { Badge, Button, Card, PageHeader, Spinner, Stat, useFetch } from '../components/ui';
import { Icon } from '../components/Icons';
import { followLink } from './AgencyApp';
import { CompanyChip, daysBetween, daysPhrase } from './ops/shared';
import './calendar.css';

export interface CalEvent {
  date: string;
  company_slug: string;
  company_name: string;
  brand_color: string | null;
  kind: 'payroll' | 'compliance' | 'invoice';
  key: string;
  title: string;
  detail: string;
  owner: 'agency' | 'client';
  status: string;
  link: string;
}
interface CalResponse { from: string; to: string; today: string; events: CalEvent[] }
interface CompanyLite { id: number; slug: string; name: string; status: string; brand_color: string | null }

type Bucket = 'overdue' | 'due_soon' | 'upcoming' | 'done';
const bucket = (s: string): Bucket => (s === 'overdue' ? 'overdue' : s === 'due_today' || s === 'due_soon' ? 'due_soon' : ['done', 'filed', 'not_applicable', 'paid'].includes(s) ? 'done' : 'upcoming');
const BUCKET_LABEL: Record<Bucket, string> = { overdue: 'Overdue', due_soon: 'Due soon', upcoming: 'Upcoming', done: 'Done' };
const KIND_LABEL: Record<CalEvent['kind'], string> = { payroll: 'Payroll', compliance: 'Compliance', invoice: 'Invoice' };
const KIND_ICON: Record<CalEvent['kind'], string> = { payroll: 'banknote', compliance: 'shield', invoice: 'file' };
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const parse = (s: string) => new Date(s + 'T00:00:00Z');
const addDays = (s: string, n: number) => { const d = parse(s); d.setUTCDate(d.getUTCDate() + n); return ymd(d); };
const shiftMonth = (m: string, n: number) => { const [y, mo] = m.split('-').map(Number); const d = new Date(Date.UTC(y, mo - 1 + n, 1)); return ymd(d).slice(0, 7); };
const monthTitle = (m: string) => parse(`${m}-01`).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
/** Monday-first 6-week grid covering the month. */
function gridFor(month: string) {
  const first = `${month}-01`;
  const dow = (parse(first).getUTCDay() + 6) % 7;
  const start = addDays(first, -dow);
  const lastOfMonth = addDays(`${shiftMonth(month, 1)}-01`, -1);
  const weeks = Math.ceil((dow + Number(lastOfMonth.slice(8))) / 7);
  return { start, end: addDays(start, weeks * 7 - 1), days: Array.from({ length: weeks * 7 }, (_, i) => addDays(start, i)) };
}

const TOUR = [
  { element: '[data-tour="cal-stats"]', title: 'This month at a glance', description: 'Overdue items, what falls due in the next seven days, and how many payroll milestones and statutory filings land this month across every company you look after.' },
  { element: '[data-tour="cal-nav"]', title: 'Move through months', description: 'Step back and forward a month, jump to today, and switch between the month grid and an agenda list.' },
  { element: '[data-tour="cal-filters"]', title: 'Filters', description: 'Narrow by company, by kind (payroll milestones, statutory filings, invoice due dates), by who owns the step (agency or client) and by status.' },
  { element: '[data-tour="cal-legend"]', title: 'Reading an event', description: 'The fill shows the kind; the left stripe is the company\'s brand colour. Overdue items are outlined in red and done items are struck through.' },
  { element: '[data-tour="cal-grid"]', title: 'The calendar', description: 'Today is highlighted. Click any event to jump to it: payroll steps open the company\'s payroll calendar, filings open its compliance list, invoices open billing.' },
  { element: '[data-tour="cal-week"]', title: 'This week', description: 'The next payroll step for each company with a countdown, so nothing slips between inputs, attendance cut-off, generation, approval and payment.' },
];

function MultiPick<T extends string>({ label, options, value, onChange, testId }: { label: string; options: { value: T; label: React.ReactNode }[]; value: T[]; onChange: (v: T[]) => void; testId?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  const toggle = (v: T) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  return (
    <div className="cal-pick" ref={ref}>
      <button type="button" className={`cal-pick-btn ${value.length ? 'active' : ''}`} onClick={() => setOpen((o) => !o)} data-testid={testId} aria-expanded={open}>
        <Icon name="filter" size={14} /> {label}{value.length ? <span className="cal-pick-count">{value.length}</span> : null} <Icon name="chevronDown" size={14} />
      </button>
      {open ? (
        <div className="dropdown cal-pick-menu">
          {options.map((o) => (
            <label key={o.value} className="cal-pick-opt">
              <input type="checkbox" checked={value.includes(o.value)} onChange={() => toggle(o.value)} />
              <span>{o.label}</span>
            </label>
          ))}
          {value.length ? <button type="button" className="cal-pick-clear" onClick={() => onChange([])}>Clear</button> : null}
        </div>
      ) : null}
    </div>
  );
}

function EventChip({ e, today, onOpen, compact }: { e: CalEvent; today: string; onOpen: (e: CalEvent) => void; compact?: boolean }) {
  const b = bucket(e.status);
  const left = daysBetween(today, e.date);
  return (
    <button
      type="button"
      className={`cal-ev kind-${e.kind} st-${b}`}
      style={{ '--stripe': e.brand_color || 'var(--border-strong)' } as React.CSSProperties}
      onClick={(ev) => { ev.stopPropagation(); onOpen(e); }}
      title={`${e.company_name} · ${e.title} · ${e.detail} · ${e.owner === 'client' ? 'client' : 'agency'} · ${b === 'done' ? 'done' : daysPhrase(left)}`}
      data-testid="cal-event"
      data-company={e.company_slug}
      data-kind={e.kind}
    >
      {b === 'overdue' ? <Icon name="alert" size={12} /> : b === 'done' ? <Icon name="check" size={12} /> : null}
      <span className="cal-ev-co">{compact ? e.company_name.split(' ')[0] : e.company_name}</span>
      <span className="cal-ev-title">{e.title}</span>
    </button>
  );
}

export default function AgencyCalendar() {
  usePageTour('Payroll & compliance calendar', TOUR);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const month = /^\d{4}-\d{2}$/.test(params.get('month') || '') ? params.get('month')! : todayIso().slice(0, 7);
  const view = params.get('view') === 'agenda' ? 'agenda' : 'month';
  const setParam = (k: string, v: string | null) => setParams((p) => { const n = new URLSearchParams(p); if (v) n.set(k, v); else n.delete(k); return n; }, { replace: true });
  // ?company=<slug> (from a portfolio card's Calendar button) pre-filters to that company.
  const [companies, setCompanies] = useState<string[]>(() => (params.get('company') ? [params.get('company')!] : []));
  const [kinds, setKinds] = useState<CalEvent['kind'][]>([]);
  const [owners, setOwners] = useState<CalEvent['owner'][]>([]);
  const [statuses, setStatuses] = useState<Bucket[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);

  const grid = useMemo(() => gridFor(month), [month]);
  const cal = useFetch<CalResponse>(() => api.get(`/api/agency/calendar${qs({ from: grid.start, to: grid.end })}`), [grid.start, grid.end]);
  const t0 = todayIso();
  const week = useFetch<CalResponse>(() => api.get(`/api/agency/calendar${qs({ from: addDays(t0, -21), to: addDays(t0, 7) })}`), [t0]);
  const list = useFetch<CompanyLite[]>(() => api.get('/api/agency/companies?light=1'), []);
  const today = cal.data?.today || week.data?.today || t0;

  const filtered = useMemo(() => (cal.data?.events || []).filter((e) =>
    (!companies.length || companies.includes(e.company_slug))
    && (!kinds.length || kinds.includes(e.kind))
    && (!owners.length || owners.includes(e.owner))
    && (!statuses.length || statuses.includes(bucket(e.status)))), [cal.data, companies, kinds, owners, statuses]);
  const byDate = useMemo(() => {
    const m = new Map<string, CalEvent[]>();
    for (const e of filtered) { if (!m.has(e.date)) m.set(e.date, []); m.get(e.date)!.push(e); }
    return m;
  }, [filtered]);
  const inMonth = filtered.filter((e) => e.date.startsWith(month));
  const all = cal.data?.events || [];
  const stats = {
    overdue: all.filter((e) => bucket(e.status) === 'overdue').length,
    next7: all.filter((e) => bucket(e.status) !== 'done' && e.date >= today && e.date <= addDays(today, 7)).length,
    payroll: all.filter((e) => e.kind === 'payroll' && e.date.startsWith(month)).length,
    filings: all.filter((e) => e.kind === 'compliance' && e.date.startsWith(month)).length,
  };

  /** Next open payroll step per company (overdue first, then within the coming week). */
  const countdowns = useMemo(() => {
    const m = new Map<string, CalEvent>();
    for (const e of week.data?.events || []) {
      if (e.kind !== 'payroll' || bucket(e.status) === 'done') continue;
      if (companies.length && !companies.includes(e.company_slug)) continue;
      const cur = m.get(e.company_slug);
      if (!cur || e.date < cur.date) m.set(e.company_slug, e);
    }
    return [...m.values()].filter((e) => e.date <= addDays(today, 7)).sort((a, b) => a.date.localeCompare(b.date) || a.company_name.localeCompare(b.company_name));
  }, [week.data, companies, today]);

  const openEvent = (e: CalEvent) => followLink(e.company_slug, e.link, navigate);
  const companyOptions = (list.data || []).filter((c) => c.status !== 'offboarded').map((c) => ({ value: c.slug, label: <span className="row" style={{ gap: 6 }}><span className="ops-company-dot" style={{ background: c.brand_color || 'var(--brand)' }} />{c.name}</span> }));

  return (
    <div className="ops-page">
      <PageHeader title="Payroll & compliance calendar" subtitle="Payroll milestones, statutory filings and invoice due dates for every client company in one place." />

      <div className="stat-strip" data-tour="cal-stats">
        <Stat label="Overdue" value={cal.data ? stats.overdue : '…'} icon="alert" color="var(--danger)" hint="In the visible range" onClick={() => setStatuses(['overdue'])} />
        <Stat label="Due in 7 days" value={cal.data ? stats.next7 : '…'} icon="clock" color="var(--warning)" hint="Not done yet" />
        <Stat label="Payroll milestones" value={cal.data ? stats.payroll : '…'} icon="banknote" color="var(--brand)" hint={monthTitle(month)} onClick={() => setKinds(['payroll'])} />
        <Stat label="Statutory filings" value={cal.data ? stats.filings : '…'} icon="shield" color="var(--accent)" hint={monthTitle(month)} onClick={() => setKinds(['compliance'])} />
      </div>

      <div className="cal-layout">
        <div className="cal-main">
          <Card padded={false}>
            <div className="cal-head" data-tour="cal-nav">
              <div className="row" style={{ gap: 6 }}>
                <Button size="sm" onClick={() => setParam('month', shiftMonth(month, -1))} aria-label="Previous month" data-testid="cal-prev"><Icon name="chevronLeft" size={16} /></Button>
                <Button size="sm" onClick={() => setParam('month', shiftMonth(month, 1))} aria-label="Next month" data-testid="cal-next"><Icon name="chevronRight" size={16} /></Button>
                <h2 className="cal-title" data-testid="cal-title">{monthTitle(month)}</h2>
                {month !== today.slice(0, 7) ? <Button size="sm" variant="ghost" onClick={() => setParam('month', null)} data-testid="cal-today">Today</Button> : null}
              </div>
              <div className="cal-seg" role="tablist" aria-label="View">
                <button role="tab" aria-selected={view === 'month'} className={view === 'month' ? 'active' : ''} onClick={() => setParam('view', null)} data-testid="cal-view-month"><Icon name="grid" size={14} /> Month</button>
                <button role="tab" aria-selected={view === 'agenda'} className={view === 'agenda' ? 'active' : ''} onClick={() => setParam('view', 'agenda')} data-testid="cal-view-agenda"><Icon name="clipboard" size={14} /> Agenda</button>
              </div>
            </div>
            <div className="cal-filters" data-tour="cal-filters">
              <MultiPick label="Company" options={companyOptions} value={companies} onChange={setCompanies} testId="cal-filter-company" />
              <MultiPick label="Kind" options={(['payroll', 'compliance', 'invoice'] as const).map((k) => ({ value: k, label: KIND_LABEL[k] }))} value={kinds} onChange={setKinds} testId="cal-filter-kind" />
              <MultiPick label="Owner" options={[{ value: 'agency' as const, label: 'Agency' }, { value: 'client' as const, label: 'Client' }]} value={owners} onChange={setOwners} testId="cal-filter-owner" />
              <MultiPick label="Status" options={(['overdue', 'due_soon', 'upcoming', 'done'] as Bucket[]).map((b) => ({ value: b, label: BUCKET_LABEL[b] }))} value={statuses} onChange={setStatuses} testId="cal-filter-status" />
              {companies.length || kinds.length || owners.length || statuses.length ? (
                <Button size="sm" variant="ghost" onClick={() => { setCompanies([]); setKinds([]); setOwners([]); setStatuses([]); }} data-testid="cal-filter-clear">Clear filters</Button>
              ) : null}
              <div className="cal-legend" data-tour="cal-legend">
                {(['payroll', 'compliance', 'invoice'] as const).map((k) => <span key={k} className={`cal-legend-item kind-${k}`}><span className="cal-legend-swatch" />{KIND_LABEL[k]}</span>)}
                <span className="cal-legend-item st-overdue"><span className="cal-legend-swatch" />Overdue</span>
              </div>
            </div>

            {cal.error ? <div className="alert alert-error" style={{ margin: 12 }}>{cal.error}</div> : null}
            {cal.loading && !cal.data ? <Spinner /> : view === 'month' ? (
              <div className="cal-grid" data-tour="cal-grid" data-testid="cal-grid">
                {WEEKDAYS.map((d) => <div key={d} className="cal-dow">{d}</div>)}
                {grid.days.map((d) => {
                  const evs = byDate.get(d) || [];
                  const isOpen = expanded === d;
                  const limit = isOpen ? evs.length : 3;
                  return (
                    <div key={d} className={`cal-day ${d.startsWith(month) ? '' : 'out'} ${d === today ? 'today' : ''} ${evs.some((e) => bucket(e.status) === 'overdue') ? 'has-overdue' : ''}`} data-date={d} data-testid={d === today ? 'cal-today-cell' : undefined}>
                      <div className="cal-day-num">{d === today ? <span className="cal-today-pill">Today</span> : null}<span>{Number(d.slice(8))}</span></div>
                      <div className="cal-day-events">
                        {evs.slice(0, limit).map((e, i) => <EventChip key={i} e={e} today={today} onOpen={openEvent} compact />)}
                        {evs.length > 3 ? (
                          <button type="button" className="cal-more" onClick={() => setExpanded(isOpen ? null : d)}>{isOpen ? 'Show less' : `+${evs.length - 3} more`}</button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="cal-agenda" data-tour="cal-grid" data-testid="cal-agenda">
                {!inMonth.length ? <p className="muted" style={{ padding: 16 }}>Nothing scheduled in {monthTitle(month)} for these filters.</p> : null}
                {[...new Set(inMonth.map((e) => e.date))].map((d) => (
                  <div key={d} className={`cal-agenda-day ${d === today ? 'today' : ''}`}>
                    <div className="cal-agenda-date">
                      <strong>{parse(d).toLocaleDateString(undefined, { day: 'numeric', timeZone: 'UTC' })}</strong>
                      <small>{parse(d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', timeZone: 'UTC' })}</small>
                      {d === today ? <span className="cal-today-pill">Today</span> : null}
                    </div>
                    <div className="cal-agenda-list">
                      {inMonth.filter((e) => e.date === d).map((e, i) => {
                        const b = bucket(e.status);
                        const left = daysBetween(today, e.date);
                        return (
                          <button key={i} type="button" className={`cal-agenda-row kind-${e.kind} st-${b}`} style={{ '--stripe': e.brand_color || 'var(--border-strong)' } as React.CSSProperties} onClick={() => openEvent(e)} data-testid="cal-event" data-company={e.company_slug} data-kind={e.kind}>
                            <span className="cal-agenda-kind"><Icon name={KIND_ICON[e.kind]} size={15} /></span>
                            <span className="cal-agenda-main">
                              <strong>{e.title}</strong>
                              <small>{e.company_name} · {e.detail}</small>
                            </span>
                            <span className="cal-agenda-meta">
                              <Badge tone={e.owner === 'client' ? 'warning' : 'info'}>{e.owner === 'client' ? 'Client' : 'Agency'}</Badge>
                              <Badge tone={b === 'overdue' ? 'danger' : b === 'due_soon' ? 'warning' : b === 'done' ? 'success' : 'neutral'}>{b === 'done' ? 'Done' : daysPhrase(left)}</Badge>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        <aside className="cal-side" data-tour="cal-week">
          <Card title="This week" actions={<small className="muted">Payroll countdown</small>}>
            {week.loading && !week.data ? <Spinner /> : !countdowns.length ? (
              <p className="muted" style={{ margin: 0 }}>No payroll steps due in the next 7 days.</p>
            ) : (
              <ul className="cal-countdowns" data-testid="cal-week">
                {countdowns.map((e) => {
                  const left = daysBetween(today, e.date);
                  return (
                    <li key={e.company_slug}>
                      <button type="button" className={`cal-countdown st-${bucket(e.status)}`} onClick={() => openEvent(e)} data-testid="cal-countdown">
                        <span className="cal-countdown-days"><strong>{left < 0 ? -left : left}</strong><small>{left < 0 ? 'late' : left === 0 ? 'today' : left === 1 ? 'day' : 'days'}</small></span>
                        <span className="cal-countdown-body">
                          <CompanyChip name={e.company_name} color={e.brand_color} />
                          <span className="cal-countdown-text">{e.title} — {daysPhrase(left).toLowerCase()}</span>
                          <small className="muted">{e.detail} · {fmtDate(e.date)} · {e.owner === 'client' ? 'waiting on the client' : 'agency task'}</small>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </aside>
      </div>
    </div>
  );
}
