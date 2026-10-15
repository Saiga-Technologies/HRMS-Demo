import React, { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { usePageTour } from '../lib/tour';
import { fmtDateTime } from '../lib/format';
import { Button, Card, Checkbox, PageHeader, SearchInput, Select, Stat, Table, Tabs, useFetch } from '../components/ui';
import { Icon } from '../components/Icons';
import { CompanyChip, PRIORITIES, PriorityBadge, SR_STATUSES, SR_STATUS_LABEL, SlaChip, SrStatusBadge, cap, isActive, type ServiceRequest } from './ops/shared';
import { RequestDrawer } from './ops/RequestDrawer';
import { openCompany } from './AgencyApp';
import './calendar.css';

type Tab = 'active' | 'breached' | 'all';

const TOUR = [
  { element: '[data-tour="desk-stats"]', title: 'Desk at a glance', description: 'Requests waiting for a first response, SLA breaches, requests parked with the client and anything nobody has picked up yet, across every company you look after.' },
  { element: '[data-tour="desk-tabs"]', title: 'Queues', description: 'Active requests, the ones already past their SLA, and the full history. The red badges count new requests and breaches.' },
  { element: '[data-tour="desk-filters"]', title: 'Filter the queue', description: 'Narrow by status, priority or company, search by number or subject, or tick "Assigned to me" to see only your own work.' },
  { element: '[data-tour="desk-table"]', title: 'Every request with its SLA', description: 'The SLA column counts down to the response deadline (set by priority) and turns red once it is breached. Click a row to open the conversation.' },
  { element: '[data-tour="desk-refresh"]', title: 'Refresh', description: 'Clients raise requests from their "Agency services" page; refresh to pull in the latest.' },
];

export default function ServiceDesk() {
  usePageTour('Service desk', TOUR);
  const { agency } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab: Tab = (['active', 'breached', 'all'] as Tab[]).includes(params.get('tab') as Tab) ? (params.get('tab') as Tab) : 'active';
  const setParam = (k: string, v: string | null) => setParams((p) => { const n = new URLSearchParams(p); if (v) n.set(k, v); else n.delete(k); return n; }, { replace: true });
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');
  const [company, setCompany] = useState('');
  const [mine, setMine] = useState(false);

  const list = useFetch<ServiceRequest[]>(() => api.get('/api/agency/requests?status=all'), []);
  const rows = useMemo(() => (list.data || []).map((r) => ({ ...r, _key: `${r.company_slug}:${r.id}` })), [list.data]);
  const active = rows.filter(isActive);
  const counts = {
    open: rows.filter((r) => r.status === 'open').length,
    breached: active.filter((r) => r.breached).length,
    waiting: rows.filter((r) => r.status === 'waiting_client').length,
    unassigned: active.filter((r) => !r.assignee_agency_user_id).length,
  };
  const companies = useMemo(() => {
    const m = new Map<string, string>();
    rows.forEach((r) => r.company_slug && m.set(r.company_slug, r.company_name || r.company_slug));
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);

  const shown = rows.filter((r) => {
    if (tab === 'active' && !isActive(r)) return false;
    if (tab === 'breached' && !(isActive(r) && r.breached)) return false;
    if (status && r.status !== status) return false;
    if (priority && r.priority !== priority) return false;
    if (company && r.company_slug !== company) return false;
    if (mine && r.assignee_agency_user_id !== agency?.id) return false;
    if (q.trim()) {
      const s = q.trim().toLowerCase();
      if (![r.number, r.subject, r.company_name, r.raised_by_name, r.category].some((x) => (x || '').toLowerCase().includes(s))) return false;
    }
    return true;
  });

  const openSlug = params.get('company');
  const openId = params.get('id') ? Number(params.get('id')) : null;
  const openRow = rows.find((r) => r.company_slug === openSlug && r.id === openId);
  const open = (r: ServiceRequest) => setParams((p) => { const n = new URLSearchParams(p); n.set('company', r.company_slug!); n.set('id', String(r.id)); return n; }, { replace: true });
  const close = () => setParams((p) => { const n = new URLSearchParams(p); n.delete('company'); n.delete('id'); return n; }, { replace: true });

  return (
    <div className="ops-page">
      <PageHeader
        title="Service desk"
        subtitle="Requests from your client companies, with response SLAs by priority."
        actions={<Button onClick={() => list.reload()} data-tour="desk-refresh" data-testid="desk-refresh">Refresh</Button>}
      />

      <div className="stat-strip" data-tour="desk-stats">
        <Stat label="New (open)" value={list.data ? counts.open : '…'} icon="bell" color="var(--info)" onClick={() => { setParam('tab', 'active'); setStatus('open'); }} hint="Waiting for a first response" />
        <Stat label="SLA breached" value={list.data ? counts.breached : '…'} icon="alert" color="var(--danger)" onClick={() => { setParam('tab', 'breached'); setStatus(''); }} hint="Past the response deadline" />
        <Stat label="Waiting for client" value={list.data ? counts.waiting : '…'} icon="clock" color="var(--warning)" onClick={() => { setParam('tab', 'active'); setStatus('waiting_client'); }} hint="Parked until the client replies" />
        <Stat label="Unassigned" value={list.data ? counts.unassigned : '…'} icon="user" color="var(--accent)" hint="Active requests nobody has picked up" />
      </div>

      <Tabs
        tour="desk-tabs"
        value={tab}
        onChange={(k) => setParam('tab', k === 'active' ? null : k)}
        tabs={[
          { key: 'active', label: 'Active', icon: 'headset', badge: counts.open, count: list.data ? active.length : undefined },
          { key: 'breached', label: 'SLA breached', icon: 'alert', badge: counts.breached },
          { key: 'all', label: 'All requests', icon: 'clipboard', count: list.data ? rows.length : undefined },
        ]}
      />

      <div className="toolbar" data-tour="desk-filters">
        <SearchInput value={q} onChange={setQ} placeholder="Search number, subject, company…" />
        <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status" data-testid="desk-filter-status">
          <option value="">All statuses</option>
          {SR_STATUSES.map((s) => <option key={s} value={s}>{SR_STATUS_LABEL[s]}</option>)}
        </Select>
        <Select value={priority} onChange={(e) => setPriority(e.target.value)} aria-label="Priority" data-testid="desk-filter-priority">
          <option value="">All priorities</option>
          {PRIORITIES.map((p) => <option key={p} value={p}>{cap(p)}</option>)}
        </Select>
        <Select value={company} onChange={(e) => setCompany(e.target.value)} aria-label="Company" data-testid="desk-filter-company">
          <option value="">All companies</option>
          {companies.map(([slug, name]) => <option key={slug} value={slug}>{name}</option>)}
        </Select>
        <Checkbox label="Assigned to me" checked={mine} onChange={(e) => setMine(e.target.checked)} data-testid="desk-filter-mine" />
      </div>

      <Card padded={false}>
        <Table<ServiceRequest & { _key: string }>
          tour="desk-table"
          loading={list.loading && !list.data}
          rows={shown}
          keyField="_key"
          onRowClick={open}
          empty={tab === 'breached' ? 'No SLA breaches. Nicely done.' : 'No requests match these filters.'}
          columns={[
            { key: 'sla', header: 'SLA', width: '140px', render: (r) => <SlaChip r={r} /> },
            { key: 'subject', header: 'Request', render: (r) => (
              <div className="ops-cell-title" data-testid="desk-row">
                <span className="ops-sr-number">{r.number}</span>
                <strong>{r.subject}</strong>
                <small className="muted">{cap(r.category)} · raised by {r.raised_by_name || 'client'} · {r.comments} repl{r.comments === 1 ? 'y' : 'ies'}</small>
              </div>
            ) },
            { key: 'company', header: 'Company', render: (r) => <CompanyChip name={r.company_name || ''} color={r.brand_color} onClick={() => openCompany(r.company_slug!, `/services?tab=requests&id=${r.id}`)} /> },
            { key: 'priority', header: 'Priority', render: (r) => <PriorityBadge priority={r.priority} /> },
            { key: 'status', header: 'Status', render: (r) => <SrStatusBadge status={r.status} /> },
            { key: 'assignee', header: 'Assignee', render: (r) => r.assignee_name || <span className="muted">Unassigned</span> },
            { key: 'updated', header: 'Updated', render: (r) => <small className="muted">{fmtDateTime(r.updated_at)}</small> },
          ]}
        />
      </Card>

      <RequestDrawer
        base={`/api/c/${openSlug}/services`}
        id={openSlug && openId ? openId : null}
        agencySide
        myAgencyId={agency?.id}
        company={openRow ? { name: openRow.company_name || '', color: openRow.brand_color } : null}
        onClose={close}
        onChanged={() => list.reload()}
      />
    </div>
  );
}
