import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { usePageTour } from '../lib/tour';
import { fmtDate, fmtDateTime, fmtMoney, label, todayIso } from '../lib/format';
import { Badge, Button, Card, EmptyState, ExpiryDot, Field, Input, KeyValue, Modal, PageHeader, SearchInput, Select, Spinner, Stat, StatusBadge, Table, Textarea, useConfirm, useFetch, useForm, useToast } from '../components/ui';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */
type AssetStatus = 'available' | 'assigned' | 'maintenance' | 'retired' | 'lost';
interface Asset {
  id: number; asset_tag: string; name: string; category: string; serial_number?: string | null; model?: string | null; vendor?: string | null;
  purchase_date?: string | null; purchase_cost?: number | null; warranty_expiry?: string | null; status: AssetStatus; condition: string; location?: string | null;
  specs: Record<string, any>; notes?: string | null; created_at: string; updated_at: string;
  assignment_id?: number | null; assigned_to?: number | null; assigned_at?: string | null; expected_return_at?: string | null; assigned_to_name?: string | null; assigned_to_code?: string | null;
  warranty_state?: 'none' | 'expired' | 'warning' | 'ok'; warranty_days?: number;
}
interface Assignment { id: number; asset_id: number; employee_id: number; employee_name?: string; employee_code?: string; assigned_at: string; expected_return_at?: string | null; returned_at?: string | null; assigned_by?: number | null; condition_out?: string | null; condition_in?: string | null; notes?: string | null }
interface AssetDetail extends Asset { history: Assignment[] }
interface MyAssignment extends Assignment { asset_tag: string; name: string; category: string; model?: string | null; serial_number?: string | null; specs: Record<string, any> }
interface Summary { by_status: { status: AssetStatus; n: number }[]; by_category: { category: string; n: number }[]; total_value: number }
interface DirEmployee { id: number; employee_code: string; first_name: string; last_name: string; department_name?: string }
interface SpecRow { k: string; v: string }

const STATUSES: AssetStatus[] = ['available', 'assigned', 'maintenance', 'retired', 'lost'];
const CONDITIONS = ['new', 'good', 'fair', 'poor', 'damaged'];

const HR_TOUR = [
  { element: '[data-tour="asset-stats"]', title: 'Inventory at a glance', description: 'Counts by status and the total purchase value of everything registered.' },
  { element: '[data-tour="asset-add"]', title: 'Register an asset', description: 'Add laptops, phones, access cards and anything else you hand out. Tags are generated automatically.' },
  { element: '[data-tour="asset-filters"]', title: 'Find assets', description: 'Search by tag, name, serial or model, and narrow by status or category.' },
  { element: '[data-tour="asset-table"]', title: 'Asset register', description: 'Warranty expiry is colour-coded: red when expired, yellow within 30 days. Click a row for details, assignment history and actions.' },
  { element: '[data-tour="asset-help"]', title: 'Assign and return', description: 'Open an asset to assign it to an employee, record its return and condition, edit or delete it.' },
];
const MY_TOUR = [
  { element: '[data-tour="asset-mine"]', title: 'Your assets', description: 'Equipment currently issued to you, with the expected return date where one was set.' },
  { element: '[data-tour="asset-current"]', title: 'Currently with you', description: 'Each item shows its tag, model and serial number — handy when raising a support ticket.' },
  { element: '[data-tour="asset-past"]', title: 'Returned items', description: 'A history of assets you have returned and the condition they were recorded in.' },
  { element: '[data-tour="asset-help"]', title: 'Something wrong?', description: 'Contact HR to report a lost or damaged item or to request a return.' },
];

function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}
const specsToRows = (s?: Record<string, any> | null): SpecRow[] => Object.entries(s || {}).map(([k, v]) => ({ k, v: typeof v === 'string' ? v : JSON.stringify(v) }));
const rowsToSpecs = (rows: SpecRow[]): Record<string, string> => Object.fromEntries(rows.filter((r) => r.k.trim()).map((r) => [r.k.trim(), r.v]));

