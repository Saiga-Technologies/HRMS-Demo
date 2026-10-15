import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { usePageTour, type TourStep } from '../lib/tour';
import { fmtDate, fmtMoney } from '../lib/format';
import { Button, Card, EmptyState, PageHeader, SearchInput, Select, Stat, Table, Tabs, useFetch } from '../components/ui';
import { Icon } from '../components/Icons';
import { ClientStatusBadge } from '../components/clients/Bits';
import { ClientFormModal } from '../components/clients/ClientFormModal';
import { ClientDetailModal } from '../components/clients/ClientDetailModal';
import { PlacementFormModal } from '../components/clients/PlacementFormModal';
import { PlacementsTable, usePlacementActions } from '../components/clients/PlacementsTable';
import { CLIENT_STATUSES, CLIENT_STATUS_LABEL, PLACEMENT_STATUSES, PLACEMENT_STATUS_LABEL, type Client, type ClientsSummary, type Placement } from '../components/clients/types';

type Tab = 'clients' | 'placements';

const TOUR: TourStep[] = [
  { title: 'Clients and placements', description: 'This is where the agency side of the business lives: the companies you supply people to, who is placed with them, and what each placement earns. The flow: 1) check the portfolio numbers, 2) find or add a client, 3) place an employee or candidate with them, 4) activate the placement, 5) complete or end it, and watch the margins throughout.' },
  { element: '[data-tour="clients-stats"]', title: 'Portfolio at a glance', description: 'The headline numbers for the whole agency, recalculated every time a placement changes. Click a card to jump to the matching list.' },
  { element: '[data-tour="clients-stat-active"]', title: 'Active clients', description: 'Clients you currently work with. The line underneath counts prospects (not signed yet) and inactive clients. Click to filter the list to active clients.' },
  { element: '[data-tour="clients-stat-placements"]', title: 'Active placements', description: 'People currently working at a client, plus how many proposed placements are still waiting to start. Click to open the active placements.' },
  { element: '[data-tour="clients-stat-margin"]', title: 'Billing and margin', description: 'Monthly billing is what clients pay for active placements; margin is billing minus what you pay the people. Hourly rates count as 160 hours a month and daily rates as 22 days, so every placement compares on a monthly basis.' },
  { element: '[data-tour="clients-stat-ending"]', title: 'Ending soon', description: 'Active placements whose end date is in the next 30 days. Act early: extend the contract or line up the next role before the person rolls off.' },
  { element: '[data-testid="client-add"]', title: 'Add a client', description: 'Step one for a new account. Opens a form for the company name, industry, contact person, billing currency and payment terms. The client gets a code (CL-0001 style) and its detail opens straight away so you can place someone.' },
  { element: '[data-tour="clients-tabs"]', title: 'Clients and placements', description: 'Two views of the same data: the client list, and every placement across all clients. The red badge on Placements counts proposed placements still waiting to be activated.' },
  { element: '[data-tour="clients-filters"]', title: 'Find a client', description: 'Search by name, code, industry or contact, and narrow the list by status: active, prospect or inactive.', tab: 'clients' },
  { element: '[data-tour="clients-table"]', title: 'Client list', description: 'Each row shows the contact, active placements out of the total, monthly billing and margin from active placements, billing currency and payment terms, and the client status.' },
  { element: '[data-tour="clients-table"] tbody tr:first-child', title: 'Open a client', description: 'Click any client to open its detail: contact details, its own billing, margin and placement-fee totals, and every placement with it. HR can edit or delete the client and add a placement from there, with the client already filled in.' },
  { element: '[data-tour="clients-ending"]', title: 'Placements ending in 30 days', description: 'The same list as the "Ending in 30 days" card, with days left and the margin at stake. Click a row to open that client.' },
  { element: '[data-testid="placement-add"]', title: 'Add a placement', description: 'Opens the placement form: pick the client, the role, and either an existing employee or a candidate from Recruitment. Set the dates, rate unit, bill rate (what the client pays) and pay rate (what the person gets); the margin is previewed as you type. New placements start as Proposed.' },
  { element: '[data-tour="placements-filters"]', title: 'Next, placements', description: 'Every placement across all clients. Search by person, role or client, and filter by status or client. The status list shows how many placements are in each state.', tab: 'placements' },
  { element: '[data-tour="placements-table"]', title: 'Placement list', description: 'Who is placed where, in which role, for which dates, at what bill and pay rate, plus any one-off placement fee. Active placements are listed first, then proposed ones.' },
  { element: '[data-tour="placements-table"] [data-testid="placement-status"]', title: 'Placement status', description: 'Proposed (agreed but not started), Active (working and billing), Completed (finished as planned) or Terminated (ended early). Only active placements count towards billing and margin.' },
  { element: '[data-tour="placements-table"] [data-testid="placement-active"]', title: 'Activate', description: 'When the person starts at the client, activate the placement. From that moment it counts in the client\'s and the agency\'s monthly billing and margin.' },
  { element: '[data-tour="placements-table"] [data-testid="placement-completed"]', title: 'Complete or terminate', description: 'Complete a placement that ran its course, or Terminate one that ended early. You are asked to confirm, and if no end date was set it is set to today. Both are final and drop the placement out of the billing totals.' },
  { element: '[data-tour="placements-table"] [data-tour="placement-margin"]', title: 'Margin per placement', description: 'Monthly margin and its percentage of billing. Green is healthy, amber means under 15%, red means you pay the person more than the client pays you.' },
  { element: '[data-tour="placements-table"] [data-testid="placement-edit"]', title: 'Edit or delete', description: 'Change rates, dates or the role with the pencil (for example when a contract is extended). Delete removes a placement entered by mistake, permanently.' },
  { element: '[data-tour="clients-readonly"]', title: 'Read-only access', description: 'Managers can see clients, placements and margins; HR adds clients, places people and changes their status.' },
  { title: 'What to do next', description: 'The loop: add a client, place someone, activate when they start, and complete or terminate when they finish, keeping an eye on margins and the ending-soon list. Candidates you place come from Recruitment, and placed employees stay in the Employees directory.' },
];

