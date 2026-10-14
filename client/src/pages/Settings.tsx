import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { usePageTour } from '../lib/tour';
import { fmtDateTime } from '../lib/format';
import { Button, Card, Checkbox, Field, Input, Modal, PageHeader, Select, Switch, Table, Tabs, Textarea, useConfirm, useFetch, useForm, useToast, Badge, StatusBadge } from '../components/ui';

const TOUR = [
  { element: '[data-tour="settings-tabs"]', title: 'Settings areas', description: 'Company profile and branding, document upload rules, customisable employee fields, user logins and roles, and the audit log.' },
  { element: '[data-tour="settings-company"]', title: 'Company profile', description: 'The name, logo initial and brand colour appear across the app for every employee.' },
  { element: '[data-tour="settings-documents"]', title: 'Document upload formats', description: 'Choose which file formats (PDF, JPG, PNG) HR accepts by default, the size limit and the expiry warning windows that drive the colour indicators.' },
  { element: '[data-tour="settings-fields"]', title: 'Custom fields', description: 'Add your own fields to employee records: text, number, date, dropdown, yes/no or long text. They appear on the employee form automatically.' },
  { element: '[data-tour="settings-users"]', title: 'Users & roles', description: 'Create logins for staff and choose a role: HR (full access), Manager (approvals for their team) or Employee (self-service).' },
];

export default function Settings() {
  usePageTour('Settings', TOUR);
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'company';
  const setTab = (t: string) => setParams({ tab: t });
  return (
    <>
      <PageHeader title="Settings" subtitle="Configure the HRMS for your organisation." />
      <Tabs tour="settings-tabs" value={tab} onChange={setTab} tabs={[{ key: 'company', label: 'Company' }, { key: 'documents', label: 'Document rules' }, { key: 'fields', label: 'Custom fields' }, { key: 'users', label: 'Users & roles' }, { key: 'lists', label: 'Lists' }, { key: 'audit', label: 'Audit log' }]} />
      {tab === 'company' ? <CompanySettings /> : null}
      {tab === 'documents' ? <DocumentSettings /> : null}
      {tab === 'fields' ? <CustomFields /> : null}
      {tab === 'users' ? <Users /> : null}
      {tab === 'lists' ? <Lists /> : null}
      {tab === 'audit' ? <AuditLog /> : null}
    </>
  );
}

function CompanySettings() {
  const toast = useToast();
  const { refreshCompany } = useAuth();
  const s = useFetch<any>(() => api.get('/api/settings/company'), []);
  const f = useForm<any>({});
  useEffect(() => { if (s.data) f.setValues(s.data); }, [s.data]);
  const [busy, setBusy] = useState(false);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.put('/api/settings/company', { ...f.values, week_start: Number(f.values.week_start), financial_year_start_month: Number(f.values.financial_year_start_month) });
      await refreshCompany();
      toast.success('Company settings saved');
    } catch (err) { toast.error(err); } finally { setBusy(false); }
  };
  if (!s.data) return null;
  return (
    <Card title="Company profile & branding" tour="settings-company">
      <form onSubmit={save} className="form-grid">
        <Field label="Company name" required><Input {...f.bind('name')} required data-testid="company-name" /></Field>
        <Field label="Legal name"><Input {...f.bind('legal_name')} /></Field>
        <Field label="Tagline"><Input {...f.bind('tagline')} /></Field>
        <Field label="Website"><Input {...f.bind('website')} /></Field>
        <Field label="HR email"><Input type="email" {...f.bind('email')} /></Field>
        <Field label="Phone"><Input {...f.bind('phone')} /></Field>
        <Field label="Address" className="span-2"><Textarea {...f.bind('address')} /></Field>
        <div className="form-section">Branding</div>
        <Field label="Logo initial(s)" hint="Shown in the sidebar and login page"><Input maxLength={3} {...f.bind('logo_text')} /></Field>
        <Field label="Brand colour" hint="Primary buttons, active navigation, charts"><Input type="color" {...f.bind('brand_color')} data-testid="brand-color" /></Field>
        <Field label="Accent colour" hint="Secondary highlights and chart series"><Input type="color" {...f.bind('accent_color')} /></Field>
        <Field label="Default theme" hint="Users can still switch themes from the top bar"><Select {...f.bind('default_theme')}><option value="light">Light</option><option value="dark">Dark</option></Select></Field>
        <div className="form-section">Locale & defaults</div>
        <Field label="Currency code"><Input {...f.bind('currency')} placeholder="INR" /></Field>
        <Field label="Currency symbol"><Input {...f.bind('currency_symbol')} /></Field>
        <Field label="Timezone"><Input {...f.bind('timezone')} /></Field>
        <Field label="Employee code prefix" hint="New employees get the next number, e.g. EMP0014"><Input {...f.bind('employee_code_prefix')} /></Field>
        <Field label="Week starts on"><Select {...f.bind('week_start')}><option value={0}>Sunday</option><option value={1}>Monday</option></Select></Field>
        <Field label="Financial year starts in month"><Input type="number" min={1} max={12} {...f.bind('financial_year_start_month')} /></Field>
        <div className="span-2 row end"><Button type="submit" variant="primary" loading={busy} data-testid="company-save">Save</Button></div>
      </form>
    </Card>
  );
}

