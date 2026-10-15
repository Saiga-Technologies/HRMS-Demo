import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { usePageTour, type TourStep } from '../lib/tour';
import { fmtDateTime } from '../lib/format';
import { Button, Card, Checkbox, Field, Input, Modal, PageHeader, Select, Switch, Table, Tabs, Textarea, useConfirm, useFetch, useForm, useToast, Badge, StatusBadge } from '../components/ui';

const TOUR: TourStep[] = [
  { title: 'Settings', description: 'Where HR sets the company up, in the order you would do it the first time: 1) company profile and branding, 2) document upload rules, 3) custom fields for employee records, 4) user logins and roles, 5) the lists used in dropdowns, and 6) the audit log to check who changed what.' },
  { element: '[data-tour="settings-tabs"]', title: 'Settings areas', description: 'Each tab is one part of the setup. Changes take effect for everyone as soon as you save the tab.' },
  { element: '[data-tour="settings-company"]', title: 'Start with the company', description: 'Your company profile: the details that appear on payslips, the login page, the careers page and across the app.', tab: 'company' },
  { element: '[data-testid="company-name"]', title: 'Company details', description: 'Name, legal name, tagline, website, HR email, phone and address. The legal name and address are what official documents such as payslips use.' },
  { element: '[data-tour="settings-logo"]', title: 'Logo initials', description: 'Up to three letters shown as the logo in the sidebar, on the login page and on the public careers page.' },
  { element: '[data-testid="brand-color"]', title: 'Brand colours', description: 'The brand colour drives primary buttons, the active menu item and charts; the accent colour is used for secondary highlights. Pick colours that read well on both light and dark backgrounds.' },
  { element: '[data-tour="settings-theme"]', title: 'Default theme', description: 'Light or dark for people who have not chosen yet. Everyone can still switch from the top bar, and their choice is remembered on their device.' },
  { element: '[data-tour="settings-currency"]', title: 'Locale and defaults', description: 'Currency code and symbol (used for salaries, payroll and billing), timezone, which day the week starts on and the month your financial year starts.' },
  { element: '[data-tour="settings-code-prefix"]', title: 'Employee codes', description: 'New employees get this prefix plus the next number, for example EMP0014. Set it before you add people so codes stay consistent.' },
  { element: '[data-testid="company-save"]', title: 'Save the profile', description: 'Saves the profile and applies the new name, logo and colours straight away for everyone.' },
  { element: '[data-tour="settings-documents"]', title: 'Next, document rules', description: 'How employee documents (IDs, contracts, certificates) are uploaded and how their expiry is flagged.', tab: 'documents' },
  { element: '[data-tour="settings-formats"]', title: 'Accepted formats', description: 'Which of PDF, JPG and PNG are accepted by default. Each document type can narrow this further on the Documents page.' },
  { element: '[data-tour="settings-max-size"]', title: 'File size limit', description: 'The largest file anyone can upload, in megabytes, unless a document type sets its own limit. Bigger files are rejected.' },
  { element: '[data-tour="settings-expiry"]', title: 'Expiry warnings', description: 'How many days before expiry a document turns yellow (warning) and orange (critical); it turns red once expired. These colours show on the Documents page and the employee profile.' },
  { element: '[data-testid="docrules-save"]', title: 'Save the rules', description: 'New uploads follow the saved rules from now on; documents already uploaded are kept.' },
  { element: '[data-tour="settings-fields"]', title: 'Next, custom fields', description: 'Capture anything the standard forms do not ask for, such as blood group, T-shirt size or a second emergency contact.', tab: 'fields' },
  { element: '[data-tour="settings-fields-entity"]', title: 'Which record', description: 'Choose whether you are defining fields for employees, assets or documents. Employee fields appear on the employee form and profile.' },
  { element: '[data-testid="field-add"]', title: 'Add a field', description: 'Opens a form for the label, type (text, long text, number, date, dropdown or yes/no), the section it is grouped under, its order and whether it is required. The key is generated from the label.' },
  { element: '[data-tour="settings-fields"] tbody tr:first-child', title: 'Edit or retire a field', description: 'Click a field to edit it, or set it Inactive to hide it from forms. Deleting a field hides it too, but values already entered stay stored.' },
  { element: '[data-tour="settings-users"]', title: 'Next, users and roles', description: 'Everyone who signs in, their role, the employee record they are linked to, whether their account is active and when they last signed in.', tab: 'users' },
  { element: '[data-testid="user-add"]', title: 'Add a user', description: 'Opens a form for the email, role, linked employee and a starting password. The user must change that password the first time they sign in.' },
  { element: '[data-tour="settings-users"] tbody tr:first-child td:nth-child(2) .badge', title: 'Roles', description: 'HR has full access including these settings. Managers approve requests such as leave for their team and see their team\'s records. Employees use self-service: their own profile, leave, payslips and documents.' },
  { element: '[data-tour="settings-users"] tbody tr:first-child', title: 'Change a user', description: 'Click a user to change their role, re-link them to an employee, reset their password or disable the account. Disabled users can no longer sign in, but their history is kept.' },
  { element: '[data-tour="settings-lists"]', title: 'Next, lists', description: 'The choices offered in dropdowns elsewhere. Pick a list (asset categories or employment types), remove an item with its cross, or type a new one and click Add.', tab: 'lists' },
  { element: '[data-tour="settings-audit"]', title: 'Finally, the audit log', description: 'The latest 200 changes across the system: who did what, to which record, and when. Use it to answer "who changed this?" after setup.', tab: 'audit' },
  { title: 'What to do next', description: 'With the company, document rules, fields and users in place, add departments and positions on the Organisation page, then your employees. Come back here whenever the branding, rules or people with access change.' },
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
        <Field label="Logo initial(s)" hint="Shown in the sidebar and login page"><Input maxLength={3} {...f.bind('logo_text')} data-tour="settings-logo" /></Field>
        <Field label="Brand colour" hint="Primary buttons, active navigation, charts"><Input type="color" {...f.bind('brand_color')} data-testid="brand-color" /></Field>
        <Field label="Accent colour" hint="Secondary highlights and chart series"><Input type="color" {...f.bind('accent_color')} /></Field>
        <Field label="Default theme" hint="Users can still switch themes from the top bar"><Select {...f.bind('default_theme')} data-tour="settings-theme"><option value="light">Light</option><option value="dark">Dark</option></Select></Field>
        <div className="form-section">Locale & defaults</div>
        <Field label="Currency code"><Input {...f.bind('currency')} placeholder="INR" data-tour="settings-currency" /></Field>
        <Field label="Currency symbol"><Input {...f.bind('currency_symbol')} /></Field>
        <Field label="Timezone"><Input {...f.bind('timezone')} /></Field>
        <Field label="Employee code prefix" hint="New employees get the next number, e.g. EMP0014"><Input {...f.bind('employee_code_prefix')} data-tour="settings-code-prefix" /></Field>
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
          <div className="row" data-tour="settings-formats">
            {['pdf', 'jpg', 'png'].map((fmt) => <Checkbox key={fmt} label={fmt.toUpperCase()} checked={v.allowed_formats.includes(fmt)} onChange={() => toggle(fmt)} data-testid={`fmt-${fmt}`} />)}
          </div>
        </div>
        <div className="form-grid">
          <Field label="Maximum file size (MB)"><Input type="number" min={1} max={50} data-tour="settings-max-size" value={v.max_size_mb} onChange={(e) => setV({ ...v, max_size_mb: e.target.value })} /></Field>
          <div />
          <Field label="Warning when expiring within (days)" hint="Yellow indicator"><Input type="number" min={1} data-tour="settings-expiry" value={v.expiry_warning_days} onChange={(e) => setV({ ...v, expiry_warning_days: e.target.value })} /></Field>
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
    <Card title="Custom fields" tour="settings-fields" actions={<><Select value={entity} onChange={(e) => setEntity(e.target.value)} style={{ width: 'auto' }} data-tour="settings-fields-entity"><option value="employee">Employee</option><option value="asset">Asset</option><option value="document">Document</option></Select><Button variant="primary" onClick={() => setEdit({ entity })} data-testid="field-add">+ Add field</Button></>} padded={false}>
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
    <Card title="Configurable lists" tour="settings-lists" actions={<Select value={key} onChange={(e) => setKey(e.target.value as any)} style={{ width: 'auto' }}><option value="asset_categories">Asset categories</option><option value="employment_types">Employment types</option></Select>}>
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
    <Card title="Audit log" padded={false} tour="settings-audit">
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