function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

export default function Clients() {
  usePageTour('Clients & placements', TOUR);
  const { isHr, company } = useAuth();
  const cur = company.currency || 'INR';
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get('tab') === 'placements' ? 'placements' : 'clients';
  const clientParam = params.get('client');
  const setParam = (k: string, v: string | null) => setParams((p) => { const n = new URLSearchParams(p); if (v) n.set(k, v); else n.delete(k); return n; }, { replace: true });

  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim());
  const [clientStatus, setClientStatus] = useState('');
  const [pq, setPq] = useState('');
  const dpq = useDebounced(pq.trim());
  const [placementStatus, setPlacementStatus] = useState('');
  const [placementClient, setPlacementClient] = useState('');
  const [addClient, setAddClient] = useState(false);
  const [addPlacement, setAddPlacement] = useState(false);
  const [editPlacement, setEditPlacement] = useState<Placement | null>(null);

  const summary = useFetch<ClientsSummary>(() => api.get('/api/clients/summary'), []);
  const allClients = useFetch<Client[]>(() => api.get('/api/clients'), []);
  const clients = useFetch<Client[]>(() => api.get(`/api/clients${qs({ q: dq, status: clientStatus })}`), [dq, clientStatus]);
  const placements = useFetch<Placement[]>(() => api.get(`/api/clients/placements${qs({ q: dpq, status: placementStatus, client_id: placementClient })}`), [dpq, placementStatus, placementClient]);
  const reloadAll = () => { summary.reload(); allClients.reload(); clients.reload(); placements.reload(); };
  const actions = usePlacementActions(reloadAll);

  const s = summary.data;
  const proposed = s?.placements_by_status.proposed || 0;
  const totalPlacements = useMemo(() => (s ? Object.values(s.placements_by_status).reduce((a, b) => a + b, 0) : undefined), [s]);
  const openClient = (id: number) => setParam('client', String(id));

  return (
    <>
      <PageHeader
        title="Clients & placements"
        subtitle="Agency clients, the people placed with them, and what each placement bills and earns."
        actions={isHr ? (
          <div className="row" data-tour="clients-add">
            <Button onClick={() => setAddPlacement(true)} data-testid="placement-add"><Icon name="userPlus" size={15} /> Add placement</Button>
            <Button variant="primary" onClick={() => setAddClient(true)} data-testid="client-add"><Icon name="plus" size={15} /> Add client</Button>
          </div>
        ) : undefined}
      />

      <div className="stat-strip" data-tour="clients-stats">
        <Stat tour="clients-stat-active" label="Active clients" value={s ? s.clients_by_status.active : '…'} icon="building" color="var(--brand)"
          hint={s ? `${s.clients_by_status.prospect} prospect · ${s.clients_by_status.inactive} inactive` : undefined}
          onClick={() => { setParam('tab', null); setClientStatus('active'); }} />
        <Stat tour="clients-stat-placements" label="Active placements" value={s ? s.active_placements : '…'} icon="users" color="var(--info)"
          hint={s ? `${proposed} proposed` : undefined}
          onClick={() => { setParam('tab', 'placements'); setPlacementStatus('active'); }} />
        <Stat label="Monthly billing" value={s ? fmtMoney(s.monthly_billing, cur) : '…'} icon="banknote" color="var(--accent)" />
        <Stat tour="clients-stat-margin" label="Monthly margin" value={s ? fmtMoney(s.monthly_margin, cur) : '…'} icon="trendingUp" color="var(--success)" hint={s ? `${s.margin_pct}% of billing` : undefined} />
        <Stat tour="clients-stat-ending" label="Ending in 30 days" value={s ? s.ending_soon.length : '…'} icon="calendar" color="var(--warning)"
          onClick={() => { setParam('tab', 'placements'); setPlacementStatus('active'); }} />
      </div>

      <Tabs tour="clients-tabs" value={tab} onChange={(k) => setParam('tab', k === 'clients' ? null : k)} tabs={[
        { key: 'clients', label: 'Clients', icon: 'building', count: s?.clients_total },
        { key: 'placements', label: 'Placements', icon: 'briefcase', count: totalPlacements, badge: isHr ? proposed : undefined },
      ]} />

      {tab === 'clients' ? (
        <>
          <div className="toolbar" data-tour="clients-filters">
            <SearchInput value={q} onChange={setQ} placeholder="Search name, code, industry, contact…" />
            <Select value={clientStatus} onChange={(e) => setClientStatus(e.target.value)} aria-label="Client status" data-testid="client-filter-status">
              <option value="">All statuses</option>
              {CLIENT_STATUSES.map((st) => <option key={st} value={st}>{CLIENT_STATUS_LABEL[st]}</option>)}
            </Select>
            {q || clientStatus ? <Button size="sm" variant="ghost" onClick={() => { setQ(''); setClientStatus(''); }}>Clear</Button> : null}
            <span className="muted" style={{ marginLeft: 'auto' }}>{clients.data ? `${clients.data.length} client${clients.data.length === 1 ? '' : 's'}` : ''}</span>
          </div>
          <Card padded={false} tour="clients-table">
            {clients.error ? <div className="alert alert-error" style={{ margin: 12 }}>{clients.error}</div> : null}
            <Table<Client>
              loading={clients.loading && !clients.data}
              rows={clients.data || []}
              onRowClick={(c) => openClient(c.id)}
              empty={<EmptyState title={q || clientStatus ? 'No clients match' : 'No clients yet'} description={q || clientStatus ? 'Try a different search or status.' : isHr ? 'Add your first client to start placing people.' : undefined}
                action={isHr && !q && !clientStatus ? <Button variant="primary" onClick={() => setAddClient(true)}>Add client</Button> : undefined} />}
              columns={[
                { key: 'name', header: 'Client', render: (c) => <span><strong data-testid="client-row-name">{c.name}</strong> <span className="muted mono">{c.code}</span><div className="muted">{c.industry || '—'}</div></span> },
                { key: 'contact', header: 'Contact', render: (c) => <span>{c.contact_name || '—'}{c.contact_email ? <div className="muted">{c.contact_email}</div> : null}</span> },
                { key: 'placements', header: 'Placements', align: 'right', render: (c) => <span><strong>{c.active_placements}</strong> <span className="muted">active / {c.total_placements}</span></span> },
                { key: 'revenue', header: 'Billing / mo', align: 'right', render: (c) => (c.revenue_month ? fmtMoney(c.revenue_month, c.billing_currency) : <span className="muted">—</span>) },
                { key: 'margin', header: 'Margin / mo', align: 'right', render: (c) => (c.revenue_month ? <span>{fmtMoney(c.margin_month, c.billing_currency)}<div className="muted">{Math.round((c.margin_month / c.revenue_month) * 1000) / 10}%</div></span> : <span className="muted">—</span>) },
                { key: 'terms', header: 'Terms', render: (c) => <span className="muted">{c.billing_currency} · net {c.payment_terms_days}</span> },
                { key: 'status', header: 'Status', render: (c) => <ClientStatusBadge status={c.status} /> },
              ]}
            />
          </Card>
          <Card title={<span className="row" style={{ gap: 6 }}><Icon name="calendar" size={16} /> Placements ending in the next 30 days</span>} padded={false} tour="clients-ending">
            <Table<Placement>
              dense
              loading={summary.loading && !s}
              rows={s?.ending_soon || []}
              onRowClick={(p) => openClient(p.client_id)}
              empty="No active placements end in the next 30 days."
              columns={[
                { key: 'person', header: 'Person', render: (p) => <strong>{p.person_name || '—'}</strong> },
                { key: 'client', header: 'Client', render: (p) => p.client_name },
                { key: 'role', header: 'Role', render: (p) => p.role_title },
                { key: 'end', header: 'Ends', render: (p) => <span>{fmtDate(p.end_date)} <span style={{ color: 'var(--warning-ink)' }}>· {p.days_to_end} day{p.days_to_end === 1 ? '' : 's'}</span></span> },
                { key: 'margin', header: 'Margin / mo', align: 'right', render: (p) => fmtMoney(p.monthly_margin, p.billing_currency) },
              ]}
            />
          </Card>
        </>
      ) : (
        <>
          <div className="toolbar" data-tour="placements-filters">
            <SearchInput value={pq} onChange={setPq} placeholder="Search person, role, client…" />
            <Select value={placementStatus} onChange={(e) => setPlacementStatus(e.target.value)} aria-label="Placement status" data-testid="placement-filter-status">
              <option value="">All statuses</option>
              {PLACEMENT_STATUSES.map((st) => <option key={st} value={st}>{PLACEMENT_STATUS_LABEL[st]}{s ? ` (${s.placements_by_status[st] || 0})` : ''}</option>)}
            </Select>
            <Select value={placementClient} onChange={(e) => setPlacementClient(e.target.value)} aria-label="Client" data-testid="placement-filter-client">
              <option value="">All clients</option>
              {(allClients.data || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
            {pq || placementStatus || placementClient ? <Button size="sm" variant="ghost" onClick={() => { setPq(''); setPlacementStatus(''); setPlacementClient(''); }}>Clear</Button> : null}
            <span className="muted" style={{ marginLeft: 'auto' }}>{placements.data ? `${placements.data.length} placement${placements.data.length === 1 ? '' : 's'}` : ''}</span>
          </div>
          <Card padded={false} tour="placements-table">
            {placements.error ? <div className="alert alert-error" style={{ margin: 12 }}>{placements.error}</div> : null}
            <PlacementsTable
              rows={placements.data || []}
              loading={placements.loading && !placements.data}
              canEdit={isHr}
              onEdit={setEditPlacement}
              onStatus={actions.changeStatus}
              onDelete={actions.remove}
              onOpenClient={openClient}
              empty={<EmptyState title={pq || placementStatus || placementClient ? 'No placements match' : 'No placements yet'} description={isHr ? 'Use "Add placement" to place an employee or candidate with a client.' : undefined} />}
            />
          </Card>
          {!isHr ? <p className="help" data-tour="clients-readonly">You have read-only access. HR manages clients, placements and their rates.</p> : null}
        </>
      )}

      {actions.dialog}
      {addClient ? <ClientFormModal onClose={() => setAddClient(false)} onSaved={(c) => { setAddClient(false); reloadAll(); openClient(c.id); }} /> : null}
      {addPlacement ? <PlacementFormModal clients={allClients.data || []} onClose={() => setAddPlacement(false)} onSaved={() => { setAddPlacement(false); reloadAll(); }} /> : null}
      {editPlacement ? <PlacementFormModal placement={editPlacement} clients={allClients.data || []} onClose={() => setEditPlacement(null)} onSaved={() => { setEditPlacement(null); reloadAll(); }} /> : null}
      {clientParam ? <ClientDetailModal id={Number(clientParam)} canEdit={isHr} clients={allClients.data || []} onClose={() => setParam('client', null)} onChanged={reloadAll} /> : null}
    </>
  );
}