function DocumentSettings() {
  const toast = useToast();
  const s = useFetch<any>(() => api.get('/api/settings/documents'), []);
  const [v, setV] = useState<any>(null);
  useEffect(() => { if (s.data) setV(s.data); }, [s.data]);
  const [busy, setBusy] = useState(false);
  if (!v) return null;
  const toggle = (fmt: string) => setV({ ...v, allowed_formats: v.allowed_formats.includes(fmt) ? v.allowed_formats.filter((x: string) => x !== fmt) : [...v.allowed_formats, fmt] });
  const save = async () => {
    setBusy(true);
    try {
      await api.put('/api/settings/documents', { ...v, max_size_mb: Number(v.max_size_mb), expiry_warning_days: Number(v.expiry_warning_days), expiry_critical_days: Number(v.expiry_critical_days) });
      toast.success('Document rules saved');
    } catch (err) { toast.error(err); } finally { setBusy(false); }
  };
  return (
    <Card title="Document upload rules" tour="settings-documents">
      <div className="stack">
        <div>
          <div className="field-label">Default accepted formats</div>
          <p className="help">Each document type can further restrict these. HR chooses which of PDF, JPG and PNG are allowed.</p>
          <div className="row">
            {['pdf', 'jpg', 'png'].map((fmt) => <Checkbox key={fmt} label={fmt.toUpperCase()} checked={v.allowed_formats.includes(fmt)} onChange={() => toggle(fmt)} data-testid={`fmt-${fmt}`} />)}
          </div>
        </div>
        <div className="form-grid">
          <Field label="Maximum file size (MB)"><Input type="number" min={1} max={50} value={v.max_size_mb} onChange={(e) => setV({ ...v, max_size_mb: e.target.value })} /></Field>
          <div />
          <Field label="Warning when expiring within (days)" hint="Yellow indicator"><Input type="number" min={1} value={v.expiry_warning_days} onChange={(e) => setV({ ...v, expiry_warning_days: e.target.value })} /></Field>
          <Field label="Critical when expiring within (days)" hint="Orange indicator; red once expired"><Input type="number" min={0} value={v.expiry_critical_days} onChange={(e) => setV({ ...v, expiry_critical_days: e.target.value })} /></Field>
        </div>
        <div className="row end"><Button variant="primary" loading={busy} onClick={save} data-testid="docrules-save">Save</Button></div>
      </div>
    </Card>
  );
}

