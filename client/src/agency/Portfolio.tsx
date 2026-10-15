import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { usePageTour } from '../lib/tour';
import { Button, Card, EmptyState, PageHeader, SearchInput, Select, Stat, Table, useFetch } from '../components/ui';
import { Icon } from '../components/Icons';
import { openCompany, followLink, type AgencyAlert } from './AgencyApp';
import CompanyDrawer from './portfolio/CompanyDrawer';
import { FLAG } from './AgencyBar';
import { COUNTRY_NAME, Countdown, HEALTH_LABEL, HealthPill, LogoTile, MARKETS, MilestoneTrack, STATUS_LABEL, daysText, fmtMinor, plural, urgency, type Health, type PortfolioCompany, type Staff, type Summary } from './portfolio/bits';
import './portfolio.css';

const TOUR = [
  { element: '[data-tour="pf-header"]', title: 'Your portfolio', description: 'Every client company your agency runs HR and payroll for. Account managers see only the companies assigned to them.' },
  { element: '[data-tour="pf-stats"]', title: 'Portfolio at a glance', description: 'Companies and employees under management, how many are healthy, payrolls due in the next 7 days, statutory filings and open service requests.' },
  { element: '[data-tour="pf-attention"]', title: 'Needs attention', description: 'The most urgent items across all companies: payroll milestones about to slip, overdue filings, requests past SLA and unpaid invoices. Click one to jump straight to it.' },
  { element: '[data-tour="pf-filters"]', title: 'Find a company', description: 'Search by name, city or industry and narrow by market (India, GCC, US), health or account manager. Switch between cards and a table.' },
  { element: '[data-tour="pf-list"]', title: 'Company cards', description: 'Each card shows the payroll countdown to the next milestone (the last three days are highlighted), the five-step payroll track, compliance, requests and billing. Click a card for details.' },
  { element: '[data-tour="pf-open"]', title: 'Open a company', description: 'Open takes you inside the company with full HR access. The agency bar at the top lets you switch company or come back here.' },
];

const HEALTH_RANK: Record<Health, number> = { red: 0, amber: 1, green: 2 };
const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };
const readView = (): 'cards' | 'table' => { try { return localStorage.getItem('hrms:portfolio-view') === 'table' ? 'table' : 'cards'; } catch { return 'cards'; } };