function Warranty({ a }: { a: { warranty_expiry?: string | null; warranty_state?: string; warranty_days?: number } }) {
  if (!a.warranty_expiry) return <span className="muted">—</span>;
  return (
    <span className="row" style={{ gap: 6 }}>
      <span>{fmtDate(a.warranty_expiry)}</span>
      <ExpiryDot state={a.warranty_state} days={a.warranty_days} />
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */
export default function Assets() {
  const { isHr } = useAuth();
  usePageTour('Assets', isHr ? HR_TOUR : MY_TOUR);
  return isHr ? <HrAssets /> : <MyAssets />;
}

/* ------------------------------------------------------------------ */
/* Employee / manager view                                             */
/* ------------------------------------------------------------------ */
function MyAssets() {
  const { user } = useAuth();
  const eid = user?.employee_id;
  const list = useFetch<MyAssignment[]>(() => (eid ? api.get(`/api/assets/employee/${eid}`) : Promise.resolve([])), [eid]);
  const current = (list.data || []).filter((a) => !a.returned_at);
  const past = (list.data || []).filter((a) => !!a.returned_at);
  const [view, setView] = useState<MyAssignment | null>(null);
  return (
    <>
      <PageHeader title="My assets" subtitle="Equipment issued to you and what you have returned." tour="asset-mine" />
      {!eid ? <EmptyState title="No employee record" description="Your login is not linked to an employee profile, so no assets can be shown." /> : null}
      <Card title={`Currently with you (${current.length})`} padded={false} tour="asset-current">
        <Table<MyAssignment>
          loading={list.loading}
          rows={current}
          onRowClick={(a) => setView(a)}
          empty={<EmptyState title="Nothing issued to you right now" icon="💻" />}
          columns={[
            { key: 'asset_tag', header: 'Tag', render: (a) => <span className="mono">{a.asset_tag}</span> },
            { key: 'name', header: 'Asset', render: (a) => <span><strong>{a.name}</strong> <span className="muted">{a.category}</span></span> },
            { key: 'model', header: 'Model / serial', render: (a) => <span>{a.model || '—'} {a.serial_number ? <span className="muted mono">{a.serial_number}</span> : null}</span> },
            { key: 'assigned_at', header: 'Issued', render: (a) => fmtDate(a.assigned_at) },
            { key: 'expected_return_at', header: 'Expected return', render: (a) => (a.expected_return_at ? <span className={a.expected_return_at < todayIso() ? 'expiry-expired' : ''}>{fmtDate(a.expected_return_at)}</span> : '—') },
            { key: 'condition_out', header: 'Condition', render: (a) => label(a.condition_out) },
          ]}
        />
      </Card>
      <Card title={`Returned (${past.length})`} padded={false} tour="asset-past">
        <Table<MyAssignment>
          loading={list.loading}
          rows={past}
          onRowClick={(a) => setView(a)}
          empty="No returned items."
          columns={[
            { key: 'asset_tag', header: 'Tag', render: (a) => <span className="mono">{a.asset_tag}</span> },
            { key: 'name', header: 'Asset', render: (a) => <span><strong>{a.name}</strong> <span className="muted">{a.category}</span></span> },
            { key: 'assigned_at', header: 'Issued', render: (a) => fmtDate(a.assigned_at) },
            { key: 'returned_at', header: 'Returned', render: (a) => fmtDate(a.returned_at) },
            { key: 'condition_in', header: 'Condition on return', render: (a) => label(a.condition_in) },
          ]}
        />
      </Card>
      <p className="help" data-tour="asset-help">Lost or damaged something? Contact HR so the record can be updated.</p>
      {view ? (
        <Modal open title={`${view.asset_tag} · ${view.name}`} onClose={() => setView(null)} testId="my-asset-modal" footer={<Button onClick={() => setView(null)}>Close</Button>}>
          <KeyValue items={[
            { k: 'Category', v: view.category }, { k: 'Model', v: view.model || '—' }, { k: 'Serial number', v: <span className="mono">{view.serial_number || '—'}</span> },
            { k: 'Issued', v: fmtDateTime(view.assigned_at) }, { k: 'Expected return', v: fmtDate(view.expected_return_at) }, { k: 'Returned', v: view.returned_at ? fmtDateTime(view.returned_at) : 'Still with you' },
            { k: 'Condition out / in', v: `${label(view.condition_out)} / ${view.condition_in ? label(view.condition_in) : '—'}` }, { k: 'Notes', v: view.notes || '—' },
          ]} />
          <SpecsList specs={view.specs} />
        </Modal>
      ) : null}
    </>
  );
}

function SpecsList({ specs }: { specs?: Record<string, any> | null }) {
  const rows = specsToRows(specs);
  if (!rows.length) return null;
  return (
    <div className="mt">
      <div className="form-section">Specifications</div>
      <KeyValue items={rows.map((r) => ({ k: r.k, v: r.v }))} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* HR view                                                             */
/* ------------------------------------------------------------------ */
function HrAssets() {
  const { company } = useAuth();
  const cur = company.currency || 'INR';
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  const summary = useFetch<Summary>(() => api.get('/api/assets/summary'), []);
  const categories = useFetch<string[]>(() => api.get('/api/settings/asset_categories'), []);
  const employees = useFetch<DirEmployee[]>(() => api.get('/api/employees/directory/all'), []);
  const list = useFetch<{ items: Asset[]; total: number }>(() => api.get(`/api/assets${qs({ q: dq, status, category })}`), [dq, status, category]);
  const [add, setAdd] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);

  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const s of summary.data?.by_status || []) m[s.status] = s.n;
    return m;
  }, [summary.data]);
  const totalAssets = Object.values(counts).reduce((a, b) => a + b, 0);
  const refreshAll = () => { list.reload(); summary.reload(); };
  const statStatus = (s: string) => () => setStatus((prev) => (prev === s ? '' : s));

  return (
    <>
      <PageHeader title="Assets" subtitle="Company equipment: register, assign to employees, track returns and warranties."
        actions={<Button variant="primary" onClick={() => setAdd(true)} data-testid="asset-add" data-tour="asset-add">+ Register asset</Button>} />
      <div className="grid grid-4 mb" data-tour="asset-stats">
        <Stat label="Total assets" value={summary.data ? totalAssets : '…'} hint={summary.data ? `Value ${fmtMoney(summary.data.total_value, cur)}` : undefined} onClick={() => setStatus('')} />
        <Stat label="Available" value={counts.available ?? 0} color="#16a34a" onClick={statStatus('available')} />
        <Stat label="Assigned" value={counts.assigned ?? 0} color="#0284c7" onClick={statStatus('assigned')} />
        <Stat label="Maintenance / retired / lost" value={(counts.maintenance ?? 0) + (counts.retired ?? 0) + (counts.lost ?? 0)} color="#ca8a04" hint={`${counts.maintenance ?? 0} in maintenance · ${counts.retired ?? 0} retired · ${counts.lost ?? 0} lost`} onClick={statStatus('maintenance')} />
      </div>
      <div className="toolbar" data-tour="asset-filters">
        <SearchInput value={q} onChange={setQ} placeholder="Search tag, name, serial, model…" />
        <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status" data-testid="asset-filter-status">
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
        </Select>
        <Select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category" data-testid="asset-filter-category">
          <option value="">All categories</option>
          {(categories.data || []).map((c) => <option key={c} value={c}>{c}</option>)}
          {category && !(categories.data || []).includes(category) ? <option value={category}>{category}</option> : null}
        </Select>
        {q || status || category ? <Button size="sm" variant="ghost" onClick={() => { setQ(''); setStatus(''); setCategory(''); }}>Clear</Button> : null}
        <span className="muted" style={{ marginLeft: 'auto' }}>{list.data ? `${list.data.total} asset${list.data.total === 1 ? '' : 's'}` : ''}</span>
      </div>
      <Card padded={false} tour="asset-table">
        <Table<Asset>
          loading={list.loading}
          rows={list.data?.items || []}
          onRowClick={(a) => setDetailId(a.id)}
          empty={<EmptyState title="No assets match" description="Try a different search or register a new asset." action={<Button variant="primary" onClick={() => setAdd(true)}>+ Register asset</Button>} />}
          columns={[
            { key: 'asset_tag', header: 'Tag', render: (a) => <span className="mono">{a.asset_tag}</span> },
            { key: 'name', header: 'Asset', render: (a) => <strong>{a.name}</strong> },
            { key: 'category', header: 'Category' },
            { key: 'model', header: 'Model / serial', render: (a) => <span>{a.model || '—'} {a.serial_number ? <span className="muted mono">{a.serial_number}</span> : null}</span> },
            { key: 'status', header: 'Status', render: (a) => <StatusBadge status={a.status} label={label(a.status)} /> },
            { key: 'assigned_to', header: 'Assigned to', render: (a) => (a.assigned_to ? <Link to={`/employees/${a.assigned_to}`} onClick={(e) => e.stopPropagation()}>{a.assigned_to_name} <span className="muted mono">{a.assigned_to_code}</span></Link> : <span className="muted">—</span>) },
            { key: 'warranty_expiry', header: 'Warranty', render: (a) => <Warranty a={a} /> },
          ]}
        />
      </Card>
      <p className="help" data-tour="asset-help">Click an asset to assign it, record a return, edit its details or view its assignment history.</p>
      {add ? <AssetFormModal categories={categories.data || []} onClose={() => setAdd(false)} onSaved={() => { setAdd(false); refreshAll(); }} /> : null}
      {detailId ? <AssetDetailModal id={detailId} currency={cur} categories={categories.data || []} employees={employees.data || []} onClose={() => setDetailId(null)} onChanged={refreshAll} /> : null}
    </>
  );
}