function CustomFields() {
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const [entity, setEntity] = useState('employee');
  const defs = useFetch<any[]>(() => api.get(`/api/settings/custom-fields/${entity}`), [entity]);
  const [edit, setEdit] = useState<any | null>(null);
  const remove = async (d: any) => {
    if (!(await confirm('Delete field?', 'Existing values stay stored but will no longer be shown.'))) return;
    try { await api.delete(`/api/settings/custom-fields/${d.id}`); toast.success('Field deleted'); defs.reload(); } catch (e) { toast.error(e); }
  };
  return (
    <Card title="Custom fields" tour="settings-fields" actions={<><Select value={entity} onChange={(e) => setEntity(e.target.value)} style={{ width: 'auto' }}><option value="employee">Employee</option><option value="asset">Asset</option><option value="document">Document</option></Select><Button variant="primary" onClick={() => setEdit({ entity })} data-testid="field-add">+ Add field</Button></>} padded={false}>
      {dialog}
      <Table rows={defs.data || []} loading={defs.loading} onRowClick={(d) => setEdit(d)} empty="No custom fields yet. Add one to extend the form."
        columns={[
          { key: 'label', header: 'Label', render: (d) => <strong>{d.label}</strong> },
          { key: 'key', header: 'Key', render: (d) => <code>{d.key}</code> },
          { key: 'type', header: 'Type' },
          { key: 'options', header: 'Options', render: (d) => (d.options || []).join(', ') || '—' },
          { key: 'section', header: 'Section', render: (d) => d.section || '—' },
          { key: 'required', header: 'Required', render: (d) => (d.required ? 'Yes' : 'No') },
          { key: 'active', header: 'Status', render: (d) => <Badge tone={d.active ? 'success' : 'neutral'}>{d.active ? 'Active' : 'Inactive'}</Badge> },
          { key: 'x', header: '', render: (d) => <Button size="sm" variant="danger" onClick={(e) => { e.stopPropagation(); remove(d); }}>Delete</Button> },
        ]} />
      {edit ? <FieldModal def={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); defs.reload(); }} /> : null}
    </Card>
  );
}
function FieldModal({ def, onClose, onSaved }: { def: any; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const f = useForm({ label: def.label || '', key: def.key || '', type: def.type || 'text', options: (def.options || []).join('\n'), required: !!def.required, section: def.section || '', sort_order: def.sort_order ?? 0, active: def.active ?? 1 });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const body: any = { ...f.values, entity: def.entity, options: f.values.options.split('\n').map((s: string) => s.trim()).filter(Boolean), required: f.values.required ? 1 : 0, sort_order: Number(f.values.sort_order), active: Number(f.values.active) };
      if (!body.key) delete body.key;
      if (def.id) await api.put(`/api/settings/custom-fields/${def.id}`, body);
      else await api.post('/api/settings/custom-fields', body);
      toast.success('Field saved');
      onSaved();
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  };
  return (
    <Modal open title={def.id ? 'Edit field' : 'New custom field'} onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save} data-testid="field-save">Save</Button></>}>
      <div className="form-grid">
        <Field label="Label" required><Input {...f.bind('label')} autoFocus data-testid="field-label" /></Field>
        <Field label="Key" hint="Auto-generated from the label if empty"><Input {...f.bind('key')} disabled={!!def.id} /></Field>
        <Field label="Type">
          <Select {...f.bind('type')} data-testid="field-type">
            <option value="text">Text</option><option value="textarea">Long text</option><option value="number">Number</option><option value="date">Date</option><option value="select">Dropdown</option><option value="boolean">Yes / No</option>
          </Select>
        </Field>
        <Field label="Section" hint="Groups fields on the form"><Input {...f.bind('section')} placeholder="e.g. Personal" /></Field>
        {f.values.type === 'select' ? <Field label="Options (one per line)" className="span-2"><Textarea {...f.bind('options')} /></Field> : null}
        <Field label="Order"><Input type="number" {...f.bind('sort_order')} /></Field>
        <Field label="Status"><Select {...f.bind('active')}><option value={1}>Active</option><option value={0}>Inactive</option></Select></Field>
        <div className="span-2"><Checkbox label="Required" checked={f.values.required} onChange={(e) => f.set('required', e.target.checked)} /></div>
      </div>
    </Modal>
  );
}