export default function Portfolio({ alerts }: { alerts: AgencyAlert[] }) {
  usePageTour('Portfolio', TOUR);
  const { agency } = useAuth();
  const navigate = useNavigate();
  const companies = useFetch<PortfolioCompany[]>(() => api.get('/api/agency/companies'), []);
  const summary = useFetch<Summary>(() => api.get('/api/agency/summary'), []);
  const meta = useFetch<{ staff: Staff[] }>(() => api.get('/api/agency/meta'), []);
  const [q, setQ] = useState('');
  const [market, setMarket] = useState('');
  const [health, setHealth] = useState('');
  const [am, setAm] = useState('');
  const [sort, setSort] = useState<'urgent' | 'name' | 'headcount'>('urgent');
  const [view, setViewState] = useState<'cards' | 'table'>(readView);
  const [drawer, setDrawer] = useState<string | null>(null);
  const setView = (v: 'cards' | 'table') => { setViewState(v); try { localStorage.setItem('hrms:portfolio-view', v); } catch { /* ignore */ } };

  const role = agency?.role || '';
  const canOnboard = ['owner', 'admin', 'account_manager'].includes(role);
  const list = companies.data || [];
  const managers = useMemo(() => {
    const m = new Map<number, string>();
    for (const c of list) if (c.account_manager_id) m.set(c.account_manager_id, c.account_manager_name || `#${c.account_manager_id}`);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [list]);
  const bySlug = useMemo(() => new Map(list.map((c) => [c.slug, c])), [list]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const codes = MARKETS.find((m) => m.key === market)?.codes;
    const rows = list.filter((c) =>
      (!needle || [c.name, c.legal_name, c.city, c.region, c.industry, COUNTRY_NAME[c.country_code]].some((v) => v?.toLowerCase().includes(needle)))
      && (!codes || codes.includes(c.country_code))
      && (!health || c.snapshot?.health === health)
      && (!am || String(c.account_manager_id ?? '') === am));
    const daysOf = (c: PortfolioCompany) => c.snapshot?.payroll.next?.days_left ?? 999;
    return [...rows].sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name);
      if (sort === 'headcount') return (b.snapshot?.headcount ?? -1) - (a.snapshot?.headcount ?? -1);
      const off = Number(a.status === 'offboarded') - Number(b.status === 'offboarded');
      return off || HEALTH_RANK[a.snapshot?.health || 'green'] - HEALTH_RANK[b.snapshot?.health || 'green'] || daysOf(a) - daysOf(b) || a.name.localeCompare(b.name);
    });
  }, [list, q, market, health, am, sort]);

  const attention = alerts.filter((a) => a.severity !== 'info').slice(0, 6);
  const s = summary.data;
  const firstName = agency?.first_name || '';
  const scope = role === 'account_manager'
    ? `You manage ${plural(s?.companies ?? list.length, 'client company', 'client companies')}.`
    : `All ${plural(s?.companies ?? list.length, 'client company', 'client companies')} across India, the GCC and the US.`;
  const filtered = q || market || health || am;
  const reload = () => { companies.reload(); summary.reload(); };

  return (
    <div className="pf-page">
      <PageHeader
        tour="pf-header"
        title={`${greeting()}${firstName ? `, ${firstName}` : ''}`}
        subtitle={<span data-testid="pf-scope">{scope} {s ? <span className="muted">Today is {new Date(s.today + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}.</span> : null}</span>}
        actions={canOnboard ? <Button variant="primary" onClick={() => navigate('/agency/companies/new')} data-testid="pf-add-company"><Icon name="plus" size={15} /> Add a client company</Button> : undefined}
      />

      <div className="stat-strip" data-tour="pf-stats">
        <Stat label="Client companies" value={s ? s.companies : '…'} icon="building" color="var(--brand)"
          hint={s ? s.by_country.map((x) => `${x.companies} ${FLAG[x.country_code] || x.country_code}`).join(' · ') : undefined} />
        <Stat label="Employees managed" value={s ? s.employees.toLocaleString() : '…'} icon="users" color="var(--info)" />
        <Stat label="Health" value={s ? <span className="pf-health-split"><span className="g">{s.health.green}</span><span className="a">{s.health.amber}</span><span className="r">{s.health.red}</span></span> : '…'} icon="shield" color="var(--success)"
          hint="healthy · watch · at risk" onClick={() => setHealth(health === 'red' ? '' : 'red')} />
        <Stat label="Payroll due in 7 days" value={s ? s.payroll_due_7d : '…'} icon="banknote" color="var(--warning)" hint="next milestone within a week" onClick={() => navigate('/agency/calendar')} />
        <Stat label="Filings" value={s ? <span>{s.filings_overdue}<small className="pf-stat-small"> overdue</small></span> : '…'} icon="clipboard" color="var(--danger)" hint={s ? `${s.filings_due_7d} due this week` : undefined} onClick={() => navigate('/agency/calendar')} />
        <Stat label="Open requests" value={s ? s.requests_open : '…'} icon="heartHandshake" color="var(--accent)" hint={s ? `${s.requests_breached} past SLA` : undefined} onClick={() => navigate('/agency/requests')} />
      </div>

      <Card tour="pf-attention" className="pf-attention" title={<span className="row" style={{ gap: 8 }}><Icon name="alert" size={16} /> Needs attention</span>}
        actions={<span className="muted" style={{ fontSize: 12.5 }}>{alerts.length ? `${plural(alerts.length, 'alert')} in total` : ''}</span>}>
        {attention.length ? (
          <div className="pf-attention-list" data-testid="pf-attention">
            {attention.map((a) => {
              const c = bySlug.get(a.company_slug);
              return (
                <button key={a.id} className={`pf-alert sev-${a.severity}`} onClick={() => followLink(a.company_slug, a.link, navigate)} data-testid="pf-alert">
                  <LogoTile c={c || { name: a.company_name, logo_text: null, brand_color: null }} size="sm" />
                  <span className="pf-alert-body">
                    <strong>{a.title}</strong>
                    <small>{a.company_name} · {a.detail}</small>
                  </span>
                  <span className={`badge badge-${a.severity === 'critical' ? 'danger' : 'warning'}`}>{a.severity === 'critical' ? 'Critical' : 'Soon'}</span>
                </button>
              );
            })}
          </div>
        ) : <div className="pf-allclear"><Icon name="check" size={16} /> Nothing urgent. Every payroll, filing and request is on track.</div>}
      </Card>

      <div className="toolbar pf-toolbar" data-tour="pf-filters">
        <SearchInput value={q} onChange={setQ} placeholder="Search company, city, industry…" />
        <div className="pf-seg" role="group" aria-label="Market">
          <button className={!market ? 'active' : ''} onClick={() => setMarket('')} data-testid="pf-market-all">All</button>
          {MARKETS.map((m) => <button key={m.key} className={market === m.key ? 'active' : ''} onClick={() => setMarket(m.key)} data-testid={`pf-market-${m.key}`}>{m.label}</button>)}
        </div>
        <Select value={health} onChange={(e) => setHealth(e.target.value)} aria-label="Health" data-testid="pf-filter-health">
          <option value="">Any health</option>
          {(['red', 'amber', 'green'] as Health[]).map((h) => <option key={h} value={h}>{HEALTH_LABEL[h]}</option>)}
        </Select>
        {managers.length > 1 ? (
          <Select value={am} onChange={(e) => setAm(e.target.value)} aria-label="Account manager" data-testid="pf-filter-am">
            <option value="">All account managers</option>
            {managers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </Select>
        ) : null}
        <Select value={sort} onChange={(e) => setSort(e.target.value as any)} aria-label="Sort">
          <option value="urgent">Most urgent first</option>
          <option value="name">Name</option>
          <option value="headcount">Headcount</option>
        </Select>
        {filtered ? <Button size="sm" variant="ghost" onClick={() => { setQ(''); setMarket(''); setHealth(''); setAm(''); }}>Clear</Button> : null}
        <span className="pf-toolbar-end">
          <span className="muted">{companies.data ? plural(shown.length, 'company', 'companies') : ''}</span>
          <span className="pf-seg" role="group" aria-label="View">
            <button className={view === 'cards' ? 'active' : ''} onClick={() => setView('cards')} aria-label="Card view" data-testid="pf-view-cards"><Icon name="grid" size={15} /></button>
            <button className={view === 'table' ? 'active' : ''} onClick={() => setView('table')} aria-label="Table view" data-testid="pf-view-table"><Icon name="menu" size={15} /></button>
          </span>
        </span>
      </div>

      {companies.error ? <div className="alert alert-error">{companies.error}</div> : null}
      {companies.loading && !companies.data ? <Card><div className="loading"><span className="spinner" /> Loading your companies…</div></Card> : null}
      {companies.data && !shown.length ? (
        <Card>
          <EmptyState title={filtered ? 'No companies match' : 'No client companies yet'} description={filtered ? 'Try another search or clear the filters.' : canOnboard ? 'Onboard your first client to start running their payroll.' : 'Ask an agency admin to assign companies to you.'}
            action={!filtered && canOnboard ? <Button variant="primary" onClick={() => navigate('/agency/companies/new')}>Add a client company</Button> : undefined} />
        </Card>
      ) : null}

      {shown.length && view === 'cards' ? (
        <div className="pf-grid" data-tour="pf-list" data-testid="pf-grid">
          {shown.map((c, i) => <CompanyCard key={c.slug} c={c} first={i === 0} onDetails={() => setDrawer(c.slug)} onCalendar={() => navigate(`/agency/calendar?company=${c.slug}`)} />)}
        </div>
      ) : null}
      {shown.length && view === 'table' ? (
        <Card padded={false} tour="pf-list">
          <Table<PortfolioCompany>
            rows={shown}
            keyField="slug"
            onRowClick={(c) => setDrawer(c.slug)}
            columns={[
              { key: 'name', header: 'Company', render: (c) => <span className="pf-table-name"><LogoTile c={c} size="sm" /><span><strong data-testid="pf-row-name">{c.name}</strong><div className="muted">{[c.city, COUNTRY_NAME[c.country_code]].filter(Boolean).join(', ')}</div></span></span> },
              { key: 'health', header: 'Health', render: (c) => (c.snapshot ? <HealthPill health={c.snapshot.health} reasons={c.snapshot.reasons} /> : <span className="badge badge-neutral">{STATUS_LABEL[c.status]}</span>) },
              { key: 'payroll', header: 'Payroll', render: (c) => (c.snapshot ? <span><strong className={`pf-u-text pf-u-${urgency(c.snapshot.payroll.next)}`}>{c.snapshot.payroll.next ? `${c.snapshot.payroll.next.label}: ${daysText(c.snapshot.payroll.next.days_left)}` : 'Complete'}</strong><div className="muted">{c.snapshot.payroll.period} · {c.snapshot.payroll.stage}</div></span> : '—') },
              { key: 'headcount', header: 'People', align: 'right', render: (c) => c.snapshot?.headcount ?? '—' },
              { key: 'compliance', header: 'Filings', render: (c) => (c.snapshot ? <span className={c.snapshot.compliance.overdue ? 'pf-overdue-text' : ''}>{c.snapshot.compliance.overdue} overdue · {c.snapshot.compliance.due_7d} this week</span> : '—') },
              { key: 'requests', header: 'Requests', align: 'right', render: (c) => (c.snapshot ? <span>{c.snapshot.requests.open}{c.snapshot.requests.breached ? <span className="pf-overdue-text"> ({c.snapshot.requests.breached} late)</span> : null}</span> : '—') },
              { key: 'billing', header: 'Outstanding', align: 'right', render: (c) => (c.billing.outstanding_minor ? <span className={c.billing.overdue_minor ? 'pf-overdue-text' : ''}>{fmtMinor(c.billing.outstanding_minor, c.currency)}</span> : <span className="muted">—</span>) },
              { key: 'am', header: 'Account manager', render: (c) => c.account_manager_name || <span className="muted">Unassigned</span> },
              { key: 'open', header: '', align: 'right', render: (c) => <Button size="sm" variant="primary" onClick={(e) => { e.stopPropagation(); openCompany(c.slug); }} data-testid={`pf-open-${c.slug}`}>Open</Button> },
            ]}
          />
        </Card>
      ) : null}

      {drawer ? <CompanyDrawer slug={drawer} staff={meta.data?.staff || []} onClose={() => setDrawer(null)} onChanged={reload} /> : null}
    </div>
  );
}

function CompanyCard({ c, first, onDetails, onCalendar }: { c: PortfolioCompany; first: boolean; onDetails: () => void; onCalendar: () => void }) {
  const s = c.snapshot;
  const stop = (fn: () => void) => (e: React.MouseEvent) => { e.stopPropagation(); fn(); };
  return (
    <article className={`pf-card ${s ? `pf-card-${s.health}` : 'pf-card-off'} ${s ? `pf-card-u-${urgency(s.payroll.next)}` : ''}`} data-testid={`company-card-${c.slug}`}
      onClick={onDetails} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) onDetails(); }} aria-label={`${c.name} details`}>
      <header className="pf-card-head">
        <LogoTile c={c} />
        <div className="pf-card-title">
          <span className="pf-card-name-row"><strong data-testid="pf-card-name">{c.name}</strong>{s && c.status !== 'active' ? <span className={`badge badge-${c.status === 'onboarding' ? 'info' : 'warning'}`} data-testid="pf-card-status">{STATUS_LABEL[c.status]}</span> : null}</span>
          <small>{[c.city, COUNTRY_NAME[c.country_code] || c.country_code].filter(Boolean).join(', ')}{c.industry ? ` · ${c.industry}` : ''}</small>
        </div>
        {s ? <HealthPill health={s.health} reasons={s.reasons} /> : <span className="badge badge-neutral">{STATUS_LABEL[c.status]}</span>}
      </header>

      {s ? (
        <>
          {s.reasons.length ? <div className="pf-reasons" title={s.reasons.join(' · ')}>{s.reasons.slice(0, 2).join(' · ')}{s.reasons.length > 2 ? ` +${s.reasons.length - 2}` : ''}</div> : null}
          <Countdown s={s} compact />
          <MilestoneTrack milestones={s.payroll.milestones} />
          <dl className="pf-facts">
            <div><dt>People</dt><dd>{s.headcount}</dd></div>
            <div><dt>Filings</dt><dd className={s.compliance.overdue ? 'pf-overdue-text' : s.compliance.due_7d ? 'pf-soon-text' : ''}>{s.compliance.overdue ? `${s.compliance.overdue} overdue` : s.compliance.due_7d ? `${s.compliance.due_7d} this week` : 'On track'}</dd></div>
            <div><dt>Requests</dt><dd className={s.requests.breached ? 'pf-overdue-text' : ''}>{s.requests.open}{s.requests.breached ? ` (${s.requests.breached} late)` : ''}</dd></div>
            <div><dt>Billing</dt><dd className={c.billing.overdue_minor ? 'pf-overdue-text' : ''} title={c.billing.overdue_count ? `${plural(c.billing.overdue_count, 'invoice')} overdue` : undefined}>{c.billing.outstanding_minor ? fmtMinor(c.billing.outstanding_minor, c.currency) : 'Settled'}</dd></div>
          </dl>
        </>
      ) : <p className="muted pf-off-note">This company is offboarded. Its data is kept read-only.</p>}

      <footer className="pf-card-foot">
        <span className="pf-card-am"><Icon name="user" size={13} /> {c.account_manager_name || 'Unassigned'}</span>
        <span className="pf-card-actions">
          <button className="btn btn-ghost btn-sm" onClick={stop(onCalendar)} title="Payroll and compliance calendar" data-testid={`pf-calendar-${c.slug}`}><Icon name="calendar" size={14} /><span className="hide-xs">Calendar</span></button>
          <button className="btn btn-ghost btn-sm" onClick={stop(() => openCompany(c.slug, '/services'))} title="Agency services for this company" data-testid={`pf-services-${c.slug}`}><Icon name="heartHandshake" size={14} /><span className="hide-xs">Services</span></button>
          {c.status !== 'offboarded' ? <button className="btn btn-primary btn-sm" onClick={stop(() => openCompany(c.slug))} data-testid={`pf-open-${c.slug}`} data-tour={first ? 'pf-open' : undefined}>Open <Icon name="chevronRight" size={14} /></button> : null}
        </span>
      </footer>
    </article>
  );
}
