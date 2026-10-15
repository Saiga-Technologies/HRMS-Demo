import React, { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { usePageTour, type TourStep } from '../lib/tour';
import { fmtDate, fmtDateTime } from '../lib/format';
import { Badge, Button, Card, Checkbox, EmptyState, ExpiryDot, Field, Input, Modal, PageHeader, SearchInput, Select, Spinner, Stat, StatusBadge, Switch, Tabs, Textarea, useConfirm, useFetch, useForm, useToast } from '../components/ui';
import { ALL_FORMATS, DocumentPreviewModal, DocumentUploadModal, EXPIRY_COLORS, ExpiryLegend, FORMAT_LABEL, FormatBadge, documentFileUrl, fmtBytes, type DirectoryEmployee, type DocumentRow, type DocumentType } from '../components/DocumentModals';

const TOUR: TourStep[] = [
  { title: 'Documents', description: 'Every employee document in one place, with expiry tracking. The flow: 1) set up document types (formats, expiry rules), 2) upload documents against them, 3) watch the expiry colours and the Expiring list, 4) close the gaps shown in the Compliance matrix.' },
  { element: '[data-tour="documents-tabs"]', title: 'Views', description: 'All documents and Expiring are open to everyone (you only see the people you are allowed to see). HR also gets the Compliance matrix and the Document types catalogue.' },
  { element: '[data-tour="documents-stats"]', title: 'Counts by expiry state', tab: 'all', description: 'How many documents match, split by expiry state. Click a coloured tile to filter the table to that state; click it again to clear the filter.' },
  { element: '[data-tour="documents-search"]', title: 'Search', description: 'Find a document by its title, original file name or the employee’s name.' },
  { element: '[data-tour="documents-type-filter"]', title: 'Filter by type', description: 'Show only one document type, for example every Passport or every Work Visa.' },
  { element: '[data-tour="documents-state-filter"]', title: 'Filter by expiry state', description: 'OK, Warning, Critical, Expired or No expiry. Same filter as the tiles above.' },
  { element: '[data-tour="documents-upload"]', title: 'Upload a document', description: 'Opens the upload form: pick the employee and the document type, then the file. Only the formats and size the type allows are accepted, and types that require an expiry date will not save without one. HR uploads are marked Valid straight away.' },
  { element: '[data-tour="documents-legend"]', title: 'Expiry colours', description: 'Each document is coloured from its expiry date and its type’s warning and critical windows: green is fine, yellow is inside the warning days, orange inside the critical days, red has expired, grey has no expiry date.' },
  { element: '[data-tour="documents-table"]', title: 'The document list', description: 'Sorted by expiry, soonest first. Rows are tinted by expiry state, the Format column shows PDF/JPG/PNG and file size, and the Expiry column counts the days left. Click an employee’s name to open their profile on the Documents tab.' },
  { element: '[data-tour="documents-status"]', title: 'Review status', description: 'Valid means HR uploaded or checked it. Documents an employee uploads from their own profile arrive as Pending review.' },
  { element: '[data-tour="documents-review-queue"]', title: 'Review queue', description: 'HR’s count of documents waiting to be checked (also counted on the Documents menu badge and the bell). Click it to list only those, open each with Preview and use “Mark as reviewed” once it looks right.' },
  { element: '[data-tour="documents-row-actions"]', title: 'Preview and download', description: 'Preview opens the file in the browser next to its details, where you can edit the title, number and dates (which re-colours the row). HR can also delete it there. Download saves the original file.' },
  { element: '[data-tour="documents-stats"]', title: 'Next: what is expiring', tab: 'expiring', description: 'The Expiring view keeps only Warning, Critical and Expired documents, so this is the renewal to-do list. Chase the red and orange ones first.' },
  { element: '[data-tour="documents-table"]', title: 'Renewal list', description: 'Open a document to update its expiry date once the renewed copy arrives, or upload the new copy for the employee. When nothing is due the list says so.' },
  { element: '[data-tour="compliance-stats"]', title: 'Next: compliance', tab: 'compliance', description: 'The matrix checks every active employee against the document types marked “required for every employee”. The tiles show how many are fully compliant and how many have something missing or expired — click that tile to filter.' },
  { element: '[data-tour="compliance-filters"]', title: 'Find the gaps', description: 'Search for an employee, or tick “Only employees with issues” to see just the people you need to chase.' },
  { element: '[data-tour="compliance-matrix"]', title: 'Compliance matrix', description: 'One row per employee, one column per required type. Each cell shows the best document’s state and expiry date; Missing means nothing has been uploaded. Click a filled cell to preview that document. Issues counts missing plus expired.' },
  { element: '[data-tour="doctype-add"]', title: 'Next: document types', tab: 'types', description: 'Document types are the rules behind everything above. Add one to define its accepted formats (PDF, JPG, PNG), maximum size, whether an expiry date is required, the warning and critical days, and whether every employee must have it.' },
  { element: '[data-tour="doctype-table"]', title: 'Type catalogue', description: 'Each type with its formats, expiry rule, warning/critical windows, size limit and whether it is required for all (those become Compliance columns). Click a row to edit it; a type in use cannot be deleted, so mark it Inactive instead.' },
  { title: 'What to do next', description: 'Keep the loop going: set the types, upload against them, work the Expiring list each week and clear the Compliance gaps. Employees see their own documents here and on their profile; HR letters you generate are filed with their documents too.' },
];

type TabKey = 'all' | 'expiring' | 'compliance' | 'types';
const STATES = ['ok', 'warning', 'critical', 'expired', 'none'];

export default function Documents() {
  usePageTour('Documents', TOUR);
  const { isHr } = useAuth();
  const [sp, setSp] = useSearchParams();
  const requested = sp.get('tab') as TabKey | null;
  const tab: TabKey = requested && ['all', 'expiring', 'compliance', 'types'].includes(requested) && (isHr || requested === 'all' || requested === 'expiring') ? requested : 'all';
  const setTab = (k: string) => setSp((prev) => { const n = new URLSearchParams(prev); n.set('tab', k); return n; }, { replace: true });
  const types = useFetch<DocumentType[]>(() => api.get('/api/documents/types'), []);
  const tabs = [
    { key: 'all', label: 'All documents' },
    { key: 'expiring', label: 'Expiring' },
    ...(isHr ? [{ key: 'compliance', label: 'Compliance' }, { key: 'types', label: 'Document types', count: types.data?.length }] : []),
  ];
  return (
    <>
      <PageHeader title="Documents" subtitle="Employee documents, expiry tracking and the document type catalogue." />
      <Tabs tour="documents-tabs" value={tab} onChange={setTab} tabs={tabs} />
      {tab === 'all' || tab === 'expiring' ? <DocumentList expiring={tab === 'expiring'} types={types.data || []} /> : null}
      {tab === 'compliance' && isHr ? <ComplianceTab /> : null}
      {tab === 'types' && isHr ? <TypesTab types={types.data || []} loading={types.loading} reload={types.reload} /> : null}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* All / Expiring                                                      */
/* ------------------------------------------------------------------ */
function DocumentList({ expiring, types }: { expiring: boolean; types: DocumentType[] }) {
  const { isHr } = useAuth();
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [typeId, setTypeId] = useState('');
  const [state, setState] = useState('');
  const [pendingOnly, setPendingOnly] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<DocumentRow | null>(null);
  useEffect(() => { const t = setTimeout(() => setDq(q.trim()), 250); return () => clearTimeout(t); }, [q]);
  useEffect(() => { setState(''); }, [expiring]);

  const list = useFetch<{ items: DocumentRow[]; total: number }>(
    () => api.get(`/api/documents${qs({ q: dq, document_type_id: typeId, state, expiring: expiring ? '1' : '' })}`),
    [dq, typeId, state, expiring],
  );
  const directory = useFetch<DirectoryEmployee[]>(() => (isHr ? api.get('/api/employees/directory/all') : Promise.resolve([])), [isHr]);
  const all = list.data?.items || [];
  const pendingCount = useMemo(() => all.filter((d) => d.status === 'pending_review').length, [all]);
  const rows = useMemo(() => (pendingOnly ? all.filter((d) => d.status === 'pending_review') : all), [all, pendingOnly]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const d of all) c[d.expiry_state] = (c[d.expiry_state] || 0) + 1;
    return c;
  }, [all]);
  const stateOptions = expiring ? ['warning', 'critical', 'expired'] : STATES;

  return (
    <>
      <div className="stat-strip" data-tour="documents-stats">
        <Stat label={expiring ? 'Expiring or expired' : 'Documents'} value={list.loading && !list.data ? '…' : list.data?.total ?? 0} onClick={() => { setState(''); setPendingOnly(false); }} />
        {stateOptions.map((s) => (
          <Stat key={s} label={s === 'none' ? 'No expiry' : s.charAt(0).toUpperCase() + s.slice(1)} value={counts[s] || 0} color={EXPIRY_COLORS[s]} onClick={() => setState(state === s ? '' : s)} hint={state === s ? 'filtered' : undefined} />
        ))}
        {isHr ? <Stat tour="documents-review-queue" label="Pending review" value={pendingCount} color="var(--warning)" onClick={() => setPendingOnly((v) => !v)} hint={pendingOnly ? 'filtered' : 'click to filter'} /> : null}
      </div>
      <div className="toolbar" data-tour="documents-filters">
        <SearchInput value={q} onChange={setQ} placeholder="Search title, file or employee…" tour="documents-search" />
        <Select value={typeId} onChange={(e) => setTypeId(e.target.value)} aria-label="Document type" data-testid="filter-doctype" data-tour="documents-type-filter">
          <option value="">All types</option>
          {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </Select>
        <Select value={state} onChange={(e) => setState(e.target.value)} aria-label="Expiry state" data-testid="filter-state" data-tour="documents-state-filter">
          <option value="">{expiring ? 'Warning, critical & expired' : 'All states'}</option>
          {stateOptions.map((s) => <option key={s} value={s}>{s === 'none' ? 'No expiry' : s}</option>)}
        </Select>
        {isHr ? <span style={{ marginLeft: 'auto' }} data-tour="documents-upload"><Button variant="primary" onClick={() => setUploading(true)} data-testid="document-upload">Upload document</Button></span> : null}
      </div>
      <Card padded={false} tour="documents-table" title={<ExpiryLegend />}>
        {list.error ? <div className="alert alert-error" style={{ margin: 12 }}>{list.error}</div> : null}
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Employee</th><th>Title</th><th>Type</th><th>Format</th><th>Expiry</th><th>Status</th><th>Uploaded</th><th style={{ textAlign: 'right' }}>Actions</th></tr>
            </thead>
            <tbody>
              {list.loading && !list.data ? (
                <tr><td colSpan={8}><Spinner /></td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={8} className="table-empty">{pendingOnly ? 'Nothing is waiting for review.' : expiring ? 'Nothing is expiring. Nice.' : 'No documents match.'}</td></tr>
              ) : rows.map((d) => (
                <tr key={d.id} className={`row-${d.expiry_state}`} data-testid={`document-row-${d.id}`}>
                  <td><Link to={`/employees/${d.employee_id}?tab=documents`}><strong>{d.employee_name || `#${d.employee_id}`}</strong></Link>{d.employee_code ? <div className="muted mono">{d.employee_code}</div> : null}</td>
                  <td>{d.title}{d.document_number ? <div className="muted mono">{d.document_number}</div> : null}</td>
                  <td>{d.type_name || '—'}{d.category ? <div className="muted">{d.category}</div> : null}</td>
                  <td><FormatBadge format={d.format} /> <span className="muted">{fmtBytes(d.size_bytes)}</span></td>
                  <td><div>{fmtDate(d.expiry_date)}</div><ExpiryDot state={d.expiry_state} days={d.days_to_expiry} /></td>
                  <td data-tour="documents-status"><StatusBadge status={d.status} /></td>
                  <td className="muted">{fmtDateTime(d.created_at)}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }} data-tour="documents-row-actions">
                    <Button size="sm" onClick={() => setPreview(d)} data-testid={`document-preview-${d.id}`}>Preview</Button>{' '}
                    <a className="btn btn-ghost btn-sm" href={documentFileUrl(d.id, true)} download={d.original_name}>Download</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {isHr ? <DocumentUploadModal open={uploading} employees={directory.data || []} onClose={() => setUploading(false)} onUploaded={() => list.reload()} /> : null}
      {preview ? <DocumentPreviewModal doc={preview} onClose={() => setPreview(null)} onChanged={(d) => { setPreview(d); list.reload(); }} onDeleted={() => { setPreview(null); list.reload(); }} /> : null}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Compliance matrix                                                   */
/* ------------------------------------------------------------------ */
interface ComplianceCell { type_id: number; state: string; document_id: number | null; expiry_date: string | null }
interface ComplianceRow { employee: { id: number; employee_code: string; first_name: string; last_name: string }; cells: ComplianceCell[]; missing: number }
const CELL_LABEL: Record<string, string> = { missing: 'Missing', expired: 'Expired', critical: 'Critical', warning: 'Warning', ok: 'OK', none: 'Present' };
function ComplianceTab() {
  const toast = useToast();
  const data = useFetch<{ types: DocumentType[]; rows: ComplianceRow[] }>(() => api.get('/api/documents/compliance'), []);
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [preview, setPreview] = useState<DocumentRow | null>(null);
  const [q, setQ] = useState('');
  const rows = useMemo(() => (data.data?.rows || []).filter((r) => (!onlyIssues || r.missing > 0) && (!q || `${r.employee.first_name} ${r.employee.last_name} ${r.employee.employee_code}`.toLowerCase().includes(q.toLowerCase()))), [data.data, onlyIssues, q]);
  const totals = useMemo(() => {
    const t = { employees: data.data?.rows.length || 0, compliant: 0, issues: 0 };
    for (const r of data.data?.rows || []) if (r.missing > 0) t.issues++; else t.compliant++;
    return t;
  }, [data.data]);
  const openCell = async (c: ComplianceCell) => {
    if (!c.document_id) return;
    try {
      setPreview(await api.get<DocumentRow>(`/api/documents/${c.document_id}`));
    } catch (err) {
      toast.error(err);
    }
  };
  const types = data.data?.types || [];
  return (
    <>
      <div className="stat-strip" data-tour="compliance-stats">
        <Stat label="Employees" value={totals.employees} />
        <Stat label="Fully compliant" value={totals.compliant} color={EXPIRY_COLORS.ok} />
        <Stat label="Missing or expired" value={totals.issues} color={EXPIRY_COLORS.expired} onClick={() => setOnlyIssues((v) => !v)} hint={onlyIssues ? 'filtered' : 'click to filter'} />
        <Stat label="Required types" value={types.length} hint="required for all" />
      </div>
      <div className="toolbar" data-tour="compliance-filters">
        <SearchInput value={q} onChange={setQ} placeholder="Search employee…" />
        <Checkbox label="Only employees with issues" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} />
      </div>
      <Card padded={false} tour="compliance-matrix" title={<ExpiryLegend withMissing />}>
        {data.loading && !data.data ? <Spinner /> : types.length === 0 ? (
          <EmptyState title="No required document types" description='Mark a document type as "required for all" to track compliance here.' />
        ) : (
          <div className="table-wrap">
            <table className="table matrix dense">
              <thead>
                <tr>
                  <th>Employee</th>
                  {types.map((t) => <th key={t.id} style={{ textAlign: 'center' }}>{t.name}</th>)}
                  <th style={{ textAlign: 'right' }}>Issues</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? <tr><td colSpan={types.length + 2} className="table-empty">{onlyIssues ? 'Everyone is compliant.' : 'No employees.'}</td></tr> : rows.map((r) => (
                  <tr key={r.employee.id}>
                    <td><Link to={`/employees/${r.employee.id}?tab=documents`}><strong>{r.employee.first_name} {r.employee.last_name}</strong></Link><div className="muted mono">{r.employee.employee_code}</div></td>
                    {r.cells.map((c) => (
                      <td key={c.type_id} className="cell">
                        <button type="button" className={`cell-box cell-${c.state}`} disabled={!c.document_id} onClick={() => openCell(c)} title={c.expiry_date ? `Expires ${fmtDate(c.expiry_date)}` : CELL_LABEL[c.state] || c.state} data-testid={`compliance-${r.employee.id}-${c.type_id}`}>
                          {CELL_LABEL[c.state] || c.state}
                          {c.expiry_date ? <small>{fmtDate(c.expiry_date, { day: '2-digit', month: 'short', year: '2-digit' })}</small> : null}
                        </button>
                      </td>
                    ))}
                    <td style={{ textAlign: 'right' }}>{r.missing ? <Badge tone="danger">{r.missing}</Badge> : <Badge tone="success">0</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {preview ? <DocumentPreviewModal doc={preview} onClose={() => setPreview(null)} onChanged={(d) => { setPreview(d); data.reload(); }} onDeleted={() => { setPreview(null); data.reload(); }} /> : null}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Document types                                                      */
/* ------------------------------------------------------------------ */
function TypesTab({ types, loading, reload }: { types: DocumentType[]; loading: boolean; reload: () => void }) {
  const [edit, setEdit] = useState<Partial<DocumentType> | null>(null);
  return (
    <>
      <div className="toolbar">
        <span className="help">Document types control accepted formats, size limits, expiry rules and which documents every employee must have.</span>
        <span style={{ marginLeft: 'auto' }} data-tour="doctype-add"><Button variant="primary" onClick={() => setEdit({})} data-testid="doctype-add">+ Add document type</Button></span>
      </div>
      <Card padded={false} tour="doctype-table">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Name</th><th>Category</th><th>Formats</th><th>Expiry</th><th>Warn / critical</th><th>Max size</th><th>Required</th><th>Status</th></tr>
            </thead>
            <tbody>
              {loading && !types.length ? <tr><td colSpan={8}><Spinner /></td></tr> : types.length === 0 ? <tr><td colSpan={8} className="table-empty">No document types yet.</td></tr> : types.map((t) => (
                <tr key={t.id} className="clickable" onClick={() => setEdit(t)} data-testid={`doctype-row-${t.id}`}>
                  <td><strong>{t.name}</strong>{t.description ? <div className="muted">{t.description}</div> : null}</td>
                  <td>{t.category || '—'}</td>
                  <td><span className="row" style={{ gap: 4 }}>{(t.allowed_formats || []).map((f) => <FormatBadge key={f} format={f} />)}</span></td>
                  <td>{t.requires_expiry ? <Badge tone="warning">required</Badge> : <span className="muted">optional</span>}</td>
                  <td className="num">{t.expiry_warning_days}d / {t.expiry_critical_days}d</td>
                  <td className="num">{t.max_size_mb} MB</td>
                  <td>{t.required_for_all ? <Badge tone="info">for all</Badge> : '—'}</td>
                  <td><Badge tone={t.active ? 'success' : 'neutral'}>{t.active ? 'Active' : 'Inactive'}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {edit ? <DocTypeModal type={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} /> : null}
    </>
  );
}

function DocTypeModal({ type, onClose, onSaved }: { type: Partial<DocumentType>; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const f = useForm({
    name: type.name || '',
    category: type.category || '',
    description: type.description || '',
    expiry_warning_days: type.expiry_warning_days ?? 30,
    expiry_critical_days: type.expiry_critical_days ?? 7,
    max_size_mb: type.max_size_mb ?? 10,
    active: type.active ?? 1,
  });
  const [formats, setFormats] = useState<string[]>(type.allowed_formats?.length ? [...type.allowed_formats] : [...ALL_FORMATS]);
  const [requiresExpiry, setRequiresExpiry] = useState(!!type.requires_expiry);
  const [requiredForAll, setRequiredForAll] = useState(!!type.required_for_all);
  const [busy, setBusy] = useState(false);
  const toggleFormat = (fmt: string, on: boolean) => setFormats((s) => (on ? Array.from(new Set([...s, fmt])) : s.filter((x) => x !== fmt)));

  const save = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!f.values.name.trim()) return toast.error('Name is required');
    if (!formats.length) return toast.error('Select at least one allowed format');
    const warn = Number(f.values.expiry_warning_days), crit = Number(f.values.expiry_critical_days), max = Number(f.values.max_size_mb);
    if (!(warn >= 0) || !(crit >= 0)) return toast.error('Warning and critical days must be zero or more');
    if (crit > warn) return toast.error('Critical days should not exceed warning days');
    if (!(max > 0)) return toast.error('Max size must be greater than zero');
    const body = {
      name: f.values.name.trim(), category: f.values.category.trim() || null, description: f.values.description.trim() || null,
      allowed_formats: ALL_FORMATS.filter((x) => formats.includes(x)), requires_expiry: requiresExpiry ? 1 : 0,
      expiry_warning_days: warn, expiry_critical_days: crit, required_for_all: requiredForAll ? 1 : 0, max_size_mb: max, active: Number(f.values.active),
    };
    setBusy(true);
    try {
      if (type.id) await api.put(`/api/documents/types/${type.id}`, body);
      else await api.post('/api/documents/types', body);
      toast.success(type.id ? 'Document type updated' : 'Document type created');
      onSaved();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!(await confirm('Delete document type?', 'Only possible when no document uses it; otherwise mark it inactive.'))) return;
    try {
      await api.delete(`/api/documents/types/${type.id}`);
      toast.success('Document type deleted');
      onSaved();
    } catch (err) {
      toast.error(err);
    }
  };
  return (
    <Modal open title={type.id ? 'Edit document type' : 'New document type'} onClose={onClose} testId="doctype-modal"
      footer={<>
        {type.id ? <Button variant="danger" onClick={remove} style={{ marginRight: 'auto' }} data-testid="doctype-delete">Delete</Button> : null}
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={busy} onClick={() => save()} data-testid="doctype-save">Save</Button>
      </>}>
      {dialog}
      <form onSubmit={save} className="form-grid">
        <Field label="Name" required><Input {...f.bind('name')} required autoFocus data-testid="doctype-name" /></Field>
        <Field label="Category"><Input {...f.bind('category')} placeholder="e.g. Identity, Contract, Certificate" /></Field>
        <Field label="Description" className="span-2"><Textarea {...f.bind('description')} rows={2} /></Field>
        <div className="field span-2">
          <span className="field-label">Allowed formats<span className="req"> *</span></span>
          <div className="row">
            {ALL_FORMATS.map((fmt) => <Checkbox key={fmt} label={FORMAT_LABEL[fmt]} checked={formats.includes(fmt)} onChange={(e) => toggleFormat(fmt, e.target.checked)} data-testid={`doctype-format-${fmt}`} />)}
          </div>
          <span className="field-hint">At least one</span>
        </div>
        <div className="span-2"><Switch checked={requiresExpiry} onChange={setRequiresExpiry} label="Requires an expiry date" /></div>
        <Field label="Expiry warning (days)" hint="Yellow when within this many days"><Input type="number" min={0} {...f.bind('expiry_warning_days')} /></Field>
        <Field label="Expiry critical (days)" hint="Orange when within this many days"><Input type="number" min={0} {...f.bind('expiry_critical_days')} /></Field>
        <div className="span-2"><Switch checked={requiredForAll} onChange={setRequiredForAll} label="Required for every employee (tracked in Compliance)" /></div>
        <Field label="Max file size (MB)"><Input type="number" min={1} {...f.bind('max_size_mb')} /></Field>
        <Field label="Status"><Select {...f.bind('active')}><option value={1}>Active</option><option value={0}>Inactive</option></Select></Field>
      </form>
    </Modal>
  );
}