function Users() {
  const toast = useToast();
  const users = useFetch<any[]>(() => api.get('/api/settings/users/list'), []);
  const employees = useFetch<any[]>(() => api.get('/api/employees/directory/all'), []);
  const [edit, setEdit] = useState<any | null>(null);
  return (
    <Card title="Users & roles" tour="settings-users" actions={<Button variant="primary" onClick={() => setEdit({})} data-testid="user-add">+ Add user</Button>} padded={false}>
      <Table rows={users.data || []} loading={users.loading} onRowClick={(u) => setEdit(u)}
        columns={[
          { key: 'email', header: 'Email', render: (u) => <strong>{u.email}</strong> },
          { key: 'role', header: 'Role', render: (u) => <Badge tone={u.role === 'hr' ? 'info' : u.role === 'manager' ? 'warning' : 'neutral'}>{u.role}</Badge> },
          { key: 'employee', header: 'Employee', render: (u) => (u.first_name ? `${u.first_name} ${u.last_name} (${u.employee_code})` : '—') },
          { key: 'active', header: 'Status', render: (u) => <Badge tone={u.active ? 'success' : 'danger'}>{u.active ? 'Active' : 'Disabled'}</Badge> },
          { key: 'must_change_password', header: 'Password', render: (u) => (u.must_change_password ? <Badge tone="warning">must change</Badge> : 'ok') },
          { key: 'last_login_at', header: 'Last login', render: (u) => fmtDateTime(u.last_login_at) },
        ]} />
      {edit ? <UserModal user={edit} employees={employees.data || []} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); users.reload(); }} /> : null}
    </Card>
  );
}
function UserModal({ user, employees, onClose, onSaved }: { user: any; employees: any[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const f = useForm({ email: user.email || '', role: user.role || 'employee', employee_id: user.employee_id ?? '', active: user.active ?? 1, password: '' });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const body: any = { email: f.values.email, role: f.values.role, employee_id: f.values.employee_id === '' ? null : Number(f.values.employee_id), active: Number(f.values.active) };
      if (f.values.password) body.password = f.values.password;
      if (user.id) await api.put(`/api/settings/users/${user.id}`, body);
      else await api.post('/api/settings/users', body);
      toast.success('User saved');
      onSaved();
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  };
  return (
    <Modal open title={user.id ? 'Edit user' : 'New user'} onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save} data-testid="user-save">Save</Button></>}>
      <div className="form-grid">
        <Field label="Email" required><Input type="email" {...f.bind('email')} data-testid="user-email" /></Field>
        <Field label="Role"><Select {...f.bind('role')} data-testid="user-role"><option value="employee">Employee (self-service)</option><option value="manager">Manager (team approvals)</option><option value="hr">HR (full access)</option></Select></Field>
        <Field label="Linked employee">
          <Select {...f.bind('employee_id')}>
            <option value="">— None —</option>
            {employees.map((e) => <option key={e.id} value={e.id}>{e.first_name} {e.last_name} ({e.employee_code})</option>)}
          </Select>
        </Field>
        <Field label="Status"><Select {...f.bind('active')}><option value={1}>Active</option><option value={0}>Disabled</option></Select></Field>
        <Field label={user.id ? 'Reset password' : 'Password'} hint="At least 8 characters; the user must change it at first login" className="span-2"><Input type="password" {...f.bind('password')} data-testid="user-password" autoComplete="new-password" /></Field>
      </div>
    </Modal>
  );
}

function Lists() {
  const toast = useToast();
  const [key, setKey] = useState<'asset_categories' | 'employment_types'>('asset_categories');
  const list = useFetch<string[]>(() => api.get(`/api/settings/${key}`), [key]);
  const [val, setVal] = useState('');
  const save = async (items: string[]) => {
    try { await api.put(`/api/settings/${key}`, items); list.setData(items); toast.success('List saved'); } catch (e) { toast.error(e); }
  };
  return (
    <Card title="Configurable lists" actions={<Select value={key} onChange={(e) => setKey(e.target.value as any)} style={{ width: 'auto' }}><option value="asset_categories">Asset categories</option><option value="employment_types">Employment types</option></Select>}>
      <div className="chip-list mb">
        {(list.data || []).map((item) => <span className="chip" key={item}>{item} <button onClick={() => save((list.data || []).filter((x) => x !== item))} aria-label={`Remove ${item}`}>✕</button></span>)}
      </div>
      <div className="row">
        <Input value={val} onChange={(e) => setVal(e.target.value)} placeholder="New item" style={{ maxWidth: 260 }} />
        <Button variant="primary" onClick={() => { if (val.trim()) { save([...(list.data || []), val.trim()]); setVal(''); } }}>Add</Button>
      </div>
    </Card>
  );
}

function AuditLog() {
  const log = useFetch<any[]>(() => api.get('/api/settings/audit/log?limit=200'), []);
  return (
    <Card title="Audit log" padded={false}>
      <Table dense rows={log.data || []} loading={log.loading}
        columns={[
          { key: 'created_at', header: 'When', render: (r) => fmtDateTime(r.created_at) },
          { key: 'user_email', header: 'User', render: (r) => r.user_email || 'system' },
          { key: 'action', header: 'Action', render: (r) => <StatusBadge status={r.action} /> },
          { key: 'entity', header: 'Entity', render: (r) => `${r.entity} #${r.entity_id ?? ''}` },
          { key: 'details', header: 'Details', render: (r) => <span className="mono muted">{r.details ? JSON.stringify(r.details).slice(0, 120) : ''}</span> },
        ]} />
    </Card>
  );
}