/* ---------- Detail ---------- */
function AssetDetailModal({ id, currency, categories, employees, onClose, onChanged }: { id: number; currency: string; categories: string[]; employees: DirEmployee[]; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const det = useFetch<AssetDetail>(() => api.get(`/api/assets/${id}`), [id]);
  const [mode, setMode] = useState<'view' | 'assign' | 'return' | 'edit'>('view');
  const a = det.data;
  const changed = () => { det.reload(); onChanged(); setMode('view'); };
  const remove = async () => {
    if (!a) return;
    if (!(await confirm(`Delete ${a.asset_tag}?`, 'The asset and its assignment history will be removed.'))) return;
    try {
      await api.delete(`/api/assets/${a.id}`);
      toast.success('Asset deleted');
      onChanged();
      onClose();
    } catch (err) {
      toast.error(err);
    }
  };
  if (mode === 'assign' && a) return <AssignModal asset={a} employees={employees} onClose={() => setMode('view')} onSaved={changed} />;
  if (mode === 'return' && a) return <ReturnModal asset={a} onClose={() => setMode('view')} onSaved={changed} />;
  if (mode === 'edit' && a) return <AssetFormModal asset={a} categories={categories} onClose={() => setMode('view')} onSaved={changed} />;
  return (
    <Modal open wide title={a ? <span><span className="mono">{a.asset_tag}</span> · {a.name} <StatusBadge status={a.status} label={label(a.status)} /></span> : 'Asset'} onClose={onClose} testId="asset-detail"
      footer={a ? (
        <>
          <Button variant="danger" onClick={remove} style={{ marginRight: 'auto' }} disabled={a.status === 'assigned'} title={a.status === 'assigned' ? 'Return the asset before deleting it' : undefined} data-testid="asset-delete">Delete</Button>
          <Button onClick={() => setMode('edit')} data-testid="asset-edit">Edit</Button>
          {a.status === 'available' ? <Button variant="primary" onClick={() => setMode('assign')} data-testid="asset-assign">Assign</Button> : null}
          {a.status === 'assigned' ? <Button variant="primary" onClick={() => setMode('return')} data-testid="asset-return">Return</Button> : null}
        </>
      ) : <Button onClick={onClose}>Close</Button>}>
      {dialog}
      {det.loading && !a ? <Spinner /> : det.error ? <div className="alert alert-error">{det.error}</div> : a ? (
        <>
          {a.status === 'assigned' ? (
            <div className="alert alert-info mb">
              Assigned to <Link to={`/employees/${a.assigned_to}`}><strong>{a.assigned_to_name}</strong> ({a.assigned_to_code})</Link> since {fmtDate(a.assigned_at)}
              {a.expected_return_at ? <> · expected back {fmtDate(a.expected_return_at)}{a.expected_return_at < todayIso() ? <Badge tone="danger">overdue</Badge> : null}</> : null}
            </div>
          ) : null}
          {a.warranty_state === 'expired' ? <div className="alert alert-error mb">Warranty expired on {fmtDate(a.warranty_expiry)}.</div> : a.warranty_state === 'warning' ? <div className="alert alert-warning mb">Warranty expires in {a.warranty_days} day{a.warranty_days === 1 ? '' : 's'} ({fmtDate(a.warranty_expiry)}).</div> : null}
          <div className="payslip-cols">
            <KeyValue items={[
              { k: 'Category', v: a.category }, { k: 'Model', v: a.model || '—' }, { k: 'Serial number', v: <span className="mono">{a.serial_number || '—'}</span> }, { k: 'Vendor', v: a.vendor || '—' },
              { k: 'Condition', v: label(a.condition) }, { k: 'Location', v: a.location || '—' },
            ]} />
            <KeyValue items={[
              { k: 'Purchase date', v: fmtDate(a.purchase_date) }, { k: 'Purchase cost', v: a.purchase_cost != null ? fmtMoney(a.purchase_cost, currency) : '—' }, { k: 'Warranty', v: <Warranty a={a} /> },
              { k: 'Registered', v: fmtDate(a.created_at) }, { k: 'Updated', v: fmtDateTime(a.updated_at) }, { k: 'Notes', v: a.notes || '—' },
            ]} />
          </div>
          <SpecsList specs={a.specs} />
          <div className="mt">
            <div className="form-section">Assignment history</div>
            <Table<Assignment>
              dense
              rows={a.history || []}
              empty="Never assigned."
              columns={[
                { key: 'employee_name', header: 'Employee', render: (h) => <Link to={`/employees/${h.employee_id}`}>{h.employee_name} <span className="muted mono">{h.employee_code}</span></Link> },
                { key: 'assigned_at', header: 'Assigned', render: (h) => fmtDate(h.assigned_at) },
                { key: 'expected_return_at', header: 'Expected', render: (h) => fmtDate(h.expected_return_at) },
                { key: 'returned_at', header: 'Returned', render: (h) => (h.returned_at ? fmtDate(h.returned_at) : <Badge tone="info">current</Badge>) },
                { key: 'condition', header: 'Condition out / in', render: (h) => `${h.condition_out ? label(h.condition_out) : '—'} / ${h.condition_in ? label(h.condition_in) : '—'}` },
                { key: 'notes', header: 'Notes', render: (h) => h.notes || '—' },
              ]}
            />
          </div>
        </>
      ) : null}
    </Modal>
  );
}

/* ---------- Assign ---------- */
function AssignModal({ asset, employees, onClose, onSaved }: { asset: Asset; employees: DirEmployee[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const f = useForm({ employee_id: '', expected_return_at: '', condition_out: asset.condition || 'good', notes: '' });
  const [busy, setBusy] = useState(false);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.values.employee_id) return toast.error('Pick an employee');
    setBusy(true);
    try {
      await api.post(`/api/assets/${asset.id}/assign`, { employee_id: Number(f.values.employee_id), expected_return_at: f.values.expected_return_at || null, condition_out: f.values.condition_out, notes: f.values.notes || null });
      toast.success(`${asset.asset_tag} assigned`);
      onSaved();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open title={`Assign ${asset.asset_tag} · ${asset.name}`} onClose={onClose} testId="asset-assign-modal"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save as any} data-testid="asset-assign-submit">Assign</Button></>}>
      <form onSubmit={save} className="form-grid">
        <Field label="Employee" required className="span-2">
          <Select {...f.bind('employee_id')} required autoFocus data-testid="asset-assign-employee">
            <option value="">— Select —</option>
            {employees.map((e) => <option key={e.id} value={e.id}>{e.first_name} {e.last_name} ({e.employee_code}){e.department_name ? ` · ${e.department_name}` : ''}</option>)}
          </Select>
        </Field>
        <Field label="Expected return" hint="Leave empty for an open-ended assignment."><Input type="date" {...f.bind('expected_return_at')} min={todayIso()} /></Field>
        <Field label="Condition when handed out"><Select {...f.bind('condition_out')}>{CONDITIONS.map((c) => <option key={c} value={c}>{label(c)}</option>)}</Select></Field>
        <Field label="Notes" className="span-2"><Textarea {...f.bind('notes')} placeholder="Accessories included, charger, etc." /></Field>
      </form>
    </Modal>
  );
}

