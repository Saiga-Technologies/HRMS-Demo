import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { usePageTour } from '../lib/tour';
import { fmtDate, fmtDateTime, fmtMinutes, fmtMoney, fmtTime, fullName, label, todayIso } from '../lib/format';
import { Avatar, Badge, Button, Card, EmptyState, ExpiryDot, Field, Input, KeyValue, Modal, PageHeader, Spinner, Stat, StatusBadge, Table, Tabs, Textarea, useFetch, useForm, useToast } from '../components/ui';
import { EmployeeFormModal, customFieldDisplay, groupDefs, type CustomFieldDef, type Employee } from '../components/EmployeeForm';
import { DocumentPreviewModal, DocumentUploadModal, FormatBadge, fmtBytes, documentFileUrl, type DocumentRow } from '../components/DocumentModals';

const TOUR = [
  { element: '[data-tour="employee-header"]', title: 'Employee header', description: 'Photo, name, code, role and status. HR (or the employee themself) can click the photo to upload a new one.' },
  { element: '[data-tour="employee-edit"]', title: 'Edit the record', description: 'HR can edit every field including job, bank and custom fields. Employees can update their own contact details.' },
  { element: '[data-tour="employee-tabs"]', title: 'Everything about this person', description: 'Profile, documents, salary, attendance, leave, assets and the onboarding journey live in these tabs.' },
  { element: '[data-tour="employee-profile"]', title: 'Profile', description: 'Personal, contact, job, bank and custom-field details. Sensitive bank/tax data is only visible to HR and the employee.' },
  { element: '[data-tour="employee-documents"]', title: 'Documents', description: 'Upload ID proofs, contracts and certificates. Colour dots show how close each document is to expiry.' },
  { element: '[data-tour="employee-salary"]', title: 'Salary structure', description: 'The current basic and component breakdown with a net-pay preview, plus the history of past structures.' },
  { element: '[data-tour="employee-journey"]', title: 'Journey', description: 'A timeline of onboarding stages with progress. Edit stages from the Journey module.' },
];

type TabKey = 'profile' | 'documents' | 'salary' | 'attendance' | 'leave' | 'assets' | 'journey';
interface DetailResponse extends Employee { documents: DocumentRow[]; user: { id: number; email: string; role: string; active: number } | null }

export default function EmployeeDetail() {
  usePageTour('Employee profile', TOUR);
  const { id } = useParams();
  const employeeId = Number(id);
  const { user, isHr, refresh } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [sp, setSp] = useSearchParams();
  const tab = (sp.get('tab') as TabKey) || 'profile';
  const setTab = (k: string) => setSp((prev) => { const n = new URLSearchParams(prev); n.set('tab', k); return n; }, { replace: true });

  const detail = useFetch<DetailResponse>(() => api.get(`/api/employees/${employeeId}`), [employeeId]);
  const defs = useFetch<CustomFieldDef[]>(() => api.get('/api/settings/custom-fields/employee'), []);
  const emp = detail.data;
  const isSelf = !!user?.employee_id && user.employee_id === employeeId;
  const canEdit = isHr || isSelf;
  const canSeeSalary = isHr || isSelf;

  const [editing, setEditing] = useState(false);
  const [photoVer, setPhotoVer] = useState(0);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const photoInput = useRef<HTMLInputElement>(null);
  const tempPassword = (location.state as any)?.temporary_password as string | undefined;
  const loginEmail = (location.state as any)?.login_email as string | undefined;
  const [showTemp, setShowTemp] = useState(!!tempPassword);

  const uploadPhoto = async (file: File) => {
    if (!/\.(jpe?g|png)$/i.test(file.name) || !['image/jpeg', 'image/png'].includes(file.type)) return toast.error('Photo must be a JPG or PNG');
    const fd = new FormData();
    fd.append('photo', file);
    setUploadingPhoto(true);
    try {
      await api.upload(`/api/employees/${employeeId}/photo`, fd);
      toast.success('Photo updated');
      setPhotoVer((v) => v + 1);
      detail.reload();
      if (isSelf) refresh();
    } catch (err) {
      toast.error(err);
    } finally {
      setUploadingPhoto(false);
      if (photoInput.current) photoInput.current.value = '';
    }
  };

  if (detail.error && !emp) {
    return (
      <>
        <PageHeader title="Employee" />
        <Card><EmptyState title="Could not load employee" description={detail.error} action={<Button onClick={() => navigate('/employees')}>Back to directory</Button>} /></Card>
      </>
    );
  }
  if (!emp) return <Spinner />;

  const name = fullName(emp);
  const photoSrc = emp.photo_path ? `/api/employees/${emp.id}/photo?v=${photoVer}` : null;
  const tabs: { key: TabKey; label: string; count?: number }[] = [
    { key: 'profile', label: 'Profile' },
    { key: 'documents', label: 'Documents', count: emp.documents?.length ?? 0 },
    ...(canSeeSalary ? [{ key: 'salary' as TabKey, label: 'Salary' }] : []),
    { key: 'attendance', label: 'Attendance' },
    { key: 'leave', label: 'Leave' },
    { key: 'assets', label: 'Assets' },
    { key: 'journey', label: 'Journey' },
  ];

  return (
    <>
      <PageHeader
        title={<span className="row" style={{ gap: 6 }}><Link to="/employees" className="muted" style={{ fontWeight: 400 }}>Employees</Link><span className="muted">/</span>{name}</span>}
        actions={canEdit ? (
          <div className="row" data-tour="employee-edit">
            <Button variant="primary" onClick={() => setEditing(true)} data-testid="employee-edit">{isHr ? 'Edit' : 'Edit my details'}</Button>
          </div>
        ) : undefined}
      />

      {showTemp && tempPassword ? (
        <div className="alert alert-success mb row between" data-testid="temp-password-alert">
          <span>Login created for <strong>{loginEmail || emp.email}</strong>. Temporary password: <code className="mono" data-testid="temp-password">{tempPassword}</code> (must be changed on first login).</span>
          <span className="row">
            <Button size="sm" onClick={() => { navigator.clipboard?.writeText(tempPassword).then(() => toast.success('Copied')).catch(() => {}); }}>Copy</Button>
            <Button size="sm" variant="ghost" onClick={() => setShowTemp(false)}>Dismiss</Button>
          </span>
        </div>
      ) : null}

      <Card tour="employee-header" className="emp-header-card">
        <div className="emp-header">
          <div
            className={`emp-avatar ${canEdit ? '' : 'readonly'}`}
            title={canEdit ? 'Click to upload a JPG or PNG photo' : undefined}
            onClick={() => canEdit && !uploadingPhoto && photoInput.current?.click()}
            role={canEdit ? 'button' : undefined}
            data-testid="employee-photo">
            <Avatar name={name} src={photoSrc} size={84} color={emp.department_color || undefined} />
            {canEdit ? <span className="avatar-overlay">{uploadingPhoto ? <span className="spinner" /> : 'Change'}</span> : null}
            <input ref={photoInput} type="file" accept=".jpg,.jpeg,.png,image/jpeg,image/png" style={{ display: 'none' }} data-testid="employee-photo-input" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadPhoto(f); }} />
          </div>
          <div className="stack" style={{ gap: 6, flex: 1, minWidth: 220 }}>
            <div className="row">
              <h2 style={{ fontSize: 22, margin: 0 }}>{name}</h2>
              <StatusBadge status={emp.status} label={label(emp.status)} />
              <Badge tone="neutral">{label(emp.employment_type)}</Badge>
            </div>
            <div className="emp-meta">
              <span className="mono">{emp.employee_code}</span>
              {emp.position_title ? <span>{emp.position_title}</span> : null}
              {emp.department_name ? <span><span className="color-swatch" style={{ background: emp.department_color || '#94a3b8' }} />{emp.department_name}</span> : null}
              {emp.work_location_name ? <span>📍 {emp.work_location_name}</span> : null}
              <span>Joined {fmtDate(emp.join_date)}</span>
            </div>
            <div className="emp-meta">
              <span>Manager: {emp.manager_id ? <Link to={`/employees/${emp.manager_id}`}>{emp.manager_name}</Link> : '—'}</span>
              <span>Direct reports: <strong>{emp.direct_reports ?? 0}</strong></span>
              {emp.user ? <span>Login: <span className="mono">{emp.user.email}</span> <Badge tone={emp.user.active ? 'info' : 'neutral'}>{emp.user.role}</Badge></span> : isHr ? <span className="muted">No login</span> : null}
            </div>
          </div>
        </div>
      </Card>

      <Tabs tour="employee-tabs" value={tab} onChange={setTab} tabs={tabs} />

      {tab === 'profile' ? <ProfileTab emp={emp} defs={defs.data || []} /> : null}
      {tab === 'documents' ? <DocumentsTab emp={emp} reload={detail.reload} /> : null}
      {tab === 'salary' && canSeeSalary ? <SalaryTab employeeId={emp.id} /> : null}
      {tab === 'attendance' ? <AttendanceTab employeeId={emp.id} /> : null}
      {tab === 'leave' ? <LeaveTab employeeId={emp.id} /> : null}
      {tab === 'assets' ? <AssetsTab employeeId={emp.id} /> : null}
      {tab === 'journey' ? <JourneyTab employeeId={emp.id} candidateId={emp.candidate_id ?? null} /> : null}

      {editing ? (
        <EmployeeFormModal
          employee={emp}
          mode={isHr ? 'edit' : 'self'}
          onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); detail.reload(); if (isSelf) refresh(); }}
        />
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Profile                                                             */
/* ------------------------------------------------------------------ */
function ProfileTab({ emp, defs }: { emp: Employee; defs: CustomFieldDef[] }) {
  const hasBank = ['bank_name', 'bank_account_name', 'bank_account_number', 'bank_ifsc', 'tax_id', 'pf_number'].some((k) => (emp as any)[k] !== undefined);
  const groups = groupDefs(defs);
  const link = (text: string | null | undefined, href: string) => (text ? <a href={href}>{text}</a> : '—');
  return (
    <div className="detail-grid" data-tour="employee-profile">
      <Card title="Personal">
        <KeyValue items={[
          { k: 'Full name', v: fullName(emp) },
          { k: 'Date of birth', v: fmtDate(emp.dob) },
          { k: 'Gender', v: emp.gender ? emp.gender.replace(/_/g, ' ') : '—' },
          { k: 'Marital status', v: emp.marital_status || '—' },
          { k: 'Nationality', v: emp.nationality || '—' },
        ]} />
      </Card>
      <Card title="Contact">
        <KeyValue items={[
          { k: 'Email', v: link(emp.email, `mailto:${emp.email}`) },
          { k: 'Phone', v: link(emp.phone, `tel:${emp.phone}`) },
          { k: 'Address', v: emp.address || '—' },
          { k: 'City', v: emp.city || '—' },
          { k: 'Country', v: emp.country || '—' },
        ]} />
      </Card>
      <Card title="Job & reporting">
        <KeyValue items={[
          { k: 'Department', v: emp.department_name ? <span><span className="color-swatch" style={{ background: emp.department_color || '#94a3b8' }} />{emp.department_name}</span> : '—' },
          { k: 'Position', v: emp.position_title || '—' },
          { k: 'Manager', v: emp.manager_id ? <Link to={`/employees/${emp.manager_id}`}>{emp.manager_name}</Link> : '—' },
          { k: 'Employment type', v: label(emp.employment_type) },
          { k: 'Status', v: <StatusBadge status={emp.status} label={label(emp.status)} /> },
          ...(emp.candidate_id ? [{ k: 'Recruitment', v: <Link to={`/recruitment?candidate=${emp.candidate_id}`} data-testid="employee-recruitment-link">Hired via recruitment{emp.vacancy_title ? ` · ${emp.vacancy_title}` : ''}</Link> }] : emp.vacancy_title ? [{ k: 'Vacancy', v: emp.vacancy_title }] : []),
        ]} />
      </Card>
      <Card title="Dates & location">
        <KeyValue items={[
          { k: 'Employee code', v: <span className="mono">{emp.employee_code}</span> },
          { k: 'Join date', v: fmtDate(emp.join_date) },
          { k: 'Confirmation date', v: fmtDate(emp.confirmation_date) },
          ...(emp.exit_date || emp.status === 'exited' ? [{ k: 'Exit date', v: fmtDate(emp.exit_date) }] : []),
          { k: 'Work location', v: emp.work_location_name || '—' },
          { k: 'Shift', v: emp.shift_name || '—' },
        ]} />
      </Card>
      {hasBank ? (
        <Card title="Bank & statutory">
          <KeyValue items={[
            { k: 'Bank', v: emp.bank_name || '—' },
            { k: 'Account holder', v: emp.bank_account_name || '—' },
            { k: 'Account number', v: emp.bank_account_number ? <span className="mono">{emp.bank_account_number}</span> : '—' },
            { k: 'IFSC', v: emp.bank_ifsc ? <span className="mono">{emp.bank_ifsc}</span> : '—' },
            { k: 'Tax ID', v: emp.tax_id ? <span className="mono">{emp.tax_id}</span> : '—' },
            { k: 'PF number', v: emp.pf_number ? <span className="mono">{emp.pf_number}</span> : '—' },
          ]} />
        </Card>
      ) : null}
      <Card title="Emergency contact">
        <KeyValue items={[
          { k: 'Name', v: emp.emergency_contact_name || '—' },
          { k: 'Phone', v: link(emp.emergency_contact_phone, `tel:${emp.emergency_contact_phone}`) },
        ]} />
      </Card>
      {groups.length ? (
        <Card title="Custom fields">
          {groups.map((g) => (
            <div key={g.section} style={{ marginBottom: 8 }}>
              {groups.length > 1 ? <div className="section-title">{g.section}</div> : null}
              <KeyValue items={g.defs.map((d) => ({ k: d.label, v: customFieldDisplay(d, emp.custom_fields?.[d.key]) }))} />
            </div>
          ))}
        </Card>
      ) : null}
      {emp.notes ? <Card title="Notes"><p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{emp.notes}</p></Card> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Documents                                                           */
/* ------------------------------------------------------------------ */
function DocumentsTab({ emp, reload }: { emp: DetailResponse; reload: () => void }) {
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<DocumentRow | null>(null);
  const docs = emp.documents || [];
  const expiringCount = docs.filter((d) => ['warning', 'critical', 'expired'].includes(d.expiry_state)).length;
  return (
    <>
      <Card
        padded={false}
        tour="employee-documents"
        title={<span className="row">Documents {expiringCount ? <Badge tone="warning">{expiringCount} expiring / expired</Badge> : null}</span>}
        actions={<Button variant="primary" size="sm" onClick={() => setUploading(true)} data-testid="document-upload">Upload document</Button>}>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Title</th><th>Type</th><th>Format</th><th>Issued</th><th>Expiry</th><th>Status</th><th>Size</th><th style={{ textAlign: 'right' }}>Actions</th></tr>
            </thead>
            <tbody>
              {docs.length === 0 ? (
                <tr><td colSpan={8} className="table-empty">No documents uploaded yet.</td></tr>
              ) : docs.map((d) => (
                <tr key={d.id} className={`row-${d.expiry_state}`} data-testid={`document-row-${d.id}`}>
                  <td><strong>{d.title}</strong>{d.document_number ? <div className="muted mono">{d.document_number}</div> : null}</td>
                  <td>{d.type_name || '—'}</td>
                  <td><FormatBadge format={d.format} /></td>
                  <td>{fmtDate(d.issued_date)}</td>
                  <td><div>{fmtDate(d.expiry_date)}</div><ExpiryDot state={d.expiry_state} days={d.days_to_expiry} /></td>
                  <td><StatusBadge status={d.status} /></td>
                  <td className="muted">{fmtBytes(d.size_bytes)}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <Button size="sm" onClick={() => setPreview(d)} data-testid={`document-preview-${d.id}`}>Preview</Button>{' '}
                    <a className="btn btn-ghost btn-sm" href={documentFileUrl(d.id, true)} download={d.original_name}>Download</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <DocumentUploadModal open={uploading} employeeId={emp.id} onClose={() => setUploading(false)} onUploaded={() => reload()} />
      {preview ? <DocumentPreviewModal doc={preview} onClose={() => setPreview(null)} onChanged={(d) => { setPreview(d); reload(); }} onDeleted={() => { setPreview(null); reload(); }} /> : null}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Salary                                                              */
/* ------------------------------------------------------------------ */
interface SalaryComponent { id: number; name: string; code: string; type: 'earning' | 'deduction'; calc_type: 'fixed' | 'percent_of_basic' | 'percent_of_gross'; default_value: number; taxable: number; statutory: number; prorate: number; sort_order: number; active: number }
interface Structure { id: number; employee_id: number; effective_from: string; currency: string; basic: number; components: { component_id: number; value: number }[]; ctc_annual?: number | null; notes?: string | null; created_at: string }
interface Breakdown { basic: number; earnings: { code: string; name: string; amount: number; full_amount?: number; taxable?: boolean }[]; deductions: { code: string; name: string; amount: number; statutory?: boolean }[]; gross: number; total_deductions: number; net: number }
const CALC_LABEL: Record<string, string> = { fixed: 'Fixed', percent_of_basic: '% of basic', percent_of_gross: '% of gross' };

function BreakdownView({ b, currency }: { b: Breakdown; currency: string }) {
  return (
    <div className="grid grid-2">
      <div>
        <div className="form-section">Earnings</div>
        <table className="table dense">
          <tbody>
            {b.earnings.map((e) => <tr key={e.code}><td>{e.name} <span className="muted mono">{e.code}</span></td><td className="right num">{fmtMoney(e.amount, currency)}</td></tr>)}
            <tr><td><strong>Gross</strong></td><td className="right num"><strong>{fmtMoney(b.gross, currency)}</strong></td></tr>
          </tbody>
        </table>
      </div>
      <div>
        <div className="form-section">Deductions</div>
        <table className="table dense">
          <tbody>
            {b.deductions.map((d) => <tr key={d.code}><td>{d.name} <span className="muted mono">{d.code}</span>{d.statutory ? <Badge tone="info" className="ml">statutory</Badge> : null}</td><td className="right num">{fmtMoney(d.amount, currency)}</td></tr>)}
            <tr><td><strong>Total deductions</strong></td><td className="right num"><strong>{fmtMoney(b.total_deductions, currency)}</strong></td></tr>
          </tbody>
        </table>
      </div>
      <div className="span-2 net-pay"><span>Net pay / month</span><strong className="num">{fmtMoney(b.net, currency)}</strong></div>
    </div>
  );
}

function SalaryTab({ employeeId }: { employeeId: number }) {
  const { isHr } = useAuth();
  const data = useFetch<{ history: Structure[]; current: Structure | null; preview: Breakdown | null }>(() => api.get(`/api/payroll/structures/${employeeId}`), [employeeId]);
  const components = useFetch<SalaryComponent[]>(() => api.get('/api/payroll/components'), []);
  const [creating, setCreating] = useState(false);
  const cur = data.data?.current || null;
  const preview = data.data?.preview || null;
  const compName = (id: number) => components.data?.find((c) => c.id === id);
  const currency = cur?.currency || 'INR';
  return (
    <>
      <div className="grid grid-2" data-tour="employee-salary">
        <Card title="Current structure" actions={isHr ? <Button variant="primary" size="sm" onClick={() => setCreating(true)} data-testid="structure-add">New structure</Button> : undefined}>
          {data.loading && !data.data ? <Spinner /> : !cur ? (
            <EmptyState title="No salary structure yet" description={isHr ? 'Create one to enable payroll for this employee.' : 'HR has not set up a salary structure yet.'} action={isHr ? <Button variant="primary" onClick={() => setCreating(true)}>New structure</Button> : undefined} />
          ) : (
            <KeyValue items={[
              { k: 'Effective from', v: fmtDate(cur.effective_from) },
              { k: 'Basic (monthly)', v: <strong>{fmtMoney(cur.basic, currency)}</strong> },
              { k: 'Currency', v: cur.currency },
              { k: 'CTC (annual)', v: cur.ctc_annual ? fmtMoney(cur.ctc_annual, currency) : '—' },
              { k: 'Overrides', v: cur.components?.length ? <ul className="list">{cur.components.map((c) => { const def = compName(Number(c.component_id)); return <li key={c.component_id}><span>{def?.name || `#${c.component_id}`}</span><span className="num">{def?.calc_type === 'fixed' ? fmtMoney(Number(c.value), currency) : `${c.value}%`}</span></li>; })}</ul> : 'Defaults for all components' },
              { k: 'Notes', v: cur.notes || '—' },
            ]} />
          )}
        </Card>
        <Card title="Monthly breakdown">
          {preview ? <BreakdownView b={preview} currency={currency} /> : <p className="muted">The breakdown appears once a structure exists.</p>}
        </Card>
      </div>
      <Card title="History" padded={false}>
        <Table<Structure>
          loading={data.loading && !data.data}
          rows={data.data?.history || []}
          empty="No structures recorded."
          columns={[
            { key: 'effective_from', header: 'Effective from', render: (s) => <span>{fmtDate(s.effective_from)} {cur && s.id === cur.id ? <Badge tone="success">current</Badge> : null}</span> },
            { key: 'basic', header: 'Basic', align: 'right', render: (s) => <span className="num">{fmtMoney(s.basic, s.currency)}</span> },
            { key: 'ctc_annual', header: 'CTC (annual)', align: 'right', render: (s) => <span className="num">{s.ctc_annual ? fmtMoney(s.ctc_annual, s.currency) : '—'}</span> },
            { key: 'components', header: 'Overrides', render: (s) => (s.components?.length ? `${s.components.length} component${s.components.length === 1 ? '' : 's'}` : 'defaults') },
            { key: 'notes', header: 'Notes', render: (s) => s.notes || '—' },
            { key: 'created_at', header: 'Created', render: (s) => fmtDateTime(s.created_at) },
          ]}
        />
      </Card>
      {creating ? <StructureModal employeeId={employeeId} current={cur} components={(components.data || []).filter((c) => c.active)} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); data.reload(); }} /> : null}
    </>
  );
}

function StructureModal({ employeeId, current, components, onClose, onSaved }: { employeeId: number; current: Structure | null; components: SalaryComponent[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const f = useForm({ effective_from: todayIso(), basic: current ? String(current.basic) : '', currency: current?.currency || 'INR', ctc_annual: current?.ctc_annual ? String(current.ctc_annual) : '', notes: '' });
  const [overrides, setOverrides] = useState<Record<number, string>>(() => {
    const o: Record<number, string> = {};
    for (const c of current?.components || []) o[Number(c.component_id)] = String(c.value);
    return o;
  });
  const [preview, setPreview] = useState<Breakdown | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const componentPayload = () => Object.entries(overrides).filter(([, v]) => v !== '' && Number.isFinite(Number(v))).map(([id, v]) => ({ component_id: Number(id), value: Number(v) }));
  const overridesKey = JSON.stringify(overrides);
  useEffect(() => {
    const basic = Number(f.values.basic);
    if (!Number.isFinite(basic) || f.values.basic === '') { setPreview(null); return; }
    setPreviewing(true);
    const t = setTimeout(async () => {
      try {
        setPreview(await api.post<Breakdown>('/api/payroll/structures/preview', { basic, components: componentPayload() }));
      } catch {
        setPreview(null);
      } finally {
        setPreviewing(false);
      }
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.values.basic, overridesKey]);

  const save = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const basic = Number(f.values.basic);
    if (!f.values.effective_from) return toast.error('Effective date is required');
    if (f.values.basic === '' || !Number.isFinite(basic) || basic < 0) return toast.error('Basic must be a non-negative number');
    setBusy(true);
    try {
      await api.post(`/api/payroll/structures/${employeeId}`, { effective_from: f.values.effective_from, basic, currency: f.values.currency || 'INR', ctc_annual: f.values.ctc_annual === '' ? null : Number(f.values.ctc_annual), notes: f.values.notes || null, components: componentPayload() });
      toast.success('Salary structure saved');
      onSaved();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  const earnings = components.filter((c) => c.type === 'earning');
  const deductions = components.filter((c) => c.type === 'deduction');
  const renderComponent = (c: SalaryComponent) => (
    <tr key={c.id}>
      <td>{c.name} <span className="muted mono">{c.code}</span></td>
      <td className="muted">{CALC_LABEL[c.calc_type]}</td>
      <td className="right num muted">{c.calc_type === 'fixed' ? fmtMoney(c.default_value, f.values.currency) : `${c.default_value}%`}</td>
      <td style={{ width: 130 }}>
        <Input type="number" step="any" min={0} value={overrides[c.id] ?? ''} placeholder={String(c.default_value)} onChange={(e) => setOverrides((s) => ({ ...s, [c.id]: e.target.value }))} data-testid={`structure-comp-${c.code}`} />
      </td>
    </tr>
  );
  return (
    <Modal open wide title={current ? 'New salary structure (revision)' : 'New salary structure'} onClose={onClose} testId="structure-modal"
      footer={<>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={busy} onClick={() => save()} data-testid="structure-save">Save structure</Button>
      </>}>
      <form onSubmit={save} className="stack">
        <div className="form-grid">
          <Field label="Effective from" required><Input type="date" {...f.bind('effective_from')} required data-testid="structure-effective" /></Field>
          <Field label="Basic (monthly)" required><Input type="number" step="any" min={0} {...f.bind('basic')} required autoFocus data-testid="structure-basic" /></Field>
          <Field label="Currency"><Input {...f.bind('currency')} maxLength={3} className="mono" /></Field>
          <Field label="CTC (annual)" hint="Optional, informational"><Input type="number" step="any" min={0} {...f.bind('ctc_annual')} /></Field>
          <Field label="Notes" className="span-2"><Textarea {...f.bind('notes')} rows={2} placeholder="e.g. Annual revision" /></Field>
        </div>
        <div>
          <div className="form-section">Component overrides <span className="muted" style={{ textTransform: 'none', letterSpacing: 0 }}>(leave blank to use the default)</span></div>
          <div className="table-wrap">
            <table className="table dense">
              <thead><tr><th>Component</th><th>Calculation</th><th className="right">Default</th><th>Override</th></tr></thead>
              <tbody>
                {earnings.length ? <tr><td colSpan={4} className="muted" style={{ background: 'var(--surface-2)' }}>Earnings</td></tr> : null}
                {earnings.map(renderComponent)}
                {deductions.length ? <tr><td colSpan={4} className="muted" style={{ background: 'var(--surface-2)' }}>Deductions <span className="help">(PF / ESI / PT / TDS follow payroll settings)</span></td></tr> : null}
                {deductions.map(renderComponent)}
                {!components.length ? <tr><td colSpan={4} className="table-empty">No salary components configured. Add them under Payroll → Components.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <div className="form-section">Live preview {previewing ? <span className="spinner" /> : null}</div>
          {preview ? <BreakdownView b={preview} currency={f.values.currency || 'INR'} /> : <p className="help">Enter a basic amount to preview the monthly breakdown.</p>}
        </div>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Attendance                                                          */
/* ------------------------------------------------------------------ */
interface AttendanceRecord { id: number; date: string; punch_in_at?: string | null; punch_out_at?: string | null; status: string; work_minutes: number; break_minutes: number; overtime_minutes: number; late_minutes: number; punch_in_location_name?: string | null; punch_out_location_name?: string | null; punch_in_within_fence?: number | null; source: string; notes?: string | null }
function daysAgoIso(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function AttendanceTab({ employeeId }: { employeeId: number }) {
  const from = useMemo(() => daysAgoIso(30), []);
  const to = todayIso();
  const recs = useFetch<{ items: AttendanceRecord[] }>(() => api.get(`/api/attendance/records${qs({ employee_id: employeeId, from, to })}`), [employeeId, from, to]);
  const items = recs.data?.items || [];
  const summary = useMemo(() => {
    const s = { present: 0, work: 0, late: 0, overtime: 0 };
    for (const r of items) {
      if (['present', 'half_day', 'wfh'].includes(r.status)) s.present++;
      s.work += r.work_minutes || 0;
      if (r.late_minutes > 0) s.late++;
      s.overtime += r.overtime_minutes || 0;
    }
    return s;
  }, [items]);
  return (
    <>
      <div className="stat-strip">
        <Stat label="Days present" value={summary.present} hint="last 30 days" />
        <Stat label="Hours worked" value={fmtMinutes(summary.work)} />
        <Stat label="Late arrivals" value={summary.late} color={summary.late ? '#ea580c' : undefined} />
        <Stat label="Overtime" value={fmtMinutes(summary.overtime)} />
      </div>
      <Card padded={false} title={`Attendance · ${fmtDate(from)} – ${fmtDate(to)}`} actions={<Link className="btn btn-ghost btn-sm" to={`/attendance?employee=${employeeId}`}>Open attendance</Link>}>
        <Table<AttendanceRecord>
          loading={recs.loading && !recs.data}
          rows={items}
          empty="No attendance records in the last 30 days."
          dense
          columns={[
            { key: 'date', header: 'Date', render: (r) => fmtDate(r.date, { weekday: 'short', day: '2-digit', month: 'short' }) },
            { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} label={label(r.status)} /> },
            { key: 'punch_in_at', header: 'In', render: (r) => fmtTime(r.punch_in_at) },
            { key: 'punch_out_at', header: 'Out', render: (r) => fmtTime(r.punch_out_at) },
            { key: 'work_minutes', header: 'Work', align: 'right', render: (r) => fmtMinutes(r.work_minutes) },
            { key: 'break_minutes', header: 'Break', align: 'right', render: (r) => fmtMinutes(r.break_minutes) },
            { key: 'late_minutes', header: 'Late', align: 'right', render: (r) => (r.late_minutes > 0 ? <Badge tone="warning">{fmtMinutes(r.late_minutes)}</Badge> : '—') },
            { key: 'location', header: 'Location', render: (r) => { const a = r.punch_in_location_name; const b = r.punch_out_location_name; if (!a && !b) return r.punch_in_at ? <span className="muted">Remote</span> : '—'; return a === b || !b ? a : `${a} → ${b}`; } },
          ]}
        />
      </Card>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Leave                                                               */
/* ------------------------------------------------------------------ */
interface LeaveBalance { id: number; leave_type_id: number; name: string; code: string; color: string; paid: number; year: number; allocated: number; carried: number; adjusted: number; used: number; available: number; pending: number }
interface LeaveRequest { id: number; leave_type_name: string; leave_type_code: string; color: string; start_date: string; end_date: string; half_day?: string | null; days: number; reason?: string | null; status: string; review_note?: string | null; reviewer_email?: string | null; created_at: string }
function LeaveTab({ employeeId }: { employeeId: number }) {
  const balances = useFetch<LeaveBalance[]>(() => api.get(`/api/leave/balances/${employeeId}`), [employeeId]);
  const requests = useFetch<LeaveRequest[]>(() => api.get(`/api/leave/requests${qs({ employee_id: employeeId })}`), [employeeId]);
  return (
    <>
      <div className="grid grid-auto mb" data-tour="employee-leave">
        {balances.loading && !balances.data ? <Spinner /> : (balances.data || []).length === 0 ? <Card><EmptyState title="No leave balances" description="No active leave types are configured." /></Card> : (balances.data || []).map((b) => (
          <div key={b.id} className="stat" style={{ borderTopColor: b.color }} data-testid={`balance-${b.code}`}>
            <div className="stat-label">{b.name} <span className="mono">{b.code}</span>{!b.paid ? <Badge tone="neutral" className="ml">unpaid</Badge> : null}</div>
            <div className="stat-value">{b.available} <span className="muted" style={{ fontSize: 13, fontWeight: 500 }}>available</span></div>
            <div className="stat-hint">Used {b.used} · Pending {b.pending} · Allocated {b.allocated + b.carried + b.adjusted} ({b.year})</div>
          </div>
        ))}
      </div>
      <Card padded={false} title="Leave requests" actions={<Link className="btn btn-ghost btn-sm" to="/leave">Open leave module</Link>}>
        <Table<LeaveRequest>
          loading={requests.loading && !requests.data}
          rows={requests.data || []}
          empty="No leave requests yet."
          columns={[
            { key: 'leave_type_name', header: 'Type', render: (r) => <span><span className="color-swatch" style={{ background: r.color }} />{r.leave_type_name}</span> },
            { key: 'dates', header: 'Dates', render: (r) => (r.start_date === r.end_date ? fmtDate(r.start_date) : `${fmtDate(r.start_date)} – ${fmtDate(r.end_date)}`) },
            { key: 'days', header: 'Days', align: 'right', render: (r) => <span>{r.days}{r.half_day ? <span className="muted"> ({r.half_day.replace('_', ' ')})</span> : null}</span> },
            { key: 'reason', header: 'Reason', render: (r) => r.reason || '—' },
            { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} label={label(r.status)} /> },
            { key: 'review_note', header: 'Review note', render: (r) => r.review_note || '—' },
            { key: 'created_at', header: 'Requested', render: (r) => fmtDateTime(r.created_at) },
          ]}
        />
      </Card>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Assets                                                              */
/* ------------------------------------------------------------------ */
interface AssetAssignment { id: number; asset_id: number; asset_tag: string; name: string; category: string; model?: string | null; serial_number?: string | null; assigned_at: string; expected_return_at?: string | null; returned_at?: string | null; condition_out?: string | null; condition_in?: string | null; notes?: string | null }
function AssetsTab({ employeeId }: { employeeId: number }) {
  const list = useFetch<AssetAssignment[]>(() => api.get(`/api/assets/employee/${employeeId}`), [employeeId]);
  const current = (list.data || []).filter((a) => !a.returned_at);
  const returned = (list.data || []).filter((a) => !!a.returned_at);
  const base = [
    { key: 'asset_tag', header: 'Tag', render: (a: AssetAssignment) => <Link to={`/assets?q=${encodeURIComponent(a.asset_tag)}`} className="mono">{a.asset_tag}</Link> },
    { key: 'name', header: 'Asset', render: (a: AssetAssignment) => <span><strong>{a.name}</strong>{a.model ? <div className="muted">{a.model}</div> : null}</span> },
    { key: 'category', header: 'Category' },
    { key: 'serial_number', header: 'Serial', render: (a: AssetAssignment) => (a.serial_number ? <span className="mono">{a.serial_number}</span> : '—') },
    { key: 'assigned_at', header: 'Assigned', render: (a: AssetAssignment) => fmtDate(a.assigned_at) },
  ];
  return (
    <>
      <Card padded={false} title={<span className="row">Currently assigned <Badge tone="info">{current.length}</Badge></span>} tour="employee-assets">
        <Table<AssetAssignment>
          loading={list.loading && !list.data}
          rows={current}
          empty="No assets currently assigned."
          columns={[
            ...base,
            { key: 'expected_return_at', header: 'Expected return', render: (a) => fmtDate(a.expected_return_at) },
            { key: 'condition_out', header: 'Condition', render: (a) => a.condition_out || '—' },
          ]}
        />
      </Card>
      <Card padded={false} title={<span className="row">Returned <Badge tone="neutral">{returned.length}</Badge></span>}>
        <Table<AssetAssignment>
          loading={list.loading && !list.data}
          rows={returned}
          empty="No returned assets."
          dense
          columns={[
            ...base,
            { key: 'returned_at', header: 'Returned', render: (a) => fmtDate(a.returned_at) },
            { key: 'condition_in', header: 'Condition in', render: (a) => a.condition_in || '—' },
            { key: 'notes', header: 'Notes', render: (a) => a.notes || '—' },
          ]}
        />
      </Card>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Journey                                                             */
/* ------------------------------------------------------------------ */
interface JourneyStage { id: number; name: string; description?: string | null; sort_order: number; color: string; icon: string; status: 'pending' | 'in_progress' | 'completed' | 'skipped'; started_at?: string | null; completed_at?: string | null; owner?: string | null; notes?: string | null; checklist: { label: string; done: boolean }[] }
interface JourneyResponse { employee: { id: number; first_name: string; last_name: string; join_date?: string | null; vacancy_title?: string | null }; stages: JourneyStage[]; summary: { total: number; completed: number; percent: number; current_stage: string | null } }
const STAGE_ICONS: Record<string, string> = { flag: '⚑', doc: '📄', laptop: '💻', people: '👥', star: '★', check: '✓', book: '📘', chat: '💬', key: '🔑', gift: '🎁', clock: '⏱' };
function JourneyTab({ employeeId, candidateId }: { employeeId: number; candidateId?: number | null }) {
  const j = useFetch<JourneyResponse>(() => api.get(`/api/journey/employee/${employeeId}`), [employeeId]);
  const { isHr } = useAuth();
  const stages = j.data?.stages || [];
  const s = j.data?.summary;
  const vacancyTitle = j.data?.employee?.vacancy_title;
  return (
    <Card
      tour="employee-journey"
      title={<span className="row">Employee journey {s ? <Badge tone={s.percent === 100 ? 'success' : 'info'}>{s.completed} / {s.total} stages</Badge> : null}{candidateId ? <Link to={`/recruitment?candidate=${candidateId}`} className="badge badge-info" data-testid="journey-hired-via" title="Open the candidate record">Hired via recruitment{vacancyTitle ? `: ${vacancyTitle}` : ''}</Link> : null}</span>}
      actions={<Link className="btn btn-secondary btn-sm" to={`/journey?employee=${employeeId}`} data-testid="journey-open">{isHr ? 'Edit in Journey' : 'Open Journey'}</Link>}>
      {j.loading && !j.data ? <Spinner /> : (
        <>
          <div className="row between mb">
            <span className="muted">{s?.current_stage ? <>Current stage: <strong>{s.current_stage}</strong></> : s?.total ? 'All stages complete' : 'No stages yet'}</span>
            <span className="num"><strong>{s?.percent ?? 0}%</strong></span>
          </div>
          <div className="progress mb" aria-label="Journey progress"><span style={{ width: `${s?.percent ?? 0}%` }} /></div>
          {stages.length === 0 ? (
            <EmptyState title="No journey stages" description={isHr ? 'Apply the stage templates from the Journey module to build this timeline.' : 'HR has not set up a journey for this employee yet.'} />
          ) : (
            <div className="journey">
              {stages.map((st) => {
                const done = st.checklist?.filter((c) => c.done).length ?? 0;
                return (
                  <div key={st.id} className={`journey-step ${st.status}`} data-testid={`journey-stage-${st.id}`}>
                    <div className="journey-dot" style={{ background: st.color || 'var(--brand)' }}>{st.status === 'completed' ? '✓' : STAGE_ICONS[st.icon] || '•'}</div>
                    <div className="journey-card">
                      <div className="row between">
                        <strong>{st.name}</strong>
                        <StatusBadge status={st.status} label={label(st.status)} />
                      </div>
                      {st.description ? <div className="muted" style={{ marginTop: 4 }}>{st.description}</div> : null}
                      <div className="emp-meta" style={{ marginTop: 6 }}>
                        {st.owner ? <span>Owner: {st.owner}</span> : null}
                        {st.started_at ? <span>Started {fmtDate(st.started_at)}</span> : null}
                        {st.completed_at ? <span>Completed {fmtDate(st.completed_at)}</span> : null}
                        {st.checklist?.length ? <span>Checklist {done}/{st.checklist.length}</span> : null}
                      </div>
                      {st.checklist?.length ? (
                        <ul className="list" style={{ marginTop: 6 }}>
                          {st.checklist.map((c, i) => <li key={i}><span style={{ textDecoration: c.done ? 'line-through' : undefined, color: c.done ? 'var(--muted)' : undefined }}>{c.done ? '☑' : '☐'} {c.label}</span></li>)}
                        </ul>
                      ) : null}
                      {st.notes ? <div className="help" style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>{st.notes}</div> : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </Card>
  );
}