/* ---------- Return ---------- */
function ReturnModal({ asset, onClose, onSaved }: { asset: Asset; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const f = useForm({ condition_in: asset.condition || 'good', status: 'available', notes: '' });
  const [busy, setBusy] = useState(false);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post(`/api/assets/${asset.id}/return`, { condition_in: f.values.condition_in, status: f.values.status, notes: f.values.notes || undefined });
      toast.success(`${asset.asset_tag} returned`);
      onSaved();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open title={`Return ${asset.asset_tag} · ${asset.name}`} onClose={onClose} testId="asset-return-modal"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save as any} data-testid="asset-return-submit">Record return</Button></>}>
      <p className="muted" style={{ marginTop: 0 }}>Returning from <strong>{asset.assigned_to_name}</strong> ({asset.assigned_to_code}), assigned {fmtDate(asset.assigned_at)}.</p>
      <form onSubmit={save} className="form-grid">
        <Field label="Condition on return"><Select {...f.bind('condition_in')} autoFocus>{CONDITIONS.map((c) => <option key={c} value={c}>{label(c)}</option>)}</Select></Field>
        <Field label="New status">
          <Select {...f.bind('status')} data-testid="asset-return-status">
            <option value="available">Available (back in stock)</option>
            <option value="maintenance">Maintenance</option>
            <option value="retired">Retired</option>
            <option value="lost">Lost</option>
          </Select>
        </Field>
        <Field label="Notes" className="span-2"><Textarea {...f.bind('notes')} placeholder="Damage, missing accessories…" /></Field>
      </form>
    </Modal>
  );
}

/* ---------- Create / edit ---------- */
function AssetFormModal({ asset, categories, onClose, onSaved }: { asset?: Asset; categories: string[]; onClose: () => void; onSaved: (a: Asset) => void }) {
  const toast = useToast();
  const isEdit = !!asset;
  const f = useForm({
    asset_tag: asset?.asset_tag || '', name: asset?.name || '', category: asset?.category || categories[0] || '', serial_number: asset?.serial_number || '', model: asset?.model || '', vendor: asset?.vendor || '',
    purchase_date: asset?.purchase_date || '', purchase_cost: asset?.purchase_cost ?? '', warranty_expiry: asset?.warranty_expiry || '', status: asset?.status || 'available', condition: asset?.condition || 'good', location: asset?.location || '', notes: asset?.notes || '',
  });
  const [specs, setSpecs] = useState<SpecRow[]>(() => (asset ? specsToRows(asset.specs) : [{ k: '', v: '' }]));
  const [customCat, setCustomCat] = useState(() => !!asset && !!asset.category && !categories.includes(asset.category));
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (isEdit) return;
    api.get<{ asset_tag: string }>('/api/assets/next-tag').then((r) => f.set('asset_tag', r.asset_tag)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEdit]);
  // Categories may arrive after the modal opened; default to the first one once they do.
  useEffect(() => {
    if (!customCat && !f.values.category && categories.length) f.set('category', categories[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categories.length]);
  const setSpec = (i: number, k: 'k' | 'v', v: string) => setSpecs((s) => s.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.values.name.trim()) return toast.error('Name is required');
    setBusy(true);
    try {
      const v = f.values;
      const body: any = {
        asset_tag: v.asset_tag.trim() || undefined, name: v.name.trim(), category: v.category.trim() || undefined, serial_number: v.serial_number || null, model: v.model || null, vendor: v.vendor || null,
        purchase_date: v.purchase_date || null, purchase_cost: v.purchase_cost === '' ? null : Number(v.purchase_cost), warranty_expiry: v.warranty_expiry || null,
        condition: v.condition, location: v.location || null, specs: rowsToSpecs(specs), notes: v.notes || null,
      };
      // Status is managed by assign/return once an asset is out; only send it when it can legitimately change.
      if (!isEdit || asset!.status !== 'assigned') body.status = v.status;
      const saved = isEdit ? await api.put<Asset>(`/api/assets/${asset!.id}`, body) : await api.post<Asset>('/api/assets', body);
      toast.success(isEdit ? 'Asset updated' : `${saved.asset_tag} registered`);
      onSaved(saved);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  const statusLocked = isEdit && asset!.status === 'assigned';
  return (
    <Modal open wide title={isEdit ? `Edit ${asset!.asset_tag}` : 'Register asset'} onClose={onClose} testId="asset-form"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save as any} data-testid="asset-save">{isEdit ? 'Save' : 'Register'}</Button></>}>
      <form onSubmit={save} className="form-grid">
        <Field label="Asset tag" hint={isEdit ? undefined : 'Generated automatically; you can override it.'}><Input {...f.bind('asset_tag')} className="mono" data-testid="asset-tag" /></Field>
        <Field label="Name" required><Input {...f.bind('name')} required autoFocus placeholder='e.g. MacBook Pro 14"' data-testid="asset-name" /></Field>
        <Field label="Category" hint={customCat ? 'Free text — add it to Settings › Asset categories to reuse it.' : 'Defaults to Laptop when left empty.'}>
          {customCat ? (
            <span className="row" style={{ flexWrap: 'nowrap' }}>
              <Input {...f.bind('category')} placeholder="Category name" data-testid="asset-category" />
              <Button size="sm" type="button" onClick={() => { setCustomCat(false); f.set('category', categories[0] || ''); }}>List</Button>
            </span>
          ) : (
            <Select value={f.values.category} onChange={(e) => { if (e.target.value === '__other') { setCustomCat(true); f.set('category', ''); } else f.set('category', e.target.value); }} data-testid="asset-category">
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              <option value="__other">Other…</option>
            </Select>
          )}
        </Field>
        <Field label="Status" hint={statusLocked ? 'Use Return to change the status of an assigned asset.' : undefined}>
          <Select {...f.bind('status')} disabled={statusLocked}>
            {statusLocked ? <option value="assigned">Assigned</option> : null}
            <option value="available">Available</option>
            <option value="maintenance">Maintenance</option>
            <option value="retired">Retired</option>
            {isEdit ? <option value="lost">Lost</option> : null}
          </Select>
        </Field>
        <Field label="Serial number"><Input {...f.bind('serial_number')} className="mono" /></Field>
        <Field label="Model"><Input {...f.bind('model')} /></Field>
        <Field label="Vendor"><Input {...f.bind('vendor')} /></Field>
        <Field label="Condition"><Select {...f.bind('condition')}>{CONDITIONS.map((c) => <option key={c} value={c}>{label(c)}</option>)}</Select></Field>
        <Field label="Purchase date"><Input type="date" {...f.bind('purchase_date')} /></Field>
        <Field label="Purchase cost"><Input type="number" step="0.01" min={0} {...f.bind('purchase_cost')} /></Field>
        <Field label="Warranty expiry"><Input type="date" {...f.bind('warranty_expiry')} /></Field>
        <Field label="Location"><Input {...f.bind('location')} placeholder="e.g. Bengaluru office, Desk 12" /></Field>
        <div className="span-2">
          <div className="row between" style={{ marginBottom: 6 }}>
            <span className="field-label">Specifications</span>
            <Button size="sm" type="button" variant="ghost" onClick={() => setSpecs((s) => [...s, { k: '', v: '' }])} data-testid="asset-spec-add">+ Add row</Button>
          </div>
          {specs.length === 0 ? <div className="help">No specifications. Add rows such as CPU, RAM, Storage.</div> : null}
          <div className="stack" style={{ gap: 6 }}>
            {specs.map((r, i) => (
              <div key={i} className="row" style={{ flexWrap: 'nowrap' }}>
                <Input value={r.k} onChange={(e) => setSpec(i, 'k', e.target.value)} placeholder="Key (e.g. RAM)" style={{ flex: 1 }} />
                <Input value={r.v} onChange={(e) => setSpec(i, 'v', e.target.value)} placeholder="Value (e.g. 16 GB)" style={{ flex: 2 }} />
                <button type="button" className="btn btn-ghost btn-sm" aria-label="Remove row" onClick={() => setSpecs((s) => s.filter((_, j) => j !== i))}>✕</button>
              </div>
            ))}
          </div>
        </div>
        <Field label="Notes" className="span-2"><Textarea {...f.bind('notes')} /></Field>
      </form>
    </Modal>
  );
}
